/**
 * Traffic-routing configuration. Switching the method keeps every other blob.
 * Secrets are refused: tokens stay in server environment variables.
 */
import { AppLoadBalancerMapping, TrafficRoutingConfig, TrafficRoutingMethod, WorkerRoutingConfig } from '../src/types/index.ts';
import { blankRouting, normalizeRouting, ROUTING_METHODS } from '../src/lib/trafficHealth.ts';
import { ValidationError, optStr, optDate, isHostname } from './validate.ts';

const SECRET_KEY = /pass(word)?|secret|token|authorization|api[-_]?key|credential/i;
const HEX32 = /^[0-9a-f]{32}$/;

function assertNoSecrets(value: unknown, path: string): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoSecrets(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(k)) throw new ValidationError(`Traffic routing cannot store "${k}". API tokens stay in server environment variables.`);
    assertNoSecrets(v, `${path}.${k}`);
  }
}

function text(o: Record<string, unknown>, key: string, label: string, max: number, prev: string): string {
  if (o[key] === undefined) return prev;
  return optStr(o, key, label, max) ?? '';
}

function host(value: string, label: string): string {
  const v = value.trim().toLowerCase();
  if (v && !isHostname(v)) throw new ValidationError(`${label} must be a hostname, for example app.example.com`);
  return v;
}

function url(value: string, label: string): string {
  const v = value.trim();
  if (!v) return '';
  let u: URL;
  try { u = new URL(v); } catch { throw new ValidationError(`${label} must be a full http(s) URL`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ValidationError(`${label} must start with https:// or http://`);
  return u.toString();
}

function mergeWorker(prev: WorkerRoutingConfig, raw: unknown): WorkerRoutingConfig {
  if (raw === undefined) return prev;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('Worker routing configuration must be an object');
  const o = raw as Record<string, unknown>;
  const accountId = text(o, 'accountId', 'Worker account ID', 64, prev.accountId).toLowerCase();
  if (accountId && !HEX32.test(accountId)) throw new ValidationError('Worker Cloudflare account ID must be the 32-character hex account ID, or left empty');
  const name = text(o, 'name', 'Worker name', 64, prev.name);
  if (name && !/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new ValidationError('Worker name may contain only letters, numbers, dashes and underscores');
  const failbackRaw = o.failback === undefined ? prev.failback : String(o.failback || 'unknown');
  if (!['automatic', 'manual', 'unknown'].includes(failbackRaw)) throw new ValidationError('Worker failback must be automatic, manual, or unknown');
  return {
    name,
    route: text(o, 'route', 'Worker route', 253, prev.route),
    accountId,
    environment: text(o, 'environment', 'Worker environment', 64, prev.environment),
    prdOriginHostname: host(text(o, 'prdOriginHostname', 'PRD origin hostname', 253, prev.prdOriginHostname), 'PRD origin hostname'),
    drOriginHostname: host(text(o, 'drOriginHostname', 'DR origin hostname', 253, prev.drOriginHostname), 'DR origin hostname'),
    failoverStrategy: text(o, 'failoverStrategy', 'Failover decision strategy', 300, prev.failoverStrategy),
    healthCheckSource: text(o, 'healthCheckSource', 'Health-check source', 300, prev.healthCheckSource),
    failback: failbackRaw as WorkerRoutingConfig['failback'],
  };
}

/** Merge an incoming routing body onto the saved one. Omitted sections are kept. */
export function parseRoutingUpdate(existing: TrafficRoutingConfig | undefined, raw: unknown): TrafficRoutingConfig {
  const prev = existing ? normalizeRouting({ trafficRouting: existing }) : blankRouting('unknown');
  if (raw === undefined) return prev;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('Traffic routing configuration must be an object');
  assertNoSecrets(raw, 'trafficRouting');
  const o = raw as Record<string, unknown>;
  const method = (o.method === undefined ? prev.method : String(o.method)) as TrafficRoutingMethod;
  if (!ROUTING_METHODS.includes(method)) throw new ValidationError(`Traffic routing method must be one of: ${ROUTING_METHODS.join(', ')}`);
  const directRaw = o.direct;
  let direct = prev.direct;
  if (directRaw !== undefined) {
    if (!directRaw || typeof directRaw !== 'object' || Array.isArray(directRaw)) throw new ValidationError('Direct routing configuration must be an object');
    const d = directRaw as Record<string, unknown>;
    const manual = d.manualFailoverStatus === undefined ? direct.manualFailoverStatus : String(d.manualFailoverStatus || 'UNKNOWN');
    if (!['UNKNOWN', 'PRIMARY', 'DR'].includes(manual)) throw new ValidationError('Manual failover status must be UNKNOWN, PRIMARY, or DR');
    direct = {
      prdHostname: host(text(d, 'prdHostname', 'PRD hostname', 253, direct.prdHostname), 'PRD hostname'),
      drHostname: host(text(d, 'drHostname', 'DR hostname', 253, direct.drHostname), 'DR hostname'),
      prdUrl: url(text(d, 'prdUrl', 'PRD URL', 2000, direct.prdUrl), 'PRD URL'),
      drUrl: url(text(d, 'drUrl', 'DR URL', 2000, direct.drUrl), 'DR URL'),
      dnsRecordName: host(text(d, 'dnsRecordName', 'DNS record name', 253, direct.dnsRecordName), 'DNS record name'),
      currentTarget: text(d, 'currentTarget', 'Current routing target', 253, direct.currentTarget),
      manualFailoverStatus: manual as TrafficRoutingConfig['direct']['manualFailoverStatus'],
      lastVerifiedAt: d.lastVerifiedAt === undefined ? direct.lastVerifiedAt : (d.lastVerifiedAt === null || d.lastVerifiedAt === '' ? null : optDate(d, 'lastVerifiedAt', 'Last verified') ?? null),
    };
  }
  const customRaw = o.custom;
  let custom = prev.custom;
  if (customRaw !== undefined) {
    if (!customRaw || typeof customRaw !== 'object' || Array.isArray(customRaw)) throw new ValidationError('Custom routing configuration must be an object');
    const c = customRaw as Record<string, unknown>;
    custom = {
      description: text(c, 'description', 'Routing description', 1000, custom.description),
      endpoint: text(c, 'endpoint', 'Routing endpoint', 500, custom.endpoint),
      notes: text(c, 'notes', 'Monitoring notes', 2000, custom.notes),
    };
  }
  return { method, direct, worker: mergeWorker(prev.worker, o.worker), custom };
}
