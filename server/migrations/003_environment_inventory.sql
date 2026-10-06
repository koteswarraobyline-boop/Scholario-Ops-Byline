-- Per-environment inventory for an application (PRD / DR). Every column is optional:
-- NULL means "not confirmed yet" and is shown as UNKNOWN / PENDING — never guessed.
CREATE TABLE IF NOT EXISTS {{schema}}.application_environments (
  application_id        uuid NOT NULL REFERENCES {{schema}}.applications(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  environment           text NOT NULL CHECK (environment IN ('PRD','DR')),
  app_port              integer CHECK (app_port IS NULL OR app_port BETWEEN 1 AND 65535),
  health_path           text,
  web_server            text,
  process_manager       text,
  routing               text,
  -- Database the agent should probe on this server (engine NULL = database monitoring not configured)
  db_engine             text CHECK (db_engine IS NULL OR db_engine IN ('mysql','mariadb','postgresql')),
  db_name               text,
  db_port               integer CHECK (db_port IS NULL OR db_port BETWEEN 1 AND 65535),
  -- Thresholds
  replication_max_lag_sec integer CHECK (replication_max_lag_sec IS NULL OR replication_max_lag_sec >= 0),
  backup_max_age_hours  integer CHECK (backup_max_age_hours IS NULL OR backup_max_age_hours > 0),
  notes                 text NOT NULL DEFAULT '',
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (application_id, environment)
);
