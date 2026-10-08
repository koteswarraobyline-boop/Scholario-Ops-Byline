import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import {
  Application, VpsServer, Monitor, Incident, CloudflareZone, BackupRecord, Runbook, Deployment, MaintenanceWindow,
  CommunicationChannel, EscalationPolicy, AuditLog, DeadManControlPlane, IncidentStatus, IncidentSeverity, MonitorType,
  IntegrationStatus, LoadBalancerState,
} from '../types';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, ApiError, HealthCheckResponse, BootstrapData, SystemSummary } from '../services/api';

export type RealtimeStatus = 'LIVE' | 'RECONNECTING' | 'OFFLINE';

export interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface OpsContextType {
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
  integrations: IntegrationStatus | null;
  /** Cloudflare Load Balancer pools / health / routing (read-only); null until loaded */
  loadBalancer: LoadBalancerState | null;
  syncLoadBalancers: () => Promise<boolean>;

  isLoading: boolean;
  loadError: string | null;
  realtimeStatus: RealtimeStatus;
  refreshAll: () => Promise<void>;

  // Navigation & selection
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

  // Incidents
  acknowledgeIncident: (incidentId: string) => Promise<boolean>;
  changeIncidentStatus: (incidentId: string, status: IncidentStatus) => Promise<boolean>;
  changeIncidentSeverity: (incidentId: string, severity: IncidentSeverity) => Promise<boolean>;
  assignIncidentOwner: (incidentId: string, owner: string) => Promise<boolean>;
  addIncidentNote: (incidentId: string, noteText: string) => Promise<boolean>;
  resolveIncident: (incidentId: string, resolutionSummary?: string) => Promise<boolean>;
  createIncident: (data: { title: string; severity: IncidentSeverity; applicationId?: string; environment?: 'PRD' | 'DR'; description?: string }) => Promise<Incident | null>;

  // Failover
  triggerFailover: (appId: string, targetOrigin: 'DR' | 'PRIMARY', reason?: string) => Promise<boolean>;

  // Monitors
  runProbeCheck: (monitorId: string) => Promise<void>;
  runAllProbes: () => Promise<void>;
  addMonitor: (input: Partial<Monitor>) => Promise<Monitor | null>;
  updateMonitor: (monitorId: string, input: Partial<Monitor>) => Promise<Monitor | null>;
  deleteMonitor: (monitorId: string) => Promise<boolean>;
  toggleMonitorStatus: (monitorId: string) => Promise<boolean>;
  isAddMonitorModalOpen: boolean;
  setIsAddMonitorModalOpen: (open: boolean) => void;
  addMonitorInitialContext: { applicationId?: string; serverId?: string; defaultType?: MonitorType } | null;
  openAddMonitorWithContext: (context?: { applicationId?: string; serverId?: string; defaultType?: MonitorType }) => void;

  // Servers & applications
  createServer: (data: Partial<VpsServer>) => Promise<VpsServer | null>;
  updateServer: (id: string, data: Partial<VpsServer>) => Promise<VpsServer | null>;
  deleteServer: (id: string) => Promise<boolean>;
  createApplication: (data: Partial<Application>) => Promise<Application | null>;
  updateApplication: (id: string, data: Partial<Application>) => Promise<Application | null>;
  deleteApplication: (id: string) => Promise<boolean>;

  // Notifications
  sendTestNotification: (channelId: string) => Promise<boolean>;
  createChannel: (data: Partial<CommunicationChannel>) => Promise<CommunicationChannel | null>;
  updateChannel: (id: string, data: Partial<CommunicationChannel>) => Promise<CommunicationChannel | null>;
  deleteChannel: (id: string) => Promise<boolean>;
  saveEscalationPolicies: (policies: Partial<EscalationPolicy>[]) => Promise<boolean>;

  // Maintenance & runbooks
  createMaintenance: (data: Partial<MaintenanceWindow>) => Promise<MaintenanceWindow | null>;
  completeMaintenance: (id: string) => Promise<boolean>;
  deleteMaintenance: (id: string) => Promise<boolean>;
  toggleRunbookStep: (runbookId: string, stepId: number) => Promise<void>;
  resetRunbook: (runbookId: string) => Promise<void>;
  createRunbook: (data: Partial<Runbook>) => Promise<Runbook | null>;
  updateRunbook: (id: string, data: Partial<Runbook>) => Promise<Runbook | null>;
  deleteRunbook: (id: string) => Promise<boolean>;

  // Providers
  syncCloudflare: () => Promise<boolean>;
  syncHostinger: () => Promise<boolean>;

  // API reachability
  apiHealth: {
    reachable: boolean;
    status: 'CHECKING' | 'HEALTHY' | 'DEGRADED' | 'UNREACHABLE';
    lastChecked: string;
    latencyMs: number;
    endpoint: string;
    details: HealthCheckResponse | null;
  };
  triggerHealthCheck: () => Promise<void>;

  // Theme
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;

  // Toasts
  toasts: Toast[];
  notify: (type: Toast['type'], message: string) => void;
  dismissToast: (id: number) => void;

  systemSummary: {
    totalApps: number;
    healthyApps: number;
    totalServers: number;
    healthyServers: number;
    totalMonitors: number;
    healthyMonitors: number;
    openIncidents: number;
    criticalIncidents: number;
    drReadinessCount: number;
    backupsCurrentCount: number;
    cloudflareStatus: SystemSummary['cloudflareStatus'];
    overallHealth: SystemSummary['overallHealth'];
    /** When the backend computed the health / DR / Cloudflare figures (null until loaded) */
    generatedAt: string | null;
    visibilityGaps: string[];
  };
}

const OpsContext = createContext<OpsContextType | undefined>(undefined);

const EMPTY_DEADMAN: DeadManControlPlane = {
  id: 'deadman-infrastructure',
  name: 'Dead-Man Watchdog Heartbeat Stream',
  status: 'NOT_CONFIGURED',
  evaluatedAt: '',
  telemetryIntervalSec: null,
  staleAfterSec: 60,
  disconnectedAfterSec: 600,
  servers: [],
  counts: { healthy: 0, degraded: 0, failing: 0, unknown: 0, total: 0 },
};

/**
 * Accepts whatever the API sends for the dead-man heartbeat and returns a complete object. An older
 * backend (or a partial payload) must never crash the UI: missing lists become empty, an unknown
 * status becomes UNKNOWN.
 */
export function normalizeDeadMan(raw: unknown): DeadManControlPlane {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<DeadManControlPlane>;
  const statuses: DeadManControlPlane['status'][] = ['HEALTHY', 'DEGRADED', 'FAILING', 'UNKNOWN', 'NOT_CONFIGURED'];
  const servers = Array.isArray(d.servers) ? d.servers.filter(s => s && typeof s === 'object' && s.server && s.applications && s.services && s.databases) : [];
  return {
    ...EMPTY_DEADMAN,
    ...d,
    status: statuses.includes(d.status as DeadManControlPlane['status']) ? d.status as DeadManControlPlane['status'] : (servers.length ? 'UNKNOWN' : 'NOT_CONFIGURED'),
    servers,
    counts: d.counts && typeof d.counts === 'object' ? { ...EMPTY_DEADMAN.counts, ...d.counts } : EMPTY_DEADMAN.counts,
    telemetryIntervalSec: typeof d.telemetryIntervalSec === 'number' ? d.telemetryIntervalSec : null,
    staleAfterSec: typeof d.staleAfterSec === 'number' ? d.staleAfterSec : EMPTY_DEADMAN.staleAfterSec,
    disconnectedAfterSec: typeof d.disconnectedAfterSec === 'number' ? d.disconnectedAfterSec : EMPTY_DEADMAN.disconnectedAfterSec,
  };
}

const upsert = <T extends { id: string }>(list: T[], item: T, prepend = true): T[] =>
  list.some(x => x.id === item.id) ? list.map(x => (x.id === item.id ? item : x)) : prepend ? [item, ...list] : [...list, item];

const errMessage = (err: unknown) => (err instanceof ApiError || err instanceof Error ? err.message : 'Unexpected error');

export const OpsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [applications, setApplications] = useState<Application[]>([]);
  const [servers, setServers] = useState<VpsServer[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [cloudflareZones, setCloudflareZones] = useState<CloudflareZone[]>([]);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [maintenanceWindows, setMaintenanceWindows] = useState<MaintenanceWindow[]>([]);
  const [communicationChannels, setCommunicationChannels] = useState<CommunicationChannel[]>([]);
  const [escalationPolicies, setEscalationPolicies] = useState<EscalationPolicy[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [deadMan, setDeadMan] = useState<DeadManControlPlane>(EMPTY_DEADMAN);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);
  const [loadBalancer, setLoadBalancer] = useState<LoadBalancerState | null>(null);
  const [serverSummary, setServerSummary] = useState<SystemSummary | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('RECONNECTING');

  const [activeTab, setActiveTabState] = useState<string>('overview');
  const navigate = useNavigate();
  const location = useLocation();
  // Tabs are URL-driven: switching tab navigates, so the address bar, history and view stay in sync
  const setActiveTab = useCallback((tab: string) => {
    setActiveTabState(tab);
    if (location.pathname !== `/${tab}`) navigate(`/${tab}`);
  }, [location.pathname, navigate]);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [selectedRunbookId, setSelectedRunbookId] = useState<string | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isAddMonitorModalOpen, setIsAddMonitorModalOpen] = useState(false);
  const [addMonitorInitialContext, setAddMonitorInitialContext] = useState<{ applicationId?: string; serverId?: string; defaultType?: MonitorType } | null>(null);
  const [lastUpdatedSecondsAgo, setLastUpdatedSecondsAgo] = useState(0);
  const lastEventAt = useRef(Date.now());

  const [apiHealth, setApiHealth] = useState<OpsContextType['apiHealth']>({
    reachable: true, status: 'CHECKING', lastChecked: '', latencyMs: 0, endpoint: '/api/health', details: null,
  });

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('scholario_theme');
      return saved === 'light' || saved === 'dark' ? saved : 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    try { localStorage.setItem('scholario_theme', theme); } catch { /* storage unavailable */ }
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);
  const toggleTheme = useCallback(() => setTheme(prev => (prev === 'dark' ? 'light' : 'dark')), []);

  // ── Toasts ────────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const dismissToast = useCallback((id: number) => setToasts(prev => prev.filter(t => t.id !== id)), []);
  const notify = useCallback((type: Toast['type'], message: string) => {
    const id = ++toastSeq.current;
    setToasts(prev => [...prev.slice(-4), { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), type === 'error' ? 8000 : 4000);
  }, []);

  /** Runs an API action and reports failures to the operator instead of swallowing them. */
  const run = useCallback(async <T,>(action: () => Promise<T>, successMessage?: string): Promise<T | null> => {
    try {
      const result = await action();
      if (successMessage) notify('success', successMessage);
      return result;
    } catch (err) {
      notify('error', errMessage(err));
      return null;
    }
  }, [notify]);

  // ── Loading ───────────────────────────────────────────────────────────────
  const applyBootstrap = useCallback((d: BootstrapData) => {
    setApplications(d.applications);
    setServers(d.servers);
    setMonitors(d.monitors);
    setIncidents(d.incidents);
    setCommunicationChannels(d.channels);
    setEscalationPolicies(d.escalationPolicies);
    setMaintenanceWindows(d.maintenanceWindows);
    setRunbooks(d.runbooks);
    setDeployments(d.deployments);
    setBackups(d.backups);
    setAuditLogs(d.auditLogs);
    setCloudflareZones(d.cloudflareZones);
    setDeadMan(normalizeDeadMan(d.deadMan));
    setIntegrations(d.integrations);
    setLoadBalancer(d.loadBalancer ?? null);
    setServerSummary(d.summary);
    lastEventAt.current = Date.now();
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      applyBootstrap(await api.bootstrap());
      setLoadError(null);
    } catch (err) {
      setLoadError(errMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [applyBootstrap]);

  // Debounced per-collection refetch used by "x_changed" realtime events
  const pending = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const refetch = useCallback((key: string, fn: () => Promise<void>) => {
    clearTimeout(pending.current[key]);
    pending.current[key] = setTimeout(() => { fn().catch(() => {}); }, 300);
  }, []);

  const triggerHealthCheck = useCallback(async () => {
    const start = performance.now();
    try {
      const data = await api.checkHealth();
      setApiHealth({
        reachable: true,
        status: data.status === 'ok' ? 'HEALTHY' : 'DEGRADED',
        lastChecked: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - start),
        endpoint: '/api/health',
        details: data,
      });
    } catch {
      setApiHealth(prev => ({ ...prev, reachable: false, status: 'UNREACHABLE', lastChecked: new Date().toISOString(), latencyMs: Math.round(performance.now() - start) }));
    }
  }, []);

  // Health / DR readiness / Cloudflare status are computed by the backend from real checks
  const refreshSummary = useCallback(async () => {
    try { setServerSummary(await api.getSummary()); } catch { /* keep last; generatedAt shows its age */ }
  }, []);

  useEffect(() => {
    void refreshAll();
    void triggerHealthCheck();
    const healthTimer = setInterval(triggerHealthCheck, 15_000);
    const summaryTimer = setInterval(refreshSummary, 15_000);
    let firstConnect = true;

    const unsubscribe = api.connectRealtimeStream((event, raw) => {
      lastEventAt.current = Date.now();
      const data = raw as never;
      switch (event) {
        case 'connected':
          // Resync after a reconnect so nothing missed while offline is lost
          if (!firstConnect) void refreshAll();
          firstConnect = false;
          break;
        case 'telemetry_tick': {
          const tick = raw as { deadManStatus: DeadManControlPlane['status']; servers: Array<Pick<VpsServer, 'id' | 'status' | 'agentStatus' | 'lastSeen' | 'telemetry'>> };
          setServers(prev => prev.map(s => {
            const u = tick.servers.find(x => x.id === s.id);
            return u ? { ...s, status: u.status, agentStatus: u.agentStatus, lastSeen: u.lastSeen, telemetry: u.telemetry } : s;
          }));
          break;
        }
        case 'server_update': setServers(prev => upsert(prev, data, false)); break;
        case 'servers_changed': refetch('servers', async () => setServers(await api.getServers())); break;
        case 'application_update': setApplications(prev => upsert(prev, data, false)); break;
        case 'applications_changed': refetch('apps', async () => setApplications(await api.getApplications())); break;
        case 'monitor_update': setMonitors(prev => upsert(prev, data)); break;
        case 'monitor_deleted': setMonitors(prev => prev.filter(m => m.id !== (raw as { id: string }).id)); break;
        case 'monitors_changed': refetch('monitors', async () => setMonitors(await api.getMonitors())); break;
        case 'incident_created':
        case 'incident_update': setIncidents(prev => upsert(prev, data)); break;
        case 'audit': setAuditLogs(prev => [raw as AuditLog, ...prev.filter(a => a.id !== (raw as AuditLog).id)].slice(0, 500)); break;
        case 'channel_update': setCommunicationChannels(prev => upsert(prev, data, false)); break;
        case 'channels_changed': refetch('channels', async () => {
          const [c, p] = await Promise.all([api.getChannels(), api.getEscalationPolicies()]);
          setCommunicationChannels(c); setEscalationPolicies(p);
        }); break;
        case 'maintenance_update': setMaintenanceWindows(prev => upsert(prev, data)); break;
        case 'maintenance_deleted': setMaintenanceWindows(prev => prev.filter(w => w.id !== (raw as { id: string }).id)); break;
        case 'runbooks_changed': refetch('runbooks', async () => setRunbooks(await api.getRunbooks())); break;
        case 'deployments_changed': refetch('deployments', async () => setDeployments(await api.getDeployments())); break;
        case 'backups_changed': refetch('backups', async () => setBackups(await api.getBackups())); break;
        case 'cloudflare_update': setCloudflareZones(raw as CloudflareZone[]); refetch('integrations', async () => setIntegrations(await api.integrations())); break;
        case 'deadman_update': setDeadMan(normalizeDeadMan(raw)); break;
        case 'loadbalancer_update':
          setLoadBalancer(raw as LoadBalancerState);
          refetch('integrations', async () => setIntegrations(await api.integrations()));
          break;
        default: break;
      }
      if (event === 'monitor_update' || event === 'incident_created' || event === 'incident_update' || event === 'loadbalancer_update' || event === 'servers_changed') {
        refetch('summary', refreshSummary);
      }
    }, connected => setRealtimeStatus(connected ? 'LIVE' : 'RECONNECTING'));

    return () => {
      clearInterval(healthTimer);
      clearInterval(summaryTimer);
      unsubscribe();
      Object.values(pending.current).forEach(clearTimeout);
    };
  }, [refreshAll, triggerHealthCheck, refetch, refreshSummary]);

  // Fallback: while the live stream is not connected, poll the API so the dashboard never freezes
  useEffect(() => {
    if (realtimeStatus === 'LIVE') return;
    const t = setInterval(() => { void refreshAll(); }, 30_000);
    return () => clearInterval(t);
  }, [realtimeStatus, refreshAll]);

  // Mark realtime OFFLINE when the API itself is unreachable
  useEffect(() => {
    if (!apiHealth.reachable) setRealtimeStatus('OFFLINE');
  }, [apiHealth.reachable]);

  useEffect(() => {
    const timer = setInterval(() => setLastUpdatedSecondsAgo(Math.floor((Date.now() - lastEventAt.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ── Incident actions ──────────────────────────────────────────────────────
  const incidentAction = useCallback(async (fn: () => Promise<Incident>, msg?: string) => {
    const inc = await run(fn, msg);
    if (inc) setIncidents(prev => upsert(prev, inc));
    return Boolean(inc);
  }, [run]);

  const acknowledgeIncident = useCallback((id: string) => incidentAction(() => api.acknowledgeIncident(id), `${id} acknowledged`), [incidentAction]);
  const changeIncidentStatus = useCallback((id: string, status: IncidentStatus) => incidentAction(() => api.updateIncidentStatus(id, status), `${id} → ${status}`), [incidentAction]);
  const changeIncidentSeverity = useCallback((id: string, severity: IncidentSeverity) => incidentAction(() => api.updateIncidentSeverity(id, severity), `${id} severity → ${severity}`), [incidentAction]);
  const assignIncidentOwner = useCallback((id: string, owner: string) => incidentAction(() => api.assignIncident(id, owner), `${id} assigned to ${owner}`), [incidentAction]);
  const addIncidentNote = useCallback((id: string, note: string) => {
    if (!note.trim()) return Promise.resolve(false);
    return incidentAction(() => api.addIncidentNote(id, note.trim()));
  }, [incidentAction]);
  const resolveIncident = useCallback((id: string, summary?: string) => incidentAction(() => api.resolveIncident(id, summary), `${id} resolved`), [incidentAction]);
  const createIncident = useCallback(async (data: Parameters<OpsContextType['createIncident']>[0]) => {
    const inc = await run(() => api.createIncident(data), 'Incident declared');
    if (inc) setIncidents(prev => upsert(prev, inc));
    return inc;
  }, [run]);

  // ── Failover ──────────────────────────────────────────────────────────────
  const triggerFailover = useCallback(async (appId: string, target: 'DR' | 'PRIMARY', reason?: string) => {
    const res = await run(() => api.triggerFailover(appId, target, reason));
    if (!res) return false;
    setApplications(prev => upsert(prev, res.app, false));
    notify('success', res.changed.length
      ? `${res.app.name}: DNS switched ${res.changed.map(c => `${c.from} → ${c.to}`).join(', ')}`
      : `${res.app.name}: DNS already pointed at the ${target === 'DR' ? 'DR' : 'PRD'} server`);
    return true;
  }, [run, notify]);

  // ── Monitors ──────────────────────────────────────────────────────────────
  const runProbeCheck = useCallback(async (id: string) => {
    const m = await run(() => api.probeMonitor(id));
    if (m) setMonitors(prev => upsert(prev, m));
  }, [run]);
  const runAllProbes = useCallback(async () => {
    const list = await run(() => api.probeAllMonitors());
    if (list) {
      setMonitors(list);
      notify('info', `Ran ${list.filter(m => m.enabled).length} monitor check(s)`);
    }
  }, [run, notify]);
  const addMonitor = useCallback(async (input: Partial<Monitor>) => {
    const m = await run(() => api.createMonitor(input), `Monitor "${input.name}" created`);
    if (m) setMonitors(prev => upsert(prev, m));
    return m;
  }, [run]);
  const updateMonitor = useCallback(async (id: string, input: Partial<Monitor>) => {
    const m = await run(() => api.updateMonitor(id, input), 'Monitor updated');
    if (m) setMonitors(prev => upsert(prev, m));
    return m;
  }, [run]);
  const deleteMonitor = useCallback(async (id: string) => {
    const r = await run(() => api.deleteMonitor(id), 'Monitor deleted');
    if (r) setMonitors(prev => prev.filter(m => m.id !== id));
    return Boolean(r);
  }, [run]);
  const toggleMonitorStatus = useCallback(async (id: string) => {
    const m = await run(() => api.toggleMonitor(id));
    if (m) setMonitors(prev => upsert(prev, m));
    return Boolean(m);
  }, [run]);
  const openAddMonitorWithContext = useCallback((context?: { applicationId?: string; serverId?: string; defaultType?: MonitorType }) => {
    setAddMonitorInitialContext(context || null);
    setIsAddMonitorModalOpen(true);
  }, []);

  // ── Servers & applications ────────────────────────────────────────────────
  const createServer = useCallback(async (data: Partial<VpsServer>) => {
    const s = await run(() => api.createServer(data), `Server ${data.hostname} registered`);
    if (s) setServers(prev => upsert(prev, s, false));
    return s;
  }, [run]);
  const updateServer = useCallback(async (id: string, data: Partial<VpsServer>) => {
    const s = await run(() => api.updateServer(id, data), 'Server updated');
    if (s) setServers(prev => upsert(prev, s, false));
    return s;
  }, [run]);
  const deleteServer = useCallback(async (id: string) => {
    const r = await run(() => api.deleteServer(id), 'Server removed');
    if (r) {
      setServers(prev => prev.filter(s => s.id !== id));
      setMonitors(prev => prev.filter(m => m.serverId !== id));
    }
    return Boolean(r);
  }, [run]);
  const createApplication = useCallback(async (data: Partial<Application>) => {
    const a = await run(() => api.createApplication(data), `Application ${data.name} created`);
    if (a) setApplications(prev => upsert(prev, a, false));
    return a;
  }, [run]);
  const updateApplication = useCallback(async (id: string, data: Partial<Application>) => {
    const a = await run(() => api.updateApplication(id, data), 'Application updated');
    if (a) setApplications(prev => upsert(prev, a, false));
    return a;
  }, [run]);
  const deleteApplication = useCallback(async (id: string) => {
    const r = await run(() => api.deleteApplication(id), 'Application deleted');
    if (r) {
      setApplications(prev => prev.filter(a => a.id !== id));
      setMonitors(prev => prev.filter(m => m.applicationId !== id));
    }
    return Boolean(r);
  }, [run]);

  // ── Notifications ─────────────────────────────────────────────────────────
  const sendTestNotification = useCallback(async (channelId: string) => {
    const ch = await run(() => api.testChannel(channelId), 'Test notification delivered');
    if (ch) setCommunicationChannels(prev => upsert(prev, ch, false));
    return Boolean(ch);
  }, [run]);
  const createChannel = useCallback(async (data: Partial<CommunicationChannel>) => {
    const ch = await run(() => api.createChannel(data), `Channel ${data.name} added`);
    if (ch) setCommunicationChannels(prev => upsert(prev, ch, false));
    return ch;
  }, [run]);
  const updateChannel = useCallback(async (id: string, data: Partial<CommunicationChannel>) => {
    const ch = await run(() => api.updateChannel(id, data), 'Channel updated');
    if (ch) setCommunicationChannels(prev => upsert(prev, ch, false));
    return ch;
  }, [run]);
  const deleteChannel = useCallback(async (id: string) => {
    const r = await run(() => api.deleteChannel(id), 'Channel deleted');
    if (r) setCommunicationChannels(prev => prev.filter(c => c.id !== id));
    return Boolean(r);
  }, [run]);
  const saveEscalationPolicies = useCallback(async (policies: Partial<EscalationPolicy>[]) => {
    const p = await run(() => api.saveEscalationPolicies(policies), 'Escalation policies saved');
    if (p) setEscalationPolicies(p);
    return Boolean(p);
  }, [run]);

  // ── Maintenance & runbooks ────────────────────────────────────────────────
  const createMaintenance = useCallback(async (data: Partial<MaintenanceWindow>) => {
    const w = await run(() => api.createMaintenance(data), 'Maintenance window scheduled');
    if (w) setMaintenanceWindows(prev => upsert(prev, w));
    return w;
  }, [run]);
  const completeMaintenance = useCallback(async (id: string) => {
    const w = await run(() => api.completeMaintenance(id), 'Maintenance completed');
    if (w) setMaintenanceWindows(prev => upsert(prev, w));
    return Boolean(w);
  }, [run]);
  const deleteMaintenance = useCallback(async (id: string) => {
    const r = await run(() => api.deleteMaintenance(id), 'Maintenance window deleted');
    if (r) setMaintenanceWindows(prev => prev.filter(w => w.id !== id));
    return Boolean(r);
  }, [run]);
  const toggleRunbookStep = useCallback(async (runbookId: string, stepId: number) => {
    const rb = await run(() => api.toggleRunbookStep(runbookId, stepId));
    if (rb) setRunbooks(prev => upsert(prev, rb, false));
  }, [run]);
  const resetRunbook = useCallback(async (runbookId: string) => {
    const rb = await run(() => api.resetRunbook(runbookId), 'Runbook progress reset');
    if (rb) setRunbooks(prev => upsert(prev, rb, false));
  }, [run]);
  const createRunbook = useCallback(async (data: Partial<Runbook>) => {
    const rb = await run(() => api.createRunbook(data), 'Runbook created');
    if (rb) setRunbooks(prev => upsert(prev, rb, false));
    return rb;
  }, [run]);
  const updateRunbook = useCallback(async (id: string, data: Partial<Runbook>) => {
    const rb = await run(() => api.updateRunbook(id, data), 'Runbook updated');
    if (rb) setRunbooks(prev => upsert(prev, rb, false));
    return rb;
  }, [run]);
  const deleteRunbook = useCallback(async (id: string) => {
    const r = await run(() => api.deleteRunbook(id), 'Runbook deleted');
    if (r) setRunbooks(prev => prev.filter(x => x.id !== id));
    return Boolean(r);
  }, [run]);

  // ── Providers ─────────────────────────────────────────────────────────────
  const syncCloudflare = useCallback(async () => {
    const zones = await run(() => api.syncCloudflare(), 'Cloudflare synced');
    if (zones) setCloudflareZones(zones);
    setIntegrations(await api.integrations().catch(() => null));
    return Boolean(zones);
  }, [run]);
  const syncLoadBalancers = useCallback(async () => {
    const state = await run(() => api.syncLoadBalancers());
    if (state) {
      setLoadBalancer(state);
      notify(state.status === 'OK' ? 'success' : 'error', state.status === 'OK' ? 'Cloudflare load balancer state refreshed' : `Cloudflare load balancing: ${state.status}${state.lastError ? ` — ${state.lastError}` : ''}`);
    }
    return state?.status === 'OK';
  }, [run, notify]);
  const syncHostinger = useCallback(async () => {
    const vms = await run(() => api.syncHostinger(), 'Hostinger synced');
    setIntegrations(await api.integrations().catch(() => null));
    if (vms) setServers(await api.getServers());
    return Boolean(vms);
  }, [run]);

  // ── Summary ───────────────────────────────────────────────────────────────
  const openIncidentList = incidents.filter(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  const criticalIncidents = openIncidentList.filter(i => i.severity === 'CRITICAL' || i.severity === 'EMERGENCY').length;
  const healthyApps = applications.filter(a => a.status === 'HEALTHY').length;
  return (
    <OpsContext.Provider
      value={{
        applications, servers, monitors, incidents, cloudflareZones, backups, runbooks, deployments,
        maintenanceWindows, communicationChannels, escalationPolicies, auditLogs, deadMan, integrations,
        loadBalancer, syncLoadBalancers,
        isLoading, loadError, realtimeStatus, refreshAll,
        activeTab, setActiveTab, selectedAppId, setSelectedAppId, selectedServerId, setSelectedServerId,
        selectedIncidentId, setSelectedIncidentId, selectedRunbookId, setSelectedRunbookId,
        isCommandPaletteOpen, setIsCommandPaletteOpen, lastUpdatedSecondsAgo,
        acknowledgeIncident, changeIncidentStatus, changeIncidentSeverity, assignIncidentOwner, addIncidentNote, resolveIncident, createIncident,
        triggerFailover,
        runProbeCheck, runAllProbes, addMonitor, updateMonitor, deleteMonitor, toggleMonitorStatus,
        isAddMonitorModalOpen, setIsAddMonitorModalOpen, addMonitorInitialContext, openAddMonitorWithContext,
        createServer, updateServer, deleteServer, createApplication, updateApplication, deleteApplication,
        sendTestNotification, createChannel, updateChannel, deleteChannel, saveEscalationPolicies,
        createMaintenance, completeMaintenance, deleteMaintenance,
        toggleRunbookStep, resetRunbook, createRunbook, updateRunbook, deleteRunbook,
        syncCloudflare, syncHostinger,
        apiHealth, triggerHealthCheck,
        theme, setTheme, toggleTheme,
        toasts, notify, dismissToast,
        systemSummary: {
          totalApps: applications.length,
          healthyApps,
          totalServers: servers.length,
          healthyServers: servers.filter(s => s.status === 'HEALTHY').length,
          totalMonitors: monitors.length,
          healthyMonitors: monitors.filter(m => m.status === 'HEALTHY').length,
          openIncidents: openIncidentList.length,
          criticalIncidents,
          drReadinessCount: serverSummary?.drReadinessCount ?? 0,
          backupsCurrentCount: serverSummary?.backupsCurrentCount ?? 0,
          cloudflareStatus: serverSummary?.cloudflareStatus ?? 'UNKNOWN',
          // Never "OPERATIONAL" without the backend's evaluation
          overallHealth: criticalIncidents > 0 ? 'CRITICAL' : serverSummary?.overallHealth ?? 'UNKNOWN',
          generatedAt: serverSummary?.generatedAt ?? null,
          visibilityGaps: serverSummary?.visibilityGaps ?? [],
        },
      }}
    >
      {children}
    </OpsContext.Provider>
  );
};

export const useOps = () => {
  const context = useContext(OpsContext);
  if (!context) throw new Error('useOps must be used within an OpsProvider');
  return context;
};
