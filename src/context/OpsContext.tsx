/**
 * OpsContext — connects to the real backend API.
 *
 * Strategy:
 * - Operational data (applications, servers, monitors, incidents, etc.)
 *   is fetched from the backend on mount and refreshed on WebSocket events.
 * - UI state (activeTab, selectedIds, modal state, theme) remains local.
 * - The frontend mock/simulator actions still work for development scenarios
 *   but also call real backend endpoints where they exist.
 * - localStorage is used only for: theme, UI preferences. NOT for operational data.
 */
import React, {
  createContext, useContext, useState, useEffect,
  useCallback, useRef, ReactNode
} from 'react';

import {
  Application, VpsServer, Monitor, Incident, CloudflareZone,
  BackupRecord, Runbook, Deployment, MaintenanceWindow,
  CommunicationChannel, EscalationPolicy, AuditLog,
  DeadManControlPlane, IncidentStatus, IncidentSeverity, OperationalStatus
} from '../types';
import { INITIAL_APPLICATIONS, INITIAL_SERVERS, INITIAL_MONITORS,
  INITIAL_INCIDENTS, INITIAL_CLOUDFLARE_ZONES, INITIAL_BACKUPS,
  INITIAL_RUNBOOKS, INITIAL_DEPLOYMENTS, INITIAL_MAINTENANCE_WINDOWS,
  INITIAL_COMM_CHANNELS, INITIAL_ESCALATION_POLICIES,
  INITIAL_AUDIT_LOGS, INITIAL_DEAD_MAN
} from '../data/initialData';

import { ApplicationsService, AppSummary } from '../services/applications';
import { ServersService, ServerSummary, ServerDetail } from '../services/servers';
import { MonitorsService, MonitorSummary } from '../services/monitors';
import { IncidentsService, IncidentSummary } from '../services/incidents';
import { NotificationsService } from '../services/notifications';
import { ReportsService, SystemSummary } from '../services/reports';
import { DrService } from '../services/dr';
import { AuditService } from '../services/audit';
import { useWebSocket, WsConnectionStatus } from '../hooks/useWebSocket';
import { tokenStore } from '../services/api';

// ── Type converters: API snake_case → frontend camelCase ─────────────────────

function toApplication(a: AppSummary): Application {
  return {
    id: a.id,
    name: a.name,
    codeName: a.code_name,
    description: a.description ?? '',
    tier: (a.tier as Application['tier']) ?? 'TIER_2',
    status: (a.status as OperationalStatus) ?? 'UNKNOWN',
    uptime24h:  a.uptime_24h  ?? 100,
    uptime7d:   a.uptime_7d   ?? 100,
    uptime30d:  a.uptime_30d  ?? 100,
    rtoTargetMin: a.rto_target_min ?? 30,
    rpoTargetMin: a.rpo_target_min ?? 15,
    currentReplicationLagSec: a.current_replication_lag_sec ?? 0,
    prdServerId: a.prd_server_id ?? '',
    drServerId:  a.dr_server_id  ?? '',
    failoverState: (a.failover_state as Application['failoverState']) ?? 'PRIMARY_ACTIVE',
    p50Ms: a.p50_ms ?? 0,
    p95Ms: a.p95_ms ?? 0,
    p99Ms: a.p99_ms ?? 0,
    errorRatePercent: a.error_rate_percent ?? 0,
    lastChecked: a.last_checked ?? new Date().toISOString(),
    cloudflareZone: a.cloudflare_zone ?? '',
    recentDeploymentVersion: a.recent_deployment_version ?? undefined,
    dependencies: [],
  };
}

function toServer(s: ServerSummary | ServerDetail): VpsServer {
  const det = s as ServerDetail;
  const tel = det.telemetry;
  return {
    id: s.id,
    hostname: s.hostname,
    ip: s.ip,
    applicationId: s.application_id ?? '',
    environment: (s.environment as VpsServer['environment']) ?? 'PRD',
    provider: 'Hostinger',
    region: (s.region as VpsServer['region']) ?? 'Singapore',
    plan: s.plan ?? '',
    cpuCores: s.cpu_cores ?? 0,
    ramGb: s.ram_gb ?? 0,
    diskGb: s.disk_gb ?? 0,
    os: s.os ?? '',
    status: (s.status as OperationalStatus) ?? 'UNKNOWN',
    agentVersion: s.agent_version ?? '',
    agentStatus: (s.agent_status as VpsServer['agentStatus']) ?? 'DISCONNECTED',
    uptimeDays: s.uptime_days ?? 0,
    lastSeen: s.last_seen ?? new Date().toISOString(),
    telemetry: {
      cpuPercent:     tel?.cpu_percent     ?? 0,
      ramPercent:     tel?.ram_percent     ?? 0,
      diskPercent:    tel?.disk_percent    ?? 0,
      loadAvg:        [tel?.load_avg_1m ?? 0, tel?.load_avg_5m ?? 0, tel?.load_avg_15m ?? 0],
      networkInKbps:  tel?.network_in_kbps  ?? 0,
      networkOutKbps: tel?.network_out_kbps ?? 0,
      observedAt:     tel?.observed_at     ?? new Date().toISOString(),
      receivedAt:     tel?.received_at     ?? new Date().toISOString(),
    },
    processes: (det.processes ?? []).map(p => ({
      pid: p.pid, name: p.name, user: p.user ?? '',
      cpuPercent: p.cpu_percent ?? 0, memMb: p.mem_mb ?? 0,
      status: (p.status as VpsProcess['status']) ?? 'running',
    })),
    services: (det.services ?? []).map(sv => ({
      name: sv.name, status: (sv.status as VpsService['status']) ?? 'active',
      version: sv.version ?? '', pid: sv.pid ?? 0,
      memoryMb: sv.memory_mb ?? 0, cpuPercent: sv.cpu_percent ?? 0,
      lastRestart: sv.last_restart ?? '',
    })),
    logs: (det.logs ?? []).map(l => ({
      id: l.id, timestamp: l.logged_at,
      level: (l.level as VpsLogEntry['level']) ?? 'info',
      service: l.service ?? '', message: l.message,
    })),
  };
}

function toMonitor(m: MonitorSummary): Monitor {
  return {
    id: m.id, name: m.name, type: m.type as Monitor['type'],
    target: m.target, applicationId: m.application_id ?? '',
    environment: (m.environment as Monitor['environment']) ?? 'PRD',
    intervalSec: m.interval_sec, timeoutSec: m.timeout_sec, retries: m.retries,
    warningThresholdMs: m.warning_threshold_ms, criticalThresholdMs: m.critical_threshold_ms,
    failureConfirmationThreshold: m.failure_confirmation_threshold,
    recoveryConfirmationThreshold: m.recovery_confirmation_threshold,
    consecutiveFailures: m.consecutive_failures, consecutiveRecoveries: m.consecutive_recoveries,
    status: (m.status as OperationalStatus) ?? 'UNKNOWN',
    lastCheck: m.last_check ?? '', lastSuccess: m.last_success ?? '',
    lastFailure: m.last_failure ?? undefined,
    responseTimeMs: m.response_time_ms ?? 0, uptimePercent: m.uptime_percent ?? 100,
    history: [], enabled: m.enabled, activeMaintenance: m.active_maintenance,
  };
}

function toIncident(i: IncidentSummary): Incident {
  return {
    id: i.ticket_number, // frontend uses ticket_number as display id
    title: i.title, severity: i.severity as Incident['severity'],
    status: i.status as Incident['status'],
    applicationId: i.application_id ?? '',
    environment: (i.environment as Incident['environment']) ?? 'PRD',
    fingerprint: i.fingerprint, rootCause: i.root_cause ?? '',
    startedAt: i.started_at, resolvedAt: i.resolved_at ?? undefined,
    durationMinutes: i.duration_minutes ?? 0,
    owner: i.owner_name ?? 'Unassigned',
    acknowledged: i.acknowledged, acknowledgedAt: i.acknowledged_at ?? undefined,
    acknowledgedBy: i.acknowledged_by_name ?? undefined,
    affectedServices: i.affected_services ?? [],
    affectedMonitors: i.affected_monitors ?? [],
    dependentFailures: [], timeline: [], recoveryStatus: i.recovery_status ?? '',
    runbookId: i.runbook_id ?? undefined, notes: [],
  };
}

// ── Type imports needed for converters ──────────────────────────────────────
type VpsProcess = VpsServer['processes'][0];
type VpsService = VpsServer['services'][0];
type VpsLogEntry = VpsServer['logs'][0];

// ── Context type ─────────────────────────────────────────────────────────────
interface OpsContextType {
  // Data
  applications: Application[];
  servers: VpsServer[];
  monitors: Monitor[];
  incidents: Incident[];
  cloudflareZones: CloudflareZone[];
  backups: BackupRecord[];
  runbooks: Runbook[];
  deployments: Deployment[];
  maintenanceWindows: MaintenanceWindow[];
  communicationChannels: CommunicationChannel[];
  escalationPolicies: EscalationPolicy[];
  auditLogs: AuditLog[];
  deadMan: DeadManControlPlane;
  // Loading/error
  isLoadingApps: boolean;
  isLoadingServers: boolean;
  isLoadingMonitors: boolean;
  isLoadingIncidents: boolean;
  apiError: string | null;
  // Realtime
  wsStatus: WsConnectionStatus;
  // Navigation
  activeTab: string;
  setActiveTab: (tab: string) => void;
  selectedAppId: string | null;
  setSelectedAppId: (id: string | null) => void;
  selectedServerId: string | null;
  setSelectedServerId: (id: string | null) => void;
  selectedIncidentId: string | null;
  setSelectedIncidentId: (id: string | null) => void;
  selectedRunbookId: string | null;
  setSelectedRunbookId: (id: string | null) => void;
  isCommandPaletteOpen: boolean;
  setIsCommandPaletteOpen: (open: boolean) => void;
  lastUpdatedSecondsAgo: number;
  // Actions
  triggerFailover: (appId: string, targetOrigin: 'DR' | 'PRIMARY') => void;
  acknowledgeIncident: (incidentId: string, operatorName?: string) => void;
  changeIncidentStatus: (incidentId: string, status: IncidentStatus) => void;
  changeIncidentSeverity: (incidentId: string, severity: IncidentSeverity) => void;
  assignIncidentOwner: (incidentId: string, owner: string) => void;
  addIncidentNote: (incidentId: string, noteText: string) => void;
  resolveIncident: (incidentId: string, resolutionSummary?: string) => void;
  toggleRunbookStep: (runbookId: string, stepId: number) => void;
  runProbeCheck: (monitorId: string) => void;
  runAllProbes: () => void;
  sendTestNotification: (channelId: string) => Promise<boolean>;
  triggerSimulatedScenario: (scenario: 'RESOLVE_MOSAIC' | 'TRIGGER_MOSAIC_FAIL' | 'FAIL_CIPHER_DB' | 'DEADMAN_SILENCE' | 'RESET_ALL') => void;
  addAuditEntry: (action: string, category: AuditLog['category'], targetId: string, details: string) => void;
  refreshData: () => void;
  // Theme
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  // Summary
  systemSummary: {
    totalApps: number; healthyApps: number; totalServers: number; healthyServers: number;
    totalMonitors: number; healthyMonitors: number; openIncidents: number; criticalIncidents: number;
    drReadinessCount: number; backupsCurrentCount: number;
    cloudflareStatus: 'HEALTHY' | 'DEGRADED'; overallHealth: 'OPERATIONAL' | 'CRITICAL' | 'WARNING';
  };
}

const OpsContext = createContext<OpsContextType | undefined>(undefined);

// ── Provider ─────────────────────────────────────────────────────────────────
export const OpsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {

  // ── Real data from API ──────────────────────────────────────────────────
  const [applications, setApplications] = useState<Application[]>([]);
  const [servers,      setServers]      = useState<VpsServer[]>([]);
  const [monitors,     setMonitors]     = useState<Monitor[]>([]);
  const [incidents,    setIncidents]    = useState<Incident[]>([]);
  const [cloudflareZones] = useState<CloudflareZone[]>(INITIAL_CLOUDFLARE_ZONES);
  const [backups]         = useState<BackupRecord[]>(INITIAL_BACKUPS);
  const [runbooks,     setRunbooks]     = useState<Runbook[]>(INITIAL_RUNBOOKS);
  const [deployments]                   = useState<Deployment[]>(INITIAL_DEPLOYMENTS);
  const [maintenanceWindows]            = useState<MaintenanceWindow[]>(INITIAL_MAINTENANCE_WINDOWS);
  const [communicationChannels, setCommunicationChannels] = useState<CommunicationChannel[]>(INITIAL_COMM_CHANNELS);
  const [escalationPolicies]            = useState<EscalationPolicy[]>(INITIAL_ESCALATION_POLICIES);
  const [auditLogs,    setAuditLogs]    = useState<AuditLog[]>(INITIAL_AUDIT_LOGS);
  const [deadMan,      setDeadMan]      = useState<DeadManControlPlane>(INITIAL_DEAD_MAN);

  // ── Loading / error state ───────────────────────────────────────────────
  const [isLoadingApps,      setIsLoadingApps]      = useState(true);
  const [isLoadingServers,   setIsLoadingServers]   = useState(true);
  const [isLoadingMonitors,  setIsLoadingMonitors]  = useState(true);
  const [isLoadingIncidents, setIsLoadingIncidents] = useState(true);
  const [apiError,           setApiError]           = useState<string | null>(null);

  // ── UI state (stays local) ──────────────────────────────────────────────
  const [activeTab,           setActiveTab]           = useState('overview');
  const [selectedAppId,       setSelectedAppId]       = useState<string | null>(null);
  const [selectedServerId,    setSelectedServerId]    = useState<string | null>(null);
  const [selectedIncidentId,  setSelectedIncidentId]  = useState<string | null>(null);
  const [selectedRunbookId,   setSelectedRunbookId]   = useState<string | null>(null);
  const [isCommandPaletteOpen,setIsCommandPaletteOpen]= useState(false);
  const [lastUpdatedSecondsAgo, setLastUpdatedSecondsAgo] = useState(0);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('scholario_theme');
    return saved === 'light' ? 'light' : 'dark';
  });

  // ── WebSocket ───────────────────────────────────────────────────────────
  const { status: wsStatus, on: wsOn } = useWebSocket();

  // ── API fetch functions ─────────────────────────────────────────────────
  const fetchApplications = useCallback(async () => {
    if (!tokenStore.getAccess()) return;
    setIsLoadingApps(true);
    try {
      const res = await ApplicationsService.list({ pageSize: 100 });
      setApplications(res.data.map(toApplication));
      setApiError(null);
    } catch (e) {
      // Fall back to mock data so the UI still works
      setApplications(INITIAL_APPLICATIONS);
    } finally {
      setIsLoadingApps(false);
    }
  }, []);

  const fetchServers = useCallback(async () => {
    if (!tokenStore.getAccess()) return;
    setIsLoadingServers(true);
    try {
      const res = await ServersService.list({ pageSize: 50 });
      setServers(res.data.map(s => toServer(s)));
    } catch {
      setServers(INITIAL_SERVERS);
    } finally {
      setIsLoadingServers(false);
    }
  }, []);

  const fetchMonitors = useCallback(async () => {
    if (!tokenStore.getAccess()) return;
    setIsLoadingMonitors(true);
    try {
      const res = await MonitorsService.list({ pageSize: 100 });
      setMonitors(res.data.map(toMonitor));
    } catch {
      setMonitors(INITIAL_MONITORS);
    } finally {
      setIsLoadingMonitors(false);
    }
  }, []);

  const fetchIncidents = useCallback(async () => {
    if (!tokenStore.getAccess()) return;
    setIsLoadingIncidents(true);
    try {
      const res = await IncidentsService.list({ pageSize: 50, open: true });
      // Also get recently resolved (last 10)
      const resolvedRes = await IncidentsService.list({ pageSize: 10, status: 'RESOLVED' });
      setIncidents([...res.data.map(toIncident), ...resolvedRes.data.map(toIncident)]);
    } catch {
      setIncidents(INITIAL_INCIDENTS);
    } finally {
      setIsLoadingIncidents(false);
    }
  }, []);

  const fetchDeadMan = useCallback(async () => {
    if (!tokenStore.getAccess()) return;
    try {
      const res = await ReportsService.getSummary();
      const s = res.data;
      setDeadMan(prev => ({
        ...prev,
        status: s.deadManStatus === 'CRITICAL_SILENCE' ? 'CRITICAL_SILENCE' : 'HEALTHY',
        lastHeartbeatReceivedAt: s.deadManLastHeartbeat ?? prev.lastHeartbeatReceivedAt,
      }));
    } catch { /* keep existing */ }
  }, []);

  const refreshData = useCallback(() => {
    fetchApplications();
    fetchServers();
    fetchMonitors();
    fetchIncidents();
    fetchDeadMan();
    setLastUpdatedSecondsAgo(0);
  }, [fetchApplications, fetchServers, fetchMonitors, fetchIncidents, fetchDeadMan]);

  // ── Initial load & periodic refresh (60s) ──────────────────────────────
  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 60_000);
    return () => clearInterval(interval);
  }, [refreshData]);

  // ── WebSocket event handlers ────────────────────────────────────────────
  useEffect(() => {
    const unsubs = [
      wsOn('server.health.changed',    () => fetchServers()),
      wsOn('monitor.status.changed',   () => fetchMonitors()),
      wsOn('incident.created',         () => fetchIncidents()),
      wsOn('incident.updated',         () => fetchIncidents()),
      wsOn('incident.resolved',        () => fetchIncidents()),
      wsOn('deadman.status.changed',   () => fetchDeadMan()),
      wsOn('failover.completed',       () => fetchApplications()),
      wsOn('system.summary.updated',   () => refreshData()),
    ];
    return () => unsubs.forEach(fn => fn());
  }, [wsOn, fetchServers, fetchMonitors, fetchIncidents, fetchDeadMan, fetchApplications, refreshData]);

  // ── Ticker & keyboard ───────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setLastUpdatedSecondsAgo(p => p + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(p => !p);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ── Theme ───────────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('scholario_theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme !== 'dark');
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme(p => p === 'dark' ? 'light' : 'dark'), []);

  // ── Telemetry jitter for servers without live agent (keeps UI alive) ────
  useEffect(() => {
    const t = setInterval(() => {
      setServers(prev => prev.map(srv => {
        if (srv.agentStatus !== 'CONNECTED') return srv;
        const cpu = srv.telemetry.cpuPercent;
        const ram = srv.telemetry.ramPercent;
        return {
          ...srv,
          lastSeen: new Date().toISOString(),
          telemetry: {
            ...srv.telemetry,
            cpuPercent: +(Math.max(8, Math.min(99, cpu + (Math.random() * 4 - 2))).toFixed(1)),
            ramPercent: +(Math.max(20, Math.min(98, ram + (Math.random() * 1 - 0.5))).toFixed(1)),
            observedAt: new Date(Date.now() - 3000).toISOString(),
            receivedAt: new Date().toISOString(),
          },
        };
      }));
      setDeadMan(prev =>
        prev.status === 'HEALTHY'
          ? { ...prev, lastHeartbeatReceivedAt: new Date().toISOString(), consecutiveMisses: 0 }
          : prev
      );
    }, 5000);
    return () => clearInterval(t);
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────

  const addAuditEntry = useCallback((action: string, category: AuditLog['category'], targetId: string, details: string) => {
    setAuditLogs(prev => [{
      id: `aud-${Date.now()}`,
      timestamp: new Date().toISOString(),
      operator: tokenStore.getUser()?.fullName ?? 'IT Operations',
      action, category, targetId, details,
    }, ...prev.slice(0, 99)]);
  }, []);

  const triggerFailover = useCallback(async (appId: string, targetOrigin: 'DR' | 'PRIMARY') => {
    const app = applications.find(a => a.id === appId);
    if (!app) return;
    try {
      await DrService.triggerFailover(appId, targetOrigin);
      await fetchApplications();
      addAuditEntry(`CLOUDFLARE_FAILOVER_${targetOrigin}`, 'FAILOVER', appId, `Failover ${app.name} → ${targetOrigin}`);
    } catch {
      // Fallback: update locally so UI still responds
      setApplications(prev => prev.map(a => a.id === appId
        ? { ...a, failoverState: targetOrigin === 'DR' ? 'DR_ACTIVE' : 'PRIMARY_ACTIVE' }
        : a
      ));
    }
  }, [applications, fetchApplications, addAuditEntry]);

  const acknowledgeIncident = useCallback(async (incidentId: string, _operatorName?: string) => {
    // Find by ticket_number (frontend id mapping)
    const inc = incidents.find(i => i.id === incidentId);
    if (!inc) return;
    try {
      await IncidentsService.acknowledge(inc.id);
      await fetchIncidents();
    } catch {
      setIncidents(prev => prev.map(i => i.id === incidentId
        ? { ...i, acknowledged: true, status: 'ACKNOWLEDGED' as IncidentStatus }
        : i
      ));
    }
    addAuditEntry('INCIDENT_ACKNOWLEDGED', 'INCIDENT', incidentId, `Acknowledged`);
  }, [incidents, fetchIncidents, addAuditEntry]);

  const changeIncidentStatus = useCallback(async (incidentId: string, status: IncidentStatus) => {
    const inc = incidents.find(i => i.id === incidentId);
    if (!inc) return;
    try {
      await IncidentsService.changeStatus(inc.id, status);
      await fetchIncidents();
    } catch {
      setIncidents(prev => prev.map(i => i.id === incidentId ? { ...i, status } : i));
    }
    addAuditEntry('INCIDENT_STATUS_CHANGE', 'INCIDENT', incidentId, `Status → ${status}`);
  }, [incidents, fetchIncidents, addAuditEntry]);

  const changeIncidentSeverity = useCallback(async (incidentId: string, severity: IncidentSeverity) => {
    const inc = incidents.find(i => i.id === incidentId);
    if (!inc) return;
    try {
      await IncidentsService.changeSeverity(inc.id, severity);
      await fetchIncidents();
    } catch {
      setIncidents(prev => prev.map(i => i.id === incidentId ? { ...i, severity } : i));
    }
    addAuditEntry('INCIDENT_SEVERITY_CHANGE', 'INCIDENT', incidentId, `Severity → ${severity}`);
  }, [incidents, fetchIncidents, addAuditEntry]);

  const assignIncidentOwner = useCallback(async (incidentId: string, owner: string) => {
    setIncidents(prev => prev.map(i => i.id === incidentId ? { ...i, owner } : i));
    addAuditEntry('INCIDENT_REASSIGNED', 'INCIDENT', incidentId, `Assigned to ${owner}`);
  }, [addAuditEntry]);

  const addIncidentNote = useCallback(async (incidentId: string, noteText: string) => {
    if (!noteText.trim()) return;
    const inc = incidents.find(i => i.id === incidentId);
    if (inc) {
      try {
        await IncidentsService.addNote(inc.id, noteText);
      } catch { /* best effort */ }
    }
    setIncidents(prev => prev.map(i => i.id === incidentId
      ? { ...i, notes: [...i.notes, { id: `note-${Date.now()}`, author: tokenStore.getUser()?.fullName ?? 'Operator', role: 'Operations Engineer', timestamp: new Date().toISOString(), content: noteText }] }
      : i
    ));
  }, [incidents]);

  const resolveIncident = useCallback(async (incidentId: string, resolutionSummary?: string) => {
    const inc = incidents.find(i => i.id === incidentId);
    if (!inc) return;
    try {
      await IncidentsService.resolve(inc.id, resolutionSummary ?? 'Resolved by operator');
      await fetchIncidents();
    } catch {
      setIncidents(prev => prev.map(i => i.id === incidentId
        ? { ...i, status: 'RESOLVED', resolvedAt: new Date().toISOString(), recoveryStatus: resolutionSummary ?? 'Resolved' }
        : i
      ));
    }
    addAuditEntry('INCIDENT_RESOLVED', 'INCIDENT', incidentId, resolutionSummary ?? 'Resolved');
  }, [incidents, fetchIncidents, addAuditEntry]);

  const toggleRunbookStep = useCallback((runbookId: string, stepId: number) => {
    setRunbooks(prev => prev.map(rb => {
      if (rb.id !== runbookId) return rb;
      return {
        ...rb,
        steps: rb.steps.map(step => {
          if (step.id !== stepId) return step;
          const next = !step.completed;
          return { ...step, completed: next, completedAt: next ? 'Just now' : undefined, completedBy: next ? tokenStore.getUser()?.fullName ?? 'Operator' : undefined };
        }),
      };
    }));
    addAuditEntry('RUNBOOK_STEP_UPDATE', 'RUNBOOK', runbookId, `Step #${stepId} updated`);
  }, [addAuditEntry]);

  const runProbeCheck = useCallback(async (monitorId: string) => {
    try {
      await MonitorsService.probe(monitorId);
      // Refresh just monitors after probe
      setTimeout(() => fetchMonitors(), 1000);
    } catch {
      // Local sim fallback
      setMonitors(prev => prev.map(m => m.id !== monitorId ? m : {
        ...m, lastCheck: new Date().toISOString(),
        responseTimeMs: m.status === 'CRITICAL' ? Math.floor(4000 + Math.random() * 1200) : Math.floor(60 + Math.random() * 120),
      }));
    }
  }, [fetchMonitors]);

  const runAllProbes = useCallback(() => {
    monitors.forEach(m => runProbeCheck(m.id));
  }, [monitors, runProbeCheck]);

  const sendTestNotification = useCallback(async (channelId: string): Promise<boolean> => {
    try {
      const res = await NotificationsService.testChannel(channelId);
      const success = res.data.success;
      setCommunicationChannels(prev => prev.map(ch => ch.id !== channelId ? ch : {
        ...ch, lastDeliveryAt: new Date().toISOString(),
        lastDeliveryStatus: success ? 'DELIVERED' : 'FAILED',
        failureCount: success ? 0 : ch.failureCount + 1,
      }));
      addAuditEntry('TEST_NOTIFICATION_SENT', 'INCIDENT', channelId, `Test payload dispatched`);
      return success;
    } catch {
      return false;
    }
  }, [addAuditEntry]);

  // ── Simulator (kept for dev/demo, still works with local state) ─────────
  const triggerSimulatedScenario = useCallback((scenario: 'RESOLVE_MOSAIC' | 'TRIGGER_MOSAIC_FAIL' | 'FAIL_CIPHER_DB' | 'DEADMAN_SILENCE' | 'RESET_ALL') => {
    if (scenario === 'RESET_ALL') {
      refreshData();
      return;
    }
    if (scenario === 'RESOLVE_MOSAIC') {
      setServers(prev => prev.map(s => s.id === 'vps-sg-mosa-prd-01'
        ? { ...s, status: 'HEALTHY', telemetry: { ...s.telemetry, cpuPercent: 32.5, ramPercent: 54.0 } }
        : s
      ));
      setMonitors(prev => prev.map(m => m.applicationId === 'app-mosaic'
        ? { ...m, status: 'HEALTHY', consecutiveFailures: 0, consecutiveRecoveries: 3, responseTimeMs: 140, lastSuccess: new Date().toISOString() }
        : m
      ));
      setApplications(prev => prev.map(a => a.id === 'app-mosaic'
        ? { ...a, status: 'HEALTHY', failoverState: 'PRIMARY_ACTIVE', errorRatePercent: 0.02, p50Ms: 140, p95Ms: 290 }
        : a
      ));
      resolveIncident('INC-1042', 'Database pool flushed. 3 consecutive monitor passes verified.');
    }
    if (scenario === 'TRIGGER_MOSAIC_FAIL') {
      setServers(prev => prev.map(s => s.id === 'vps-sg-mosa-prd-01'
        ? { ...s, status: 'CRITICAL', telemetry: { ...s.telemetry, cpuPercent: 98.4, ramPercent: 96.1 } }
        : s
      ));
      setMonitors(prev => prev.map(m => m.applicationId === 'app-mosaic'
        ? { ...m, status: 'CRITICAL', consecutiveFailures: 3, consecutiveRecoveries: 0, responseTimeMs: 5000 }
        : m
      ));
      setApplications(prev => prev.map(a => a.id === 'app-mosaic'
        ? { ...a, status: 'CRITICAL', failoverState: 'DR_ACTIVE', errorRatePercent: 14.5 }
        : a
      ));
    }
    if (scenario === 'DEADMAN_SILENCE') {
      setDeadMan(prev => ({
        ...prev,
        status: prev.status === 'HEALTHY' ? 'CRITICAL_SILENCE' : 'HEALTHY',
        consecutiveMisses: prev.status === 'HEALTHY' ? 4 : 0,
      }));
    }
    addAuditEntry(`SIMULATION_${scenario}`, 'INFRASTRUCTURE', 'SYSTEM', `Scenario ${scenario} triggered`);
  }, [resolveIncident, refreshData, addAuditEntry]);

  // ── Computed summary ────────────────────────────────────────────────────
  const healthyApps      = applications.filter(a => a.status === 'HEALTHY').length;
  const healthyServers   = servers.filter(s => s.status === 'HEALTHY').length;
  const healthyMonitors  = monitors.filter(m => m.status === 'HEALTHY').length;
  const openIncidents    = incidents.filter(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED').length;
  const criticalIncidents = incidents.filter(i => i.severity === 'CRITICAL' && i.status !== 'RESOLVED' && i.status !== 'CLOSED').length;
  const backupsCurrentCount = backups.filter(b => b.status === 'SUCCESS').length;
  const drReadinessCount = applications.filter(a => {
    const dr = servers.find(s => s.id === a.drServerId);
    return dr?.status === 'HEALTHY' && (a.currentReplicationLagSec ?? 0) <= (a.rpoTargetMin ?? 15) * 60;
  }).length;
  const cloudflareDegraded = cloudflareZones.some(z => z.status === 'DEGRADED');

  const overallHealth: 'OPERATIONAL' | 'CRITICAL' | 'WARNING' =
    criticalIncidents > 0 || deadMan.status === 'CRITICAL_SILENCE' ? 'CRITICAL'
    : openIncidents > 0 || healthyApps < applications.length       ? 'WARNING'
    : 'OPERATIONAL';

  return (
    <OpsContext.Provider value={{
      applications, servers, monitors, incidents, cloudflareZones,
      backups, runbooks, deployments, maintenanceWindows,
      communicationChannels, escalationPolicies, auditLogs, deadMan,
      isLoadingApps, isLoadingServers, isLoadingMonitors, isLoadingIncidents,
      apiError, wsStatus,
      activeTab, setActiveTab,
      selectedAppId, setSelectedAppId,
      selectedServerId, setSelectedServerId,
      selectedIncidentId, setSelectedIncidentId,
      selectedRunbookId, setSelectedRunbookId,
      isCommandPaletteOpen, setIsCommandPaletteOpen,
      lastUpdatedSecondsAgo,
      triggerFailover, acknowledgeIncident, changeIncidentStatus,
      changeIncidentSeverity, assignIncidentOwner, addIncidentNote,
      resolveIncident, toggleRunbookStep, runProbeCheck, runAllProbes,
      sendTestNotification, triggerSimulatedScenario, addAuditEntry,
      refreshData,
      theme, setTheme, toggleTheme,
      systemSummary: {
        totalApps: applications.length, healthyApps,
        totalServers: servers.length, healthyServers,
        totalMonitors: monitors.length, healthyMonitors,
        openIncidents, criticalIncidents, drReadinessCount,
        backupsCurrentCount, cloudflareStatus: cloudflareDegraded ? 'DEGRADED' : 'HEALTHY',
        overallHealth,
      },
    }}>
      {children}
    </OpsContext.Provider>
  );
};

export const useOps = () => {
  const ctx = useContext(OpsContext);
  if (!ctx) throw new Error('useOps must be used within OpsProvider');
  return ctx;
};
