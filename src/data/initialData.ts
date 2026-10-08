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
  DeadManControlPlane 
} from '../types';

export const INITIAL_APPLICATIONS: Application[] = [
  {
    id: 'app-real-workload',
    name: 'Production 2-VPS Application',
    codeName: 'production-workload',
    description: 'Node.js / Express API across VPS 1 - MAIN (72.61.239.86:6423) and VPS 2 - DR (187.126.112.188:6423)',
    tier: 'TIER_1',
    status: 'UNKNOWN',
    uptime24h: 100.0,
    uptime7d: 100.0,
    uptime30d: 100.0,
    rtoTargetMin: 15,
    rpoTargetMin: 5,
    currentReplicationLagSec: 0,
    prdServerId: 'vps-real-main',
    drServerId: 'vps-real-dr',
    failoverState: 'PRIMARY_ACTIVE',
    p50Ms: 0,
    p95Ms: 0,
    p99Ms: 0,
    errorRatePercent: 0.0,
    lastChecked: new Date().toISOString(),
    cloudflareZone: '72.61.239.86',
    recentDeploymentVersion: 'v1.0.0',
    lastTestedRecoveryDate: 'N/A',
    lastTestedRecoveryDurationMin: 0,
    dependencies: [
      {
        id: 'dep-real-main',
        name: 'VPS 1 - MAIN (/api/health)',
        type: 'EXTERNAL_API',
        status: 'UNKNOWN',
        latencyMs: 0,
        lastChecked: new Date().toISOString(),
        target: 'http://72.61.239.86:6423/api/health'
      },
      {
        id: 'dep-real-dr',
        name: 'VPS 2 - DR (/api/health)',
        type: 'EXTERNAL_API',
        status: 'UNKNOWN',
        latencyMs: 0,
        lastChecked: new Date().toISOString(),
        target: 'http://187.126.112.188:6423/api/health'
      }
    ]
  }
];

export const INITIAL_SERVERS: VpsServer[] = [
  {
    id: 'vps-real-main',
    hostname: '72.61.239.86',
    ip: '72.61.239.86',
    applicationId: 'app-real-workload',
    environment: 'PRD',
    provider: 'Hostinger',
    region: 'Singapore',
    plan: 'PRIMARY / PRODUCTION (Port 6423)',
    cpuCores: 4,
    ramGb: 16,
    diskGb: 200,
    os: 'Linux (Node.js / Express API)',
    status: 'UNKNOWN',
    agentVersion: '2.4.1',
    agentStatus: 'DISCONNECTED',
    uptimeDays: 0,
    lastSeen: new Date().toISOString(),
    telemetry: {
      cpuPercent: 0,
      ramPercent: 0,
      diskPercent: 0,
      loadAvg: [0, 0, 0],
      networkInKbps: 0,
      networkOutKbps: 0,
      observedAt: new Date().toISOString(),
      receivedAt: new Date().toISOString()
    },
    processes: [],
    services: [
      {
        name: 'node-express-api',
        status: 'active',
        version: 'Node.js / Express (Port 6423)',
        pid: 0,
        memoryMb: 0,
        cpuPercent: 0,
        lastRestart: 'N/A'
      }
    ],
    logs: []
  },
  {
    id: 'vps-real-dr',
    hostname: '187.126.112.188',
    ip: '187.126.112.188',
    applicationId: 'app-real-workload',
    environment: 'DR',
    provider: 'Hostinger',
    region: 'Frankfurt',
    plan: 'DISASTER RECOVERY / STANDBY (Port 6423)',
    cpuCores: 4,
    ramGb: 16,
    diskGb: 200,
    os: 'Linux (Node.js / Express API)',
    status: 'UNKNOWN',
    agentVersion: '2.4.1',
    agentStatus: 'DISCONNECTED',
    uptimeDays: 0,
    lastSeen: new Date().toISOString(),
    telemetry: {
      cpuPercent: 0,
      ramPercent: 0,
      diskPercent: 0,
      loadAvg: [0, 0, 0],
      networkInKbps: 0,
      networkOutKbps: 0,
      observedAt: new Date().toISOString(),
      receivedAt: new Date().toISOString()
    },
    processes: [],
    services: [
      {
        name: 'node-express-api',
        status: 'active',
        version: 'Node.js / Express (Port 6423)',
        pid: 0,
        memoryMb: 0,
        cpuPercent: 0,
        lastRestart: 'N/A'
      }
    ],
    logs: []
  }
];

export const INITIAL_MONITORS: Monitor[] = [
  {
    id: 'mon-real-main',
    name: 'VPS 1 - MAIN (/api/health)',
    type: 'HTTP',
    target: 'http://72.61.239.86:6423/api/health',
    applicationId: 'app-real-workload',
    environment: 'PRD',
    intervalSec: 15,
    timeoutSec: 6,
    retries: 3,
    warningThresholdMs: 500,
    criticalThresholdMs: 2000,
    failureConfirmationThreshold: 2,
    recoveryConfirmationThreshold: 2,
    consecutiveFailures: 0,
    consecutiveRecoveries: 0,
    status: 'UNKNOWN',
    lastCheck: new Date().toISOString(),
    lastSuccess: '',
    responseTimeMs: 0,
    uptimePercent: 100.0,
    enabled: true,
    activeMaintenance: false,
    history: []
  },
  {
    id: 'mon-real-dr',
    name: 'VPS 2 - DR (/api/health)',
    type: 'HTTP',
    target: 'http://187.126.112.188:6423/api/health',
    applicationId: 'app-real-workload',
    environment: 'DR',
    intervalSec: 15,
    timeoutSec: 6,
    retries: 3,
    warningThresholdMs: 500,
    criticalThresholdMs: 2000,
    failureConfirmationThreshold: 2,
    recoveryConfirmationThreshold: 2,
    consecutiveFailures: 0,
    consecutiveRecoveries: 0,
    status: 'UNKNOWN',
    lastCheck: new Date().toISOString(),
    lastSuccess: '',
    responseTimeMs: 0,
    uptimePercent: 100.0,
    enabled: true,
    activeMaintenance: false,
    history: []
  }
];

export const INITIAL_INCIDENTS: Incident[] = [];

export const INITIAL_CLOUDFLARE_ZONES: CloudflareZone[] = [
  {
    id: 'cf-real-pair',
    domain: '72.61.239.86',
    status: 'ACTIVE',
    sslStatus: 'ACTIVE',
    sslExpiresAt: '2027-01-01T00:00:00Z',
    tlsVersion: 'HTTP / TLS 1.3',
    dnsRecords: [
      { id: 'dns-main', type: 'A', name: 'vps1-main', target: '72.61.239.86', proxied: false, ttl: 60, lastModified: 'Active' },
      { id: 'dns-dr', type: 'A', name: 'vps2-dr', target: '187.126.112.188', proxied: false, ttl: 60, lastModified: 'Active' }
    ],
    loadBalancer: {
      poolName: 'pool-real-2vps',
      primaryOrigin: '72.61.239.86:6423 (VPS 1 - MAIN)',
      drOrigin: '187.126.112.188:6423 (VPS 2 - DR)',
      activeOrigin: '72.61.239.86:6423 (VPS 1 - MAIN)',
      healthCheckStatus: 'HEALTHY',
      failoverPolicy: 'MANUAL'
    },
    wafEvents24h: 0,
    driftDetected: false,
    lastChecked: new Date().toISOString()
  }
];

export const INITIAL_BACKUPS: BackupRecord[] = [];

export const INITIAL_RUNBOOKS: Runbook[] = [
  {
    id: 'run-dr-failover',
    title: '2-VPS Production Failover & Verification Runbook',
    description: 'Standard operating procedure for verifying VPS 1 - MAIN (72.61.239.86:6423) and VPS 2 - DR (187.126.112.188:6423) health before switching routing.',
    category: 'FAILOVER',
    estimatedDurationMin: 10,
    steps: [
      { id: 1, title: 'Probe Both VPS Health Endpoints', instruction: 'Execute PROBE BOTH VPSs to verify HTTP 200 and status: "ok" on /api/health.', command: 'curl -i http://72.61.239.86:6423/api/health && curl -i http://187.126.112.188:6423/api/health', completed: false },
      { id: 2, title: 'Verify TCP Port 6423 Reachability', instruction: 'Test TCP socket connectivity on port 6423 for both VPS 1 MAIN and VPS 2 DR.', completed: false },
      { id: 3, title: 'Confirm DR Database Status', instruction: 'Verify VPS 2 DR health response includes database: "ok".', completed: false },
      { id: 4, title: 'Confirm Failover Action', instruction: 'Use the Failover confirmation dialog to switch active routing between MAIN and DR.', completed: false }
    ]
  }
];

export const INITIAL_DEPLOYMENTS: Deployment[] = [];

export const INITIAL_MAINTENANCE_WINDOWS: MaintenanceWindow[] = [];

export const INITIAL_COMM_CHANNELS: CommunicationChannel[] = [
  {
    id: 'comm-teams-ops',
    name: 'Microsoft Teams (#ops-control-center)',
    type: 'TEAMS',
    enabled: true,
    targetEndpoint: 'https://scholario.webhook.office.com/webhookb2/ops-channel',
    lastDeliveryAt: new Date().toISOString(),
    lastDeliveryStatus: 'DELIVERED',
    failureCount: 0
  },
  {
    id: 'comm-email-oncall',
    name: 'Ops Escalation Email (oncall@scholario.net)',
    type: 'EMAIL',
    enabled: true,
    targetEndpoint: 'oncall@scholario.net',
    lastDeliveryAt: new Date().toISOString(),
    lastDeliveryStatus: 'DELIVERED',
    failureCount: 0
  }
];

export const INITIAL_ESCALATION_POLICIES: EscalationPolicy[] = [
  {
    id: 'esc-crit',
    severity: 'CRITICAL',
    channels: ['comm-teams-ops', 'comm-email-oncall'],
    initialDelayMin: 0,
    repeatIntervalMin: 15,
    autoEscalateAfterMin: 10,
    escalateToTeam: 'Lead DevOps & Infrastructure Operations'
  }
];

export const INITIAL_AUDIT_LOGS: AuditLog[] = [];

// MOCK DATA (not imported anywhere; never shown as real telemetry)
export const INITIAL_DEAD_MAN: DeadManControlPlane = {
  id: 'deadman-mock',
  name: 'Dead-Man Watchdog Heartbeat Stream',
  status: 'NOT_CONFIGURED',
  evaluatedAt: '',
  telemetryIntervalSec: null,
  staleAfterSec: 60,
  disconnectedAfterSec: 600,
  servers: [],
  counts: { healthy: 0, degraded: 0, failing: 0, unknown: 0, total: 0 },
};
