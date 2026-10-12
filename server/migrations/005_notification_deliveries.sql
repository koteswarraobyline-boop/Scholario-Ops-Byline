-- Every notification sent to a channel (incident FIRING / RESOLVED / ESCALATED, reminders, tests):
-- what was sent, to which channel, and whether it arrived. Shown on the Notifications page
-- (delivery log), used for per-channel statistics and to resend a failed notification.
-- Kept NOTIFICATION_LOG_RETENTION_DAYS (default 90). Channel name / type are copied so the log
-- stays readable after a channel is renamed or deleted. No channel target (URL, key, address) is stored.
CREATE TABLE IF NOT EXISTS {{schema}}.notification_deliveries (
  id            uuid PRIMARY KEY,
  t             timestamptz NOT NULL,
  channel_id    text NOT NULL,
  channel_name  text NOT NULL,
  channel_type  text NOT NULL,
  kind          text NOT NULL,           -- FIRING | RESOLVED | ESCALATED | INFO | TEST
  incident_id   text,
  severity      text NOT NULL,
  title         text NOT NULL,
  result        text NOT NULL CHECK (result IN ('DELIVERED', 'FAILED')),
  attempts      integer NOT NULL,
  duration_ms   integer NOT NULL,
  error         text,
  resend_of     uuid,
  message       jsonb NOT NULL          -- title, text, severity, status, incidentId, link: enough to resend
);
CREATE INDEX IF NOT EXISTS notification_deliveries_t_idx ON {{schema}}.notification_deliveries (t DESC);
CREATE INDEX IF NOT EXISTS notification_deliveries_channel_idx ON {{schema}}.notification_deliveries (channel_id, t DESC);
CREATE INDEX IF NOT EXISTS notification_deliveries_incident_idx ON {{schema}}.notification_deliveries (incident_id);
