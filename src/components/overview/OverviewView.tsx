import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { OperationalStatus, ServerMetricPoint } from '../../types';
import {
  Layers, Server, Radio, AlertTriangle, Cloud, Database,
  ShieldCheck, Activity, ArrowRight, RefreshCw, CheckCircle2,
  TrendingUp, Clock, Eye, BarChart2, Wifi, WifiOff, Circle, Zap, Loader2, Settings2,
} from 'lucide-react';
import { HeartbeatPulseChart } from '../visuals/HeartbeatPulseChart';
import { TrafficFlowChart } from '../visuals/TrafficFlowChart';
import { IncidentFlowChart } from '../visuals/IncidentFlowChart';
import { TelemetryAreaGraph } from '../visuals/TelemetryAreaGraph';
import { EmptyState } from '../ui/EmptyState';
import { IctStatusPanel } from './IctStatusPanel';
import { routeState } from '../ui/routing';
import { Ago } from '../ui/Freshness';
import { deadManLabel, deadManLatency } from '../ui/deadman';

// ── Formatting helpers (null-safe) ───────────────────────────────────────────
const fmtPct = (v: number | null | undefined, digits = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}%`);
const fmtMs = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v)}ms`);
const fmtSec = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v}s`);
const minuteKey = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 60000) : null;
};
const hhmm = (minute: number) => new Date(minute * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

type Dot = 'ok' | 'warn' | 'crit' | 'unknown';
const dotFor = (s: OperationalStatus): Dot =>
  s === 'HEALTHY' ? 'ok' : s === 'CRITICAL' ? 'crit' : s === 'WARNING' || s === 'STALE' ? 'warn' : 'unknown';

// ── Status dot ───────────────────────────────────────────────────────────────
const StatusDot: React.FC<{ status: Dot; pulse?: boolean }> = ({ status, pulse }) => {
  const colors = {
    ok: 'bg-emerald-500',
    warn: 'bg-amber-400',
    crit: 'bg-rose-500',
    unknown: 'bg-slate-500',
  };
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${colors[status]} ${pulse ? 'animate-pulse' : ''}`} />
  );
};

// ── Metric card ──────────────────────────────────────────────────────────────
interface MetricCardProps {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  status?: Dot;
  onClick: () => void;
  isDark: boolean;
  badge?: string;
  badgeColor?: string;
  /** Extra label / value pairs, stacked under the value (each on its own line; values wrap, never overflow) */
  details?: Array<[string, React.ReactNode]>;
}

const MetricCard: React.FC<MetricCardProps> = ({
  label, value, sub, icon: Icon, status = 'ok', onClick, isDark, badge, badgeColor, details,
}) => {
  const borderColor =
    status === 'crit'    ? (isDark ? 'border-rose-800/70 bg-[#180E13]'   : 'border-rose-300 bg-rose-50/80') :
    status === 'warn'    ? (isDark ? 'border-amber-800/70 bg-[#18140A]'  : 'border-amber-300 bg-amber-50/80') :
    status === 'unknown' ? (isDark ? 'border-slate-700 bg-[#111726]'     : 'border-slate-300 bg-slate-50') :
                           (isDark ? 'border-[#1E293B] bg-[#111726]'     : 'border-slate-200 bg-white shadow-xs');

  const valueColor =
    status === 'crit' ? 'text-rose-400' :
    status === 'warn' ? 'text-amber-400' :
    status === 'unknown' ? 'text-slate-400' :
    isDark ? 'text-slate-100' : 'text-slate-900';

  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-lg border text-left transition-all group cursor-pointer hover:shadow-md hover:border-blue-500/50 min-w-0 flex flex-col ${borderColor}`}
    >
      <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
        <span className="text-[9px] font-mono font-semibold tracking-widest text-slate-400 uppercase truncate" title={label}>{label}</span>
        <Icon className={`w-3.5 h-3.5 shrink-0 transition-colors ${
          status === 'crit' ? 'text-rose-500' :
          status === 'warn' ? 'text-amber-500' :
          'text-slate-400 group-hover:text-blue-400'
        }`} />
      </div>
      <div className={`text-xl font-bold font-mono tabular-nums leading-tight break-words ${valueColor}`}>{value}</div>
      <div className="flex items-start justify-between mt-1.5 gap-1 min-w-0">
        <span className="text-[10px] text-slate-500 font-mono break-words min-w-0 line-clamp-2" title={sub}>{sub}</span>
        {badge && (
          <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${badgeColor ?? 'text-emerald-400 bg-emerald-950/60'}`}>
            {badge}
          </span>
        )}
      </div>
      {details && details.length > 0 && (
        <dl className={`mt-2 pt-2 border-t grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] font-mono ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
          {details.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-slate-500 truncate" title={k}>{k}</dt>
              <dd className={`min-w-0 break-words font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </button>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
export const OverviewView: React.FC = () => {
  const {
    applications, servers, monitors, runbooks, cloudflareZones, deadMan, integrations, systemSummary,
    lastUpdatedSecondsAgo, setSelectedAppId, setSelectedIncidentId, incidents, runAllProbes, theme,
    apiHealth, isLoading, loadError, refreshAll, realtimeStatus, loadBalancer,
  } = useOps();
  const { canDo } = useAuth();
  const navigate = useNavigate();
  const go = (tab: string) => navigate(`/${tab}`);

  const isDark = theme === 'dark';
  const openIncidents = incidents.filter(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  const activeIncident = openIncidents[0];
  const criticalOpen = openIncidents.filter(i => i.severity === 'CRITICAL' || i.severity === 'EMERGENCY');

  const [probing, setProbing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const handleProbeAll = async () => {
    setProbing(true);
    try { await runAllProbes(); } finally { setProbing(false); }
  };
  const handleRetry = async () => {
    setRetrying(true);
    try { await refreshAll(); } finally { setRetrying(false); }
  };

  // ── Live telemetry derived from agent reports ──────────────────────────────
  const reporting = servers.filter(s => s.lastSeen !== '');
  const avgOf = (vals: number[]) => (vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null);
  const live = servers.filter(s => s.agentStatus === 'CONNECTED' && s.telemetry);
  const avgCpu = avgOf(live.map(s => s.telemetry.cpuPercent));
  const avgRam = avgOf(live.map(s => s.telemetry.ramPercent));
  const criticalServers = servers.filter(s => s.status === 'CRITICAL');

  // ── 60-minute history from the metrics API (per-minute buckets) ────────────
  const reportingKey = reporting.map(s => s.id).sort().join(',');
  const [metricSeries, setMetricSeries] = useState<Record<string, ServerMetricPoint[]>>({});
  const [metricsError, setMetricsError] = useState<string | null>(null);

  useEffect(() => {
    const ids = reportingKey ? reportingKey.split(',') : [];
    if (ids.length === 0) { setMetricSeries({}); return; }
    let cancelled = false;
    const load = async () => {
      const results = await Promise.allSettled(ids.map(id => api.getServerMetrics(id, '1h')));
      if (cancelled) return;
      const next: Record<string, ServerMetricPoint[]> = {};
      let failures = 0;
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') next[ids[i]] = r.value;
        else failures++;
      });
      setMetricSeries(next);
      setMetricsError(failures === ids.length ? 'Metrics API unavailable' : null);
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [reportingKey]);

  const fleetHistory = useMemo(() => {
    const buckets = new Map<number, { cpu: number[]; ram: number[]; net: number }>();
    Object.values(metricSeries).forEach(points => {
      points.forEach(p => {
        const k = minuteKey(p.t);
        if (k === null) return;
        const b = buckets.get(k) ?? { cpu: [], ram: [], net: 0 };
        b.cpu.push(p.cpu);
        b.ram.push(p.ram);
        b.net += (p.netIn + p.netOut) / 1000; // kbps → Mbps
        buckets.set(k, b);
      });
    });
    const keys = [...buckets.keys()].sort((a, b) => a - b);
    const avg = (v: number[]) => +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1);
    return {
      labels: keys.map(hhmm),
      cpu: keys.map(k => avg(buckets.get(k)!.cpu)),
      ram: keys.map(k => avg(buckets.get(k)!.ram)),
      net: keys.map(k => +buckets.get(k)!.net.toFixed(2)),
    };
  }, [metricSeries]);

  // Probe latency: average of real monitor check response times per minute (last 60 min)
  const latencyHistory = useMemo(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    const buckets = new Map<number, number[]>();
    monitors.forEach(m => {
      if (!m.enabled) return;
      m.history.forEach(h => {
        if (h.status === 'UNKNOWN' || !(h.responseTimeMs > 0)) return;
        const t = Date.parse(h.timestamp);
        if (!Number.isFinite(t) || t < cutoff) return;
        const k = Math.floor(t / 60000);
        const list = buckets.get(k) ?? [];
        list.push(h.responseTimeMs);
        buckets.set(k, list);
      });
    });
    const keys = [...buckets.keys()].sort((a, b) => a - b);
    return {
      labels: keys.map(hhmm),
      values: keys.map(k => {
        const v = buckets.get(k)!;
        return Math.round(v.reduce((a, b) => a + b, 0) / v.length);
      }),
    };
  }, [monitors]);

  // ── Uptime: average over apps that actually have data ──────────────────────
  const uptimeVals = applications.map(a => a.uptime30d).filter((v): v is number => v !== null);
  const overallUptime = uptimeVals.length ? uptimeVals.reduce((a, b) => a + b, 0) / uptimeVals.length : null;

  // ── Card derivations ───────────────────────────────────────────────────────
  const enabledMonitors = monitors.filter(m => m.enabled);
  const unknownMonitors = enabledMonitors.filter(m => m.status === 'UNKNOWN').length;
  const criticalMonitors = enabledMonitors.filter(m => m.status === 'CRITICAL').length;
  const criticalApps = applications.filter(a => a.status === 'CRITICAL').length;
  const cfConfigured = Boolean(integrations?.cloudflare.configured);
  const deadManConfigured = deadMan.configured;

  const isEmpty = !isLoading && servers.length === 0 && applications.length === 0;

  // ── Header ─────────────────────────────────────────────────────────────────
  const header = (
    <div className={`flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b ${
      isDark ? 'border-[#1E293B]' : 'border-slate-200'
    }`}>
      <div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className={`text-lg font-bold tracking-tight font-mono ${isDark ? 'text-white' : 'text-slate-900'}`}>
            OPERATIONS COMMAND CENTER
          </h1>
          {!isEmpty && (
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold flex items-center gap-1.5 ${
              systemSummary.overallHealth === 'CRITICAL'
                ? 'text-rose-400 bg-rose-950/60 border border-rose-800/60'
                : systemSummary.overallHealth === 'WARNING'
                  ? 'text-amber-400 bg-amber-950/60 border border-amber-800/60'
                  : systemSummary.overallHealth === 'UNKNOWN'
                    ? 'text-slate-400 bg-slate-900/60 border border-slate-700/60'
                    : 'text-emerald-400 bg-emerald-950/60 border border-emerald-800/60'
            }`}>
              <StatusDot
                status={systemSummary.overallHealth === 'CRITICAL' ? 'crit' : systemSummary.overallHealth === 'WARNING' ? 'warn' : systemSummary.overallHealth === 'UNKNOWN' ? 'unknown' : 'ok'}
                pulse={systemSummary.overallHealth !== 'OPERATIONAL'}
              />
              {systemSummary.overallHealth}{systemSummary.overallHealth === 'OPERATIONAL' && systemSummary.visibilityGaps.length ? ' · PARTIAL DATA' : ''}
            </span>
          )}
          {/* API backend badge (from the context's periodic /api/health check) */}
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold flex items-center gap-1.5 ${
            !apiHealth.lastChecked
              ? (isDark ? 'text-slate-500 bg-slate-900 border border-slate-700' : 'text-slate-400 bg-slate-50 border border-slate-200')
              : apiHealth.reachable
                ? (isDark ? 'text-blue-400 bg-blue-950/50 border border-blue-800/50' : 'text-blue-700 bg-blue-50 border border-blue-200')
                : (isDark ? 'text-rose-400 bg-rose-950/50 border border-rose-800/50' : 'text-rose-700 bg-rose-50 border border-rose-200')
          }`}>
            {!apiHealth.lastChecked
              ? <><Circle className="w-2.5 h-2.5 animate-pulse" /> CHECKING</>
              : apiHealth.reachable
                ? <><Wifi className="w-3 h-3" /> API {apiHealth.latencyMs}ms</>
                : <><WifiOff className="w-3 h-3" /> API UNREACHABLE</>
            }
          </span>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${
            realtimeStatus === 'LIVE'
              ? 'text-emerald-400 bg-emerald-950/50 border border-emerald-800/50'
              : realtimeStatus === 'RECONNECTING'
                ? 'text-amber-400 bg-amber-950/50 border border-amber-800/50'
                : 'text-rose-400 bg-rose-950/50 border border-rose-800/50'
          }`}>
            STREAM {realtimeStatus}
          </span>
        </div>
        <p className={`text-[11px] mt-1 flex items-center gap-2 font-mono flex-wrap ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
          <Clock className="w-3 h-3" />
          <span>Last update {lastUpdatedSecondsAgo}s ago</span>
          {systemSummary.visibilityGaps.length > 0 && (
            <>
              <span className={isDark ? 'text-slate-700' : 'text-slate-300'}>·</span>
              <span className="text-amber-500">Partial data: {systemSummary.visibilityGaps.join(' · ')}</span>
            </>
          )}
          <span className={isDark ? 'text-slate-700' : 'text-slate-300'}>·</span>
          <span className={overallUptime === null ? '' : overallUptime >= 99.9 ? 'text-emerald-500 font-semibold' : 'text-amber-500 font-semibold'}>
            {overallUptime === null ? 'No uptime data yet' : `${overallUptime.toFixed(2)}% avg uptime (30d, ${uptimeVals.length} app${uptimeVals.length === 1 ? '' : 's'})`}
          </span>
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {canDo('run_probe') && enabledMonitors.length > 0 && (
          <button
            onClick={handleProbeAll}
            disabled={probing}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium rounded-lg transition-all border cursor-pointer hover:scale-105 disabled:opacity-60 disabled:cursor-wait disabled:hover:scale-100 ${
              isDark
                ? 'text-slate-200 bg-[#162033] hover:bg-[#1C2942] border-[#243552]'
                : 'text-slate-700 bg-white hover:bg-slate-50 border-slate-300 shadow-xs'
            }`}
          >
            {probing ? <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 text-blue-400" />}
            <span>{probing ? 'PROBING…' : 'PROBE ALL'}</span>
          </button>
        )}
        <button
          onClick={() => go(criticalOpen.length > 0 ? 'incidents' : 'reports')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold rounded-lg transition-all shadow-xs cursor-pointer hover:scale-105 ${
            criticalOpen.length > 0
              ? 'text-white bg-rose-600 hover:bg-rose-700'
              : 'text-white bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {criticalOpen.length > 0
            ? <><AlertTriangle className="w-3.5 h-3.5" /> {criticalOpen.length} CRITICAL</>
            : <><BarChart2 className="w-3.5 h-3.5" /> DAILY REPORT</>
          }
        </button>
      </div>
    </div>
  );

  const loadErrorBanner = loadError && (
    <div className={`p-3 rounded-lg border flex flex-wrap items-center justify-between gap-2 font-mono text-xs ${
      isDark ? 'bg-rose-950/30 border-rose-900/60 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-700'
    }`}>
      <span className="flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> Could not load operational data: {loadError}</span>
      <button
        onClick={handleRetry}
        disabled={retrying}
        className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
      >
        {retrying && <Loader2 className="w-3 h-3 animate-spin" />} Retry
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-5">
        {header}
        <div className={`flex items-center justify-center gap-2 py-16 text-xs font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading operational data…
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="space-y-5">
        {header}
        {loadErrorBanner}
        <EmptyState
          icon={Settings2}
          title="Nothing is being monitored yet"
          description="Register your PRD and DR VPS servers and your applications in Setup, then install the telemetry agent. This dashboard fills in from real data as soon as checks and agent reports arrive."
          action={{ label: 'Open Setup', onClick: () => navigate('/setup') }}
        />
        <HeartbeatPulseChart />
      </div>
    );
  }

  // ── The 5 operational answers (derived from real state) ────────────────────
  const healthyAppNames = applications.filter(a => a.status === 'HEALTHY').map(a => a.name);
  const incidentApp = activeIncident ? applications.find(a => a.id === activeIncident.applicationId) : undefined;
  const incidentRunbook = activeIncident?.runbookId ? runbooks.find(r => r.id === activeIncident.runbookId) : undefined;
  const incidentMonitors = activeIncident ? monitors.filter(m => activeIncident.affectedMonitors.includes(m.id)) : [];
  const recoveryLine = incidentMonitors.length
    ? incidentMonitors.map(m => `${Math.min(m.consecutiveRecoveries, m.recoveryConfirmationThreshold)}/${m.recoveryConfirmationThreshold}`).join(', ')
    : null;

  const answers = [
    {
      n: '01',
      q: 'What is healthy?',
      color: 'text-emerald-500',
      highlight: null as null | 'rose' | 'amber' | 'emerald',
      answer: `${systemSummary.healthyApps}/${systemSummary.totalApps} apps, ${systemSummary.healthyServers}/${systemSummary.totalServers} servers`,
      detail: healthyAppNames.length ? `${healthyAppNames.join(', ')} healthy.` : 'No application is currently reporting HEALTHY.',
    },
    {
      n: '02',
      q: 'What is failing?',
      color: 'text-rose-400',
      highlight: activeIncident ? 'rose' as const : null,
      answer: activeIncident
        ? `${incidentApp?.name ?? activeIncident.applicationId ?? 'Unknown app'} ${activeIncident.environment}`
        : criticalMonitors > 0 ? `${criticalMonitors} monitor(s) critical` : 'No open incidents',
      detail: activeIncident
        ? (activeIncident.rootCause || activeIncident.title)
        : unknownMonitors > 0 ? `${unknownMonitors} monitor(s) have not reported a result yet.` : 'All enabled monitors are passing.',
    },
    {
      n: '03',
      q: 'What is affected?',
      color: 'text-amber-400',
      highlight: activeIncident ? 'amber' as const : null,
      answer: activeIncident
        ? (activeIncident.affectedServices.length ? activeIncident.affectedServices.slice(0, 2).join(', ') : 'See incident')
        : 'Nothing reported',
      detail: activeIncident
        ? `${activeIncident.affectedMonitors.length} monitor(s) affected.${incidentApp?.failoverState === 'DR_ACTIVE' ? ' Traffic is on the DR server.' : ''}`
        : `${openIncidents.length} open incidents.`,
    },
    {
      n: '04',
      q: 'What should IT do?',
      color: 'text-blue-400',
      highlight: null,
      answer: activeIncident
        ? (incidentRunbook ? `Run: ${incidentRunbook.title}` : !activeIncident.acknowledged ? `Acknowledge ${activeIncident.id}` : `Work ${activeIncident.id}`)
        : 'No action required',
      detail: activeIncident
        ? `Status ${activeIncident.status} · owner ${activeIncident.owner || 'Unassigned'}${openIncidents.length > 1 ? ` · ${openIncidents.length - 1} more open` : ''}`
        : 'Keep monitoring.',
    },
    {
      n: '05',
      q: 'Has it recovered?',
      color: activeIncident ? 'text-slate-400' : 'text-emerald-400',
      highlight: activeIncident ? null : 'emerald' as const,
      answer: activeIncident ? 'Not yet' : 'No open incidents',
      detail: activeIncident
        ? (recoveryLine ? `Recovery confirmations: ${recoveryLine}` : (activeIncident.recoveryStatus || 'Awaiting recovery'))
        : 'Nothing awaiting recovery.',
    },
  ];

  const highlightBg = (h: null | 'rose' | 'amber' | 'emerald') =>
    h === 'rose' ? (isDark ? 'bg-[#180E13]' : 'bg-rose-50')
      : h === 'amber' ? (isDark ? 'bg-[#18130E]' : 'bg-amber-50')
        : h === 'emerald' ? (isDark ? 'bg-[#0E1713]' : 'bg-emerald-50')
          : (isDark ? 'bg-[#0B0F17]' : 'bg-slate-50');

  const regions = [...new Set(servers.map(s => s.region).filter(Boolean))];

  return (
    <div className="space-y-5">
      {header}
      {loadErrorBanner}

      {/* ── Load-Balancer-managed applications (ICT): live PRD / DR answer ── */}
      <IctStatusPanel />

      {/* ── Active route per application ─────────────────────────────────── */}
      <div className={`p-3.5 sm:p-4 rounded-lg border flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${
        isDark ? 'bg-[#0B1322] border-blue-900/40 text-slate-200' : 'bg-blue-50/70 border-blue-200 text-slate-800'
      }`}>
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-8 h-8 rounded-md bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4 text-blue-400" />
          </div>
          <div className="min-w-0 space-y-1">
            <span className="font-bold text-xs font-mono">ACTIVE ROUTES</span>
            {applications.length === 0 ? (
              <div className="text-[11px] font-mono text-slate-400">
                No applications registered — servers exist but no PRD/DR routing is defined. Add an application in Setup.
              </div>
            ) : applications.map(app => {
              const prd = servers.find(s => s.id === app.prdServerId);
              const dr = servers.find(s => s.id === app.drServerId);
              const route = routeState(app, loadBalancer);
              const onDr = route === 'DR';
              const moving = route === 'MOVING';
              const unknown = route === 'UNKNOWN';
              return (
                <div key={app.id} className="flex items-center gap-2 flex-wrap text-[11px] font-mono">
                  <span className="font-semibold">{app.name}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    unknown ? 'bg-slate-900 text-slate-300 border border-slate-700'
                      : moving ? 'bg-blue-950 text-blue-300 border border-blue-800'
                      : onDr ? 'bg-amber-950 text-amber-300 border border-amber-800'
                        : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  }`}>
                    {unknown ? 'ROUTING UNKNOWN' : moving ? 'FAILING OVER' : onDr ? 'ON DR' : 'ON PRD'}
                  </span>
                  <span className={route === 'PRD' ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                    PRD {prd ? (prd.ip || prd.hostname) : 'not linked'}
                  </span>
                  <span className="text-slate-500">/</span>
                  <span className={onDr ? 'text-amber-400 font-semibold' : 'text-slate-400'}>
                    DR {dr ? (dr.ip || dr.hostname) : 'not linked'}
                  </span>
                  {(app.loadBalancer?.hostname || app.dnsRecordName) && <span className="text-slate-500">· {app.loadBalancer ? `Cloudflare LB ${app.loadBalancer.hostname}` : app.dnsRecordName}</span>}
                </div>
              );
            })}
          </div>
        </div>
        <button
          onClick={() => go(applications.length === 0 ? 'setup' : 'resilience')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-bold bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-xs cursor-pointer shrink-0 self-start"
        >
          <span>{applications.length === 0 ? 'OPEN SETUP' : 'PRD / DR READINESS'}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── 8-Column Metric Cards ────────────────────────────────────────── */}
      {/* auto-fit: as many ≥ 10.5rem columns as fit, stretched to the full row — 8 across on wide screens, fewer (never cramped) on laptops */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))] items-start gap-2">
        <MetricCard
          label="Applications"
          value={`${systemSummary.healthyApps}/${systemSummary.totalApps}`}
          sub={systemSummary.totalApps === 0 ? 'None registered' : systemSummary.healthyApps === systemSummary.totalApps ? 'All healthy' : `${systemSummary.totalApps - systemSummary.healthyApps} not healthy`}
          icon={Layers}
          status={systemSummary.totalApps === 0 ? 'unknown' : criticalApps > 0 ? 'crit' : systemSummary.healthyApps < systemSummary.totalApps ? 'warn' : 'ok'}
          onClick={() => go('applications')}
          isDark={isDark}
        />
        <MetricCard
          label="Servers"
          value={`${systemSummary.healthyServers}/${systemSummary.totalServers}`}
          sub={criticalServers.length > 0 ? `${criticalServers.length} critical` : `${reporting.length} agent(s) reporting`}
          icon={Server}
          status={systemSummary.totalServers === 0 ? 'unknown' : criticalServers.length > 0 ? 'crit' : systemSummary.healthyServers < systemSummary.totalServers ? 'warn' : 'ok'}
          onClick={() => go('infrastructure')}
          isDark={isDark}
        />
        <MetricCard
          label="Monitors"
          value={`${systemSummary.healthyMonitors}/${systemSummary.totalMonitors}`}
          sub={systemSummary.totalMonitors === 0 ? 'None configured' : unknownMonitors > 0 ? `${unknownMonitors} awaiting result` : `${enabledMonitors.length} enabled`}
          icon={Radio}
          status={systemSummary.totalMonitors === 0 ? 'unknown' : criticalMonitors > 0 ? 'crit' : systemSummary.healthyMonitors < systemSummary.totalMonitors ? 'warn' : 'ok'}
          onClick={() => go('monitors')}
          isDark={isDark}
        />
        <MetricCard
          label="Incidents"
          value={systemSummary.openIncidents}
          sub={systemSummary.criticalIncidents > 0 ? `${systemSummary.criticalIncidents} critical` : 'None critical'}
          icon={AlertTriangle}
          status={systemSummary.criticalIncidents > 0 ? 'crit' : systemSummary.openIncidents > 0 ? 'warn' : 'ok'}
          onClick={() => go('incidents')}
          isDark={isDark}
          badge={systemSummary.openIncidents > 0 ? 'OPEN' : 'CLEAR'}
          badgeColor={systemSummary.openIncidents > 0 ? 'text-rose-400 bg-rose-950/60' : 'text-emerald-400 bg-emerald-950/60'}
        />
        <MetricCard
          label="DR Ready"
          value={`${systemSummary.drReadinessCount}/${systemSummary.totalApps}`}
          sub="Server-evaluated DR readiness = READY"
          icon={Cloud}
          status={systemSummary.totalApps === 0 ? 'unknown' : systemSummary.drReadinessCount < systemSummary.totalApps ? 'warn' : 'ok'}
          onClick={() => go('resilience')}
          isDark={isDark}
        />
        <MetricCard
          label="Backups"
          value={systemSummary.backupsCurrentCount}
          sub="Successful, last 26h"
          icon={Database}
          status={systemSummary.backupsCurrentCount === 0 ? 'unknown' : 'ok'}
          onClick={() => go('backups')}
          isDark={isDark}
        />
        <MetricCard
          label="Cloudflare"
          value={!cfConfigured ? 'Not set' : systemSummary.cloudflareStatus === 'DEGRADED' ? 'Degraded' : systemSummary.cloudflareStatus === 'HEALTHY' ? 'Healthy' : 'Unknown'}
          sub={cfConfigured ? `${cloudflareZones.length} zone(s)` : 'API token not configured'}
          icon={ShieldCheck}
          status={!cfConfigured ? 'unknown' : systemSummary.cloudflareStatus === 'DEGRADED' ? 'warn' : systemSummary.cloudflareStatus === 'HEALTHY' ? 'ok' : 'unknown'}
          onClick={() => go('cloudflare')}
          isDark={isDark}
        />
        <MetricCard
          label="Dead-Man"
          value={deadManConfigured ? deadManLabel(deadMan.status) : 'Not set'}
          sub={deadManConfigured ? `every ${deadMan.intervalSec}s · tolerance ${deadMan.toleranceSec}s` : 'Watchdog not configured — set DEADMAN_HEARTBEAT_URL on the server'}
          icon={Activity}
          status={deadMan.status === 'HEALTHY' ? 'ok' : deadMan.status === 'DEGRADED' ? 'warn' : deadMan.status === 'FAILING' ? 'crit' : 'unknown'}
          onClick={() => go('monitors')}
          isDark={isDark}
          // Only when there is something to show (no rows of dashes when the watchdog is not configured)
          details={!deadManConfigured ? undefined : [
            ['Watchdog', 'Configured'],
            ['Last ping', deadMan.lastSuccessAt ? <Ago iso={deadMan.lastSuccessAt} staleAfterSec={deadMan.toleranceSec} /> : deadManConfigured ? 'None yet' : '—'],
            ['Latency', deadManLatency(deadMan)],
            ['Failures', deadMan.lastAttemptAt ? String(deadMan.consecutiveFailures) : '—'],
          ]}
        />
      </div>

      {/* ── Live Infrastructure Pulse ────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { label: 'Fleet CPU', value: avgCpu, warn: 60, crit: 80, okBar: 'bg-emerald-500', okText: 'text-emerald-400' },
          { label: 'Fleet RAM', value: avgRam, warn: 70, crit: 85, okBar: 'bg-blue-500', okText: 'text-blue-400' },
        ].map(card => (
          <div key={card.label} className={`rounded-lg border p-3.5 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider">{card.label}</span>
              <span className={`text-lg font-bold font-mono tabular-nums ${
                card.value === null ? 'text-slate-500' : card.value > card.crit ? 'text-rose-400' : card.value > card.warn ? 'text-amber-400' : card.okText
              }`}>
                {card.value === null ? '—' : `${card.value}%`}
              </span>
            </div>
            <div className={`h-2 rounded-full ${isDark ? 'bg-[#1E293B]' : 'bg-slate-100'} overflow-hidden`}>
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  card.value === null ? '' : card.value > card.crit ? 'bg-rose-500' : card.value > card.warn ? 'bg-amber-500' : card.okBar
                }`}
                style={{ width: `${card.value ?? 0}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5 text-[10px] font-mono text-slate-500">
              <span>{reporting.length > 0 ? `Avg of ${reporting.length} reporting server(s)` : 'No agent has reported yet'}</span>
              {card.value !== null && (
                <span className={card.value > card.crit ? 'text-rose-400 font-semibold' : ''}>
                  {card.value > card.crit ? 'HIGH' : card.value > card.warn ? 'MODERATE' : 'NORMAL'}
                </span>
              )}
            </div>
          </div>
        ))}

        {/* Active Incident summary or All Clear */}
        {activeIncident ? (
          <div className={`rounded-lg border p-3.5 ${isDark ? 'bg-[#180E13] border-rose-900/60' : 'bg-rose-50 border-rose-200'}`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-mono font-semibold text-rose-500 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                Active Incident{openIncidents.length > 1 ? ` (+${openIncidents.length - 1})` : ''}
              </span>
              <button
                onClick={() => { setSelectedIncidentId(activeIncident.id); go('incidents'); }}
                className="text-[10px] font-mono text-rose-400 hover:text-rose-300 underline underline-offset-2 cursor-pointer"
              >
                Investigate →
              </button>
            </div>
            <div className={`text-sm font-bold font-mono truncate ${isDark ? 'text-slate-100' : 'text-slate-900'}`} title={activeIncident.title}>
              {activeIncident.title}
            </div>
            <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono text-slate-400">
              <span className="text-rose-400 font-bold">{activeIncident.severity}</span>
              <span>·</span>
              <span>{activeIncident.status}</span>
              <span>·</span>
              <span>{activeIncident.durationMinutes}m open</span>
            </div>
          </div>
        ) : (
          <div className={`rounded-lg border p-3.5 flex items-center gap-3 ${
            isDark ? 'bg-[#0E1713] border-emerald-900/50' : 'bg-emerald-50 border-emerald-200'
          }`}>
            <CheckCircle2 className="w-8 h-8 text-emerald-500 shrink-0" />
            <div>
              <div className="text-sm font-bold font-mono text-emerald-500">NO OPEN INCIDENTS</div>
              <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                {criticalMonitors > 0
                  ? `${criticalMonitors} monitor(s) critical, not yet confirmed`
                  : unknownMonitors > 0
                    ? `${unknownMonitors} monitor(s) awaiting first result`
                    : enabledMonitors.length > 0 ? 'All enabled monitors passing' : 'No monitors configured'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── The 5 Operational Answers ────────────────────────────────────── */}
      <div className={`rounded-lg border overflow-hidden ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
        <div className={`px-4 py-2.5 border-b flex items-center justify-between ${isDark ? 'border-[#1A2332] bg-[#0D1220]' : 'border-slate-100 bg-slate-50'}`}>
          <div className="flex items-center gap-2">
            <Eye className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-[11px] font-bold uppercase tracking-wider font-mono">Operational Assessment — The 5 Answers</span>
          </div>
          <span className={`text-[10px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
            Derived from live incidents &amp; monitors
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5">
          {answers.map(item => (
            <div key={item.n} className={`p-3.5 border-r last:border-r-0 min-w-0 ${highlightBg(item.highlight)} ${isDark ? 'border-[#1A2436]' : 'border-slate-100'}`}>
              <div className="flex items-center gap-1.5 mb-2">
                <span className={`text-[9px] font-mono font-bold ${item.color}`}>{item.n}</span>
                <span className={`text-[9px] uppercase tracking-wider font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{item.q}</span>
              </div>
              <div className={`text-xs font-bold font-mono break-words ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{item.answer}</div>
              <div className={`text-[11px] font-sans mt-1 leading-snug break-words ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{item.detail}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Live Visual Charts ───────────────────────────────────────────── */}
      <div className="space-y-4">
        <HeartbeatPulseChart />
        <TrafficFlowChart />
        <IncidentFlowChart />
      </div>

      {/* ── Telemetry Time-Series Graphs ─────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
            <h3 className="text-[11px] font-bold uppercase tracking-wider font-mono">
              Infrastructure Telemetry — Past 60 Minutes
            </h3>
          </div>
          <span className={`text-[10px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
            Per-minute agent samples · refreshed every 60s
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <TelemetryAreaGraph
            title="Fleet CPU" subtitle={`${reporting.length} server avg`} data={fleetHistory.cpu} labels={fleetHistory.labels}
            unit="%" warningThreshold={80} color="rose"
            emptyMessage={metricsError ?? (reporting.length ? 'No samples in the last hour' : 'Install the agent to collect metrics')}
          />
          <TelemetryAreaGraph
            title="Fleet Memory" subtitle={`${reporting.length} server avg`} data={fleetHistory.ram} labels={fleetHistory.labels}
            unit="%" warningThreshold={85} color="amber"
            emptyMessage={metricsError ?? (reporting.length ? 'No samples in the last hour' : 'Install the agent to collect metrics')}
          />
          <TelemetryAreaGraph
            title="Network In+Out" subtitle="fleet total" data={fleetHistory.net} labels={fleetHistory.labels}
            unit=" Mbps" color="blue"
            emptyMessage={metricsError ?? (reporting.length ? 'No samples in the last hour' : 'Install the agent to collect metrics')}
          />
          <TelemetryAreaGraph
            title="Monitor Latency" subtitle="avg response" data={latencyHistory.values} labels={latencyHistory.labels}
            unit=" ms" color="emerald"
            emptyMessage={enabledMonitors.length ? 'No checks in the last hour' : 'No monitors configured'}
          />
        </div>
      </div>

      {/* ── Application Failover Matrix ──────────────────────────────────── */}
      <div className={`rounded-lg border overflow-hidden ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
        <div className={`px-4 py-3 border-b flex items-center justify-between ${isDark ? 'border-[#1A2332] bg-[#0D1220]' : 'border-slate-100 bg-slate-50'}`}>
          <div>
            <h2 className="text-[11px] font-bold font-mono uppercase tracking-wider">Application Systems &amp; Failover Matrix</h2>
            <p className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Live health · RTO/RPO targets · Replication lag · Active origin
            </p>
          </div>
          <button onClick={() => go('applications')} className="text-xs text-blue-400 hover:text-blue-300 font-mono font-medium flex items-center gap-1 cursor-pointer">
            <span>Full view</span><ArrowRight className="w-3 h-3" />
          </button>
        </div>

        {applications.length === 0 ? (
          <div className={`p-6 text-center text-xs font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
            No applications registered yet.{' '}
            <button onClick={() => navigate('/setup')} className="text-blue-400 hover:text-blue-300 underline underline-offset-2 cursor-pointer">
              Register applications in Setup
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className={`text-[10px] font-semibold uppercase border-b ${isDark ? 'bg-[#0B0F17] text-slate-500 border-[#1A2332]' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                <tr>
                  <th className="py-2.5 px-3.5">App / Tier</th>
                  <th className="py-2.5 px-3.5">Status</th>
                  <th className="py-2.5 px-3.5">PRD Node</th>
                  <th className="py-2.5 px-3.5">DR Node</th>
                  <th className="py-2.5 px-3.5">Repl. Lag</th>
                  <th className="py-2.5 px-3.5">RTO / RPO</th>
                  <th className="py-2.5 px-3.5 text-right">30d Uptime</th>
                  <th className="py-2.5 px-3.5 text-right">P95</th>
                  <th className="py-2.5 px-3.5 text-right">Err%</th>
                  <th className="py-2.5 px-3.5 text-right"></th>
                </tr>
              </thead>
              <tbody className={`divide-y text-[11px] ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
                {applications.map(app => {
                  const prdServer = servers.find(s => s.id === app.prdServerId);
                  const drServer  = servers.find(s => s.id === app.drServerId);
                  const dot = dotFor(app.status);
                  const isDr      = app.failoverState === 'DR_ACTIVE';
                  const lag       = app.currentReplicationLagSec;
                  const lagWarn   = lag !== null && lag > app.rpoTargetMin * 60;
                  const err       = app.errorRatePercent;

                  return (
                    <tr key={app.id} className={`transition-colors ${isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50/80'}`}>
                      <td className="py-2.5 px-3.5">
                        <div className="font-semibold font-sans">{app.name}</div>
                        <div className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{app.tier?.replace('_', ' ')}</div>
                      </td>

                      <td className="py-2.5 px-3.5">
                        <div className="flex items-center gap-1.5">
                          <StatusDot status={dot} pulse={dot === 'crit'} />
                          <span className={`font-semibold ${
                            dot === 'ok' ? 'text-emerald-400' : dot === 'crit' ? 'text-rose-400' : dot === 'warn' ? 'text-amber-400' : 'text-slate-400'
                          }`}>
                            {app.status}
                          </span>
                        </div>
                        <div className={`text-[10px] mt-0.5 font-bold ${isDr ? 'text-amber-400' : isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                          {app.failoverState === 'FAILING_OVER' ? 'FAILING OVER' : isDr ? 'DR ACTIVE' : 'PRD ACTIVE'}
                        </div>
                      </td>

                      <td className="py-2.5 px-3.5">
                        <div className={isDark ? 'text-slate-300' : 'text-slate-700'}>{prdServer?.hostname.split('.')[0] ?? 'Not linked'}</div>
                        <div className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{prdServer?.ip || '—'}</div>
                      </td>

                      <td className="py-2.5 px-3.5">
                        <div className={isDark ? 'text-slate-300' : 'text-slate-700'}>{drServer?.hostname.split('.')[0] ?? 'Not linked'}</div>
                        <div className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{drServer?.ip || '—'}</div>
                      </td>

                      <td className="py-2.5 px-3.5 tabular-nums">
                        <span className={lagWarn ? 'text-amber-400 font-bold' : isDark ? 'text-slate-300' : 'text-slate-700'}>
                          {lag === null ? 'No data' : fmtSec(lag)}
                        </span>
                        <div className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                          tgt &lt;{app.rpoTargetMin * 60}s
                        </div>
                      </td>

                      <td className={`py-2.5 px-3.5 tabular-nums ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        <div>{app.rtoTargetMin}m RTO</div>
                        <div>{app.rpoTargetMin}m RPO</div>
                      </td>

                      <td className="py-2.5 px-3.5 text-right tabular-nums font-semibold">
                        <span className={app.uptime30d === null ? 'text-slate-500' : app.uptime30d < 99.9 ? 'text-amber-400' : 'text-emerald-400'}>
                          {fmtPct(app.uptime30d)}
                        </span>
                      </td>

                      <td className="py-2.5 px-3.5 text-right tabular-nums">
                        <span className={app.p95Ms !== null && app.p95Ms > 500 ? 'text-rose-400 font-bold' : isDark ? 'text-slate-300' : 'text-slate-700'}>
                          {fmtMs(app.p95Ms)}
                        </span>
                      </td>

                      <td className="py-2.5 px-3.5 text-right tabular-nums">
                        <span className={err === null ? 'text-slate-500' : err > 1 ? 'text-rose-400 font-bold' : err > 0 ? 'text-amber-400' : 'text-emerald-400'}>
                          {fmtPct(err)}
                        </span>
                      </td>

                      <td className="py-2.5 px-3.5 text-right">
                        <button
                          onClick={() => { setSelectedAppId(app.id); go('applications'); }}
                          className={`px-2.5 py-0.5 rounded text-[10px] transition-colors border cursor-pointer font-mono ${
                            isDark
                              ? 'text-slate-300 hover:text-white hover:bg-[#1D2B44] border-[#23334E]'
                              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border-slate-300'
                          }`}
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── VPS Fleet Preview ────────────────────────────────────────────── */}
      <div className={`rounded-lg border overflow-hidden ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
        <div className={`px-4 py-3 border-b flex items-center justify-between ${isDark ? 'border-[#1A2332] bg-[#0D1220]' : 'border-slate-100 bg-slate-50'}`}>
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wider font-mono">
              VPS Fleet{regions.length ? ` — ${regions.join(' · ')}` : ''}
            </h3>
            <p className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              {servers.length} registered · {reporting.length} reporting telemetry
            </p>
          </div>
          <button onClick={() => go('infrastructure')} className="text-xs text-blue-400 hover:text-blue-300 font-mono font-medium cursor-pointer">
            All {servers.length} →
          </button>
        </div>

        {servers.length === 0 ? (
          <div className={`p-6 text-center text-xs font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
            No servers registered yet.{' '}
            <button onClick={() => navigate('/setup')} className="text-blue-400 hover:text-blue-300 underline underline-offset-2 cursor-pointer">
              Register your servers in Setup
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 p-3">
            {servers.slice(0, 8).map(srv => {
              const dot = dotFor(srv.status);
              const isCrit = dot === 'crit';
              const hasData = srv.agentStatus === 'CONNECTED' && Boolean(srv.telemetry);
              const cpu = hasData ? Math.round(srv.telemetry.cpuPercent) : 0;
              const ram = hasData ? Math.round(srv.telemetry.ramPercent) : 0;
              return (
                <div
                  key={srv.id}
                  onClick={() => go('infrastructure')}
                  className={`p-2.5 rounded-lg border cursor-pointer transition-all hover:scale-[1.03] ${
                    isCrit
                      ? (isDark ? 'bg-[#180E13] border-rose-900/70' : 'bg-rose-50 border-rose-300')
                      : (isDark ? 'bg-[#0B0F17] border-[#1A2436] hover:border-blue-600/50' : 'bg-slate-50 border-slate-200 hover:border-blue-300')
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-[10px] font-mono font-bold truncate ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                      {srv.hostname?.split('.')[0] || srv.ip || srv.id.slice(0, 8)}
                    </span>
                    <StatusDot status={dot} pulse={isCrit} />
                  </div>
                  {hasData ? (
                    <div className="space-y-1 text-[10px] font-mono tabular-nums">
                      <div className="flex items-center gap-1">
                        <span className="text-slate-500 w-6">CPU</span>
                        <div className={`flex-1 h-1 rounded-full ${isDark ? 'bg-[#1E293B]' : 'bg-slate-200'} overflow-hidden`}>
                          <div className={`h-full rounded-full ${cpu > 80 ? 'bg-rose-500' : 'bg-blue-500'}`} style={{ width: `${cpu}%` }} />
                        </div>
                        <span className={cpu > 80 ? 'text-rose-400 font-bold' : isDark ? 'text-slate-300' : 'text-slate-600'}>{cpu}%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-slate-500 w-6">RAM</span>
                        <div className={`flex-1 h-1 rounded-full ${isDark ? 'bg-[#1E293B]' : 'bg-slate-200'} overflow-hidden`}>
                          <div className={`h-full rounded-full ${ram > 85 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${ram}%` }} />
                        </div>
                        <span className={ram > 85 ? 'text-amber-400 font-bold' : isDark ? 'text-slate-300' : 'text-slate-600'}>{ram}%</span>
                      </div>
                    </div>
                  ) : (
                    <div className={`text-[10px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{srv.lastSeen ? `Agent ${srv.agentStatus}` : 'Not connected'}</div>
                  )}
                  <div className={`text-[9px] font-mono mt-1.5 truncate ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    {srv.region || 'Region n/a'} · {srv.environment}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
};
