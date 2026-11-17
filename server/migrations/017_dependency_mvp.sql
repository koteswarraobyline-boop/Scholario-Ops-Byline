-- Link metadata on the existing dependency_links table.
-- method is how the consumer reaches the provider. Null means not recorded.
-- updated_at is when the link was last saved. Rows from before this file get created_at.
-- Uniqueness is unchanged: one link per (from_id, to_id, feature). Method is not part of that key.
-- Does not insert rows and does not alter applications or servers.
-- The runner applies files forward only. To remove these columns before they have been saved
-- by a server that knows them:
--   ALTER TABLE {{schema}}.dependency_links DROP COLUMN IF EXISTS method;
--   ALTER TABLE {{schema}}.dependency_links DROP COLUMN IF EXISTS updated_at;

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
