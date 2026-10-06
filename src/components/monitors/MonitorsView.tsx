import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import {
  Search,
  RefreshCw,
  Plus,
  Trash2,
  PauseCircle,
  PlayCircle,
  BarChart3,
  List,
  Pencil,
  Copy,
  Check,
  Radio,
  Loader2,
} from 'lucide-react';
import { HeartbeatPulseChart } from '../visuals/HeartbeatPulseChart';
import { EndpointMetricsVisualizer, formatMonitorReading } from './EndpointMetricsVisualizer';
import { MonitorFormModal, monitorTypeGroup, PUSH_MONITOR_TYPES } from './CreateMonitorModal';
import { EmptyState } from '../ui/EmptyState';
import { Monitor, OperationalStatus } from '../../types';

const FILTERS = ['ALL', 'FAILING', 'HTTP', 'TCP', 'DNS', 'SSL', 'INFRA', 'PUSH'] as const;
type Filter = typeof FILTERS[number];

const isFailing = (m: Monitor) => m.enabled && (m.status === 'CRITICAL' || m.status === 'WARNING' || m.status === 'STALE');

const statusText = (s: OperationalStatus) =>
  s === 'HEALTHY' ? 'text-emerald-500'
    : s === 'WARNING' ? 'text-amber-500'
      : s === 'CRITICAL' || s === 'STALE' ? 'text-rose-500'
        : 'text-slate-500';

const statusDot = (s: OperationalStatus) =>
  s === 'HEALTHY' ? 'bg-emerald-500'
    : s === 'WARNING' ? 'bg-amber-500'
      : s === 'CRITICAL' || s === 'STALE' ? 'bg-rose-500 animate-pulse'
        : 'bg-slate-500';

const historyBar = (s: OperationalStatus) =>
  s === 'HEALTHY' ? 'bg-emerald-500/80'
    : s === 'WARNING' ? 'bg-amber-500'
      : s === 'CRITICAL' || s === 'STALE' ? 'bg-rose-500'
        : 'bg-slate-500/50';

export const heartbeatUrl = (m: Monitor) =>
  m.heartbeatToken ? `${window.location.origin}/api/v1/heartbeat/${m.heartbeatToken}` : '';

/** Ping URL + copy button for push-based monitors (token is only sent to admins). */
const PingUrl: React.FC<{ monitor: Monitor; isDark: boolean }> = ({ monitor, isDark }) => {
  const { notify } = useOps();
  const [copied, setCopied] = useState(false);
  const url = heartbeatUrl(monitor);
  if (!url) return null;
  const example = monitor.type === 'DB_REPLICATION' ? `${url}?value=<lag-seconds>` : url;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      notify('success', 'Ping URL copied');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      notify('error', 'Could not copy — select the URL and copy it manually');
    }
  };
  return (
    <div className={`mt-1 flex items-center gap-1 text-[10px] font-mono ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
      <span className="opacity-70 shrink-0">Ping:</span>
      <span className="truncate max-w-[220px] select-all" title={example}>{example}</span>
      <button
        type="button"
        onClick={copy}
        className={`p-0.5 rounded cursor-pointer shrink-0 ${isDark ? 'hover:bg-[#1D2B44]' : 'hover:bg-slate-200'}`}
        title="Copy ping URL"
      >
        {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  );
};

// ── Main MonitorsView ─────────────────────────────────────────────────────────
export const MonitorsView: React.FC = () => {
  const {
    monitors,
    applications,
    runProbeCheck,
    runAllProbes,
    deleteMonitor,
    toggleMonitorStatus,
    openAddMonitorWithContext,
    isLoading,
    theme,
  } = useOps();
  const { canDo } = useAuth();
  const navigate = useNavigate();
  const isDark = theme === 'dark';

  const canCreate = canDo('create_monitor');
  const canUpdate = canDo('update_monitor');
  const canDelete = canDo('delete_monitor');
  const canProbe = canDo('run_probe');

  const [filterType, setFilterType] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [probingId, setProbingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isProbingAll, setIsProbingAll] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Monitor | null>(null);
  const [viewMode, setViewMode] = useState<'visualizer' | 'table'>('visualizer');

  const handleProbeAll = async () => {
    setIsProbingAll(true);
    try { await runAllProbes(); } finally { setIsProbingAll(false); }
  };

  const handleManualCheck = async (id: string) => {
    setProbingId(id);
    try { await runProbeCheck(id); } finally { setProbingId(null); }
  };

  const handleToggle = async (id: string) => {
    setTogglingId(id);
    try { await toggleMonitorStatus(id); } finally { setTogglingId(null); }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteMonitor(id);
      setConfirmDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  };

  const filteredMonitors = monitors
    .filter(m => {
      if (filterType === 'ALL') return true;
      if (filterType === 'FAILING') return isFailing(m);
      return monitorTypeGroup(m.type) === filterType;
    })
    .filter(m => {
      const q = search.toLowerCase();
      const app = applications.find(a => a.id === m.applicationId);
      return (
        m.name.toLowerCase().includes(q) ||
        m.target.toLowerCase().includes(q) ||
        (app?.name ?? '').toLowerCase().includes(q)
      );
    });

  const failingCount = monitors.filter(isFailing).length;

  return (
    <div className="space-y-6">

      {editing && (
        <MonitorFormModal key={editing.id} existing={editing} onClose={() => setEditing(null)} />
      )}

      {/* Header */}
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            MONITORS &amp; HEARTBEATS
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Scheduled HTTP(S), TCP, DNS, SSL and agent resource checks, plus push heartbeats
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className={`p-0.5 rounded-md border flex items-center ${
            isDark ? 'bg-[#0B0F17] border-[#1E293B]' : 'bg-slate-100 border-slate-300'
          }`}>
            <button
              onClick={() => setViewMode('visualizer')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-medium rounded transition-colors cursor-pointer ${
                viewMode === 'visualizer'
                  ? 'bg-blue-600 text-white font-bold shadow-xs'
                  : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>LATENCY &amp; UPTIME</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-medium rounded transition-colors cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-blue-600 text-white font-bold shadow-xs'
                  : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>PROBES TABLE</span>
            </button>
          </div>

          {canCreate && (
            <button
              onClick={() => openAddMonitorWithContext()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold rounded transition-all bg-blue-600 hover:bg-blue-500 text-white shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>CREATE MONITOR</span>
            </button>
          )}

          {canProbe && (
            <button
              onClick={handleProbeAll}
              disabled={isProbingAll || monitors.length === 0}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium rounded transition-colors border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                isDark
                  ? 'text-slate-200 bg-[#162033] hover:bg-[#1C2942] border-[#243552]'
                  : 'text-slate-700 bg-white hover:bg-slate-50 border-slate-300 shadow-xs'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 text-blue-500 ${isProbingAll ? 'animate-spin' : ''}`} />
              <span>{isProbingAll ? 'PROBING…' : 'PROBE ALL'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Outbound dead-man heartbeat status */}
      <HeartbeatPulseChart />

      {isLoading && monitors.length === 0 ? (
        <div className={`flex items-center gap-2 text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading monitors…
        </div>
      ) : monitors.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="No monitors configured"
          description={canCreate
            ? 'Create a monitor for an application URL, a server port, a certificate or a push heartbeat. Register servers and applications in Setup first to link them.'
            : 'An IT administrator needs to create monitors. Servers and applications are registered in Setup.'}
          action={canCreate
            ? { label: 'Create monitor', onClick: () => openAddMonitorWithContext() }
            : { label: 'Open Setup', onClick: () => navigate('/setup') }}
        />
      ) : viewMode === 'visualizer' ? (
        <EndpointMetricsVisualizer />
      ) : (
        <>
          {/* How alerting works (reflects per-monitor configuration) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 font-mono text-xs">
            <div className={`p-3 rounded border space-y-1 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
              <div className="text-[9px] font-bold text-blue-500 uppercase tracking-wider">Failure confirmation</div>
              <p className={`text-[11px] font-sans leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                A monitor turns CRITICAL only after its configured number of consecutive failed checks (each check retries first).
              </p>
            </div>
            <div className={`p-3 rounded border space-y-1 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
              <div className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">Recovery confirmation</div>
              <p className={`text-[11px] font-sans leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Recovery requires the configured number of consecutive passing checks, which prevents flapping alerts.
              </p>
            </div>
            <div className={`p-3 rounded border space-y-1 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
              <div className="text-[9px] font-bold text-indigo-500 uppercase tracking-wider">Push heartbeats</div>
              <p className={`text-[11px] font-sans leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Cron, worker, backup and replication monitors wait for your job to call their ping URL; silence past the grace period is a failure.
              </p>
            </div>
          </div>

          {/* Filter and Search Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-xs">
            <div className="flex flex-wrap items-center gap-1">
              {FILTERS.map(t => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                    filterType === t
                      ? 'bg-blue-600 text-white font-semibold shadow-xs'
                      : isDark
                        ? 'text-slate-400 hover:bg-[#162033]'
                        : 'text-slate-600 hover:bg-slate-200 bg-slate-100'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
              <input
                type="text"
                placeholder="Search probe or target..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className={`w-full pl-8 pr-3 py-1 rounded text-xs focus:outline-none focus:border-blue-500 border ${
                  isDark
                    ? 'bg-[#0B0F17] border-[#1E293B] text-slate-200'
                    : 'bg-white border-slate-300 text-slate-900 shadow-xs'
                }`}
              />
            </div>
          </div>

          <div className={`text-[11px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
            Showing {filteredMonitors.length} of {monitors.length} monitors
            {failingCount > 0 && <span className="text-rose-400 ml-2 font-semibold">· {failingCount} failing</span>}
          </div>

          {/* Monitors Table */}
          <div className={`rounded-lg border overflow-hidden transition-colors ${
            isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
          }`}>
            <div className="w-full min-w-0 overflow-x-auto">
              <table className="w-full text-left text-xs font-mono min-w-[860px]">
                <thead className={`font-medium border-b ${
                  isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}>
                  <tr>
                    <th className="py-2.5 px-3.5">Monitor / Target</th>
                    <th className="py-2.5 px-3.5">Type</th>
                    <th className="py-2.5 px-3.5">Application</th>
                    <th className="py-2.5 px-3.5">Recent Checks</th>
                    <th className="py-2.5 px-3.5">Interval</th>
                    <th className="py-2.5 px-3.5">Consecutive</th>
                    <th className="py-2.5 px-3.5">Last Check</th>
                    <th className="py-2.5 px-3.5">Reading</th>
                    <th className="py-2.5 px-3.5">Health</th>
                    <th className="py-2.5 px-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
                  {filteredMonitors.length === 0 ? (
                    <tr>
                      <td colSpan={10} className={`py-12 text-center text-xs font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                        No monitors match your filter.
                      </td>
                    </tr>
                  ) : filteredMonitors.map(m => {
                    const app = applications.find(a => a.id === m.applicationId);
                    const failing = isFailing(m);
                    const isProbing = probingId === m.id;
                    const lastCheckDate = m.lastCheck ? new Date(m.lastCheck) : null;
                    const lastCheckStr = lastCheckDate && !Number.isNaN(lastCheckDate.getTime())
                      ? lastCheckDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                      : '—';
                    // Real check history, oldest → newest (history is stored newest first)
                    const recent = (m.history || []).slice(0, 24).reverse();
                    const reading = formatMonitorReading(m);
                    const isPush = PUSH_MONITOR_TYPES.includes(m.type);

                    return (
                      <tr
                        key={m.id}
                        className={`transition-colors ${
                          failing
                            ? (isDark ? 'bg-[#180E13]' : 'bg-rose-50/60')
                            : (isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50')
                        }`}
                      >
                        <td className="py-2.5 px-3.5 font-sans">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.enabled ? statusDot(m.status) : 'bg-slate-500'}`} />
                            <span className="font-semibold truncate max-w-[180px]" title={m.name}>{m.name}</span>
                          </div>
                          {!(isPush && (m.target === 'push' || !m.target)) && (
                            <div className={`text-[10px] font-mono mt-0.5 truncate max-w-[220px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`} title={m.target}>
                              {m.target}
                            </div>
                          )}
                          {isPush && <PingUrl monitor={m} isDark={isDark} />}
                        </td>

                        <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{m.type}</td>

                        <td className="py-2.5 px-3.5 font-sans">
                          {app?.name || <span className={`italic ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>None</span>}
                          <span className={`ml-1 text-[10px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{m.environment}</span>
                        </td>

                        <td className="py-2.5 px-3.5">
                          {recent.length === 0 ? (
                            <span className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>No checks yet</span>
                          ) : (
                            <>
                              <div className="flex items-center gap-0.5">
                                {recent.map((h, idx) => (
                                  <span
                                    key={idx}
                                    className={`w-1 h-3.5 rounded-sm ${historyBar(h.status)}`}
                                    title={`${Number.isNaN(Date.parse(h.timestamp)) ? '' : new Date(h.timestamp).toLocaleString()} · ${h.status}${h.detail ? ` · ${h.detail}` : ''}`}
                                  />
                                ))}
                              </div>
                              <div className={`text-[9px] mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                                Last {recent.length} check{recent.length > 1 ? 's' : ''}
                              </div>
                            </>
                          )}
                        </td>

                        <td className={`py-2.5 px-3.5 tabular-nums ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                          {m.intervalSec}s
                        </td>

                        <td className="py-2.5 px-3.5 tabular-nums">
                          {m.consecutiveFailures > 0 ? (
                            <span className="text-rose-500 font-bold">
                              {m.consecutiveFailures}/{m.failureConfirmationThreshold} fails
                            </span>
                          ) : m.consecutiveRecoveries > 0 ? (
                            <span className="text-emerald-500">{m.consecutiveRecoveries} passes</span>
                          ) : (
                            <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>—</span>
                          )}
                        </td>

                        <td className={`py-2.5 px-3.5 tabular-nums text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                          {lastCheckStr}
                        </td>

                        <td className="py-2.5 px-3.5 tabular-nums">
                          <span className={reading.tone === 'crit' ? 'text-rose-500 font-bold' : reading.tone === 'warn' ? 'text-amber-500' : ''} title={reading.hint}>
                            {reading.text}
                          </span>
                        </td>

                        <td className="py-2.5 px-3.5">
                          <span className={`font-semibold ${m.enabled ? statusText(m.status) : 'text-slate-500'}`}>
                            {!m.enabled ? 'PAUSED' : m.activeMaintenance ? 'MAINTENANCE' : m.status}
                          </span>
                        </td>

                        <td className="py-2.5 px-3.5 text-right font-sans">
                          <div className="flex items-center justify-end gap-1 font-mono">
                            {canProbe && (
                              <button
                                onClick={() => handleManualCheck(m.id)}
                                disabled={isProbing || !m.enabled}
                                className={`px-2 py-0.5 rounded text-[11px] transition-colors inline-flex items-center gap-1 border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                  isDark
                                    ? 'text-slate-300 hover:text-white hover:bg-[#1D2B44] border-[#23334E]'
                                    : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100 border-slate-300'
                                }`}
                                title={isPush ? 'Re-evaluate ping freshness now' : 'Run check now'}
                              >
                                <RefreshCw className={`w-3 h-3 ${isProbing ? 'animate-spin text-blue-500' : ''}`} />
                                <span className="hidden sm:inline">{isProbing ? '…' : 'PROBE'}</span>
                              </button>
                            )}

                            {canUpdate && (
                              <>
                                <button
                                  onClick={() => setEditing(m)}
                                  className={`p-1 rounded transition-colors border cursor-pointer ${
                                    isDark ? 'text-slate-300 hover:bg-[#1D2B44] border-[#23334E]' : 'text-slate-600 hover:bg-slate-100 border-slate-300'
                                  }`}
                                  title="Edit monitor"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleToggle(m.id)}
                                  disabled={togglingId === m.id}
                                  className={`p-1 rounded text-[11px] transition-colors border cursor-pointer disabled:opacity-40 ${
                                    m.enabled
                                      ? (isDark ? 'text-amber-400 hover:bg-amber-950/40 border-amber-900/40' : 'text-amber-600 hover:bg-amber-50 border-amber-200')
                                      : (isDark ? 'text-emerald-400 hover:bg-emerald-950/40 border-emerald-900/40' : 'text-emerald-600 hover:bg-emerald-50 border-emerald-200')
                                  }`}
                                  title={m.enabled ? 'Pause monitoring' : 'Resume monitoring'}
                                >
                                  {togglingId === m.id
                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    : m.enabled ? <PauseCircle className="w-3.5 h-3.5" /> : <PlayCircle className="w-3.5 h-3.5" />}
                                </button>
                              </>
                            )}

                            {canDelete && (confirmDeleteId === m.id ? (
                              <div className="flex items-center gap-1 animate-in fade-in">
                                <button
                                  onClick={() => handleDelete(m.id)}
                                  disabled={deletingId === m.id}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer disabled:opacity-60 inline-flex items-center gap-1"
                                  title="Confirm delete"
                                >
                                  {deletingId === m.id && <Loader2 className="w-3 h-3 animate-spin" />}
                                  DELETE
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  disabled={deletingId === m.id}
                                  className="px-1.5 py-0.5 rounded text-[10px] bg-slate-600 hover:bg-slate-500 text-white cursor-pointer"
                                  title="Cancel"
                                >
                                  NO
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteId(m.id)}
                                className={`p-1 rounded transition-colors border cursor-pointer ${
                                  isDark
                                    ? 'text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 border-transparent hover:border-rose-900/50'
                                    : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50 border-transparent hover:border-rose-200'
                                }`}
                                title="Delete monitor"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
