-- Provider accounts and the VPS inventory each account last reported.
-- token_env is the environment variable NAME. The token value is never stored here.
-- Adding another provider later requires a new migration that extends these checks.

CREATE TABLE IF NOT EXISTS {{schema}}.provider_connections (
  id              uuid PRIMARY KEY,
  name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  provider        text NOT NULL CHECK (provider IN ('hostinger')),
  token_env       text NOT NULL CHECK (token_env ~ '^HOSTINGER_([A-Z][A-Z0-9]*(_[A-Z0-9]+)*_)?API_TOKEN$'),
  sync_enabled    boolean NOT NULL DEFAULT true,
  legacy          boolean NOT NULL DEFAULT false,
  status          text NOT NULL CHECK (status IN ('NOT_CONFIGURED','OK','AUTH_FAILED','RATE_LIMITED','ERROR','PENDING')),
  last_sync_at    timestamptz,
  last_success_at timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_connections_name_uq ON {{schema}}.provider_connections (lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS provider_connections_token_env_uq ON {{schema}}.provider_connections (token_env);
CREATE UNIQUE INDEX IF NOT EXISTS provider_connections_one_legacy_uq ON {{schema}}.provider_connections (provider) WHERE legacy;

CREATE TABLE IF NOT EXISTS {{schema}}.provider_instances (
  id              uuid PRIMARY KEY,
  connection_id   uuid NOT NULL REFERENCES {{schema}}.provider_connections(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  provider_vm_id  text NOT NULL CHECK (btrim(provider_vm_id) <> ''),
  hostname        text,
  ipv4            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(ipv4) = 'array'),
  ipv6            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(ipv6) = 'array'),
  os              text,
  region          text,
  plan            text,
  cpu             integer CHECK (cpu IS NULL OR cpu >= 0),
  ram_gb          integer CHECK (ram_gb IS NULL OR ram_gb >= 0),
  disk_gb         integer CHECK (disk_gb IS NULL OR disk_gb >= 0),
  power_state     text,
  status          text NOT NULL CHECK (status IN ('HEALTHY','DEGRADED','UNAVAILABLE','UNKNOWN')),
  fetched_at      timestamptz,
  last_seen_at    timestamptz,
  absent          boolean NOT NULL DEFAULT false,
  UNIQUE (connection_id, provider_vm_id)
);
CREATE INDEX IF NOT EXISTS provider_instances_connection_idx ON {{schema}}.provider_instances (connection_id);
