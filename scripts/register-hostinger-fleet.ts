/**
 * One-shot: sync Hostinger inventory into Ops, then register every VM as a server
 * in PostgreSQL (same path as Providers → Register all). Stop the Ops process first
 * so this script is the only writer.
 *
 * Usage: npx tsx scripts/register-hostinger-fleet.ts
 */
import 'dotenv/config';
import { initStore, db, flush } from '../server/store.ts';
import { query, closePool, SCHEMA } from '../server/db.ts';
import { ensureLegacyHostingerConnection } from '../server/providers/connections.ts';
import { syncConnection } from '../server/providers/sync.ts';
import { registerAllProviderInstances } from '../server/providers/register.ts';

await initStore();
ensureLegacyHostingerConnection();
const conn = db.providerConnections.find(c => c.legacy) ?? db.providerConnections[0];
if (!conn) {
  console.error('No Hostinger connection. Set HOSTINGER_API_TOKEN in .env.');
  process.exit(1);
}

console.log(`Syncing connection: ${conn.name} (${conn.tokenEnv})…`);
await syncConnection(conn.id, { manual: true });
const instances = db.providerInstances.filter(i => i.connectionId === conn.id);
console.log(`Provider instances: ${instances.length} (${instances.filter(i => !i.absent).length} current)`);
for (const i of instances.filter(i => !i.absent)) {
  console.log(`  - ${i.hostname || '(no hostname)'}  ${(i.ipv4 || []).join(',') || 'no-ip'}  ${i.plan || ''}  ${i.region || ''}`);
}

const before = db.servers.length;
const summary = registerAllProviderInstances();
await flush();
console.log(`Servers before: ${before} → after: ${db.servers.length}`);
console.log(`Created: ${summary.created.length} · already registered: ${summary.existed.length} · skipped: ${summary.skipped.length}`);
for (const r of summary.created) {
  if (r.status === 'created') console.log(`  + ${r.server.hostname} (${r.server.ip}) ${r.server.environment}`);
}
for (const r of summary.skipped) {
  if (r.status === 'skipped') console.log(`  skip ${r.instanceId}: ${r.reason}`);
}

const apps = await query(`SELECT name, code_name, COALESCE(prd_url, '') AS prd_url FROM ${SCHEMA}.applications`);
console.log('Applications in DB (add more in Setup with PRD URL for HTTPS monitoring):');
for (const a of apps.rows as Array<{ name: string; code_name: string; prd_url: string }>) {
  console.log(`  - ${a.name} (${a.code_name}) ${a.prd_url ? a.prd_url : '→ set PRD URL in Setup'}`);
}

await closePool();
console.log('Done. Start Ops again (npm run dev) and open Overview / Infrastructure / Providers.');
