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
  /** Public application URLs probed by the synthetic monitors */
  prdUrl?: string;
  drUrl?: string;
  /**
   * Cloudflare Load Balancer mapping. When set, traffic routing is owned by the
   * Cloudflare LB and Scholario Ops reads pool / origin health from the API.
   */
  loadBalancer?: AppLoadBalancerMapping;
  /** Settings for the URL monitors that are created and kept in sync from prdUrl / drUrl */
  healthCheck?: AppHealthCheck;
  /** Per-environment inventory; unset fields are unknown / pending confirmation */
  environments?: Partial<Record<Environment, EnvironmentInventory>>;
}

/** Facts about one environment of an application. null = not confirmed (shown as UNKNOWN / PENDING). */
export interface EnvironmentInventory {
  appPort: number | null;
  healthPath: string | null;
  webServer: string | null;
  processManager: string | null;
  routing: string | null;
  /** Database the telemetry agent probes on this server; null = database monitoring not configured */
  dbEngine: 'mysql' | 'mariadb' | 'postgresql' | null;
  dbName: string | null;
  dbPort: number | null;
  /** Replication lag above this is a failure (null = use REPLICATION_MAX_LAG_SEC) */
  replicationMaxLagSec: number | null;
  /** A backup older than this is STALE (null = use BACKUP_MAX_AGE_HOURS) */
  backupMaxAgeHours: number | null;
  notes: string;
}

/** Database facts reported by the agent on the server that runs the database */
export interface DatabaseReport {
  engine: 'mysql' | 'mariadb' | 'postgresql';
  name: string | null;
  available: boolean;
  latencyMs: number | null;
  version: string | null;
  sizeBytes: number | null;
  connections: number | null;
  maxConnections: number | null;
  longRunningQueries: number | null;
  /** connections / maxConnections % (computed by the server; null when either is unknown) */
  connectionUsagePercent?: number | null;
  replication: {
    role: 'primary' | 'replica' | 'none' | 'unknown';
    state: 'running' | 'stopped' | 'error' | 'unknown';
    lagSec: number | null;
    lastSuccessAt: string | null;
    error: string | null;
  } | null;
  error: string | null;
  observedAt: string;
}
/** Database probe reported by the telemetry agent */
export type DatabaseTelemetry = DatabaseReport;

export type ProviderStatus = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN';

/** Normalised VPS facts from the Hostinger API (only fields the API returns) */
export interface HostingerInfo {
  vmId: number;
  hostname: string | null;
  plan: string | null;
  cpus: number | null;
  ramGb: number | null;
  diskGb: number | null;
  os: string | null;
  state: string | null;
  status: ProviderStatus;
  region: string | null;
  ipv4: string[];
  fetchedAt: string;
}

export type DatabaseHealth = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN' | 'NOT_CONFIGURED';
export type BackupHealth = 'HEALTHY' | 'STALE' | 'FAILED' | 'UNKNOWN';

export interface BackupStatus {
  applicationId: string;
  applicationName: string;
  status: BackupHealth;
  lastBackupAt: string | null;
  lastBackupStatus: string | null;
  ageHours: number | null;
  thresholdHours: number;
  type: string | null;
  destination: string | null;
  detail: string;
}

export interface AppHealthCheck {
  /** null = any 2xx/3xx */
  expectedStatus: number | null;
  intervalSec: number;
  timeoutSec: number;
  /** Also monitor the TLS certificate of each URL host */
  sslMonitoring: boolean;
}

export interface AppLoadBalancerMapping {
  accountId: string;
  /** Hostname served by the load balancer, e.g. app.example.com */
  hostname: string;
  prdPoolId: string;
  drPoolId: string;
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
  /** Absolute values reported by agent >= 3.1 (null when the agent did not report them) */
  memTotalMb?: number | null;
  memUsedMb?: number | null;
  memAvailableMb?: number | null;
  diskTotalGb?: number | null;
  diskUsedGb?: number | null;
  diskFreeGb?: number | null;
  uptimeSec?: number | null;
  /** Agent >= 3.3 (null = not available on this platform / older agent; never a made-up 0) */
  cpuIowaitPercent?: number | null;
  cpuStealPercent?: number | null;
  /** 1-minute load / CPU cores (computed by the server) */
  loadPerCore?: number | null;
  swapTotalMb?: number | null;
  swapUsedMb?: number | null;
  swapFreeMb?: number | null;
  /** null when no swap is configured */
  swapPercent?: number | null;
  pressure?: PressureTelemetry | null;
  /** Disk I/O summed over physical disks (utilisation = busiest disk) */
  diskReadBytesPerSec?: number | null;
  diskWriteBytesPerSec?: number | null;
  diskReadOpsPerSec?: number | null;
  diskWriteOpsPerSec?: number | null;
  diskUtilPercent?: number | null;
}
/** Current host telemetry of a server (alias used by the telemetry UI) */
export type ServerTelemetry = VpsTelemetry;

/** Pressure stall information: % of time some tasks waited for the resource (avg over 60 s). null = kernel without PSI */
export interface PressureTelemetry { cpu: number | null; memory: number | null; io: number | null }

export interface FilesystemTelemetry {
  mountPoint: string;
  filesystem: string;
  device: string;
  totalGb: number | null;
  usedGb: number | null;
  freeGb: number | null;
  usedPercent: number | null;
  /** null for filesystems without a fixed inode table (btrfs, vfat) */
  inodeTotal: number | null;
  inodeUsed: number | null;
  inodeFree: number | null;
  inodePercent: number | null;
}

export interface NetworkInterfaceTelemetry {
  name: string;
  rxBytesPerSec: number | null;
  txBytesPerSec: number | null;
  rxPacketsPerSec: number | null;
  txPacketsPerSec: number | null;
  /** Cumulative counters since boot */
  rxErrors: number | null;
  txErrors: number | null;
  rxDrops: number | null;
  txDrops: number | null;
  /** Errors + drops since the previous report (computed by the server; null on the first report) */
  newErrors: number | null;
  newDrops: number | null;
  operationalState: string | null;
  /** true for bridges / veth / tunnels (no physical device) */
  virtual: boolean | null;
}

export interface DiskIOTelemetry {
  device: string;
  readBytesPerSec: number | null;
  writeBytesPerSec: number | null;
  readOpsPerSec: number | null;
  writeOpsPerSec: number | null;
  ioUtilizationPercent: number | null;
  readLatencyMs: number | null;
  writeLatencyMs: number | null;
}

export type Pm2Status = 'online' | 'stopping' | 'stopped' | 'launching' | 'errored' | 'one-launch-status' | 'waiting restart' | 'unknown';

/** One PM2 application. Built from allow-listed `pm2 jlist` fields only — environments are never collected. */
export interface PM2ProcessTelemetry {
  id: number | null;
  name: string;
  status: Pm2Status;
  pid: number | null;
  cpuPercent: number | null;
  memoryMb: number | null;
  uptimeSec: number | null;
  startedAt: string | null;
  restartCount: number | null;
  unstableRestarts: number | null;
  /** Restarts within THRESHOLDS.pm2Restarts.restartWindowMinutes (computed by the server; null until known) */
  recentRestarts: number | null;
  nodeVersion: string | null;
  interpreter: string | null;
  execMode: string | null;
  instances: number | null;
  /** package.json version reported by PM2 */
  version: string | null;
  /** Release directory (deploy/release.sh layout), e.g. 20261008-101500-abc1234 */
  release: string | null;
  gitRevision: string | null;
  /** System user that owns the PM2 daemon */
  owner: string | null;
  /** TCP ports this process listens on */
  ports: number[];
}

/** Local application health check run by the agent against 127.0.0.1:<port><path> */
export interface ApplicationHealthTelemetry {
  applicationId: string;
  name: string;
  environment: Environment | null;
  port: number;
  path: string;
  listening: boolean | null;
  status: 'HEALTHY' | 'DOWN' | 'UNKNOWN';
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
  /** Consecutive DOWN results (computed by the server) */
  consecutiveFailures: number;
}

export interface ListeningPortTelemetry {
  address: string;
  port: number;
  process: string | null;
  pids: number[];
  /** loopback = 127.0.0.1 / ::1 only · all = every interface (0.0.0.0 / ::) · address = one specific address */
  scope: 'loopback' | 'all' | 'address';
}

export interface NtpTelemetry {
  /** timedatectl NTPSynchronized (null = unknown) */
  synchronized: boolean | null;
  ntpEnabled: boolean | null;
  /** Active time service (chronyd, systemd-timesyncd, ntpd …) */
  service: string | null;
  /** Offset from NTP time as reported by the time service (ms) */
  clockOffsetMs: number | null;
  /** Clock frequency error (ppm, chrony only) */
  clockDriftPpm: number | null;
  observedAt: string;
}

export interface SystemInfoTelemetry {
  kernelVersion: string | null;
  architecture: string | null;
  bootTime: string | null;
  timezone: string | null;
  osName: string | null;
  osVersion: string | null;
  nodeVersion: string | null;
  npmVersion: string | null;
}

export interface FailedUnitsTelemetry { count: number; units: string[]; observedAt: string }

/** Delivery timing of the last report (agent >= 3.3) */
export interface AgentTimingTelemetry {
  sentAt: string | null;
  /** Half the round trip of the previous report (ms) */
  transportDelayMs: number | null;
  /** Server clock − agent clock, corrected for the transport delay (ms; + = agent clock behind) */
  clockSkewMs: number | null;
}

export interface AgentHealthTelemetry {
  /** ONLINE = reporting now; STALE = missed reports; OFFLINE = stopped reporting; NOT_CONNECTED = never reported */
  state: 'ONLINE' | 'STALE' | 'OFFLINE' | 'NOT_CONNECTED';
  version: string | null;
  /** Current agent version (server/agent.ts AGENT_VERSION) */
  expectedVersion: string;
  /** null when the agent never reported a version */
  outdated: boolean | null;
  startedAt: string | null;
  restartCount: number;
  lastSeen: string | null;
  observedAt: string | null;
  receivedAt: string | null;
  sentAt: string | null;
  transportDelayMs: number | null;
  clockSkewMs: number | null;
  sourceIp: string | null;
  errors: string[];
}

export type TelemetryLevel = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';
export type HealthCategoryKey = 'agent' | 'time' | 'cpu' | 'memory' | 'swap' | 'disk' | 'diskio' | 'network' | 'systemd' | 'pm2' | 'apps' | 'database';

/** One line of a server's health summary (computed by the server from the latest telemetry) */
export interface HealthCategory { key: HealthCategoryKey; label: string; level: TelemetryLevel; detail: string }

/** A condition that needs attention. `alert` = also raised as an incident (sustained / significant only). */
export interface ServerWarning { key: string; category: HealthCategoryKey; level: 'WARNING' | 'CRITICAL'; message: string; alert: boolean }

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
  /** Agent >= 3.3: raw systemd states and restart counter (NRestarts) */
  activeState?: string | null;
  subState?: string | null;
  failed?: boolean;
  restartCount?: number | null;
  result?: string | null;
}
export type SystemdServiceTelemetry = VpsService;

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
  /** Purchased plan capacity (from configuration or the Hostinger API), separate from agent-measured values */
  planSpec?: { name: string; cpuCores: number; ramGb: number; diskGb: number; source: 'manual' | 'config' | 'hostinger' };
  /** Hostname and source IP of the last authenticated agent report */
  reportedHostname?: string;
  agentSourceIp?: string;
  /** When the agent process started (changes on every agent restart) */
  agentStartedAt?: string;
  agentRestartCount?: number;
  /** Collector errors reported by the agent in its last report */
  agentErrors?: string[];
  /** Database probes reported by the agent (empty / undefined = none reported) */
  databases?: DatabaseReport[];
  /** Facts from the Hostinger API when the server matched a Hostinger VM by IP */
  hostinger?: HostingerInfo;
  telemetry: VpsTelemetry;
  processes: VpsProcess[];
  services: VpsService[];
  logs: VpsLogEntry[];
  // ── Agent >= 3.3 (undefined = never reported by this server's agent) ──
  filesystems?: FilesystemTelemetry[];
  networkInterfaces?: NetworkInterfaceTelemetry[];
  diskIo?: DiskIOTelemetry[];
  /** null = PM2 is not running on this server */
  pm2?: PM2ProcessTelemetry[] | null;
  pm2ObservedAt?: string;
  appHealth?: ApplicationHealthTelemetry[];
  listeningPorts?: ListeningPortTelemetry[] | null;
  ntp?: NtpTelemetry | null;
  system?: SystemInfoTelemetry | null;
  failedUnits?: FailedUnitsTelemetry | null;
  agentTiming?: AgentTimingTelemetry;
  // ── Computed by the server for every response (not stored) ──
  agent?: AgentHealthTelemetry;
  health?: HealthCategory[];
  warnings?: ServerWarning[];
}

/** Classified result of a single synthetic check */
export type ProbeStatus = 'UP' | 'DOWN' | 'DEGRADED' | 'TIMEOUT' | 'DNS_ERROR' | 'TLS_ERROR' | 'CONNECTION_ERROR' | 'UNKNOWN';

export interface MonitorCheckHistory {
  timestamp: string;
  status: OperationalStatus;
  responseTimeMs: number;
  statusCode?: number;
  detail?: string;
  probeStatus?: ProbeStatus;
}

/** One persisted check result (DATA_DIR/checks/*.jsonl) */
export interface CheckRecord {
  t: string;
  monitorId: string;
  applicationId: string;
  environment: Environment;
  target: string;
  ok: boolean;
  probeStatus: ProbeStatus;
  statusCode: number | null;
  latencyMs: number;
  reason: string;
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
  /** Classification of the most recent check */
  lastProbeStatus?: ProbeStatus;
  lastStatusCode?: number | null;
  /** 'app-url' / 'app-ssl': created from an application's PRD/DR URL and updated when the URL changes */
  managedBy?: 'app-url' | 'app-ssl';
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
  /** Facts captured from monitoring when the incident was raised / updated */
  context?: IncidentContext;
}

export interface IncidentContext {
  application: string;
  environment: Environment;
  vps: string | null;
  ip: string | null;
  monitor: string | null;
  target: string | null;
  firstDetectedAt: string;
  latestDetectedAt: string;
  failureReason: string;
  probeStatus: ProbeStatus | null;
  responseCode: number | null;
  latencyMs: number | null;
  cloudflare: {
    poolName: string;
    poolEnabled: boolean | null;
    poolHealthy: boolean | null;
    originAddress: string | null;
    originHealthy: boolean | null;
    originFailureReason: string | null;
    checkedAt: string | null;
  } | null;
  recoveredAt?: string;
  durationMinutes?: number;
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
  healthCheckStatus: 'HEALTHY' | 'UNHEALTHY' | 'UNKNOWN';
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

/** NOT_CONFIGURED = the check cannot run because something is not set up yet (never a pass) */
export type CheckVerdict = 'PASS' | 'FAIL' | 'WARNING' | 'UNKNOWN' | 'NOT_CONFIGURED';

export interface DrReadinessItem {
  key: string;
  label: string;
  status: CheckVerdict;
  detail: string;
  /** Timestamp of the data the verdict is based on (null when there is no data) */
  observedAt: string | null;
  /** 'core' = the 13 DR readiness checks; 'capacity' = DR server resources (agent) */
  group?: 'core' | 'capacity';
}

export type DrOverall = 'READY' | 'PARTIALLY_READY' | 'NOT_READY' | 'UNKNOWN';

// ── Cloudflare Load Balancing (read-only) ────────────────────────────────────
export interface LbOriginHealth {
  pop: string;
  healthy: boolean | null;
  rttMs: number | null;
  responseCode: number | null;
  failureReason: string | null;
}

export interface LbOrigin {
  name: string;
  address: string;
  enabled: boolean | null;
  weight: number | null;
  /** From the pools list (Cloudflare's aggregated view) */
  healthy: boolean | null;
  failureReason: string | null;
  /** Per-PoP health from the pool health endpoint */
  health: LbOriginHealth[];
}

export interface LbPool {
  id: string;
  name: string;
  description: string;
  enabled: boolean | null;
  healthy: boolean | null;
  role: 'PRD' | 'DR';
  applicationId: string;
  origins: LbOrigin[];
  /** false when the mapped pool was not returned by the API */
  found: boolean;
  listFetchedAt: string | null;
  healthFetchedAt: string | null;
  healthError: string | null;
}

export interface LbRouting {
  hostname: string;
  found: boolean;
  enabled: boolean | null;
  proxied: boolean | null;
  steeringPolicy: string | null;
  defaultPools: string[];
  fallbackPool: string | null;
  /** First enabled + healthy pool in default_pools order (null when unknown) */
  activePoolId: string | null;
  fetchedAt: string | null;
  error: string | null;
}

export type LbSyncStatus = 'NOT_CONFIGURED' | 'OK' | 'PERMISSION_REQUIRED' | 'ERROR' | 'PENDING';

export interface LoadBalancerState {
  accountId: string | null;
  status: LbSyncStatus;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  pools: LbPool[];
  routing: LbRouting[];
}

export interface FailoverPreflightCheck {
  key: string;
  label: string;
  status: CheckVerdict;
  detail: string;
  observedAt: string | null;
}

export interface FailoverPreflight {
  appId: string;
  appName: string;
  target: 'DR' | 'PRIMARY';
  currentPrimary: string;
  currentDr: string;
  routing: LbRouting | null;
  checks: FailoverPreflightCheck[];
  drOverall: DrOverall;
  /** True when no check FAILs (the operator still has to confirm) */
  preflightPassed: boolean;
  /** LOAD_BALANCER_MANUAL: the switch is done in Cloudflare by an operator; DNS_RECORD: Ops switches the record */
  mode: 'LOAD_BALANCER_MANUAL' | 'DNS_RECORD';
  plan: string[];
  generatedAt: string;
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
  /** Network-level classification: UP when an HTTP response was received */
  probeStatus?: ProbeStatus;
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
  hostinger: { configured: boolean; lastSyncAt: string | null; lastError: string | null; vmCount: number; status: 'NOT_CONFIGURED' | 'OK' | 'AUTH_FAILED' | 'RATE_LIMITED' | 'ERROR' | 'PENDING' };
  notifications: { status: 'CONFIGURED' | 'NOT_CONFIGURED'; enabledChannels: number };
  loadBalancing: { configured: boolean; status: LbSyncStatus; lastSyncAt: string | null; lastError: string | null; poolCount: number };
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
  /** Agent >= 3.3; null / absent = not reported (charts leave a gap, never a 0) */
  swap?: number | null;
  iowait?: number | null;
  steal?: number | null;
  /** Disk I/O, bytes per second */
  diskRead?: number | null;
  diskWrite?: number | null;
  /** Busiest disk utilisation % */
  diskUtil?: number | null;
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

// ── Real VPS Testbench Types (added from remote merge) ──────────────────────

export type RealVpsProbeState =
  | 'HEALTHY'
  | 'UNREACHABLE'
  | 'TIMEOUT'
  | 'CONNECTION_REFUSED'
  | 'HTTP_ERROR'
  | 'INVALID_HEALTH_RESPONSE'
  | 'UNKNOWN';

export type RealVpsErrorCategory =
  | 'TIMEOUT'
  | 'CONNECTION_REFUSED'
  | 'NETWORK_UNREACHABLE'
  | 'DNS_FAILURE'
  | 'HTTP_ERROR'
  | 'INVALID_RESPONSE';

export interface RealVpsNode {
  id: string;
  name: string;
  role?: string;
  ip: string;
  hostname: string;
  port: number;
  healthUrl: string;
  healthPath?: string;
  provider: string;
  region: string;
  environment: 'PRD' | 'DR';
  status: OperationalStatus;
  probeState?: RealVpsProbeState;
  lastCheckedAt: string | null;
  latencyMs: number | null;
  httpStatus: number | null;
  tlsStatus: string | null;
  responseSnippet: string;
  errorReason?: string | null;
  errorCategory?: RealVpsErrorCategory | null;
  healthData?: Record<string, string | number | boolean> | null;
  telemetry: {
    cpuPercent: number;
    ramPercent: number;
    diskPercent: number;
    loadAvg?: number[];
    observedAt: string;
  };
}

export interface RealVpsConfig {
  activeMode: 'real_pair' | 'sample_cluster';
  routing: 'MAIN' | 'DR';
  autoFailover: boolean;
  healthCheckIntervalSec: number;
  main: RealVpsNode;
  dr: RealVpsNode;
  testApp: {
    id: string;
    name: string;
    codeName: string;
    domain: string;
    healthPath: string;
    failoverState: 'PRIMARY_ACTIVE' | 'DR_ACTIVE';
    mainServerId: string;
    drServerId: string;
    lastFailoverAt?: string;
  };
}

export interface RealVpsProbeResult {
  target?: string;
  vpsType?: 'main' | 'dr' | 'custom';
  reachable: boolean;
  probeState?: RealVpsProbeState;
  statusCode: number | null;
  latencyMs: number;
  health?: string | null;
  healthPath?: string;
  healthData?: Record<string, string | number | boolean> | null;
  tlsValid?: boolean;
  tlsInfo?: string;
  headers?: Record<string, string>;
  bodySnippet?: string;
  error?: string;
  errorCategory?: RealVpsErrorCategory | null;
  timestamp: string;
}

export interface RealVpsTcpProbeResult {
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
