/**
 * Email channels end to end against a local SMTP server (127.0.0.1, no outside network): delivered
 * with login, HTML + text body, several recipients; wrong password, refused recipient and an
 * unreachable server give a clear reason; permanent errors are not retried; verify() logs in only.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import dotenv from 'dotenv';
import { pinTestDatabaseUrl, assertConnectedToTestDatabase, dropVerifiedTestSchema } from './helpers/test-db-guard.ts';

pinTestDatabaseUrl();
dotenv.config({ quiet: true });

/** What the fake server received */
const mails: Array<{ from: string; to: string[]; data: string; user: string }> = [];
let logins = 0;
const smtp = net.createServer(sock => {
  let state: 'cmd' | 'data' | 'auth-user' | 'auth-pass' = 'cmd';
  let buf = '';
  let cur = { from: '', to: [] as string[], data: '', user: '' };
  let authUser = '';
  const say = (s: string) => sock.write(`${s}\r\n`);
  const login = (user: string, pass: string) => {
    logins++;
    if (pass === 'right-pass') { cur.user = user; say('235 2.7.0 Authentication successful'); }
    else say('535 5.7.8 Username and Password not accepted');
  };
  say('220 fake.smtp.test ESMTP');
  sock.on('data', chunk => {
    buf += chunk.toString('utf8');
    let i: number;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (state === 'data') {
        if (line === '.') { mails.push(cur); cur = { from: '', to: [], data: '', user: cur.user }; state = 'cmd'; say('250 2.0.0 queued'); }
        else cur.data += `${line}\n`;
        continue;
      }
      if (state === 'auth-user') { authUser = Buffer.from(line, 'base64').toString(); state = 'auth-pass'; say('334 UGFzc3dvcmQ6'); continue; }
      if (state === 'auth-pass') { state = 'cmd'; login(authUser, Buffer.from(line, 'base64').toString()); continue; }
      const cmd = line.toUpperCase();
      if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) { sock.write('250-fake.smtp.test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n'); }
      else if (cmd.startsWith('AUTH PLAIN')) {
        const arg = line.split(' ')[2];
        if (!arg) { say('334 '); state = 'auth-pass'; continue; }
        const [, u, p] = Buffer.from(arg, 'base64').toString().split('\0');
        login(u, p);
      }
      else if (cmd.startsWith('AUTH LOGIN')) { state = 'auth-user'; say('334 VXNlcm5hbWU6'); }
      else if (cmd.startsWith('MAIL FROM')) { cur.from = line.slice(10).replace(/[<>]/g, '').split(' ')[0]; say('250 2.1.0 ok'); }
      else if (cmd.startsWith('RCPT TO')) {
        const to = line.slice(8).replace(/[<>]/g, '').split(' ')[0];
        if (to.startsWith('nobody@')) say('550 5.1.1 No such user here');
        else { cur.to.push(to); say('250 2.1.5 ok'); }
      }
      else if (cmd === 'DATA') { state = 'data'; say('354 go ahead'); }
      else if (cmd === 'RSET') { cur = { from: '', to: [], data: '', user: cur.user }; say('250 ok'); }
      else if (cmd === 'NOOP') say('250 ok');
      else if (cmd === 'QUIT') { say('221 bye'); sock.end(); }
      else say('502 not implemented');
    }
  });
  sock.on('error', () => {});
});
await new Promise<void>(r => smtp.listen(0, '127.0.0.1', () => r()));
const port = (smtp.address() as AddressInfo).port;

process.env.DB_SCHEMA = `ops_email_${process.pid}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-email-'));
process.env.HOSTINGER_API_TOKEN = '';
process.env.CLOUDFLARE_API_TOKEN = '';
process.env.SMTP_SERVICE = '';
process.env.SMTP_URL = `smtp://alerts%40example.test:right-pass@127.0.0.1:${port}`;
process.env.SMTP_HOST = '';
process.env.SMTP_SECURE = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.SMTP_FROM = '';
process.env.SMTP_REQUIRE_TLS = 'false';
// The fake mail server listens on loopback: allowed explicitly, like an internal relay would be
process.env.NOTIFY_ALLOWED_PRIVATE_TARGETS = '127.0.0.1';

const { initStore } = await import('../server/store.ts');
const { query, closePool, SCHEMA } = await import('../server/db.ts');
const { config, isSmtpConfigured } = await import('../server/config.ts');
const notify = await import('../server/notify.ts');
const deliveries = await import('../server/deliveries.ts');
notify.RETRY_DELAYS_MS.splice(0, notify.RETRY_DELAYS_MS.length, 50, 50);

const ch = (target: string) => ({ id: `ch-mail-${Math.random()}`, name: 'Ops mail', type: 'EMAIL', targetEndpoint: target, enabled: true, failureCount: 0 }) as never;
const msg = { title: 'INC-77 API <down>', text: 'Severity: CRITICAL\nDetail: HTTP 503', severity: 'CRITICAL', status: 'FIRING' as const, incidentId: 'INC-77', link: 'https://ops.example/incidents?id=INC-77' };

let verified = false;
before(async () => {
  await assertConnectedToTestDatabase({ query: sql => query(sql) });
  verified = true;
  await initStore();
});
after(async () => {
  smtp.close();
  await dropVerifiedTestSchema(verified, () => query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {}));
  await closePool();
});

test('SMTP_URL configures host, port, login; SMTP_FROM falls back to the user address; port 587-style plain connection is not implicit TLS', () => {
  assert.equal(isSmtpConfigured(), true);
  assert.equal(config.smtp.host, '127.0.0.1');
  assert.equal(config.smtp.port, port);
  assert.equal(config.smtp.user, 'alerts@example.test');
  assert.equal(config.smtp.from, 'alerts@example.test');
  const o = notify.smtpTransportOptions() as { secure: boolean; connectionTimeout: number };
  assert.equal(o.secure, false);
  assert.ok(o.connectionTimeout <= 10_000, 'a dead mail server cannot hang a send for minutes');
});

test('email is delivered to every recipient, with a subject, a text and an HTML body (escaped)', async () => {
  mails.length = 0;
  const r = await notify.sendToChannel(ch('oncall@example.test, admin@example.test'), msg);
  assert.equal(r.ok, true, r.error);
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].to.sort(), ['admin@example.test', 'oncall@example.test']);
  assert.equal(mails[0].from, 'alerts@example.test');
  assert.equal(mails[0].user, 'alerts@example.test', 'logged in with the SMTP_URL user');
  const data = mails[0].data;
  assert.match(data, /Subject: \[FIRING\] INC-77 API <down>/);
  assert.match(data, /text\/plain/);
  assert.match(data, /text\/html/);
  assert.ok(data.includes('&lt;down&gt;'), 'title is escaped in the HTML part');
  assert.ok(data.includes('https://ops.example/incidents?id=INC-77'));
  const logged = (await deliveries.getDelivery(r.deliveryId!))!;
  assert.equal(logged.result, 'DELIVERED');
  assert.equal(logged.attempts, 1);
});

test('a refused recipient is a clear, permanent failure (not retried)', async () => {
  mails.length = 0;
  const r = await notify.sendToChannel(ch('nobody@example.test'), msg);
  assert.equal(r.ok, false);
  assert.match(r.error!, /mail server refused the message/);
  assert.equal((await deliveries.getDelivery(r.deliveryId!))!.attempts, 1, 'not retried');
});

test('describeSmtpError: login, TLS mismatch, certificate and network errors get a plain reason and the right retry class', () => {
  const auth = notify.describeSmtpError({ code: 'EAUTH', responseCode: 535, response: '535 5.7.8 Username and Password not accepted' });
  assert.equal(auth.permanent, true);
  assert.match(auth.message, /app password/);
  const tls = notify.describeSmtpError({ code: 'ESOCKET', message: 'ssl3_get_record:wrong version number' });
  assert.equal(tls.permanent, true);
  assert.match(tls.message, /port 465 with SMTP_SECURE=true/);
  const cert = notify.describeSmtpError({ code: 'ESOCKET', message: 'self-signed certificate in certificate chain' });
  assert.match(cert.message, /SMTP_TLS_REJECT_UNAUTHORIZED=false/);
  const down = notify.describeSmtpError({ code: 'ECONNECTION', message: 'connect ECONNREFUSED 10.0.0.1:587' });
  assert.equal(down.permanent, false, 'network trouble is retried');
  assert.match(down.message, /Cannot reach the mail server/);
  const busy = notify.describeSmtpError({ responseCode: 421, response: '421 try later' });
  assert.equal(busy.permanent, false, '4xx is temporary');
});

test('verify logs in without sending; a wrong password is reported as a login problem', async () => {
  mails.length = 0;
  const before = logins;
  const ok = await notify.verifySmtp();
  assert.equal(ok.ok, true, ok.error);
  assert.equal(mails.length, 0, 'nothing sent');
  assert.ok(logins > before, 'it did log in');

  config.smtp.pass = 'wrong-pass';
  try {
    const bad = await notify.verifySmtp();
    assert.equal(bad.ok, false);
    assert.match(bad.error!, /SMTP login rejected/);
    assert.equal(bad.error!.includes('wrong-pass'), false, 'the password is never in the error');
    const r = await notify.sendToChannel(ch('oncall@example.test'), msg);
    assert.equal(r.ok, false);
    assert.match(r.error!, /SMTP login rejected/);
    const logged = (await deliveries.getDelivery(r.deliveryId!))!;
    assert.equal(logged.attempts, 1, 'a wrong password is not retried');
    assert.equal(JSON.stringify(logged).includes('wrong-pass'), false, 'not in the delivery log either');
  } finally {
    config.smtp.pass = 'right-pass';
  }
});

test('a server reply that echoes the password is redacted', () => {
  const d = notify.describeSmtpError({ responseCode: 535, response: '535 bad credentials for alerts@example.test / right-pass' });
  assert.equal(d.message.includes('right-pass'), false);
  assert.ok(d.message.includes('••••'));
});

test('.env loading: the project-root .env is what the sender and Check SMTP see; empty values reproduce the live error; the environment wins; the report has names, never values', async () => {
  const { execFileSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-envload-'));
  const script = path.join(dir, 'probe.mts');
  fs.writeFileSync(script, `
    const cfg = await import(${JSON.stringify(new URL('../server/config.ts', import.meta.url).href)});
    const notify = await import(${JSON.stringify(new URL('../server/notify.ts', import.meta.url).href)});
    if (process.argv.includes('--touch')) { await new Promise(r => setTimeout(r, 30)); (await import('node:fs')).appendFileSync('.env', '\\n'); }
    const verify = await notify.verifySmtp();
    console.log(JSON.stringify({ problem: notify.smtpConfigProblem(), verify, report: cfg.smtpSettingsReport(), line: cfg.describeSmtpSettings() }));
    process.exit(0);`);
  const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('SMTP_')));
  const run = (envFile: string, extra: Record<string, string> = {}, args: string[] = []) => {
    fs.writeFileSync(path.join(dir, '.env'), envFile);
    const out = execFileSync(process.execPath, ['--import', import.meta.resolve('tsx'), script, ...args], { cwd: dir, env: { ...baseEnv, ...extra }, encoding: 'utf8', timeout: 60_000 });
    return { out, res: JSON.parse(out.trim().split(/\r?\n/).pop()!) };
  };
  const exact = 'SMTP is not configured: set SMTP_HOST (or SMTP_SERVICE / SMTP_URL) and SMTP_FROM in the server .env, then restart';
  const present = (r: { report: { variables: { name: string; present: boolean; source: string }[] } }, name: string) => r.report.variables.find(v => v.name === name)!;
  try {
    // The live .env shape: SMTP_HOST / SMTP_FROM / SMTP_USER / SMTP_PASS empty, SMTP_PORT=587, SMTP_SECURE=false
    const empty = run('SMTP_HOST=\nSMTP_PORT=587\nSMTP_SECURE=false\nSMTP_USER=\nSMTP_PASS=\nSMTP_FROM=\n');
    assert.equal(empty.res.problem, exact);
    assert.equal(empty.res.verify.ok, false);
    assert.equal(empty.res.verify.error, exact, 'Check SMTP reports the same problem as the sender');
    assert.equal(path.basename(path.dirname(empty.res.report.envFile)), path.basename(dir), '.env is read from the working directory (npm scripts: the project root)');
    assert.equal(empty.res.report.envFileFound, true);
    assert.deepEqual(present(empty.res, 'SMTP_HOST'), { name: 'SMTP_HOST', present: false, source: '.env' });
    assert.deepEqual(present(empty.res, 'SMTP_FROM'), { name: 'SMTP_FROM', present: false, source: '.env' });
    assert.deepEqual(present(empty.res, 'SMTP_PORT'), { name: 'SMTP_PORT', present: true, source: '.env' });
    assert.deepEqual(present(empty.res, 'SMTP_SERVICE'), { name: 'SMTP_SERVICE', present: false, source: 'unset' });
    assert.match(empty.out, /SMTP settings from .*\.env: SMTP_SERVICE=missing, SMTP_URL=missing, SMTP_HOST=missing, SMTP_PORT=set/, 'startup log line');

    // Filled with (fake) values: the same file makes the configuration check pass; no value appears anywhere
    const filled = 'SMTP_HOST=smtp.example.test\nSMTP_PORT=587\nSMTP_SECURE=false\nSMTP_USER=fake-user@example.test\nSMTP_PASS=FAKE-PASS-123\nSMTP_FROM=Ops <fake-from@example.test>\n';
    const ok = run(filled);
    assert.equal(ok.res.problem, null, 'configuration check succeeds');
    assert.ok(ok.res.report.variables.filter((v: { present: boolean }) => v.present).length >= 6);
    assert.equal(ok.res.report.envFileChangedSinceStart, false);
    for (const secret of ['FAKE-PASS-123', 'fake-user@', 'smtp.example.test']) assert.equal(JSON.stringify(ok.res.report).includes(secret) || ok.res.line.includes(secret), false, `${secret} never in the report`);
    assert.equal(ok.out.includes('FAKE-PASS-123'), false, 'the password is never printed');

    // An (empty) variable already in the environment wins over .env: the trap where the file is right but a shell / PM2 value hides it
    const shadowed = run(filled, { SMTP_HOST: '' });
    assert.equal(shadowed.res.problem, exact);
    assert.deepEqual(present(shadowed.res, 'SMTP_HOST'), { name: 'SMTP_HOST', present: false, source: 'environment' });
    assert.match(shadowed.res.line, /SMTP_HOST=missing \(from environment\)/);

    // .env saved after start: flagged (needs a restart)
    const touched = run(filled, {}, ['--touch']);
    assert.equal(touched.res.report.envFileChangedSinceStart, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing or inconsistent settings name the setting (never its value) and nothing is contacted', async () => {
  const saved = { ...config.smtp };
  const before = logins;
  const cases: Array<[Partial<typeof config.smtp>, RegExp]> = [
    [{ host: '', service: '' }, /SMTP is not configured: set SMTP_HOST \(or SMTP_SERVICE \/ SMTP_URL\) and SMTP_FROM/],
    [{ host: '', service: 'NoSuchMailProvider' }, /SMTP_SERVICE "NoSuchMailProvider" is not a known provider preset/],
    [{ from: '' }, /SMTP_FROM is not set/],
    [{ from: 'not-an-address' }, /SMTP_FROM is not a valid email address/],
    [{ pass: '' }, /SMTP_USER is set but SMTP_PASS is empty/],
    [{ user: '' }, /SMTP_PASS is set but SMTP_USER is empty/],
  ];
  try {
    for (const [patch, re] of cases) {
      Object.assign(config.smtp, saved, patch);
      assert.match(notify.smtpConfigProblem() ?? '', re);
      const r = await notify.sendToChannel(ch('oncall@example.test'), msg);
      assert.equal(r.ok, false);
      assert.match(r.error!, re);
      assert.equal(r.error!.includes('right-pass'), false);
      assert.equal((await deliveries.getDelivery(r.deliveryId!))!.attempts, 1, 'configuration errors are not retried');
    }
    Object.assign(config.smtp, saved, { from: 'Ops Alerts <alerts@example.test>' });
    assert.equal(notify.smtpConfigProblem(), null, 'display-name form is accepted');
  } finally {
    Object.assign(config.smtp, saved);
  }
  assert.equal(logins, before, 'no connection was made for invalid settings');
});

test('SSRF guard for the mail server: metadata never, loopback / private only when allowlisted, IPv6 and mapped forms too', async () => {
  const saved = process.env.NOTIFY_ALLOWED_PRIVATE_TARGETS;
  const savedCfg = config.notifyAllowedPrivateTargets;
  const refuse = async (host: string, re: RegExp) => {
    await assert.rejects(notify.resolveSmtpAddress(host), (e: Error) => re.test(e.message), host);
  };
  try {
    await refuse('169.254.169.254', /link-local \/ cloud-metadata/);
    await refuse('fe80::1', /link-local/);
    Object.assign(config, { notifyAllowedPrivateTargets: '' });
    await refuse('127.0.0.1', /loopback address \(allow it explicitly with NOTIFY_ALLOWED_PRIVATE_TARGETS\)/);
    await refuse('::1', /loopback/);
    await refuse('::ffff:127.0.0.1', /loopback/);
    await refuse('10.1.2.3', /private address/);
    await refuse('fd00::25', /private address/);
    await refuse('localhost', /internal host name/);
    await refuse('metadata.google.internal', /internal host name/);
    // A relay on the private network is allowed by name / IP / CIDR, metadata still is not
    Object.assign(config, { notifyAllowedPrivateTargets: '10.0.0.0/8, 169.254.169.254' });
    assert.equal(await notify.resolveSmtpAddress('10.1.2.3'), '10.1.2.3');
    await refuse('169.254.169.254', /link-local/);
    // The send path applies it before connecting: no login happens
    Object.assign(config, { notifyAllowedPrivateTargets: '' });
    const before = logins;
    const r = await notify.sendToChannel(ch('oncall@example.test'), msg);
    assert.equal(r.ok, false);
    assert.match(r.error!, /Refused: mail server 127\.0\.0\.1 → 127\.0\.0\.1 is a loopback address/);
    assert.equal((await deliveries.getDelivery(r.deliveryId!))!.attempts, 1, 'refusals are not retried');
    assert.equal(logins, before, 'never connected');
    const v = await notify.verifySmtp();
    assert.equal(v.ok, false);
    assert.match(v.error!, /Refused/);
  } finally {
    process.env.NOTIFY_ALLOWED_PRIVATE_TARGETS = saved;
    Object.assign(config, { notifyAllowedPrivateTargets: savedCfg });
  }
});

test('the connection goes to the checked address and TLS still verifies the host name', () => {
  const saved = { ...config.smtp };
  try {
    Object.assign(config.smtp, { host: 'smtp.example.test', port: 587, secure: null });
    const o = notify.smtpTransportOptions('203.0.113.10') as { host: string; servername: string; tls: { servername: string; rejectUnauthorized: boolean } };
    assert.equal(o.host, '203.0.113.10');
    assert.equal(o.servername, 'smtp.example.test');
    assert.equal(o.tls.servername, 'smtp.example.test');
    assert.equal(o.tls.rejectUnauthorized, true, 'certificates are verified by default');
  } finally {
    Object.assign(config.smtp, saved);
  }
});

test('an unreachable mail server is retried, then fails with the reason', async () => {
  const dead = net.createServer();
  await new Promise<void>(r => dead.listen(0, '127.0.0.1', () => r()));
  const deadPort = (dead.address() as AddressInfo).port;
  await new Promise<void>(r => dead.close(() => r()));
  const saved = config.smtp.port;
  config.smtp.port = deadPort;
  try {
    const r = await notify.sendToChannel(ch('oncall@example.test'), msg);
    assert.equal(r.ok, false);
    assert.match(r.error!, /Cannot reach the mail server 127\.0\.0\.1:\d+/);
    assert.equal((await deliveries.getDelivery(r.deliveryId!))!.attempts, 3, 'retried');
  } finally {
    config.smtp.port = saved;
  }
});

test('a mail server that accepts the connection but never answers times out (no hang)', async () => {
  const silent = net.createServer(s => { s.on('error', () => {}); /* never sends the 220 greeting */ });
  await new Promise<void>(r => silent.listen(0, '127.0.0.1', () => r()));
  const saved = config.smtp.port;
  config.smtp.port = (silent.address() as AddressInfo).port;
  const t0 = Date.now();
  try {
    const v = await notify.verifySmtp();
    assert.equal(v.ok, false);
    assert.match(v.error!, /Cannot reach the mail server|timeout/i);
    assert.ok(Date.now() - t0 < 15_000, `gave up after ${Date.now() - t0} ms`);
  } finally {
    config.smtp.port = saved;
    silent.close();
  }
});

test('presets: SMTP_SERVICE without a host resolves to the provider host; an explicit host wins; port 465 means implicit TLS', () => {
  const saved = { ...config.smtp };
  try {
    Object.assign(config.smtp, { host: '', service: 'Gmail', secure: null, portSet: false });
    assert.deepEqual(notify.smtpEndpoint(), { host: 'smtp.gmail.com', port: 465, secure: true });
    assert.equal(notify.smtpServerLabel(), 'smtp.gmail.com:465 (Gmail)');
    Object.assign(config.smtp, { service: 'Outlook365' });
    assert.deepEqual(notify.smtpEndpoint(), { host: 'smtp.office365.com', port: 587, secure: false });
    Object.assign(config.smtp, { host: 'smtp.hostinger.com', service: 'Gmail', port: 465, secure: null });
    assert.equal(notify.smtpEndpoint()!.host, 'smtp.hostinger.com');
    assert.equal((notify.smtpTransportOptions() as { secure: boolean }).secure, true);
    Object.assign(config.smtp, { port: 587 });
    assert.equal((notify.smtpTransportOptions() as { secure: boolean }).secure, false);
    Object.assign(config.smtp, { secure: true });
    assert.equal((notify.smtpTransportOptions() as { secure: boolean }).secure, true, 'SMTP_SECURE=true is honoured on any port');
  } finally {
    Object.assign(config.smtp, saved);
  }
});

test('Gmail on 587: an explicit SMTP_PORT overrides the preset port; impossible TLS / port pairs are named before connecting', () => {
  const saved = { ...config.smtp };
  try {
    // SMTP_SERVICE=Gmail + SMTP_PORT=587 + SMTP_SECURE=false (STARTTLS)
    Object.assign(config.smtp, { host: '', service: 'Gmail', port: 587, portSet: true, secure: false, user: 'a@example.com', pass: 'x', from: 'a@example.com' });
    assert.deepEqual(notify.smtpEndpoint(), { host: 'smtp.gmail.com', port: 587, secure: false });
    assert.equal(notify.smtpConfigProblem(), null);
    // SMTP_HOST=smtp.gmail.com + SMTP_PORT=587, SMTP_SECURE unset
    Object.assign(config.smtp, { host: 'smtp.gmail.com', service: '', secure: null });
    assert.deepEqual(notify.smtpEndpoint(), { host: 'smtp.gmail.com', port: 587, secure: false });
    assert.equal(notify.smtpConfigProblem(), null);
    Object.assign(config.smtp, { secure: true });
    assert.match(notify.smtpConfigProblem()!, /Port 587 uses STARTTLS but SMTP_SECURE=true/);
    Object.assign(config.smtp, { port: 465, secure: false });
    assert.match(notify.smtpConfigProblem()!, /Port 465 uses implicit TLS but SMTP_SECURE=false/);
    Object.assign(config.smtp, { port: 2525, secure: false });
    assert.equal(notify.smtpConfigProblem(), null, 'other ports are not second-guessed');
  } finally {
    Object.assign(config.smtp, saved);
  }
});
