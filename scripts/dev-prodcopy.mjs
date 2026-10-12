/**
 * Runs the local dev server against a LOCAL, sanitized copy of production data — without editing .env.
 *
 *   npm run dev:prodcopy                       # database scholario_ops_ui_test
 *   npm run dev:prodcopy -- other_local_copy   # another local copy
 *
 * Everything that could act on the outside world is switched off for this run (environment variables
 * win over .env): no Cloudflare token (no DNS change is possible), no Hostinger, no SMTP, no public URL.
 * Monitors still run their read-only HTTP / SSL checks against the real sites, like production does.
 * Prepare the copy first:  node scripts/sanitize-local-copy.mjs <database>
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const env = require('dotenv').config({ quiet: true }).parsed ?? {};

const target = process.argv[2] ?? 'scholario_ops_ui_test';
const base = new URL(process.env.DATABASE_URL ?? env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(base.hostname)) {
  console.error(`STOP: DATABASE_URL points at ${base.hostname}; the copy must be on this machine.`);
  process.exit(2);
}
const url = new URL(base);
url.pathname = `/${target}`;

console.log(`Local app on copy "${target}" — Cloudflare, Hostinger, SMTP and public URL disabled for this run.`);
const child = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts', '--dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: url.toString(),
    DB_SCHEMA: 'ops',
    CLOUDFLARE_API_TOKEN: '',
    HOSTINGER_API_TOKEN: '',
    SMTP_HOST: '',
    PUBLIC_URL: '',
    DEPLOY_REPORT_TOKEN: '',
    LOCAL_UI_SAFE_MODE: 'true',
  },
});
child.on('exit', code => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
