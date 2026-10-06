import React, { useState, useMemo } from 'react';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import {
  Activity,
  TrendingUp,
  ShieldCheck,
  AlertTriangle,
  Zap,
  RefreshCw,
  BarChart3,
  Gauge,
  Radio,
  Search,
} from 'lucide-react';
import { Monitor } from '../../types';
import { monitorTypeGroup } from './CreateMonitorModal';

// ── Helpers ───────────────────────────────────────────────────────────────────
const validDate = (iso?: string) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

const ago = (iso?: string) => {
  const d = validDate(iso);
  if (!d) return '—';
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/** Monitors whose responseTimeMs is a real network round-trip time */
const isLatencyMonitor = (m: Monitor) => ['HTTP', 'TCP', 'DNS', 'SSL'].includes(monitorTypeGroup(m.type));
const hasChecks = (m: Monitor) => (m.history?.length ?? 0) > 0 && Boolean(validDate(m.lastCheck));

export interface MonitorReading {
  text: string;
  tone: 'ok' | 'warn' | 'crit' | 'none';
  hint?: string;
}

/** Human readable "current value" of a monitor, respecting what the type actually measures. */
export const formatMonitorReading = (m: Monitor): MonitorReading => {
  const group = monitorTypeGroup(m.type);
  const toneFor = (v: number): MonitorReading['tone'] =>
    m.status === 'CRITICAL' || (m.criticalThresholdMs > 0 && v >= m.criticalThresholdMs) ? 'crit'
      : m.warningThresholdMs > 0 && v >= m.warningThresholdMs ? 'warn' : 'ok';

  if (group === 'PUSH') {
    if (m.type === 'DB_REPLICATION' && typeof m.lastValue === 'number') {
      return { text: `${m.lastValue}s lag`, tone: toneFor(m.lastValue * 1000), hint: `Last ping ${ago(m.lastPingAt)}` };
    }
    if (!validDate(m.lastPingAt)) return { text: 'No ping yet', tone: 'none' };
    return { text: `ping ${ago(m.lastPingAt)}`, tone: m.status === 'CRITICAL' ? 'crit' : 'ok', hint: typeof m.lastValue === 'number' ? `Last value ${m.lastValue}` : undefined };
  }
  if (!hasChecks(m)) return { text: '—', tone: 'none', hint: 'No checks yet' };
  if (group === 'INFRA') return { text: `${m.responseTimeMs}%`, tone: toneFor(m.responseTimeMs) };
  return { text: `${m.responseTimeMs}ms`, tone: toneFor(m.responseTimeMs) };
};

const toneText = (t: MonitorReading['tone']) =>
  t === 'crit' ? 'text-rose-400' : t === 'warn' ? 'text-amber-400' : t === 'ok' ? 'text-emerald-400' : 'text-slate-400';

const percentile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null;

export const EndpointMetricsVisualizer: React.FC = () => {
  const {
    monitors,
    applications,
    servers,
    runbooks,
    apiHealth,
    triggerHealthCheck,
    runProbeCheck,
    runAllProbes,
    theme,
  } = useOps();
  const { canDo } = useAuth();
  const canProbe = canDo('run_probe');
  const isDark = theme === 'dark';

  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'latency_desc' | 'latency_asc' | 'uptime_asc' | 'name'>('latency_desc');
  const [isPulling, setIsPulling] = useState(false);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null);

  const handleProbeAll = async () => {
    setIsPulling(true);
    try {
      await Promise.all([triggerHealthCheck(), runAllProbes()]);
    } finally {
      setIsPulling(false);
    }
  };

  const handleProbeOne = async (id: string) => {
    setProbingId(id);
    try { await runProbeCheck(id); } finally { setProbingId(null); }
  };

  // Aggregates computed only from monitors that actually have check data
  const metricsSummary = useMemo(() => {
    const enabled = monitors.filter(m => m.enabled);
    const healthy = enabled.filter(m => m.status === 'HEALTHY').length;
    const failing = enabled.filter(m => m.status === 'CRITICAL').length;
    const degraded = enabled.filter(m => m.status === 'WARNING').length;
    const noData = enabled.filter(m => m.status === 'UNKNOWN').length;

    const latencies = enabled
      .filter(m => isLatencyMonitor(m) && hasChecks(m) && m.responseTimeMs > 0)
      .map(m => m.responseTimeMs)
      .sort((a, b) => a - b);
    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;

    const withUptime = monitors.filter(hasChecks);
    const avgUptime = withUptime.length ? withUptime.reduce((a, m) => a + m.uptimePercent, 0) / withUptime.length : null;

    return {
      total: monitors.length,
      enabled: enabled.length,
      healthy,
      failing,
      degraded,
      noData,
      latencySamples: latencies.length,
      avgLatency,
      p50: percentile(latencies, 0.5),
      p90: percentile(latencies, 0.9),
      max: latencies.length ? latencies[latencies.length - 1] : null,
      avgUptime,
      uptimeSamples: withUptime.length,
    };
  }, [monitors]);

  const processedMonitors = useMemo(() => {
    const latencyKey = (m: Monitor) => (isLatencyMonitor(m) && hasChecks(m) ? m.responseTimeMs : null);
    return monitors
      .filter(m => {
        const g = monitorTypeGroup(m.type);
        if (selectedCategory === 'ALL') return true;
        if (selectedCategory === 'CRITICAL') return m.status === 'CRITICAL';
        if (selectedCategory === 'HEALTHY') return m.status === 'HEALTHY';
        if (selectedCategory === 'HTTPS') return g === 'HTTP';
        if (selectedCategory === 'NETWORK') return g === 'TCP' || g === 'DNS' || g === 'SSL';
        if (selectedCategory === 'INFRA') return g === 'INFRA';
        if (selectedCategory === 'PUSH') return g === 'PUSH';
        return true;
      })
      .filter(m => {
        const q = searchQuery.toLowerCase();
        const app = applications.find(a => a.id === m.applicationId);
        return (
          m.name.toLowerCase().includes(q) ||
          m.target.toLowerCase().includes(q) ||
          m.type.toLowerCase().includes(q) ||
          (app?.name || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        if (sortBy === 'uptime_asc') {
          const ua = hasChecks(a) ? a.uptimePercent : Infinity;
          const ub = hasChecks(b) ? b.uptimePercent : Infinity;
          return ua - ub;
        }
        const la = latencyKey(a);
        const lb = latencyKey(b);
        if (la === null && lb === null) return a.name.localeCompare(b.name);
        if (la === null) return 1;
        if (lb === null) return -1;
        return sortBy === 'latency_desc' ? lb - la : la - lb;
      });
  }, [monitors, selectedCategory, searchQuery, sortBy, applications]);

  const kpiCard = `p-3 rounded border space-y-1 ${isDark ? 'bg-[#0B0F17] border-slate-800/80' : 'bg-slate-50 border-slate-200'}`;
  const kpiValue = `text-lg font-bold font-sans tabular-nums ${isDark ? 'text-slate-100' : 'text-slate-900'}`;
  const ms = (v: number | null) => (v === null ? '—' : <>{v} <span className="text-xs font-mono font-normal text-slate-400">ms</span></>);
  const panel = isDark ? 'bg-[#0A0E18] border-slate-800' : 'bg-slate-50 border-slate-200';

  return (
    <div className="space-y-5 font-mono">

      {/* 1. Header & control-plane health */}
      <div className={`p-4 sm:p-5 rounded-lg border transition-colors ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded bg-blue-600/10 text-blue-500 border border-blue-500/20">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className={`text-base sm:text-lg font-bold font-sans tracking-tight flex flex-wrap items-center gap-2.5 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                <span>Monitor Latency &amp; Uptime</span>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold border ${
                  apiHealth.reachable
                    ? 'bg-emerald-950/80 border-emerald-800 text-emerald-300'
                    : 'bg-rose-950/80 border-rose-800 text-rose-300'
                }`}>
                  {apiHealth.reachable ? 'API REACHABLE' : 'API UNREACHABLE'}
                </span>
              </h2>
              <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Latest check results recorded by the monitoring engine
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className={`px-3 py-1.5 rounded border text-[11px] flex items-center gap-1.5 ${
              isDark ? 'bg-[#0B0F17] border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}>
              <Radio className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-slate-400">API /health:</span>
              <span className={apiHealth.lastChecked ? (apiHealth.latencyMs > 500 ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold') : 'text-slate-400'}>
                {apiHealth.lastChecked ? `${apiHealth.latencyMs}ms` : '—'}
              </span>
            </div>

            {canProbe && (
              <button
                onClick={handleProbeAll}
                disabled={isPulling}
                className="px-3.5 py-1.5 rounded text-xs font-mono font-bold bg-blue-600 hover:bg-blue-500 text-white transition-all flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="Run every enabled monitor now"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isPulling ? 'animate-spin' : ''}`} />
                <span>{isPulling ? 'RUNNING CHECKS…' : 'RUN ALL CHECKS NOW'}</span>
              </button>
            )}
          </div>
        </div>

        {/* 2. KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4 pt-4 border-t border-inherit">
          <div className={kpiCard}>
            <div className="text-[10px] text-slate-400 uppercase flex items-center justify-between">
              <span>Avg Latency</span>
              <Activity className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className={kpiValue}>{ms(metricsSummary.avgLatency)}</div>
            <div className="text-[10px] text-slate-400">
              {metricsSummary.latencySamples ? `Latest check of ${metricsSummary.latencySamples} monitor(s)` : 'No latency data yet'}
            </div>
          </div>

          <div className={kpiCard}>
            <div className="text-[10px] text-slate-400 uppercase flex items-center justify-between">
              <span>Median</span>
              <Gauge className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className={`${kpiValue} !text-emerald-400`}>{ms(metricsSummary.p50)}</div>
            <div className="text-[10px] text-slate-400">Across monitors</div>
          </div>

          <div className={kpiCard}>
            <div className="text-[10px] text-slate-400 uppercase flex items-center justify-between">
              <span>P90</span>
              <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className={`${kpiValue} !text-blue-400`}>{ms(metricsSummary.p90)}</div>
            <div className="text-[10px] text-slate-400">Across monitors</div>
          </div>

          <div className={kpiCard}>
            <div className="text-[10px] text-slate-400 uppercase flex items-center justify-between">
              <span>Slowest</span>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className={`${kpiValue} !text-amber-400`}>{ms(metricsSummary.max)}</div>
            <div className="text-[10px] text-slate-400">Highest latest latency</div>
          </div>

          <div className={kpiCard}>
            <div className="text-[10px] text-slate-400 uppercase flex items-center justify-between">
              <span>Avg 30d Uptime</span>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className={`${kpiValue} !text-emerald-400`}>
              {metricsSummary.avgUptime === null ? '—' : `${metricsSummary.avgUptime.toFixed(2)}%`}
            </div>
            <div className="text-[10px] text-slate-400">
              {metricsSummary.uptimeSamples ? `${metricsSummary.uptimeSamples} monitor(s) with checks` : 'No checks yet'}
            </div>
          </div>

          <div className={kpiCard}>
            <div className="text-[10px] text-slate-400 uppercase flex items-center justify-between">
              <span>Status</span>
              <Zap className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className={kpiValue}>
              {metricsSummary.healthy} <span className="text-xs font-mono font-normal text-slate-400">/ {metricsSummary.enabled} OK</span>
            </div>
            <div className="text-[10px] flex flex-wrap items-center gap-1.5">
              {metricsSummary.failing > 0 && <span className="text-rose-400 font-bold">{metricsSummary.failing} failing</span>}
              {metricsSummary.degraded > 0 && <span className="text-amber-400">{metricsSummary.degraded} warning</span>}
              {metricsSummary.noData > 0 && <span className="text-slate-400">{metricsSummary.noData} no data</span>}
              {metricsSummary.failing + metricsSummary.degraded + metricsSummary.noData === 0 && metricsSummary.enabled > 0 && (
                <span className="text-emerald-400">All enabled monitors healthy</span>
              )}
              {metricsSummary.enabled === 0 && <span className="text-slate-400">All monitors paused</span>}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
          {[
            { id: 'ALL', label: `All (${monitors.length})` },
            { id: 'CRITICAL', label: `Failing (${monitors.filter(m => m.status === 'CRITICAL').length})` },
            { id: 'HEALTHY', label: `Healthy (${monitors.filter(m => m.status === 'HEALTHY').length})` },
            { id: 'HTTPS', label: 'HTTP(S)' },
            { id: 'NETWORK', label: 'TCP / DNS / SSL' },
            { id: 'INFRA', label: 'Resources' },
            { id: 'PUSH', label: 'Heartbeats' },
          ].map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded transition-colors border cursor-pointer ${
                selectedCategory === cat.id
                  ? 'bg-blue-600 border-blue-500 text-white font-bold'
                  : isDark
                    ? 'bg-[#111726] hover:bg-[#182236] border-[#1E293B] text-slate-400'
                    : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-600 shadow-2xs'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search monitor or app..."
              className={`w-full pl-8 pr-3 py-1.5 rounded text-xs border outline-none font-mono ${
                isDark
                  ? 'bg-[#111726] border-[#1E293B] text-slate-200 focus:border-blue-500'
                  : 'bg-white border-slate-300 text-slate-900 focus:border-blue-500 shadow-2xs'
              }`}
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className={`px-2.5 py-1.5 rounded text-xs border font-mono outline-none cursor-pointer ${
              isDark ? 'bg-[#111726] border-[#1E293B] text-slate-300' : 'bg-white border-slate-300 text-slate-700 shadow-2xs'
            }`}
          >
            <option value="latency_desc">Sort: Highest Latency</option>
            <option value="latency_asc">Sort: Lowest Latency</option>
            <option value="uptime_asc">Sort: Lowest Uptime %</option>
            <option value="name">Sort: Name</option>
          </select>
        </div>
      </div>

      {/* 4. Monitor rows */}
      <div className="space-y-2.5">
        {processedMonitors.map(mon => {
          const app = applications.find(a => a.id === mon.applicationId);
          const serverIdForMon = mon.serverId || (app ? (mon.environment === 'DR' ? app.drServerId : app.prdServerId) : '');
          const server = servers.find(s => s.id === serverIdForMon);
          const runbook = mon.runbookId ? runbooks.find(r => r.id === mon.runbookId) : undefined;
          const group = monitorTypeGroup(mon.type);
          const isFailing = mon.enabled && mon.status === 'CRITICAL';
          const isDegraded = mon.enabled && mon.status === 'WARNING';
          const isSelected = selectedMonitorId === mon.id;
          const reading = formatMonitorReading(mon);
          const checked = hasChecks(mon);
          const lastCheck = validDate(mon.lastCheck);

          // Gauge bar: latency vs. this monitor's critical threshold, or % for resource monitors
          const showBar = checked && (isLatencyMonitor(mon) || group === 'INFRA');
          const scale = group === 'INFRA' ? 100 : Math.max(mon.responseTimeMs, mon.criticalThresholdMs, 1) * 1.1;
          const barPct = showBar ? Math.min(100, Math.max(2, (mon.responseTimeMs / scale) * 100)) : 0;
          const unit = group === 'INFRA' ? '%' : 'ms';

          const history = (mon.history || []).slice(0, 30).reverse();
          const historyMax = Math.max(1, ...history.map(h => h.responseTimeMs));

          return (
            <div
              key={mon.id}
              onClick={() => setSelectedMonitorId(isSelected ? null : mon.id)}
              className={`p-3.5 sm:p-4 rounded-lg border transition-all cursor-pointer ${
                isSelected
                  ? 'border-blue-500 ring-1 ring-blue-500/30'
                  : isFailing
                    ? isDark ? 'bg-[#170E12] border-rose-900/60' : 'bg-rose-50/70 border-rose-200'
                    : isDark
                      ? 'bg-[#111726] hover:bg-[#141C2E] border-[#1E293B]'
                      : 'bg-white hover:bg-slate-50 border-slate-200 shadow-xs'
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      !mon.enabled ? 'bg-slate-500' : isFailing ? 'bg-rose-500 animate-pulse' : isDegraded ? 'bg-amber-500' : mon.status === 'HEALTHY' ? 'bg-emerald-500' : 'bg-slate-500'
                    }`} />
                    <span className={`font-bold text-sm font-sans tracking-tight truncate ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                      {mon.name}
                    </span>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${isDark ? 'bg-slate-800 text-slate-300 border-slate-700' : 'bg-slate-100 text-slate-600 border-slate-300'}`}>
                      {mon.type}
                    </span>
                    <span className={`text-[10px] font-mono font-semibold ${!mon.enabled ? 'text-slate-500' : mon.status === 'HEALTHY' ? 'text-emerald-400' : isFailing ? 'text-rose-400' : isDegraded ? 'text-amber-400' : 'text-slate-400'}`}>
                      {!mon.enabled ? 'PAUSED' : mon.status}
                    </span>
                    {mon.enabled && mon.lastProbeStatus && (
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${mon.lastProbeStatus === 'UP' ? 'text-emerald-400 border-emerald-800/60' : mon.lastProbeStatus === 'DEGRADED' ? 'text-amber-400 border-amber-800/60' : 'text-rose-400 border-rose-800/60'}`}>
                        {mon.lastProbeStatus}{mon.lastStatusCode ? ` · HTTP ${mon.lastStatusCode}` : ''}
                      </span>
                    )}
                    {app && (
                      <span className="text-[10px] font-mono text-blue-400 font-semibold">
                        [{app.name} · {mon.environment}]
                      </span>
                    )}
                    {server && (
                      <span className="text-[10px] text-slate-500 hidden sm:inline">
                        Server: {server.hostname}{server.ip ? ` (${server.ip})` : ''}
                      </span>
                    )}
                  </div>
                  <div className={`text-xs font-mono truncate max-w-xl ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {group === 'INFRA' ? `Agent telemetry of ${server?.hostname ?? 'unknown server'}` : group === 'PUSH' && (mon.target === 'push' || !mon.target) ? 'Push heartbeat' : mon.target}
                  </div>
                </div>

                <div className="flex items-center gap-4 sm:gap-6 shrink-0">
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400 uppercase">30d Uptime</div>
                    <div className={`text-sm font-bold font-sans tabular-nums ${!checked ? 'text-slate-400' : mon.uptimePercent >= 99.9 ? 'text-emerald-400' : mon.uptimePercent >= 99 ? 'text-amber-400' : 'text-rose-400'}`}>
                      {checked ? `${mon.uptimePercent.toFixed(2)}%` : '—'}
                    </div>
                    <div className="text-[9px] text-slate-500">
                      {mon.consecutiveFailures > 0
                        ? `${mon.consecutiveFailures} consecutive fail(s)`
                        : mon.consecutiveRecoveries > 0 ? `${mon.consecutiveRecoveries} consecutive OK` : checked ? '' : 'No checks yet'}
                    </div>
                  </div>

                  <div className="text-right min-w-[90px]">
                    <div className="text-[10px] text-slate-400 uppercase">
                      {group === 'INFRA' ? 'Usage' : group === 'PUSH' ? 'Last ping' : 'Latency'}
                    </div>
                    <div className={`text-base font-bold font-sans tabular-nums ${toneText(reading.tone)}`} title={reading.hint}>
                      {reading.text}
                    </div>
                    {(isLatencyMonitor(mon) || group === 'INFRA') && mon.warningThresholdMs > 0 && (
                      <div className="text-[9px] text-slate-500">Warn ≥ {mon.warningThresholdMs}{unit}</div>
                    )}
                  </div>

                  {canProbe && (
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleProbeOne(mon.id); }}
                      disabled={probingId === mon.id || !mon.enabled}
                      className={`p-1.5 rounded transition-colors border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                        isDark ? 'bg-[#182236] hover:bg-[#202E4A] text-slate-200 border-[#243552]' : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                      }`}
                      title="Run this check now"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${probingId === mon.id ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                </div>
              </div>

              {showBar && (
                <div className={`mt-3 pt-2.5 border-t space-y-1 ${isDark ? 'border-slate-800/40' : 'border-slate-200'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-400">
                    <span>Latest: {mon.responseTimeMs}{unit}</span>
                    <span>Warning {mon.warningThresholdMs}{unit} · Critical {mon.criticalThresholdMs}{unit}</span>
                  </div>
                  <div className={`w-full h-2 rounded overflow-hidden relative ${isDark ? 'bg-slate-800/80' : 'bg-slate-200'}`}>
                    {mon.warningThresholdMs > 0 && (
                      <div className="absolute top-0 bottom-0 w-0.5 bg-amber-500/80 z-10" style={{ left: `${Math.min(100, (mon.warningThresholdMs / scale) * 100)}%` }} />
                    )}
                    {mon.criticalThresholdMs > 0 && (
                      <div className="absolute top-0 bottom-0 w-0.5 bg-rose-500/80 z-10" style={{ left: `${Math.min(100, (mon.criticalThresholdMs / scale) * 100)}%` }} />
                    )}
                    <div
                      className={`h-full transition-all duration-500 ${reading.tone === 'crit' ? 'bg-rose-500' : reading.tone === 'warn' ? 'bg-amber-500' : 'bg-blue-500'}`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Expanded: real check history */}
              {isSelected && (
                <div className={`mt-4 pt-4 border-t space-y-4 animate-in fade-in ${isDark ? 'border-slate-800/80' : 'border-slate-200'}`} onClick={e => e.stopPropagation()}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className={`text-xs font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                      Recent checks ({history.length})
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Every {mon.intervalSec}s · {group === 'PUSH' ? `grace ${mon.timeoutSec}s` : `timeout ${mon.timeoutSec}s`} · {mon.failureConfirmationThreshold} fail(s) to alert / {mon.recoveryConfirmationThreshold} pass(es) to recover
                    </span>
                  </div>

                  {history.length === 0 ? (
                    <div className={`p-3 rounded border text-[11px] text-slate-400 ${panel}`}>
                      No checks recorded yet{mon.enabled ? ' — the first result will appear after the next scheduled run.' : ' — this monitor is paused.'}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className={`flex items-end gap-1 h-16 p-2 rounded border ${panel}`}>
                        {history.map((h, i) => {
                          const heightPct = Math.min(100, Math.max(8, (h.responseTimeMs / historyMax) * 100));
                          const ts = validDate(h.timestamp);
                          return (
                            <div key={i} className="flex-1 flex flex-col justify-end items-center group relative h-full">
                              <div
                                className={`w-full rounded-xs ${
                                  h.status === 'CRITICAL' || h.status === 'STALE' ? 'bg-rose-500'
                                    : h.status === 'WARNING' ? 'bg-amber-500'
                                      : h.status === 'HEALTHY' ? 'bg-emerald-500' : 'bg-slate-500'
                                }`}
                                style={{ height: `${heightPct}%` }}
                              />
                              <div className="absolute bottom-full mb-1 hidden group-hover:block z-30 p-1.5 rounded bg-black/95 text-[10px] text-white whitespace-nowrap border border-slate-700 shadow-lg pointer-events-none">
                                <div>{ts ? ts.toLocaleString() : '—'}</div>
                                <div className="font-bold">
                                  {h.status}
                                  {h.responseTimeMs > 0 ? ` · ${h.responseTimeMs}${unit}` : ''}
                                  {h.statusCode !== undefined ? ` · HTTP ${h.statusCode}` : ''}
                                </div>
                                {h.detail && <div className="text-slate-400 text-[9px]">{h.detail}</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex justify-between text-[9px] text-slate-500 px-1">
                        <span>Oldest shown</span>
                        <span>Latest: {lastCheck ? lastCheck.toLocaleString() : '—'}</span>
                      </div>
                      {mon.history[0]?.detail && (
                        <div className="text-[10px] text-slate-400 break-all">Last result: {mon.history[0].detail}</div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                    <div className={`p-2.5 rounded border space-y-1 ${panel}`}>
                      <div className="text-[10px] text-slate-400 uppercase">Target</div>
                      <div className={`font-mono break-all text-[11px] ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                        {group === 'INFRA' ? (server?.hostname ?? '—') : mon.target || '—'}
                      </div>
                    </div>
                    <div className={`p-2.5 rounded border space-y-1 ${panel}`}>
                      <div className="text-[10px] text-slate-400 uppercase">Server</div>
                      <div className={`font-mono text-[11px] ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                        {server ? `${server.hostname}${server.ip ? ` (${server.ip})` : ''}` : 'Not linked'}
                      </div>
                      {server && <div className="text-[10px] text-slate-400">{server.region || '—'} · {server.environment}</div>}
                    </div>
                    <div className={`p-2.5 rounded border space-y-1 ${panel}`}>
                      <div className="text-[10px] text-slate-400 uppercase">Linked Runbook</div>
                      <div className="font-mono text-blue-400 text-[11px] font-bold">
                        {runbook ? runbook.title : 'None linked'}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {processedMonitors.length === 0 && (
          <div className={`p-8 rounded-lg border text-center space-y-2 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'}`}>
            <Activity className="w-8 h-8 text-slate-500 mx-auto opacity-40" />
            <div className="text-sm font-semibold">No monitors match your criteria</div>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">Adjust the search or switch category.</p>
          </div>
        )}
      </div>
    </div>
  );
};
