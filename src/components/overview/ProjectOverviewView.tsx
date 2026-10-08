import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import {
  Server,
  ShieldCheck,
  Activity,
  ArrowRight,
  Globe,
  GitBranch,
  RefreshCw,
  Sun,
  Moon,
  AlertTriangle,
  Network,
  Settings2,
} from 'lucide-react';

/**
 * Skeleton loading placeholder for KPI health cards.
 * Designed to exactly mirror the final card dimensions (min-h-[116px], p-3.5 sm:p-4,
 * identical flex distribution, header, metric, and footer rows) to guarantee ZERO layout shift.
 */
export const KpiCardSkeleton: React.FC<{ isDark: boolean; index?: number }> = ({ isDark, index = 0 }) => {
  const titleWidths = ['w-24 sm:w-28', 'w-36 sm:w-40', 'w-32 sm:w-36', 'w-34 sm:w-38'];
  const valueWidths = ['w-10 sm:w-12', 'w-20 sm:w-24', 'w-10 sm:w-12', 'w-16 sm:w-20'];
  const pillWidths = ['w-16 sm:w-20', 'w-20 sm:w-24', 'w-18 sm:w-22', 'w-20 sm:w-24'];
  const descWidths = ['w-36 sm:w-44', 'w-44 sm:w-52', 'w-36 sm:w-44', 'w-40 sm:w-48'];

  const tWidth = titleWidths[index % titleWidths.length];
  const vWidth = valueWidths[index % valueWidths.length];
  const pWidth = pillWidths[index % pillWidths.length];
  const dWidth = descWidths[index % descWidths.length];

  const shimmer = isDark ? 'bg-[#1C273C] animate-pulse' : 'bg-slate-200 animate-pulse';

  return (
    <div
      aria-hidden="true"
      className={`p-3.5 sm:p-4 rounded-lg border flex flex-col justify-between min-w-0 min-h-[116px] transition-colors select-none ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className={`h-2.5 ${tWidth} rounded ${shimmer}`} />
          <div className={`w-3.5 h-3.5 rounded ${shimmer} shrink-0`} />
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <div className={`h-7 ${vWidth} rounded ${shimmer}`} />
          <div className={`h-4.5 ${pWidth} rounded ${shimmer}`} />
        </div>
      </div>
      <div className={`mt-2.5 pt-2 border-t flex items-center justify-between ${
        isDark ? 'border-[#1E293B]' : 'border-slate-100'
      }`}>
        <div className={`h-2.5 ${dWidth} rounded ${shimmer}`} />
        <div className={`w-3 h-3 rounded ${shimmer} shrink-0 ml-1`} />
      </div>
    </div>
  );
};

type Section = 'architecture' | 'stack' | 'features' | 'themes' | 'principles';

export const ProjectOverviewView: React.FC = () => {
  const {
    theme,
    systemSummary,
    incidents,
    servers,
    applications,
    monitors,
    deployments,
    cloudflareZones,
    integrations,
    deadMan,
    isLoading,
    refreshAll,
  } = useOps();
  const navigate = useNavigate();
  const go = (tab: string) => navigate(`/${tab}`);
  const isDark = theme === 'dark';

  const [syncing, setSyncing] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>('architecture');

  const handleRefresh = async () => {
    setSyncing(true);
    try { await refreshAll(); } finally { setSyncing(false); }
  };

  // ── Real-time stats derived from context ──────────────────────────────────
  const activeIncidents = incidents.filter(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  const criticalIncidentsCount = activeIncidents.filter(i => i.severity === 'CRITICAL' || i.severity === 'EMERGENCY').length;

  const uptimeVals = applications.map(a => a.uptime30d).filter((v): v is number => v !== null);
  const avgUptime = uptimeVals.length ? uptimeVals.reduce((a, b) => a + b, 0) / uptimeVals.length : null;

  const pendingDeployments = deployments.filter(d =>
    d.status === 'BUILDING' || d.status === 'DEPLOYING' || d.status === 'HEALTH_CHECK' || d.status === 'SMOKE_TEST'
  );
  const latestDeployment = deployments[0];
  const latestAppName = latestDeployment
    ? (applications.find(a => a.id === latestDeployment.applicationId)?.name || latestDeployment.applicationId)
    : '';

  const prdServers = servers.filter(s => s.environment === 'PRD').length;
  const drServers = servers.filter(s => s.environment === 'DR').length;
  const reportingServers = servers.filter(s => s.lastSeen !== '').length;
  const regions = [...new Set(servers.map(s => s.region).filter(Boolean))];
  const providers = [...new Set(servers.map(s => s.provider).filter(Boolean))];
  const autoFailoverApps = applications.filter(a => a.autoFailover).length;
  const dnsLinkedApps = applications.filter(a => a.dnsRecordName).length;
  const cfConfigured = Boolean(integrations?.cloudflare.configured);
  const deadManConfigured = deadMan.servers.length > 0;
  const thresholds = [...new Set(monitors.map(m => m.failureConfirmationThreshold))];

  const deadManLabel = !deadManConfigured
    ? 'Dead-man: no servers'
    : deadMan.status === 'HEALTHY' ? `Dead-man: OK (${deadMan.servers.length} server(s))` : `Dead-man: ${deadMan.status} (${deadMan.counts.failing} failing, ${deadMan.counts.degraded} degraded)`;

  const card = `p-4 rounded-lg border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`;
  const tile = `p-3 rounded border text-center ${isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200'}`;
  const bodyText = `text-xs leading-relaxed font-sans ${isDark ? 'text-slate-300' : 'text-slate-600'}`;

  const kpiShell = (highlight: boolean) => `p-3.5 sm:p-4 rounded-lg border transition-all cursor-pointer group flex flex-col justify-between min-w-0 min-h-[116px] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
    highlight
      ? (isDark ? 'bg-[#180E13] border-rose-900/70 hover:border-rose-600' : 'bg-rose-50/70 border-rose-200 hover:border-rose-400 shadow-xs')
      : (isDark ? 'bg-[#111726] border-[#1E293B] hover:border-blue-500' : 'bg-white border-slate-200 hover:border-blue-400 shadow-xs')
  }`;
  const kpiKeys = (tab: string) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(tab); }
  };

  const views: Array<{ id: string; title: string; desc: string }> = [
    { id: 'overview', title: 'Command Center', desc: `Live summary: ${systemSummary.totalApps} application(s), ${systemSummary.totalServers} server(s), ${systemSummary.totalMonitors} monitor(s).` },
    { id: 'setup', title: 'Setup', desc: 'Register servers and applications, link PRD/DR servers and Cloudflare DNS records, install the telemetry agent.' },
    { id: 'applications', title: 'Applications', desc: 'Per-application health, uptime, latency percentiles and failover state.' },
    { id: 'infrastructure', title: 'VPS Fleet', desc: 'Agent-reported CPU, RAM, disk, network, processes and services for each server.' },
    { id: 'monitors', title: 'Monitors', desc: 'HTTP, TCP, DNS, SSL, heartbeat and infrastructure checks with confirmation thresholds.' },
    { id: 'incidents', title: 'Incidents', desc: 'Incidents opened by confirmed monitor failures or declared manually; acknowledge, assign and resolve.' },
    { id: 'resilience', title: 'PRD / DR Readiness', desc: 'DR readiness checks and Cloudflare DNS failover / failback.' },
    { id: 'backups', title: 'Backups', desc: 'Backup records and freshness as reported to the control plane.' },
    { id: 'dependencies', title: 'Dependencies', desc: 'Application dependency status.' },
    { id: 'cloudflare', title: 'Cloudflare', desc: 'Zones, DNS records and SSL status synced from the Cloudflare API.' },
    { id: 'hostinger', title: 'Hostinger', desc: 'VPS inventory synced from the Hostinger API.' },
    { id: 'deployments', title: 'Deployments', desc: 'Deployment records reported to the control plane.' },
    { id: 'runbooks', title: 'Runbooks', desc: 'Step-by-step operating procedures with per-step completion tracking.' },
    { id: 'maintenance', title: 'Maintenance Windows', desc: 'Scheduled windows that suppress alerts for the affected monitors.' },
    { id: 'communications', title: 'Communications', desc: 'Teams, email and webhook channels with escalation policies.' },
    { id: 'reports', title: 'Daily Report', desc: 'Daily operational report generated from current data.' },
    { id: 'audit', title: 'Audit Trail', desc: 'Chronological record of operator and system actions.' },
  ];

  return (
    <div className="space-y-5 min-w-0">

      {/* 1. Page Header */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight font-mono truncate">
              PROJECT OVERVIEW &amp; SYSTEM ARCHITECTURE
            </h1>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded font-semibold text-blue-400 bg-blue-950/60 border border-blue-800/80 shrink-0">
              OPERATIONS MANUAL
            </span>
          </div>
          <p className={`text-xs mt-1 font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Scholario IT Operations Control Center · How it works &amp; current health summary
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRefresh}
            disabled={syncing}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium rounded transition-colors border cursor-pointer disabled:opacity-60 disabled:cursor-wait ${
              isDark
                ? 'text-slate-300 bg-[#162033] hover:bg-[#1C2942] border-[#243552]'
                : 'text-slate-700 bg-white hover:bg-slate-50 border-slate-300 shadow-2xs'
            }`}
            title="Reload all operational data from the API"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-blue-500 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'SYNCING...' : 'SYNC STATS'}</span>
          </button>
          <button
            onClick={() => go('overview')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors shadow-xs cursor-pointer"
          >
            <span>COMMAND CENTER</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. KPI cards (or skeletons while the first load is in flight) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {isLoading ? (
          <>
            <KpiCardSkeleton isDark={isDark} index={0} />
            <KpiCardSkeleton isDark={isDark} index={1} />
            <KpiCardSkeleton isDark={isDark} index={2} />
            <KpiCardSkeleton isDark={isDark} index={3} />
          </>
        ) : (
          <>
            {/* KPI 1: Active Incidents */}
            <div role="button" tabIndex={0} onClick={() => go('incidents')} onKeyDown={kpiKeys('incidents')} className={kpiShell(activeIncidents.length > 0)}>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[10px] font-mono font-semibold uppercase tracking-wider truncate ${activeIncidents.length > 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                    Active Incidents
                  </span>
                  <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${activeIncidents.length > 0 ? 'text-rose-500 animate-pulse' : 'text-slate-400'}`} />
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className={`text-2xl font-bold font-mono tabular-nums ${activeIncidents.length > 0 ? 'text-rose-500' : (isDark ? 'text-slate-100' : 'text-slate-900')}`}>
                    {activeIncidents.length}
                  </span>
                  <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${
                    criticalIncidentsCount > 0 ? 'bg-rose-500/20 text-rose-400 border border-rose-800' : 'bg-emerald-500/10 text-emerald-500'
                  }`}>
                    {criticalIncidentsCount > 0 ? `${criticalIncidentsCount} CRITICAL` : 'NONE CRITICAL'}
                  </span>
                </div>
              </div>
              <div className="mt-2.5 pt-2 border-t border-inherit flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span className="truncate">
                  {activeIncidents[0] ? `${activeIncidents[0].id}: ${activeIncidents[0].title}` : 'No open incidents'}
                </span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform shrink-0 ml-1 text-slate-400 group-hover:text-blue-500" />
              </div>
            </div>

            {/* KPI 2: Uptime */}
            <div role="button" tabIndex={0} onClick={() => go('applications')} onKeyDown={kpiKeys('applications')} className={kpiShell(false)}>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400 truncate">
                    Avg Application Uptime (30d)
                  </span>
                  <Activity className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className={`text-2xl font-bold font-mono tabular-nums ${
                    avgUptime === null ? 'text-slate-500' : avgUptime >= 99.9 ? 'text-emerald-500' : 'text-amber-500'
                  }`}>
                    {avgUptime === null ? '—' : `${avgUptime.toFixed(2)}%`}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400 font-semibold">
                    {avgUptime === null ? 'NO DATA YET' : `${uptimeVals.length} APP(S)`}
                  </span>
                </div>
              </div>
              <div className="mt-2.5 pt-2 border-t border-inherit flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span className="truncate">
                  {systemSummary.healthyServers}/{systemSummary.totalServers} servers healthy
                </span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform shrink-0 ml-1 text-slate-400 group-hover:text-blue-500" />
              </div>
            </div>

            {/* KPI 3: Pending Deployments */}
            <div role="button" tabIndex={0} onClick={() => go('deployments')} onKeyDown={kpiKeys('deployments')} className={kpiShell(false)}>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400 truncate">
                    Pending Deployments
                  </span>
                  <GitBranch className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className={`text-2xl font-bold font-mono tabular-nums ${
                    pendingDeployments.length > 0 ? 'text-blue-500' : (isDark ? 'text-slate-100' : 'text-slate-900')
                  }`}>
                    {pendingDeployments.length}
                  </span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold ${
                    pendingDeployments.length > 0 ? 'bg-blue-500/10 text-blue-400' : 'bg-slate-500/10 text-slate-400'
                  }`}>
                    {pendingDeployments.length > 0 ? 'IN PROGRESS' : 'IDLE'}
                  </span>
                </div>
              </div>
              <div className="mt-2.5 pt-2 border-t border-inherit flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span className="truncate">
                  {latestDeployment ? `Last: ${latestDeployment.version} (${latestAppName})` : 'No deployments recorded'}
                </span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform shrink-0 ml-1 text-slate-400 group-hover:text-blue-500" />
              </div>
            </div>

            {/* KPI 4: DR Readiness */}
            <div role="button" tabIndex={0} onClick={() => go('resilience')} onKeyDown={kpiKeys('resilience')} className={kpiShell(false)}>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400 truncate">
                    PRD / DR Readiness
                  </span>
                  <ShieldCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className={`text-2xl font-bold font-mono tabular-nums ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                    {systemSummary.drReadinessCount} / {systemSummary.totalApps}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-semibold">
                    DR READY
                  </span>
                </div>
              </div>
              <div className="mt-2.5 pt-2 border-t border-inherit flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span className="truncate">{deadManLabel}</span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform shrink-0 ml-1 text-slate-400 group-hover:text-blue-500" />
              </div>
            </div>
          </>
        )}
      </div>

      {/* 3. Navigation Section Switcher */}
      <div className="flex flex-wrap gap-1.5 font-mono text-xs pt-1">
        {([
          { id: 'architecture', label: '1. Architecture & Data Flow' },
          { id: 'stack', label: '2. Tech Stack' },
          { id: 'features', label: '3. Operational Views' },
          { id: 'themes', label: '4. Themes' },
          { id: 'principles', label: '5. Operational Principles' }
        ] as Array<{ id: Section; label: string }>).map(sec => (
          <button
            key={sec.id}
            onClick={() => setActiveSection(sec.id)}
            className={`px-3 py-1.5 rounded text-xs transition-colors cursor-pointer border ${
              activeSection === sec.id
                ? 'bg-blue-600 text-white font-semibold border-blue-500 shadow-xs'
                : isDark
                  ? 'bg-[#111726] hover:bg-[#162033] text-slate-300 border-[#1E293B]'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200 shadow-xs'
            }`}
          >
            {sec.label}
          </button>
        ))}
      </div>

      {/* Section 1: Architecture & Data Flow */}
      {activeSection === 'architecture' && (
        <div className="space-y-4">
          <div className={card}>
            <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-blue-500 mb-2">
              Topology (from registered data)
            </h2>
            <p className={`${bodyText} mb-4`}>
              {servers.length === 0 && applications.length === 0 ? (
                <>
                  Nothing is registered yet. Add your PRD and DR servers and your applications in{' '}
                  <button onClick={() => go('setup')} className="text-blue-400 hover:text-blue-300 underline underline-offset-2 cursor-pointer">Setup</button>.
                </>
              ) : (
                <>
                  Currently monitoring {applications.length} application(s) across {servers.length} server(s)
                  {providers.length ? ` (${providers.join(', ')})` : ''}{regions.length ? ` in ${regions.join(', ')}` : ''}.
                  Each application is served by a PRD server and can fail over to a DR server by switching its Cloudflare DNS record.
                </>
              )}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
              <div className={tile}>
                <Globe className="w-5 h-5 mx-auto text-blue-500 mb-1" />
                <div className="font-bold text-xs">1. Clients</div>
                <div className="text-[10px] text-slate-400 mt-1">Resolve the application hostname</div>
              </div>
              <div className={tile}>
                <ShieldCheck className="w-5 h-5 mx-auto text-indigo-400 mb-1" />
                <div className="font-bold text-xs">2. Cloudflare DNS</div>
                <div className="text-[10px] text-slate-400 mt-1">
                  {cfConfigured ? `${cloudflareZones.length} zone(s) synced` : 'API token not configured'}
                </div>
                <div className="text-[9px] text-slate-500 mt-1">{dnsLinkedApps}/{applications.length} app(s) with a DNS record</div>
              </div>
              <div className={tile}>
                <Server className="w-5 h-5 mx-auto text-emerald-400 mb-1" />
                <div className="font-bold text-xs">3. PRD Origins</div>
                <div className="text-[10px] text-slate-400 mt-1">{prdServers} server(s)</div>
              </div>
              <div className={tile}>
                <Network className="w-5 h-5 mx-auto text-amber-400 mb-1" />
                <div className="font-bold text-xs">4. DR Origins</div>
                <div className="text-[10px] text-slate-400 mt-1">{drServers} server(s)</div>
              </div>
            </div>
            <div className={`text-[10px] font-mono mt-3 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
              Telemetry: {reportingServers}/{servers.length} server agent(s) reporting · {monitors.length} monitor(s) configured
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={card}>
              <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-emerald-500 mb-1.5">
                Dead-Man Heartbeat
              </h3>
              <p className={bodyText}>
                The heartbeat of the monitored infrastructure: every PRD / DR server's telemetry agent, plus the application
                checks, watched services and database probes it reports. Late or failing heartbeats open incidents.{' '}
                {deadManConfigured
                  ? `${deadMan.servers.length} server(s), ${deadMan.counts.total} check(s). Current status: ${deadMan.status}.`
                  : 'No servers registered yet.'}
              </p>
            </div>

            <div className={card}>
              <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-amber-500 mb-1.5">
                DNS Failover
              </h3>
              <p className={bodyText}>
                Failover updates the application's Cloudflare DNS record from the PRD server IP to the DR server IP (and back
                on failback). Manual failover requires the super_admin role. Auto-failover is enabled for {autoFailoverApps} of{' '}
                {applications.length} application(s) and only triggers when PRD is confirmed CRITICAL and DR monitors are healthy.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Section 2: Tech Stack */}
      {activeSection === 'stack' && (
        <div className="space-y-4">
          <div className={card}>
            <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-blue-500 mb-2">
              Technology Stack
            </h2>
            <div className="w-full min-w-0 overflow-x-auto">
              <table className="w-full text-left text-xs font-mono min-w-[600px]">
                <thead className={`border-b ${isDark ? 'border-[#1E293B] text-slate-400' : 'border-slate-200 text-slate-600'}`}>
                  <tr>
                    <th className="py-2 px-3">Layer</th>
                    <th className="py-2 px-3">Technology</th>
                    <th className="py-2 px-3">Role</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? 'divide-[#1E293B]' : 'divide-slate-100'}`}>
                  {[
                    ['UI Framework', 'React 19', 'Functional components and hooks'],
                    ['Build Tool', 'Vite', 'Frontend dev server and bundler'],
                    ['CSS Framework', 'Tailwind CSS v4', 'Utility-first styling with dark / light themes'],
                    ['Iconography', 'lucide-react', 'Icon set used across the UI'],
                    ['State', 'OpsContext', 'Single source of state loaded from the REST API and kept current via the realtime event stream'],
                    ['Backend', 'Node.js API', 'Monitor engine, incident engine, Cloudflare / Hostinger integrations, agent ingestion'],
                  ].map(([layer, tech, role]) => (
                    <tr key={layer}>
                      <td className="py-2.5 px-3 font-semibold text-blue-400">{layer}</td>
                      <td className="py-2.5 px-3">{tech}</td>
                      <td className={`py-2.5 px-3 font-sans ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Section 3: Operational Views */}
      {activeSection === 'features' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {views.map(vw => (
            <div
              key={vw.id}
              onClick={() => go(vw.id)}
              className={`p-3.5 rounded-lg border transition-all cursor-pointer group flex flex-col justify-between ${
                isDark ? 'bg-[#111726] border-[#1E293B] hover:border-blue-500' : 'bg-white border-slate-200 hover:border-blue-400 shadow-xs'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs font-mono group-hover:text-blue-500 transition-colors flex items-center gap-1.5">
                    {vw.id === 'setup' && <Settings2 className="w-3.5 h-3.5" />}
                    {vw.title}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-500 transition-colors shrink-0" />
                </div>
                <p className={`text-xs font-sans mt-1.5 leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  {vw.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Section 4: Themes */}
      {activeSection === 'themes' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg border border-slate-700 bg-[#0B0F17] text-slate-100 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
              <Moon className="w-4 h-4 text-indigo-400" />
              <span className="font-bold text-xs font-mono">Dark Mode (Default)</span>
            </div>
            <ul className="text-xs font-mono space-y-2 text-slate-300">
              <li>• <strong>Canvas</strong>: `#0B0F17`</li>
              <li>• <strong>Containers</strong>: `#111726`</li>
              <li>• <strong>Borders</strong>: `#1E293B`</li>
              <li>• <strong>Suited for</strong>: Operations-centre wall displays</li>
            </ul>
          </div>
          <div className="p-4 rounded-lg border border-slate-300 bg-[#F6F8FC] text-slate-900 space-y-3 shadow-xs">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
              <Sun className="w-4 h-4 text-amber-500" />
              <span className="font-bold text-xs font-mono">Light Mode</span>
            </div>
            <ul className="text-xs font-mono space-y-2 text-slate-700">
              <li>• <strong>Canvas</strong>: `#F6F8FC`</li>
              <li>• <strong>Containers</strong>: `#FFFFFF`</li>
              <li>• <strong>Borders</strong>: `#E2E8F0`</li>
              <li>• <strong>Suited for</strong>: Daylight viewing, reports</li>
            </ul>
          </div>
        </div>
      )}

      {/* Section 5: Operational Principles */}
      {activeSection === 'principles' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
          <div className={`${card} space-y-2`}>
            <div className="text-xs font-bold text-blue-500 uppercase">1. Confirmed Failures Only</div>
            <p className={bodyText}>
              A monitor only opens an incident after its configured number of consecutive failures, and an incident
              auto-resolves only after the configured number of consecutive passes.
              {thresholds.length > 0 && ` Failure thresholds in use: ${thresholds.sort((a, b) => a - b).join(', ')}.`}
            </p>
          </div>
          <div className={`${card} space-y-2`}>
            <div className="text-xs font-bold text-amber-500 uppercase">2. Independent Watchdog</div>
            <p className={bodyText}>
              The dead-man heartbeat watches the monitored servers: an agent that stops reporting turns STALE, then
              DISCONNECTED, and raises an incident. {deadManConfigured ? `${deadMan.servers.length} server(s) are covered.` : 'No servers are registered yet.'}
            </p>
          </div>
          <div className={`${card} space-y-2`}>
            <div className="text-xs font-bold text-emerald-500 uppercase">3. Honest Data</div>
            <p className={bodyText}>
              Every figure on these dashboards comes from real checks, agent reports or provider APIs. Values that have
              not been measured yet are shown as "—" or "No data".
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
