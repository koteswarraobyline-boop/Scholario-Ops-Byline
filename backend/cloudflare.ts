import { CloudflareZone, CloudflareDnsRecord, Application } from '../src/types/index.ts';
import { config, isCloudflareConfigured } from './config.ts';
import { db } from './store.ts';
import { broadcast } from './events.ts';

const API = 'https://api.cloudflare.com/client/v4';

interface CfEnvelope<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: T;
  result_info?: { page: number; total_pages: number };
}

export class CloudflareError extends Error {}

async function cf<T>(path: string, init: RequestInit = {}): Promise<CfEnvelope<T>> {
  if (!isCloudflareConfigured()) throw new CloudflareError('Cloudflare is not configured (CLOUDFLARE_API_TOKEN missing)');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch(`${API}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.cloudflareApiToken}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const body = await resp.json().catch(() => null) as CfEnvelope<T> | null;
    if (!resp.ok || !body?.success) {
      const msg = body?.errors?.map(e => `${e.code}: ${e.message}`).join('; ') || `HTTP ${resp.status}`;
      throw new CloudflareError(`Cloudflare API ${init.method || 'GET'} ${path.split('?')[0]} failed — ${msg}`);
    }
    return body;
  } catch (err) {
    if (err instanceof CloudflareError) throw err;
    throw new CloudflareError(`Cloudflare API unreachable: ${(err as Error).name === 'AbortError' ? 'timeout' : (err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function cfAll<T>(path: string, perPage: number, maxPages: number): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; page <= maxPages; page++) {
    const res = await cf<T[]>(`${path}${sep}per_page=${perPage}&page=${page}`);
    out.push(...res.result);
    if (!res.result_info || page >= res.result_info.total_pages) break;
  }
  return out;
}

interface RawZone { id: string; name: string; status: string; name_servers?: string[]; plan?: { name?: string } }
interface RawRecord { id: string; type: string; name: string; content: string; proxied?: boolean; ttl: number; modified_on?: string }

export const cfState = {
  zones: [] as CloudflareZone[],
  rawRecords: new Map<string, RawRecord[]>(),
  lastSyncAt: null as string | null,
  lastError: null as string | null,
  syncing: false,
};

async function optional<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

async function wafEvents24h(zoneId: string): Promise<number | null> {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  const query = `query($zone: String!, $since: Time!, $until: Time!) {
    viewer { zones(filter: { zoneTag: $zone }) {
      firewallEventsAdaptiveGroups(limit: 1, filter: { datetime_geq: $since, datetime_leq: $until }) { count }
    } }
  }`;
  const resp = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.cloudflareApiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { zone: zoneId, since: since.toISOString(), until: now.toISOString() } }),
  });
  const body = await resp.json() as { data?: { viewer?: { zones?: Array<{ firewallEventsAdaptiveGroups?: Array<{ count: number }> }> } }; errors?: unknown[] };
  if (body.errors && (body.errors as unknown[]).length) return null;
  const groups = body.data?.viewer?.zones?.[0]?.firewallEventsAdaptiveGroups;
  if (!groups) return null;
  return groups.reduce((sum, g) => sum + g.count, 0);
}

function appsForZone(domain: string): Application[] {
  return db.applications.filter(a => a.cloudflareZone && (a.cloudflareZone === domain || a.cloudflareZone.endsWith(`.${domain}`)));
}

function buildZone(raw: RawZone, records: RawRecord[], ssl: { mode: string | null; minTls: string | null; expiresAt: string | null; certStatus: string | null }, waf: number | null): CloudflareZone {
  const app = appsForZone(raw.name).find(a => a.dnsRecordName);
  const prd = app ? db.servers.find(s => s.id === app.prdServerId) : undefined;
  const dr = app ? db.servers.find(s => s.id === app.drServerId) : undefined;
  const failoverRecord = app?.dnsRecordName ? records.find(r => r.name === app.dnsRecordName && (r.type === 'A' || r.type === 'AAAA')) : undefined;
  const expectedIp = app ? (app.failoverState === 'DR_ACTIVE' ? dr?.ip : prd?.ip) : undefined;
  const drift = Boolean(failoverRecord && expectedIp && failoverRecord.content !== expectedIp);
  const missingRecord = Boolean(app?.dnsRecordName && !failoverRecord);

  const daysLeft = ssl.expiresAt ? (new Date(ssl.expiresAt).getTime() - Date.now()) / 86_400_000 : null;
  const sslStatus: CloudflareZone['sslStatus'] = ssl.mode === 'off'
    ? 'ERROR'
    : daysLeft === null ? (ssl.certStatus === 'active' ? 'ACTIVE' : 'UNKNOWN')
      : daysLeft < 0 ? 'ERROR' : daysLeft < 14 ? 'EXPIRING_SOON' : 'ACTIVE';

  const dnsRecords: CloudflareDnsRecord[] = records.map(r => ({
    id: r.id,
    type: r.type,
    name: r.name,
    target: r.content,
    proxied: Boolean(r.proxied),
    ttl: r.ttl,
    lastModified: r.modified_on ? new Date(r.modified_on).toLocaleString() : '—',
  }));

  return {
    id: raw.id,
    domain: raw.name,
    status: raw.status === 'active' ? (drift || missingRecord ? 'DEGRADED' : 'ACTIVE') : raw.status === 'pending' ? 'PENDING' : 'DEGRADED',
    plan: raw.plan?.name,
    nameServers: raw.name_servers,
    sslMode: ssl.mode ?? undefined,
    sslStatus,
    sslExpiresAt: ssl.expiresAt,
    tlsVersion: ssl.minTls ? `Min TLS ${ssl.minTls}` : 'Unknown',
    dnsRecords,
    loadBalancer: {
      poolName: app ? `DNS failover · ${app.dnsRecordName}` : 'No failover record configured',
      primaryOrigin: prd ? `${prd.ip} (${prd.hostname})` : '—',
      drOrigin: dr ? `${dr.ip} (${dr.hostname})` : '—',
      activeOrigin: failoverRecord ? `${failoverRecord.content}${failoverRecord.content === prd?.ip ? ' (PRD)' : failoverRecord.content === dr?.ip ? ' (DR)' : ''}` : (missingRecord ? `Record ${app?.dnsRecordName} not found` : '—'),
      healthCheckStatus: !app ? 'HEALTHY' : ((app.failoverState === 'DR_ACTIVE' ? dr : prd)?.status === 'CRITICAL' ? 'UNHEALTHY' : 'HEALTHY'),
      failoverPolicy: app?.autoFailover ? 'AUTOMATIC_WITH_CONFIRMATION' : 'MANUAL',
      lastReroutedAt: app?.lastFailoverAt,
    },
    wafEvents24h: waf,
    driftDetected: drift || missingRecord,
    driftDetails: missingRecord
      ? `Failover DNS record ${app?.dnsRecordName} does not exist in this zone.`
      : drift ? `${app?.dnsRecordName} points to ${failoverRecord?.content} but ${app?.name} is ${app?.failoverState} (expected ${expectedIp}).` : undefined,
    lastChecked: new Date().toISOString(),
  };
}

export async function syncCloudflare(): Promise<void> {
  if (!isCloudflareConfigured() || cfState.syncing) return;
  cfState.syncing = true;
  try {
    const zones = await cfAll<RawZone>('/zones', 50, 10);
    const built: CloudflareZone[] = [];
    for (const z of zones) {
      const records = await cfAll<RawRecord>(`/zones/${z.id}/dns_records`, 100, 5);
      cfState.rawRecords.set(z.id, records);
      const [sslSetting, tlsSetting, packs, waf] = await Promise.all([
        optional(() => cf<{ value: string }>(`/zones/${z.id}/settings/ssl`)),
        optional(() => cf<{ value: string }>(`/zones/${z.id}/settings/min_tls_version`)),
        optional(() => cf<Array<{ status: string; certificates?: Array<{ expires_on?: string }> }>>(`/zones/${z.id}/ssl/certificate_packs?status=all`)),
        optional(() => wafEvents24h(z.id)),
      ]);
      const active = packs?.result.find(p => p.status === 'active') ?? packs?.result[0];
      const expiries = (active?.certificates ?? []).map(c => c.expires_on).filter((d): d is string => Boolean(d)).sort();
      built.push(buildZone(z, records, {
        mode: sslSetting?.result.value ?? null,
        minTls: tlsSetting?.result.value ?? null,
        expiresAt: expiries[0] ? new Date(expiries[0]).toISOString() : null,
        certStatus: active?.status ?? null,
      }, waf));
    }
    cfState.zones = built;
    cfState.lastSyncAt = new Date().toISOString();
    cfState.lastError = null;
    broadcast('cloudflare_update', cfState.zones);
  } catch (err) {
    cfState.lastError = (err as Error).message;
    console.error(`[cloudflare] sync failed: ${cfState.lastError}`);
    throw err;
  } finally {
    cfState.syncing = false;
  }
}

/** Recomputes drift / active origin after app or server changes without calling the API. */
export function refreshZoneDerivedState() {
  // Cheap: only re-derive when we already have data; a full sync refreshes everything.
  if (cfState.zones.length === 0) return;
  void syncCloudflare().catch(() => {});
}

async function findZoneId(domain: string): Promise<string> {
  const cached = cfState.zones.find(z => domain === z.domain || domain.endsWith(`.${z.domain}`));
  if (cached) return cached.id;
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    const res = await cf<RawZone[]>(`/zones?name=${encodeURIComponent(candidate)}`);
    if (res.result[0]) return res.result[0].id;
  }
  throw new CloudflareError(`No Cloudflare zone found for ${domain} — check the domain and that the token has Zone:Read access`);
}

/**
 * Points every A/AAAA record named `recordName` at `targetIp`.
 * Returns the records that were changed. Throws if nothing could be updated.
 */
export async function switchDnsRecord(zoneDomain: string, recordName: string, targetIp: string): Promise<Array<{ id: string; from: string; to: string }>> {
  const zoneId = await findZoneId(zoneDomain);
  const type = targetIp.includes(':') ? 'AAAA' : 'A';
  const res = await cf<RawRecord[]>(`/zones/${zoneId}/dns_records?type=${type}&name=${encodeURIComponent(recordName)}`);
  if (res.result.length === 0) throw new CloudflareError(`DNS ${type} record ${recordName} not found in zone ${zoneDomain}`);
  const changed: Array<{ id: string; from: string; to: string }> = [];
  for (const rec of res.result) {
    if (rec.content === targetIp) continue;
    await cf<RawRecord>(`/zones/${zoneId}/dns_records/${rec.id}`, { method: 'PATCH', body: JSON.stringify({ content: targetIp }) });
    changed.push({ id: rec.id, from: rec.content, to: targetIp });
  }
  void syncCloudflare().catch(() => {});
  return changed;
}

/** Reads the IP the failover record currently points at (null if not resolvable). */
export async function currentRecordTarget(zoneDomain: string, recordName: string): Promise<string | null> {
  try {
    const zoneId = await findZoneId(zoneDomain);
    const res = await cf<RawRecord[]>(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(recordName)}`);
    return res.result.find(r => r.type === 'A' || r.type === 'AAAA')?.content ?? null;
  } catch {
    return null;
  }
}
