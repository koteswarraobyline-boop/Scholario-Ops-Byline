/**
 * Runs the test suites against the disposable local database scholario_ops_ui_test — never the
 * database in .env (which is not edited). Each test file creates and drops its own temporary schema
 * inside that database; the copied production data in schema "ops" is never touched by tests.
 *
 *   npm run test:local                          # all tests
 *   npm run test:local -- tests/escalation.test.ts tests/netguard.test.ts
 *
 * Refuses to run unless the database host is this machine.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const env = require('dotenv').config({ quiet: true }).parsed ?? {};

const TEST_DB = 'scholario_ops_ui_test';
// An empty DATABASE_URL in the environment counts as unset (falls back to .env)
const rawUrl = process.env.DATABASE_URL || env.DATABASE_URL || '';
let base;
try { base = new URL(rawUrl); } catch { console.error('STOP: DATABASE_URL is missing or not a valid URL (set it in .env).'); process.exit(2); }
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(base.hostname)) {
  console.error(`STOP: the database host is ${base.hostname || '(none)'}, not this machine. Tests only run against a local disposable database.`);
  process.exit(2);
}
const url = new URL(base);
url.pathname = `/${TEST_DB}`;

// Flags (e.g. --test-name-pattern=…) go to node --test; everything else is a test file
const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('--'));
const given = args.filter(a => !a.startsWith('--'));
const files = given.length ? given : fs.readdirSync('tests').filter(f => f.endsWith('.test.ts')).map(f => `tests/${f}`);
console.log(`Tests on ${url.hostname}/${TEST_DB} (local, disposable): ${files.length} file(s)`);
const child = spawn(process.execPath, ['--import', 'tsx', '--test', ...flags, ...files], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url.toString(), HOST: '127.0.0.1' },
});
child.on('exit', code => process.exit(code ?? 1));
