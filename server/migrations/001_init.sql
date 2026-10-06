-- Scholario Ops — PostgreSQL schema (all tables live in the schema named by DB_SCHEMA, default "ops").
-- Configuration entered by administrators is stored in real columns; volatile runtime state
-- (live status, telemetry, check history shown in the UI) is kept in a "state" jsonb column.
-- {{schema}} is replaced with the validated schema name by server/db.ts.

CREATE TABLE IF NOT EXISTS {{schema}}.meta (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- ── Users & sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.users (
  id             uuid PRIMARY KEY,
  email          text NOT NULL UNIQUE,
  full_name      text NOT NULL,
  display_name   text,
  role_name      text NOT NULL CHECK (role_name IN ('viewer','operator','it_administrator','super_admin')),
  is_active      boolean NOT NULL DEFAULT true,
  is_on_call     boolean NOT NULL DEFAULT false,
  password_hash  text NOT NULL,
  token_version  integer NOT NULL DEFAULT 0,
  created_at     timestamptz,
  last_login_at  timestamptz
);

CREATE TABLE IF NOT EXISTS {{schema}}.refresh_tokens (
  id          text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES {{schema}}.users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  expires_at  bigint NOT NULL
);

-- ── VPS servers (configuration) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.servers (
  id              uuid PRIMARY KEY,
  hostname        text NOT NULL UNIQUE,
  ip              text NOT NULL UNIQUE,
  environment     text NOT NULL CHECK (environment IN ('PRD','DR')),
  application_id  uuid,
  provider        text NOT NULL DEFAULT '',
  region          text NOT NULL DEFAULT '',
  plan_name       text NOT NULL DEFAULT '',
  -- Purchased capacity (NOT live usage — usage comes from the telemetry agent)
  plan_cpu_cores  integer CHECK (plan_cpu_cores IS NULL OR plan_cpu_cores > 0),
  plan_ram_gb     numeric(10,2) CHECK (plan_ram_gb IS NULL OR plan_ram_gb > 0),
  plan_disk_gb    numeric(12,2) CHECK (plan_disk_gb IS NULL OR plan_disk_gb > 0),
  plan_source     text CHECK (plan_source IS NULL OR plan_source IN ('manual','config','hostinger')),
  notes           text NOT NULL DEFAULT '',
  agent_token     text NOT NULL,
  hostinger_vm_id bigint,
  hostinger_state text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  state           jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ── Applications (configuration) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.applications (
  id                   uuid PRIMARY KEY,
  name                 text NOT NULL,
  code_name            text NOT NULL UNIQUE,
  description          text NOT NULL DEFAULT '',
  tier                 text NOT NULL CHECK (tier IN ('TIER_1','TIER_2','TIER_3')),
  rto_target_min       integer NOT NULL CHECK (rto_target_min > 0),
  rpo_target_min       integer NOT NULL CHECK (rpo_target_min >= 0),
  prd_server_id        uuid REFERENCES {{schema}}.servers(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  dr_server_id         uuid REFERENCES {{schema}}.servers(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  -- Origin / application URLs probed by the managed URL monitors
  prd_url              text,
  dr_url               text,
  -- DNS / failover
  cloudflare_zone      text NOT NULL DEFAULT '',
  dns_record_name      text,
  auto_failover        boolean NOT NULL DEFAULT false,
  failover_state       text NOT NULL DEFAULT 'PRIMARY_ACTIVE' CHECK (failover_state IN ('PRIMARY_ACTIVE','DR_ACTIVE','FAILING_OVER')),
  last_failover_at     timestamptz,
  -- Health-check settings applied to the managed URL monitors
  hc_expected_status   integer CHECK (hc_expected_status IS NULL OR hc_expected_status BETWEEN 100 AND 599),
  hc_interval_sec      integer NOT NULL DEFAULT 30 CHECK (hc_interval_sec >= 10),
  hc_timeout_sec       integer NOT NULL DEFAULT 15 CHECK (hc_timeout_sec >= 1),
  hc_ssl_monitoring    boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  state                jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ── Cloudflare Load Balancer mapping (one per application) ──────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.application_load_balancers (
  application_id  uuid PRIMARY KEY REFERENCES {{schema}}.applications(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  account_id      text NOT NULL CHECK (account_id ~ '^[0-9a-f]{32}$'),
  hostname        text NOT NULL,
  prd_pool_id     text NOT NULL CHECK (prd_pool_id ~ '^[0-9a-f]{32}$'),
  dr_pool_id      text NOT NULL CHECK (dr_pool_id ~ '^[0-9a-f]{32}$'),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Monitors (configuration + runtime state) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.monitors (
  id                      uuid PRIMARY KEY,
  application_id          uuid REFERENCES {{schema}}.applications(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  server_id               uuid REFERENCES {{schema}}.servers(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  name                    text NOT NULL,
  type                    text NOT NULL,
  target                  text NOT NULL,
  environment             text NOT NULL CHECK (environment IN ('PRD','DR')),
  interval_sec            integer NOT NULL,
  timeout_sec             integer NOT NULL,
  retries                 integer NOT NULL,
  warning_threshold_ms    integer NOT NULL,
  critical_threshold_ms   integer NOT NULL,
  failure_confirmation    integer NOT NULL,
  recovery_confirmation   integer NOT NULL,
  expected_status_code    integer,
  expected_body_contains  text,
  enabled                 boolean NOT NULL DEFAULT true,
  runbook_id              text,
  heartbeat_token         text,
  -- 'app-url' / 'app-ssl' = created and kept in sync from the application's PRD/DR URLs
  managed_by              text,
  state                   jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS monitors_application_idx ON {{schema}}.monitors(application_id);

-- Hourly uptime aggregates
CREATE TABLE IF NOT EXISTS {{schema}}.monitor_buckets (
  monitor_id  text NOT NULL,
  hour        integer NOT NULL,
  total       integer NOT NULL,
  ok          integer NOT NULL,
  lat_sum     double precision NOT NULL,
  PRIMARY KEY (monitor_id, hour)
);

-- Every individual check result (monitors + Cloudflare origin samples)
CREATE TABLE IF NOT EXISTS {{schema}}.check_results (
  id              bigserial PRIMARY KEY,
  t               timestamptz NOT NULL,
  monitor_id      text NOT NULL,
  application_id  text NOT NULL DEFAULT '',
  environment     text NOT NULL,
  target          text NOT NULL,
  ok              boolean NOT NULL,
  probe_status    text NOT NULL,
  status_code     integer,
  latency_ms      double precision NOT NULL,
  reason          text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS check_results_monitor_t_idx ON {{schema}}.check_results(monitor_id, t);
CREATE INDEX IF NOT EXISTS check_results_t_idx ON {{schema}}.check_results(t);

-- Agent telemetry, 1-minute rollups
CREATE TABLE IF NOT EXISTS {{schema}}.server_metrics (
  server_id  text NOT NULL,
  t          timestamptz NOT NULL,
  cpu        double precision NOT NULL,
  ram        double precision NOT NULL,
  disk       double precision NOT NULL,
  load1      double precision NOT NULL,
  net_in     double precision NOT NULL,
  net_out    double precision NOT NULL,
  PRIMARY KEY (server_id, t)
);

-- ── Incidents & audit ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.incidents (
  id                text PRIMARY KEY,
  title             text NOT NULL,
  severity          text NOT NULL,
  status            text NOT NULL,
  application_id    text NOT NULL DEFAULT '',
  environment       text NOT NULL,
  fingerprint       text NOT NULL,
  root_cause        text NOT NULL DEFAULT '',
  started_at        timestamptz NOT NULL,
  resolved_at       timestamptz,
  duration_minutes  integer NOT NULL DEFAULT 0,
  owner             text NOT NULL DEFAULT '',
  acknowledged      boolean NOT NULL DEFAULT false,
  acknowledged_at   timestamptz,
  acknowledged_by   text,
  recovery_status   text NOT NULL DEFAULT '',
  runbook_id        text,
  mitigation        text,
  -- timeline, notes, affected services/monitors and the monitoring context
  details           jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS incidents_started_idx ON {{schema}}.incidents(started_at DESC);

CREATE TABLE IF NOT EXISTS {{schema}}.audit_logs (
  id         uuid PRIMARY KEY,
  ts         timestamptz NOT NULL,
  operator   text NOT NULL,
  action     text NOT NULL,
  category   text NOT NULL,
  target_id  text NOT NULL DEFAULT '',
  details    text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_logs_ts_idx ON {{schema}}.audit_logs(ts DESC);

-- ── Operational records (stored as documents) ────────────────────────────────
CREATE TABLE IF NOT EXISTS {{schema}}.channels            (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS {{schema}}.escalation_policies (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS {{schema}}.maintenance_windows (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS {{schema}}.runbooks            (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS {{schema}}.deployments         (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS {{schema}}.backups             (id text PRIMARY KEY, data jsonb NOT NULL);
