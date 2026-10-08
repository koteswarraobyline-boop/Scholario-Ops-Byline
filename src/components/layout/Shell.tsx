import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import { deadManDot, deadManLabel } from '../ui/deadman';
import { useAuth } from '../../context/AuthContext';
import { WsStatusBadge } from '../ui/WsStatusBadge';
import { Toaster } from '../ui/Toaster';
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
  Zap,
  ArrowRight,
  Shield,
  Sun,
  Moon,
  LogOut,
  Settings
} from 'lucide-react';
import { CommandPalette } from './CommandPalette';
import { CreateMonitorModal } from '../monitors/CreateMonitorModal';

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
    runAllProbes,
    apiHealth,
    triggerHealthCheck,
    theme,
    toggleTheme,
    realtimeStatus,
    isLoading,
    loadError,
    refreshAll,
    integrations,
  } = useOps();

  const [isRefreshing, setIsRefreshing] = useState(false);

  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Sync activeTab from current URL path on mount/navigate
  React.useEffect(() => {
    const path = location.pathname.replace('/', '') || 'overview';
    setActiveTab(path);
  }, [location.pathname, setActiveTab]);
  const isDark = theme === 'dark';

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const activeCriticalIncident = incidents.find(i => (i.severity === 'CRITICAL' || i.severity === 'EMERGENCY') && (i.status === 'OPEN' || i.status === 'INVESTIGATING' || i.status === 'MITIGATING' || i.status === 'ACKNOWLEDGED'));

  const handleManualRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.all([runAllProbes(), triggerHealthCheck()]);
      await refreshAll();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const displayName = user?.displayName ?? user?.fullName?.split(' ')[0] ?? 'Operator';

  const navSections: NavSection[] = [
    {
      title: 'Configuration',
      items: [
        { id: 'setup', label: 'Setup & Connections', icon: Settings, badge: systemSummary.totalServers === 0 ? 'START' : undefined, badgeColor: 'text-amber-400 font-bold' }
      ]
    },
    {
      title: 'Command Center',
      items: [
        { id: 'overview', label: 'Overview', icon: Activity },
        { id: 'incidents', label: 'Incidents', icon: AlertTriangle, badge: systemSummary.openIncidents > 0 ? `${systemSummary.openIncidents}` : undefined, badgeColor: systemSummary.criticalIncidents > 0 ? 'text-rose-400 font-semibold' : 'text-amber-400' }
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
        { id: 'backups', label: 'Backups', icon: Database, badge: systemSummary.backupsCurrentCount > 0 ? `${systemSummary.backupsCurrentCount}` : undefined }
      ]
    },
    {
      title: 'Providers',
      items: [
        { id: 'hostinger', label: 'Hostinger VPS', icon: Server },
        { id: 'cloudflare', label: 'Cloudflare Edge', icon: ShieldCheck, badge: !integrations?.cloudflare.configured ? 'Off' : systemSummary.cloudflareStatus === 'DEGRADED' ? 'Degraded' : systemSummary.cloudflareStatus === 'HEALTHY' ? 'Active' : 'Unknown', badgeColor: !integrations?.cloudflare.configured ? 'text-slate-500' : systemSummary.cloudflareStatus === 'DEGRADED' ? 'text-amber-400' : systemSummary.cloudflareStatus === 'HEALTHY' ? 'text-emerald-400' : 'text-slate-400' }
      ]
    },
    {
      title: 'Operations',
      items: [
        { id: 'deployments', label: 'Deployments', icon: GitBranch },
        { id: 'maintenance', label: 'Maintenance', icon: Calendar },
        { id: 'runbooks', label: 'Runbooks', icon: Terminal }
      ]
    },
    {
      title: 'Communications',
      items: [
        { id: 'communications', label: 'Notifications', icon: Bell }
      ]
    },
    {
      title: 'Analytics & Compliance',
      items: [
        { id: 'reports', label: 'Reports', icon: FileText },
        { id: 'audit', label: 'Audit Logs', icon: Shield }
      ]
    },
    {
      title: 'Admin',
      items: [
        { id: 'users', label: 'Users & Account', icon: Activity }
      ]
    }
  ];

  return (
    <div className={`flex h-screen w-screen overflow-hidden font-sans selection:bg-blue-600/30 selection:text-blue-200 ${
      isDark ? 'bg-[#0B0F17] text-slate-100' : 'bg-[#F6F8FC] text-slate-900'
    }`}>
      <CommandPalette />
      <CreateMonitorModal />
      <Toaster />

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
                    onClick={() => navigate(`/${item.id}`)}
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
                <span className="text-[9px] uppercase tracking-wider">Dead-Man Heartbeat</span>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${deadManDot(deadMan.status)} ${deadMan.status === 'HEALTHY' ? 'animate-pulse' : deadMan.status === 'FAILING' ? 'animate-ping' : ''}`} aria-label={deadManLabel(deadMan.status)} />
              </div>
              <div className="text-slate-400 text-[10px] truncate" title={deadMan.configured ? `${deadManLabel(deadMan.status)} · ${deadMan.nodeLocation} every ${deadMan.intervalSec}s` : 'Set DEADMAN_HEARTBEAT_URL on the server to enable'}>
                {!deadMan.configured
                  ? 'Not configured'
                  : `${deadManLabel(deadMan.status)} · every ${deadMan.intervalSec}s`}
              </div>
            </div>
          ) : (
            <div className="flex justify-center">
              <span className={`w-1.5 h-1.5 rounded-full ${deadManDot(deadMan.status)}`} aria-label={`Dead-man heartbeat: ${deadManLabel(deadMan.status)}`} />
            </div>
          )}
        </div>
      </aside>

      {/* MAIN VIEWPORT */}
      <div className={`flex-1 flex flex-col min-w-0 overflow-hidden ${
        isDark ? 'bg-[#0E131F]' : 'bg-[#F6F8FC]'
      }`}>
        
        {/* TOP BAR */}
        <header className={`h-12 px-4 lg:px-5 flex items-center justify-between gap-3 min-w-0 shrink-0 z-20 border-b ${
          isDark 
            ? 'bg-[#0B0F17] border-[#1B2436] text-slate-100' 
            : 'bg-white border-[#E2E8F0] text-slate-900 shadow-xs'
        }`}>
          
          {/* Left Zone: Environment Tag & Context */}
          <div className="flex items-center gap-3 min-w-0 shrink-0">
            <span className="text-xs font-bold tracking-tight font-mono whitespace-nowrap">
              SCHOLARIO IT OPS
            </span>
            {/* Counts only where there is room (they are also on the Overview); never wrap out of the bar */}
            <span className={`hidden 2xl:inline ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>/</span>
            <div className={`hidden 2xl:flex items-center gap-1.5 text-[11px] font-mono whitespace-nowrap ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${systemSummary.totalServers === 0 ? 'bg-slate-500' : systemSummary.healthyServers === systemSummary.totalServers ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span>{systemSummary.totalServers} SERVERS · {systemSummary.totalApps} APPS · {systemSummary.totalMonitors} MONITORS</span>
            </div>
          </div>

          {/* Center Zone: Search bar */}
          <div className="flex-1 min-w-0 max-w-sm">
            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              className={`w-full flex items-center justify-between px-2.5 py-1 rounded text-xs transition-colors group cursor-pointer border ${
                isDark 
                  ? 'bg-[#121927] hover:bg-[#162033] border-[#1E293B] text-slate-400' 
                  : 'bg-[#F1F5F9] hover:bg-[#E2E8F0] border-[#CBD5E1] text-slate-600'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Search className="w-3.5 h-3.5 shrink-0 text-slate-400 group-hover:text-blue-500" />
                <span className="truncate text-[11px]">Search routes, apps, VPS, incidents, actions...</span>
              </div>
              <div className="hidden xl:flex items-center gap-1 font-mono text-[9px] shrink-0 ml-2">
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

          {/* Right Zone: Setup, Theme Toggle, Health & Profile */}
          <div className="flex items-center gap-2 lg:gap-2.5 shrink-0">
            {/* Setup quick action */}
            <button
              onClick={() => navigate('/setup')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-bold transition-all border cursor-pointer ${
                activeTab === 'setup'
                  ? 'bg-blue-600 text-white border-blue-500 shadow-xs'
                  : isDark
                    ? 'bg-[#151E30] hover:bg-[#1A263D] text-emerald-400 border-emerald-900/60'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300'
              }`}
              title="Register servers & applications, install agents, check integrations"
            >
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden md:inline">SETUP</span>
            </button>

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
              onClick={() => navigate('/incidents')}
              title={systemSummary.visibilityGaps.length ? `Partial data: ${systemSummary.visibilityGaps.join(' · ')}` : undefined}
              className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-mono transition-colors border cursor-pointer ${
                systemSummary.overallHealth === 'CRITICAL'
                  ? (isDark ? 'border-rose-900/80 bg-rose-950/40 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-800')
                  : systemSummary.overallHealth === 'WARNING'
                    ? (isDark ? 'border-amber-900/80 bg-amber-950/40 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-800')
                    : systemSummary.overallHealth === 'UNKNOWN'
                      ? (isDark ? 'border-slate-700 bg-slate-900/40 text-slate-300' : 'border-slate-300 bg-slate-50 text-slate-700')
                      : (isDark ? 'border-emerald-900/80 bg-emerald-950/40 text-emerald-300' : 'border-emerald-300 bg-emerald-50 text-emerald-800')
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${
                systemSummary.overallHealth === 'CRITICAL' ? 'bg-rose-500 animate-pulse' :
                systemSummary.overallHealth === 'WARNING' ? 'bg-amber-500' : systemSummary.overallHealth === 'UNKNOWN' ? 'bg-slate-500' : 'bg-emerald-500'
              }`} />
              <span className="text-[11px] font-semibold whitespace-nowrap xl:hidden">
                {systemSummary.criticalIncidents > 0 ? `${systemSummary.criticalIncidents} CRITICAL` : systemSummary.openIncidents > 0 ? `${systemSummary.openIncidents} OPEN`
                  : systemSummary.overallHealth === 'OPERATIONAL' ? 'OK' : systemSummary.overallHealth === 'WARNING' ? 'DEGRADED' : systemSummary.overallHealth === 'CRITICAL' ? 'CRITICAL' : 'UNKNOWN'}
              </span>
              <span className="text-[11px] font-semibold whitespace-nowrap hidden xl:inline">
                {systemSummary.criticalIncidents > 0 
                  ? `${systemSummary.criticalIncidents} CRITICAL INCIDENT` 
                  : systemSummary.openIncidents > 0 
                    ? `${systemSummary.openIncidents} INCIDENT OPEN`
                    : systemSummary.overallHealth === 'OPERATIONAL'
                      ? (systemSummary.visibilityGaps.length ? 'OPERATIONAL · PARTIAL DATA' : 'ALL SYSTEMS OPERATIONAL')
                      : systemSummary.overallHealth === 'WARNING' ? 'DEGRADED' : systemSummary.overallHealth === 'CRITICAL' ? 'CRITICAL' : 'STATUS UNKNOWN'}
              </span>
            </button>


            {/* Poll Probes */}
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className={`p-1.5 rounded transition-colors cursor-pointer ${
                isDark 
                  ? 'text-slate-400 hover:text-slate-100 hover:bg-[#162033]' 
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              } ${isRefreshing ? 'animate-spin text-blue-500' : ''}`}
              title="Poll telemetry & probe all monitors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            {/* WebSocket status */}
            <WsStatusBadge status={realtimeStatus} isDark={isDark} />

            {/* Operator avatar + logout */}
            <div className={`flex items-center gap-2 pl-2 border-l ${isDark ? 'border-slate-800' : 'border-slate-300'}`}>
              <span className={`hidden lg:inline font-mono text-[11px] font-medium whitespace-nowrap truncate max-w-[9rem] xl:max-w-[12rem] ${isDark ? 'text-slate-300' : 'text-slate-800'}`} title={displayName}>
                {displayName}
              </span>
              {user?.isOnCall && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" title="On-Call Primary" />
              )}
              <button
                onClick={handleLogout}
                title="Sign out"
                className={`p-1 rounded transition-colors cursor-pointer ${
                  isDark ? 'text-slate-500 hover:text-rose-400 hover:bg-rose-950/40' : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                }`}
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>

          </div>
        </header>

        {/* /health SERVICE UNREACHABLE EMERGENCY BANNER */}
        {(!apiHealth.reachable || apiHealth.status === 'UNREACHABLE') && (
          <div className="px-3 sm:px-5 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs shrink-0 font-mono bg-rose-600 text-white font-bold animate-pulse shadow-md z-30">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping shrink-0" />
              <span>SCHOLARIO OPS API (/api/health) UNREACHABLE — data on screen may be stale</span>
            </div>
            <button
              onClick={() => { void triggerHealthCheck(); }}
              className="px-2.5 py-0.5 rounded text-[11px] font-mono bg-white text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer self-start sm:self-auto shrink-0 shadow-xs"
            >
              RETRY
            </button>
          </div>
        )}

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
                {activeCriticalIncident.title}
              </span>
              <span className={`text-[10px] hidden md:inline ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                Opened {activeCriticalIncident.durationMinutes}m ago · Owner: {(activeCriticalIncident.owner ?? 'Unassigned').split('(')[0]}
              </span>
            </div>
            <button
              onClick={() => {
                setSelectedIncidentId(activeCriticalIncident.id);
                navigate('/incidents');
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
        {/* Content container: clear gutter to the sidebar and the window edge; children can never widen the page */}
        <main className={`flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-5 lg:px-6 xl:px-7 transition-colors ${
          isDark ? 'bg-[#0E131F] text-slate-100' : 'bg-[#F6F8FC] text-slate-900'
        }`}>
          {/* Full width of the content area (no centred max-width column, so no large empty side margins) */}
          <div className="w-full min-w-0 space-y-5">
            {isLoading ? (
              <div className={`rounded-lg border p-10 text-center text-xs font-mono animate-pulse ${isDark ? 'border-[#1E293B] text-slate-400' : 'border-slate-200 text-slate-500'}`}>
                Loading live data from the Scholario Ops API…
              </div>
            ) : loadError ? (
              <div className={`rounded-lg border p-6 text-xs font-mono space-y-3 ${isDark ? 'border-rose-900 bg-rose-950/30 text-rose-200' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
                <div className="font-bold">Could not load data: {loadError}</div>
                <button onClick={() => { void refreshAll(); }} className="px-3 py-1 rounded bg-rose-600 text-white cursor-pointer">Retry</button>
              </div>
            ) : children}
          </div>
        </main>
      </div>
    </div>
  );
};
