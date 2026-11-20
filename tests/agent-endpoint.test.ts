/**
 * Agent endpoint selection. PUBLIC_URL empty falls back to the browser address, and that
 * address is not usable when it is loopback or not https. Reasons never echo the input.
 *   npm run test:local -- tests/agent-endpoint.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentBaseUrl, refusedInstallScript, agentInstallInfo, isLoopbackHost } from '../src/lib/agentEndpoint.ts';
import { buildInstaller } from '../server/agent.ts';

const TOKEN = 'a'.repeat(48);
const SERVER = { id: 'srv-1', agentToken: TOKEN };
const OPTS = { agentVersion: '3.3.1', publicUrlConfigured: false };

test('missing PUBLIC_URL and a localhost browser address are not a usable agent endpoint', () => {
  for (const browser of ['http://127.0.0.1:3000', 'http://localhost:3000', 'https://127.0.0.1', 'https://[::1]', 'http://0.0.0.0:3000', 'https://127.1']) {
    const base = resolveAgentBaseUrl('', browser);
    assert.equal(base.ok, false, browser);
    if (base.ok) continue;
    assert.match(base.reason, /VPS cannot reach it|not https/);
    assert.equal(base.reason.includes(TOKEN), false);
    assert.equal(base.reason.includes('127.0.0.1:3000'), false);
    const info = agentInstallInfo(base, SERVER, OPTS);
    assert.equal(info.installCommand, '');
    assert.equal(info.ingestUrl, '');
    assert.equal(JSON.stringify(info).includes(TOKEN), false);
    const script = refusedInstallScript(base.reason);
    assert.match(script, /exit 1/);
    assert.equal(script.includes(TOKEN), false);
    assert.equal(script.includes('SERVER_URL'), false);
    assert.equal(script.includes('127.0.0.1'), false);
  }
});

test('an explicit bad PUBLIC_URL is not replaced by a good browser address', () => {
  const http = resolveAgentBaseUrl('http://ops.example.com', 'https://ops.example.com');
  assert.equal(http.ok, false);
  const loop = resolveAgentBaseUrl('https://localhost', 'https://ops.example.com');
  assert.equal(loop.ok, false);
  const secret = resolveAgentBaseUrl('https://user:s3cret@ops.example.com', '');
  assert.equal(secret.ok, false);
  if (!secret.ok) assert.equal(secret.reason.includes('s3cret'), false);
  const query = resolveAgentBaseUrl('https://ops.example.com/install?key=' + TOKEN, '');
  assert.equal(query.ok, false);
  if (!query.ok) assert.equal(query.reason.includes(TOKEN), false);
});

test('a valid public https URL is the agent ingest endpoint, and the request host is ignored', () => {
  const base = resolveAgentBaseUrl('https://ops.example.com/', 'http://127.0.0.1:3000');
  assert.equal(base.ok, true);
  if (!base.ok) return;
  assert.equal(base.base, 'https://ops.example.com');
  const info = agentInstallInfo(base, SERVER, { ...OPTS, publicUrlConfigured: true });
  assert.equal(info.ingestUrl, 'https://ops.example.com/api/v1/agent/ingest');
  assert.equal(info.installCommand.startsWith("curl -fsSL 'https://ops.example.com/api/v1/agent/install/srv-1?key="), true);
  assert.equal(info.installCommand.includes('127.0.0.1'), false);
  assert.equal(info.problem, undefined);

  const fromBrowser = resolveAgentBaseUrl('', 'https://ops.example.com:8443');
  assert.equal(fromBrowser.ok, true);
  if (fromBrowser.ok) assert.equal(fromBrowser.base, 'https://ops.example.com:8443');
});

test('loopback detection covers short IPv4 forms and does not treat other addresses as loopback', () => {
  for (const h of ['localhost', 'foo.localhost', '::1', '0.0.0.0', '127.0.0.1', '127.1', '127.0.1']) assert.equal(isLoopbackHost(h), true, h);
  for (const h of ['ops.example.com', '10.0.0.1', '93.127.167.135', '187.126.113.32']) assert.equal(isLoopbackHost(h), false, h);
});

test('the installer refuses http and loopback before it writes the agent token', () => {
  assert.throws(() => buildInstaller({ serverUrl: 'http://127.0.0.1:3000', agentToken: TOKEN, hostname: 'vps', services: 'nginx' }), /Invalid server URL/);
  assert.throws(() => buildInstaller({ serverUrl: 'https://localhost', agentToken: TOKEN, hostname: 'vps', services: 'nginx' }), /Invalid server URL/);
  let leaked = false;
  try { buildInstaller({ serverUrl: 'http://127.0.0.1:3000', agentToken: TOKEN, hostname: 'vps', services: 'nginx' }); }
  catch (err) { leaked = String(err).includes(TOKEN); }
  assert.equal(leaked, false);
  const script = buildInstaller({ serverUrl: 'https://ops.example.com', agentToken: TOKEN, hostname: 'vps', services: 'nginx' });
  assert.equal(script.includes('SERVER_URL=https://ops.example.com\n'), true);
  assert.equal(/SERVER_URL=https?:\/\/(127\.0\.0\.1|localhost)/.test(script), false);
  const agent = script.split("<<'SCHOLARIO_AGENT_EOF'\n")[1].split('SCHOLARIO_AGENT_EOF')[0];
  assert.equal(agent.includes('systemctl restart nginx'), false);
  assert.equal(agent.includes('systemctl stop'), false);
  const killLines = agent.split('\n').filter(l => l.includes('os.kill('));
  assert.ok(killLines.length > 0 && killLines.every(l => /, 0\)\s*$/.test(l)));
});
