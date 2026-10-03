-- Migration 007: Notification Channels, Deliveries, Escalation Policies

CREATE TYPE channel_type AS ENUM ('TEAMS', 'EMAIL', 'WEBHOOK', 'PAGERDUTY');
CREATE TYPE delivery_status AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'RETRYING');

CREATE TABLE IF NOT EXISTS notification_channels (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                 VARCHAR(255) NOT NULL,
  type                 channel_type NOT NULL,
  enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  target_endpoint      TEXT NOT NULL,   -- webhook URL, email address, etc.
  last_delivery_at     TIMESTAMPTZ,
  last_delivery_status delivery_status,
  failure_count        INT NOT NULL DEFAULT 0,
  -- Type-specific config stored as JSONB
  config               JSONB DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id      UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  incident_id     UUID REFERENCES incidents(id) ON DELETE SET NULL,
  event_type      VARCHAR(100) NOT NULL,   -- e.g. 'incident.created', 'test'
  status          delivery_status NOT NULL DEFAULT 'PENDING',
  payload         JSONB,
  response_code   INT,
  response_body   TEXT,
  error           TEXT,
  attempt_count   INT NOT NULL DEFAULT 0,
  next_retry_at   TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS escalation_policies (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  VARCHAR(255) NOT NULL,
  severity              incident_severity NOT NULL,
  initial_delay_min     INT NOT NULL DEFAULT 0,
  repeat_interval_min   INT NOT NULL DEFAULT 15,
  auto_escalate_after_min INT NOT NULL DEFAULT 30,
  escalate_to_team      VARCHAR(255),
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS escalation_steps (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  policy_id             UUID NOT NULL REFERENCES escalation_policies(id) ON DELETE CASCADE,
  step_order            INT NOT NULL DEFAULT 1,
  channel_id            UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  delay_min             INT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (policy_id, step_order)
);

-- Track active escalations per incident
CREATE TABLE IF NOT EXISTS active_escalations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id       UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  policy_id         UUID NOT NULL REFERENCES escalation_policies(id) ON DELETE CASCADE,
  current_step      INT NOT NULL DEFAULT 1,
  next_escalate_at  TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (incident_id, policy_id)
);

CREATE INDEX IF NOT EXISTS idx_deliveries_channel ON notification_deliveries(channel_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_incident ON notification_deliveries(incident_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON notification_deliveries(status) WHERE status IN ('PENDING', 'RETRYING');
CREATE INDEX IF NOT EXISTS idx_escalation_steps_policy ON escalation_steps(policy_id);
CREATE INDEX IF NOT EXISTS idx_active_escalations_next ON active_escalations(next_escalate_at);
