import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useOps } from '../../context/OpsContext';
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
  Zap,
  CheckCircle2,
  RefreshCw,
  Send,
  Download,
  Terminal,
  Radio,
  RotateCcw,
  Check,
  FileText,
  Bell,
  Sliders,
  Database,
  Calendar,
  ShieldCheck,
  Shield,
  Cpu,
  Compass,
  CornerDownLeft
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
  action: () => void;
}

export const CommandPalette: React.FC = () => {
  const { 
    isCommandPaletteOpen, 
    setIsCommandPaletteOpen, 
    applications, 
    servers, 
    monitors, 
    incidents, 
    runbooks, 
    setSelectedAppId,
    setSelectedServerId,
    setSelectedIncidentId,
    setSelectedRunbookId,
    setActiveTab,
    triggerFailover,
    acknowledgeIncident,
    resolveIncident,
    runProbeCheck,
    runAllProbes,
    sendTestNotification,
    triggerSimulatedScenario,
    deadMan,
    systemSummary,
    theme
  } = useOps();

  const isDark = theme === 'dark';

  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<PaletteCategory>('ALL');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global keyboard shortcut listener for Ctrl+K and Cmd+K
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        e.stopPropagation();
        setIsCommandPaletteOpen(!isCommandPaletteOpen);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true });
    };
  }, [isCommandPaletteOpen, setIsCommandPaletteOpen]);

  // Focus management when opening/closing
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

  const showFeedback = useCallback((msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => {
      setActionFeedback(null);
      setIsCommandPaletteOpen(false);
    }, 1200);
  }, [setIsCommandPaletteOpen]);

  // Construct comprehensive searchable command items list
  const allCommands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // =========================================================================
    // 1. NAVIGATION ROUTES
    // =========================================================================
    const navigationRoutes = [
      {
        id: 'route-overview',
        tab: 'overview',
        title: 'Command Center / Overview',
        subtitle: 'Global infrastructure health, telemetry, 5 core operational questions',
        badge: 'ROUTE',
        icon: Activity,
        keywords: 'overview dashboard command center telemetry health home status'
      },
      {
        id: 'route-incidents',
        tab: 'incidents',
        title: 'Incident Command & Workspace',
        subtitle: `${systemSummary.openIncidents} active incident tickets, timeline, blast radius, mitigation`,
        badge: systemSummary.openIncidents > 0 ? `${systemSummary.openIncidents} OPEN` : 'ALL CLEAR',
        badgeType: (systemSummary.criticalIncidents > 0 ? 'critical' : systemSummary.openIncidents > 0 ? 'warning' : 'success') as CommandItem['badgeType'],
        icon: AlertTriangle,
        keywords: 'incidents tickets triage blast radius postmortem root cause acknowledge investigate'
      },
      {
        id: 'route-alerts',
        tab: 'alerts',
        title: 'Alert Feed & Deduplication',
        subtitle: 'Continuous alert stream, deduplication fingerprints, and active notifications',
        badge: 'ROUTE',
        icon: Bell,
        keywords: 'alerts feed signals deadman noise deduplication paging notifications'
      },
      {
        id: 'route-apps',
        tab: 'applications',
        title: 'Applications Catalog & Topology',
        subtitle: `${systemSummary.healthyApps}/${systemSummary.totalApps} applications nominal, PRD/DR mappings, 10-tab deep inspection`,
        badge: `${systemSummary.healthyApps}/${systemSummary.totalApps}`,
        badgeType: (systemSummary.healthyApps === systemSummary.totalApps ? 'success' : 'critical') as CommandItem['badgeType'],
        icon: Layers,
        keywords: 'applications catalog systems cipher apex nimbus mosaic ascend vantage lumo beacon tier'
      },
      {
        id: 'route-monitors',
        tab: 'monitors',
        title: 'Continuous Monitors & Probes',
        subtitle: `${systemSummary.healthyMonitors}/${systemSummary.totalMonitors} probes passing, consecutive failure engine (3 checks), intervals`,
        badge: `${systemSummary.healthyMonitors}/${systemSummary.totalMonitors}`,
        badgeType: (systemSummary.healthyMonitors === systemSummary.totalMonitors ? 'success' : 'warning') as CommandItem['badgeType'],
        icon: Radio,
        keywords: 'monitors probes synthetic ping https tcp mysql dns endpoint checks polling'
      },
      {
        id: 'route-infrastructure',
        tab: 'infrastructure',
        title: 'Infrastructure / Hostinger VPS Fleet',
        subtitle: `${systemSummary.healthyServers}/${systemSummary.totalServers} VPS nodes healthy, CPU/RAM/Disk metrics, power states`,
        badge: `${systemSummary.healthyServers}/${systemSummary.totalServers} NODES`,
        badgeType: (systemSummary.healthyServers === systemSummary.totalServers ? 'success' : 'critical') as CommandItem['badgeType'],
        icon: Server,
        keywords: 'infrastructure servers vps hostinger nodes cpu ram disk reboot power ssh telemetry'
      },
      {
        id: 'route-dependencies',
        tab: 'dependencies',
        title: 'Dependency Graph & Blast Radius',
        subtitle: 'Interactive upstream/downstream dependency mapping from users to Cloudflare to VPS to DB',
        badge: 'MAP',
        icon: Cpu,
        keywords: 'dependencies blast radius topology graph relationships database upstream downstream'
      },
      {
        id: 'route-resilience',
        tab: 'resilience',
        title: 'PRD / DR Resilience & Readiness',
        subtitle: `${systemSummary.drReadinessCount}/${systemSummary.totalApps} ready for failover, replication lag, target RPO vs actual`,
        badge: `${systemSummary.drReadinessCount}/${systemSummary.totalApps} READY`,
        badgeType: 'success' as CommandItem['badgeType'],
        icon: Cloud,
        keywords: 'dr disaster recovery resilience readiness rto rpo replication standby secondary failover'
      },
      {
        id: 'route-failover',
        tab: 'failover',
        title: 'Failover Console & Traffic Routing',
        subtitle: 'Live Cloudflare Anycast traffic director, origin failover switch & failback control',
        badge: 'ROUTING',
        icon: RefreshCw,
        keywords: 'failover console switch traffic cloudflare anycast divert failback primary dr'
      },
      {
        id: 'route-backups',
        tab: 'backups',
        title: 'Backups & Integrity Verification',
        subtitle: `${systemSummary.backupsCurrentCount}/${systemSummary.totalApps} current, SHA-256 checksums, AES-256 encryption, restore drills`,
        badge: `${systemSummary.backupsCurrentCount}/${systemSummary.totalApps} VERIFIED`,
        badgeType: 'success' as CommandItem['badgeType'],
        icon: Database,
        keywords: 'backups snapshots restores sha256 encryption cold storage drills retention rpo'
      },
      {
        id: 'route-hostinger',
        tab: 'hostinger',
        title: 'Hostinger Cloud Provider Integration',
        subtitle: 'Hostinger API sync, hardware virtualization, snapshot volumes and data center health',
        badge: 'PROVIDER',
        icon: Server,
        keywords: 'hostinger cloud provider vps datacenter virtualization snapshots api'
      },
      {
        id: 'route-cloudflare',
        tab: 'cloudflare',
        title: 'Cloudflare Edge, DNS & WAF',
        subtitle: `Status: ${systemSummary.cloudflareStatus} · Anycast DNS zones, WAF rule inspection, SSL/TLS certs`,
        badge: systemSummary.cloudflareStatus,
        badgeType: (systemSummary.cloudflareStatus === 'HEALTHY' ? 'success' : 'warning') as CommandItem['badgeType'],
        icon: ShieldCheck,
        keywords: 'cloudflare edge anycast dns waf ssl tls certificates security proxy firewall'
      },
      {
        id: 'route-deployments',
        tab: 'deployments',
        title: 'Deployments Pipeline & Rollback',
        subtitle: 'Build/Deploy stages, health smoke tests, active releases, and instant rollback triggers',
        badge: 'PIPELINE',
        icon: GitBranch,
        keywords: 'deployments ci cd pipeline releases commits rollbacks smoke tests artifacts'
      },
      {
        id: 'route-changes',
        tab: 'changes',
        title: 'Infrastructure Change History',
        subtitle: 'Chronological changelog of DNS updates, kernel patches, scaling, and firewall edits',
        badge: 'LOGS',
        icon: FileText,
        keywords: 'changes configuration drift audit history modifications releases patches'
      },
      {
        id: 'route-maintenance',
        tab: 'maintenance',
        title: 'Maintenance Windows & Suppression',
        subtitle: 'Scheduled downtime, alert suppression policy, and customer notification banners',
        badge: 'SCHEDULE',
        icon: Calendar,
        keywords: 'maintenance windows suppression scheduled downtime calendar silence'
      },
      {
        id: 'route-runbooks',
        tab: 'runbooks',
        title: 'Interactive Operational Runbooks',
        subtitle: 'Standard Operating Procedures (SOPs), step-by-step mitigation checklists and shell scripts',
        badge: `${runbooks.length} RUNBOOKS`,
        icon: Terminal,
        keywords: 'runbooks sops playbooks mitigation procedures commands automation emergency'
      },
      {
        id: 'route-communications',
        tab: 'communications',
        title: 'Communications & Notification Channels',
        subtitle: 'Microsoft Teams webhook, On-Call Email, Generic Webhook dispatch, test payloads',
        badge: 'DISPATCH',
        icon: Bell,
        keywords: 'communications notifications teams email webhook pagerduty oncall alerts'
      },
      {
        id: 'route-escalation',
        tab: 'escalation',
        title: 'Escalation Policies & On-Call Rotation',
        subtitle: 'Multi-tier incident paging, primary & secondary engineers, timeout escalation ladder',
        badge: 'POLICIES',
        icon: Sliders,
        keywords: 'escalation policies oncall rotation engineer paging tiers timeout schedules'
      },
      {
        id: 'route-uptime',
        tab: 'uptime',
        title: 'Uptime & SLA Compliance Analytics',
        subtitle: '30-day availability metrics, SLA breach calculators, and latency percentiles (P50/P99)',
        badge: 'ANALYTICS',
        icon: Activity,
        keywords: 'uptime sla compliance availability p50 p99 latency reporting metrics'
      },
      {
        id: 'route-reports',
        tab: 'reports',
        title: 'Daily Operations Briefing & Reports',
        subtitle: 'Daily IT executive summary, incident post-mortems, and text/PDF artifact downloads',
        badge: 'REPORTING',
        icon: FileText,
        keywords: 'reports briefing daily executive summary export download documentation'
      },
      {
        id: 'route-audit',
        tab: 'audit',
        title: 'Admin Audit Logs & Compliance',
        subtitle: 'Operator action logs, threshold adjustments, failover commands, and access logs',
        badge: 'SECURITY',
        icon: Shield,
        keywords: 'audit logs operator security who did what history compliance forensics'
      }
    ];

    navigationRoutes.forEach(r => {
      items.push({
        id: r.id,
        category: 'ROUTES',
        categoryLabel: 'Navigation Route',
        title: r.title,
        subtitle: r.subtitle,
        badge: r.badge,
        badgeType: r.badgeType || 'route',
        icon: r.icon,
        keywords: `route navigate go to ${r.keywords} ${r.tab}`,
        action: () => {
          setActiveTab(r.tab);
          setIsCommandPaletteOpen(false);
        }
      });
    });

    // =========================================================================
    // 2. SPECIFIC APPLICATION NAMES
    // =========================================================================
    applications.forEach(app => {
      const isHealthy = app.status === 'HEALTHY';
      const isDr = app.failoverState === 'DR_ACTIVE';
      items.push({
        id: `app-name-${app.id}`,
        category: 'APPS',
        categoryLabel: 'Application System',
        title: `${app.name} (${app.codeName})`,
        subtitle: `${app.description} · ${app.tier.replace('_', ' ')} · PRD: ${app.prdServerId} · DR: ${app.drServerId} · Zone: ${app.cloudflareZone}`,
        badge: isDr ? 'DR ACTIVE' : app.status,
        badgeType: isDr ? 'warning' : isHealthy ? 'success' : 'critical',
        icon: Layers,
        keywords: `application app ${app.name} ${app.codeName} ${app.id} ${app.tier} ${app.description} ${app.cloudflareZone} ${app.prdServerId} ${app.drServerId}`,
        action: () => {
          setSelectedAppId(app.id);
          setActiveTab('applications');
          setIsCommandPaletteOpen(false);
        }
      });
    });

    // =========================================================================
    // 3. SERVER IDS (VPS NODES & HOSTNAMES)
    // =========================================================================
    servers.forEach(srv => {
      const isHealthy = srv.status === 'HEALTHY';
      items.push({
        id: `server-id-${srv.id}`,
        category: 'SERVERS',
        categoryLabel: 'Hostinger VPS Node',
        title: `${srv.id} (${srv.hostname})`,
        subtitle: `IP: ${srv.ip} · Env: ${srv.environment} · Region: ${srv.region} · CPU ${srv.telemetry.cpuPercent}% · RAM ${srv.telemetry.ramPercent}% · Disk ${srv.telemetry.diskPercent}%`,
        badge: `${srv.environment} · ${srv.region}`,
        badgeType: isHealthy ? 'default' : 'critical',
        icon: Server,
        keywords: `vps server hostinger ${srv.id} ${srv.hostname} ${srv.ip} ${srv.region} ${srv.environment} ${srv.plan} cpu ram disk node`,
        action: () => {
          setSelectedServerId(srv.id);
          setActiveTab('infrastructure');
          setIsCommandPaletteOpen(false);
        }
      });
    });

    // =========================================================================
    // 4. INCIDENT TICKET NUMBERS & DETAILS
    // =========================================================================
    incidents.forEach(inc => {
      const isCrit = inc.severity === 'CRITICAL';
      const isOpen = inc.status === 'OPEN' || inc.status === 'INVESTIGATING' || inc.status === 'MITIGATING';
      items.push({
        id: `incident-ticket-${inc.id}`,
        category: 'INCIDENTS',
        categoryLabel: 'Incident Ticket',
        title: `${inc.id}: ${inc.title}`,
        subtitle: `Root Cause: ${inc.rootCause} · Owner: ${inc.owner} · App: ${inc.affectedServices.join(', ')} · Status: ${inc.status}`,
        badge: `${inc.severity} · ${inc.status}`,
        badgeType: isCrit && isOpen ? 'critical' : isOpen ? 'warning' : 'success',
        icon: AlertTriangle,
        keywords: `incident ticket ${inc.id} ${inc.title} ${inc.rootCause} ${inc.severity} ${inc.status} ${inc.owner} ${inc.affectedServices.join(' ')} ${inc.fingerprint}`,
        action: () => {
          setSelectedIncidentId(inc.id);
          setActiveTab('incidents');
          setIsCommandPaletteOpen(false);
        }
      });
    });

    // =========================================================================
    // 5. COMMON MANAGEMENT ACTIONS
    // =========================================================================
    items.push({
      id: 'action-probe-all',
      category: 'ACTIONS',
      categoryLabel: 'Management Action',
      title: 'Run Health Probes on All Monitors',
      subtitle: 'Execute immediate probe check across all continuous monitors and synthetic endpoints',
      badge: 'EXECUTE',
      badgeType: 'action',
      icon: RefreshCw,
      keywords: 'probe all monitors check health polling refresh execute manual run test',
      action: () => {
        runAllProbes();
        showFeedback('Triggered health probe across all monitors');
      }
    });

    // Active Incident Actions
    const activeCrit = incidents.find(i => i.severity === 'CRITICAL' && (i.status === 'OPEN' || i.status === 'INVESTIGATING'));
    if (activeCrit) {
      if (!activeCrit.acknowledged) {
        items.push({
          id: `action-ack-${activeCrit.id}`,
          category: 'ACTIONS',
          categoryLabel: 'Incident Action',
          title: `Acknowledge Active Incident: ${activeCrit.id}`,
          subtitle: `Acknowledge ${activeCrit.title} (${activeCrit.owner})`,
          badge: 'ACKNOWLEDGE',
          badgeType: 'warning',
          icon: AlertTriangle,
          keywords: `acknowledge incident ack ${activeCrit.id} ${activeCrit.title}`,
          action: () => {
            acknowledgeIncident(activeCrit.id);
            showFeedback(`Acknowledged incident ${activeCrit.id}`);
          }
        });
      }

      items.push({
        id: `action-resolve-${activeCrit.id}`,
        category: 'ACTIONS',
        categoryLabel: 'Incident Action',
        title: `Resolve Incident: ${activeCrit.id}`,
        subtitle: `Confirm mitigation and sign off resolution for ${activeCrit.id}`,
        badge: 'RESOLVE',
        badgeType: 'success',
        icon: CheckCircle2,
        keywords: `resolve incident fix close ${activeCrit.id} ${activeCrit.title}`,
        action: () => {
          resolveIncident(activeCrit.id, 'Resolved via Command Palette');
          showFeedback(`Resolved incident ${activeCrit.id}`);
        }
      });
    }

    // Failover Actions for Applications
    applications.forEach(app => {
      const isDr = app.failoverState === 'DR_ACTIVE';
      items.push({
        id: `action-failover-${app.id}`,
        category: 'ACTIONS',
        categoryLabel: 'Failover Routing',
        title: isDr 
          ? `Failback ${app.name} to Primary Origin` 
          : `Emergency Failover: Divert ${app.name} to DR Standby`,
        subtitle: isDr 
          ? `Revert Cloudflare Anycast traffic to Primary node (${app.prdServerId})` 
          : `Route Cloudflare Anycast traffic to DR standby node (${app.drServerId})`,
        badge: isDr ? 'FAILBACK' : 'FAILOVER',
        badgeType: isDr ? 'action' : 'critical',
        icon: Cloud,
        keywords: `failover failback reroute traffic cloudflare ${app.name} ${app.codeName} dr primary`,
        action: () => {
          triggerFailover(app.id, isDr ? 'PRIMARY' : 'DR');
          showFeedback(`${isDr ? 'Initiated failback to Primary origin' : 'Diverted traffic to DR Standby'} for ${app.name}`);
        }
      });
    });

    // Communication Test Actions
    items.push({
      id: 'action-notify-teams',
      category: 'ACTIONS',
      categoryLabel: 'Notification',
      title: 'Dispatch Test Payload to Microsoft Teams',
      subtitle: 'Send webhook verification alert to #ops-control-center',
      badge: 'DISPATCH',
      badgeType: 'action',
      icon: Send,
      keywords: 'dispatch send notification test microsoft teams webhook alert comms',
      action: async () => {
        await sendTestNotification('comm-teams-ops');
        showFeedback('Dispatched test alert payload to Microsoft Teams');
      }
    });

    items.push({
      id: 'action-notify-email',
      category: 'ACTIONS',
      categoryLabel: 'Notification',
      title: 'Dispatch Test Alert to Escalation Email',
      subtitle: 'Send test verification email to oncall@scholario.net',
      badge: 'DISPATCH',
      badgeType: 'action',
      icon: Send,
      keywords: 'dispatch send test email oncall escalation alert comms',
      action: async () => {
        await sendTestNotification('comm-email-oncall');
        showFeedback('Dispatched test email to oncall@scholario.net');
      }
    });

    // Report Download Action
    items.push({
      id: 'action-download-report',
      category: 'ACTIONS',
      categoryLabel: 'Reporting',
      title: 'Download Daily Operations & SLA Briefing (.txt)',
      subtitle: 'Generate formatted immutable daily health briefing artifact',
      badge: 'DOWNLOAD',
      badgeType: 'action',
      icon: Download,
      keywords: 'download report daily briefing export sla compliance txt file summary',
      action: () => {
        const text = `SCHOLARIO OPS CONTROL CENTER DAILY BRIEFING\nGenerated: ${new Date().toISOString()}\nApplications: ${systemSummary.healthyApps}/${systemSummary.totalApps} Nominal\nHostinger Nodes: ${systemSummary.healthyServers}/${systemSummary.totalServers} Operational\nMonitors: ${systemSummary.healthyMonitors}/${systemSummary.totalMonitors} Active\nWatchdog Plane: ${deadMan.status}\nOpen Incidents: ${systemSummary.openIncidents}`;
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `scholario-ops-report-${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showFeedback('Generated and downloaded daily ops briefing');
      }
    });

    // Simulator Scenarios
    items.push({
      id: 'action-sim-recover',
      category: 'ACTIONS',
      categoryLabel: 'Simulation',
      title: 'Simulate Scenario: Mosaic Recovery & 3-Check Verification',
      subtitle: 'Simulates database connection flush, 3 consecutive passes & incident resolution',
      badge: 'SIMULATE',
      badgeType: 'success',
      icon: CheckCircle2,
      keywords: 'simulate recovery mosaic verify pass resolve scenario',
      action: () => {
        triggerSimulatedScenario('RESOLVE_MOSAIC');
        showFeedback('Simulated recovery sequence: 3 checks verified & incident resolved');
      }
    });

    items.push({
      id: 'action-sim-fail',
      category: 'ACTIONS',
      categoryLabel: 'Simulation',
      title: 'Simulate Scenario: Inject MySQL Connection Starvation',
      subtitle: 'Simulates 500 connections reached on Mosaic PRD, triggering INC-1042',
      badge: 'SIMULATE',
      badgeType: 'critical',
      icon: AlertTriangle,
      keywords: 'simulate failure inject mosaic database mysql pool exhaustion scenario',
      action: () => {
        triggerSimulatedScenario('TRIGGER_MOSAIC_FAIL');
        showFeedback('Injected failure scenario: Mosaic connection pool starved');
      }
    });

    items.push({
      id: 'action-sim-deadman',
      category: 'ACTIONS',
      categoryLabel: 'Simulation',
      title: 'Simulate Scenario: Toggle External Dead-Man Silence',
      subtitle: 'Simulates watchdog timeout from Zurich monitoring node',
      badge: 'SIMULATE',
      badgeType: 'warning',
      icon: Radio,
      keywords: 'simulate deadman silence watchdog timeout heartbeat zurich scenario',
      action: () => {
        triggerSimulatedScenario('DEADMAN_SILENCE');
        showFeedback('Toggled independent dead-man watchdog state');
      }
    });

    items.push({
      id: 'action-sim-reset',
      category: 'ACTIONS',
      categoryLabel: 'System',
      title: 'Reset Ops Control Center to Baseline State',
      subtitle: 'Restores initial applications, servers, monitors and incident records',
      badge: 'RESET',
      badgeType: 'default',
      icon: RotateCcw,
      keywords: 'reset clear baseline restart restore default state initial',
      action: () => {
        triggerSimulatedScenario('RESET_ALL');
        showFeedback('Restored system state to baseline');
      }
    });

    // =========================================================================
    // 6. CONTINUOUS MONITORS
    // =========================================================================
    monitors.forEach(mon => {
      items.push({
        id: `mon-item-${mon.id}`,
        category: 'MONITORS',
        categoryLabel: 'Continuous Monitor Probe',
        title: `${mon.id}: ${mon.name}`,
        subtitle: `${mon.target} · ${mon.type} · Response: ${mon.responseTimeMs}ms · Interval: ${mon.intervalSec}s · ${mon.consecutiveRecoveries} recoveries / ${mon.consecutiveFailures} fails`,
        badge: mon.status,
        badgeType: mon.status === 'HEALTHY' ? 'success' : 'critical',
        icon: Radio,
        keywords: `monitor probe endpoint url ping check ${mon.id} ${mon.name} ${mon.target} ${mon.type}`,
        action: () => {
          runProbeCheck(mon.id);
          setActiveTab('monitors');
          setIsCommandPaletteOpen(false);
        }
      });
    });

    // =========================================================================
    // 7. OPERATIONAL RUNBOOKS
    // =========================================================================
    runbooks.forEach(rb => {
      items.push({
        id: `rb-item-${rb.id}`,
        category: 'RUNBOOKS',
        categoryLabel: 'Operational Runbook',
        title: `${rb.id}: ${rb.title}`,
        subtitle: `${rb.description} (${rb.steps.length} steps, ~${rb.estimatedDurationMin}m)`,
        badge: rb.category,
        badgeType: 'default',
        icon: Terminal,
        keywords: `runbook sop procedure guide step ${rb.id} ${rb.title} ${rb.category}`,
        action: () => {
          setSelectedRunbookId(rb.id);
          setActiveTab('runbooks');
          setIsCommandPaletteOpen(false);
        }
      });
    });

    return items;
  }, [
    applications,
    servers,
    monitors,
    incidents,
    runbooks,
    deadMan,
    systemSummary,
    runAllProbes,
    acknowledgeIncident,
    resolveIncident,
    triggerFailover,
    sendTestNotification,
    triggerSimulatedScenario,
    runProbeCheck,
    setSelectedAppId,
    setSelectedServerId,
    setSelectedIncidentId,
    setSelectedRunbookId,
    setActiveTab,
    setIsCommandPaletteOpen,
    showFeedback
  ]);

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
      if (filteredCommands[highlightedIndex]) {
        filteredCommands[highlightedIndex].action();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsCommandPaletteOpen(false);
    }
  };

  if (!isCommandPaletteOpen) return null;

  const categories: { id: PaletteCategory; label: string; count?: number }[] = [
    { id: 'ALL', label: 'All', count: allCommands.length },
    { id: 'ROUTES', label: 'Routes', count: allCommands.filter(c => c.category === 'ROUTES').length },
    { id: 'APPS', label: 'Applications', count: applications.length },
    { id: 'SERVERS', label: 'Server IDs', count: servers.length },
    { id: 'INCIDENTS', label: 'Incidents', count: incidents.length },
    { id: 'ACTIONS', label: '⚡ Actions', count: allCommands.filter(c => c.category === 'ACTIONS').length },
    { id: 'MONITORS', label: 'Monitors', count: monitors.length },
    { id: 'RUNBOOKS', label: 'Runbooks', count: runbooks.length }
  ];

  return (
    <div 
      className="fixed inset-0 z-50 flex items-start justify-center pt-14 sm:pt-20 bg-black/80 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-100"
      onClick={() => setIsCommandPaletteOpen(false)}
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
            placeholder="Search routes, apps (Cipher, Mosaic...), server IDs (vps-sg-prd-01...), incident tickets (INC-1042), or actions..."
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
            onClick={() => setIsCommandPaletteOpen(false)}
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
                  onClick={() => item.action()}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`w-full flex items-center justify-between p-2.5 rounded cursor-pointer transition-all ${
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
                      {isHighlighted ? (
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
              <div className="text-[11px] text-slate-500">Try searching for an application name (e.g. &apos;Mosaic&apos;), server ID (e.g. &apos;vps-sg-prd-01&apos;), incident ticket (e.g. &apos;INC-1042&apos;), or route (e.g. &apos;Overview&apos;).</div>
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
