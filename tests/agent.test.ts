/**
 * Telemetry agent script: the generated installer contains valid Python, and the optional
 * database probe parses MySQL/MariaDB/PostgreSQL output correctly (simulated command output,
 * no database). Skipped when no Python 3 interpreter is available.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildInstaller, AGENT_VERSION } from '../server/agent.ts';

// A stray PYTHONHOME / PYTHONPATH in the environment breaks every interpreter; run Python without them
const pyEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'PYTHONHOME' && k !== 'PYTHONPATH'));

/** First working Python 3 interpreter (some machines have a broken default but a working versioned one). */
function findPython(): string[] | null {
  const candidates = [['python3'], ['python'], ['py', '-3'], ['py', '-3.13'], ['py', '-3.12'], ['py', '-3.11']];
  for (const [cmd, ...args] of candidates) {
    const r = spawnSync(cmd, [...args, '-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8', env: pyEnv });
    if (r.status === 0 && r.stdout.trim() === '3') return [cmd, ...args];
  }
  return null;
}

test('agent installer embeds the agent and never contains database credentials', () => {
  const script = buildInstaller({ serverUrl: 'https://ops.example.com', agentToken: 'a'.repeat(48), hostname: 'vps', services: 'nginx mysql' });
  assert.match(script, new RegExp(`AGENT_VERSION = "${AGENT_VERSION}"`));
  assert.match(script, /DB_ENGINE=\n/, 'database probe is off until configured on the VPS');
  // Only an explanatory comment mentions "password=..."; no value is ever written
  assert.equal(/^[^#\n]*password\s*=/im.test(script), false, 'no password is written by the installer');
});

test('agent python: valid syntax and database probe parsing', (t) => {
  const py = findPython();
  if (!py) { t.skip('Python 3 not available'); return; }
  const script = buildInstaller({ serverUrl: 'https://ops.example.com', agentToken: 'a'.repeat(48), hostname: 'vps', services: 'nginx' });
  const agent = script.split("<<'SCHOLARIO_AGENT_EOF'\n")[1].split('SCHOLARIO_AGENT_EOF')[0];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-agent-'));
  const file = path.join(dir, 'agent.py');
  fs.writeFileSync(file, agent);
  try {
    const r = spawnSync(py[0], [...py.slice(1), path.join('tests', 'fixtures', 'agent_dbprobe_check.py'), file], { encoding: 'utf8', env: pyEnv });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /ALL AGENT DB PROBE CHECKS PASSED/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
