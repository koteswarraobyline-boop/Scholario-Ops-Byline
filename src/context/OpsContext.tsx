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
  OperationalStatus
} from '../types';
import { 
  INITIAL_APPLICATIONS, 
  INITIAL_SERVERS, 
  INITIAL_MONITORS, 
  INITIAL_INCIDENTS, 
  INITIAL_CLOUDFLARE_ZONES, 
  INITIAL_BACKUPS, 
  INITIAL_RUNBOOKS, 
  INITIAL_DEPLOYMENTS, 
  INITIAL_MAINTENANCE_WINDOWS, 
  INITIAL_COMM_CHANNELS, 
  INITIAL_ESCALATION_POLICIES, 
  INITIAL_AUDIT_LOGS, 
  INITIAL_DEAD_MAN 
} from '../data/initialData';

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
  sendTestNotification: (channelId: string) => Promise<boolean>;
  triggerSimulatedScenario: (scenario: 'RESOLVE_MOSAIC' | 'TRIGGER_MOSAIC_FAIL' | 'FAIL_CIPHER_DB' | 'DEADMAN_SILENCE' | 'RESET_ALL') => void;
  addAuditEntry: (action: string, category: AuditLog['category'], targetId: string, details: string) => void;
  
  // Theme mode
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;

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
  const [applications, setApplications] = useState<Application[]>(() => {
    const saved = localStorage.getItem('scholario_apps');
    return saved ? JSON.parse(saved) : INITIAL_APPLICATIONS;
  });

  const [servers, setServers] = useState<VpsServer[]>(() => {
    const saved = localStorage.getItem('scholario_servers');
    return saved ? JSON.parse(saved) : INITIAL_SERVERS;
  });

  const [monitors, setMonitors] = useState<Monitor[]>(() => {
    const saved = localStorage.getItem('scholario_monitors');
    return saved ? JSON.parse(saved) : INITIAL_MONITORS;
  });

  const [incidents, setIncidents] = useState<Incident[]>(() => {
    const saved = localStorage.getItem('scholario_incidents');
    return saved ? JSON.parse(saved) : INITIAL_INCIDENTS;
  });

  const [cloudflareZones, setCloudflareZones] = useState<CloudflareZone[]>(() => {
    const saved = localStorage.getItem('scholario_cf');
    return saved ? JSON.parse(saved) : INITIAL_CLOUDFLARE_ZONES;
  });

  const [backups] = useState<BackupRecord[]>(INITIAL_BACKUPS);
  const [runbooks, setRunbooks] = useState<Runbook[]>(INITIAL_RUNBOOKS);
  const [deployments] = useState<Deployment[]>(INITIAL_DEPLOYMENTS);
  const [maintenanceWindows] = useState<MaintenanceWindow[]>(INITIAL_MAINTENANCE_WINDOWS);
  const [communicationChannels, setCommunicationChannels] = useState<CommunicationChannel[]>(INITIAL_COMM_CHANNELS);
  const [escalationPolicies] = useState<EscalationPolicy[]>(INITIAL_ESCALATION_POLICIES);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => {
    const saved = localStorage.getItem('scholario_audit');
    return saved ? JSON.parse(saved) : INITIAL_AUDIT_LOGS;
  });
  const [deadMan, setDeadMan] = useState<DeadManControlPlane>(INITIAL_DEAD_MAN);

  const [activeTab, setActiveTab] = useState<string>('overview');
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [selectedRunbookId, setSelectedRunbookId] = useState<string | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
  const [lastUpdatedSecondsAgo, setLastUpdatedSecondsAgo] = useState<number>(0);
  
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

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem('scholario_apps', JSON.stringify(applications));
  }, [applications]);

  useEffect(() => {
    localStorage.setItem('scholario_servers', JSON.stringify(servers));
  }, [servers]);

  useEffect(() => {
    localStorage.setItem('scholario_monitors', JSON.stringify(monitors));
  }, [monitors]);

  useEffect(() => {
    localStorage.setItem('scholario_incidents', JSON.stringify(incidents));
  }, [incidents]);

  useEffect(() => {
    localStorage.setItem('scholario_cf', JSON.stringify(cloudflareZones));
  }, [cloudflareZones]);

  useEffect(() => {
    localStorage.setItem('scholario_audit', JSON.stringify(auditLogs));
  }, [auditLogs]);

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

  // Periodic Telemetry Simulation & Dead-man heartbeat
  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdatedSecondsAgo(0);

      // Jitter telemetry slightly for realism
      setServers(prev => prev.map(srv => {
        if (srv.status === 'CRITICAL') {
          return {
            ...srv,
            lastSeen: new Date().toISOString(),
            telemetry: {
              ...srv.telemetry,
              cpuPercent: Math.min(99, Math.max(90, srv.telemetry.cpuPercent + (Math.random() * 2 - 1))),
              ramPercent: Math.min(98, Math.max(92, srv.telemetry.ramPercent + (Math.random() * 1.5 - 0.75))),
              observedAt: new Date(Date.now() - 2000).toISOString(),
              receivedAt: new Date().toISOString()
            }
          };
        }
        const cpuDelta = (Math.random() * 4 - 2);
        const ramDelta = (Math.random() * 1 - 0.5);
        return {
          ...srv,
          lastSeen: new Date().toISOString(),
          telemetry: {
            ...srv.telemetry,
            cpuPercent: Math.max(8, Math.min(65, +(srv.telemetry.cpuPercent + cpuDelta).toFixed(1))),
            ramPercent: Math.max(20, Math.min(75, +(srv.telemetry.ramPercent + ramDelta).toFixed(1))),
            observedAt: new Date(Date.now() - 3000).toISOString(),
            receivedAt: new Date().toISOString()
          }
        };
      }));

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

  // Simulator scenarios
  const triggerSimulatedScenario = useCallback((scenario: 'RESOLVE_MOSAIC' | 'TRIGGER_MOSAIC_FAIL' | 'FAIL_CIPHER_DB' | 'DEADMAN_SILENCE' | 'RESET_ALL') => {
    if (scenario === 'RESET_ALL') {
      localStorage.clear();
      setApplications(INITIAL_APPLICATIONS);
      setServers(INITIAL_SERVERS);
      setMonitors(INITIAL_MONITORS);
      setIncidents(INITIAL_INCIDENTS);
      setCloudflareZones(INITIAL_CLOUDFLARE_ZONES);
      setDeadMan(INITIAL_DEAD_MAN);
      addAuditEntry('STATE_RESET', 'INFRASTRUCTURE', 'SYSTEM', 'Reset state to default baseline.');
      return;
    }

    if (scenario === 'RESOLVE_MOSAIC') {
      // 1. Recover VPS
      setServers(prev => prev.map(s => {
        if (s.id === 'vps-sg-mosa-prd-01') {
          return {
            ...s,
            status: 'HEALTHY',
            telemetry: {
              ...s.telemetry,
              cpuPercent: 32.5,
              ramPercent: 54.0,
              loadAvg: [1.2, 1.1, 0.9]
            },
            services: s.services.map(svc => ({ ...svc, status: 'active' as const }))
          };
        }
        return s;
      }));

      // 2. Recover Monitors with 3 consecutive recoveries
      setMonitors(prev => prev.map(m => {
        if (m.applicationId === 'app-mosaic') {
          return {
            ...m,
            status: 'HEALTHY',
            consecutiveFailures: 0,
            consecutiveRecoveries: 3,
            responseTimeMs: 140,
            lastSuccess: new Date().toISOString()
          };
        }
        return m;
      }));

      // 3. Mark Application healthy and revert failover
      setApplications(prev => prev.map(a => {
        if (a.id === 'app-mosaic') {
          return {
            ...a,
            status: 'HEALTHY',
            failoverState: 'PRIMARY_ACTIVE',
            errorRatePercent: 0.02,
            p50Ms: 140,
            p95Ms: 290,
            p99Ms: 420,
            dependencies: a.dependencies.map(d => ({ ...d, status: 'HEALTHY' as OperationalStatus, latencyMs: 2.4 }))
          };
        }
        return a;
      }));

      // 4. Resolve incident
      resolveIncident('INC-1042', 'Database pool flushed and slow query terminated. 3 consecutive monitor passes verified.');

      // 5. Cloudflare back to primary
      setCloudflareZones(prev => prev.map(z => {
        if (z.id === 'cf-mosaic') {
          return {
            ...z,
            status: 'ACTIVE',
            loadBalancer: {
              ...z.loadBalancer,
              healthCheckStatus: 'HEALTHY',
              activeOrigin: '185.193.125.107 (PRD Active)'
            }
          };
        }
        return z;
      }));

      addAuditEntry('SIMULATION_RESOLVED_MOSAIC', 'INCIDENT', 'INC-1042', 'Simulated recovery sequence with consecutive check confirmation.');
    }

    if (scenario === 'TRIGGER_MOSAIC_FAIL') {
      // Re-trigger the mosaic fail state
      setServers(prev => prev.map(s => {
        if (s.id === 'vps-sg-mosa-prd-01') {
          return {
            ...s,
            status: 'CRITICAL',
            telemetry: {
              ...s.telemetry,
              cpuPercent: 98.4,
              ramPercent: 96.1,
              loadAvg: [19.2, 15.4, 11.2]
            }
          };
        }
        return s;
      }));

      setMonitors(prev => prev.map(m => {
        if (m.applicationId === 'app-mosaic') {
          return {
            ...m,
            status: 'CRITICAL',
            consecutiveFailures: 3,
            consecutiveRecoveries: 0,
            responseTimeMs: 5000,
            lastFailure: new Date().toISOString()
          };
        }
        return m;
      }));

      setApplications(prev => prev.map(a => {
        if (a.id === 'app-mosaic') {
          return {
            ...a,
            status: 'CRITICAL',
            failoverState: 'DR_ACTIVE',
            errorRatePercent: 14.5
          };
        }
        return a;
      }));

      setIncidents(prev => {
        const existing = prev.find(i => i.id === 'INC-1042');
        if (existing) {
          return prev.map(i => i.id === 'INC-1042' ? { ...i, status: 'INVESTIGATING' } : i);
        }
        return [...INITIAL_INCIDENTS, ...prev];
      });

      addAuditEntry('SIMULATION_FAIL_TRIGGERED', 'INCIDENT', 'app-mosaic', 'Triggered MySQL pool exhaustion failure scenario.');
    }

    if (scenario === 'DEADMAN_SILENCE') {
      setDeadMan(prev => ({
        ...prev,
        status: prev.status === 'HEALTHY' ? 'CRITICAL_SILENCE' : 'HEALTHY',
        lastAlertSentAt: new Date().toISOString(),
        consecutiveMisses: prev.status === 'HEALTHY' ? 4 : 0
      }));
      addAuditEntry('DEADMAN_TOGGLED', 'MONITOR', 'deadman-external-ch', 'Toggled independent external watchdog dead-man state.');
    }
  }, [resolveIncident, addAuditEntry]);

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
        sendTestNotification,
        triggerSimulatedScenario,
        addAuditEntry,
        theme,
        setTheme,
        toggleTheme,
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
