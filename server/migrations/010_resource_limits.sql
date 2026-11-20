-- Resource limits: one row per capacity (CPU, memory, disk, storage, seats, active users,
-- database size, database connections, API quota).
-- A null capacity is unknown. unlimited is not stored as zero.
-- A null usage has not been measured. Existing registry user_count values are headcounts
-- and are not copied into a seat limit.
-- Rollback is a later migration that drops this table. This runner applies files forward only.

CREATE TABLE IF NOT EXISTS {{schema}}.resource_limits (
  id                    uuid PRIMARY KEY,
  resource_key          text NOT NULL CHECK (char_length(resource_key) BETWEEN 1 AND 160),
  kind                  text NOT NULL CHECK (kind IN (
                          'CPU','MEMORY','SERVER_DISK','STORAGE','SEATS','ACTIVE_USERS',
                          'DATABASE_SIZE','DATABASE_CONNECTIONS','API_QUOTA')),
  name                  text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  description           text NOT NULL DEFAULT '',
  owner                 text NOT NULL CHECK (char_length(btrim(owner)) BETWEEN 1 AND 200),
  server_id             uuid REFERENCES {{schema}}.servers(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  application_id        uuid REFERENCES {{schema}}.applications(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  capacity              double precision,
  unlimited             boolean NOT NULL DEFAULT false,
  usage                 double precision,
  unit                  text NOT NULL,
  source                text NOT NULL CHECK (source IN ('manual','config','provider','discovered')),
  threshold_mode        text NOT NULL CHECK (threshold_mode IN ('percent','absolute')),
  warning_value         double precision,
  critical_value        double precision,
  hard_limit            double precision,
  recovery_margin       double precision NOT NULL DEFAULT 2 CHECK (recovery_margin >= 0 AND recovery_margin <= 1000000),
  quota_window          text CHECK (quota_window IS NULL OR quota_window IN ('minute','hour','day')),
  measured_at           timestamptz,
  last_sync_at          timestamptz,
  freshness             text NOT NULL CHECK (freshness IN ('FRESH','STALE','MISSING','ERROR','UNKNOWN')),
  sync_error            text NOT NULL DEFAULT '',
  enabled               boolean NOT NULL DEFAULT true,
  alert_state           text NOT NULL CHECK (alert_state IN ('NORMAL','WARNING','CRITICAL','EXCEEDED','STALE','UNKNOWN')),
  alert_since           timestamptz,
  managed_by            text CHECK (managed_by IS NULL OR managed_by IN ('server-plan','agent-db')),
  last_measurement_id   text,
  created_at            timestamptz NOT NULL,
  updated_at            timestamptz NOT NULL,
  CHECK (capacity IS NULL OR capacity > 0),
  CHECK (NOT unlimited OR capacity IS NULL),
  CHECK (usage IS NULL OR usage >= 0),
  CHECK (hard_limit IS NULL OR hard_limit > 0),
  CHECK ((kind = 'API_QUOTA') = (quota_window IS NOT NULL)),
  CHECK (
    (kind = 'CPU' AND unit IN ('cores','millicores','percent')) OR
    (kind IN ('MEMORY','SERVER_DISK','STORAGE','DATABASE_SIZE') AND unit IN ('bytes','GiB','GB')) OR
    (kind = 'SEATS' AND unit = 'seats') OR
    (kind = 'ACTIVE_USERS' AND unit = 'users') OR
    (kind = 'DATABASE_CONNECTIONS' AND unit = 'connections') OR
    (kind = 'API_QUOTA' AND unit = 'requests')
  ),
  CHECK (
    (warning_value IS NULL AND critical_value IS NULL) OR
    (threshold_mode = 'percent' AND warning_value > 0 AND critical_value > warning_value AND critical_value <= 100 AND recovery_margin < warning_value) OR
    (threshold_mode = 'absolute' AND warning_value > 0 AND critical_value > warning_value AND recovery_margin < warning_value)
  ),
  CHECK (NOT unlimited OR threshold_mode = 'absolute' OR warning_value IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS resource_limits_key_uq ON {{schema}}.resource_limits (resource_key);
CREATE INDEX IF NOT EXISTS resource_limits_kind_idx ON {{schema}}.resource_limits (kind);
CREATE INDEX IF NOT EXISTS resource_limits_owner_idx ON {{schema}}.resource_limits (owner);
CREATE INDEX IF NOT EXISTS resource_limits_server_idx ON {{schema}}.resource_limits (server_id);
CREATE INDEX IF NOT EXISTS resource_limits_app_idx ON {{schema}}.resource_limits (application_id);
CREATE INDEX IF NOT EXISTS resource_limits_state_idx ON {{schema}}.resource_limits (alert_state);
CREATE INDEX IF NOT EXISTS resource_limits_measured_idx ON {{schema}}.resource_limits (measured_at);

-- Trustworthy backfill: purchased server plan numbers that are already stored.
-- Usage is left null. Seat counts and provider guesses are not invented.
INSERT INTO {{schema}}.resource_limits (
  id, resource_key, kind, name, description, owner, server_id, application_id,
  capacity, unlimited, usage, unit, source, threshold_mode, warning_value, critical_value, hard_limit,
  recovery_margin, quota_window, measured_at, last_sync_at, freshness, sync_error, enabled,
  alert_state, alert_since, managed_by, last_measurement_id, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'server:' || s.id::text || ':' || part.suffix,
  part.kind,
  s.hostname || part.label,
  'Purchased plan ' || coalesce(nullif(btrim(s.plan_name), ''), 'capacity') || '. Usage stays empty until a measurement arrives.',
  'Infrastructure',
  s.id,
  NULL,
  part.capacity,
  false,
  NULL,
  part.unit,
  CASE s.plan_source WHEN 'hostinger' THEN 'provider' WHEN 'config' THEN 'config' ELSE 'manual' END,
  'percent',
  NULL, NULL, NULL,
  2,
  NULL,
  NULL,
  now(),
  'MISSING',
  '',
  true,
  'UNKNOWN',
  NULL,
  'server-plan',
  NULL,
  now(),
  now()
FROM {{schema}}.servers s
CROSS JOIN LATERAL (
  VALUES
    ('cpu', 'CPU', ' CPU', s.plan_cpu_cores::double precision, 'cores'),
    ('memory', 'MEMORY', ' memory', s.plan_ram_gb::double precision, CASE WHEN s.plan_source = 'hostinger' THEN 'GiB' ELSE 'GB' END),
    ('disk', 'SERVER_DISK', ' disk', s.plan_disk_gb::double precision, CASE WHEN s.plan_source = 'hostinger' THEN 'GiB' ELSE 'GB' END)
) AS part(suffix, kind, label, capacity, unit)
WHERE s.plan_cpu_cores > 0 AND s.plan_ram_gb > 0 AND s.plan_disk_gb > 0
ON CONFLICT (resource_key) DO NOTHING;
