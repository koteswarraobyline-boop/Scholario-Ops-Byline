export type OperationalStatus = 
  | 'HEALTHY' 
  | 'WARNING' 
  | 'CRITICAL' 
  | 'UNKNOWN' 
  | 'MAINTENANCE' 
  | 'STALE';

export type IncidentSeverity = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL' | 'EMERGENCY';

export type IncidentStatus = 
  | 'OPEN' 
  | 'ACKNOWLEDGED' 
  | 'INVESTIGATING' 
  | 'MITIGATING' 
  | 'MONITORING' 
  | 'RESOLVED' 
  | 'CLOSED';

export type MonitorType = 
  | 'HTTP' 
  | 'HTTPS' 
  | 'DNS' 
  | 'TCP' 
  | 'SSL' 
  | 'APP_HEALTH' 
  | 'APP_READINESS' 
  | 'API_BUSINESS' 
  | 'CRON_HEARTBEAT' 
  | 'WORKER_HEARTBEAT' 
  | 'INFRA_CPU' 
  | 'INFRA_RAM' 
  | 'INFRA_DISK' 
  | 'DB_CONN' 
  | 'DB_REPLICATION' 
  | 'BACKUP_FRESHNESS' 
  | 'DEAD_MAN';

export type Environment = 'PRD' | 'DR';

export interface AppDependency {
  id: string;
  name: string;
  type: 'DATABASE' | 'REDIS' | 'STORAGE' | 'AI_PROVIDER' | 'EMAIL' | 'WORKER' | 'EXTERNAL_API';
  status: OperationalStatus;
  latencyMs: number;
  lastChecked: string;
  target: string;
}

export interface Application {
  id: string;
  name: string;
  codeName: string;
  description: string;
  tier: 'TIER_1' | 'TIER_2' | 'TIER_3';
  status: OperationalStatus;
  /** null until monitors have produced checks in the window */
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  rtoTargetMin: number;
  rpoTargetMin: number;
  /** null when no DB_REPLICATION monitor reports lag for this application */
  currentReplicationLagSec: number | null;
  prdServerId: string;
  drServerId: string;
  /** Cloudflare DNS record (e.g. app.example.com) switched between PRD and DR IPs on failover */
  dnsRecordName?: string;
  /** Switch DNS to DR automatically when PRD is confirmed CRITICAL and DR is healthy */
  autoFailover?: boolean;
  lastFailoverAt?: string;
  failoverState: 'PRIMARY_ACTIVE' | 'DR_ACTIVE' | 'FAILING_OVER';
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  errorRatePercent: number | null;
  lastChecked: string;
  cloudflareZone: string;
  dependencies: AppDependency[];
  recentDeploymentVersion?: string;
  lastTestedRecoveryDate?: string;
  lastTestedRecoveryDurationMin?: number;
}

export interface VpsTelemetry {
  cpuPercent: number;
  ramPercent: number;
  diskPercent: number;
  loadAvg: [number, number, number]; // 1m, 5m, 15m
  networkInKbps: number;
  networkOutKbps: number;
  observedAt: string;
  receivedAt: string;
}

export interface VpsProcess {
  pid: number;
  name: string;
  user: string;
  cpuPercent: number;
  memMb: number;
  status: 'running' | 'sleeping' | 'stopped';
}

export interface VpsService {
  name: string;
  status: 'active' | 'inactive' | 'failed' | 'restarting';
  version: string;
  pid: number;
  memoryMb: number;
  cpuPercent: number;
  lastRestart: string;
}

export interface VpsLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  service: string;
  message: string;
}

export interface VpsServer {
  id: string;
  hostname: string;
  ip: string;
  applicationId: string;
  environment: Environment;
  provider: string;
  region: string;
  plan: string;
  cpuCores: number;
  ramGb: number;
  diskGb: number;
  os: string;
  status: OperationalStatus;
  agentVersion: string;
  agentStatus: 'CONNECTED' | 'STALE' | 'DISCONNECTED';
  uptimeDays: number;
  /** Last agent report time; empty string when the agent has never reported */
  lastSeen: string;
  notes?: string;
  telemetry: VpsTelemetry;
  processes: VpsProcess[];
  services: VpsService[];
  logs: VpsLogEntry[];
}

export interface MonitorCheckHistory {
  timestamp: string;
  status: OperationalStatus;
  responseTimeMs: number;
  statusCode?: number;
  detail?: string;
}

export interface Monitor {
  id: string;
  name: string;
  type: MonitorType;
  target: string;
  applicationId: string;
  environment: Environment;
  intervalSec: number;
  timeoutSec: number;
  retries: number;
  warningThresholdMs: number;
  criticalThresholdMs: number;
  failureConfirmationThreshold: number; // default 3
  recoveryConfirmationThreshold: number; // default 3
  consecutiveFailures: number;
  consecutiveRecoveries: number;
  status: OperationalStatus;
  lastCheck: string;
  lastSuccess: string;
  lastFailure?: string;
  responseTimeMs: number;
  uptimePercent: number;
  history: MonitorCheckHistory[];
  runbookId?: string;
  enabled: boolean;
  activeMaintenance: boolean;
  /** Server this monitor belongs to (drives server health and INFRA_* checks) */
  serverId?: string;
  /** HTTP checks: expected status code (default: any 2xx/3xx) */
  expectedStatusCode?: number;
  /** HTTP checks: response body must contain this text */
  expectedBodyContains?: string;
  /** Push-based monitors (heartbeats, replication lag, backup freshness): secret ping token */
  heartbeatToken?: string;
  /** Last time a push-based monitor received a ping */
  lastPingAt?: string;
  /** Last numeric value reported to a push-based monitor (e.g. replication lag seconds) */
  lastValue?: number;
}

export interface IncidentTimelineEvent {
  id: string;
  timestamp: string;
  source: string;
  level: 'INFO' | 'WARN' | 'CRITICAL' | 'SUCCESS';
  message: string;
}

export interface IncidentNote {
  id: string;
  author: string;
  role: string;
  timestamp: string;
  content: string;
}

export interface Incident {
  id: string; // e.g. INC-1042
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  applicationId: string;
  environment: Environment;
  fingerprint: string; // e.g. mosaic:prd:monitor-mosaic-https:http_500
  rootCause: string;
  startedAt: string;
  resolvedAt?: string;
  durationMinutes: number;
  owner: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  affectedServices: string[];
  affectedMonitors: string[];
  dependentFailures: string[];
  timeline: IncidentTimelineEvent[];
  recoveryStatus: string;
  runbookId?: string;
  notes: IncidentNote[];
  mitigationActionTaken?: string;
}

export interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  target: string;
  proxied: boolean;
  ttl: number;
  lastModified: string;
}

export interface CloudflareLoadBalancer {
  poolName: string;
  primaryOrigin: string;
  drOrigin: string;
  activeOrigin: string;
  healthCheckStatus: 'HEALTHY' | 'UNHEALTHY';
  failoverPolicy: 'AUTOMATIC_WITH_CONFIRMATION' | 'MANUAL';
  lastReroutedAt?: string;
}

export interface CloudflareZone {
  id: string;
  domain: string;
  status: 'ACTIVE' | 'DEGRADED' | 'PENDING';
  plan?: string;
  nameServers?: string[];
  sslMode?: string;
  sslStatus: 'ACTIVE' | 'EXPIRING_SOON' | 'ERROR' | 'UNKNOWN';
  sslExpiresAt: string | null;
  tlsVersion: string;
  dnsRecords: CloudflareDnsRecord[];
  loadBalancer: CloudflareLoadBalancer;
  /** null when firewall analytics are unavailable for the zone plan or token */
  wafEvents24h: number | null;
  driftDetected: boolean;
  driftDetails?: string;
  lastChecked: string;
}

export interface BackupRecord {
  id: string;
  applicationId: string;
  serverId: string;
  type: 'DAILY_SNAPSHOT' | 'MYSQL_DUMP' | 'FILE_STORAGE';
  sizeGb: number;
  destination: string;
  retentionDays: number;
  encrypted: boolean;
  integrityVerified: boolean;
  integrityHash: string;
  restoreTestedAt: string;
  restoreDurationMin: number;
  restoreStatus: 'VERIFIED' | 'FAILED' | 'PENDING';
  status: 'SUCCESS' | 'FAILED' | 'RUNNING' | 'STALE' | 'UNKNOWN';
  completedAt: string;
}

export interface RunbookStep {
  id: number;
  title: string;
  instruction: string;
  command?: string;
  completed: boolean;
  completedAt?: string;
  completedBy?: string;
}

export interface Runbook {
  id: string;
  title: string;
  description: string;
  category: 'DATABASE' | 'FAILOVER' | 'WEB_SERVER' | 'PERFORMANCE' | 'DEAD_MAN';
  estimatedDurationMin: number;
  steps: RunbookStep[];
}

export interface Deployment {
  id: string;
  applicationId: string;
  version: string;
  commitHash: string;
  commitMessage: string;
  environment: Environment;
  author: string;
  startedAt: string;
  completedAt?: string;
  durationSec: number;
  status: 'BUILDING' | 'DEPLOYING' | 'HEALTH_CHECK' | 'SMOKE_TEST' | 'SUCCESS' | 'FAILED' | 'ROLLED_BACK';
  rollbackAvailable: boolean;
}

export interface MaintenanceWindow {
  id: string;
  title: string;
  applicationId: string;
  environment: Environment;
  startTime: string;
  endTime: string;
  expectedImpact: string;
  suppressMonitors: string[];
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'EXPIRED';
  approvedBy: string;
  reason: string;
}

export interface CommunicationChannel {
  id: string;
  name: string;
  type: 'TEAMS' | 'EMAIL' | 'WEBHOOK' | 'PAGERDUTY';
  enabled: boolean;
  targetEndpoint: string;
  lastDeliveryAt: string;
  lastDeliveryStatus: 'DELIVERED' | 'FAILED' | 'PENDING';
  failureCount: number;
}

export interface EscalationPolicy {
  id: string;
  severity: IncidentSeverity;
  channels: string[];
  initialDelayMin: number;
  repeatIntervalMin: number;
  autoEscalateAfterMin: number;
  escalateToTeam: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  operator: string;
  action: string;
  category: 'INCIDENT' | 'FAILOVER' | 'MAINTENANCE' | 'MONITOR' | 'CLOUDFLARE' | 'INFRASTRUCTURE' | 'RUNBOOK'
    | 'APPLICATION' | 'AUTH' | 'USER' | 'NOTIFICATION' | 'DEPLOYMENT' | 'BACKUP';
  targetId: string;
  details: string;
}

export interface DeadManControlPlane {
  id: string;
  name: string;
  nodeLocation: string;
  targetControlPlane: string;
  lastHeartbeatReceivedAt: string;
  intervalSec: number;
  toleranceSec: number;
  status: 'HEALTHY' | 'CRITICAL_SILENCE' | 'NOT_CONFIGURED';
  consecutiveMisses: number;
  lastAlertSentAt?: string;
}

export interface DrReadinessItem {
  key: string;
  label: string;
  status: 'READY' | 'WARNING' | 'FAILED' | 'UNKNOWN';
  detail: string;
}

export interface TcpProbeResult {
  host: string;
  port: number;
  open: boolean;
  latencyMs: number;
  error?: string;
  testedAt: string;
}

export interface SyntheticTransactionResult {
  url: string;
  method: string;
  reachable: boolean;
  statusCode: number | null;
  latencyMs: number;
  expectedMatch: boolean;
  matchText?: string;
  responseSnippet: string;
  headers?: Record<string, string>;
  testedAt: string;
}

export interface HttpProbeResult {
  target: string;
  reachable: boolean;
  statusCode: number | null;
  latencyMs: number;
  resolvedIp?: string;
  tlsInfo?: string;
  headers?: Record<string, string>;
  responseSnippet: string;
  error?: string;
  testedAt: string;
}

export interface IntegrationStatus {
  cloudflare: { configured: boolean; lastSyncAt: string | null; lastError: string | null; zoneCount: number };
  hostinger: { configured: boolean; lastSyncAt: string | null; lastError: string | null; vmCount: number };
  smtp: { configured: boolean };
  deadMan: { configured: boolean };
  publicUrl: string;
}

export interface ServerMetricPoint {
  t: string;
  cpu: number;
  ram: number;
  disk: number;
  load1: number;
  netIn: number;
  netOut: number;
}

export interface OpsUser {
  id: string;
  email: string;
  fullName: string;
  displayName?: string;
  roleName: "viewer" | "operator" | "it_administrator" | "super_admin";
  isActive: boolean;
  isOnCall: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}
