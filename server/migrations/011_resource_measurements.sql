-- Accepted usage samples for resource limits. This is not a metrics platform.
-- Rows are written only when a measurement is accepted and the usage value changes.
-- The same resource and timestamp updates the existing sample. Deleting a resource
-- removes its samples. Nothing here is backfilled: there is no earlier usage to copy.
-- Rollback is a later migration that drops this table.

CREATE TABLE IF NOT EXISTS {{schema}}.resource_measurements (
  resource_id   uuid NOT NULL REFERENCES {{schema}}.resource_limits(id) ON DELETE CASCADE,
  measured_at   timestamptz NOT NULL,
  usage         double precision NOT NULL CHECK (usage >= 0),
  capacity      double precision,
  unit          text NOT NULL,
  source        text NOT NULL,
  alert_state   text NOT NULL,
  PRIMARY KEY (resource_id, measured_at)
);

CREATE INDEX IF NOT EXISTS resource_measurements_recent_idx
  ON {{schema}}.resource_measurements (resource_id, measured_at DESC);
