import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Gauge } from 'lucide-react';
import { api, ApiError } from '../../services/api';
import type { QuotaWindow, ResourceKind, ResourceMeasurement, ResourceUnit, ResourceView } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useOps } from '../../context/OpsContext';
import { EmptyState } from '../ui/EmptyState';

const KINDS: ResourceKind[] = ['CPU', 'MEMORY', 'SERVER_DISK', 'STORAGE', 'SEATS', 'ACTIVE_USERS', 'DATABASE_SIZE', 'DATABASE_CONNECTIONS', 'API_QUOTA'];
const UNITS: Record<ResourceKind, ResourceUnit[]> = {
  CPU: ['cores', 'millicores', 'percent'],
  MEMORY: ['bytes', 'GiB', 'GB'],
  SERVER_DISK: ['bytes', 'GiB', 'GB'],
  STORAGE: ['bytes', 'GiB', 'GB'],
  DATABASE_SIZE: ['bytes', 'GiB', 'GB'],
  DATABASE_CONNECTIONS: ['connections'],
  SEATS: ['seats'],
  ACTIVE_USERS: ['users'],
  API_QUOTA: ['requests'],
};

const STATE_CLASS: Record<string, string> = {
  NORMAL: 'text-emerald-400',
  WARNING: 'text-amber-400',
  CRITICAL: 'text-orange-400',
  EXCEEDED: 'text-rose-400',
  STALE: 'text-slate-400',
  UNKNOWN: 'text-slate-500',
};

function shown(n: number | null, unit: string): string {
  if (n === null) return 'unknown';
  return `${n} ${unit}`;
}

export const ResourcesView: React.FC = () => {
  const { hasRole } = useAuth();
  const { theme } = useOps();
  const isDark = theme === 'dark';
  const canEdit = hasRole('operator');
  const canDelete = hasRole('it_administrator');
  const [rows, setRows] = useState<ResourceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [selected, setSelected] = useState<ResourceView | null>(null);
  const [measurements, setMeasurements] = useState<ResourceMeasurement[]>([]);
  const [historyError, setHistoryError] = useState('');
  const selectedId = useRef<string | null>(null);
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ kind: 'STORAGE' as ResourceKind, name: '', owner: '', unit: 'GiB' as ResourceUnit, capacity: '', warningValue: '85', criticalValue: '95', quotaWindow: 'hour' as QuotaWindow });
  const [usage, setUsage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (status) params.set('status', status);
    if (q.trim()) params.set('q', q.trim());
    if (owner.trim()) params.set('owner', owner.trim());
    params.set('pageSize', '200');
    try {
      const res = await api.getResources(`?${params.toString()}`);
      setRows(res.data);
    } catch (err) {
      setRows([]);
      setError(err instanceof ApiError ? err.message : 'Could not load resources');
    } finally {
      setLoading(false);
    }
  }, [kind, status, q, owner]);

  useEffect(() => { void load(); }, [load]);

  const card = isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200';
  const input = `w-full rounded border px-2 py-1 text-xs font-mono ${isDark ? 'bg-[#0B0F17] border-[#1E293B]' : 'bg-white border-slate-300'}`;

  const openRow = async (row: ResourceView) => {
    selectedId.current = row.id;
    setSelected(row);
    setFormError('');
    setHistoryError('');
    try {
      const detail = await api.getResource(row.id);
      if (selectedId.current !== row.id) return;
      setSelected(detail.resource);
      setMeasurements(detail.measurements);
    } catch (err) {
      if (selectedId.current !== row.id) return;
      setMeasurements([]);
      setHistoryError(err instanceof ApiError ? err.message : 'Could not load measurements');
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    try {
      await api.createResource({
        kind: draft.kind,
        name: draft.name,
        owner: draft.owner,
        unit: draft.unit,
        capacity: draft.capacity === '' ? null : Number(draft.capacity),
        warningValue: draft.warningValue === '' ? null : Number(draft.warningValue),
        criticalValue: draft.criticalValue === '' ? null : Number(draft.criticalValue),
        quotaWindow: draft.kind === 'API_QUOTA' ? draft.quotaWindow : null,
        thresholdMode: 'percent',
        source: 'manual',
      });
      setCreating(false);
      setDraft({ ...draft, name: '', owner: '', capacity: '' });
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save the resource');
    }
  };

  const saveThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setFormError('');
    const form = new FormData(e.target as HTMLFormElement);
    const text = (key: string) => String(form.get(key) ?? '');
    try {
      const updated = await api.updateResource(selected.id, {
        owner: text('owner'),
        warningValue: text('warning') === '' ? null : Number(text('warning')),
        criticalValue: text('critical') === '' ? null : Number(text('critical')),
        enabled: form.get('enabled') === 'on',
      });
      setSelected(updated);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not update the resource');
    }
  };

  const measure = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setFormError('');
    try {
      const updated = await api.measureResource(selected.id, {
        usage: Number(usage),
        measurementId: crypto.randomUUID(),
        window: selected.kind === 'API_QUOTA' ? (selected.quotaWindow ?? undefined) : undefined,
      });
      setUsage('');
      await openRow(updated);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not record the measurement');
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-sm font-mono font-bold tracking-wide">Resource capacity</h1>
          <p className={`text-[11px] mt-1 max-w-xl ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Purchased limits and measured usage are separate. An empty usage is not zero, and a user count is not a seat licence.
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => { setCreating(v => !v); setFormError(''); }} className="px-3 py-1.5 text-xs font-mono font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded cursor-pointer">
            {creating ? 'Close' : 'Add limit'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input aria-label="Search resources" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or key" className={input} />
        <input aria-label="Filter by owner" value={owner} onChange={e => setOwner(e.target.value)} placeholder="Owner" className={input} />
        <select aria-label="Filter by type" value={kind} onChange={e => setKind(e.target.value)} className={input}>
          <option value="">All types</option>
          {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)} className={input}>
          <option value="">All statuses</option>
          {Object.keys(STATE_CLASS).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {creating && canEdit && (
        <form onSubmit={create} className={`rounded border p-3 grid md:grid-cols-3 gap-2 ${card}`}>
          <label className="text-[10px] font-mono">Type
            <select aria-label="Resource type" className={input} value={draft.kind} onChange={e => {
              const next = e.target.value as ResourceKind;
              setDraft({ ...draft, kind: next, unit: UNITS[next][0] });
            }}>{KINDS.map(k => <option key={k}>{k}</option>)}</select>
          </label>
          <label className="text-[10px] font-mono">Name
            <input aria-label="Resource name" required className={input} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="text-[10px] font-mono">Owner
            <input aria-label="Resource owner" required className={input} value={draft.owner} onChange={e => setDraft({ ...draft, owner: e.target.value })} />
          </label>
          <label className="text-[10px] font-mono">Unit
            <select aria-label="Unit" className={input} value={draft.unit} onChange={e => setDraft({ ...draft, unit: e.target.value as ResourceUnit })}>
              {UNITS[draft.kind].map(u => <option key={u}>{u}</option>)}
            </select>
          </label>
          <label className="text-[10px] font-mono">Capacity (empty = unknown)
            <input aria-label="Capacity" inputMode="decimal" className={input} value={draft.capacity} onChange={e => setDraft({ ...draft, capacity: e.target.value })} />
          </label>
          {draft.kind === 'API_QUOTA' && (
            <label className="text-[10px] font-mono">Quota window
              <select aria-label="Quota window" className={input} value={draft.quotaWindow} onChange={e => setDraft({ ...draft, quotaWindow: e.target.value as QuotaWindow })}>
                <option value="minute">minute</option>
                <option value="hour">hour</option>
                <option value="day">day</option>
              </select>
            </label>
          )}
          <label className="text-[10px] font-mono">Warning %
            <input aria-label="Warning percent" className={input} value={draft.warningValue} onChange={e => setDraft({ ...draft, warningValue: e.target.value })} />
          </label>
          <label className="text-[10px] font-mono">Critical %
            <input aria-label="Critical percent" className={input} value={draft.criticalValue} onChange={e => setDraft({ ...draft, criticalValue: e.target.value })} />
          </label>
          <div className="md:col-span-3 flex items-center gap-3">
            <button type="submit" className="px-3 py-1 text-xs font-mono text-white bg-blue-600 rounded cursor-pointer">Save</button>
            {formError && <span role="alert" className="text-xs text-rose-400">{formError}</span>}
          </div>
        </form>
      )}

      {loading && <div className="text-xs font-mono text-slate-500 animate-pulse">Loading resources…</div>}
      {error && <div role="alert" className="text-xs font-mono text-rose-400">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <EmptyState icon={Gauge} title="No resource limits" description="Add a limit, or set a server plan. Usage appears only after a measurement." />
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto rounded border border-[#1E293B]">
          <table className="w-full text-xs font-mono">
            <thead className={isDark ? 'text-slate-500' : 'text-slate-500'}>
              <tr className="text-left">
                <th className="px-3 py-2">Resource</th>
                <th className="px-3 py-2">Usage</th>
                <th className="px-3 py-2">Capacity</th>
                <th className="px-3 py-2">Used</th>
                <th className="px-3 py-2">Thresholds</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Freshness</th>
                <th className="px-3 py-2">Owner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className={`border-t cursor-pointer ${isDark ? 'border-[#1E293B] hover:bg-[#151D2E]' : 'border-slate-200 hover:bg-slate-50'}`} onClick={() => { void openRow(r); }}>
                  <td className="px-3 py-2">
                    <button type="button" className="text-left cursor-pointer" onClick={() => { void openRow(r); }}>
                      <span className="font-semibold">{r.name}</span>
                      <span className="block text-[10px] text-slate-500">{r.kind} · {r.unit}{r.quotaWindow ? ` / ${r.quotaWindow}` : ''} · {r.source}</span>
                    </button>
                  </td>
                  <td className="px-3 py-2">{shown(r.usage, r.unit)}</td>
                  <td className="px-3 py-2">{r.unlimited ? 'unlimited' : shown(r.capacity, r.unit)}</td>
                  <td className="px-3 py-2">{r.evaluation.utilizationPercent === null ? '—' : `${r.evaluation.utilizationPercent}%`}</td>
                  <td className="px-3 py-2">{r.evaluation.warning === null ? 'none' : `${r.evaluation.warning} / ${r.evaluation.critical} (${r.evaluation.thresholdFrom})`}</td>
                  <td className={`px-3 py-2 ${STATE_CLASS[r.evaluation.state] ?? ''}`}>{r.evaluation.state}</td>
                  <td className="px-3 py-2">{r.evaluation.freshness}{r.syncError ? ` · ${r.syncError}` : ''}</td>
                  <td className="px-3 py-2">{r.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <section className={`rounded border p-3 space-y-3 ${card}`} aria-label="Resource detail">
          <div className="flex justify-between gap-3">
            <div>
              <h2 className="text-xs font-mono font-bold">{selected.name}</h2>
              <p className="text-[10px] text-slate-500">{selected.resourceKey} · measured {selected.measuredAt ?? 'never'}</p>
              {selected.description && <p className="text-[11px] mt-1">{selected.description}</p>}
            </div>
            <button type="button" className="text-[10px] font-mono text-slate-400 cursor-pointer" onClick={() => { selectedId.current = null; setSelected(null); setMeasurements([]); }}>Close</button>
          </div>
          {formError && <div role="alert" className="text-xs text-rose-400">{formError}</div>}
          {canEdit ? (
            <form key={`${selected.id}:${selected.updatedAt}`} onSubmit={saveThresholds} className="grid md:grid-cols-4 gap-2 items-end">
              <label className="text-[10px] font-mono">Owner
                <input name="owner" aria-label="Edit owner" required defaultValue={selected.owner} className={input} />
              </label>
              <label className="text-[10px] font-mono">Warning
                <input name="warning" aria-label="Edit warning" defaultValue={selected.warningValue ?? ''} className={input} />
              </label>
              <label className="text-[10px] font-mono">Critical
                <input name="critical" aria-label="Edit critical" defaultValue={selected.criticalValue ?? ''} className={input} />
              </label>
              <label className="text-[10px] font-mono flex items-center gap-2">
                <input name="enabled" type="checkbox" defaultChecked={selected.enabled} aria-label="Monitoring enabled" /> Enabled
              </label>
              <button type="submit" className="px-3 py-1 text-xs font-mono text-white bg-blue-600 rounded cursor-pointer w-fit">Save changes</button>
            </form>
          ) : (
            <p className="text-[11px] text-slate-500">You can view this resource. Changing it requires an operator.</p>
          )}
          {canEdit && (
            <form onSubmit={measure} className="flex flex-wrap items-end gap-2">
              <label className="text-[10px] font-mono">Record usage ({selected.unit}{selected.quotaWindow ? ` this ${selected.quotaWindow}` : ''})
                <input aria-label="Measured usage" required inputMode="decimal" value={usage} onChange={e => setUsage(e.target.value)} className={input} />
              </label>
              <button type="submit" className="px-3 py-1 text-xs font-mono text-white bg-slate-700 rounded cursor-pointer">Record measurement</button>
            </form>
          )}
          {historyError && <div role="alert" className="text-xs text-rose-400">{historyError}</div>}
          <div>
            <h3 className="text-[10px] font-mono text-slate-500">Recorded measurements</h3>
            {measurements.length === 0 ? (
              <p className="text-[11px] text-slate-500 mt-1">No measurements recorded.</p>
            ) : (
              <ul className="mt-1 max-h-40 overflow-y-auto text-[11px] font-mono space-y-1">
                {measurements.map(m => (
                  <li key={m.measuredAt}>{m.measuredAt} · {m.usage} {m.unit} · {m.alertState}{m.capacity === null ? '' : ` · capacity ${m.capacity}`}</li>
                ))}
              </ul>
            )}
          </div>
          {canDelete && (
            <button type="button" className="text-[11px] font-mono text-rose-400 cursor-pointer" onClick={async () => {
              if (!window.confirm(`Delete ${selected.name}?`)) return;
              try {
                await api.deleteResource(selected.id);
                setSelected(null);
                await load();
              } catch (err) {
                setFormError(err instanceof ApiError ? err.message : 'Could not delete the resource');
              }
            }}>Delete resource</button>
          )}
        </section>
      )}
    </div>
  );
};
