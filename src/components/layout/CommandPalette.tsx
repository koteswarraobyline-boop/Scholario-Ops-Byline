import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import {
  Search,
  Server,
  Layers,
  AlertTriangle,
  Activity,
  Cloud,
  GitBranch,
  X,
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  Send,
  Terminal,
  Radio,
  Check,
  FileText,
  Database,
  Calendar,
  ShieldCheck,
  Shield,
  Cpu,
  CornerDownLeft,
  Plus,
  Users,
  Settings,
  Network,
  Loader2,
} from 'lucide-react';

export type PaletteCategory =
  | 'ALL'
  | 'ROUTES'
  | 'APPS'
  | 'SERVERS'
  | 'INCIDENTS'
  | 'ACTIONS'
  | 'MONITORS'
  | 'RUNBOOKS';

export interface CommandItem {
  id: string;
  category: PaletteCategory;
  categoryLabel: string;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeType?: 'default' | 'critical' | 'warning' | 'success' | 'action' | 'route';
  icon: React.ComponentType<{ className?: string }>;
  keywords: string;
  /** Shown in a confirm dialog before the action runs (high-impact actions) */
  confirm?: string;
  /** Message shown in the palette after the action completes successfully */
  successMessage?: string;
  /** Returning false keeps the palette open (e.g. failed action — the context already toasted the error) */
  action: () => void | boolean | Promise<unknown>;
}

const OPEN_STATUSES = new Set(['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'MITIGATING', 'MONITORING']);

const ROUTES: Array<{ tab: string; title: string; subtitle: string; icon: CommandItem['icon']; keywords: string }> = [
  { tab: 'setup', title: 'Setup', subtitle: 'Register servers and applications, install the telemetry agent, integration status', icon: Settings, keywords: 'setup register onboarding agent install integrations configure' },
  { tab: 'overview', title: 'Overview', subtitle: 'Overall health of applications, servers, monitors and incidents', icon: Activity, keywords: 'overview dashboard home status health' },
  { tab: 'applications', title: 'Applications', subtitle: 'Applications with PRD/DR mapping and failover state', icon: Layers, keywords: 'applications apps catalog' },
  { tab: 'infrastructure', title: 'Infrastructure', subtitle: 'Registered VPS servers and agent telemetry', icon: Server, keywords: 'infrastructure servers vps nodes cpu ram disk telemetry' },
  { tab: 'monitors', title: 'Monitors', subtitle: 'HTTP/TCP/DNS/SSL and heartbeat monitors', icon: Radio, keywords: 'monitors probes checks uptime' },
  { tab: 'incidents', title: 'Incidents', subtitle: 'Open and resolved incidents', icon: AlertTriangle, keywords: 'incidents tickets triage acknowledge resolve' },
  { tab: 'resilience', title: 'DR Readiness', subtitle: 'Disaster recovery readiness and failover', icon: ShieldCheck, keywords: 'resilience dr disaster recovery readiness failover' },
  { tab: 'backups', title: 'Backups', subtitle: 'Backup records and freshness', icon: Database, keywords: 'backups restore snapshots' },
  { tab: 'dependencies', title: 'Dependencies', subtitle: 'Application dependency map', icon: Network, keywords: 'dependencies map topology' },
  { tab: 'hostinger', title: 'Hostinger', subtitle: 'Hostinger VPS inventory from the provider API', icon: Cpu, keywords: 'hostinger provider vps vms' },
  { tab: 'cloudflare', title: 'Cloudflare', subtitle: 'Zones, DNS records and DNS failover', icon: Cloud, keywords: 'cloudflare dns zones ssl edge' },
  { tab: 'deployments', title: 'Deployments', subtitle: 'Deployment history', icon: GitBranch, keywords: 'deployments releases versions' },
  { tab: 'runbooks', title: 'Runbooks', subtitle: 'Operational procedures', icon: Terminal, keywords: 'runbooks procedures sop' },
  { tab: 'maintenance', title: 'Maintenance', subtitle: 'Maintenance windows', icon: Calendar, keywords: 'maintenance windows schedule' },
  { tab: 'communications', title: 'Communications', subtitle: 'Notification channels and escalation policies', icon: Send, keywords: 'communications notifications channels escalation teams email webhook' },
  { tab: 'reports', title: 'Reports', subtitle: 'Daily operations report', icon: FileText, keywords: 'reports daily summary' },
  { tab: 'audit', title: 'Audit Logs', subtitle: 'Record of operator actions', icon: Shield, keywords: 'audit logs history' },
  { tab: 'users', title: 'Users', subtitle: 'Operator accounts and roles', icon: Users, keywords: 'users accounts roles password' },
];

export const CommandPalette: React.FC = () => {
  const {
    isCommandPaletteOpen,
    setIsCommandPaletteOpen,
    applications,
    servers,
    monitors,
    incidents,
    runbooks,
    communicationChannels,
    setSelectedAppId,
    setSelectedServerId,
    setSelectedIncidentId,
    setSelectedRunbookId,
    triggerFailover,
    acknowledgeIncident,
    resolveIncident,
    runProbeCheck,
    runAllProbes,
    openAddMonitorWithContext,
    sendTestNotification,
    syncCloudflare,
    syncHostinger,
    integrations,
    refreshAll,
    systemSummary,
    theme,
  } = useOps();
  const { hasRole } = useAuth();
  const navigate = useNavigate();

  const isDark = theme === 'dark';

  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<PaletteCategory>('ALL');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus management when opening (Ctrl/Cmd+K is handled globally by OpsContext)
  useEffect(() => {
    if (isCommandPaletteOpen) {
      setQuery('');
      setHighlightedIndex(0);
      setSelectedCategory('ALL');
      setActionFeedback(null);
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isCommandPaletteOpen]);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const close = useCallback(() => setIsCommandPaletteOpen(false), [setIsCommandPaletteOpen]);

  const go = useCallback((tab: string) => {
    navigate(`/${tab}`);
    close();
  }, [navigate, close]);

  const canOperate = hasRole('operator');
  const canAdmin = hasRole('it_administrator');
  const canFailover = hasRole('super_admin');

  const allCommands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // ── 1. Navigation ────────────────────────────────────────────────────────
    for (const r of ROUTES) {
      let badge: string | undefined;
      let badgeType: CommandItem['badgeType'] = 'route';
      if (r.tab === 'incidents') {
        badge = systemSummary.openIncidents > 0 ? `${systemSummary.openIncidents} OPEN` : 'NONE OPEN';
        badgeType = systemSummary.criticalIncidents > 0 ? 'critical' : systemSummary.openIncidents > 0 ? 'warning' : 'success';
      } else if (r.tab === 'applications' && systemSummary.totalApps > 0) {
        badge = `${systemSummary.healthyApps}/${systemSummary.totalApps} HEALTHY`;
        badgeType = systemSummary.healthyApps === systemSummary.totalApps ? 'success' : 'warning';
      } else if (r.tab === 'infrastructure' && systemSummary.totalServers > 0) {
        badge = `${systemSummary.healthyServers}/${systemSummary.totalServers} HEALTHY`;
        badgeType = systemSummary.healthyServers === systemSummary.totalServers ? 'success' : 'warning';
      } else if (r.tab === 'monitors' && systemSummary.totalMonitors > 0) {
        badge = `${systemSummary.healthyMonitors}/${systemSummary.totalMonitors} HEALTHY`;
        badgeType = systemSummary.healthyMonitors === systemSummary.totalMonitors ? 'success' : 'warning';
      }
      items.push({
        id: `route-${r.tab}`,
        category: 'ROUTES',
        categoryLabel: 'Go to',
        title: r.title,
        subtitle: r.subtitle,
        badge: badge ?? 'ROUTE',
        badgeType,
        icon: r.icon,
        keywords: `route navigate go to open ${r.tab} ${r.keywords}`,
        action: () => go(r.tab),
      });
    }

    // ── 2. Applications ──────────────────────────────────────────────────────
    for (const app of applications) {
      const prd = servers.find(s => s.id === app.prdServerId);
      const dr = servers.find(s => s.id === app.drServerId);
      const isDr = app.failoverState === 'DR_ACTIVE';
      items.push({
        id: `app-${app.id}`,
        category: 'APPS',
        categoryLabel: 'Application',
        title: app.codeName ? `${app.name} (${app.codeName})` : app.name,
        subtitle: [
          `PRD: ${prd ? `${prd.hostname} ${prd.ip}` : '—'}`,
          `DR: ${dr ? `${dr.hostname} ${dr.ip}` : '—'}`,
          app.dnsRecordName ? `DNS: ${app.dnsRecordName}` : null,
        ].filter(Boolean).join(' · '),
        badge: isDr ? 'DR ACTIVE' : app.status,
        badgeType: isDr ? 'warning' : app.status === 'HEALTHY' ? 'success' : app.status === 'CRITICAL' ? 'critical' : app.status === 'WARNING' ? 'warning' : 'default',
        icon: Layers,
        keywords: `application app ${app.name} ${app.codeName} ${app.id} ${app.tier} ${app.cloudflareZone} ${app.dnsRecordName ?? ''}`,
        action: () => {
          setSelectedAppId(app.id);
          go('applications');
        },
      });

      // Failover / failback (super_admin, requires DNS failover configuration)
      if (canFailover && app.dnsRecordName && app.prdServerId && app.drServerId && app.failoverState !== 'FAILING_OVER') {
        const target: 'DR' | 'PRIMARY' = isDr ? 'PRIMARY' : 'DR';
        const targetServer = isDr ? prd : dr;
        items.push({
          id: `action-failover-${app.id}`,
          category: 'ACTIONS',
          categoryLabel: 'Failover',
          title: isDr ? `Fail back ${app.name} to PRD` : `Fail over ${app.name} to DR`,
          subtitle: `Switch Cloudflare DNS ${app.dnsRecordName} to ${targetServer ? `${targetServer.hostname} (${targetServer.ip})` : (isDr ? 'the PRD server' : 'the DR server')}`,
          badge: isDr ? 'FAILBACK' : 'FAILOVER',
          badgeType: isDr ? 'action' : 'critical',
          icon: Cloud,
          keywords: `failover failback switch dns cloudflare ${app.name} ${app.codeName} dr primary prd`,
          confirm: isDr
            ? `Fail back ${app.name}? Cloudflare DNS ${app.dnsRecordName} will be pointed back at the PRD server.`
            : `Fail over ${app.name} to DR? Cloudflare DNS ${app.dnsRecordName} will be pointed at the DR server and live traffic will move.`,
          successMessage: `${app.name}: DNS switched to ${target === 'DR' ? 'DR' : 'PRD'}`,
          action: () => triggerFailover(app.id, target, 'Triggered from command palette'),
        });
      }
    }

    // ── 3. Servers ───────────────────────────────────────────────────────────
    for (const srv of servers) {
      const hasTelemetry = Boolean(srv.lastSeen);
      items.push({
        id: `server-${srv.id}`,
        category: 'SERVERS',
        categoryLabel: 'Server',
        title: `${srv.hostname}`,
        subtitle: [
          srv.ip || '—',
          srv.environment,
          srv.region || null,
          hasTelemetry && srv.telemetry
            ? `CPU ${Math.round(srv.telemetry.cpuPercent)}% · RAM ${Math.round(srv.telemetry.ramPercent)}% · Disk ${Math.round(srv.telemetry.diskPercent)}%`
            : 'Agent has not reported yet',
        ].filter(Boolean).join(' · '),
        badge: `${srv.environment} · ${srv.status}`,
        badgeType: srv.status === 'HEALTHY' ? 'success' : srv.status === 'CRITICAL' ? 'critical' : srv.status === 'WARNING' ? 'warning' : 'default',
        icon: Server,
        keywords: `server vps ${srv.id} ${srv.hostname} ${srv.ip} ${srv.region} ${srv.environment} ${srv.provider} ${srv.plan}`,
        action: () => {
          setSelectedServerId(srv.id);
          go('infrastructure');
        },
      });
    }

    // ── 4. Incidents ─────────────────────────────────────────────────────────
    for (const inc of incidents) {
      const isOpen = OPEN_STATUSES.has(inc.status);
      const isCrit = inc.severity === 'CRITICAL' || inc.severity === 'EMERGENCY';
      const appName = applications.find(a => a.id === inc.applicationId)?.name;
      items.push({
        id: `incident-${inc.id}`,
        category: 'INCIDENTS',
        categoryLabel: 'Incident',
        title: `${inc.id}: ${inc.title}`,
        subtitle: [appName, inc.environment, `Owner: ${inc.owner || 'Unassigned'}`, inc.rootCause || null].filter(Boolean).join(' · '),
        badge: `${inc.severity} · ${inc.status}`,
        badgeType: isCrit && isOpen ? 'critical' : isOpen ? 'warning' : 'success',
        icon: AlertTriangle,
        keywords: `incident ticket ${inc.id} ${inc.title} ${inc.severity} ${inc.status} ${inc.owner} ${appName ?? ''} ${inc.fingerprint}`,
        action: () => {
          setSelectedIncidentId(inc.id);
          go('incidents');
        },
      });

      if (isOpen && canOperate) {
        if (!inc.acknowledged) {
          items.push({
            id: `action-ack-${inc.id}`,
            category: 'ACTIONS',
            categoryLabel: 'Incident',
            title: `Acknowledge ${inc.id}`,
            subtitle: inc.title,
            badge: 'ACKNOWLEDGE',
            badgeType: 'warning',
            icon: AlertTriangle,
            keywords: `acknowledge ack incident ${inc.id} ${inc.title}`,
            successMessage: `${inc.id} acknowledged`,
            action: () => acknowledgeIncident(inc.id),
          });
        }
        items.push({
          id: `action-resolve-${inc.id}`,
          category: 'ACTIONS',
          categoryLabel: 'Incident',
          title: `Resolve ${inc.id}`,
          subtitle: inc.title,
          badge: 'RESOLVE',
          badgeType: 'success',
          icon: CheckCircle2,
          keywords: `resolve close incident ${inc.id} ${inc.title}`,
          confirm: `Resolve ${inc.id} "${inc.title}"?`,
          successMessage: `${inc.id} resolved`,
          action: () => resolveIncident(inc.id, 'Resolved from command palette'),
        });
      }
    }

    // ── 5. General actions ───────────────────────────────────────────────────
    if (canOperate && monitors.length > 0) {
      items.push({
        id: 'action-probe-all',
        category: 'ACTIONS',
        categoryLabel: 'Monitors',
        title: 'Run all monitor checks now',
        subtitle: `Probe ${monitors.filter(m => m.enabled).length} enabled monitor(s) immediately`,
        badge: 'RUN',
        badgeType: 'action',
        icon: RefreshCw,
        keywords: 'probe all monitors check run now test',
        successMessage: 'Monitor checks completed',
        action: () => runAllProbes(),
      });
    }

    if (canAdmin) {
      items.push({
        id: 'action-create-monitor',
        category: 'ACTIONS',
        categoryLabel: 'Monitors',
        title: 'Add a monitor',
        subtitle: 'Create an HTTP, TCP, DNS, SSL or heartbeat monitor',
        badge: 'CREATE',
        badgeType: 'action',
        icon: Plus,
        keywords: 'create add new monitor probe check',
        action: () => {
          go('monitors');
          openAddMonitorWithContext();
        },
      });
      items.push({
        id: 'action-register-server',
        category: 'ACTIONS',
        categoryLabel: 'Setup',
        title: 'Register a server or application',
        subtitle: 'Open Setup to add VPS servers, applications and the telemetry agent',
        badge: 'SETUP',
        badgeType: 'action',
        icon: Settings,
        keywords: 'register add server application vps agent setup onboarding',
        action: () => go('setup'),
      });
    }

    if (canOperate && integrations?.cloudflare.configured) {
      items.push({
        id: 'action-sync-cloudflare',
        category: 'ACTIONS',
        categoryLabel: 'Cloudflare',
        title: 'Sync Cloudflare now',
        subtitle: 'Refresh zones and DNS records from the Cloudflare API',
        badge: 'SYNC',
        badgeType: 'action',
        icon: Cloud,
        keywords: 'sync cloudflare refresh zones dns',
        successMessage: 'Cloudflare synced',
        action: () => syncCloudflare(),
      });
    }
    if (canOperate && integrations?.hostinger.configured) {
      items.push({
        id: 'action-sync-hostinger',
        category: 'ACTIONS',
        categoryLabel: 'Hostinger',
        title: 'Sync Hostinger now',
        subtitle: 'Refresh the VPS inventory from the Hostinger API',
        badge: 'SYNC',
        badgeType: 'action',
        icon: Cpu,
        keywords: 'sync hostinger refresh vps vms inventory',
        successMessage: 'Hostinger synced',
        action: () => syncHostinger(),
      });
    }

    items.push({
      id: 'action-refresh-all',
      category: 'ACTIONS',
      categoryLabel: 'Data',
      title: 'Reload all data from the server',
      subtitle: 'Re-fetch applications, servers, monitors, incidents and more',
      badge: 'RELOAD',
      badgeType: 'action',
      icon: RefreshCw,
      keywords: 'reload refresh data resync',
      successMessage: 'Data reloaded',
      action: () => refreshAll(),
    });

    // Test notifications for each configured, enabled channel
    if (canOperate) {
      for (const ch of communicationChannels.filter(c => c.enabled)) {
        items.push({
          id: `action-test-channel-${ch.id}`,
          category: 'ACTIONS',
          categoryLabel: 'Notification',
          title: `Send test notification: ${ch.name}`,
          subtitle: `${ch.type} channel`,
          badge: 'TEST',
          badgeType: 'action',
          icon: Send,
          keywords: `test send notification channel ${ch.name} ${ch.type}`,
          successMessage: `Test notification sent to ${ch.name}`,
          action: () => sendTestNotification(ch.id),
        });
      }
    }

    // ── 6. Monitors ──────────────────────────────────────────────────────────
    for (const mon of monitors) {
      const appName = applications.find(a => a.id === mon.applicationId)?.name;
      items.push({
        id: `monitor-${mon.id}`,
        category: 'MONITORS',
        categoryLabel: canOperate ? 'Monitor · run check' : 'Monitor',
        title: mon.name,
        subtitle: [
          mon.type,
          mon.target || null,
          appName ? `${appName} ${mon.environment}` : mon.environment,
          mon.lastCheck ? `${mon.responseTimeMs}ms` : 'Not checked yet',
          mon.enabled ? null : 'Paused',
        ].filter(Boolean).join(' · '),
        badge: mon.status,
        badgeType: mon.status === 'HEALTHY' ? 'success' : mon.status === 'CRITICAL' ? 'critical' : mon.status === 'WARNING' ? 'warning' : 'default',
        icon: Radio,
        keywords: `monitor probe check ${mon.id} ${mon.name} ${mon.target} ${mon.type} ${appName ?? ''}`,
        successMessage: canOperate ? `Checked ${mon.name}` : undefined,
        action: async () => {
          if (canOperate) await runProbeCheck(mon.id);
          go('monitors');
        },
      });
    }

    // ── 7. Runbooks ──────────────────────────────────────────────────────────
    for (const rb of runbooks) {
      items.push({
        id: `runbook-${rb.id}`,
        category: 'RUNBOOKS',
        categoryLabel: 'Runbook',
        title: rb.title,
        subtitle: `${rb.description ? `${rb.description} · ` : ''}${rb.steps.length} steps · ~${rb.estimatedDurationMin}m`,
        badge: rb.category,
        badgeType: 'default',
        icon: Terminal,
        keywords: `runbook procedure ${rb.id} ${rb.title} ${rb.category}`,
        action: () => {
          setSelectedRunbookId(rb.id);
          go('runbooks');
        },
      });
    }

    return items;
  }, [
    applications, servers, monitors, incidents, runbooks, communicationChannels, integrations, systemSummary,
    canOperate, canAdmin, canFailover, go,
    runAllProbes, acknowledgeIncident, resolveIncident, triggerFailover, sendTestNotification, runProbeCheck,
    openAddMonitorWithContext, syncCloudflare, syncHostinger, refreshAll,
    setSelectedAppId, setSelectedServerId, setSelectedIncidentId, setSelectedRunbookId,
  ]);

  /** Runs a command, awaiting async actions; keeps the palette open on failure. */
  const execute = useCallback(async (item: CommandItem) => {
    if (runningId) return;
    if (item.confirm && !window.confirm(item.confirm)) return;
    setRunningId(item.id);
    try {
      const result = await item.action();
      if (result === false) return; // error already reported by the context as a toast
      if (item.successMessage) {
        setActionFeedback(item.successMessage);
        if (closeTimer.current) clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(() => {
          setActionFeedback(null);
          close();
        }, 900);
      } else {
        close();
      }
    } finally {
      setRunningId(null);
    }
  }, [runningId, close]);

  // Filter commands by query and selected category
  const filteredCommands = useMemo(() => {
    let result = allCommands;

    if (selectedCategory !== 'ALL') {
      result = result.filter(item => item.category === selectedCategory);
    }

    if (query.trim()) {
      const tokens = query.toLowerCase().trim().split(/\s+/);
      result = result.filter(item => {
        const fullSearchable = `${item.title} ${item.subtitle || ''} ${item.keywords} ${item.categoryLabel} ${item.badge || ''}`.toLowerCase();
        return tokens.every(token => fullSearchable.includes(token));
      });
    }

    return result;
  }, [allCommands, selectedCategory, query]);

  // Keep highlighted index in bounds
  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, selectedCategory]);

  const scrollIntoView = (index: number) => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-command-item]');
    const target = items[index] as HTMLElement | undefined;
    if (target) {
      target.scrollIntoView({ block: 'nearest' });
    }
  };

  // Keyboard navigation inside the palette
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = (highlightedIndex + 1) % (filteredCommands.length || 1);
      setHighlightedIndex(nextIndex);
      scrollIntoView(nextIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = (highlightedIndex - 1 + filteredCommands.length) % (filteredCommands.length || 1);
      setHighlightedIndex(prevIndex);
      scrollIntoView(prevIndex);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filteredCommands[highlightedIndex];
      if (item) void execute(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  if (!isCommandPaletteOpen) return null;

  const categories: { id: PaletteCategory; label: string; count?: number }[] = [
    { id: 'ALL', label: 'All', count: allCommands.length },
    { id: 'ROUTES', label: 'Routes', count: allCommands.filter(c => c.category === 'ROUTES').length },
    { id: 'APPS', label: 'Applications', count: applications.length },
    { id: 'SERVERS', label: 'Servers', count: servers.length },
    { id: 'INCIDENTS', label: 'Incidents', count: incidents.length },
    { id: 'ACTIONS', label: 'Actions', count: allCommands.filter(c => c.category === 'ACTIONS').length },
    { id: 'MONITORS', label: 'Monitors', count: monitors.length },
    { id: 'RUNBOOKS', label: 'Runbooks', count: runbooks.length }
  ];

  return (
    <div 
      className="fixed inset-0 z-50 flex items-start justify-center pt-14 sm:pt-20 bg-black/80 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-100"
      onClick={close}
      onKeyDown={handleKeyDown}
    >
      <div 
        className={`w-full max-w-3xl rounded-lg border overflow-hidden flex flex-col max-h-[82vh] shadow-2xl font-mono text-xs ring-1 ring-blue-500/20 ${
          isDark 
            ? 'bg-[#0B0F17] text-slate-100 border-[#1E293B] shadow-black/80' 
            : 'bg-white text-slate-900 border-slate-300 shadow-xl'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Search Bar Header */}
        <div className={`flex items-center gap-3 px-4 py-3 border-b ${
          isDark ? 'border-[#1E293B] bg-[#070A10]' : 'border-slate-200 bg-slate-50'
        }`}>
          <Search className="w-4 h-4 text-blue-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search pages, applications, servers, incidents, monitors, runbooks or actions..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className={`w-full bg-transparent text-xs placeholder:text-slate-400 focus:outline-none font-mono tracking-tight ${
              isDark ? 'text-slate-100' : 'text-slate-900'
            }`}
            autoFocus
          />
          {query && (
            <button 
              onClick={() => setQuery('')}
              className="p-0.5 text-slate-400 hover:text-slate-600 transition-colors mr-1 cursor-pointer"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button 
            onClick={close}
            className={`px-1.5 py-0.5 text-[10px] rounded transition-colors border cursor-pointer ${
              isDark 
                ? 'text-slate-400 bg-[#121927] hover:bg-[#1C273C] border-slate-700' 
                : 'text-slate-600 bg-slate-100 hover:bg-slate-200 border-slate-300'
            }`}
            title="Close (Esc)"
          >
            ESC
          </button>
        </div>

        {/* Category Filter Chips */}
        <div className={`flex items-center gap-1.5 px-3 py-2 border-b overflow-x-auto text-[11px] no-scrollbar ${
          isDark ? 'border-[#1E293B] bg-[#0C121E]' : 'border-slate-200 bg-slate-100/70'
        }`}>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                selectedCategory === cat.id
                  ? 'bg-blue-600 text-white font-medium border border-blue-400/40 shadow-xs'
                  : isDark 
                    ? 'text-slate-400 hover:text-slate-200 hover:bg-[#162033] border border-transparent'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent'
              }`}
            >
              <span>{cat.label}</span>
              {cat.count !== undefined && (
                <span className={`text-[10px] px-1 py-0.2 rounded font-mono ${
                  selectedCategory === cat.id 
                    ? 'bg-blue-700/80 text-blue-100' 
                    : isDark ? 'bg-[#141C2B] text-slate-400' : 'bg-slate-200 text-slate-600'
                }`}>
                  {cat.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Action Execution Feedback Banner */}
        {actionFeedback && (
          <div className="px-4 py-2 bg-emerald-900/40 border-b border-emerald-800 text-emerald-400 text-xs flex items-center gap-2 animate-in fade-in">
            <Check className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="font-sans font-medium">{actionFeedback}</span>
          </div>
        )}

        {/* Results Container */}
        <div 
          ref={listRef}
          className={`overflow-y-auto p-2 space-y-1 flex-1 max-h-[56vh] divide-y ${
            isDark ? 'divide-slate-900/40' : 'divide-slate-100'
          }`}
        >
          {filteredCommands.length > 0 ? (
            filteredCommands.map((item, index) => {
              const Icon = item.icon;
              const isHighlighted = highlightedIndex === index;

              return (
                <div
                  key={item.id}
                  data-command-item
                  onClick={() => void execute(item)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`w-full flex items-center justify-between p-2.5 rounded transition-all ${runningId && runningId !== item.id ? 'opacity-50 cursor-wait' : 'cursor-pointer'} ${
                    isHighlighted 
                      ? isDark 
                        ? 'bg-[#162033] border-l-2 border-blue-500 text-white pl-2' 
                        : 'bg-blue-50/80 border-l-2 border-blue-600 text-slate-900 pl-2'
                      : isDark
                        ? 'hover:bg-[#121927] text-slate-300'
                        : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`p-1.5 rounded shrink-0 ${
                      item.category === 'ROUTES' ? (isDark ? 'bg-[#17233C] text-blue-400 border border-blue-900/40' : 'bg-blue-50 text-blue-700 border border-blue-200') :
                      item.category === 'ACTIONS' ? (isDark ? 'bg-[#1C2038] text-indigo-400 border border-indigo-900/40' : 'bg-indigo-50 text-indigo-700 border border-indigo-200') :
                      item.category === 'INCIDENTS' ? (isDark ? 'bg-rose-950/80 text-rose-400 border border-rose-900/60' : 'bg-rose-50 text-rose-700 border border-rose-200') :
                      item.category === 'APPS' ? (isDark ? 'bg-[#132338] text-sky-400 border border-sky-900/40' : 'bg-sky-50 text-sky-700 border border-sky-200') :
                      item.category === 'SERVERS' ? (isDark ? 'bg-[#172030] text-emerald-400 border border-emerald-900/40' : 'bg-emerald-50 text-emerald-700 border border-emerald-200') :
                      item.category === 'MONITORS' ? (isDark ? 'bg-[#1E1F30] text-amber-400 border border-amber-900/40' : 'bg-amber-50 text-amber-700 border border-amber-200') :
                      isDark ? 'bg-[#121927] text-slate-400 border border-slate-800' : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold truncate font-sans text-xs ${
                          isDark ? 'text-slate-100' : 'text-slate-900'
                        }`}>
                          {item.title}
                        </span>
                        <span className="text-[9px] uppercase tracking-wider text-slate-400 font-mono shrink-0">
                          {item.categoryLabel}
                        </span>
                      </div>
                      {item.subtitle && (
                        <div className={`text-[11px] truncate mt-0.5 font-mono ${
                          isDark ? 'text-slate-400' : 'text-slate-500'
                        }`}>
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {item.badge && (
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
                        item.badgeType === 'critical' ? 'text-rose-500 bg-rose-500/10 border border-rose-500/20' :
                        item.badgeType === 'warning' ? 'text-amber-500 bg-amber-500/10 border border-amber-500/20' :
                        item.badgeType === 'success' ? 'text-emerald-500 bg-emerald-500/10 border border-emerald-500/20' :
                        item.badgeType === 'action' ? 'text-blue-500 bg-blue-500/10 border border-blue-500/20' :
                        item.badgeType === 'route' ? 'text-blue-500 bg-blue-50 border border-blue-200' :
                        isDark ? 'text-slate-400 bg-[#0B0F17] border border-slate-800' : 'text-slate-600 bg-slate-100 border border-slate-200'
                      }`}>
                        {item.badge}
                      </span>
                    )}
                    <div className="w-5 flex justify-center">
                      {runningId === item.id ? (
                        <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
                      ) : isHighlighted ? (
                        <CornerDownLeft className="w-3.5 h-3.5 text-blue-500 animate-pulse" />
                      ) : (
                        <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-12 text-center text-slate-400 font-sans space-y-1">
              <div className="text-xs">No matching items found for &quot;{query}&quot;</div>
              <div className="text-[11px] text-slate-500">Search by application, server hostname or IP, incident ID, monitor name, runbook or page name.</div>
            </div>
          )}
        </div>

        {/* Footer info & shortcut cues */}
        <div className={`flex items-center justify-between px-4 py-2.5 border-t text-[10px] ${
          isDark ? 'border-[#1E293B] bg-[#070A10] text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-600'
        }`}>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className={`px-1.5 py-0.5 border rounded font-mono ${
                isDark ? 'bg-[#121927] border-slate-700 text-slate-300' : 'bg-white border-slate-300 text-slate-700 shadow-2xs'
              }`}>↑</kbd>
              <kbd className={`px-1.5 py-0.5 border rounded font-mono ${
                isDark ? 'bg-[#121927] border-slate-700 text-slate-300' : 'bg-white border-slate-300 text-slate-700 shadow-2xs'
              }`}>↓</kbd>
              <span className="ml-0.5">Navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className={`px-1.5 py-0.5 border rounded font-mono ${
                isDark ? 'bg-[#121927] border-slate-700 text-slate-300' : 'bg-white border-slate-300 text-slate-700 shadow-2xs'
              }`}>↵</kbd>
              <span className="ml-0.5">Select / Execute</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className={`px-1.5 py-0.5 border rounded font-mono ${
                isDark ? 'bg-[#121927] border-slate-700 text-slate-300' : 'bg-white border-slate-300 text-slate-700 shadow-2xs'
              }`}>ESC</kbd>
              <span className="ml-0.5">Dismiss</span>
            </span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px]">
            <span className="text-blue-500 font-semibold">{filteredCommands.length} matches</span>
            <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
            <span>Scholario Ops Command Center</span>
          </div>
        </div>
      </div>
    </div>
  );
};
