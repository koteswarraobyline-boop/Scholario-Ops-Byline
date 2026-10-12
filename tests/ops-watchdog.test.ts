/**
 * deploy/ops-watchdog.sh (runs from cron on the DR node and watches the Ops server):
 * threshold before alerting, one alert per outage + reminders, undelivered alerts retried,
 * recovery message with downtime, heartbeat ping back to Ops, unreachable server, bad config.
 * A local HTTP server plays the Ops health endpoint, the Teams/Slack webhook and the ping URL.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import type { AddressInfo } from 'node:net';

const BASH = process.platform === 'win32' ? ['C:\\Program Files\\Git\\bin\\bash.exe'].find(p => fs.existsSync(p)) : 'bash';
const SKIP = BASH ? false : 'bash not found';

let ready: 200 | 503 = 200;
let hookStatus = 200;
const hooks: string[] = [];
let pings = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    if (req.url === '/api/health/ready') {
      res.writeHead(ready, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ready === 200 ? { status: 'ready' } : { status: 'not_ready', checks: { database: 'unavailable: timeout' } }));
    } else if (req.url === '/hook') {
      if (hookStatus === 200) hooks.push(JSON.parse(body).text as string);
      res.writeHead(hookStatus); res.end();
    } else if (req.url?.startsWith('/api/v1/heartbeat/')) { pings++; res.writeHead(200); res.end('{}'); }
    else { res.writeHead(404); res.end(); }
  });
});
let base = '';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-watchdog-'));
const conf = path.join(dir, 'watchdog.conf');
const stateDir = path.join(dir, 'state');

before(async () => {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function writeConf(extra = '') {
  fs.writeFileSync(conf, `OPS_URL=${base}\nFAILURES_BEFORE_ALERT=3\nREMIND_EVERY_MIN=60\nWEBHOOK_URL="${base}/hook"\nPING_URL=${base}/api/v1/heartbeat/tok123\n${extra}`);
}
/** Async on purpose: the fake server lives in this process and must keep answering */
function runWatchdog(): Promise<{ code: number; out: string }> {
  return new Promise(resolve => {
    execFile(BASH as string, [path.join(process.cwd(), 'deploy', 'ops-watchdog.sh')], {
      env: { ...process.env, WATCHDOG_CONF: conf, WATCHDOG_STATE_DIR: stateDir }, timeout: 60_000,
    }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 99) : 0, out: `${stdout}${stderr}` }));
  });
}
const state = () => Object.fromEntries(fs.readFileSync(path.join(stateDir, 'state'), 'utf8').trim().split('\n').map(l => l.split('=')).map(([k, v]) => [k, Number(v)]));
const reset = () => { fs.rmSync(stateDir, { recursive: true, force: true }); hooks.length = 0; pings = 0; hookStatus = 200; ready = 200; };

test('healthy: exit 0, pings Ops, no alert', { skip: SKIP }, async () => {
  reset(); writeConf();
  const r = await runWatchdog();
  assert.equal(r.code, 0, r.out);
  assert.equal(pings, 1);
  assert.equal(hooks.length, 0);
});

test('outage: alerts only after 3 failures, once, then reminds; recovery reports the downtime', { skip: SKIP }, async () => {
  reset(); writeConf();
  ready = 503;
  for (let i = 1; i <= 2; i++) assert.equal((await runWatchdog()).code, 1);
  assert.equal(hooks.length, 0, 'below the threshold: no alert');
  const r3 = await runWatchdog();
  assert.equal(r3.code, 1);
  assert.equal(hooks.length, 1, r3.out);
  assert.match(hooks[0], /\[DOWN\] Scholario Ops is not healthy/);
  assert.match(hooks[0], /HTTP 503/);
  assert.match(hooks[0], /database/, 'the failing check is included');
  await runWatchdog();
  assert.equal(hooks.length, 1, 'no repeat within REMIND_EVERY_MIN');
  assert.equal(pings, 0, 'no heartbeat ping while Ops is failing');

  // Reminder once the interval has passed
  const s = state();
  fs.writeFileSync(path.join(stateDir, 'state'), `FAILURES=${s.FAILURES}\nFIRST_FAIL=${s.FIRST_FAIL - 3700}\nALERTED=1\nLAST_ALERT=${s.LAST_ALERT - 3700}\n`);
  await runWatchdog();
  assert.equal(hooks.length, 2);
  assert.match(hooks[1], /\[STILL DOWN\]/);

  ready = 200;
  const rr = await runWatchdog();
  assert.equal(rr.code, 0, rr.out);
  assert.equal(hooks.length, 3);
  assert.match(hooks[2], /\[RECOVERED\]/);
  assert.match(hooks[2], /after 61 min/, hooks[2]);
  assert.equal(pings, 1);
  assert.equal(state().ALERTED, 0);
});

test('an alert that cannot be delivered is retried on the next run', { skip: SKIP }, async () => {
  reset(); writeConf();
  ready = 503; hookStatus = 500;
  for (let i = 0; i < 3; i++) await runWatchdog();
  assert.equal(hooks.length, 0);
  assert.equal(state().ALERTED, 0, 'not marked as alerted');
  hookStatus = 200;
  await runWatchdog();
  assert.equal(hooks.length, 1, 'delivered on the retry');
  assert.match(hooks[0], /failed its health check 4 times/);
});

test('Ops unreachable is a failure with curl\'s reason; unreachable SMTP alone never marks the alert delivered', { skip: SKIP }, async () => {
  reset();
  const closed = http.createServer(); await new Promise<void>(r => closed.listen(0, '127.0.0.1', () => r()));
  const deadPort = (closed.address() as AddressInfo).port; await new Promise(r => closed.close(r));
  fs.writeFileSync(conf, `OPS_URL=http://127.0.0.1:${deadPort}\nFAILURES_BEFORE_ALERT=1\nSMTP_URL=smtp://127.0.0.1:${deadPort}\nMAIL_FROM=a@example.invalid\nMAIL_TO=b@example.invalid\nSMTP_PASS="p\\"a\\\\ss"\nSMTP_USER=u\n`);
  const r = await runWatchdog();
  assert.equal(r.code, 1);
  assert.match(r.out, /no answer/);
  assert.match(r.out, /email delivery failed/);
  assert.match(r.out, /could NOT be delivered/);
  assert.equal(state().ALERTED, 0);
  assert.doesNotMatch(r.out, /p"a/, 'the password is never printed');
});

test('configuration errors exit 2', { skip: SKIP }, async () => {
  reset();
  fs.writeFileSync(conf, 'OPS_URL=ftp://x\nWEBHOOK_URL=http://127.0.0.1/hook\n');
  assert.equal((await runWatchdog()).code, 2);
  fs.writeFileSync(conf, `OPS_URL=${base}\n`);
  const r = await runWatchdog();
  assert.equal(r.code, 2);
  assert.match(r.out, /no alert channel/);
});
