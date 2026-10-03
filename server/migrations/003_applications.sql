-- Migration 003: Applications, Environments, Dependencies

CREATE TYPE operational_status AS ENUM (
  'HEALTHY', 'WARNING', 'CRITICAL', 'UNKNOWN', 'MAINTENANCE', 'STALE'
);

CREATE TYPE environment_type AS ENUM ('PRD', 'DR');

CREATE TYPE app_tier AS ENUM ('TIER_1', 'TIER_2', 'TIER_3');

CREATE TYPE failover_state AS ENUM (
  'PRIMARY_ACTIVE', 'DR_ACTIVE', 'FAILING_OVER', 'FAILBACK_IN_PROGRESS', 'FAILED', 'UNKNOWN'
);

CREATE TABLE IF NOT EXISTS applications (
  id                            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                          VARCHAR(100) NOT NULL,
  code_name                     VARCHAR(50) UNIQUE NOT NULL,
  description                   TEXT,
  tier                          app_tier NOT NULL DEFAULT 'TIER_2',
  status                        operational_status NOT NULL DEFAULT 'UNKNOWN',

  -- Uptime
  uptime_24h                    NUMERIC(6,3),
  uptime_7d                     NUMERIC(6,3),
  uptime_30d                    NUMERIC(6,3),

  -- DR targets
  rto_target_min                INT NOT NULL DEFAULT 30,
  rpo_target_min                INT NOT NULL DEFAULT 15,

  -- Servers
  prd_server_id                 UUID,  -- FK added after servers table created
  dr_server_id                  UUID,

  -- Failover
  failover_state                failover_state NOT NULL DEFAULT 'PRIMARY_ACTIVE',
  failover_initiated_at         TIMESTAMPTZ,
  failover_initiated_by         UUID,  -- user id
  failback_initiated_at         TIMESTAMPTZ,

  -- Performance
  p50_ms                        INT,
  p95_ms                        INT,
  p99_ms                        INT,
  error_rate_percent            NUMERIC(5,2),

  -- Cloudflare
  cloudflare_zone               VARCHAR(255),

  -- Deployment
  recent_deployment_version     VARCHAR(100),

  -- Recovery testing
  last_tested_recovery_date     DATE,
  last_tested_recovery_duration_min INT,

  -- Replication
  current_replication_lag_sec   INT,

  last_checked                  TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                    TIMESTAMPTZ
);

CREATE TYPE dependency_type AS ENUM (
  'DATABASE', 'REDIS', 'STORAGE', 'AI_PROVIDER', 'EMAIL', 'WORKER', 'EXTERNAL_API'
);

CREATE TABLE IF NOT EXISTS app_dependencies (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id  UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  type            dependency_type NOT NULL,
  status          operational_status NOT NULL DEFAULT 'UNKNOWN',
  latency_ms      NUMERIC(8,2),
  target          VARCHAR(500),
  last_checked    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_applications_code_name ON applications(code_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_app_dependencies_app ON app_dependencies(application_id);
