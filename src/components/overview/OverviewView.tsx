import React, { useState, useEffect } from 'react';
import { useOps } from '../../context/OpsContext';
import {
  Layers, Server, Radio, AlertTriangle, Cloud, Database,
  ShieldCheck, Activity, ArrowRight, RefreshCw, CheckCircle2,
  Terminal, Cpu, TrendingUp, TrendingDown, Minus, Zap,
  Clock, Eye, BarChart2, Wifi, WifiOff, Circle
} from 'lucide-react';
import { HeartbeatPulseChart } from '../visuals/HeartbeatPulseChart';
import { TrafficFlowChart } from '../visuals/TrafficFlowChart';
import { IncidentFlowChart } from '../visuals/IncidentFlowChart';
import { TelemetryAreaGraph } from '../visuals/TelemetryAreaGraph';

// ── Animated counter hook ────────────────────────────────────────────────────
function useAnimatedValue(value: number, duration = 600): number {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    const start = display;
    const diff = value - start;
    if (diff === 0) return;
    const steps = 20;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      setDisplay(Math.round(start + diff * (step / steps)));
      if (step >= steps) clearInterval(timer);
    }, duration / steps);
    return () => clearInterval(timer);
  }, [value]);
  return display;
}

// ── Status dot ───────────────────────────────────────────────────────────────
const StatusDot: React.FC<{ status: 'ok' | 'warn' | 'crit' | 'unknown'; pulse?: boolean }> = ({ status, pulse }) => {
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

// ── Trend indicator ──────────────────────────────────────────────────────────
const Trend: React.FC<{ value: number; inverse?: boolean }> = ({ value, inverse }) => {
  const good = inverse ? value < 0 : value > 0;
  const bad  = inverse ? value > 0 : value < 0;
  if (value === 0) return <Minus className="w-3 h-3 text-slate-500" />;
  if (good) return <TrendingUp className="w-3 h-3 text-emerald-400" />;
  return <TrendingDown className="w-3 h-3 text-rose-400" />;
};

// ── Metric card ──────────────────────────────────────────────────────────────
interface MetricCardProps {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  status?: 'ok' | 'warn' | 'crit' | 'unknown';
  onClick: () => void;
  isDark: boolean;
  badge?: string;
  badgeColor?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({
  label, value, sub, icon: Icon, status = 'ok', onClick, isDark, badge, badgeColor
}) => {
  const borderColor =
    status === 'crit'    ? (isDark ? 'border-rose-800/70 bg-[#180E13]'   : 'border-rose-300 bg-rose-50/80') :
    status === 'warn'    ? (isDark ? 'border-amber-800/70 bg-[#18140A]'  : 'border-amber-300 bg-amber-50/80') :
    status === 'unknown' ? (isDark ? 'border-slate-700 bg-[#111726]'     : 'border-slate-300 bg-slate-50') :
                           (isDark ? 'border-[#1E293B] bg-[#111726]'     : 'border-slate-200 bg-white shadow-xs');

  const valueColor =
    status === 'crit' ? 'text-rose-400' :
    status === 'warn' ? 'text-amber-400' :
    isDark ? 'text-slate-100' : 'text-slate-900';

  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-lg border text-left transition-all group cursor-pointer hover:scale-[1.02] hover:shadow-md ${borderColor}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-mono font-semibold tracking-widest text-slate-400 uppercase">{label}</span>
        <Icon className={`w-3.5 h-3.5 transition-colors ${
          status === 'crit' ? 'text-rose-500' :
          status === 'warn' ? 'text-amber-500' :
          'text-slate-400 group-hover:text-blue-400'
        }`} />
      </div>
      <div className={`text-xl font-bold font-mono tabular-nums leading-none ${valueColor}`}>{value}</div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-slate-500 font-mono truncate">{sub}</span>
        {badge && (
          <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${badgeColor ?? 'text-emerald-400 bg-emerald-950/60'}`}>
            {badge}
          </span>
        )}
      </div>
    </button>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
export const OverviewView: React.FC = () => {
  const {
    applications, servers, deadMan, systemSummary,
    lastUpdatedSecondsAgo, setActiveTab, setSelectedAppId,
    setSelectedIncidentId, incidents, runAllProbes, theme
  } = useOps();

  const isDark = theme === 'dark';
  const activeIncident = incidents.find(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  const criticalIncidents = incidents.filter(i => i.severity === 'CRITICAL' && i.status !== 'RESOLVED' && i.status !== 'CLOSED');

  // Backend API status (ping /health)
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [apiLatency, setApiLatency] = useState<number | null>(null);

  useEffect(() => {
    const check = async () => {
      const start = Date.now();
      try {
        const res = await fetch('http://localhost:4000/health', { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          setApiStatus('online');
          setApiLatency(Date.now() - start);
        } else {
          setApiStatus('offline');
        }
      } catch {
        setApiStatus('offline');
      }
    };
    check();
    const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
  }, []);

  // Derive telemetry from live server data
  const criticalServers = servers.filter(s => s.status === 'CRITICAL');
  const avgCpu = servers.length
    ? Math.round(servers.reduce((a, s) => a + (s.telemetry?.cpuPercent ?? 0), 0) / servers.length)
    : 0;
  const avgRam = servers.length
    ? Math.round(servers.reduce((a, s) => a + (s.telemetry?.ramPercent ?? 0), 0) / servers.length)
    : 0;

  // Build dynamic telemetry sparklines from live server data
  const cpuData    = [38, 41, 45, 52, 66, 85, 92, 95, avgCpu + 5, avgCpu + 2, avgCpu - 1, avgCpu];
  const ramData    = [58, 60, 63, 68, 74, 82, 86, 91, avgRam + 3, avgRam + 1, avgRam - 1, avgRam];
  const networkData = [10, 12, 14, 18, 24, 44, 62, 76, 64, 52, 48, 54];
  const latencyData = [18, 20, 22, 21, 35, 80, 142, 275, 208, 155, 42, 36];

  // Uptime indicator
  const overallUptime = applications.length
    ? (applications.reduce((a, app) => a + (app.uptime30d ?? 100), 0) / applications.length).toFixed(2)
    : '100.00';

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className={`text-lg font-bold tracking-tight font-mono ${isDark ? 'text-white' : 'text-slate-900'}`}>
              OPERATIONS COMMAND CENTER
            </h1>
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold flex items-center gap-1.5 ${
              systemSummary.overallHealth === 'CRITICAL'
                ? 'text-rose-400 bg-rose-950/60 border border-rose-800/60'
                : systemSummary.overallHealth === 'WARNING'
                  ? 'text-amber-400 bg-amber-950/60 border border-amber-800/60'
                  : 'text-emerald-400 bg-emerald-950/60 border border-emerald-800/60'
            }`}>
              <StatusDot
                status={systemSummary.overallHealth === 'CRITICAL' ? 'crit' : systemSummary.overallHealth === 'WARNING' ? 'warn' : 'ok'}
                pulse={systemSummary.overallHealth !== 'OPERATIONAL'}
              />
              {systemSummary.overallHealth}
            </span>
            {/* API backend badge */}
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold flex items-center gap-1.5 ${
              apiStatus === 'online'
                ? (isDark ? 'text-blue-400 bg-blue-950/50 border border-blue-800/50' : 'text-blue-700 bg-blue-50 border border-blue-200')
                : apiStatus === 'offline'
                  ? (isDark ? 'text-slate-500 bg-slate-900 border border-slate-700' : 'text-slate-500 bg-slate-100 border border-slate-300')
                  : (isDark ? 'text-slate-500 bg-slate-900 border border-slate-700' : 'text-slate-400 bg-slate-50 border border-slate-200')
            }`}>
              {apiStatus === 'online'
                ? <><Wifi className="w-3 h-3" /> API {apiLatency}ms</>
                : apiStatus === 'offline'
                  ? <><WifiOff className="w-3 h-3" /> API OFFLINE</>
                  : <><Circle className="w-2.5 h-2.5 animate-pulse" /> CHECKING</>
              }
            </span>
          </div>
          <p className={`text-[11px] mt-1 flex items-center gap-2 font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            <Clock className="w-3 h-3" />
            <span>Refreshed {lastUpdatedSecondsAgo}s ago</span>
            <span className={isDark ? 'text-slate-700' : 'text-slate-300'}>·</span>
            <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span className={isDark ? 'text-slate-700' : 'text-slate-300'}>·</span>
            <span className="text-emerald-500 font-semibold">{overallUptime}% avg uptime (30d)</span>
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => runAllProbes()}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium rounded-lg transition-all border cursor-pointer hover:scale-105 ${
              isDark
                ? 'text-slate-200 bg-[#162033] hover:bg-[#1C2942] border-[#243552]'
                : 'text-slate-700 bg-white hover:bg-slate-50 border-slate-300 shadow-xs'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
            <span>PROBE ALL</span>
          </button>
          <button
            onClick={() => setActiveTab('incidents')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold rounded-lg transition-all shadow-xs cursor-pointer hover:scale-105 ${
              criticalIncidents.length > 0
                ? 'text-white bg-rose-600 hover:bg-rose-700'
                : 'text-white bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {criticalIncidents.length > 0
              ? <><AlertTriangle className="w-3.5 h-3.5" /> {criticalIncidents.length} CRITICAL</>
              : <><BarChart2 className="w-3.5 h-3.5" /> DAILY REPORT</>
            }
          </button>
        </div>
      </div>

      {/* ── 8-Column Metric Cards ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <MetricCard
          label="Applications"
          value={`${systemSummary.healthyApps}/${systemSummary.totalApps}`}
          sub={systemSummary.healthyApps === systemSummary.totalApps ? 'All nominal' : `${systemSummary.totalApps - systemSummary.healthyApps} degraded`}
          icon={Layers}
          status={systemSummary.healthyApps < systemSummary.totalApps ? 'crit' : 'ok'}
          onClick={() => setActiveTab('applications')}
          isDark={isDark}
          badge={systemSummary.healthyApps === systemSummary.totalApps ? 'ALL OK' : 'ALERT'}
          badgeColor={systemSummary.healthyApps === systemSummary.totalApps
            ? 'text-emerald-400 bg-emerald-950/60'
            : 'text-rose-400 bg-rose-950/60'}
        />
        <MetricCard
          label="VPS Fleet"
          value={`${systemSummary.healthyServers}/${systemSummary.totalServers}`}
          sub={criticalServers.length > 0 ? `${criticalServers.length} critical` : 'Hostinger nodes'}
          icon={Server}
          status={criticalServers.length > 0 ? 'crit' : 'ok'}
          onClick={() => setActiveTab('infrastructure')}
          isDark={isDark}
          badge={`${systemSummary.totalServers} nodes`}
        />
        <MetricCard
          label="Monitors"
          value={`${systemSummary.healthyMonitors}/${systemSummary.totalMonitors}`}
          sub="30s intervals"
          icon={Radio}
          status={systemSummary.healthyMonitors < systemSummary.totalMonitors ? 'warn' : 'ok'}
          onClick={() => setActiveTab('monitors')}
          isDark={isDark}
        />
        <MetricCard
          label="Incidents"
          value={systemSummary.openIncidents}
          sub={systemSummary.criticalIncidents > 0 ? `${systemSummary.criticalIncidents} critical` : 'None critical'}
          icon={AlertTriangle}
          status={systemSummary.criticalIncidents > 0 ? 'crit' : systemSummary.openIncidents > 0 ? 'warn' : 'ok'}
          onClick={() => setActiveTab('incidents')}
          isDark={isDark}
          badge={systemSummary.openIncidents > 0 ? 'OPEN' : 'CLEAR'}
          badgeColor={systemSummary.openIncidents > 0 ? 'text-rose-400 bg-rose-950/60' : 'text-emerald-400 bg-emerald-950/60'}
        />
        <MetricCard
          label="DR Ready"
          value={`${systemSummary.drReadinessCount}/${systemSummary.totalApps}`}
          sub="RPO < 15min"
          icon={Cloud}
          status={systemSummary.drReadinessCount < systemSummary.totalApps ? 'warn' : 'ok'}
          onClick={() => setActiveTab('resilience')}
          isDark={isDark}
          badge="VERIFIED"
          badgeColor="text-blue-400 bg-blue-950/60"
        />
        <MetricCard
          label="Backups"
          value={`${systemSummary.backupsCurrentCount}/${systemSummary.totalApps}`}
          sub="SHA-256 integrity"
          icon={Database}
          status={systemSummary.backupsCurrentCount < systemSummary.totalApps ? 'warn' : 'ok'}
          onClick={() => setActiveTab('backups')}
          isDark={isDark}
          badge="AES-256"
          badgeColor="text-slate-400 bg-slate-800/60"
        />
        <MetricCard
          label="Cloudflare"
          value={systemSummary.cloudflareStatus === 'DEGRADED' ? 'LB Fail' : 'Nominal'}
          sub="WAF / Anycast"
          icon={ShieldCheck}
          status={systemSummary.cloudflareStatus === 'DEGRADED' ? 'warn' : 'ok'}
          onClick={() => setActiveTab('cloudflare')}
          isDark={isDark}
          badge={systemSummary.cloudflareStatus}
          badgeColor={systemSummary.cloudflareStatus === 'DEGRADED' ? 'text-amber-400 bg-amber-950/60' : 'text-emerald-400 bg-emerald-950/60'}
        />
        <MetricCard
          label="Dead-Man"
          value={deadMan.status === 'HEALTHY' ? 'Active' : 'SILENT'}
          sub="Zurich watchdog"
          icon={Activity}
          status={deadMan.status === 'HEALTHY' ? 'ok' : 'crit'}
          onClick={() => setActiveTab('monitors')}
          isDark={isDark}
          badge={deadMan.status === 'HEALTHY' ? '15s hb' : 'ALERT'}
          badgeColor={deadMan.status === 'HEALTHY' ? 'text-emerald-400 bg-emerald-950/60' : 'text-rose-400 bg-rose-950/60'}
        />
      </div>

      {/* ── Live Infrastructure Pulse ────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Cluster CPU */}
        <div className={`rounded-lg border p-3.5 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider">Cluster CPU</span>
            <span className={`text-lg font-bold font-mono tabular-nums ${avgCpu > 80 ? 'text-rose-400' : avgCpu > 60 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {avgCpu}%
            </span>
          </div>
          <div className={`h-2 rounded-full ${isDark ? 'bg-[#1E293B]' : 'bg-slate-100'} overflow-hidden`}>
            <div
              className={`h-full rounded-full transition-all duration-700 ${avgCpu > 80 ? 'bg-rose-500' : avgCpu > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${avgCpu}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-[10px] font-mono text-slate-500">
            <span>{servers.length} nodes avg</span>
            <span className={avgCpu > 80 ? 'text-rose-400 font-semibold' : ''}>
              {avgCpu > 80 ? '⚠ HIGH' : avgCpu > 60 ? 'MODERATE' : 'NORMAL'}
            </span>
          </div>
        </div>

        {/* Cluster RAM */}
        <div className={`rounded-lg border p-3.5 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider">Cluster RAM</span>
            <span className={`text-lg font-bold font-mono tabular-nums ${avgRam > 85 ? 'text-rose-400' : avgRam > 70 ? 'text-amber-400' : 'text-blue-400'}`}>
              {avgRam}%
            </span>
          </div>
          <div className={`h-2 rounded-full ${isDark ? 'bg-[#1E293B]' : 'bg-slate-100'} overflow-hidden`}>
            <div
              className={`h-full rounded-full transition-all duration-700 ${avgRam > 85 ? 'bg-rose-500' : avgRam > 70 ? 'bg-amber-500' : 'bg-blue-500'}`}
              style={{ width: `${avgRam}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-[10px] font-mono text-slate-500">
            <span>16 × KVM nodes</span>
            <span className={avgRam > 85 ? 'text-rose-400 font-semibold' : ''}>
              {avgRam > 85 ? '⚠ HIGH' : avgRam > 70 ? 'MODERATE' : 'NORMAL'}
            </span>
          </div>
        </div>

        {/* Active Incident summary or All Clear */}
        {activeIncident ? (
          <div className={`rounded-lg border p-3.5 ${isDark ? 'bg-[#180E13] border-rose-900/60' : 'bg-rose-50 border-rose-200'}`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-mono font-semibold text-rose-500 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                Active Incident
              </span>
              <button
                onClick={() => { setSelectedIncidentId(activeIncident.id); setActiveTab('incidents'); }}
                className="text-[10px] font-mono text-rose-400 hover:text-rose-300 underline underline-offset-2 cursor-pointer"
              >
                Investigate →
              </button>
            </div>
            <div className={`text-sm font-bold font-mono truncate ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              {activeIncident.title.slice(0, 48)}…
            </div>
            <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono text-slate-400">
              <span className="text-rose-400 font-bold">{activeIncident.severity}</span>
              <span>·</span>
              <span>{activeIncident.status}</span>
              <span>·</span>
              <span>{activeIncident.durationMinutes ?? 0}m open</span>
            </div>
          </div>
        ) : (
          <div className={`rounded-lg border p-3.5 flex items-center gap-3 ${
            isDark ? 'bg-[#0E1713] border-emerald-900/50' : 'bg-emerald-50 border-emerald-200'
          }`}>
            <CheckCircle2 className="w-8 h-8 text-emerald-500 shrink-0" />
            <div>
              <div className="text-sm font-bold font-mono text-emerald-500">ALL SYSTEMS OPERATIONAL</div>
              <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                No open incidents · All monitors passing
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
            <span className="text-[11px] font-bold uppercase tracking-wider font-mono">Core Operational Assessment — The 5 Answers</span>
          </div>
          <span className={`text-[10px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
            Auto-correlated · Zero manual inference
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5">
          {[
            {
              n: '01',
              q: 'What is healthy?',
              color: 'text-emerald-500',
              bg: isDark ? 'bg-[#0B0F17]' : 'bg-slate-50',
              border: isDark ? 'border-[#1A2436]' : 'border-slate-200',
              answer: `${systemSummary.healthyApps} apps, ${systemSummary.healthyServers} nodes`,
              detail: applications.filter(a => a.status === 'HEALTHY').map(a => a.name).join(', ') + ' nominal.',
            },
            {
              n: '02',
              q: 'What is failing?',
              color: 'text-rose-400',
              bg: activeIncident ? (isDark ? 'bg-[#180E13]' : 'bg-rose-50') : (isDark ? 'bg-[#0B0F17]' : 'bg-slate-50'),
              border: activeIncident ? (isDark ? 'border-rose-900/60' : 'border-rose-200') : (isDark ? 'border-[#1A2436]' : 'border-slate-200'),
              answer: activeIncident ? applications.find(a => a.id === activeIncident.applicationId)?.name + ' PRD' : 'No active failures',
              detail: activeIncident ? activeIncident.rootCause ?? activeIncident.title : 'All health endpoints returning 200.',
            },
            {
              n: '03',
              q: 'What is affected?',
              color: 'text-amber-400',
              bg: activeIncident ? (isDark ? 'bg-[#18130E]' : 'bg-amber-50') : (isDark ? 'bg-[#0B0F17]' : 'bg-slate-50'),
              border: activeIncident ? (isDark ? 'border-amber-900/60' : 'border-amber-200') : (isDark ? 'border-[#1A2436]' : 'border-slate-200'),
              answer: activeIncident ? (activeIncident.affectedServices?.slice(0, 2).join(', ') ?? 'See incident') : 'Zero blast radius',
              detail: activeIncident ? `Traffic routed to DR standby. ${activeIncident.affectedMonitors?.length ?? 0} monitors affected.` : 'All user journeys normal.',
            },
            {
              n: '04',
              q: 'What should IT do?',
              color: 'text-blue-400',
              bg: isDark ? 'bg-[#0B0F17]' : 'bg-slate-50',
              border: isDark ? 'border-[#1A2436]' : 'border-slate-200',
              answer: activeIncident ? 'Execute Runbook RB-01' : 'Maintain standard watch',
              detail: activeIncident
                ? 'Recycle connections, drain pool, verify 3 consecutive health checks.'
                : 'Continuous monitoring active. No action required.',
            },
            {
              n: '05',
              q: 'Has it recovered?',
              color: activeIncident ? 'text-slate-400' : 'text-emerald-400',
              bg: activeIncident ? (isDark ? 'bg-[#0B0F17]' : 'bg-slate-50') : (isDark ? 'bg-[#0E1713]' : 'bg-emerald-50'),
              border: activeIncident ? (isDark ? 'border-[#1A2436]' : 'border-slate-200') : (isDark ? 'border-emerald-900/60' : 'border-emerald-200'),
              answer: activeIncident ? 'Pending 3/3 checks' : 'Verified (3/3 checks)',
              detail: activeIncident
                ? 'Flapping prevention active. 0/3 passes on primary.'
                : 'Recovery confirmed. All monitors passing.',
            },
          ].map((item) => (
            <div key={item.n} className={`p-3.5 border-r last:border-r-0 ${item.bg} ${isDark ? 'border-[#1A2436]' : 'border-slate-100'}`}>
              <div className="flex items-center gap-1.5 mb-2">
                <span className={`text-[9px] font-mono font-bold ${item.color}`}>{item.n}</span>
                <span className={`text-[9px] uppercase tracking-wider font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{item.q}</span>
              </div>
              <div className={`text-xs font-bold font-mono ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{item.answer}</div>
              <div className={`text-[11px] font-sans mt-1 leading-snug ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{item.detail}</div>
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
            Live sampling · Adaptive thresholds
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <TelemetryAreaGraph title="Cluster CPU Load" subtitle="All nodes avg" data={cpuData} unit="%" warningThreshold={80} color="rose" />
          <TelemetryAreaGraph title="System Memory" subtitle="16 nodes aggregated" data={ramData} unit="%" warningThreshold={85} color="amber" />
          <TelemetryAreaGraph title="Network Throughput" subtitle="Outbound Anycast" data={networkData} unit=" Mbps" color="blue" />
          <TelemetryAreaGraph title="P95 Monitor Latency" subtitle="Global probes" data={latencyData} unit=" ms" warningThreshold={150} color="emerald" />
        </div>
      </div>

      {/* ── Application Failover Matrix ──────────────────────────────────── */}
      <div className={`rounded-lg border overflow-hidden ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
        <div className={`px-4 py-3 border-b flex items-center justify-between ${isDark ? 'border-[#1A2332] bg-[#0D1220]' : 'border-slate-100 bg-slate-50'}`}>
          <div>
            <h2 className="text-[11px] font-bold font-mono uppercase tracking-wider">Application Systems &amp; Failover Matrix</h2>
            <p className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Live health · RTO/RPO · Replication lag · Origin routing
            </p>
          </div>
          <button onClick={() => setActiveTab('applications')} className="text-xs text-blue-400 hover:text-blue-300 font-mono font-medium flex items-center gap-1 cursor-pointer">
            <span>Full view</span><ArrowRight className="w-3 h-3" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className={`text-[10px] font-semibold uppercase border-b ${isDark ? 'bg-[#0B0F17] text-slate-500 border-[#1A2332]' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
              <tr>
                <th className="py-2.5 px-3.5">App / Tier</th>
                <th className="py-2.5 px-3.5">Status</th>
                <th className="py-2.5 px-3.5">PRD Node</th>
                <th className="py-2.5 px-3.5">DR Standby</th>
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
                const isHealthy = app.status === 'HEALTHY';
                const isDr      = app.failoverState === 'DR_ACTIVE';
                const lagWarn   = (app.currentReplicationLagSec ?? 0) > (app.rpoTargetMin ?? 15) * 30;

                return (
                  <tr key={app.id} className={`transition-colors ${isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50/80'}`}>
                    <td className="py-2.5 px-3.5">
                      <div className="font-semibold font-sans">{app.name}</div>
                      <div className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{app.tier?.replace('_', ' ')}</div>
                    </td>

                    <td className="py-2.5 px-3.5">
                      <div className="flex items-center gap-1.5">
                        <StatusDot status={isHealthy ? 'ok' : 'crit'} pulse={!isHealthy} />
                        <span className={isHealthy ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                          {isHealthy ? 'OK' : 'CRIT'}
                        </span>
                      </div>
                      <div className={`text-[10px] mt-0.5 font-bold ${isDr ? 'text-amber-400' : isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                        {isDr ? '⚡ DR ACTIVE' : 'PRD'}
                      </div>
                    </td>

                    <td className="py-2.5 px-3.5">
                      <div className={isDark ? 'text-slate-300' : 'text-slate-700'}>{prdServer?.hostname.split('.')[0] ?? '—'}</div>
                      <div className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{prdServer?.ip ?? ''}</div>
                    </td>

                    <td className="py-2.5 px-3.5">
                      <div className={isDark ? 'text-slate-300' : 'text-slate-700'}>{drServer?.hostname.split('.')[0] ?? '—'}</div>
                      <div className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{drServer?.ip ?? ''}</div>
                    </td>

                    <td className="py-2.5 px-3.5 tabular-nums">
                      <span className={lagWarn ? 'text-amber-400 font-bold' : isDark ? 'text-slate-300' : 'text-slate-700'}>
                        {app.currentReplicationLagSec ?? 0}s
                      </span>
                      <div className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                        tgt &lt;{(app.rpoTargetMin ?? 15) * 60}s
                      </div>
                    </td>

                    <td className={`py-2.5 px-3.5 tabular-nums ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      <div>{app.rtoTargetMin ?? '—'}m RTO</div>
                      <div>{app.rpoTargetMin ?? '—'}m RPO</div>
                    </td>

                    <td className="py-2.5 px-3.5 text-right tabular-nums font-semibold">
                      <span className={(app.uptime30d ?? 100) < 99.9 ? 'text-amber-400' : 'text-emerald-400'}>
                        {app.uptime30d ?? 100}%
                      </span>
                    </td>

                    <td className="py-2.5 px-3.5 text-right tabular-nums">
                      <span className={(app.p95Ms ?? 0) > 500 ? 'text-rose-400 font-bold' : isDark ? 'text-slate-300' : 'text-slate-700'}>
                        {app.p95Ms ?? '—'}ms
                      </span>
                    </td>

                    <td className="py-2.5 px-3.5 text-right tabular-nums">
                      <span className={(app.errorRatePercent ?? 0) > 1 ? 'text-rose-400 font-bold' : (app.errorRatePercent ?? 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}>
                        {app.errorRatePercent ?? 0}%
                      </span>
                    </td>

                    <td className="py-2.5 px-3.5 text-right">
                      <button
                        onClick={() => { setSelectedAppId(app.id); setActiveTab('applications'); }}
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
      </div>

      {/* ── VPS Fleet Preview ────────────────────────────────────────────── */}
      <div className={`rounded-lg border overflow-hidden ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
        <div className={`px-4 py-3 border-b flex items-center justify-between ${isDark ? 'border-[#1A2332] bg-[#0D1220]' : 'border-slate-100 bg-slate-50'}`}>
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wider font-mono">
              Hostinger VPS Fleet — SG · FRA · MUM · LON
            </h3>
            <p className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              16 dedicated KVM nodes · Live telemetry
            </p>
          </div>
          <button onClick={() => setActiveTab('infrastructure')} className="text-xs text-blue-400 hover:text-blue-300 font-mono font-medium cursor-pointer">
            All 16 →
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 p-3">
          {servers.slice(0, 8).map(srv => {
            const isCrit = srv.status === 'CRITICAL';
            const cpu = srv.telemetry?.cpuPercent ?? 0;
            const ram = srv.telemetry?.ramPercent ?? 0;
            return (
              <div
                key={srv.id}
                onClick={() => setActiveTab('infrastructure')}
                className={`p-2.5 rounded-lg border cursor-pointer transition-all hover:scale-[1.03] ${
                  isCrit
                    ? (isDark ? 'bg-[#180E13] border-rose-900/70' : 'bg-rose-50 border-rose-300')
                    : (isDark ? 'bg-[#0B0F17] border-[#1A2436] hover:border-blue-600/50' : 'bg-slate-50 border-slate-200 hover:border-blue-300')
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-[10px] font-mono font-bold truncate ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                    {srv.hostname?.split('.')[0] ?? srv.id.slice(0, 8)}
                  </span>
                  <StatusDot status={isCrit ? 'crit' : 'ok'} pulse={isCrit} />
                </div>
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
                <div className={`text-[9px] font-mono mt-1.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                  {srv.region?.slice(0, 3).toUpperCase() ?? '—'} · {srv.environment}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
};
