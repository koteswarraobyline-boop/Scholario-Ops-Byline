-- Migration 005: Monitors and Check History

CREATE TYPE monitor_type AS ENUM (
  'HTTP', 'HTTPS', 'DNS', 'TCP', 'SSL',
  'APP_HEALTH', 'APP_READINESS',
  'API_BUSINESS', 'CRON_HEARTBEAT', 'WORKER_HEARTBEAT',
  'INFRA_CPU', 'INFRA_RAM', 'INFRA_DISK',
  'DB_CONN', 'DB_REPLICATION',
  'BACKUP_FRESHNESS', 'DEAD_MAN'
);

CREATE TABLE IF NOT EXISTS monitors (
  id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                            VARCHAR(255) NOT NULL,
  type                            monitor_type NOT NULL,
  target                          VARCHAR(1000) NOT NULL,
  application_id                  UUID REFERENCES applications(id) ON DELETE SET NULL,
  server_id                       UUID REFERENCES servers(id) ON DELETE SET NULL,
  environment                     environment_type NOT NULL DEFAULT 'PRD',
  interval_sec                    INT NOT NULL DEFAULT 30,
  timeout_sec                     INT NOT NULL DEFAULT 10,
  retries                         INT NOT NULL DEFAULT 2,
  warning_threshold_ms            INT NOT NULL DEFAULT 500,
  critical_threshold_ms           INT NOT NULL DEFAULT 2000,
  failure_confirmation_threshold  INT NOT NULL DEFAULT 3,
  recovery_confirmation_threshold INT NOT NULL DEFAULT 3,
  consecutive_failures            INT NOT NULL DEFAULT 0,
  consecutive_recoveries          INT NOT NULL DEFAULT 0,
  status                          operational_status NOT NULL DEFAULT 'UNKNOWN',
  last_check                      TIMESTAMPTZ,
  last_success                    TIMESTAMPTZ,
  last_failure                    TIMESTAMPTZ,
  response_time_ms                INT,
  uptime_percent                  NUMERIC(6,3),
  runbook_id                      UUID,  -- FK added after runbooks table
  enabled                         BOOLEAN NOT NULL DEFAULT TRUE,
  active_maintenance              BOOLEAN NOT NULL DEFAULT FALSE,
  -- HTTP-specific
  expected_status_code            INT DEFAULT 200,
  expected_body_contains          TEXT,
  http_method                     VARCHAR(10) DEFAULT 'GET',
  headers                         JSONB DEFAULT '{}',
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS monitor_results (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  monitor_id      UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  status          operational_status NOT NULL,
  response_time_ms INT,
  status_code     INT,
  detail          TEXT,
  error           TEXT,
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitors_application ON monitors(application_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_monitors_enabled ON monitors(enabled, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_monitor_results_monitor_time ON monitor_results(monitor_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitor_results_checked ON monitor_results(checked_at);
