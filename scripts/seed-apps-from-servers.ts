/**
 * After Hostinger VPS are registered: set PRD/DR from hostname labels, and create
 * application rows (PRD + optional DR) so Overview lists every product.
 * URLs stay empty until an admin sets them in Setup (that creates HTTPS monitors).
 *
 * Stop Ops first. Usage: npx tsx scripts/seed-apps-from-servers.ts
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { initStore, db, flush, persist, saveFailureClient } from '../server/store.ts';
import { closePool } from '../server/db.ts';
import { environmentFromHostname } from '../server/providers/register.ts';
import { syncAppUrlMonitors, DEFAULT_HEALTH_CHECK } from '../server/appMonitors.ts';
import type { Application } from '../src/types/index.ts';
import { blankRouting } from '../src/lib/trafficHealth.ts';

function productKey(hostname: string): { key: string; name: string; role: 'PRD' | 'DR' | 'SOLO' } {
  const h = hostname.toLowerCase();
  const role = environmentFromHostname(h);
  let base = h.replace(/[.-](prd|dr)$/i, '').replace(/[.-]vps$/i, '');
  if (!base) base = h;
  const name = base.split(/[.-]/).filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  const solo = !/[.-](prd|dr)$/i.test(h) && !/(^|[.-])dr($|[.-])/.test(h) && !/(^|[.-])prd($|[.-])/.test(h);
  return { key: base.replace(/\./g, '-'), name: name || hostname, role: solo ? 'SOLO' : role };
}

function newApp(partial: Pick<Application, 'name' | 'codeName' | 'description' | 'prdServerId' | 'drServerId'>): Application {
  return {
    id: crypto.randomUUID(),
    name: partial.name,
    codeName: partial.codeName,
    description: partial.description,
    tier: 'TIER_2',
    status: 'UNKNOWN',
    uptime24h: null,
    uptime7d: null,
    uptime30d: null,
    rtoTargetMin: 60,
    rpoTargetMin: 60,
    currentReplicationLagSec: null,
    prdServerId: partial.prdServerId,
    drServerId: partial.drServerId,
    failoverState: 'PRIMARY_ACTIVE',
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    errorRatePercent: null,
    lastChecked: '',
    cloudflareZone: '',
    autoFailover: false,
    dependencies: [],
    prdUrl: '',
    drUrl: '',
    healthCheck: { ...DEFAULT_HEALTH_CHECK },
    trafficRouting: blankRouting(),
  };
}

await initStore();

let envFixed = 0;
for (const s of db.servers) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s.hostname)) continue;
  const want = environmentFromHostname(s.hostname);
  if (s.environment !== want) {
    console.log(`env ${s.hostname}: ${s.environment} → ${want}`);
    s.environment = want;
    envFixed++;
  }
}

// Fix bad seed rows from an earlier run (invalid tier / failoverState)
for (const a of db.applications) {
  if (a.tier !== 'TIER_1' && a.tier !== 'TIER_2' && a.tier !== 'TIER_3') {
    console.log(`fix tier on ${a.codeName}: ${a.tier} → TIER_2`);
    (a as { tier: Application['tier'] }).tier = 'TIER_2';
  }
  if (a.failoverState !== 'PRIMARY_ACTIVE' && a.failoverState !== 'DR_ACTIVE' && a.failoverState !== 'FAILING_OVER') {
    console.log(`fix failoverState on ${a.codeName}: ${a.failoverState} → PRIMARY_ACTIVE`);
    a.failoverState = 'PRIMARY_ACTIVE';
  }
  if (a.uptime24h === undefined) a.uptime24h = null;
  if (a.uptime7d === undefined) a.uptime7d = null;
  if (a.uptime30d === undefined) a.uptime30d = null;
  if (a.currentReplicationLagSec === undefined) a.currentReplicationLagSec = null;
  if (a.p50Ms === undefined) a.p50Ms = null;
  if (a.p95Ms === undefined) a.p95Ms = null;
  if (a.p99Ms === undefined) a.p99Ms = null;
  if (a.errorRatePercent === undefined) a.errorRatePercent = null;
  if (a.lastChecked === undefined) a.lastChecked = '';
  if (!a.dependencies) a.dependencies = [];
}

const groups = new Map<string, { name: string; prd?: typeof db.servers[0]; dr?: typeof db.servers[0]; solo?: typeof db.servers[0] }>();
for (const s of db.servers) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s.hostname)) continue;
  const meta = productKey(s.hostname);
  const g = groups.get(meta.key) ?? { name: meta.name };
  if (meta.role === 'DR') g.dr = s;
  else if (meta.role === 'SOLO') g.solo = s;
  else g.prd = s;
  groups.set(meta.key, g);
}

let created = 0;
for (const [key, g] of groups) {
  const prd = g.prd ?? g.solo;
  if (!prd) {
    console.log(`skip ${key}: DR without PRD (${g.dr?.hostname})`);
    continue;
  }
  const codeName = key.slice(0, 64);
  if (db.applications.some(a => a.codeName === codeName)) {
    console.log(`app exists for ${codeName}`);
    continue;
  }
  if (db.applications.some(a => a.prdServerId === prd.id || (g.dr && a.drServerId === g.dr.id))) {
    console.log(`server already linked: ${prd.hostname}`);
    continue;
  }

  const app = newApp({
    name: g.name,
    codeName,
    description: `From Hostinger inventory (${prd.hostname}${g.dr ? ` / ${g.dr.hostname}` : ''}). Set PRD/DR URLs in Setup to enable HTTPS monitors.`,
    prdServerId: prd.id,
    drServerId: g.dr?.id ?? '',
  });
  db.applications.push(app);
  syncAppUrlMonitors(app, 'seed');
  created++;
  console.log(`+ app ${app.name} (${app.codeName}) PRD=${prd.hostname}${g.dr ? ` DR=${g.dr.hostname}` : ' (PRD-only)'}`);
}

persist();
const ok = await flush();
if (!ok) {
  console.error('PostgreSQL save failed:', saveFailureClient());
  process.exit(1);
}
console.log(`Environments fixed: ${envFixed}. Applications created: ${created}. Total apps: ${db.applications.length}. Total servers: ${db.servers.length}.`);
await closePool();
process.exit(0);
