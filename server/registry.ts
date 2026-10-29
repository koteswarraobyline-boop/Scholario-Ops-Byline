/**
 * Dependency register: components the business runs on and "A depends on B" links between them.
 * Builders validate a request body against the current store and return the record to save;
 * they never mutate `db` themselves.
 */
import crypto from 'crypto';
import type { RegistryComponent, RegistryKind, DependencyLink, RegistryImpact } from '../src/types/index.ts';
import { db } from './store.ts';
import { ValidationError, body, reqStr, optStr, oneOf, optOneOf } from './validate.ts';
import { registryNameKey } from './registryName.ts';

export const REGISTRY_KINDS = ['APPLICATION', 'SERVER', 'DATABASE', 'STORAGE', 'THIRD_PARTY_API', 'PROVIDER', 'BUSINESS_FEATURE'] as const satisfies readonly RegistryKind[];
export const REGISTRY_TIERS = ['TIER_1', 'TIER_2', 'TIER_3'] as const;
export const LINK_TYPES = ['HARD', 'SOFT'] as const;
/** Kinds that serve people directly, so they carry a user count and the teams/customers served */
export const AUDIENCE_KINDS: readonly RegistryKind[] = ['APPLICATION', 'BUSINESS_FEATURE'];

/** Duplicate entries; answered with 409 */
export class RegistryConflict extends Error {}

type Obj = Record<string, unknown>;
const MAX_USERS = 1_000_000_000;

/** undefined = not sent (keep), null = clear, otherwise the trimmed id */
function optRef(o: Obj, key: string, label: string): string | null | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string') throw new ValidationError(`${label} must be an id`);
  return v.trim();
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
  const b = body(req);
  const kind = existing ? existing.kind : oneOf(b, 'kind', 'Kind', REGISTRY_KINDS);
  if (existing && b.kind !== undefined && b.kind !== existing.kind) throw new ValidationError('Kind cannot be changed; delete the entry and register it again');

  const name = existing ? (optStr(b, 'name', 'Name', 200) ?? existing.name) : reqStr(b, 'name', 'Name', 200);
  const owner = existing ? (optStr(b, 'owner', 'Owner', 200) ?? existing.owner) : reqStr(b, 'owner', 'Owner', 200);
  if (!name) throw new ValidationError('Name is required');
  if (!owner) throw new ValidationError('Owner is required');
  const tier = existing ? (optOneOf(b, 'tier', 'Tier', REGISTRY_TIERS) ?? existing.tier) : oneOf(b, 'tier', 'Tier', REGISTRY_TIERS);
  const description = b.description !== undefined ? (optStr(b, 'description', 'Description', 2000) ?? '') : existing?.description ?? '';

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
  if (applicationId && !db.applications.some(a => a.id === applicationId)) throw new ValidationError('Application not found');
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
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function buildLink(req: { body?: unknown }, existing?: DependencyLink): DependencyLink {
  const b = body(req);
  const fromId = existing ? (optRef(b, 'fromId', 'Dependent') ?? existing.fromId) : optRef(b, 'fromId', 'Dependent');
  const toId = existing ? (optRef(b, 'toId', 'Dependency') ?? existing.toId) : optRef(b, 'toId', 'Dependency');
  if (!fromId) throw new ValidationError('Choose what depends on something (A)');
  if (!toId) throw new ValidationError('Choose what it depends on (B)');
  const from = db.registry.find(c => c.id === fromId);
  const to = db.registry.find(c => c.id === toId);
  if (!from) throw new ValidationError('The dependent component (A) is not in the register');
  if (!to) throw new ValidationError('The dependency (B) is not in the register');
  if (fromId === toId) throw new ValidationError('A component cannot depend on itself');

  const type = existing ? (optOneOf(b, 'type', 'Type', LINK_TYPES) ?? existing.type) : oneOf(b, 'type', 'Type', LINK_TYPES);
  const sentFeature = optRef(b, 'featureId', 'Feature');
  const featureId = sentFeature !== undefined ? sentFeature : existing?.featureId ?? null;
  if (featureId) {
    const f = db.registry.find(c => c.id === featureId);
    if (!f) throw new ValidationError('Feature not found');
    if (f.kind !== 'BUSINESS_FEATURE') throw new ValidationError('The feature that needs this dependency must be a business feature');
    // The named feature always stops when B is down, so naming A (or B) itself would contradict the link type
    if (featureId === fromId) throw new ValidationError('The feature that needs it cannot be A itself; set the type to Hard instead');
    if (featureId === toId) throw new ValidationError('The feature that needs it cannot be B itself');
  }
  const notes = b.notes !== undefined ? (optStr(b, 'notes', 'Notes', 500) ?? '') : existing?.notes ?? '';

  const id = existing?.id ?? crypto.randomUUID();
  if (db.dependencyLinks.some(l => l.id !== id && l.fromId === fromId && l.toId === toId && (l.featureId ?? null) === featureId)) {
    throw new RegistryConflict(`"${from.name}" already depends on "${to.name}"${featureId ? ' for that feature' : ''}`);
  }
  return { id, fromId, toId, type, featureId, notes, createdAt: existing?.createdAt ?? new Date().toISOString() };
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
 *   - Link "A depends on B" (type T):        B → A, hard only if T is HARD.
 *   - Feature F named on that link:          B → F, always hard: F needs B, so F stops whenever
 *                                            B is unavailable (whatever T says about the rest of A).
 *   - Feature F provided by application P    P → F, hard: F inherits P's state. P is the APPLICATION
 *     (both point at the same application):  entry with the same applicationId as F.
 * An item STOPS (HARD) when some path from the failed component to it uses hard edges only;
 * it is DEGRADED (SOFT) when it is reachable but every path contains a soft edge.
 */
function failureEdges(): Array<{ from: string; to: string; hard: boolean }> {
  const edges: Array<{ from: string; to: string; hard: boolean }> = [];
  for (const l of db.dependencyLinks) {
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
