import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { Server, RefreshCw, AlertTriangle, KeyRound, Link2 } from 'lucide-react';
import { api } from '../../services/api';
import { VpsServer, HostingerInfo } from '../../types';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { SkeletonTable } from '../ui/Skeleton';

/** Normalised view of a Hostinger VM (the API payload is read defensively). */
interface VmRow {
  id: string;
  hostname: string;
  state: string;
  cpus: number | null;
  memoryMb: number | null;
  diskMb: number | null;
  plan: string;
  ipv4: string[];
  template: string;
  dataCenter: string;
}

/** Rows come from the server's normalised Hostinger data (unknown fields stay null / empty). */
const toRow = (vm: HostingerInfo): VmRow => ({
  id: String(vm.vmId),
  hostname: vm.hostname ?? '',
  state: vm.state ?? '',
  cpus: vm.cpus,
  memoryMb: vm.ramGb !== null ? vm.ramGb * 1024 : null,
  diskMb: vm.diskGb !== null ? vm.diskGb * 1024 : null,
  plan: vm.plan ?? '',
  ipv4: vm.ipv4,
  template: vm.os ?? '',
  dataCenter: vm.region ?? '',
});

const fmtGb = (mb: number | null) => (mb === null ? '—' : `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`);

const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const stateColor = (s: string) => {
  const v = s.toLowerCase();
  if (v === 'running') return { text: 'text-emerald-500', dot: 'bg-emerald-500' };
  if (v === 'stopped' || v === 'error' || v === 'suspended') return { text: 'text-rose-500', dot: 'bg-rose-500' };
  if (!v) return { text: 'text-slate-400', dot: 'bg-slate-400' };
  return { text: 'text-amber-500', dot: 'bg-amber-500' };
};

export const HostingerView: React.FC = () => {
  const { servers, theme, integrations, syncHostinger } = useOps();
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const isDark = theme === 'dark';
  const canSync = hasRole('operator');

  const [state, setState] = useState<{ configured: boolean; lastSyncAt: string | null; lastError: string | null; vms: VmRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getHostingerVms();
      setState({
        configured: Boolean(res.configured),
        lastSyncAt: res.lastSyncAt ?? null,
        lastError: res.lastError ?? null,
        vms: (Array.isArray(res.data) ? res.data : []).map(toRow),
      });
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncHostinger();
      await load();
    } finally {
      setSyncing(false);
    }
  };

  // Registered servers matched to Hostinger VMs by IP address
  const serverByIp = useMemo(() => {
    const map = new Map<string, VpsServer>();
    for (const s of servers) if (s.ip) map.set(s.ip, s);
    return map;
  }, [servers]);

  const configured = state?.configured ?? integrations?.hostinger.configured ?? false;
  const lastSyncAt = state?.lastSyncAt ?? integrations?.hostinger.lastSyncAt ?? null;
  const lastError = state?.lastError ?? integrations?.hostinger.lastError ?? null;
  const vms = state?.vms ?? [];

  const matched = vms.filter(vm => vm.ipv4.some(ip => serverByIp.has(ip)));
  const totals = {
    cpus: vms.reduce((n, v) => n + (v.cpus ?? 0), 0),
    memMb: vms.reduce((n, v) => n + (v.memoryMb ?? 0), 0),
    diskMb: vms.reduce((n, v) => n + (v.diskMb ?? 0), 0),
    running: vms.filter(v => v.state.toLowerCase() === 'running').length,
  };
  const unmatchedServers = servers.filter(s => !vms.some(vm => vm.ipv4.includes(s.ip)));

  const card = `p-3 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`;
  const label = `text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`;
  const value = `text-base font-bold tabular-nums ${isDark ? 'text-slate-100' : 'text-slate-900'}`;
  const sub = `text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`;

  const header = (
    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
      <div>
        <h1 className="text-lg font-bold font-mono tracking-tight">HOSTINGER VPS INVENTORY</h1>
        <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          Virtual machines reported by the Hostinger API, matched to registered servers by IP · last sync {fmtDateTime(lastSyncAt)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {configured && (
          <span className={`text-[11px] font-mono px-2 py-0.5 rounded flex items-center gap-1.5 border ${
            lastError
              ? isDark ? 'text-amber-400 bg-amber-950/60 border-amber-900/80' : 'text-amber-700 bg-amber-50 border-amber-200'
              : isDark ? 'text-emerald-400 bg-emerald-950/60 border-emerald-900/80' : 'text-emerald-700 bg-emerald-50 border-emerald-200'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${lastError ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            <span>{lastError ? 'Hostinger API: last sync failed' : lastSyncAt ? 'Hostinger API: synced' : 'Hostinger API: not synced yet'}</span>
          </span>
        )}
        {configured && canSync && (
          <button
            onClick={() => void handleSync()}
            disabled={syncing}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${isDark ? 'bg-[#162033] border-[#243552] text-slate-200 hover:bg-[#1C2942]' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 shadow-xs'}`}
          >
            <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
        )}
      </div>
    </div>
  );

  if (loading && !state) {
    return <div className="space-y-6">{header}<SkeletonTable rows={4} cols={7} /></div>;
  }

  if (error && !state) {
    return <div className="space-y-6">{header}<ErrorState error={error} onRetry={() => void load()} /></div>;
  }

  if (!configured) {
    return (
      <div className="space-y-6">
        {header}
        <div className={`p-5 rounded-lg border font-mono text-xs space-y-3 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
          <div className="flex items-center gap-2 font-bold text-sm">
            <KeyRound className="w-4 h-4 text-amber-500" />
            <span>Hostinger not configured</span>
          </div>
          <p className={isDark ? 'text-slate-300' : 'text-slate-700'}>
            Connect the Hostinger API to list your VPS instances and enrich registered servers with plan, CPU, memory, disk and data-center details.
          </p>
          <ol className={`list-decimal pl-5 space-y-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            <li>In Hostinger hPanel open <span className="font-semibold">Account → API</span> and generate an API token.</li>
            <li>Add it to the server <span className="font-semibold">.env</span> file as <code className={`px-1 rounded ${isDark ? 'bg-[#0B0F17]' : 'bg-slate-100'}`}>HOSTINGER_API_TOKEN=&lt;token&gt;</code>.</li>
            <li>Restart the Scholario Ops server.</li>
          </ol>
          {lastError && <p className="text-rose-500">Last error: {lastError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {lastError && (
        <div className={`p-3.5 rounded border text-xs font-mono flex items-start gap-2 ${isDark ? 'bg-[#1F1710] border-amber-900/80 text-amber-300' : 'bg-amber-50 border-amber-300 text-amber-800'}`}>
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>Last Hostinger sync failed: {lastError}. Data below is from the last successful sync, if any.</span>
        </div>
      )}

      {vms.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
          <div className={card}>
            <div className={label}>Virtual machines</div>
            <div className={value}>{vms.length}</div>
            <div className={sub}>{totals.running} running</div>
          </div>
          <div className={card}>
            <div className={label}>Total vCPU</div>
            <div className={value}>{totals.cpus || '—'}</div>
          </div>
          <div className={card}>
            <div className={label}>Total memory</div>
            <div className={value}>{totals.memMb ? fmtGb(totals.memMb) : '—'}</div>
          </div>
          <div className={card}>
            <div className={label}>Registered in Scholario Ops</div>
            <div className={value}>{matched.length} / {vms.length}</div>
            <div className={sub}>Matched by IPv4 address</div>
          </div>
        </div>
      )}

      {vms.length === 0 ? (
        <EmptyState
          icon={Server}
          title={lastSyncAt ? 'No virtual machines returned' : 'Not synced yet'}
          description={lastSyncAt ? 'The Hostinger API returned no VPS instances for this token.' : 'Run a sync to load VPS instances from the Hostinger API.'}
          action={canSync ? { label: syncing ? 'Syncing…' : 'Sync now', onClick: () => { if (!syncing) void handleSync(); } } : undefined}
        />
      ) : (
        <div className={`rounded-lg border overflow-hidden transition-colors ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
          <div className="w-full min-w-0 overflow-x-auto">
            <table className="w-full text-left text-xs font-mono min-w-[900px]">
              <thead className={`font-medium border-b ${isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                <tr>
                  <th className="py-2.5 px-3.5">Hostname</th>
                  <th className="py-2.5 px-3.5">Data center</th>
                  <th className="py-2.5 px-3.5">Plan</th>
                  <th className="py-2.5 px-3.5">CPU / RAM / Disk</th>
                  <th className="py-2.5 px-3.5">OS template</th>
                  <th className="py-2.5 px-3.5">IPv4</th>
                  <th className="py-2.5 px-3.5">State</th>
                  <th className="py-2.5 px-3.5">Registered server</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
                {vms.map(vm => {
                  const matches = vm.ipv4.map(ip => serverByIp.get(ip)).filter((s): s is VpsServer => Boolean(s));
                  const sc = stateColor(vm.state);
                  return (
                    <tr key={vm.id} className={isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}>
                      <td className={`py-2.5 px-3.5 font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{vm.hostname || '—'}</td>
                      <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{vm.dataCenter || '—'}</td>
                      <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{vm.plan || '—'}</td>
                      <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                        {vm.cpus === null ? '—' : `${vm.cpus} vCPU`} · {fmtGb(vm.memoryMb)} · {fmtGb(vm.diskMb)}
                      </td>
                      <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{vm.template || '—'}</td>
                      <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{vm.ipv4.length ? vm.ipv4.join(', ') : '—'}</td>
                      <td className="py-2.5 px-3.5">
                        <span className={`${sc.text} font-bold text-[11px] flex items-center gap-1`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                          <span>{vm.state ? vm.state.toUpperCase() : 'UNKNOWN'}</span>
                        </span>
                      </td>
                      <td className="py-2.5 px-3.5">
                        {matches.length > 0 ? (
                          matches.map(s => (
                            <span key={s.id} className="flex items-center gap-1 text-emerald-500 font-medium">
                              <Link2 className="w-3 h-3" />
                              {s.hostname} <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>({s.environment})</span>
                            </span>
                          ))
                        ) : (
                          <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>Not registered</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {vms.length > 0 && matched.length < vms.length && (
        <p className={`text-[11px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
          VMs marked “Not registered” are not monitored yet.{' '}
          <button onClick={() => navigate('/setup')} className="text-blue-500 hover:underline cursor-pointer">Register them in Setup</button>.
        </p>
      )}

      {vms.length > 0 && unmatchedServers.length > 0 && (
        <p className={`text-[11px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
          Registered servers with no matching Hostinger VM: {unmatchedServers.map(s => `${s.hostname} (${s.ip || 'no IP'})`).join(', ')}.
        </p>
      )}
    </div>
  );
};
