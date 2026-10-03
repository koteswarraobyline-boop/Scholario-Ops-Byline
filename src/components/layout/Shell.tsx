import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { 
  Activity, 
  AlertTriangle, 
  Bell, 
  Layers, 
  Server, 
  RefreshCw, 
  Search, 
  ChevronLeft, 
  ChevronRight, 
  Cloud, 
  ShieldCheck, 
  Database, 
  Terminal, 
  GitBranch, 
  Calendar, 
  FileText, 
  Sliders, 
  Radio, 
  Cpu, 
  Lock, 
  ExternalLink,
  Zap,
  CheckCircle2,
  AlertOctagon,
  ArrowRight,
  Shield,
  Sun,
  Moon
} from 'lucide-react';
import { CommandPalette } from './CommandPalette';

interface ShellProps {
  children: React.ReactNode;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: string;
  badge?: string;
  badgeColor?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export const Shell: React.FC<ShellProps> = ({ children }) => {
  const { 
    activeTab, 
    setActiveTab, 
    systemSummary, 
    lastUpdatedSecondsAgo, 
    setIsCommandPaletteOpen,
    incidents,
    setSelectedIncidentId,
    deadMan,
    triggerSimulatedScenario,
    runAllProbes,
    theme,
    toggleTheme
  } = useOps();

  const isDark = theme === 'dark';

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showSimMenu, setShowSimMenu] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const activeCriticalIncident = incidents.find(i => i.severity === 'CRITICAL' && (i.status === 'OPEN' || i.status === 'INVESTIGATING' || i.status === 'MITIGATING' || i.status === 'ACKNOWLEDGED'));

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    runAllProbes();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const navSections: NavSection[] = [
    {
      title: 'Command Center',
      items: [
        { id: 'overview', label: 'Overview', icon: Activity },
        { id: 'incidents', label: 'Incidents', icon: AlertTriangle, badge: systemSummary.openIncidents > 0 ? `${systemSummary.openIncidents}` : undefined, badgeColor: systemSummary.criticalIncidents > 0 ? 'text-rose-400 font-semibold' : 'text-amber-400' },
        { id: 'alerts', label: 'Alerts', icon: Bell }
      ]
    },
    {
      title: 'Monitoring',
      items: [
        { id: 'applications', label: 'Applications', icon: Layers, count: `${systemSummary.healthyApps}/${systemSummary.totalApps}` },
        { id: 'monitors', label: 'Monitors', icon: Radio, count: `${systemSummary.healthyMonitors}/${systemSummary.totalMonitors}` },
        { id: 'infrastructure', label: 'Infrastructure', icon: Server, count: `${systemSummary.healthyServers}/${systemSummary.totalServers}` },
        { id: 'dependencies', label: 'Dependencies', icon: Cpu }
      ]
    },
    {
      title: 'Resilience',
      items: [
        { id: 'resilience', label: 'PRD / DR Readiness', icon: Cloud, badge: `${systemSummary.drReadinessCount}/${systemSummary.totalApps}` },
        { id: 'backups', label: 'Backups', icon: Database, badge: `${systemSummary.backupsCurrentCount}/${systemSummary.totalApps}` },
        { id: 'failover', label: 'Failover Console', icon: RefreshCw }
      ]
    },
    {
      title: 'Providers',
      items: [
        { id: 'hostinger', label: 'Hostinger VPS', icon: Server },
        { id: 'cloudflare', label: 'Cloudflare Edge', icon: ShieldCheck, badge: systemSummary.cloudflareStatus === 'DEGRADED' ? 'Degraded' : 'Active', badgeColor: systemSummary.cloudflareStatus === 'DEGRADED' ? 'text-amber-400' : 'text-emerald-400' }
      ]
    },
    {
      title: 'Operations',
      items: [
        { id: 'deployments', label: 'Deployments', icon: GitBranch },
        { id: 'changes', label: 'Changes', icon: FileText },
        { id: 'maintenance', label: 'Maintenance', icon: Calendar },
        { id: 'runbooks', label: 'Runbooks', icon: Terminal }
      ]
    },
    {
      title: 'Communications',
      items: [
        { id: 'communications', label: 'Notifications', icon: Bell },
        { id: 'escalation', label: 'Escalation Policies', icon: Sliders }
      ]
    },
    {
      title: 'Analytics & Compliance',
      items: [
        { id: 'uptime', label: 'Uptime SLA', icon: Activity },
        { id: 'reports', label: 'Daily Ops Report', icon: FileText },
        { id: 'audit', label: 'Audit Logs', icon: Shield }
      ]
    }
  ];

  return (
    <div className={`flex h-screen w-screen overflow-hidden font-sans selection:bg-blue-600/30 selection:text-blue-200 ${
      isDark ? 'bg-[#0B0F17] text-slate-100' : 'bg-[#F6F8FC] text-slate-900'
    }`}>
      <CommandPalette />

      {/* LEFT SIDEBAR - Deep Carbon / Enterprise Navy Shell */}
      <aside 
        className={`${isSidebarCollapsed ? 'w-14' : 'w-60'} shrink-0 ${
          isDark 
            ? 'bg-[#0B0F17] text-slate-400 border-r border-[#1B2436]' 
            : 'bg-[#17233C] text-slate-300 border-r border-[#0F172A]'
        } flex flex-col transition-all duration-150 z-30 select-none shadow-md`}
      >
        {/* Brand header */}
        <div className={`h-12 flex items-center justify-between px-3 border-b ${
          isDark ? 'border-[#1B2436] bg-[#070A10]' : 'border-[#1E2E4E] bg-[#121C30]'
        }`}>
          {!isSidebarCollapsed ? (
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-blue-600 flex items-center justify-center text-white font-bold shadow-xs">
                <Activity className="w-3.5 h-3.5" />
              </div>
              <div className="leading-none">
                <span className="font-bold text-xs tracking-wider text-white font-mono">SCHOLARIO</span>
                <span className="text-[10px] text-blue-400 font-mono ml-1.5 font-bold">OPS</span>
              </div>
            </div>
          ) : (
            <div className="w-5 h-5 mx-auto rounded bg-blue-600 flex items-center justify-center text-white font-bold">
              <Activity className="w-3.5 h-3.5" />
            </div>
          )}

          <button
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="text-slate-400 hover:text-white p-1 rounded transition-colors"
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Navigation list */}
        <div className="flex-1 overflow-y-auto py-2.5 px-2 space-y-3.5">
          {navSections.map(section => (
            <div key={section.title} className="space-y-0.5">
              {!isSidebarCollapsed && (
                <div className="px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400 font-mono">
                  {section.title}
                </div>
              )}
              {section.items.map(item => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    title={isSidebarCollapsed ? item.label : undefined}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors cursor-pointer ${
                      isActive 
                        ? 'bg-blue-600 text-white font-semibold pl-2 shadow-xs' 
                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                    {!isSidebarCollapsed && (
                      <span className="truncate flex-1 text-left text-[11px]">{item.label}</span>
                    )}
                    {!isSidebarCollapsed && item.count && (
                      <span className={`font-mono text-[10px] tabular-nums ${isActive ? 'text-blue-100' : 'text-slate-400'}`}>
                        {item.count}
                      </span>
                    )}
                    {!isSidebarCollapsed && item.badge && (
                      <span className={`font-mono text-[10px] tabular-nums ${isActive ? 'text-white' : (item.badgeColor || 'text-slate-400')}`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Sidebar Footer: Watchdog Status */}
        <div className={`p-2.5 border-t text-[10px] ${
          isDark ? 'border-[#1B2436] bg-[#070A10]' : 'border-[#1E2E4E] bg-[#121C30]'
        }`}>
          {!isSidebarCollapsed ? (
            <div className="space-y-1.5 font-mono">
              <div className="flex items-center justify-between text-slate-300">
                <span className="text-[9px] uppercase tracking-wider">Independent Watchdog</span>
                <span className={`w-1.5 h-1.5 rounded-full ${deadMan.status === 'HEALTHY' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400 animate-ping'}`} />
              </div>
              <div className="text-slate-400 text-[10px] truncate">
                Zurich ZH4 · 1.0s Heartbeat
              </div>
            </div>
          ) : (
            <div className="flex justify-center">
              <span className={`w-1.5 h-1.5 rounded-full ${deadMan.status === 'HEALTHY' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            </div>
          )}
        </div>
      </aside>

      {/* MAIN VIEWPORT */}
      <div className={`flex-1 flex flex-col min-w-0 overflow-hidden ${
        isDark ? 'bg-[#0E131F]' : 'bg-[#F6F8FC]'
      }`}>
        
        {/* TOP BAR */}
        <header className={`h-12 px-5 flex items-center justify-between shrink-0 z-20 border-b ${
          isDark 
            ? 'bg-[#0B0F17] border-[#1B2436] text-slate-100' 
            : 'bg-white border-[#E2E8F0] text-slate-900 shadow-xs'
        }`}>
          
          {/* Left Zone: Environment Tag & Context */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold tracking-tight font-mono">
              SCHOLARIO IT OPS
            </span>
            <span className={`hidden sm:inline ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>/</span>
            <div className={`flex items-center gap-1.5 text-[11px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>CLUSTER: SINGAPORE (HOSTINGER PRD)</span>
            </div>
          </div>

          {/* Center Zone: Search bar */}
          <div className="flex-1 max-w-sm mx-4">
            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              className={`w-full flex items-center justify-between px-2.5 py-1 rounded text-xs transition-colors group cursor-pointer border ${
                isDark 
                  ? 'bg-[#121927] hover:bg-[#162033] border-[#1E293B] text-slate-400' 
                  : 'bg-[#F1F5F9] hover:bg-[#E2E8F0] border-[#CBD5E1] text-slate-600'
              }`}
            >
              <div className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-500" />
                <span className="truncate text-[11px]">Search routes, apps, VPS, incidents, actions...</span>
              </div>
              <div className="hidden sm:flex items-center gap-1 font-mono text-[9px]">
                <kbd className={`px-1 py-0.5 border rounded ${
                  isDark ? 'bg-[#0B0F17] border-slate-700 text-slate-400' : 'bg-white border-slate-300 text-slate-500 shadow-2xs'
                }`}>Ctrl</kbd>
                <span className={isDark ? 'text-slate-600' : 'text-slate-400'}>/</span>
                <kbd className={`px-1 py-0.5 border rounded ${
                  isDark ? 'bg-[#0B0F17] border-slate-700 text-slate-400' : 'bg-white border-slate-300 text-slate-500 shadow-2xs'
                }`}>⌘K</kbd>
              </div>
            </button>
          </div>

          {/* Right Zone: Theme Toggle, Health, Simulator & Profile */}
          <div className="flex items-center gap-2.5">
            {/* Theme Toggle Button (Light / Dark) */}
            <button
              onClick={toggleTheme}
              className={`flex items-center gap-1.5 px-2 py-1 text-[11px] font-mono rounded transition-colors border cursor-pointer ${
                isDark
                  ? 'bg-[#162033] hover:bg-[#1D2B44] text-amber-300 border-[#23334E]'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300 shadow-2xs'
              }`}
              title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {isDark ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden sm:inline">LIGHT</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-indigo-600" />
                  <span className="hidden sm:inline">DARK</span>
                </>
              )}
            </button>

            {/* Health Status Indicator */}
            <button
              onClick={() => setActiveTab('incidents')}
              className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-mono transition-colors border cursor-pointer ${
                systemSummary.overallHealth === 'CRITICAL'
                  ? (isDark ? 'border-rose-900/80 bg-rose-950/40 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-800')
                  : systemSummary.overallHealth === 'WARNING'
                    ? (isDark ? 'border-amber-900/80 bg-amber-950/40 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-800')
                    : (isDark ? 'border-emerald-900/80 bg-emerald-950/40 text-emerald-300' : 'border-emerald-300 bg-emerald-50 text-emerald-800')
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${
                systemSummary.overallHealth === 'CRITICAL' ? 'bg-rose-500 animate-pulse' :
                systemSummary.overallHealth === 'WARNING' ? 'bg-amber-500' : 'bg-emerald-500'
              }`} />
              <span className="text-[11px] font-semibold">
                {systemSummary.criticalIncidents > 0 
                  ? `${systemSummary.criticalIncidents} CRITICAL INCIDENT` 
                  : systemSummary.openIncidents > 0 
                    ? `${systemSummary.openIncidents} INCIDENT OPEN`
                    : 'ALL SYSTEMS OPERATIONAL'}
              </span>
            </button>

            {/* Ops Simulator Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowSimMenu(!showSimMenu)}
                className={`flex items-center gap-1 px-2 py-1 text-[11px] font-mono rounded transition-colors border cursor-pointer ${
                  isDark 
                    ? 'text-slate-300 bg-[#162033] hover:bg-[#1D2B44] border-[#23334E]' 
                    : 'text-slate-700 bg-slate-100 hover:bg-slate-200 border-slate-300'
                }`}
                title="Interactive Operations Simulator"
              >
                <Zap className="w-3 h-3 text-blue-500" />
                <span className="hidden md:inline font-semibold">SIMULATOR</span>
              </button>

              {showSimMenu && (
                <div 
                  className={`absolute right-0 mt-2 w-72 rounded border p-2 z-50 text-xs space-y-1 shadow-2xl animate-in fade-in ${
                    isDark ? 'bg-[#0F172A] border-[#23334E] text-slate-100' : 'bg-white border-slate-300 text-slate-900'
                  }`}
                  onMouseLeave={() => setShowSimMenu(false)}
                >
                  <div className={`px-2 py-1 text-[10px] font-semibold uppercase tracking-wider font-mono border-b ${
                    isDark ? 'text-slate-400 border-slate-800' : 'text-slate-500 border-slate-200'
                  }`}>
                    Live Operational Scenarios
                  </div>
                  <button
                    onClick={() => {
                      triggerSimulatedScenario('RESOLVE_MOSAIC');
                      setShowSimMenu(false);
                    }}
                    className={`w-full flex items-center gap-2 p-2 rounded text-left font-mono text-[11px] ${
                      isDark ? 'hover:bg-[#162033] text-emerald-400' : 'hover:bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <div>
                      <div className="font-semibold">Verify Recovery &amp; Failback</div>
                      <div className={`text-[10px] font-sans ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Confirms 3 passes, restores pool &amp; resolves INC-1042</div>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      triggerSimulatedScenario('TRIGGER_MOSAIC_FAIL');
                      setShowSimMenu(false);
                    }}
                    className={`w-full flex items-center gap-2 p-2 rounded text-left font-mono text-[11px] ${
                      isDark ? 'hover:bg-[#162033] text-rose-400' : 'hover:bg-rose-50 text-rose-700'
                    }`}
                  >
                    <AlertOctagon className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <div>
                      <div className="font-semibold">Inject MySQL Pool Exhaustion</div>
                      <div className={`text-[10px] font-sans ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Triggers 3 check failures, INC-1042 &amp; DR failover</div>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      triggerSimulatedScenario('DEADMAN_SILENCE');
                      setShowSimMenu(false);
                    }}
                    className={`w-full flex items-center gap-2 p-2 rounded text-left font-mono text-[11px] ${
                      isDark ? 'hover:bg-[#162033] text-amber-400' : 'hover:bg-amber-50 text-amber-700'
                    }`}
                  >
                    <Radio className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <div>
                      <div className="font-semibold">Toggle Watchdog Silence</div>
                      <div className={`text-[10px] font-sans ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Simulates external dead-man timeout</div>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      triggerSimulatedScenario('RESET_ALL');
                      setShowSimMenu(false);
                    }}
                    className={`w-full flex items-center gap-2 p-1.5 rounded text-left text-[11px] font-mono ${
                      isDark ? 'hover:bg-[#162033] text-slate-400' : 'hover:bg-slate-100 text-slate-600'
                    }`}
                  >
                    <RefreshCw className="w-3 h-3 text-slate-400 shrink-0" />
                    <div>Reset State to Baseline</div>
                  </button>
                </div>
              )}
            </div>

            {/* Poll Probes */}
            <button
              onClick={handleManualRefresh}
              className={`p-1.5 rounded transition-colors cursor-pointer ${
                isDark 
                  ? 'text-slate-400 hover:text-slate-100 hover:bg-[#162033]' 
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              } ${isRefreshing ? 'animate-spin text-blue-500' : ''}`}
              title="Poll telemetry & probe all monitors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            {/* Operator avatar */}
            <div className={`flex items-center gap-2 pl-2 border-l ${isDark ? 'border-slate-800' : 'border-slate-300'}`}>
              <span className={`font-mono text-[11px] font-medium ${isDark ? 'text-slate-300' : 'text-slate-800'}`}>A. Mehta</span>
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" title="On-Call Primary" />
            </div>

          </div>
        </header>

        {/* ACTIVE CRITICAL INCIDENT BANNER - Crisp Industrial Severity Strip */}
        {activeCriticalIncident && (
          <div className={`px-5 py-2 flex items-center justify-between text-xs shrink-0 font-mono animate-in fade-in border-b ${
            isDark 
              ? 'bg-[#170B0E] border-rose-900/60 text-slate-200' 
              : 'bg-rose-50 border-rose-200 text-rose-950'
          }`}>
            <div className="flex items-center gap-3">
              <span className={`flex items-center gap-1.5 font-bold text-[11px] ${
                isDark ? 'text-rose-400' : 'text-rose-700'
              }`}>
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                CRITICAL [{activeCriticalIncident.id}]
              </span>
              <span className={`text-[11px] font-sans ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                Mosaic production health check failed: MySQL connection pool starved. Cloudflare has routed traffic to DR standby.
              </span>
              <span className={`text-[10px] hidden md:inline ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                Opened {activeCriticalIncident.durationMinutes}m ago · Owner: {activeCriticalIncident.owner.split('(')[0]}
              </span>
            </div>
            <button
              onClick={() => {
                setSelectedIncidentId(activeCriticalIncident.id);
                setActiveTab('incidents');
              }}
              className={`flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-mono transition-colors border cursor-pointer ${
                isDark 
                  ? 'bg-rose-950 hover:bg-rose-900 border-rose-800 text-rose-200' 
                  : 'bg-rose-600 hover:bg-rose-700 border-rose-700 text-white shadow-xs'
              }`}
            >
              <span>INVESTIGATE</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* SCROLLABLE MAIN CONTENT AREA */}
        <main className={`flex-1 overflow-y-auto p-5 transition-colors ${
          isDark ? 'bg-[#0E131F] text-slate-100' : 'bg-[#F6F8FC] text-slate-900'
        }`}>
          <div className="max-w-7xl mx-auto space-y-5">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};
