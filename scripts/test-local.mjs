/**
 * Runs the test suites against the disposable local database scholario_ops_ui_test — never the
 * database in .env (which is not edited). Each test file creates and drops its own temporary schema
 * inside that database; the copied production data in schema "ops" is never touched by tests.
 *
 *   npm run test:local                          # all tests
 *   npm run test:local -- tests/escalation.test.ts tests/netguard.test.ts
 *
 * The original DATABASE_URL is validated before its database name is replaced. A missing, ambiguous,
 * non-local, or redirected URL stops the run. Credentials and the connection string are not printed.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { prepareLocalTestDatabaseUrl } from './test-database-url.mjs';
const require = createRequire(import.meta.url);
const env = require('dotenv').config({ quiet: true }).parsed ?? {};

// An empty DATABASE_URL in the environment counts as unset (falls back to .env). The value is
// validated before the database name is replaced; it is never printed.
const rawUrl = process.env.DATABASE_URL || env.DATABASE_URL || '';
let prepared;
try { prepared = prepareLocalTestDatabaseUrl(rawUrl, process.env); }
catch (err) { console.error(`STOP: ${err instanceof Error ? err.message : 'DATABASE_URL was refused'}`); process.exit(2); }

// Flags (e.g. --test-name-pattern=…) go to node --test; everything else is a test file
const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('--'));
const given = args.filter(a => !a.startsWith('--'));
const files = given.length ? given : fs.readdirSync('tests').filter(f => f.endsWith('.test.ts')).map(f => `tests/${f}`);
const sourceNote = prepared.sourceDatabase === prepared.database ? '' : ` (source database name "${prepared.sourceDatabase}" is not used)`;
console.log(`Tests on ${prepared.hostname}/${prepared.database}${sourceNote}: ${files.length} file(s)`);
const child = spawn(process.execPath, ['--import', 'tsx', '--test', ...flags, ...files], {
  stdio: 'inherit',
  env: {
    ...process.env, DATABASE_URL: prepared.connectionString, HOST: '127.0.0.1',
    // Never the real mail server from .env: an empty variable wins over .env (dotenv does not override it)
    SMTP_SERVICE: '', SMTP_URL: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '',
  },
});
child.on('exit', code => process.exit(code ?? 1));
