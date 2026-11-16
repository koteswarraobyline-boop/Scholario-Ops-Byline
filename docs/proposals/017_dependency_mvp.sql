-- PROPOSAL ONLY. Do not copy this file into server/migrations until it is approved.
-- The server applies every NNN_*.sql in server/migrations at startup. This copy lives under
-- docs/proposals so a restart cannot run it.
--
-- Extends dependency_links. Does not create a second dependency table.
-- Does not insert rows. Does not touch applications, servers, or application_environments.
--
-- method: how the consumer reaches the provider. Nullable so a build that has not yet
-- been taught the column can still insert a link (the column is omitted and stays null).
-- updated_at: links previously stored created_at only. Backfilled from created_at.
-- DEFAULT now() applies only when a later insert omits the column.
--
-- Uniqueness is unchanged: one link per (from_id, to_id, feature). Method is not part of
-- that key, so two methods between the same pair are one row, not two.
--
-- The migration runner is forward-only. Rollback is a manual script, not 018:
--   ALTER TABLE {{schema}}.dependency_links DROP COLUMN IF EXISTS method;
--   ALTER TABLE {{schema}}.dependency_links DROP COLUMN IF EXISTS updated_at;
-- Run that only before any deployed server has started writing the new columns.
-- Dropping the columns discards method and updated_at. It does not delete links,
-- applications, or servers.

ALTER TABLE {{schema}}.dependency_links
  ADD COLUMN IF NOT EXISTS method text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dependency_links_method_chk'
      AND connamespace = '{{schema}}'::regnamespace
  ) THEN
    ALTER TABLE {{schema}}.dependency_links
      ADD CONSTRAINT dependency_links_method_chk
      CHECK (method IS NULL OR method IN ('HTTP', 'API', 'DATABASE', 'EMBED', 'LINK', 'OTHER'));
  END IF;
END $$;

ALTER TABLE {{schema}}.dependency_links
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE {{schema}}.dependency_links
  SET updated_at = created_at
  WHERE updated_at IS NULL;

ALTER TABLE {{schema}}.dependency_links
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE {{schema}}.dependency_links
  ALTER COLUMN updated_at SET DEFAULT now();
