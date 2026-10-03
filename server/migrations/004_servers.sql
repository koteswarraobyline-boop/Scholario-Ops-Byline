-- Migration 004: VPS Servers, Telemetry, Services, Processes, Logs

CREATE TYPE server_region AS ENUM ('Singapore', 'Frankfurt', 'Mumbai', 'London');
CREATE TYPE agent_status  AS ENUM ('CONNECTED', 'STALE', 'DISCONNECTED');

CREATE TABLE IF NOT EXISTS servers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hostname        VARCHAR(255) UNIQUE NOT NULL,
  ip              INET NOT NULL,
  application_id  UUID REFERENCES applications(id) ON DELETE SET NULL,
  environment     environment_type NOT NULL DEFAULT 'PRD',
  provider        VARCHAR(50) NOT NULL DEFAULT 'Hostinger',
  region          server_region NOT NULL,
  plan            VARCHAR(255),
  cpu_cores       INT,
  ram_gb          INT,
  disk_gb         INT,
  os              VARCHAR(255),
  status          operational_status NOT NULL DEFAULT 'UNKNOWN',
  agent_version   VARCHAR(50),
  agent_status    agent_status NOT NULL DEFAULT 'DISCONNECTED',
  uptime_days     INT,
  last_seen       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- Add FK from applications to servers (circular ref resolved after both tables exist)
ALTER TABLE applications
  ADD CONSTRAINT fk_app_prd_server FOREIGN KEY (prd_server_id) REFERENCES servers(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_app_dr_server  FOREIGN KEY (dr_server_id)  REFERENCES servers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS server_metrics (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id       UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  cpu_percent     NUMERIC(5,2),
  ram_percent     NUMERIC(5,2),
  disk_percent    NUMERIC(5,2),
  load_avg_1m     NUMERIC(6,2),
  load_avg_5m     NUMERIC(6,2),
  load_avg_15m    NUMERIC(6,2),
  network_in_kbps NUMERIC(10,2),
  network_out_kbps NUMERIC(10,2),
  observed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS server_services (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  status      VARCHAR(50),      -- active | inactive | failed | restarting
  version     VARCHAR(100),
  pid         INT,
  memory_mb   NUMERIC(8,2),
  cpu_percent NUMERIC(5,2),
  last_restart VARCHAR(255),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS server_processes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  pid         INT,
  name        VARCHAR(255),
  "user"      VARCHAR(100),
  cpu_percent NUMERIC(5,2),
  mem_mb      NUMERIC(8,2),
  status      VARCHAR(50),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS server_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  level       VARCHAR(20) NOT NULL DEFAULT 'info',   -- info | warn | error
  service     VARCHAR(100),
  message     TEXT NOT NULL,
  logged_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for telemetry queries
CREATE INDEX IF NOT EXISTS idx_servers_application ON servers(application_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_server_metrics_server_time ON server_metrics(server_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_server_services_server ON server_services(server_id);
CREATE INDEX IF NOT EXISTS idx_server_logs_server_time ON server_logs(server_id, logged_at DESC);

-- Keep only last 24h of detailed metrics per server (managed by cleanup worker)
-- This index supports the cleanup query
CREATE INDEX IF NOT EXISTS idx_server_metrics_observed ON server_metrics(observed_at);
