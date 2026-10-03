-- Migration 008: Backups, Replication, Deployments, Maintenance, Runbooks, Cloudflare, Hostinger

-- ─── BACKUPS ──────────────────────────────────────────────────────────────────

CREATE TYPE backup_type AS ENUM ('DAILY_SNAPSHOT', 'MYSQL_DUMP', 'FILE_STORAGE');
CREATE TYPE backup_status AS ENUM ('SUCCESS', 'FAILED', 'RUNNING', 'STALE', 'UNKNOWN');
CREATE TYPE restore_status AS ENUM ('VERIFIED', 'FAILED', 'PENDING');

CREATE TABLE IF NOT EXISTS backups (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id      UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  server_id           UUID REFERENCES servers(id) ON DELETE SET NULL,
  type                backup_type NOT NULL,
  size_gb             NUMERIC(8,2),
  destination         VARCHAR(500),
  retention_days      INT NOT NULL DEFAULT 30,
  encrypted           BOOLEAN NOT NULL DEFAULT TRUE,
  integrity_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  integrity_hash      VARCHAR(500),
  restore_tested_at   TIMESTAMPTZ,
  restore_duration_min INT,
  restore_status      restore_status NOT NULL DEFAULT 'PENDING',
  status              backup_status NOT NULL DEFAULT 'UNKNOWN',
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── REPLICATION ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS replications (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id        UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  source_server_id      UUID REFERENCES servers(id) ON DELETE SET NULL,
  destination_server_id UUID REFERENCES servers(id) ON DELETE SET NULL,
  replication_type      VARCHAR(50) NOT NULL DEFAULT 'MYSQL_BINLOG',
  status                operational_status NOT NULL DEFAULT 'UNKNOWN',
  lag_sec               INT,
  warning_lag_sec       INT NOT NULL DEFAULT 30,
  critical_lag_sec      INT NOT NULL DEFAULT 120,
  last_sync             TIMESTAMPTZ,
  last_failure          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── DEPLOYMENTS ──────────────────────────────────────────────────────────────

CREATE TYPE deployment_status AS ENUM (
  'BUILDING', 'DEPLOYING', 'HEALTH_CHECK', 'SMOKE_TEST', 'SUCCESS', 'FAILED', 'ROLLED_BACK'
);

CREATE TABLE IF NOT EXISTS deployments (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id   UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  version          VARCHAR(100) NOT NULL,
  commit_hash      VARCHAR(100),
  commit_message   TEXT,
  environment      environment_type NOT NULL DEFAULT 'PRD',
  author           VARCHAR(255),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  duration_sec     INT,
  status           deployment_status NOT NULL DEFAULT 'BUILDING',
  rollback_available BOOLEAN NOT NULL DEFAULT FALSE,
  previous_version VARCHAR(100),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add FK on incidents for deployment correlation
ALTER TABLE incidents
  ADD CONSTRAINT fk_incident_deployment
  FOREIGN KEY (triggered_by_deployment_id)
  REFERENCES deployments(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS deployment_events (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deployment_id  UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  stage          VARCHAR(100) NOT NULL,
  status         VARCHAR(50) NOT NULL,
  message        TEXT,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── MAINTENANCE WINDOWS ──────────────────────────────────────────────────────

CREATE TYPE maintenance_status AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'CANCELLED');

CREATE TABLE IF NOT EXISTS maintenance_windows (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title            VARCHAR(500) NOT NULL,
  application_id   UUID REFERENCES applications(id) ON DELETE SET NULL,
  environment      environment_type NOT NULL DEFAULT 'PRD',
  start_time       TIMESTAMPTZ NOT NULL,
  end_time         TIMESTAMPTZ NOT NULL,
  expected_impact  TEXT,
  suppress_monitors TEXT[],        -- monitor IDs to suppress
  status           maintenance_status NOT NULL DEFAULT 'SCHEDULED',
  approved_by      VARCHAR(255),
  approved_by_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  reason           TEXT,
  created_by_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── RUNBOOKS ─────────────────────────────────────────────────────────────────

CREATE TYPE runbook_category AS ENUM (
  'DATABASE', 'FAILOVER', 'WEB_SERVER', 'PERFORMANCE', 'DEAD_MAN', 'NETWORK', 'SECURITY'
);

CREATE TABLE IF NOT EXISTS runbooks (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                 VARCHAR(500) NOT NULL,
  description           TEXT,
  category              runbook_category NOT NULL,
  estimated_duration_min INT NOT NULL DEFAULT 15,
  version               INT NOT NULL DEFAULT 1,
  created_by_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS runbook_steps (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  runbook_id   UUID NOT NULL REFERENCES runbooks(id) ON DELETE CASCADE,
  step_order   INT NOT NULL,
  title        VARCHAR(500) NOT NULL,
  instruction  TEXT NOT NULL,
  command      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (runbook_id, step_order)
);

CREATE TABLE IF NOT EXISTS runbook_executions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  runbook_id    UUID NOT NULL REFERENCES runbooks(id) ON DELETE CASCADE,
  incident_id   UUID REFERENCES incidents(id) ON DELETE SET NULL,
  executed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  executed_by   VARCHAR(255) NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  steps_done    INT NOT NULL DEFAULT 0,
  total_steps   INT NOT NULL DEFAULT 0,
  notes         TEXT
);

CREATE TABLE IF NOT EXISTS runbook_step_completions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  execution_id   UUID NOT NULL REFERENCES runbook_executions(id) ON DELETE CASCADE,
  step_id        UUID NOT NULL REFERENCES runbook_steps(id) ON DELETE CASCADE,
  completed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_by   VARCHAR(255),
  completed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (execution_id, step_id)
);

-- Add FK on monitors for runbook link
ALTER TABLE monitors
  ADD CONSTRAINT fk_monitor_runbook FOREIGN KEY (runbook_id) REFERENCES runbooks(id) ON DELETE SET NULL;

ALTER TABLE incidents
  ADD CONSTRAINT fk_incident_runbook FOREIGN KEY (runbook_id) REFERENCES runbooks(id) ON DELETE SET NULL;

-- ─── CLOUDFLARE ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cloudflare_zones (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cloudflare_id    VARCHAR(100) UNIQUE,  -- Cloudflare's own zone ID
  domain           VARCHAR(255) UNIQUE NOT NULL,
  status           VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  ssl_status       VARCHAR(50),
  ssl_expires_at   TIMESTAMPTZ,
  tls_version      VARCHAR(20),
  waf_events_24h   INT DEFAULT 0,
  drift_detected   BOOLEAN NOT NULL DEFAULT FALSE,
  drift_details    TEXT,
  last_checked     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cloudflare_dns_records (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zone_id        UUID NOT NULL REFERENCES cloudflare_zones(id) ON DELETE CASCADE,
  cloudflare_id  VARCHAR(100),
  type           VARCHAR(10) NOT NULL,  -- A | CNAME | TXT | MX
  name           VARCHAR(500) NOT NULL,
  target         TEXT NOT NULL,
  proxied        BOOLEAN NOT NULL DEFAULT FALSE,
  ttl            INT,
  last_modified  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cloudflare_load_balancers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zone_id             UUID NOT NULL REFERENCES cloudflare_zones(id) ON DELETE CASCADE,
  pool_name           VARCHAR(255),
  primary_origin      VARCHAR(500),
  dr_origin           VARCHAR(500),
  active_origin       VARCHAR(500),
  health_check_status VARCHAR(50) NOT NULL DEFAULT 'HEALTHY',
  failover_policy     VARCHAR(100) NOT NULL DEFAULT 'AUTOMATIC_WITH_CONFIRMATION',
  last_rerouted_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── DEAD-MAN ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dead_man_controls (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                      VARCHAR(255) NOT NULL,
  node_location             VARCHAR(255),
  target_control_plane      VARCHAR(500),
  interval_sec              INT NOT NULL DEFAULT 15,
  tolerance_sec             INT NOT NULL DEFAULT 45,
  status                    VARCHAR(50) NOT NULL DEFAULT 'HEALTHY',
  consecutive_misses        INT NOT NULL DEFAULT 0,
  last_heartbeat_received_at TIMESTAMPTZ,
  last_alert_sent_at        TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── INDEXES ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_backups_application ON backups(application_id);
CREATE INDEX IF NOT EXISTS idx_deployments_application ON deployments(application_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_windows_time ON maintenance_windows(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_runbooks_category ON runbooks(category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cloudflare_dns_zone ON cloudflare_dns_records(zone_id);
