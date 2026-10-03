-- Migration 009: Immutable Audit Logs and System Settings

CREATE TYPE audit_category AS ENUM (
  'AUTH', 'INCIDENT', 'FAILOVER', 'MAINTENANCE', 'MONITOR',
  'CLOUDFLARE', 'INFRASTRUCTURE', 'RUNBOOK', 'USER', 'SYSTEM', 'NOTIFICATION'
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  operator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  operator    VARCHAR(255) NOT NULL,
  action      VARCHAR(200) NOT NULL,
  category    audit_category NOT NULL,
  target_id   VARCHAR(255),
  target_type VARCHAR(100),
  details     TEXT,
  metadata    JSONB DEFAULT '{}',
  ip_address  INET,
  user_agent  TEXT,
  request_id  VARCHAR(100)
);

-- Audit logs are append-only — no UPDATE or DELETE should be performed on this table.
-- Enforce via application-level convention and database permissions.

-- System-wide settings key/value store
CREATE TABLE IF NOT EXISTS system_settings (
  key         VARCHAR(200) PRIMARY KEY,
  value       TEXT,
  description TEXT,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for audit log queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp  ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_operator   ON audit_logs(operator_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_category   ON audit_logs(category);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target     ON audit_logs(target_id);

-- Schema version tracking for migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(20) PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  description TEXT
);
