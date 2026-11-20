/**
 * Dependency register: components the business runs on and "A depends on B" links between them.
 * Builders validate a request body against the current store and return the record to save;
 * they never mutate `db` themselves.
 */
import crypto from 'crypto';
import type { RegistryComponent, RegistryKind, DependencyLink, DependencyMethod, DependencyCriticality, RegistryImpact } from '../src/types/index.ts';
import { db } from './store.ts';
import { ValidationError, reqStr, optStr, oneOf, optOneOf } from './validate.ts';
import { registryNameKey } from './registryName.ts';
import { dependencyFeatureAllowed } from '../src/lib/serviceDependencies.ts';

export const REGISTRY_KINDS = ['APPLICATION', 'SERVER', 'DATABASE', 'STORAGE', 'THIRD_PARTY_API', 'PROVIDER', 'BUSINESS_FEATURE'] as const satisfies readonly RegistryKind[];
export const REGISTRY_TIERS = ['TIER_1', 'TIER_2', 'TIER_3'] as const;
export const LINK_TYPES = ['HARD', 'SOFT'] as const;
/** How a consumer reaches a provider. Empty is allowed and stored as null. */
export const LINK_METHODS = ['HTTP', 'API', 'DATABASE', 'EMBED', 'LINK', 'OTHER'] as const satisfies readonly DependencyMethod[];
export const LINK_CRITICALITY = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const satisfies readonly DependencyCriticality[];
/** Kinds that serve people directly, so they carry a user count and the teams/customers served */
export const AUDIENCE_KINDS: readonly RegistryKind[] = ['APPLICATION', 'BUSINESS_FEATURE'];

/** Duplicate entries; answered with 409 */
export class RegistryConflict extends Error {}

type Obj = Record<string, unknown>;
const MAX_USERS = 1_000_000_000;

/** Dependency and register writes accept one JSON object. An array or a bare value is refused. */
function objectBody(req: { body?: unknown }): Obj {
  const value = req.body;
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('Request body must be a JSON object');
  return value as Obj;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PostgreSQL stores uuids in lowercase. A client may send the same id in either case.
 * Anything that is not a uuid is returned trimmed, so a code name is not rewritten.
 */
export function canonicalUuid(value: string): string {
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

/** undefined = not sent (keep), null or blank = clear, otherwise the id */
function optRef(o: Obj, key: string, label: string): string | null | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') throw new ValidationError(`${label} must be an id`);
  const trimmed = v.trim();
  if (!trimmed) return null;
  return canonicalUuid(trimmed);
}

function userCountOf(o: Obj): number | null | undefined {
  const v = o.userCount;
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < 0 || n > MAX_USERS) throw new ValidationError(`User count must be a whole number between 0 and ${MAX_USERS}`);
  return n;
}

function servedOf(o: Obj): string[] | undefined {
  const v = o.served;
  if (v === undefined) return undefined;
  if (v === null) return [];
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw new ValidationError('Teams or customers served must be a list of names');
  const out: string[] = [];
  for (const raw of v as string[]) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length > 100) throw new ValidationError('Each team or customer name must be at most 100 characters');
    if (!out.some(x => x.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  if (out.length > 50) throw new ValidationError('At most 50 teams or customers can be listed');
  return out;
}

export function buildComponent(req: { body?: unknown }, existing?: RegistryComponent): RegistryComponent {
  const b = objectBody(req);
  const kind = existing ? existing.kind : oneOf(b, 'kind', 'Kind', REGISTRY_KINDS);
  if (existing && b.kind !== undefined && b.kind !== existing.kind) throw new ValidationError('Kind cannot be changed; delete the entry and register it again');

  const name = existing ? (optStr(b, 'name', 'Name', 200) ?? existing.name) : reqStr(b, 'name', 'Name', 200);
  const owner = existing ? (optStr(b, 'owner', 'Owner', 200) ?? existing.owner) : reqStr(b, 'owner', 'Owner', 200);
  if (!name) throw new ValidationError('Name is required');
  if (!owner) throw new ValidationError('Owner is required');
  const tier = existing ? (optOneOf(b, 'tier', 'Tier', REGISTRY_TIERS) ?? existing.tier) : oneOf(b, 'tier', 'Tier', REGISTRY_TIERS);
  const description = b.description !== undefined ? (optStr(b, 'description', 'Description', 2000) ?? '') : existing?.description ?? '';
  const endpoint = keptText(b, 'endpoint', 'Config', 500, existing?.endpoint ?? '');

  const audience = AUDIENCE_KINDS.includes(kind);
  const sentApp = optRef(b, 'applicationId', 'Application');
  const sentServer = optRef(b, 'serverId', 'Server');
  const sentUsers = userCountOf(b);
  const sentServed = servedOf(b);
  if (!audience && sentApp) throw new ValidationError('Only applications and business features can be linked to a registered application');
  if (kind !== 'SERVER' && sentServer) throw new ValidationError('Only servers can be linked to a registered VPS server');
  if (!audience && sentUsers !== undefined && sentUsers !== null) throw new ValidationError('User counts are recorded for applications and business features only');
  if (!audience && sentServed && sentServed.length > 0) throw new ValidationError('Teams or customers served are recorded for applications and business features only');

  const applicationId = sentApp !== undefined ? sentApp : existing?.applicationId ?? null;
  const serverId = sentServer !== undefined ? sentServer : existing?.serverId ?? null;
  if (applicationId && !db.applications.some(a => a.id === applicationId)) {
    if (db.servers.some(s => s.id === applicationId)) throw new ValidationError('That id is a server. Choose an application record.');
    if (db.registry.some(c => c.id === applicationId)) throw new ValidationError('That id is a register entry. Choose an application record.');
    if (db.dependencyLinks.some(l => l.id === applicationId)) throw new ValidationError('That id is a dependency link. Choose an application record.');
    throw new ValidationError('Application not found');
  }
  if (serverId && !db.servers.some(s => s.id === serverId)) throw new ValidationError('Server not found');

  const id = existing?.id ?? crypto.randomUUID();
  const others = db.registry.filter(c => c.id !== id);
  if (others.some(c => c.kind === kind && registryNameKey(c.name) === registryNameKey(name))) throw new RegistryConflict(`A ${kindLabel(kind)} named "${name}" is already registered`);
  if (kind === 'APPLICATION' && applicationId && others.some(c => c.kind === 'APPLICATION' && c.applicationId === applicationId)) throw new RegistryConflict('That application is already in the register');
  if (kind === 'SERVER' && serverId && others.some(c => c.kind === 'SERVER' && c.serverId === serverId)) throw new RegistryConflict('That server is already in the register');

  const now = new Date().toISOString();
  return {
    id, kind, name, owner, tier, description,
    applicationId: audience ? applicationId : null,
    serverId: kind === 'SERVER' ? serverId : null,
    userCount: audience ? (sentUsers !== undefined ? sentUsers : existing?.userCount ?? null) : null,
    served: audience ? (sentServed ?? existing?.served ?? []) : [],
    endpoint,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

/** Consumer and provider are register entries. An application id or a server id is not an entry. */
function linkEnd(id: string, role: 'consumer' | 'provider'): RegistryComponent {
  const component = db.registry.find(c => c.id === id);
  if (component) {
    if (component.kind === 'APPLICATION' && component.applicationId && !db.applications.some(a => a.id === component.applicationId)) {
      throw new ValidationError(`The ${role} application is no longer registered`);
    }
    if (component.kind === 'SERVER' && component.serverId && !db.servers.some(s => s.id === component.serverId)) {
      throw new ValidationError(`The ${role} server is no longer registered`);
    }
    return component;
  }
  if (db.applications.some(a => a.id === id)) {
    throw new ValidationError(`That id is an application. Choose the application's register entry as the ${role}.`);
  }
  if (db.servers.some(s => s.id === id)) {
    throw new ValidationError(`That id is a server. Choose the server's register entry as the ${role}. Hosting is recorded on the application, not as a dependency.`);
  }
  throw new ValidationError(role === 'consumer' ? 'The dependent component (A) is not in the register' : 'The dependency (B) is not in the register');
}

export function buildLink(req: { body?: unknown }, existing?: DependencyLink): DependencyLink {
  const b = objectBody(req);
  if (Object.prototype.hasOwnProperty.call(b, 'applicationId')) {
    throw new ValidationError('A dependency does not take an application id. Choose the consumer and provider register entries.');
  }
  // A present but blank end is rejected. Omitting the field keeps the stored end.
  const sentFrom = optRef(b, 'fromId', 'Dependent');
  const sentTo = optRef(b, 'toId', 'Dependency');
  if (sentFrom === null) throw new ValidationError('Choose what depends on something (A)');
  if (sentTo === null) throw new ValidationError('Choose what it depends on (B)');
  const fromId = sentFrom ?? existing?.fromId;
  const toId = sentTo ?? existing?.toId;
  if (!fromId) throw new ValidationError('Choose what depends on something (A)');
  if (!toId) throw new ValidationError('Choose what it depends on (B)');
  const from = linkEnd(fromId, 'consumer');
  const to = linkEnd(toId, 'provider');
  if (fromId === toId) throw new ValidationError('A component cannot depend on itself');
  rejectOwnHosting(from, to);

  const type = existing ? (optOneOf(b, 'type', 'Type', LINK_TYPES) ?? existing.type) : oneOf(b, 'type', 'Type', LINK_TYPES);
  const sentFeature = optRef(b, 'featureId', 'Feature');
  const featureId = sentFeature !== undefined ? sentFeature : existing?.featureId ?? null;
  if (featureId) {
    const f = db.registry.find(c => c.id === featureId);
    if (!f) {
      if (db.applications.some(a => a.id === featureId)) throw new ValidationError('That id is an application. Choose a business feature from the register.');
      if (db.servers.some(s => s.id === featureId)) throw new ValidationError('That id is a server. Choose a business feature from the register.');
      throw new ValidationError('Feature not found');
    }
    if (f.kind !== 'BUSINESS_FEATURE') throw new ValidationError('The feature that needs this dependency must be a business feature');
    if (f.applicationId && !db.applications.some(a => a.id === f.applicationId)) throw new ValidationError('The feature application is no longer registered');
    // A named feature belongs to one application. Both ends unbound is a register-only link.
    if (!dependencyFeatureAllowed(f, from)) {
      throw new ValidationError('The feature must belong to the consumer application');
    }
    // The named feature always stops when B is down, so naming A (or B) itself would contradict the link type
    if (featureId === fromId) throw new ValidationError('The feature that needs it cannot be A itself; set the type to Hard instead');
    if (featureId === toId) throw new ValidationError('The feature that needs it cannot be B itself');
  }
  const notes = keptText(b, 'notes', 'Notes', 500, existing?.notes ?? '');
  const method = methodOf(b, existing);
  const criticality = criticalityOf(b, existing);
  const healthCheck = keptText(b, 'healthCheck', 'Health check', 500, existing?.healthCheck ?? '');
  const failureBehaviour = keptText(b, 'failureBehaviour', 'Failure behaviour', 500, existing?.failureBehaviour ?? '');
  const owner = keptText(b, 'owner', 'Owner', 200, existing?.owner ?? '');
  const recoveryExpectation = keptText(b, 'recoveryExpectation', 'Recovery expectation', 500, existing?.recoveryExpectation ?? '');

  const id = existing?.id ?? crypto.randomUUID();
  if (db.dependencyLinks.some(l => l.id !== id && l.fromId === fromId && l.toId === toId && (l.featureId ?? null) === featureId)) {
    throw new RegistryConflict(`"${from.name}" already depends on "${to.name}"${featureId ? ' for that feature' : ''}`);
  }
  const now = new Date().toISOString();
  return {
    id, fromId, toId, type, featureId, method, criticality, healthCheck, failureBehaviour, owner, recoveryExpectation, notes,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
}

/** The application's own PRD or DR server is hosting. It is not a service dependency. */
function rejectOwnHosting(from: RegistryComponent, to: RegistryComponent) {
  const consumerAppId = (from.kind === 'APPLICATION' || from.kind === 'BUSINESS_FEATURE') ? from.applicationId : null;
  if (!consumerAppId || to.kind !== 'SERVER' || !to.serverId) return;
  const app = db.applications.find(a => a.id === consumerAppId);
  if (!app) return;
  if (to.serverId !== app.prdServerId && to.serverId !== app.drServerId) return;
  const which = to.serverId === app.prdServerId ? 'production' : 'recovery';
  throw new ValidationError(`Hosting is recorded on the application. ${app.name} already runs on this ${which} server, so it is not a dependency.`);
}

/**
 * The APPLICATION register row keeps the application record's name and tier.
 * Owner and description stay as the register editor left them.
 * Returns the row when it changed. A name already used by another application entry is 409.
 */
export function syncBoundApplication(
  app: { id: string; name: string; tier: RegistryComponent['tier'] },
  before: { name: string; tier: string },
): RegistryComponent | null {
  if (before.name === app.name && before.tier === app.tier) return null;
  const component = db.registry.find(c => c.kind === 'APPLICATION' && c.applicationId === app.id);
  if (!component) return null;
  if (before.name !== app.name) {
    const key = registryNameKey(app.name);
    if (db.registry.some(c => c.id !== component.id && c.kind === 'APPLICATION' && registryNameKey(c.name) === key)) {
      throw new RegistryConflict(`An application named "${app.name}" is already in the register`);
    }
    component.name = app.name;
  }
  if (before.tier !== app.tier) component.tier = app.tier;
  component.updatedAt = new Date().toISOString();
  return component;
}

/** undefined means "not sent" (keep). null or '' clears. Anything else must be an approved method. */
function methodOf(b: Record<string, unknown>, existing?: DependencyLink): DependencyMethod | null {
  if (!Object.prototype.hasOwnProperty.call(b, 'method')) return existing?.method ?? null;
  const v = b.method;
  if (v === null || v === '') return null;
  if (typeof v !== 'string') throw new ValidationError(`Method must be one of: ${LINK_METHODS.join(', ')}, or empty`);
  const method = v.trim();
  if (!method) return null;
  if (!(LINK_METHODS as readonly string[]).includes(method)) {
    throw new ValidationError(`Method must be one of: ${LINK_METHODS.join(', ')}, or empty`);
  }
  return method as DependencyMethod;
}

/** undefined means "not sent" (keep). null or '' clears. */
function criticalityOf(b: Obj, existing?: DependencyLink): DependencyCriticality | null {
  if (!Object.prototype.hasOwnProperty.call(b, 'criticality')) return existing?.criticality ?? null;
  const v = b.criticality;
  if (v === null || v === '') return null;
  if (typeof v !== 'string') throw new ValidationError(`Criticality must be one of: ${LINK_CRITICALITY.join(', ')}, or empty`);
  const criticality = v.trim();
  if (!criticality) return null;
  if (!(LINK_CRITICALITY as readonly string[]).includes(criticality)) {
    throw new ValidationError(`Criticality must be one of: ${LINK_CRITICALITY.join(', ')}, or empty`);
  }
  return criticality as DependencyCriticality;
}

/** Text that may name a host, URL, or bucket, and must not carry a password or token. */
function keptText(b: Obj, key: string, label: string, max: number, current: string): string {
  return rejectSecret(plainText(b, key, label, max, current), label);
}

function plainText(b: Obj, key: string, label: string, max: number, current: string): string {
  if (!Object.prototype.hasOwnProperty.call(b, key)) return current;
  return optStr(b, key, label, max) ?? '';
}

function rejectSecret(value: string, label: string): string {
  if (/(password|passwd|secret|api[_-]?key|token)\s*[:=]/i.test(value) || /:\/\/[^/\s]+:[^/\s]+@/.test(value)) {
    throw new ValidationError(`${label} must not include a password or token. Record the host, URL, or bucket only.`);
  }
  return value;
}

/** Removes a component with its links; links that named it as their feature keep existing without one */
export function removeComponent(id: string): RegistryComponent | null {
  const c = db.registry.find(x => x.id === id);
  if (!c) return null;
  db.registry = db.registry.filter(x => x.id !== id);
  db.dependencyLinks = db.dependencyLinks.filter(l => l.fromId !== id && l.toId !== id);
  for (const l of db.dependencyLinks) if (l.featureId === id) l.featureId = null;
  dedupeLinks();
  return c;
}

/** Clearing a feature can make two links identical; keep the oldest */
function dedupeLinks() {
  const seen = new Set<string>();
  db.dependencyLinks = db.dependencyLinks.filter(l => {
    const k = `${l.fromId}|${l.toId}|${l.featureId ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A registered application or server was deleted: register entries stay, their link to it is cleared */
export function forgetRegistryReferences(ref: { applicationId?: string; serverId?: string }) {
  for (const c of db.registry) {
    if (ref.applicationId && c.applicationId === ref.applicationId) c.applicationId = null;
    if (ref.serverId && c.serverId === ref.serverId) c.serverId = null;
  }
}

/**
 * How a failure travels. Each edge says: when `from` is down, `to` is affected.
 *   - Link "A depends on B" with no feature: B → A, hard only if the link is HARD.
 *   - HARD link that names feature F:        B → A hard, and B → F hard. The project stops.
 *   - SOFT link that names feature F:        B → F hard only. That feature stops. The project does not.
 *   - Feature F provided by application P    P → F, hard: F inherits P's state. P is the APPLICATION
 *     (both point at the same application):  entry with the same applicationId as F.
 * An item STOPS (HARD) when some path from the failed component to it uses hard edges only;
 * it is DEGRADED (SOFT) when it is reachable but every path contains a soft edge.
 */
function failureEdges(): Array<{ from: string; to: string; hard: boolean }> {
  const edges: Array<{ from: string; to: string; hard: boolean }> = [];
  for (const l of db.dependencyLinks) {
    if (l.type === 'SOFT' && l.featureId) {
      edges.push({ from: l.toId, to: l.featureId, hard: true });
      continue;
    }
    edges.push({ from: l.toId, to: l.fromId, hard: l.type === 'HARD' });
    if (l.featureId) edges.push({ from: l.toId, to: l.featureId, hard: true });
  }
  const providerOf = new Map(db.registry.filter(c => c.kind === 'APPLICATION' && c.applicationId).map(c => [c.applicationId!, c.id]));
  for (const f of db.registry) {
    const provider = f.kind === 'BUSINESS_FEATURE' && f.applicationId ? providerOf.get(f.applicationId) : undefined;
    if (provider) edges.push({ from: provider, to: f.id, hard: true });
  }
  return edges;
}

/** Breadth-first from `root` over the edges allowed; nearest first */
function reach(root: string, edges: ReturnType<typeof failureEdges>, hardOnly: boolean): string[] {
  const seen = new Set<string>([root]);
  const order: string[] = [];
  const queue = [root];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of edges) {
      if (e.from !== cur || (hardOnly && !e.hard) || seen.has(e.to)) continue;
      seen.add(e.to); order.push(e.to); queue.push(e.to);
    }
  }
  return order;
}

/** Who is affected when `id` fails (rules: failureEdges) */
export function registryImpact(id: string): RegistryImpact | null {
  const root = db.registry.find(c => c.id === id);
  if (!root) return null;
  const byId = new Map(db.registry.map(c => [c.id, c]));
  const edges = failureEdges().filter(e => byId.has(e.from) && byId.has(e.to));
  const stops = new Set(reach(id, edges, true));
  const affected = reach(id, edges, false).map(cid => {
    const c = byId.get(cid)!;
    return { id: c.id, name: c.name, kind: c.kind, tier: c.tier, via: stops.has(cid) ? 'HARD' as const : 'SOFT' as const, userCount: c.userCount, served: c.served };
  });
  const everyone = [root, ...affected.map(a => byId.get(a.id)!)];
  const stopped = [root, ...affected.filter(a => a.via === 'HARD').map(a => byId.get(a.id)!)];
  const served: string[] = [];
  for (const c of everyone) for (const s of c.served) if (!served.some(x => x.toLowerCase() === s.toLowerCase())) served.push(s);
  const largest = (list: RegistryComponent[]) => {
    const counts = list.map(c => c.userCount).filter((n): n is number => n !== null);
    return counts.length ? Math.max(...counts) : null;
  };
  return { componentId: id, affected, largestUserCountStopped: largest(stopped), largestUserCountAffected: largest(everyone), served };
}

export function kindLabel(kind: RegistryKind): string {
  return ({
    APPLICATION: 'application', SERVER: 'server', DATABASE: 'database', STORAGE: 'storage', THIRD_PARTY_API: 'third-party API', PROVIDER: 'provider', BUSINESS_FEATURE: 'business feature',
  } as const)[kind];
}
