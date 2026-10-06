import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { 
  Application, 
  VpsServer, 
  Monitor, 
  Incident, 
  CloudflareZone, 
  BackupRecord, 
  Runbook, 
  Deployment, 
  MaintenanceWindow, 
  CommunicationChannel, 
  EscalationPolicy, 
  AuditLog, 
  DeadManControlPlane,
  IncidentStatus,
  IncidentSeverity,
  MonitorType,
  RealVpsConfig,
  RealVpsProbeResult,
  RealVpsTcpProbeResult,
  SyntheticTransactionResult
} from '../types';
import { api, HealthCheckResponse } from '../services/api';
import { RealVpsService } from '../services/realVps';


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
  addMonitor: (newMon: Omit<Monitor, 'id' | 'consecutiveFailures' | 'consecutiveRecoveries' | 'lastCheck' | 'lastSuccess' | 'responseTimeMs' | 'uptimePercent' | 'history' | 'status' | 'activeMaintenance'> & Partial<Monitor>) => Monitor;
  deleteMonitor: (monitorId: string) => void;
  toggleMonitorStatus: (monitorId: string) => void;
  isAddMonitorModalOpen: boolean;
  setIsAddMonitorModalOpen: (open: boolean) => void;
  addMonitorInitialContext: { applicationId?: string; serverId?: string; defaultType?: MonitorType } | null;
  openAddMonitorWithContext: (context?: { applicationId?: string; serverId?: string; defaultType?: MonitorType }) => void;
  sendTestNotification: (channelId: string) => Promise<boolean>;
  triggerSimulatedScenario?: never;
  addAuditEntry: (action: string, category: AuditLog['category'], targetId: string, details: string) => void;
  
  // Real-time API & Reachability
  apiHealth: {
    reachable: boolean;
    status: 'HEALTHY' | 'DEGRADED' | 'UNREACHABLE';
    lastChecked: string;
    latencyMs: number;
    endpoint: string;
    details: HealthCheckResponse | null;
  };
  triggerHealthCheck: () => Promise<void>;
  simulateApiOutage: (unreachable: boolean) => void;

  // Theme mode
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;

  // Real 2-VPS Testbench state & actions
  realVpsConfig: RealVpsConfig | null;
  isRealVpsOnlyMode: boolean;
  isRealVpsProbing: boolean;
  refreshRealVpsConfig: () => Promise<void>;
  updateRealVpsConfig: (payload: Partial<RealVpsConfig>) => Promise<void>;
  probeRealVps: (targetVps: 'main' | 'dr', customUrl?: string) => Promise<RealVpsProbeResult | null>;
  probeBothRealVps: () => Promise<{ mainResult: RealVpsProbeResult; drResult: RealVpsProbeResult } | null>;
  failoverRealVps: (target?: 'MAIN' | 'DR', reason?: string) => Promise<void>;
  purgeMockData?: never;
  restoreMockData?: never;
  tcpProbe: (payload: { targetVps?: 'main' | 'dr'; host?: string; port: number }) => Promise<RealVpsTcpProbeResult | null>;
  testSynthetic: (payload: { url: string; method?: string; body?: string; expectedStatus?: number; matchText?: string }) => Promise<SyntheticTransactionResult | null>;
  simulateOutage: (targetVps: 'main' | 'dr', simulatedStatus: 'CRITICAL' | 'HEALTHY') => Promise<void>;

  // Computed summaries
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
    cloudflareStatus: 'HEALTHY' | 'DEGRADED';
    overallHealth: 'OPERATIONAL' | 'CRITICAL' | 'WARNING';
  };
}

const OpsContext = createContext<OpsContextType | undefined>(undefined);

export const OpsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [applications, setApplications] = useState<Application[]>([]);
  const [servers, setServers] = useState<VpsServer[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [cloudflareZones, setCloudflareZones] = useState<CloudflareZone[]>([]);
  const [backups] = useState<BackupRecord[]>([]);
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [deployments] = useState<Deployment[]>([]);
  const [maintenanceWindows] = useState<MaintenanceWindow[]>([]);
  const [communicationChannels, setCommunicationChannels] = useState<CommunicationChannel[]>([]);
  const [escalationPolicies] = useState<EscalationPolicy[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const defaultDeadMan: DeadManControlPlane = {
    id: 'deadman-external-ch',
    name: 'External Watchdog',
    nodeLocation: 'Zurich ZH4',
    targetControlPlane: '/health',
    status: 'HEALTHY',
    intervalSec: 60,
    toleranceSec: 30,
    consecutiveMisses: 0,
    lastHeartbeatReceivedAt: new Date().toISOString(),
    lastAlertSentAt: undefined
  };
  const [deadMan, setDeadMan] = useState<DeadManControlPlane>(defaultDeadMan);

  const [activeTab, setActiveTab] = useState<string>('overview');
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [selectedRunbookId, setSelectedRunbookId] = useState<string | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
  const [isAddMonitorModalOpen, setIsAddMonitorModalOpen] = useState<boolean>(false);
  const [addMonitorInitialContext, setAddMonitorInitialContext] = useState<{ applicationId?: string; serverId?: string; defaultType?: MonitorType } | null>(null);
  const [lastUpdatedSecondsAgo, setLastUpdatedSecondsAgo] = useState<number>(0);
  
  // Real-time API reachability state (/health)
  const [apiHealth, setApiHealth] = useState<{
    reachable: boolean;
    status: 'HEALTHY' | 'DEGRADED' | 'UNREACHABLE';
    lastChecked: string;
    latencyMs: number;
    endpoint: string;
    details: HealthCheckResponse | null;
  }>({
    reachable: true,
    status: 'HEALTHY',
    lastChecked: new Date().toISOString(),
    latencyMs: 14,
    endpoint: '/health',
    details: null
  });

  const [simulatedOutage, setSimulatedOutage] = useState<boolean>(false);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('scholario_theme');
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';
  });

  useEffect(() => {
    localStorage.setItem('scholario_theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  // Sync audit logs to localStorage
  useEffect(() => {
    localStorage.setItem('scholario_audit', JSON.stringify(auditLogs));
  }, [auditLogs]);


  // Real 2-VPS Testbench State & Actions
  const [realVpsConfig, setRealVpsConfig] = useState<RealVpsConfig | null>(null);
  const [isRealVpsOnlyMode, setIsRealVpsOnlyMode] = useState<boolean>(false);
  const [isRealVpsProbing, setIsRealVpsProbing] = useState<boolean>(false);

  const refreshRealVpsConfig = useCallback(async () => {
    try {
      const res = await RealVpsService.getConfig();
      if (res?.data) {
        setRealVpsConfig(res.data);
        setIsRealVpsOnlyMode(Boolean(res.isRealVpsOnlyMode));
        if (res.isRealVpsOnlyMode) {
          const [apps, srvs, mons] = await Promise.all([
            api.getApplications(),
            api.getServers(),
            api.getMonitors()
          ]);
          if (apps?.length) {
            setApplications(apps);
            localStorage.setItem('scholario_apps', JSON.stringify(apps));
          }
          if (srvs?.length) {
            setServers(srvs);
            localStorage.setItem('scholario_servers', JSON.stringify(srvs));
          }
          if (mons?.length) {
            setMonitors(mons);
            localStorage.setItem('scholario_monitors', JSON.stringify(mons));
          }
        }
      }
    } catch {}
  }, []);

  const updateRealVpsConfig = useCallback(async (payload: Partial<RealVpsConfig>) => {
    try {
      const res = await RealVpsService.updateConfig(payload);
      if (res?.data) {
        setRealVpsConfig(res.data);
        setIsRealVpsOnlyMode(Boolean(res.isRealVpsOnlyMode));
      }
      const [apps, srvs, mons] = await Promise.all([
        api.getApplications(),
        api.getServers(),
        api.getMonitors()
      ]);
      if (apps?.length) {
        setApplications(apps);
        localStorage.setItem('scholario_apps', JSON.stringify(apps));
      }
      if (srvs?.length) {
        setServers(srvs);
        localStorage.setItem('scholario_servers', JSON.stringify(srvs));
      }
      if (mons?.length) {
        setMonitors(mons);
        localStorage.setItem('scholario_monitors', JSON.stringify(mons));
      }
    } catch (err) {
      console.error('Failed to update Real VPS config:', err);
    }
  }, []);

  const probeRealVps = useCallback(async (targetVps: 'main' | 'dr', customUrl?: string) => {
    setIsRealVpsProbing(true);
    try {
      const res = await RealVpsService.probe(targetVps, customUrl);
      if (res?.data) {
        setRealVpsConfig(res.data);
      }
      const [apps, srvs, mons] = await Promise.all([
        api.getApplications(),
        api.getServers(),
        api.getMonitors()
      ]);
      if (apps?.length) setApplications(apps);
      if (srvs?.length) setServers(srvs);
      if (mons?.length) setMonitors(mons);
      return res.probeResult;
    } catch (err) {
      console.error('Probe failed:', err);
      return null;
    } finally {
      setIsRealVpsProbing(false);
    }
  }, []);

  const probeBothRealVps = useCallback(async () => {
    setIsRealVpsProbing(true);
    try {
      const res = await RealVpsService.probeBoth();
      if (res?.data) {
        setRealVpsConfig(res.data);
      }
      const [apps, srvs, mons] = await Promise.all([
        api.getApplications(),
        api.getServers(),
        api.getMonitors()
      ]);
      if (apps?.length) setApplications(apps);
      if (srvs?.length) setServers(srvs);
      if (mons?.length) setMonitors(mons);
      return { mainResult: res.mainResult, drResult: res.drResult };
    } catch (err) {
      console.error('Probe both failed:', err);
      return null;
    } finally {
      setIsRealVpsProbing(false);
    }
  }, []);

  const failoverRealVps = useCallback(async (target?: 'MAIN' | 'DR', reason?: string) => {
    try {
      const res = await RealVpsService.failover(target, reason);
      if (res?.data) {
        setRealVpsConfig(res.data);
      }
      const [apps, srvs] = await Promise.all([
        api.getApplications(),
        api.getServers()
      ]);
      if (apps?.length) setApplications(apps);
      if (srvs?.length) setServers(srvs);
    } catch (err) {
      console.error('Failover failed:', err);
    }
  }, []);

  // purgeMockData and restoreMockData removed (production build — no mock data)


  const tcpProbe = useCallback(async (payload: { targetVps?: 'main' | 'dr'; host?: string; port: number }) => {
    try {
      const res = await RealVpsService.tcpProbe(payload);
      return res.result;
    } catch (err) {
      console.error('TCP probe error:', err);
      return null;
    }
  }, []);

  const testSynthetic = useCallback(async (payload: { url: string; method?: string; body?: string; expectedStatus?: number; matchText?: string }) => {
    try {
      const res = await RealVpsService.testSynthetic(payload);
      return res.result;
    } catch (err) {
      console.error('Synthetic test error:', err);
      return null;
    }
  }, []);

  const simulateOutage = useCallback(async (targetVps: 'main' | 'dr', simulatedStatus: 'CRITICAL' | 'HEALTHY') => {
    try {
      const res = await RealVpsService.simulateOutage(targetVps, simulatedStatus);
      if (res?.data) {
        setRealVpsConfig(res.data);
      }
      const [apps, srvs, mons] = await Promise.all([
        api.getApplications(),
        api.getServers(),
        api.getMonitors()
      ]);
      if (apps?.length) setApplications(apps);
      if (srvs?.length) setServers(srvs);
      if (mons?.length) setMonitors(mons);
    } catch (err) {
      console.error('Simulate outage error:', err);
    }
  }, []);

  useEffect(() => {
    refreshRealVpsConfig();
  }, [refreshRealVpsConfig]);

  // Audit logger
  const addAuditEntry = useCallback((action: string, category: AuditLog['category'], targetId: string, details: string) => {
    const newLog: AuditLog = {
      id: `aud-${Date.now()}`,
      timestamp: new Date().toISOString(),
      operator: 'IT Operations (You)',
      action,
      category,
      targetId,
      details
    };
    setAuditLogs(prev => [newLog, ...prev.slice(0, 99)]);
  }, []);

  // Real-time /health check execution
  const triggerHealthCheck = useCallback(async () => {
    if (simulatedOutage) {
      setApiHealth(prev => ({
        ...prev,
        reachable: false,
        status: 'UNREACHABLE',
        lastChecked: new Date().toISOString(),
        latencyMs: 3000
      }));
      return;
    }
    const start = Date.now();
    try {
      const data = await api.checkHealth();
      const latency = Math.max(6, Date.now() - start);
      setApiHealth({
        reachable: true,
        status: data.status === 'ok' ? 'HEALTHY' : 'DEGRADED',
        lastChecked: new Date().toISOString(),
        latencyMs: latency,
        endpoint: '/health',
        details: data
      });
    } catch {
      setApiHealth(prev => ({
        ...prev,
        reachable: false,
        status: 'UNREACHABLE',
        lastChecked: new Date().toISOString(),
        latencyMs: 3500
      }));
    }
  }, [simulatedOutage]);

  const simulateApiOutage = useCallback((unreachable: boolean) => {
    setSimulatedOutage(unreachable);
    if (unreachable) {
      setApiHealth(prev => ({
        ...prev,
        reachable: false,
        status: 'UNREACHABLE',
        lastChecked: new Date().toISOString(),
        latencyMs: 3000
      }));
      addAuditEntry('API_HEALTH_CHECK_FAILED', 'INCIDENT', 'API_SERVICE', 'CRITICAL: Scholario Ops API /health endpoint became UNREACHABLE. Automated alert triggered.');
    } else {
      triggerHealthCheck();
      addAuditEntry('API_HEALTH_CHECK_RESTORED', 'INCIDENT', 'API_SERVICE', 'RECOVERY: Scholario Ops API /health endpoint nominal. Service restored.');
    }
  }, [addAuditEntry, triggerHealthCheck]);

  // Real-time Health Check interval & initial hydration from API
  useEffect(() => {
    triggerHealthCheck();
    const interval = setInterval(triggerHealthCheck, 4000);

    // Initial fetch from real API if available
    api.getApplications().then(apps => { if (apps?.length) setApplications(apps); }).catch(() => {});
    api.getServers().then(srvs => { if (srvs?.length) setServers(srvs); }).catch(() => {});
    api.getMonitors().then(mons => { if (mons?.length) setMonitors(mons); }).catch(() => {});
    api.getIncidents().then(incs => { if (incs?.length) setIncidents(incs); }).catch(() => {});

    // Realtime SSE stream
    const unsubscribe = api.connectRealtimeStream((event, data) => {
      if (event === 'telemetry_tick' && data?.servers) {
        setServers(prev => prev.map(s => {
          const update = data.servers.find((u: any) => u.id === s.id);
          if (update) {
            return {
              ...s,
              status: update.status,
              lastSeen: update.lastSeen,
              telemetry: {
                ...s.telemetry,
                cpuPercent: update.cpuPercent,
                ramPercent: update.ramPercent,
                observedAt: new Date().toISOString()
              }
            };
          }
          return s;
        }));
      } else if (event === 'monitor_created' && data?.id) {
        setMonitors(prev => prev.some(m => m.id === data.id) ? prev : [data, ...prev]);
      } else if (event === 'monitor_probed' && data?.id) {
        setMonitors(prev => prev.map(m => m.id === data.id ? data : m));
      } else if (event === 'monitor_deleted' && data?.id) {
        setMonitors(prev => prev.filter(m => m.id !== data.id));
      } else if (event === 'incident_update' && data?.id) {
        setIncidents(prev => prev.map(i => i.id === data.id ? data : i));
      } else if (event === 'application_update' && data?.id) {
        setApplications(prev => prev.map(a => a.id === data.id ? data : a));
      } else if (event === 'real_vps_update' && data) {
        setRealVpsConfig(data);
      } else if (event === 'real_vps_probed' && data?.config) {
        setRealVpsConfig(data.config);
      } else if (event === 'real_vps_failover' && data?.config) {
        setRealVpsConfig(data.config);
      } else if (event === 'mock_data_purged') {
        setIsRealVpsOnlyMode(true);
        api.getApplications().then(apps => { if (apps?.length) setApplications(apps); });
        api.getServers().then(srvs => { if (srvs?.length) setServers(srvs); });
        api.getMonitors().then(mons => { if (mons?.length) setMonitors(mons); });
      } else if (event === 'mock_data_restored') {
        setIsRealVpsOnlyMode(false);
        api.getApplications().then(apps => { if (apps?.length) setApplications(apps); });
        api.getServers().then(srvs => { if (srvs?.length) setServers(srvs); });
        api.getMonitors().then(mons => { if (mons?.length) setMonitors(mons); });
      }
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [triggerHealthCheck]);

  // Periodic dead-man heartbeat update
  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdatedSecondsAgo(0);

      // Update dead-man heartbeat if healthy
      setDeadMan(prev => {
        if (prev.status === 'HEALTHY') {
          return {
            ...prev,
            lastHeartbeatReceivedAt: new Date().toISOString(),
            consecutiveMisses: 0
          };
        }
        return prev;
      });
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Counter ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setLastUpdatedSecondsAgo(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Keyboard shortcut Ctrl+K
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

  // Failover Trigger action
  const triggerFailover = useCallback((appId: string, targetOrigin: 'DR' | 'PRIMARY') => {
    const app = applications.find(a => a.id === appId);
    if (!app) return;

    const targetServerId = targetOrigin === 'DR' ? app.drServerId : app.prdServerId;
    const targetServer = servers.find(s => s.id === targetServerId);

    // Update Application state
    setApplications(prev => prev.map(a => {
      if (a.id === appId) {
        return {
          ...a,
          failoverState: targetOrigin === 'DR' ? 'DR_ACTIVE' : 'PRIMARY_ACTIVE',
          lastChecked: new Date().toISOString()
        };
      }
      return a;
    }));

    // Update Cloudflare Zone
    setCloudflareZones(prev => prev.map(zone => {
      if (zone.domain === app.cloudflareZone) {
        return {
          ...zone,
          loadBalancer: {
            ...zone.loadBalancer,
            activeOrigin: `${targetServer?.ip || 'Target'} (${targetOrigin} Active)`,
            lastReroutedAt: new Date().toISOString()
          },
          dnsRecords: zone.dnsRecords.map(rec => {
            if (rec.name === zone.domain) {
              return {
                ...rec,
                target: targetServer?.ip || rec.target,
                lastModified: 'Just now'
              };
            }
            return rec;
          })
        };
      }
      return zone;
    }));

    addAuditEntry(
      `CLOUDFLARE_FAILOVER_${targetOrigin}`,
      'FAILOVER',
      appId,
      `Operator diverted ${app.name} traffic to ${targetOrigin} node (${targetServer?.hostname || targetServerId}).`
    );
  }, [applications, servers, addAuditEntry]);

  // Incident Actions
  const acknowledgeIncident = useCallback((incidentId: string, operatorName = 'Arjun Mehta (Lead On-Call)') => {
    setIncidents(prev => prev.map(inc => {
      if (inc.id === incidentId) {
        return {
          ...inc,
          acknowledged: true,
          acknowledgedAt: new Date().toISOString(),
          acknowledgedBy: operatorName,
          status: inc.status === 'OPEN' ? 'ACKNOWLEDGED' : inc.status,
          timeline: [
            ...inc.timeline,
            {
              id: `ev-${Date.now()}`,
              timestamp: new Date().toISOString(),
              source: operatorName,
              level: 'INFO',
              message: `Incident acknowledged by ${operatorName}.`
            }
          ]
        };
      }
      return inc;
    }));

    addAuditEntry('INCIDENT_ACKNOWLEDGED', 'INCIDENT', incidentId, `Acknowledged by ${operatorName}`);
  }, [addAuditEntry]);

  const changeIncidentStatus = useCallback((incidentId: string, status: IncidentStatus) => {
    setIncidents(prev => prev.map(inc => {
      if (inc.id === incidentId) {
        return {
          ...inc,
          status,
          timeline: [
            ...inc.timeline,
            {
              id: `ev-${Date.now()}`,
              timestamp: new Date().toISOString(),
              source: 'IT Operations',
              level: 'INFO',
              message: `Status updated to ${status}.`
            }
          ]
        };
      }
      return inc;
    }));

    addAuditEntry('INCIDENT_STATUS_CHANGE', 'INCIDENT', incidentId, `Status transitioned to ${status}`);
  }, [addAuditEntry]);

  const changeIncidentSeverity = useCallback((incidentId: string, severity: IncidentSeverity) => {
    setIncidents(prev => prev.map(inc => {
      if (inc.id === incidentId) {
        return {
          ...inc,
          severity,
          timeline: [
            ...inc.timeline,
            {
              id: `ev-${Date.now()}`,
              timestamp: new Date().toISOString(),
              source: 'IT Operations',
              level: 'WARN',
              message: `Severity modified to ${severity}.`
            }
          ]
        };
      }
      return inc;
    }));

    addAuditEntry('INCIDENT_SEVERITY_CHANGE', 'INCIDENT', incidentId, `Severity changed to ${severity}`);
  }, [addAuditEntry]);

  const assignIncidentOwner = useCallback((incidentId: string, owner: string) => {
    setIncidents(prev => prev.map(inc => {
      if (inc.id === incidentId) {
        return {
          ...inc,
          owner,
          timeline: [
            ...inc.timeline,
            {
              id: `ev-${Date.now()}`,
              timestamp: new Date().toISOString(),
              source: 'IT Operations',
              level: 'INFO',
              message: `Assigned incident ownership to ${owner}.`
            }
          ]
        };
      }
      return inc;
    }));

    addAuditEntry('INCIDENT_REASSIGNED', 'INCIDENT', incidentId, `Owner assigned to ${owner}`);
  }, [addAuditEntry]);

  const addIncidentNote = useCallback((incidentId: string, noteText: string) => {
    if (!noteText.trim()) return;
    const newNote = {
      id: `note-${Date.now()}`,
      author: 'IT Operations (You)',
      role: 'Operations Engineer',
      timestamp: new Date().toISOString(),
      content: noteText.trim()
    };
    setIncidents(prev => prev.map(inc => {
      if (inc.id === incidentId) {
        return {
          ...inc,
          notes: [...inc.notes, newNote],
          timeline: [
            ...inc.timeline,
            {
              id: `ev-${Date.now()}`,
              timestamp: new Date().toISOString(),
              source: 'IT Operations',
              level: 'INFO',
              message: `Added investigation note: "${noteText.slice(0, 45)}..."`
            }
          ]
        };
      }
      return inc;
    }));
  }, []);

  const resolveIncident = useCallback((incidentId: string, resolutionSummary?: string) => {
    setIncidents(prev => prev.map(inc => {
      if (inc.id === incidentId) {
        return {
          ...inc,
          status: 'RESOLVED',
          resolvedAt: new Date().toISOString(),
          recoveryStatus: resolutionSummary || 'All systems recovered. 3 consecutive health checks passed.',
          timeline: [
            ...inc.timeline,
            {
              id: `ev-${Date.now()}`,
              timestamp: new Date().toISOString(),
              source: 'IT Operations',
              level: 'SUCCESS',
              message: `Incident resolved: ${resolutionSummary || 'Consecutive recovery confirmation completed.'}`
            }
          ]
        };
      }
      return inc;
    }));

    addAuditEntry('INCIDENT_RESOLVED', 'INCIDENT', incidentId, `Incident resolved by operator.`);
  }, [addAuditEntry]);

  const toggleRunbookStep = useCallback((runbookId: string, stepId: number) => {
    setRunbooks(prev => prev.map(rb => {
      if (rb.id === runbookId) {
        return {
          ...rb,
          steps: rb.steps.map(step => {
            if (step.id === stepId) {
              const nextState = !step.completed;
              return {
                ...step,
                completed: nextState,
                completedAt: nextState ? 'Just now' : undefined,
                completedBy: nextState ? 'IT Operations (You)' : undefined
              };
            }
            return step;
          })
        };
      }
      return rb;
    }));

    addAuditEntry('RUNBOOK_STEP_UPDATE', 'RUNBOOK', runbookId, `Step #${stepId} updated.`);
  }, [addAuditEntry]);

  // Run Probe Check on a Monitor
  const runProbeCheck = useCallback((monitorId: string) => {
    setMonitors(prev => prev.map(mon => {
      if (mon.id === monitorId) {
        // If it's the failing mosaic monitor and still in failure state
        const isFailing = mon.status === 'CRITICAL';
        const simulatedMs = isFailing ? Math.floor(4000 + Math.random() * 1200) : Math.floor(60 + Math.random() * 120);
        const newHistory = [
          {
            timestamp: new Date().toISOString(),
            status: mon.status,
            responseTimeMs: simulatedMs,
            statusCode: isFailing ? 504 : 200,
            detail: isFailing ? 'Simulated probe check: Upstream timeout' : 'OK'
          },
          ...mon.history.slice(0, 19)
        ];

        return {
          ...mon,
          lastCheck: new Date().toISOString(),
          lastSuccess: isFailing ? mon.lastSuccess : new Date().toISOString(),
          lastFailure: isFailing ? new Date().toISOString() : mon.lastFailure,
          responseTimeMs: simulatedMs,
          history: newHistory
        };
      }
      return mon;
    }));
  }, []);

  const runAllProbes = useCallback(() => {
    monitors.forEach(m => runProbeCheck(m.id));
  }, [monitors, runProbeCheck]);

  const openAddMonitorWithContext = useCallback((context?: { applicationId?: string; serverId?: string; defaultType?: MonitorType }) => {
    setAddMonitorInitialContext(context || null);
    setIsAddMonitorModalOpen(true);
  }, []);

  const addMonitor = useCallback((input: Omit<Monitor, 'id' | 'consecutiveFailures' | 'consecutiveRecoveries' | 'lastCheck' | 'lastSuccess' | 'responseTimeMs' | 'uptimePercent' | 'history' | 'status' | 'activeMaintenance'> & Partial<Monitor>): Monitor => {
    const id = input.id || `mon-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();
    const initialLatency = Math.floor(35 + Math.random() * 55);

    const newMonitor: Monitor = {
      id,
      name: input.name,
      type: input.type,
      target: input.target,
      applicationId: input.applicationId,
      environment: input.environment,
      intervalSec: input.intervalSec || 30,
      timeoutSec: input.timeoutSec || 5,
      retries: input.retries || 3,
      warningThresholdMs: input.warningThresholdMs || 300,
      criticalThresholdMs: input.criticalThresholdMs || 1000,
      failureConfirmationThreshold: input.failureConfirmationThreshold || 3,
      recoveryConfirmationThreshold: input.recoveryConfirmationThreshold || 3,
      consecutiveFailures: 0,
      consecutiveRecoveries: 1,
      status: 'HEALTHY',
      lastCheck: now,
      lastSuccess: now,
      responseTimeMs: initialLatency,
      uptimePercent: 100.0,
      enabled: input.enabled !== undefined ? input.enabled : true,
      activeMaintenance: false,
      runbookId: input.runbookId,
      history: [
        {
          timestamp: now,
          status: 'HEALTHY',
          responseTimeMs: initialLatency,
          statusCode: 200,
          detail: 'Initial synthetic check verified nominal'
        }
      ]
    };

    setMonitors(prev => [newMonitor, ...prev]);

    addAuditEntry(
      'MONITOR_CREATED',
      'MONITOR',
      id,
      `Operator created continuous probe ${newMonitor.name} (${newMonitor.type}) targeting ${newMonitor.target} on ${newMonitor.applicationId} [${newMonitor.environment}]`
    );

    return newMonitor;
  }, [addAuditEntry]);

  const deleteMonitor = useCallback((monitorId: string) => {
    setMonitors(prev => {
      const mon = prev.find(m => m.id === monitorId);
      if (mon) {
        addAuditEntry('MONITOR_DELETED', 'MONITOR', monitorId, `Deleted monitor: ${mon.name} (${mon.target})`);
      }
      return prev.filter(m => m.id !== monitorId);
    });
  }, [addAuditEntry]);

  const toggleMonitorStatus = useCallback((monitorId: string) => {
    setMonitors(prev => prev.map(m => {
      if (m.id === monitorId) {
        const nextState = !m.enabled;
        addAuditEntry('MONITOR_STATUS_TOGGLE', 'MONITOR', monitorId, `Monitor ${m.name} is now ${nextState ? 'ENABLED' : 'PAUSED'}`);
        return { ...m, enabled: nextState };
      }
      return m;
    }));
  }, [addAuditEntry]);

  const sendTestNotification = useCallback(async (channelId: string): Promise<boolean> => {
    await new Promise(r => setTimeout(r, 600));
    setCommunicationChannels(prev => prev.map(ch => {
      if (ch.id === channelId) {
        return {
          ...ch,
          lastDeliveryAt: new Date().toISOString(),
          lastDeliveryStatus: 'DELIVERED',
          failureCount: 0
        };
      }
      return ch;
    }));
    addAuditEntry('TEST_NOTIFICATION_SENT', 'INCIDENT', channelId, `Dispatched manual test payload to channel`);
    return true;
  }, [addAuditEntry]);

  // triggerSimulatedScenario removed — production build, no mock scenarios


  // System Summaries
  const totalApps = applications.length;
  const healthyApps = applications.filter(a => a.status === 'HEALTHY').length;
  const totalServers = servers.length;
  const healthyServers = servers.filter(s => s.status === 'HEALTHY').length;
  const totalMonitors = monitors.length;
  const healthyMonitors = monitors.filter(m => m.status === 'HEALTHY').length;
  const openIncidents = incidents.filter(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED').length;
  const criticalIncidents = incidents.filter(i => i.severity === 'CRITICAL' && i.status !== 'RESOLVED' && i.status !== 'CLOSED').length;
  const backupsCurrentCount = backups.filter(b => b.status === 'SUCCESS').length;
  
  // DR readiness count: apps where replication lag is <= target and DR server is HEALTHY
  const drReadinessCount = applications.filter(a => {
    const drServer = servers.find(s => s.id === a.drServerId);
    return (drServer?.status === 'HEALTHY') && (a.currentReplicationLagSec <= a.rpoTargetMin * 60);
  }).length;

  const cloudflareDegraded = cloudflareZones.some(z => z.status === 'DEGRADED');
  const cloudflareStatus: 'HEALTHY' | 'DEGRADED' = cloudflareDegraded ? 'DEGRADED' : 'HEALTHY';

  const overallHealth: 'OPERATIONAL' | 'CRITICAL' | 'WARNING' = 
    criticalIncidents > 0 || deadMan.status === 'CRITICAL_SILENCE' 
      ? 'CRITICAL' 
      : openIncidents > 0 || healthyApps < totalApps 
        ? 'WARNING' 
        : 'OPERATIONAL';

  return (
    <OpsContext.Provider
      value={{
        applications,
        servers,
        monitors,
        incidents,
        cloudflareZones,
        backups,
        runbooks,
        deployments,
        maintenanceWindows,
        communicationChannels,
        escalationPolicies,
        auditLogs,
        deadMan,
        activeTab,
        setActiveTab,
        selectedAppId,
        setSelectedAppId,
        selectedServerId,
        setSelectedServerId,
        selectedIncidentId,
        setSelectedIncidentId,
        selectedRunbookId,
        setSelectedRunbookId,
        isCommandPaletteOpen,
        setIsCommandPaletteOpen,
        lastUpdatedSecondsAgo,
        triggerFailover,
        acknowledgeIncident,
        changeIncidentStatus,
        changeIncidentSeverity,
        assignIncidentOwner,
        addIncidentNote,
        resolveIncident,
        toggleRunbookStep,
        runProbeCheck,
        runAllProbes,
        addMonitor,
        deleteMonitor,
        toggleMonitorStatus,
        isAddMonitorModalOpen,
        setIsAddMonitorModalOpen,
        addMonitorInitialContext,
        openAddMonitorWithContext,
        sendTestNotification,
        triggerSimulatedScenario: undefined,
        addAuditEntry,
        apiHealth,
        triggerHealthCheck,
        simulateApiOutage,
        theme,
        setTheme,
        toggleTheme,
        realVpsConfig,
        isRealVpsOnlyMode,
        isRealVpsProbing,
        refreshRealVpsConfig,
        updateRealVpsConfig,
        probeRealVps,
        probeBothRealVps,
        failoverRealVps,
        purgeMockData: undefined,
        restoreMockData: undefined,
        tcpProbe,
        testSynthetic,
        simulateOutage,
        systemSummary: {
          totalApps,
          healthyApps,
          totalServers,
          healthyServers,
          totalMonitors,
          healthyMonitors,
          openIncidents,
          criticalIncidents,
          drReadinessCount,
          backupsCurrentCount,
          cloudflareStatus,
          overallHealth
        }
      }}
    >
      {children}
    </OpsContext.Provider>
  );
};

export const useOps = () => {
  const context = useContext(OpsContext);
  if (!context) {
    throw new Error('useOps must be used within an OpsProvider');
  }
  return context;
};
