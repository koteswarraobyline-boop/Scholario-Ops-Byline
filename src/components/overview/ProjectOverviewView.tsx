import React, { useState, useEffect } from 'react';
import { useOps } from '../../context/OpsContext';
import { 
  BookOpen, 
  Layers, 
  Cpu, 
  Server, 
  ShieldCheck, 
  CheckCircle2, 
  Activity, 
  FileText, 
  Terminal, 
  Sparkles,
  ArrowRight,
  Radio,
  Globe,
  Sliders,
  Database,
  GitBranch,
  RefreshCw,
  Sun,
  Moon,
  AlertTriangle,
  Clock,
  ExternalLink
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
        {/* Top Header Row: Label + Icon */}
        <div className="flex items-center justify-between gap-2">
          <div className={`h-2.5 ${tWidth} rounded ${shimmer}`} />
          <div className={`w-3.5 h-3.5 rounded ${shimmer} shrink-0`} />
        </div>

        {/* Middle Metric Row: 2xl Value + Status Pill */}
        <div className="mt-1.5 flex items-baseline gap-2">
          <div className={`h-7 ${vWidth} rounded ${shimmer}`} />
          <div className={`h-4.5 ${pWidth} rounded ${shimmer}`} />
        </div>
      </div>

      {/* Bottom Footer Row: Description + Arrow */}
      <div className={`mt-2.5 pt-2 border-t flex items-center justify-between ${
        isDark ? 'border-[#1E293B]' : 'border-slate-100'
      }`}>
        <div className={`h-2.5 ${dWidth} rounded ${shimmer}`} />
        <div className={`w-3 h-3 rounded ${shimmer} shrink-0 ml-1`} />
      </div>
    </div>
  );
};

export const ProjectOverviewView: React.FC = () => {
  const { 
    theme, 
    setActiveTab, 
    systemSummary, 
    incidents, 
    servers, 
    applications, 
    deployments,
    deadMan,
    runAllProbes
  } = useOps();
  const isDark = theme === 'dark';

  const [isLoading, setIsLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<'architecture' | 'stack' | 'features' | 'themes' | 'principles'>('architecture');

  // Brief initial loading state to demonstrate zero-CLS transition on mount
  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 450);
    return () => clearTimeout(timer);
  }, []);

  const handleRefreshMetrics = () => {
    setIsLoading(true);
    runAllProbes();
    setTimeout(() => {
      setIsLoading(false);
    }, 550);
  };

  // Calculate real-time health stats
  const activeIncidents = incidents.filter(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  const criticalIncidentsCount = incidents.filter(i => i.severity === 'CRITICAL' && i.status !== 'RESOLVED').length;

  // Average cluster uptime across all applications
  const avgUptime = applications.length > 0 
    ? +(applications.reduce((acc, app) => acc + app.uptime30d, 0) / applications.length).toFixed(2)
    : 99.98;

  // Pending / In-flight deployments
  const pendingDeployments = deployments.filter(d => 
    d.status === 'BUILDING' || d.status === 'DEPLOYING' || d.status === 'HEALTH_CHECK' || d.status === 'SMOKE_TEST'
  );
  const latestDeployment = deployments[0];
  const latestAppName = latestDeployment 
    ? (applications.find(a => a.id === latestDeployment.applicationId)?.name || latestDeployment.applicationId)
    : '';

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
            Scholario IT Operations Control Center · Production Specification &amp; Real-Time Health Summary
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRefreshMetrics}
            disabled={isLoading}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium rounded transition-colors border cursor-pointer ${
              isDark 
                ? 'text-slate-300 bg-[#162033] hover:bg-[#1C2942] border-[#243552]' 
                : 'text-slate-700 bg-white hover:bg-slate-50 border-slate-300 shadow-2xs'
            }`}
            title="Poll real-time cluster telemetry and refresh health stats"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-blue-500 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? 'SYNCING...' : 'SYNC STATS'}</span>
          </button>
          <button
            onClick={() => setActiveTab('overview')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors shadow-xs cursor-pointer"
          >
            <span>COMMAND CENTER</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. REAL-TIME SUMMARY KPI CARDS SECTION (OR SKELETON LOADERS) */}
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
            <div 
              role="button"
              tabIndex={0}
              onClick={() => setActiveTab('incidents')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab('incidents'); } }}
              className={`p-3.5 sm:p-4 rounded-lg border transition-all cursor-pointer group flex flex-col justify-between min-w-0 min-h-[116px] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                activeIncidents.length > 0
                  ? (isDark ? 'bg-[#180E13] border-rose-900/70 hover:border-rose-600' : 'bg-rose-50/70 border-rose-200 hover:border-rose-400 shadow-xs')
                  : (isDark ? 'bg-[#111726] border-[#1E293B] hover:border-blue-500' : 'bg-white border-slate-200 hover:border-blue-400 shadow-xs')
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[10px] font-mono font-semibold uppercase tracking-wider truncate ${
                    activeIncidents.length > 0 ? 'text-rose-500' : 'text-slate-400'
                  }`}>
                    Active Incidents
                  </span>
                  <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${
                    activeIncidents.length > 0 ? 'text-rose-500 animate-pulse' : 'text-slate-400'
                  }`} />
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className={`text-2xl font-bold font-mono tabular-nums ${
                    activeIncidents.length > 0 ? 'text-rose-500' : (isDark ? 'text-slate-100' : 'text-slate-900')
                  }`}>
                    {activeIncidents.length}
                  </span>
                  <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${
                    criticalIncidentsCount > 0
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-800'
                      : 'bg-emerald-500/10 text-emerald-500'
                  }`}>
                    {criticalIncidentsCount > 0 ? `${criticalIncidentsCount} CRITICAL` : 'NOMINAL'}
                  </span>
                </div>
              </div>
              <div className="mt-2.5 pt-2 border-t border-inherit flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span className="truncate">
                  {activeIncidents[0] ? `INC-1042: ${activeIncidents[0].title.slice(0, 22)}...` : 'All systems operational'}
                </span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform shrink-0 ml-1 text-slate-400 group-hover:text-blue-500" />
              </div>
            </div>

            {/* KPI 2: Server Uptime Percentage */}
            <div 
              role="button"
              tabIndex={0}
              onClick={() => setActiveTab('uptime')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab('uptime'); } }}
              className={`p-3.5 sm:p-4 rounded-lg border transition-all cursor-pointer group flex flex-col justify-between min-w-0 min-h-[116px] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                isDark ? 'bg-[#111726] border-[#1E293B] hover:border-blue-500' : 'bg-white border-slate-200 hover:border-blue-400 shadow-xs'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400 truncate">
                    Server Uptime Percentage
                  </span>
                  <Activity className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className={`text-2xl font-bold font-mono tabular-nums ${
                    avgUptime >= 99.9 ? 'text-emerald-500' : 'text-amber-500'
                  }`}>
                    {avgUptime}%
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-semibold">
                    SLA ≥ 99.90%
                  </span>
                </div>
              </div>
              <div className="mt-2.5 pt-2 border-t border-inherit flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span className="truncate">
                  {systemSummary.healthyServers}/{systemSummary.totalServers} Hostinger VPS Healthy
                </span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform shrink-0 ml-1 text-slate-400 group-hover:text-blue-500" />
              </div>
            </div>

            {/* KPI 3: Pending Deployments */}
            <div 
              role="button"
              tabIndex={0}
              onClick={() => setActiveTab('deployments')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab('deployments'); } }}
              className={`p-3.5 sm:p-4 rounded-lg border transition-all cursor-pointer group flex flex-col justify-between min-w-0 min-h-[116px] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                isDark ? 'bg-[#111726] border-[#1E293B] hover:border-blue-500' : 'bg-white border-slate-200 hover:border-blue-400 shadow-xs'
              }`}
            >
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
                    pendingDeployments.length > 0 
                      ? 'bg-blue-500/10 text-blue-400' 
                      : 'bg-slate-500/10 text-slate-400'
                  }`}>
                    {pendingDeployments.length > 0 ? 'IN PROGRESS' : 'IDLE'}
                  </span>
                </div>
              </div>
              <div className="mt-2.5 pt-2 border-t border-inherit flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span className="truncate">
                  {latestDeployment ? `Last: ${latestDeployment.version} (${latestAppName})` : 'Zero queued pipelines'}
                </span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform shrink-0 ml-1 text-slate-400 group-hover:text-blue-500" />
              </div>
            </div>

            {/* KPI 4: DR Standby Readiness */}
            <div 
              role="button"
              tabIndex={0}
              onClick={() => setActiveTab('resilience')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab('resilience'); } }}
              className={`p-3.5 sm:p-4 rounded-lg border transition-all cursor-pointer group flex flex-col justify-between min-w-0 min-h-[116px] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                isDark ? 'bg-[#111726] border-[#1E293B] hover:border-blue-500' : 'bg-white border-slate-200 hover:border-blue-400 shadow-xs'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400 truncate">
                    PRD / DR Standby Mesh
                  </span>
                  <ShieldCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className={`text-2xl font-bold font-mono tabular-nums ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                    {systemSummary.drReadinessCount} / {systemSummary.totalApps}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-semibold">
                    WARM STANDBY
                  </span>
                </div>
              </div>
              <div className="mt-2.5 pt-2 border-t border-inherit flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span className="truncate">
                  Watchdog: {deadMan.status === 'HEALTHY' ? '1.0s Heartbeat OK' : 'Silenced'}
                </span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform shrink-0 ml-1 text-slate-400 group-hover:text-blue-500" />
              </div>
            </div>
          </>
        )}
      </div>

      {/* 3. Navigation Section Switcher */}
      <div className="flex flex-wrap gap-1.5 font-mono text-xs pt-1">
        {[
          { id: 'architecture', label: '1. Architecture & Data Flow' },
          { id: 'stack', label: '2. Tech Stack & Inter Typography' },
          { id: 'features', label: '3. 14 Operational Views' },
          { id: 'themes', label: '4. Enterprise Dual Themes' },
          { id: 'principles', label: '5. SRE Operational Principles' }
        ].map(sec => (
          <button
            key={sec.id}
            onClick={() => setActiveSection(sec.id as any)}
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
          <div className={`p-4 rounded-lg border ${
            isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
          }`}>
            <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-blue-500 mb-2">
              High-Level Topology Architecture
            </h2>
            <p className={`text-xs leading-relaxed font-sans mb-4 ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
              Scholario Ops manages an EdTech multi-region infrastructure spanning 8 core applications and 16 Hostinger KVM VPS nodes across Singapore, Frankfurt, Mumbai, and London. Traffic routing, DDoS defense, and failover orchestration are decoupled into an Anycast ingress tier and origin cluster.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 font-mono text-xs">
              <div className={`p-3 rounded border text-center ${
                isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200'
              }`}>
                <Globe className="w-5 h-5 mx-auto text-blue-500 mb-1" />
                <div className="font-bold text-xs">1. End Users</div>
                <div className="text-[10px] text-slate-400 mt-1">14,200 req/min</div>
                <div className="text-[9px] text-emerald-500 mt-1">330+ Global PoPs</div>
              </div>

              <div className={`p-3 rounded border text-center ${
                isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200'
              }`}>
                <ShieldCheck className="w-5 h-5 mx-auto text-indigo-400 mb-1" />
                <div className="font-bold text-xs">2. Anycast CDN</div>
                <div className="text-[10px] text-slate-400 mt-1">Cloudflare Edge</div>
                <div className="text-[9px] text-emerald-500 mt-1">TLS 1.3 Strict</div>
              </div>

              <div className={`p-3 rounded border text-center ${
                isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200'
              }`}>
                <Cpu className="w-5 h-5 mx-auto text-rose-400 mb-1" />
                <div className="font-bold text-xs">3. WAF Defense</div>
                <div className="text-[10px] text-slate-400 mt-1">ML Threat Filter</div>
                <div className="text-[9px] text-amber-500 mt-1">Quarantined Bypass</div>
              </div>

              <div className={`p-3 rounded border text-center ${
                isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200'
              }`}>
                <Sliders className="w-5 h-5 mx-auto text-amber-400 mb-1" />
                <div className="font-bold text-xs">4. Load Balancer</div>
                <div className="text-[10px] text-slate-400 mt-1">Traffic Director</div>
                <div className="text-[9px] text-blue-400 mt-1">5s Probe Rate</div>
              </div>

              <div className={`p-3 rounded border text-center ${
                isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200'
              }`}>
                <Server className="w-5 h-5 mx-auto text-emerald-400 mb-1" />
                <div className="font-bold text-xs">5. Origins (PRD/DR)</div>
                <div className="text-[10px] text-slate-400 mt-1">Hostinger Fleet</div>
                <div className="text-[9px] text-emerald-500 mt-1">Active / Standby</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`p-4 rounded-lg border ${
              isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-emerald-500 mb-1.5">
                Zurich Dead-Man Watchdog
              </h3>
              <p className={`text-xs leading-relaxed font-sans ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                Independent out-of-band monitoring node located in Zurich, Switzerland (`ch-zh-monitor-01`). Emits cardiac rhythm pulses at 1.0 Hz with real-time jitter calculation. If 4 consecutive pulses are missed (tolerance window 5.0s), the control plane automatically triggers silence escalation via Microsoft Teams and SMS.
              </p>
            </div>

            <div className={`p-4 rounded-lg border ${
              isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-amber-500 mb-1.5">
                Anycast Failover Engine
              </h3>
              <p className={`text-xs leading-relaxed font-sans ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                Provides zero-downtime traffic diversion between primary origin nodes and standby disaster recovery nodes. Cloudflare load balancer origins are updated in real-time, preserving session affinity while isolating degraded compute nodes in under 15 seconds.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Section 2: Tech Stack & Inter Typography */}
      {activeSection === 'stack' && (
        <div className="space-y-4">
          <div className={`p-4 rounded-lg border ${
            isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
          }`}>
            <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-blue-500 mb-2">
              Technology Stack &amp; Typography Hierarchy
            </h2>
            <div className="w-full min-w-0 overflow-x-auto">
              <table className="w-full text-left text-xs font-mono min-w-[600px]">
                <thead className={`border-b ${isDark ? 'border-[#1E293B] text-slate-400' : 'border-slate-200 text-slate-600'}`}>
                  <tr>
                    <th className="py-2 px-3">Layer</th>
                    <th className="py-2 px-3">Technology</th>
                    <th className="py-2 px-3">Role &amp; Configuration</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? 'divide-[#1E293B]' : 'divide-slate-100'}`}>
                  <tr>
                    <td className="py-2.5 px-3 font-semibold text-blue-400">UI Framework</td>
                    <td className="py-2.5 px-3">React 19</td>
                    <td className={`py-2.5 px-3 font-sans ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>Functional components, hooks, memoized actions, clean lifecycle management</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-semibold text-blue-400">Primary Typography</td>
                    <td className="py-2.5 px-3 font-bold text-emerald-400">Inter</td>
                    <td className={`py-2.5 px-3 font-sans ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>Weights 300 to 900 loaded via Google Fonts; OpenType features cv02, cv03, cv04, cv11 applied globally across headers, titles, and body</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-semibold text-blue-400">Tabular Typography</td>
                    <td className="py-2.5 px-3">JetBrains Mono</td>
                    <td className={`py-2.5 px-3 font-sans ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>Tabular figures (`tabular-nums`) for hostnames, IPv4, commit hashes, latency numbers, status tags</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-semibold text-blue-400">Build Tool</td>
                    <td className="py-2.5 px-3">Vite 8</td>
                    <td className={`py-2.5 px-3 font-sans ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>High-performance bundler running on port 3000 (0.0.0.0 host binding)</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-semibold text-blue-400">CSS Framework</td>
                    <td className="py-2.5 px-3">Tailwind CSS v4</td>
                    <td className={`py-2.5 px-3 font-sans ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>Configured with `@theme` variables, zero-runtime CSS footprint</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-semibold text-blue-400">Iconography</td>
                    <td className="py-2.5 px-3">lucide-react v0.546</td>
                    <td className={`py-2.5 px-3 font-sans ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>Vector glyphs with consistent optical sizing and stroke weights</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-semibold text-blue-400">State &amp; Persistence</td>
                    <td className="py-2.5 px-3">OpsContext + localStorage</td>
                    <td className={`py-2.5 px-3 font-sans ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>Global reactive context with instant synchronization to 6 localStorage snapshot keys</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Section 3: 14 Operational Views */}
      {activeSection === 'features' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { id: 'overview', title: 'Command Center', desc: 'Real-time telemetry, 5 core operational answers, all visual flow charts, and fleet preview.' },
              { id: 'applications', title: 'Applications Catalog', desc: '8 EdTech tier systems with 10-tab modal inspection and failover orchestration.' },
              { id: 'infrastructure', title: 'Hostinger VPS Fleet', desc: '16 KVM servers across 4 regions with 4 telemetry area graphs and process/service inspect.' },
              { id: 'monitors', title: 'Monitoring Probe Engine', desc: '55+ continuous probes, heartbeat strip, manual triggers, and consecutive failure tracking.' },
              { id: 'incidents', title: 'Incident Command', desc: 'Incident triage with 7-tab investigation modal, SLA timelines, and 7-step recovery state machine.' },
              { id: 'resilience', title: 'PRD / DR Readiness', desc: 'Disaster recovery checklist, live replication lag verification, and traffic divert console.' },
              { id: 'backups', title: 'Backup Integrity', desc: 'Database snapshots, object storage archives, and SHA-256 integrity checksum verification.' },
              { id: 'dependencies', title: 'Dependency Topology', desc: 'Interactive graph tracing users through Anycast edge to VPS, databases, and third-party APIs.' },
              { id: 'cloudflare', title: 'Cloudflare Edge', desc: 'DNS records management, Anycast routing, WAF bot defense, and load balancer health pools.' },
              { id: 'hostinger', title: 'Hostinger Provider', desc: 'Hypervisor hardware specifications, region distribution, and agent telemetry uplink.' },
              { id: 'deployments', title: 'Deployments Pipeline', desc: 'Pipeline stage tracking with rollback capability and version commit verification.' },
              { id: 'runbooks', title: 'Runbooks (SOPs)', desc: 'Standard operating procedures with step-by-step operator execution tracking.' },
              { id: 'maintenance', title: 'Maintenance Windows', desc: 'Scheduled maintenance with automatic monitor probe alert suppression.' },
              { id: 'communications', title: 'Communications & On-Call', desc: 'Microsoft Teams, email, SMS notification channels, and multi-tier escalation policies.' },
              { id: 'reports', title: 'Daily Ops Report', desc: 'Formatted daily executive briefing in terminal-style monospace with copy & export.' },
              { id: 'audit', title: 'Audit Trail', desc: 'Immutable chronological audit record of all operator actions with filtering.' }
            ].map(vw => (
              <div 
                key={vw.id}
                onClick={() => setActiveTab(vw.id)}
                className={`p-3.5 rounded-lg border transition-all cursor-pointer group flex flex-col justify-between ${
                  isDark ? 'bg-[#111726] border-[#1E293B] hover:border-blue-500' : 'bg-white border-slate-200 hover:border-blue-400 shadow-xs'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs font-mono group-hover:text-blue-500 transition-colors">
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
        </div>
      )}

      {/* Section 4: Enterprise Dual Themes */}
      {activeSection === 'themes' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Dark Theme Card */}
            <div className="p-4 rounded-lg border border-slate-700 bg-[#0B0F17] text-slate-100 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Moon className="w-4 h-4 text-indigo-400" />
                  <span className="font-bold text-xs font-mono">Dark Mode (Default)</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800">
                  SOC High-Contrast
                </span>
              </div>
              <ul className="text-xs font-mono space-y-2 text-slate-300">
                <li>• <strong>Canvas</strong>: Deep carbon `#0B0F17`</li>
                <li>• <strong>Containers</strong>: SOC deep navy `#111726`</li>
                <li>• <strong>Borders</strong>: Structural slate `#1E293B`</li>
                <li>• <strong>Indicators</strong>: High-contrast emerald, amber, rose &amp; blue</li>
                <li>• <strong>Optimal for</strong>: 24/7 Operations Centers, reduced eye fatigue</li>
              </ul>
            </div>

            {/* Light Theme Card */}
            <div className="p-4 rounded-lg border border-slate-300 bg-[#F6F8FC] text-slate-900 space-y-3 shadow-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <Sun className="w-4 h-4 text-amber-500" />
                  <span className="font-bold text-xs font-mono">Light Mode</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-200 text-slate-700 border border-slate-300">
                  Corporate Enterprise
                </span>
              </div>
              <ul className="text-xs font-mono space-y-2 text-slate-700">
                <li>• <strong>Canvas</strong>: Clean corporate `#F6F8FC`</li>
                <li>• <strong>Sidebar</strong>: Enterprise navy `#17233C`</li>
                <li>• <strong>Containers</strong>: Pure white `#FFFFFF`</li>
                <li>• <strong>Borders</strong>: Crisp structural slate `#E2E8F0`</li>
                <li>• <strong>Optimal for</strong>: Daylight viewing, executive briefing</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Section 5: SRE Operational Principles */}
      {activeSection === 'principles' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
            <div className={`p-4 rounded-lg border space-y-2 ${
              isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <div className="text-xs font-bold text-blue-500 uppercase">1. Consecutive Check Rules</div>
              <p className={`text-xs font-sans leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                Spurious blips and transient network hiccups are automatically retried. Incidents only trigger on a confirmed 3/3 consecutive probe failure sequence, and resolution strictly requires 3/3 consecutive passes to prevent flap cycles.
              </p>
            </div>

            <div className={`p-4 rounded-lg border space-y-2 ${
              isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <div className="text-xs font-bold text-amber-500 uppercase">2. Decoupled Watchdog</div>
              <p className={`text-xs font-sans leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                The independent Zurich monitor runs completely outside the Hostinger hypervisor mesh. It guarantees that complete infrastructure blackouts or regional fiber cuts are immediately detected and escalated.
              </p>
            </div>

            <div className={`p-4 rounded-lg border space-y-2 ${
              isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <div className="text-xs font-bold text-emerald-500 uppercase">3. Rapid Anycast Rerouting</div>
              <p className={`text-xs font-sans leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                Traffic diversion is executed at Cloudflare's Anycast Edge instead of waiting for DNS propagation. Degraded origin nodes are quarantined while warm standby DR nodes receive 100% of live traffic with zero data loss.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
