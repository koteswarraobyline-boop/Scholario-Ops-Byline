import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { Server, RefreshCw, AlertTriangle, KeyRound, Link2 } from 'lucide-react';
import { api } from '../../services/api';
import { ProviderConnectionView, ProviderInstanceView, VpsServer } from '../../types';
import { PROVIDER_DISPLAY_LABEL, filterProviderInstances, providerRegionFilterValue } from '../../lib/providerInventory';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { SkeletonTable } from '../ui/Skeleton';

const fmtGb = (gb: number | null) => (gb === null ? '—' : `${gb} GB`);
const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const stateColor = (status: string, absent: boolean) => {
  if (absent) return { text: 'text-slate-400', dot: 'bg-slate-400' };
  if (status === 'HEALTHY') return { text: 'text-emerald-500', dot: 'bg-emerald-500' };
  if (status === 'UNAVAILABLE') return { text: 'text-rose-500', dot: 'bg-rose-500' };
  if (status === 'DEGRADED') return { text: 'text-amber-500', dot: 'bg-amber-500' };
  return { text: 'text-slate-400', dot: 'bg-slate-400' };
};

const EMPTY_FILTERS = { provider: '', connectionId: '', connectionStatus: '', region: '', status: '', q: '' };

export const HostingerView: React.FC = () => {
  const { servers, theme, syncHostinger } = useOps();
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const isDark = theme === 'dark';
  const canSync = hasRole('operator');
  const canManage = hasRole('it_administrator');

  const [connections, setConnections] = useState<ProviderConnectionView[]>([]);
  const [instances, setInstances] = useState<ProviderInstanceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', tokenEnv: '' });
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getProviderInstances();
      setConnections(res.connections);
      setInstances(res.data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const serverByIp = useMemo(() => {
    const map = new Map<string, VpsServer>();
    for (const s of servers) if (s.ip) map.set(s.ip, s);
    return map;
  }, [servers]);

  const filtered = useMemo(
    () => filterProviderInstances(instances, connections, filters),
    [instances, connections, filters],
  );
  const filtersActive = Object.values(filters).some(Boolean);
  const regions = useMemo(() => [...new Set(instances.map(v => v.region).filter((r): r is string => Boolean(r)))].sort(), [instances]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setFormError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Request failed');
      await load();
    } finally {
      setBusy(null);
    }
  };

  const card = `p-3 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`;
  const label = `text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`;
  const input = `px-2 py-1 text-xs font-mono rounded border ${isDark ? 'bg-[#0B0F17] border-[#243552] text-slate-200' : 'bg-white border-slate-300 text-slate-800'}`;
  const btn = `flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${isDark ? 'bg-[#162033] border-[#243552] text-slate-200 hover:bg-[#1C2942]' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 shadow-xs'}`;

  const header = (
    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
      <div>
        <h1 className="text-lg font-bold font-mono tracking-tight">PROVIDER VPS INVENTORY</h1>
        <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          Each Hostinger account stays separate. Tokens stay in server environment variables and are never shown here.
        </p>
      </div>
    </div>
  );

  if (loading && connections.length === 0 && instances.length === 0) {
    return <div className="space-y-6">{header}<SkeletonTable rows={4} cols={7} /></div>;
  }
  if (error && connections.length === 0) {
    return <div className="space-y-6">{header}<ErrorState error={error} onRetry={() => void load()} /></div>;
  }

  return (
    <div className="space-y-6">
      {header}

      <div className={`p-4 rounded-lg border font-mono text-xs space-y-3 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
        <div className="flex items-center gap-2 font-bold text-sm">
          <KeyRound className="w-4 h-4 text-amber-500" />
          <span>Accounts</span>
        </div>
        <p className={isDark ? 'text-slate-300' : 'text-slate-700'}>
          Add <code className={`px-1 rounded ${isDark ? 'bg-[#0B0F17]' : 'bg-slate-100'}`}>HOSTINGER_API_TOKEN</code> or <code className={`px-1 rounded ${isDark ? 'bg-[#0B0F17]' : 'bg-slate-100'}`}>HOSTINGER_&lt;LABEL&gt;_API_TOKEN</code> to the server <span className="font-semibold">.env</span>, then restart. A new variable is not visible until the process starts again. This form stores the variable name only.
        </p>
        {connections.length === 0 && (
          <p className={isDark ? 'text-slate-400' : 'text-slate-500'}>No connections yet. The built-in Hostinger account appears after HOSTINGER_API_TOKEN is set and the server restarts.</p>
        )}
        <div className="space-y-2">
          {connections.map(c => (
            <div key={c.id} className={`flex flex-col gap-2 p-3 rounded border ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
                <div>
                  <div className={`font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{c.name}</div>
                  <div className={isDark ? 'text-slate-400' : 'text-slate-500'}>
                    Hostinger · {c.tokenEnv} · {c.tokenConfigured ? 'token configured' : 'token not configured'} · {c.vmCount} current VM(s)
                    {c.legacy ? ' · built-in account' : ''}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`px-2 py-0.5 rounded border ${c.displayStatus === 'CONNECTED' ? 'text-emerald-500 border-emerald-800' : c.displayStatus === 'AUTH_FAILED' || c.displayStatus === 'SYNC_FAILED' ? 'text-amber-500 border-amber-800' : 'text-slate-400 border-slate-600'}`}>
                    {PROVIDER_DISPLAY_LABEL[c.displayStatus]}
                  </span>
                  {canSync && (
                    <>
                      <button className={btn} disabled={busy !== null} onClick={() => void run(`test:${c.id}`, () => api.testProviderConnection(c.id))}>Test</button>
                      <button className={btn} disabled={busy !== null} onClick={() => void run(`sync:${c.id}`, () => (c.legacy ? syncHostinger() : api.syncProviderConnection(c.id)))}>
                        <RefreshCw className={`w-3.5 h-3.5 ${busy === `sync:${c.id}` ? 'animate-spin' : ''}`} />
                        Sync
                      </button>
                    </>
                  )}
                  {canManage && (
                    <button className={btn} disabled={busy !== null} onClick={() => void run(`en:${c.id}`, () => api.updateProviderConnection(c.id, { syncEnabled: !c.syncEnabled }))}>
                      {c.syncEnabled ? 'Disable sync' : 'Enable sync'}
                    </button>
                  )}
                </div>
              </div>
              <div className={isDark ? 'text-slate-500' : 'text-slate-500'}>
                Last success {fmtDateTime(c.lastSuccessAt)} · last attempt {fmtDateTime(c.lastSyncAt)}
              </div>
              {c.lastError && <div className="text-amber-500">Last error: {c.lastError}</div>}
              {canManage && (
                <form key={`${c.id}:${c.name}`} className="flex flex-col sm:flex-row gap-2" onSubmit={e => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  const name = String(data.get('name') ?? '').trim();
                  if (name && name !== c.name) void run(`rename:${c.id}`, () => api.updateProviderConnection(c.id, { name }));
                }}>
                  <input name="name" defaultValue={c.name} maxLength={80} className={input} aria-label={`Rename ${c.name}`} />
                  <button className={btn} type="submit" disabled={busy !== null}>Rename</button>
                </form>
              )}
            </div>
          ))}
        </div>
        {canManage && (
          <form className="flex flex-col lg:flex-row gap-2 pt-2" onSubmit={e => {
            e.preventDefault();
            void run('create', async () => {
              await api.createProviderConnection({ name: draft.name.trim(), provider: 'hostinger', tokenEnv: draft.tokenEnv.trim() });
              setDraft({ name: '', tokenEnv: '' });
            });
          }}>
            <input className={input} placeholder="Connection name" value={draft.name} maxLength={80} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} aria-label="Connection name" />
            <input className={input} placeholder="HOSTINGER_DR_API_TOKEN" value={draft.tokenEnv} onChange={e => setDraft(d => ({ ...d, tokenEnv: e.target.value.toUpperCase() }))} aria-label="Environment variable name" />
            <button className={btn} type="submit" disabled={busy !== null}>Add Hostinger account</button>
          </form>
        )}
        {formError && <p className="text-rose-500">{formError}</p>}
      </div>

      <div className="flex flex-col md:flex-row flex-wrap gap-2 text-xs font-mono">
        <select className={input} aria-label="Provider" value={filters.provider} onChange={e => setFilters(f => ({ ...f, provider: e.target.value }))}>
          <option value="">All providers</option>
          <option value="hostinger">Hostinger</option>
        </select>
        <select className={input} aria-label="Connection" value={filters.connectionId} onChange={e => setFilters(f => ({ ...f, connectionId: e.target.value }))}>
          <option value="">All connections</option>
          {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={input} aria-label="Connection status" value={filters.connectionStatus} onChange={e => setFilters(f => ({ ...f, connectionStatus: e.target.value }))}>
          <option value="">Any connection status</option>
          {Object.entries(PROVIDER_DISPLAY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className={input} aria-label="Region" value={filters.region} onChange={e => setFilters(f => ({ ...f, region: e.target.value }))}>
          <option value="">All regions</option>
          <option value={providerRegionFilterValue(null)}>No region</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className={input} aria-label="VPS status" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="">Any VPS status</option>
          <option value="HEALTHY">Healthy</option>
          <option value="DEGRADED">Degraded</option>
          <option value="UNAVAILABLE">Unavailable</option>
          <option value="UNKNOWN">Unknown</option>
        </select>
        <input className={input} placeholder="Hostname, IP, or VM id" aria-label="Search inventory" value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} />
        {filtersActive && <button className={btn} onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Server}
          title={filtersActive ? 'No virtual machines match these filters' : instances.length === 0 ? 'No virtual machines yet' : 'No virtual machines to show'}
          description={filtersActive ? 'Clear the filters to see the full inventory, including instances missing from the latest sync.' : 'Sync a configured account to load its VPS instances. A failed sync keeps the previous list.'}
          action={filtersActive ? { label: 'Clear filters', onClick: () => setFilters(EMPTY_FILTERS) } : undefined}
        />
      ) : (
        <div className={card}>
          <div className="w-full min-w-0 overflow-x-auto">
            <table className="w-full text-left text-xs font-mono min-w-[980px]">
              <thead className={`font-medium border-b ${isDark ? 'text-slate-400 border-[#1A2332]' : 'text-slate-600 border-slate-200'}`}>
                <tr>
                  <th className="py-2.5 px-3.5">Connection</th>
                  <th className="py-2.5 px-3.5">Hostname</th>
                  <th className="py-2.5 px-3.5">Region</th>
                  <th className="py-2.5 px-3.5">Plan</th>
                  <th className="py-2.5 px-3.5">CPU / RAM / Disk</th>
                  <th className="py-2.5 px-3.5">OS</th>
                  <th className="py-2.5 px-3.5">IP</th>
                  <th className="py-2.5 px-3.5">State</th>
                  <th className="py-2.5 px-3.5">Registered server</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
                {filtered.map(vm => {
                  const matches = [...vm.ipv4, ...vm.ipv6].map(ip => serverByIp.get(ip)).filter((s): s is VpsServer => Boolean(s));
                  const sc = stateColor(vm.status, vm.absent);
                  return (
                    <tr key={vm.id} className={isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}>
                      <td className="py-2.5 px-3.5">{vm.connectionName}</td>
                      <td className={`py-2.5 px-3.5 font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{vm.hostname || '—'}</td>
                      <td className="py-2.5 px-3.5">{vm.region || '—'}</td>
                      <td className="py-2.5 px-3.5">{vm.plan || '—'}</td>
                      <td className="py-2.5 px-3.5">{vm.cpu === null ? '—' : `${vm.cpu} vCPU`} · {fmtGb(vm.ramGb)} · {fmtGb(vm.diskGb)}</td>
                      <td className="py-2.5 px-3.5">{vm.os || '—'}</td>
                      <td className="py-2.5 px-3.5">{[...vm.ipv4, ...vm.ipv6].join(', ') || '—'}</td>
                      <td className="py-2.5 px-3.5">
                        <span className={`${sc.text} font-bold text-[11px] flex items-center gap-1`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                          <span>{vm.absent ? 'ABSENT' : (vm.powerState || vm.status)}</span>
                        </span>
                      </td>
                      <td className="py-2.5 px-3.5">
                        {matches.length > 0 ? matches.map(s => (
                          <span key={s.id} className="flex items-center gap-1 text-emerald-500 font-medium">
                            <Link2 className="w-3 h-3" />
                            {s.hostname}
                          </span>
                        )) : <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>Not registered</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filtered.some(vm => vm.absent) && (
        <p className={`text-[11px] font-mono flex items-start gap-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
          <span>Absent means a successful sync no longer lists that VPS. The row is kept. A failed sync does not mark instances absent and does not delete registered servers.</span>
        </p>
      )}

      {instances.some(vm => ![...vm.ipv4, ...vm.ipv6].some(ip => serverByIp.has(ip))) && (
        <p className={`text-[11px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
          VMs marked “Not registered” are not monitored yet.{' '}
          <button onClick={() => navigate('/setup')} className="text-blue-500 hover:underline cursor-pointer">Register them in Setup</button>.
          Matching by IP is a hint. Only the built-in HOSTINGER_API_TOKEN account copies plan and region onto a registered server.
        </p>
      )}
    </div>
  );
};
