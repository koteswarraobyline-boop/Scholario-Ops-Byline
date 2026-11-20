/** SSRF guard for notification destinations (server/netguard.ts) — no outside network needed */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { classifyIp, assertSafeTarget, guardedLookup, addressRefusal, policyFromEnv } from '../server/netguard.ts';

const none = policyFromEnv('');

test('address classes: IPv4, IPv6, mapped / embedded IPv4 forms', () => {
  const cases: Array<[string, string]> = [
    ['8.8.8.8', 'public'], ['1.1.1.1', 'public'], ['2606:4700:4700::1111', 'public'],
    ['127.0.0.1', 'loopback'], ['127.255.0.9', 'loopback'], ['::1', 'loopback'],
    ['10.1.2.3', 'private'], ['172.16.0.1', 'private'], ['172.31.255.255', 'private'], ['192.168.1.1', 'private'], ['fd00::1', 'private'], ['fc12::9', 'private'],
    ['169.254.169.254', 'link-local'], ['fe80::1', 'link-local'],
    ['100.64.0.1', 'cgnat'], ['0.0.0.0', 'unspecified'], ['::', 'unspecified'],
    ['224.0.0.1', 'multicast'], ['ff02::1', 'multicast'],
    ['192.0.2.10', 'documentation'], ['2001:db8::1', 'documentation'], ['240.0.0.1', 'reserved'],
    // IPv4 hidden in IPv6
    ['::ffff:127.0.0.1', 'loopback'], ['::ffff:7f00:1', 'loopback'], ['::ffff:169.254.169.254', 'link-local'],
    ['64:ff9b::a9fe:a9fe', 'link-local'], ['2002:a9fe:a9fe::1', 'link-local'], ['2002:0808:0808::1', 'public'],
    ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'reserved'], // Teredo
    ['172.15.0.1', 'public'], ['172.32.0.1', 'public'],
  ];
  for (const [ip, cls] of cases) assert.equal(classifyIp(ip), cls, ip);
});

test('save-time check: schemes, credentials, internal names, numeric spellings, private targets; explicit allowlist; metadata never allowed', async () => {
  const refused = async (url: string, policy = none) => assert.rejects(assertSafeTarget(url, policy), undefined, url);
  await refused('ftp://example.com/x');
  await refused('https://user:pw@hooks.example.com/x');
  await refused('https://localhost/x');
  await refused('https://metadata.google.internal/computeMetadata/v1/');
  await refused('https://127.0.0.1/x');
  await refused('https://[::1]/x');
  await refused('https://[::ffff:127.0.0.1]/x');
  await refused('https://2130706433/x');        // = 127.0.0.1
  await refused('https://0x7f.1/x');            // = 127.0.0.1
  await refused('https://10.0.0.5/hook');
  await refused('https://169.254.169.254/latest/meta-data/');
  await assert.rejects(assertSafeTarget('http://8.8.8.8/x', none, { requireHttps: true }), /https/);
  await assertSafeTarget('https://8.8.8.8/hook', none); // public IP literal: allowed (no DNS needed)

  const allow = policyFromEnv('10.0.0.0/8, chat.corp.example');
  await assertSafeTarget('https://10.0.0.5/hook', allow);
  await refused('https://192.168.1.5/hook', allow);                           // not in the allowlist
  await refused('https://169.254.169.254/latest/', policyFromEnv('169.254.0.0/16')); // metadata: never
  assert.equal(addressRefusal('10.1.1.1', 'chat.corp.example', allow), null, 'allowlisted host name may resolve privately');
  assert.match(addressRefusal('10.1.1.1', 'evil.example', policyFromEnv('192.168.0.0/16'))!, /private/);
});

test('connect-time guard: the connection is refused when the host resolves to a blocked address (rebinding-safe), allowed when allowlisted', async () => {
  const server = http.createServer((_q, res) => { res.end('ok'); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  const get = (policy: ReturnType<typeof policyFromEnv>) => new Promise<number>((resolve, reject) => {
    // "localhost" resolves at connect time through the guard — the same path a rebinding host would take
    const req = http.request({ host: 'localhost', port, path: '/', lookup: guardedLookup(policy), family: 4 }, res => { res.resume(); resolve(res.statusCode!); });
    req.on('error', reject); req.end();
  });
  try {
    await assert.rejects(get(none), /Refused: localhost → 127\.0\.0\.1 is a loopback address/);
    assert.equal(await get(policyFromEnv('127.0.0.1')), 200);
  } finally { server.close(); }
});
