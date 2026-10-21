import React, { useMemo, useState } from 'react';
import { Network, Plus, Pencil, Trash2, X, Zap } from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Application, DependencyLink, RegistryComponent, RegistryImpact, RegistryKind, VpsServer } from '../../types';

const KINDS: Array<{ id: RegistryKind; label: string }> = [
  { id: 'APPLICATION', label: 'Application' },
  { id: 'BUSINESS_FEATURE', label: 'Business feature' },
  { id: 'SERVER', label: 'Server' },
  { id: 'DATABASE', label: 'Database' },
  { id: 'STORAGE', label: 'Storage' },
  { id: 'THIRD_PARTY_API', label: 'Third-party API' },
  { id: 'PROVIDER', label: 'Provider' },
];
const kindLabel = (k: RegistryKind) => KINDS.find(x => x.id === k)?.label ?? k;
const TIERS: RegistryComponent['tier'][] = ['TIER_1', 'TIER_2', 'TIER_3'];
const tierLabel = (t: string) => t.replace('TIER_', 'Tier ');
const hasAudience = (k: RegistryKind) => k === 'APPLICATION' || k === 'BUSINESS_FEATURE';

const useStyles = () => {
  const { theme } = useOps();
  const isDark = theme === 'dark';
  return {
    isDark,
    card: `rounded-lg border p-4 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`,
    muted: isDark ? 'text-slate-400' : 'text-slate-600',
    faint: isDark ? 'text-slate-500' : 'text-slate-400',
    row: isDark ? 'border-[#1E293B]' : 'border-slate-200',
    input: `w-full px-2.5 py-1.5 rounded border text-xs font-mono outline-none focus:ring-1 focus:ring-blue-500 ${
      isDark ? 'bg-[#0B0F17] border-[#1E293B] text-slate-100 placeholder:text-slate-600' : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400'
    }`,
    btn: 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    ghost: isDark ? 'bg-[#162033] hover:bg-[#1D2B44] text-slate-200 border border-[#23334E]' : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300',
    danger: isDark ? 'bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-900' : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300',
  };
};

const Field: React.FC<{ text: string; hint?: string; className?: string; children: React.ReactNode }> = ({ text, hint, className, children }) => {
  const st = useStyles();
  return (
    <label className={`block space-y-1 min-w-0 ${className ?? ''}`}>
      <span className="text-[11px] font-mono font-semibold">{text}</span>
      {children}
      {hint && <span className={`block text-[10px] ${st.faint}`}>{hint}</span>}
    </label>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const ComponentEditor: React.FC<{ initial?: RegistryComponent; onDone: () => void }> = ({ initial, onDone }) => {
  const st = useStyles();
  const { applications, servers, saveRegistryComponent } = useOps();
  const [kind, setKind] = useState<RegistryKind>(initial?.kind ?? 'APPLICATION');
  const [name, setName] = useState(initial?.name ?? '');
  const [owner, setOwner] = useState(initial?.owner ?? '');
  const [tier, setTier] = useState<RegistryComponent['tier']>(initial?.tier ?? 'TIER_2');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [applicationId, setApplicationId] = useState(initial?.applicationId ?? '');
  const [serverId, setServerId] = useState(initial?.serverId ?? '');
  const [userCount, setUserCount] = useState(initial?.userCount != null ? String(initial.userCount) : '');
  const [served, setServed] = useState((initial?.served ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const audience = hasAudience(kind);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const data: Partial<RegistryComponent> = {
      name, owner, tier, description,
      applicationId: audience ? applicationId || null : null,
      serverId: kind === 'SERVER' ? serverId || null : null,
      userCount: audience && userCount.trim() !== '' ? Number(userCount) : null,
      served: audience ? served.split(',').map(s => s.trim()).filter(Boolean) : [],
    };
    if (!initial) data.kind = kind;
    const saved = await saveRegistryComponent(initial?.id ?? null, data);
    setBusy(false);
    if (saved) onDone();
  };

  return (
    <form onSubmit={submit} className={`${st.card} space-y-3`} aria-label={initial ? `Edit ${initial.name}` : 'New register entry'}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold font-mono">{initial ? `EDIT ${initial.name.toUpperCase()}` : 'NEW REGISTER ENTRY'}</h3>
        <button type="button" onClick={onDone} aria-label="Close register entry editor" className={`${st.btn} ${st.ghost} !px-2`}><X className="w-3.5 h-3.5" /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field text="Kind" hint={initial ? 'Cannot be changed after registering' : undefined}>
          <select value={kind} onChange={e => setKind(e.target.value as RegistryKind)} disabled={Boolean(initial)} className={st.input}>
            {KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </Field>
        <Field text="Name"><input value={name} onChange={e => setName(e.target.value)} required maxLength={200} className={st.input} placeholder="e.g. OpenAI API" /></Field>
        <Field text="Owner" hint="Team or person accountable"><input value={owner} onChange={e => setOwner(e.target.value)} required maxLength={200} className={st.input} placeholder="e.g. Infrastructure" /></Field>
        <Field text="Tier">
          <select value={tier} onChange={e => setTier(e.target.value as RegistryComponent['tier'])} className={st.input}>
            {TIERS.map(t => <option key={t} value={t}>{tierLabel(t)}</option>)}
          </select>
        </Field>
        {audience && (
          <Field text={kind === 'APPLICATION' ? 'Registered application' : 'Provided by application'}
            hint={kind === 'APPLICATION' ? 'Optional' : 'Optional. The feature stops or degrades with that application (register the application as well)'}>
            <select value={applicationId} onChange={e => setApplicationId(e.target.value)} className={st.input}>
              <option value="">— none —</option>
              {applications.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        )}
        {kind === 'SERVER' && (
          <Field text="Registered VPS server" hint="Optional">
            <select value={serverId} onChange={e => setServerId(e.target.value)} className={st.input}>
              <option value="">— none —</option>
              {servers.map(s => <option key={s.id} value={s.id}>{s.hostname} ({s.environment})</option>)}
            </select>
          </Field>
        )}
        {audience && (
          <>
            <Field text="Users" hint="How many people use it; blank if unknown">
              <input value={userCount} onChange={e => setUserCount(e.target.value)} inputMode="numeric" pattern="[0-9]*" className={st.input} placeholder="e.g. 1200" />
            </Field>
            <Field text="Teams or customers served" hint="Comma-separated" className="sm:col-span-2">
              <input value={served} onChange={e => setServed(e.target.value)} className={st.input} placeholder="e.g. Students, Teachers, Exam office" />
            </Field>
          </>
        )}
        <Field text="Description" className="sm:col-span-2 lg:col-span-4">
          <input value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} className={st.input} />
        </Field>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={`${st.btn} ${st.primary}`}>{initial ? 'Save entry' : 'Add to register'}</button>
        <button type="button" onClick={onDone} className={`${st.btn} ${st.ghost}`}>Cancel</button>
      </div>
    </form>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const LinkEditor: React.FC<{ initial?: DependencyLink; fromId?: string; onDone: () => void }> = ({ initial, fromId: presetFrom, onDone }) => {
  const st = useStyles();
  const { registry, saveDependencyLink } = useOps();
  const [fromId, setFromId] = useState(initial?.fromId ?? presetFrom ?? '');
  const [toId, setToId] = useState(initial?.toId ?? '');
  const [type, setType] = useState<DependencyLink['type']>(initial?.type ?? 'HARD');
  const [featureId, setFeatureId] = useState(initial?.featureId ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const features = registry.filter(c => c.kind === 'BUSINESS_FEATURE');
  const option = (c: RegistryComponent) => <option key={c.id} value={c.id}>{c.name} · {kindLabel(c.kind)}</option>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const saved = await saveDependencyLink(initial?.id ?? null, { fromId, toId, type, featureId: featureId || null, notes });
    setBusy(false);
    if (saved) onDone();
  };

  return (
    <form onSubmit={submit} className={`${st.card} space-y-3`} aria-label={initial ? 'Edit dependency' : 'New dependency'}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold font-mono">{initial ? 'EDIT DEPENDENCY' : 'NEW DEPENDENCY'}</h3>
        <button type="button" onClick={onDone} aria-label="Close dependency editor" className={`${st.btn} ${st.ghost} !px-2`}><X className="w-3.5 h-3.5" /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field text="A (depends on B)">
          <select value={fromId} onChange={e => setFromId(e.target.value)} required className={st.input}>
            <option value="">— choose —</option>
            {registry.map(option)}
          </select>
        </Field>
        <Field text="B (needed by A)">
          <select value={toId} onChange={e => setToId(e.target.value)} required className={st.input}>
            <option value="">— choose —</option>
            {registry.filter(c => c.id !== fromId).map(option)}
          </select>
        </Field>
        <Field text="Type" hint={type === 'HARD' ? 'A stops working without B' : 'A works, degraded, without B'}>
          <select value={type} onChange={e => setType(e.target.value as DependencyLink['type'])} className={st.input}>
            <option value="HARD">Hard</option>
            <option value="SOFT">Soft</option>
          </select>
        </Field>
        <Field text="Feature that needs it" hint={features.length ? 'Optional' : 'Register business features to choose one'}>
          <select value={featureId} onChange={e => setFeatureId(e.target.value)} disabled={features.length === 0} className={st.input}>
            <option value="">— all of A —</option>
            {features.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        <Field text="Notes" className="sm:col-span-2 lg:col-span-4">
          <input value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} className={st.input} />
        </Field>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !fromId || !toId} className={`${st.btn} ${st.primary}`}>{initial ? 'Save dependency' : 'Add dependency'}</button>
        <button type="button" onClick={onDone} className={`${st.btn} ${st.ghost}`}>Cancel</button>
      </div>
    </form>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const ImpactPanel: React.FC<{ component: RegistryComponent; impact: RegistryImpact | null; error: string | null; onClose: () => void }> = ({ component, impact, error, onClose }) => {
  const st = useStyles();
  const stops = impact?.affected.filter(a => a.via === 'HARD') ?? [];
  const degraded = impact?.affected.filter(a => a.via === 'SOFT') ?? [];
  const item = (a: RegistryImpact['affected'][number]) => (
    <li key={a.id} className="break-words">{a.name} <span className={st.faint}>· {kindLabel(a.kind)} · {tierLabel(a.tier)}{a.userCount != null ? ` · ${a.userCount.toLocaleString()} users` : ''}</span></li>
  );
  return (
    <div className={`${st.card} space-y-2 text-xs font-mono`} role="region" aria-label={`Impact of ${component.name}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-500" /> IF {component.name.toUpperCase()} FAILS</h3>
        <button type="button" onClick={onClose} aria-label="Close impact" className={`${st.btn} ${st.ghost} !px-2`}><X className="w-3.5 h-3.5" /></button>
      </div>
      {error ? <div className="text-rose-500">{error}</div> : !impact ? <div className={st.muted}>Working out who is affected…</div> : (
        <>
          <div>
            {impact.largestUserCountStopped !== null
              ? <>Users who lose service: at least <b>{impact.largestUserCountStopped.toLocaleString()}</b>.</>
              : <>Users who lose service: no user count recorded for what stops.</>}
            {impact.largestUserCountAffected !== null && impact.largestUserCountAffected !== impact.largestUserCountStopped && (
              <> Counting what is degraded as well, at least <b>{impact.largestUserCountAffected.toLocaleString()}</b> are affected.</>
            )}
            <div className={st.faint}>
              Each figure is the largest single user count recorded, not a total: an application and its features often count the same people,
              so the counts are not added together. See the per-item counts below.
            </div>
          </div>
          <div>Teams / customers: {impact.served.length ? impact.served.join(', ') : <span className={st.faint}>none recorded</span>}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="font-bold text-rose-500">Stops working ({stops.length})</div>
              {stops.length ? <ul className="list-disc ml-4">{stops.map(item)}</ul> : <div className={st.faint}>Nothing depends on it hard</div>}
            </div>
            <div>
              <div className="font-bold text-amber-500">Degraded ({degraded.length})</div>
              {degraded.length ? <ul className="list-disc ml-4">{degraded.map(item)}</ul> : <div className={st.faint}>None</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A project is an application. This records it in the register once, so a dependency can point at it. */
async function ensureProject(
  app: Application,
  registry: RegistryComponent[],
  save: (id: string | null, data: Partial<RegistryComponent>) => Promise<RegistryComponent | null>,
): Promise<string | null> {
  const linked = registry.find(c => c.kind === 'APPLICATION' && c.applicationId === app.id);
  if (linked) return linked.id;
  const named = registry.find(c => c.kind === 'APPLICATION' && sameName(c.name, app.name));
  if (named) {
    if (named.applicationId && named.applicationId !== app.id) return null;
    if (!named.applicationId) {
      const saved = await save(named.id, { applicationId: app.id, tier: app.tier });
      return saved?.id ?? named.id;
    }
    return named.id;
  }
  const saved = await save(null, {
    kind: 'APPLICATION',
    name: app.name,
    owner: 'Unassigned',
    tier: app.tier,
    description: app.description || '',
    applicationId: app.id,
  });
  return saved?.id ?? null;
}

async function ensureServer(
  srv: VpsServer,
  registry: RegistryComponent[],
  save: (id: string | null, data: Partial<RegistryComponent>) => Promise<RegistryComponent | null>,
): Promise<string | null> {
  const linked = registry.find(c => c.kind === 'SERVER' && c.serverId === srv.id);
  if (linked) return linked.id;
  const named = registry.find(c => c.kind === 'SERVER' && sameName(c.name, srv.hostname));
  if (named) {
    if (named.serverId && named.serverId !== srv.id) return null;
    if (!named.serverId) {
      const saved = await save(named.id, { serverId: srv.id });
      return saved?.id ?? named.id;
    }
    return named.id;
  }
  const saved = await save(null, {
    kind: 'SERVER',
    name: srv.hostname,
    owner: 'Unassigned',
    tier: 'TIER_2',
    description: srv.ip ? `Server ${srv.ip}` : '',
    serverId: srv.id,
  });
  return saved?.id ?? null;
}

const NEW_KINDS: RegistryKind[] = ['DATABASE', 'STORAGE', 'THIRD_PARTY_API', 'PROVIDER', 'BUSINESS_FEATURE', 'SERVER'];

export const DependencyRegisterSection: React.FC = () => {
  const st = useStyles();
  const { applications, servers, registry, dependencyLinks, saveRegistryComponent, deleteRegistryComponent, saveDependencyLink, deleteDependencyLink } = useOps();
  const { canDo } = useAuth();
  const isAdmin = canDo('create_application');
  const [kindFilter, setKindFilter] = useState<RegistryKind | ''>('');
  const [editing, setEditing] = useState<RegistryComponent | 'new' | null>(null);
  const [editingLink, setEditingLink] = useState<DependencyLink | { fromId?: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState<string | null>(null);
  const [impactFor, setImpactFor] = useState<RegistryComponent | null>(null);
  const [impact, setImpact] = useState<RegistryImpact | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [bringing, setBringing] = useState(false);
  const [projectFilter, setProjectFilter] = useState<'all' | 'open' | 'described'>('all');
  const [recording, setRecording] = useState<{
    appId: string;
    target: string;
    kind: RegistryKind;
    name: string;
    owner: string;
    type: DependencyLink['type'];
    notes: string;
    busy: boolean;
  } | null>(null);

  const projectComponent = (appId: string) => registry.find(c => c.kind === 'APPLICATION' && c.applicationId === appId);
  const missingProjects = applications.filter(a => !projectComponent(a.id));
  const describedIds = new Set(dependencyLinks.map(l => l.fromId));
  const describedProjects = applications.filter(a => {
    const c = projectComponent(a.id);
    return Boolean(c && describedIds.has(c.id));
  });
  const openProjects = applications.length - describedProjects.length;
  const visibleProjects = applications.filter(app => {
    const c = projectComponent(app.id);
    const described = Boolean(c && describedIds.has(c.id));
    return projectFilter === 'all' || (projectFilter === 'described' ? described : !described);
  });

  const byId = useMemo(() => new Map(registry.map(c => [c.id, c])), [registry]);
  const shown = kindFilter ? registry.filter(c => c.kind === kindFilter) : registry;
  const linksOf = (id: string) => dependencyLinks.filter(l => l.fromId === id || l.toId === id).length;

  const showImpact = async (c: RegistryComponent) => {
    setImpactFor(c); setImpact(null); setImpactError(null);
    try { setImpact(await api.getRegistryImpact(c.id)); }
    catch (e) { setImpactError((e as Error).message); }
  };
  const remove = async (c: RegistryComponent) => {
    setConfirmDelete(null);
    if (await deleteRegistryComponent(c.id) && impactFor?.id === c.id) setImpactFor(null);
  };
  const name = (id: string | null) => (id ? byId.get(id)?.name ?? '(deleted)' : '');

  const bringProjects = async () => {
    setBringing(true);
    let latest = registry;
    for (const app of applications) {
      const id = await ensureProject(app, latest, saveRegistryComponent);
      if (!id) break;
      const saved = latest.find(c => c.id === id) ?? { id, kind: 'APPLICATION' as const, name: app.name, applicationId: app.id };
      latest = latest.some(c => c.id === id) ? latest.map(c => c.id === id ? { ...c, applicationId: app.id } : c) : [...latest, saved as RegistryComponent];
    }
    setBringing(false);
  };

  const recordDependency = async (app: Application) => {
    if (!recording || recording.appId !== app.id || recording.busy) return;
    setRecording({ ...recording, busy: true });
    const fromId = await ensureProject(app, registry, saveRegistryComponent);
    if (!fromId) { setRecording(r => r && { ...r, busy: false }); return; }
    let toId: string | null = null;
    if (recording.target === 'new') {
      const saved = await saveRegistryComponent(null, {
        kind: recording.kind,
        name: recording.name.trim(),
        owner: recording.owner.trim() || 'Unassigned',
        tier: app.tier,
        description: '',
      });
      toId = saved?.id ?? null;
    } else if (recording.target.startsWith('app:')) {
      const other = applications.find(a => a.id === recording.target.slice(4));
      toId = other ? await ensureProject(other, registry, saveRegistryComponent) : null;
    } else if (recording.target.startsWith('srv:')) {
      const srv = servers.find(s => s.id === recording.target.slice(4));
      toId = srv ? await ensureServer(srv, registry, saveRegistryComponent) : null;
    } else {
      toId = recording.target;
    }
    if (toId && toId !== fromId) {
      const saved = await saveDependencyLink(null, { fromId, toId, type: recording.type, featureId: null, notes: recording.notes });
      if (saved) setRecording(null);
      else setRecording(r => r && { ...r, busy: false });
      return;
    }
    setRecording(r => r && { ...r, busy: false });
  };

  return (
    <section className="space-y-3" aria-labelledby="dependency-register-title">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 id="dependency-register-title" className="text-sm font-bold font-mono flex items-center gap-2">
          <Network className="w-4 h-4 text-blue-500" /> DEPENDENCY REGISTER ({registry.length})
        </h2>
        {isAdmin && editing === null && editingLink === null && (
          <div className="flex gap-2">
            <button onClick={() => setEditing('new')} className={`${st.btn} ${st.primary}`}><Plus className="w-3.5 h-3.5" /> Add entry</button>
            <button onClick={() => setEditingLink({})} disabled={registry.length < 2} title={registry.length < 2 ? 'Register at least two entries first' : undefined} className={`${st.btn} ${st.ghost}`}>
              <Plus className="w-3.5 h-3.5" /> Add dependency
            </button>
          </div>
        )}
      </div>
      <p className={`text-xs ${st.muted}`}>
        Each project is an application you already run. Record what that project depends on — another project, a server, a database, storage, a third-party API or a provider.
        <b> Hard</b> means the project stops if that thing fails. <b>Soft</b> means the project still runs, but worse. Use <b>Impact</b> to see who is affected.
      </p>

      {applications.length > 0 && (
        <div className={`${st.card} space-y-3`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-xs font-bold font-mono">WHICH PROJECT DEPENDS ON WHAT ({applications.length})</h3>
            {isAdmin && missingProjects.length > 0 && (
              <button type="button" onClick={bringProjects} disabled={bringing} className={`${st.btn} ${st.ghost}`}>
                {bringing ? 'Adding projects…' : `Add ${missingProjects.length} project${missingProjects.length === 1 ? '' : 's'} to the register`}
              </button>
            )}
          </div>
          <p className={`text-[11px] ${st.faint}`}>
            {openProjects === 0
              ? 'Every project has at least one dependency written down.'
              : `${describedProjects.length} of ${applications.length} projects have dependencies written down. ${openProjects} ${openProjects === 1 ? 'is' : 'are'} not described yet. That is not a failure — it has not been written down.`}
            {' '}“Runs on” is the server already saved on the application.
          </p>
          <div className="flex flex-wrap gap-2">
            {([
              ['all', `All (${applications.length})`],
              ['open', `Not written down (${openProjects})`],
              ['described', `Written down (${describedProjects.length})`],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setProjectFilter(id)} className={`${st.btn} ${projectFilter === id ? st.primary : st.ghost}`}>{label}</button>
            ))}
          </div>
          <div className="space-y-3">
            {visibleProjects.length === 0 && (
              <div className={`text-xs font-mono ${st.muted}`}>No projects in this view.</div>
            )}
            {visibleProjects.map(app => {
              const comp = projectComponent(app.id);
              const dependsOn = comp ? dependencyLinks.filter(l => l.fromId === comp.id) : [];
              const neededBy = comp ? dependencyLinks.filter(l => l.toId === comp.id) : [];
              const prd = servers.find(s => s.id === app.prdServerId);
              const dr = servers.find(s => s.id === app.drServerId);
              const open = recording?.appId === app.id;
              const taken = new Set([comp?.id, ...dependsOn.map(l => l.toId)].filter(Boolean) as string[]);
              return (
                <div key={app.id} className={`rounded border p-3 space-y-2 ${st.row}`}>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm font-bold font-sans break-words">{app.name}</div>
                      <div className={`text-[10px] font-mono ${st.faint}`}>
                        {tierLabel(app.tier)} · {app.status} · {app.codeName || 'no code name'}
                        {comp ? '' : ' · not in the register yet'}
                      </div>
                    </div>
                    {isAdmin && !open && (
                      <button
                        type="button"
                        onClick={() => setRecording({ appId: app.id, target: '', kind: 'DATABASE', name: '', owner: 'Unassigned', type: 'HARD', notes: '', busy: false })}
                        className={`${st.btn} ${st.primary}`}
                        aria-label={`Record what ${app.name} depends on`}
                      >
                        <Plus className="w-3.5 h-3.5" /> Depends on…
                      </button>
                    )}
                  </div>
                  <div className={`text-[11px] font-mono break-all ${st.muted}`}>
                    Runs on: {prd ? prd.hostname : 'no production server'}{dr ? ` · recovery ${dr.hostname}` : ' · no recovery server'}
                  </div>
                  <div className="text-xs font-mono">
                    <div className={`text-[10px] font-bold uppercase ${st.faint}`}>Depends on ({dependsOn.length})</div>
                    {dependsOn.length === 0 ? (
                      <div className={st.muted}>Nothing recorded. This does not mean the project has no dependencies — they have not been written down.</div>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {dependsOn.map(l => {
                          const target = byId.get(l.toId);
                          return (
                          <li key={l.id} className="flex items-start justify-between gap-2 flex-wrap">
                            <span className="min-w-0 break-words">
                              <b>{name(l.toId)}</b>
                              <span className={st.faint}> · {kindLabel(target?.kind ?? 'APPLICATION')}{target?.owner ? ` · ${target.owner}` : ''}</span>{' '}
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${l.type === 'HARD' ? 'bg-rose-500/15 text-rose-500' : 'bg-amber-500/15 text-amber-500'}`}>{l.type === 'HARD' ? 'STOPS' : 'DEGRADED'}</span>
                              {l.notes && <span className={st.faint}> — {l.notes}</span>}
                            </span>
                            {isAdmin && (confirmUnlink === l.id ? (
                              <span className="flex items-center gap-1.5 shrink-0">
                                <button type="button" onClick={async () => { setConfirmUnlink(null); await deleteDependencyLink(l.id); }} className={`${st.btn} ${st.danger} !px-2`}>Remove</button>
                                <button type="button" onClick={() => setConfirmUnlink(null)} className={`${st.btn} ${st.ghost} !px-2`}>Keep</button>
                              </span>
                            ) : (
                              <span className="flex gap-1.5 shrink-0">
                                <button type="button" onClick={() => saveDependencyLink(l.id, { type: l.type === 'HARD' ? 'SOFT' : 'HARD' })} className={`${st.btn} ${st.ghost} !px-2`} aria-label={`Change ${name(l.fromId)} on ${name(l.toId)} to ${l.type === 'HARD' ? 'soft' : 'hard'}`}>
                                  {l.type === 'HARD' ? 'Make soft' : 'Make hard'}
                                </button>
                                <button type="button" onClick={() => setConfirmUnlink(l.id)} className={`${st.btn} ${st.danger} !px-2`} aria-label={`Remove dependency ${name(l.fromId)} on ${name(l.toId)} from the project`}>Remove</button>
                              </span>
                            ))}
                          </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  {neededBy.length > 0 && (
                    <div className={`text-[11px] font-mono ${st.muted}`}>
                      Needed by: {neededBy.map(l => name(l.fromId)).join(', ')}
                    </div>
                  )}
                  {open && recording && (
                    <form
                      onSubmit={e => { e.preventDefault(); void recordDependency(app); }}
                      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1"
                      aria-label={`What ${app.name} depends on`}
                    >
                      <Field text="Depends on">
                        <select value={recording.target} onChange={e => setRecording({ ...recording, target: e.target.value })} required className={st.input}>
                          <option value="">— choose —</option>
                          {applications.some(a => a.id !== app.id) && (
                            <optgroup label="Another project">
                              {applications.filter(a => a.id !== app.id).map(a => (
                                <option key={a.id} value={`app:${a.id}`}>{a.name}</option>
                              ))}
                            </optgroup>
                          )}
                          {servers.length > 0 && (
                            <optgroup label="A server">
                              {servers.map(s => <option key={s.id} value={`srv:${s.id}`}>{s.hostname} ({s.environment})</option>)}
                            </optgroup>
                          )}
                          {registry.some(c => !taken.has(c.id) && !(c.kind === 'APPLICATION' && c.applicationId) && !(c.kind === 'SERVER' && c.serverId)) && (
                            <optgroup label="Already in the register">
                              {registry.filter(c => !taken.has(c.id) && !(c.kind === 'APPLICATION' && c.applicationId) && !(c.kind === 'SERVER' && c.serverId)).map(c => (
                                <option key={c.id} value={c.id}>{c.name} · {kindLabel(c.kind)} · {c.owner}</option>
                              ))}
                            </optgroup>
                          )}
                          <option value="new">Something not listed yet…</option>
                        </select>
                      </Field>
                      <Field text="If it fails" hint={recording.type === 'HARD' ? 'This project stops' : 'This project still runs, but worse'}>
                        <select value={recording.type} onChange={e => setRecording({ ...recording, type: e.target.value as DependencyLink['type'] })} className={st.input}>
                          <option value="HARD">Hard — project stops</option>
                          <option value="SOFT">Soft — project degraded</option>
                        </select>
                      </Field>
                      {recording.target === 'new' && (
                        <>
                          <Field text="Kind of thing">
                            <select value={recording.kind} onChange={e => setRecording({ ...recording, kind: e.target.value as RegistryKind })} className={st.input}>
                              {NEW_KINDS.map(k => <option key={k} value={k}>{kindLabel(k)}</option>)}
                            </select>
                          </Field>
                          <Field text="Name"><input value={recording.name} onChange={e => setRecording({ ...recording, name: e.target.value })} required maxLength={200} className={st.input} placeholder="e.g. Student database" /></Field>
                          <Field text="Owner"><input value={recording.owner} onChange={e => setRecording({ ...recording, owner: e.target.value })} required maxLength={200} className={st.input} /></Field>
                        </>
                      )}
                      <Field text="Why it is needed" className="sm:col-span-2 lg:col-span-4">
                        <input value={recording.notes} onChange={e => setRecording({ ...recording, notes: e.target.value })} maxLength={500} className={st.input} placeholder="e.g. Login reads this database" />
                      </Field>
                      <div className="flex gap-2 sm:col-span-2">
                        <button type="submit" disabled={recording.busy || !recording.target || (recording.target === 'new' && !recording.name.trim())} className={`${st.btn} ${st.primary}`}>
                          Save this dependency
                        </button>
                        <button type="button" onClick={() => setRecording(null)} className={`${st.btn} ${st.ghost}`}>Close</button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editing && <ComponentEditor key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      {editingLink && (
        <LinkEditor key={'id' in editingLink ? editingLink.id : `new-${editingLink.fromId ?? ''}`} initial={'id' in editingLink ? editingLink as DependencyLink : undefined}
          fromId={'id' in editingLink ? undefined : editingLink.fromId} onDone={() => setEditingLink(null)} />
      )}
      {impactFor && <ImpactPanel component={impactFor} impact={impact} error={impactError} onClose={() => setImpactFor(null)} />}

      {registry.length === 0 ? (
        <div className={`${st.card} text-center text-xs ${st.muted} py-8`}>
          {applications.length > 0
            ? 'No extra entries yet. Use “Depends on…” on a project above to record a database, API, server or another project. “Add entry” is for something that is not already an application.'
            : 'Nothing registered yet. Add the applications, servers, databases, storage, third-party APIs, providers and business features you depend on.'}
        </div>
      ) : (
        <div className={`${st.card} !p-0 overflow-x-auto`}>
          <div className={`flex items-center gap-2 px-3 py-2 border-b ${st.row}`}>
            <label className="text-[11px] font-mono flex items-center gap-2">
              Kind
              <select value={kindFilter} onChange={e => setKindFilter(e.target.value as RegistryKind | '')} className={`${st.input} !w-auto`}>
                <option value="">All kinds</option>
                {KINDS.map(k => <option key={k.id} value={k.id}>{k.label} ({registry.filter(c => c.kind === k.id).length})</option>)}
              </select>
            </label>
          </div>
          <table className="w-full text-xs font-mono min-w-[700px]">
            <thead>
              <tr className={`text-left ${st.faint} border-b ${st.row}`}>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Kind</th>
                <th className="px-3 py-2 font-semibold">Owner</th>
                <th className="px-3 py-2 font-semibold">Tier</th>
                <th className="px-3 py-2 font-semibold text-right">Users</th>
                <th className="px-3 py-2 font-semibold">Serves</th>
                <th className="px-3 py-2 font-semibold text-right">Links</th>
                <th className="px-3 py-2 font-semibold"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(c => (
                <tr key={c.id} className={`border-b last:border-b-0 ${st.row} align-top`}>
                  <td className="px-3 py-2 font-semibold break-words max-w-[220px]">{c.name}{c.description && <div className={`font-normal text-[10px] ${st.faint}`}>{c.description}</div>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{kindLabel(c.kind)}</td>
                  <td className="px-3 py-2 break-words max-w-[160px]">{c.owner}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{tierLabel(c.tier)}</td>
                  <td className="px-3 py-2 text-right">{c.userCount != null ? c.userCount.toLocaleString() : <span className={st.faint}>—</span>}</td>
                  <td className="px-3 py-2 break-words max-w-[200px]">{c.served.length ? c.served.join(', ') : <span className={st.faint}>—</span>}</td>
                  <td className="px-3 py-2 text-right">{linksOf(c.id)}</td>
                  <td className="px-3 py-2">
                    {confirmDelete === c.id ? (
                      <div className="flex flex-wrap items-center gap-1.5 justify-end">
                        <span>Delete with {linksOf(c.id)} link(s)?</span>
                        <button onClick={() => remove(c)} className={`${st.btn} ${st.danger} !px-2`}>Delete</button>
                        <button onClick={() => setConfirmDelete(null)} className={`${st.btn} ${st.ghost} !px-2`}>Cancel</button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 justify-end">
                        <button onClick={() => showImpact(c)} className={`${st.btn} ${st.ghost} !px-2`} aria-label={`Impact of ${c.name}`}><Zap className="w-3.5 h-3.5" /> Impact</button>
                        {isAdmin && <>
                          <button onClick={() => setEditingLink({ fromId: c.id })} className={`${st.btn} ${st.ghost} !px-2`} aria-label={`Add dependency of ${c.name}`} title="Add something this depends on"><Plus className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setEditing(c)} className={`${st.btn} ${st.ghost} !px-2`} aria-label={`Edit ${c.name}`}><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setConfirmDelete(c.id)} className={`${st.btn} ${st.danger} !px-2`} aria-label={`Delete ${c.name}`}><Trash2 className="w-3.5 h-3.5" /></button>
                        </>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {registry.length > 0 && (
        <div className={`${st.card} space-y-2`}>
          <h3 className="text-xs font-bold font-mono">DEPENDENCIES ({dependencyLinks.length})</h3>
          {dependencyLinks.length === 0 ? (
            <div className={`text-xs ${st.muted}`}>No dependencies recorded. Use “Add dependency” to record that A depends on B.</div>
          ) : (
            <ul className="space-y-1.5" aria-label="Dependencies">
              {dependencyLinks.map(l => (
                <li key={l.id} className={`flex items-start justify-between gap-2 text-xs font-mono border-b last:border-b-0 pb-1.5 ${st.row}`}>
                  <div className="min-w-0 break-words">
                    <b>{name(l.fromId)}</b> depends on <b>{name(l.toId)}</b>{' '}
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${l.type === 'HARD' ? 'bg-rose-500/15 text-rose-500' : 'bg-amber-500/15 text-amber-500'}`}>{l.type}</span>
                    {l.featureId && <span className={st.muted}> · needed by {name(l.featureId)}</span>}
                    {l.notes && <div className={`text-[10px] ${st.faint}`}>{l.notes}</div>}
                  </div>
                  {isAdmin && (confirmUnlink === l.id ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span>Remove?</span>
                      <button onClick={async () => { setConfirmUnlink(null); await deleteDependencyLink(l.id); }} className={`${st.btn} ${st.danger} !px-2`}>Remove</button>
                      <button onClick={() => setConfirmUnlink(null)} className={`${st.btn} ${st.ghost} !px-2`}>Cancel</button>
                    </div>
                  ) : (
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => setEditingLink(l)} className={`${st.btn} ${st.ghost} !px-2`} aria-label={`Edit dependency ${name(l.fromId)} on ${name(l.toId)}`}><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setConfirmUnlink(l.id)} className={`${st.btn} ${st.danger} !px-2`} aria-label={`Remove dependency ${name(l.fromId)} on ${name(l.toId)}`}><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};
