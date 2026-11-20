/**
 * Makes a LOCAL copy of the production "ops" schema safe to run the app against:
 *   • agent tokens and push-heartbeat tokens replaced by random ones (the real ones stay in production only)
 *   • session (refresh) tokens deleted
 *   • auto-failover switched off on every application
 *   • notification channels disabled and their targets (webhook URLs, routing keys, addresses) blanked
 * Users and history are kept, so the dashboard shows real data and you can sign in with your usual account.
 *
 *   node scripts/sanitize-local-copy.mjs scholario_ops_ui_test
 *
 * Refuses to run unless the database is on this machine (localhost / 127.0.0.1 / ::1), and refuses the
 * database DATABASE_URL points at. Runs in one transaction.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('dotenv').config({ quiet: true });
const pg = require('pg');

const target = process.argv[2];
if (!target || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(target)) {
  console.error('usage: node scripts/sanitize-local-copy.mjs <local database name>');
  process.exit(2);
}
const base = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(base.hostname)) {
  console.error(`STOP: DATABASE_URL points at ${base.hostname}, not this machine. This script only touches local copies.`);
  process.exit(2);
}
if (decodeURIComponent(base.pathname.slice(1)) === target) {
  console.error(`STOP: ${target} is the database the app normally uses (DATABASE_URL). Give the name of the copy.`);
  process.exit(2);
}
const url = new URL(base);
url.pathname = `/${target}`;
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
try {
  await db.query('BEGIN');
  // 64 random hex characters without needing the pgcrypto extension
  const rnd = `md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)`;
  const servers = await db.query(`UPDATE ops.servers SET agent_token = ${rnd}`);
  const push = await db.query(`UPDATE ops.monitors SET heartbeat_token = ${rnd} WHERE coalesce(heartbeat_token, '') <> ''`);
  const sessions = await db.query('DELETE FROM ops.refresh_tokens');
  const failover = await db.query('UPDATE ops.applications SET auto_failover = false WHERE auto_failover');
  const channels = await db.query(`UPDATE ops.channels SET data = data || '{"enabled": false, "targetEndpoint": ""}'::jsonb`);
  await db.query('COMMIT');
  console.log(`Sanitized ${target}:`);
  console.log(`  agent tokens replaced:        ${servers.rowCount}`);
  console.log(`  push-heartbeat tokens:        ${push.rowCount}`);
  console.log(`  sessions deleted:             ${sessions.rowCount}`);
  console.log(`  auto-failover switched off:   ${failover.rowCount}`);
  console.log(`  channels disabled + blanked:  ${channels.rowCount}`);
} catch (err) {
  await db.query('ROLLBACK').catch(() => {});
  console.error('Sanitizing failed, nothing changed:', err.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
