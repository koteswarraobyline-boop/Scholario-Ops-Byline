-- Dependency register: what the business runs on (applications, servers, databases, storage,
-- third-party APIs, providers, business features) and "A depends on B" links between them.
CREATE TABLE IF NOT EXISTS {{schema}}.registry_components (
  id              uuid PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('APPLICATION','SERVER','DATABASE','STORAGE','THIRD_PARTY_API','PROVIDER','BUSINESS_FEATURE')),
  name            text NOT NULL CHECK (btrim(name) <> ''),
  owner           text NOT NULL CHECK (btrim(owner) <> ''),
  tier            text NOT NULL CHECK (tier IN ('TIER_1','TIER_2','TIER_3')),
  description     text NOT NULL DEFAULT '',
  application_id  uuid REFERENCES {{schema}}.applications(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  server_id       uuid REFERENCES {{schema}}.servers(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  user_count      integer CHECK (user_count >= 0),
  served          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(served) = 'array'),
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  CHECK (application_id IS NULL OR kind IN ('APPLICATION','BUSINESS_FEATURE')),
  CHECK (server_id IS NULL OR kind = 'SERVER'),
  CHECK (user_count IS NULL OR kind IN ('APPLICATION','BUSINESS_FEATURE')),
  CHECK (served = '[]'::jsonb OR kind IN ('APPLICATION','BUSINESS_FEATURE'))
);
CREATE UNIQUE INDEX IF NOT EXISTS registry_components_name_uq ON {{schema}}.registry_components (kind, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS registry_components_app_uq ON {{schema}}.registry_components (application_id) WHERE kind = 'APPLICATION';
CREATE UNIQUE INDEX IF NOT EXISTS registry_components_server_uq ON {{schema}}.registry_components (server_id) WHERE kind = 'SERVER';

CREATE TABLE IF NOT EXISTS {{schema}}.dependency_links (
  id          uuid PRIMARY KEY,
  from_id     uuid NOT NULL REFERENCES {{schema}}.registry_components(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  to_id       uuid NOT NULL REFERENCES {{schema}}.registry_components(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  link_type   text NOT NULL CHECK (link_type IN ('HARD','SOFT')),
  feature_id  uuid REFERENCES {{schema}}.registry_components(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  notes       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL,
  CHECK (from_id <> to_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS dependency_links_uq ON {{schema}}.dependency_links (from_id, to_id, coalesce(feature_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS dependency_links_to_idx ON {{schema}}.dependency_links (to_id);
