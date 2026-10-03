-- Migration 006: Incidents, Events, Notes, Assignments

CREATE TYPE incident_severity AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL', 'EMERGENCY');

CREATE TYPE incident_status AS ENUM (
  'OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'MITIGATING', 'MONITORING', 'RESOLVED', 'CLOSED'
);

CREATE TABLE IF NOT EXISTS incidents (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_number         VARCHAR(20) UNIQUE NOT NULL, -- e.g. INC-1042
  title                 VARCHAR(500) NOT NULL,
  severity              incident_severity NOT NULL DEFAULT 'WARNING',
  status                incident_status NOT NULL DEFAULT 'OPEN',
  application_id        UUID REFERENCES applications(id) ON DELETE SET NULL,
  server_id             UUID REFERENCES servers(id) ON DELETE SET NULL,
  monitor_id            UUID REFERENCES monitors(id) ON DELETE SET NULL,
  environment           environment_type NOT NULL DEFAULT 'PRD',
  fingerprint           VARCHAR(500) NOT NULL,  -- deduplication key
  root_cause            TEXT,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ,
  duration_minutes      INT,
  owner_id              UUID REFERENCES users(id) ON DELETE SET NULL,
  owner_name            VARCHAR(255),           -- denormalized for display
  acknowledged          BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_at       TIMESTAMPTZ,
  acknowledged_by_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_by_name  VARCHAR(255),
  affected_services     TEXT[],
  affected_monitors     TEXT[],
  dependent_failures    TEXT[],
  recovery_status       TEXT,
  runbook_id            UUID,
  mitigation_action     TEXT,
  -- Correlation
  triggered_by_deployment_id UUID,  -- FK added after deployments table
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incident_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id  UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  source       VARCHAR(255) NOT NULL,
  level        VARCHAR(20) NOT NULL DEFAULT 'INFO',  -- INFO | WARN | CRITICAL | SUCCESS
  message      TEXT NOT NULL,
  metadata     JSONB DEFAULT '{}',
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incident_notes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id  UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  author_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  author_name  VARCHAR(255) NOT NULL,
  author_role  VARCHAR(100),
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ticket number sequence helper
CREATE SEQUENCE IF NOT EXISTS incident_ticket_seq START 1000;

CREATE INDEX IF NOT EXISTS idx_incidents_fingerprint ON incidents(fingerprint);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status) WHERE status NOT IN ('RESOLVED', 'CLOSED');
CREATE INDEX IF NOT EXISTS idx_incidents_application ON incidents(application_id);
CREATE INDEX IF NOT EXISTS idx_incidents_started ON incidents(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_events_incident ON incident_events(incident_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_notes_incident ON incident_notes(incident_id);
