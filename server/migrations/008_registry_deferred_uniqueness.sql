-- Dependency register uniqueness checked at COMMIT instead of row by row, so one save that swaps
-- two names (or renames an entry and creates one with its old name) is accepted, exactly as the
-- API's own check accepts it. Unique indexes cannot be deferred; constraints can.
--
-- Names are compared by name_key, which the application computes (server/registryName.ts) and
-- writes with every row: PostgreSQL's lower() depends on the database locale and disagrees with
-- the application's case folding for some letters, which would let the database reject a save
-- the API had accepted. Rows that already exist get lower(name) here, which is the same value the
-- index dropped below already enforced, so this file does not fail on pairs that lower() treats
-- as different and the application treats as the same (Straße / STRASSE). Startup refuses to
-- serve if any such pair is loaded, and it does not write. A failure anywhere in this file rolls
-- the whole file back, including the schema_migrations row. Safe to re-run.
ALTER TABLE {{schema}}.registry_components ADD COLUMN IF NOT EXISTS name_key text;
UPDATE {{schema}}.registry_components SET name_key = lower(name) WHERE name_key IS NULL;
ALTER TABLE {{schema}}.registry_components ALTER COLUMN name_key SET NOT NULL;

DROP INDEX IF EXISTS {{schema}}.registry_components_name_uq;
DROP INDEX IF EXISTS {{schema}}.registry_components_app_uq;
DROP INDEX IF EXISTS {{schema}}.registry_components_server_uq;
DROP INDEX IF EXISTS {{schema}}.dependency_links_uq;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registry_components_name_key_uq' AND connamespace = '{{schema}}'::regnamespace) THEN
    ALTER TABLE {{schema}}.registry_components ADD CONSTRAINT registry_components_name_key_uq
      UNIQUE (kind, name_key) DEFERRABLE INITIALLY DEFERRED;
  END IF;
  -- One register entry per registered application / server (exclusion = deferrable partial unique)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registry_components_app_excl' AND connamespace = '{{schema}}'::regnamespace) THEN
    ALTER TABLE {{schema}}.registry_components ADD CONSTRAINT registry_components_app_excl
      EXCLUDE USING btree (application_id WITH =) WHERE (kind = 'APPLICATION') DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registry_components_server_excl' AND connamespace = '{{schema}}'::regnamespace) THEN
    ALTER TABLE {{schema}}.registry_components ADD CONSTRAINT registry_components_server_excl
      EXCLUDE USING btree (server_id WITH =) WHERE (kind = 'SERVER') DEFERRABLE INITIALLY DEFERRED;
  END IF;
  -- One link per (A, B, feature); "no feature" counts as one value
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dependency_links_excl' AND connamespace = '{{schema}}'::regnamespace) THEN
    ALTER TABLE {{schema}}.dependency_links ADD CONSTRAINT dependency_links_excl
      EXCLUDE USING btree (from_id WITH =, to_id WITH =, (coalesce(feature_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;
