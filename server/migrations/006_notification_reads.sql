-- Per-user read state of the notification delivery log.
-- A delivery is READ for a user when an explicit mark says so, or when it is older than the user's
-- "mark all read" time and has not been explicitly marked unread since. "Mark all read" is therefore
-- one row per user, however long the log is. Marks disappear with their delivery (retention).
CREATE TABLE IF NOT EXISTS {{schema}}.notification_read_marks (
  user_id          text PRIMARY KEY,
  all_read_before  timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS {{schema}}.notification_reads (
  user_id      text NOT NULL,
  delivery_id  uuid NOT NULL REFERENCES {{schema}}.notification_deliveries(id) ON DELETE CASCADE,
  is_read      boolean NOT NULL,
  marked_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, delivery_id)
);
CREATE INDEX IF NOT EXISTS notification_reads_delivery_idx ON {{schema}}.notification_reads (delivery_id);
