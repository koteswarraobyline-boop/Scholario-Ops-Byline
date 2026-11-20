/**
 * The generated update script is executed: a report restores nothing, and a missing report puts the previous script back.
 *   npm run test:local -- tests/agent-update.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AGENT_VERSION, buildUpdater } from '../server/agent.ts';

function bashExe(): string {
  const candidates = [process.env.BASH, 'bash', 'C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'].filter((v): v is string => Boolean(v));
  for (const candidate of candidates) {
    if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) return candidate;
  }
  throw new Error('bash is required to run the agent update script');
}

function toBash(p: string): string {
  const slash = p.replace(/\\/g, '/');
  const drive = slash.match(/^([A-Za-z]):\/(.*)$/);
  return drive ? `/${drive[1].toLowerCase()}/${drive[2]}` : slash;
}

function runUpdate(writeOk: boolean, failFirst = false) {
  const bash = bashExe();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-agent-upd-'));
  const binDir = path.join(root, 'opt', 'scholario-agent');
  const confDir = path.join(root, 'etc');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(confDir, { recursive: true });
  const previous = 'print("previous-agent")\n';
  const conf = 'AGENT_TOKEN=keep-this-token\nINTERVAL_SEC=10\n';
  fs.writeFileSync(path.join(binDir, 'agent.py'), previous);
  fs.writeFileSync(path.join(confDir, 'scholario-agent.conf'), conf);
  const fake = path.join(root, 'systemctl');
  fs.writeFileSync(fake, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$SCHOLARIO_AGENT_ROOT/systemctl.log"
if [ "$1" = "restart" ] && [ "\${FAIL_FIRST:-}" = "1" ]; then
  lines=$(grep -c restart "$SCHOLARIO_AGENT_ROOT/systemctl.log" || true)
  if [ "$lines" = "1" ]; then exit 1; fi
fi
if [ "$1" = "restart" ] && [ "\${WRITE_OK:-}" = "1" ]; then
  mkdir -p "$SCHOLARIO_AGENT_ROOT/var/lib/scholario-agent"
  printf '%s\\n' "$EXPECT_VERSION" > "$SCHOLARIO_AGENT_ROOT/var/lib/scholario-agent/last-ok"
fi
`);
  fs.chmodSync(fake, 0o755);
  const script = path.join(root, 'update.sh');
  fs.writeFileSync(script, buildUpdater({ hostname: 'upd-test' }).replace(/\r\n/g, '\n'));
  const result = spawnSync(bash, [toBash(script)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SCHOLARIO_AGENT_TEST: '1',
      SCHOLARIO_AGENT_ROOT: toBash(root),
      SCHOLARIO_AGENT_SYSTEMCTL: toBash(fake),
      SCHOLARIO_AGENT_UPDATE_WAIT_SEC: writeOk ? '5' : '0',
      WRITE_OK: writeOk ? '1' : '0',
      FAIL_FIRST: failFirst ? '1' : '0',
      EXPECT_VERSION: AGENT_VERSION,
    },
  });
  return {
    root,
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
    agent: fs.readFileSync(path.join(binDir, 'agent.py'), 'utf8'),
    conf: fs.readFileSync(path.join(confDir, 'scholario-agent.conf'), 'utf8'),
    log: fs.existsSync(path.join(root, 'systemctl.log')) ? fs.readFileSync(path.join(root, 'systemctl.log'), 'utf8') : '',
    previous,
    confText: conf,
  };
}

test('a failed report restores the previous agent and leaves the token file untouched', () => {
  const ran = runUpdate(false);
  assert.equal(ran.status, 1, `${ran.stdout}\n${ran.stderr}`);
  assert.equal(ran.agent, ran.previous);
  assert.equal(ran.conf, ran.confText);
  assert.equal(ran.agent.includes('keep-this-token'), false);
  assert.match(ran.log, /restart scholario-agent/);
  assert.equal(ran.log.trim().split('\n').length, 2, 'restart the new process, then restart the restored one');
  fs.rmSync(ran.root, { recursive: true, force: true });
});

test('a failed restart restores the previous agent', () => {
  const ran = runUpdate(false, true);
  assert.equal(ran.status, 1, `${ran.stdout}\n${ran.stderr}`);
  assert.match(ran.stderr, /Restart failed/);
  assert.equal(ran.agent, ran.previous);
  assert.equal(ran.conf, ran.confText);
  assert.equal(ran.log.trim().split('\n').length, 2);
  fs.rmSync(ran.root, { recursive: true, force: true });
});

test('a production run ignores the test root and requires root', () => {
  const bash = bashExe();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-agent-prod-'));
  const script = path.join(dir, 'update.sh');
  fs.writeFileSync(script, buildUpdater({ hostname: 'prod-test' }).replace(/\r\n/g, '\n'));
  const result = spawnSync(bash, [toBash(script)], {
    encoding: 'utf8',
    env: { ...process.env, SCHOLARIO_AGENT_TEST: '', SCHOLARIO_AGENT_ROOT: '/tmp/not-used', SCHOLARIO_AGENT_SYSTEMCTL: '/tmp/not-used' },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Run as root/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a successful report keeps the new agent and still does not rewrite the config', () => {
  const ran = runUpdate(true);
  assert.equal(ran.status, 0, `${ran.stdout}\n${ran.stderr}`);
  assert.match(ran.agent, new RegExp(`AGENT_VERSION = "${AGENT_VERSION}"`));
  assert.equal(ran.conf, ran.confText);
  assert.match(ran.stdout, /reported successfully/);
  assert.equal(ran.log.trim().split('\n').length, 1);
  fs.rmSync(ran.root, { recursive: true, force: true });
});
