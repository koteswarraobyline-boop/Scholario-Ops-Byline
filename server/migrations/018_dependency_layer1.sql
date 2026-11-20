-- Layer 1 details on the existing register.
-- A feature stays a BUSINESS_FEATURE row in registry_components. It is not a third table.
-- endpoint is a host, URL, or bucket. It is not a password.
-- criticality is empty until someone records it. The other link texts default to empty.
-- Does not insert components or links.
--
-- Safety. The runner applies this file in one transaction. A failure rolls the
-- statements and the schema_migrations row back. Data already in the database
-- is left as it was. ADD COLUMN IF NOT EXISTS and the constraint check make a
-- completed file safe if the row in schema_migrations is missing and it runs again.
-- New columns are filled before they are marked NOT NULL, so an existing row
-- is not given a null that the new rule would refuse.
--
-- Rollback. The runner does not un-apply a file that succeeded. Manual rollback,
-- only before a server that knows these columns has saved rows you need to keep:
--   ALTER TABLE {{schema}}.dependency_links DROP CONSTRAINT IF EXISTS dependency_links_criticality_chk;
--   ALTER TABLE {{schema}}.dependency_links DROP COLUMN IF EXISTS criticality;
--   ALTER TABLE {{schema}}.dependency_links DROP COLUMN IF EXISTS health_check;
--   ALTER TABLE {{schema}}.dependency_links DROP COLUMN IF EXISTS failure_behaviour;
--   ALTER TABLE {{schema}}.dependency_links DROP COLUMN IF EXISTS owner;
--   ALTER TABLE {{schema}}.dependency_links DROP COLUMN IF EXISTS recovery_expectation;
--   ALTER TABLE {{schema}}.registry_components DROP COLUMN IF EXISTS endpoint;
-- Replace {{schema}} with DB_SCHEMA (default ops). Dropping the columns discards
-- those values. It does not delete links, components, applications, or servers.
-- Delete the schema_migrations row for this file only if the file must be applied
-- again later. Do not point a build that writes these columns at a database that
-- no longer has them.

ALTER TABLE {{schema}}.registry_components
  ADD COLUMN IF NOT EXISTS endpoint text;

UPDATE {{schema}}.registry_components
  SET endpoint = ''
  WHERE endpoint IS NULL;

ALTER TABLE {{schema}}.registry_components
  ALTER COLUMN endpoint SET DEFAULT '';

ALTER TABLE {{schema}}.registry_components
  ALTER COLUMN endpoint SET NOT NULL;

ALTER TABLE {{schema}}.dependency_links
  ADD COLUMN IF NOT EXISTS criticality text;

ALTER TABLE {{schema}}.dependency_links
  ADD COLUMN IF NOT EXISTS health_check text;

ALTER TABLE {{schema}}.dependency_links
  ADD COLUMN IF NOT EXISTS failure_behaviour text;

ALTER TABLE {{schema}}.dependency_links
  ADD COLUMN IF NOT EXISTS owner text;

ALTER TABLE {{schema}}.dependency_links
  ADD COLUMN IF NOT EXISTS recovery_expectation text;

UPDATE {{schema}}.dependency_links
  SET health_check = COALESCE(health_check, ''),
      failure_behaviour = COALESCE(failure_behaviour, ''),
      owner = COALESCE(owner, ''),
      recovery_expectation = COALESCE(recovery_expectation, '');

ALTER TABLE {{schema}}.dependency_links
  ALTER COLUMN health_check SET DEFAULT '';

ALTER TABLE {{schema}}.dependency_links
  ALTER COLUMN failure_behaviour SET DEFAULT '';

ALTER TABLE {{schema}}.dependency_links
  ALTER COLUMN owner SET DEFAULT '';

ALTER TABLE {{schema}}.dependency_links
  ALTER COLUMN recovery_expectation SET DEFAULT '';

ALTER TABLE {{schema}}.dependency_links
  ALTER COLUMN health_check SET NOT NULL;

ALTER TABLE {{schema}}.dependency_links
  ALTER COLUMN failure_behaviour SET NOT NULL;

ALTER TABLE {{schema}}.dependency_links
  ALTER COLUMN owner SET NOT NULL;

ALTER TABLE {{schema}}.dependency_links
  ALTER COLUMN recovery_expectation SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dependency_links_criticality_chk'
      AND connamespace = '{{schema}}'::regnamespace
  ) THEN
    ALTER TABLE {{schema}}.dependency_links
      ADD CONSTRAINT dependency_links_criticality_chk
      CHECK (criticality IS NULL OR criticality IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW'));
  END IF;
END $$;
