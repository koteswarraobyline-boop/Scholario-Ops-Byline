-- Load average is its own capacity kind. Usage is the 1-minute load divided by CPU cores.
-- Warning at 1 per core, critical at 2. Capacity stays empty: a core count is not a load limit.
-- Rollback is a later migration. This runner applies files forward only. Safe to re-run.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    WHERE con.conrelid = '{{schema}}.resource_limits'::regclass
      AND con.contype = 'c'
  LOOP
    IF r.def LIKE '%server-plan%'
      OR r.def LIKE '%millicores%'
      OR (r.def LIKE '%''SEATS''%' AND r.def LIKE '%''CPU''%' AND r.def NOT LIKE '%quota_window%') THEN
      EXECUTE format('ALTER TABLE {{schema}}.resource_limits DROP CONSTRAINT %I', r.conname);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'resource_limits_kind_chk' AND connamespace = '{{schema}}'::regnamespace
  ) THEN
    ALTER TABLE {{schema}}.resource_limits
      ADD CONSTRAINT resource_limits_kind_chk CHECK (kind IN (
        'CPU','MEMORY','SERVER_DISK','STORAGE','SEATS','ACTIVE_USERS',
        'DATABASE_SIZE','DATABASE_CONNECTIONS','API_QUOTA','LOAD'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'resource_limits_unit_chk' AND connamespace = '{{schema}}'::regnamespace
  ) THEN
    ALTER TABLE {{schema}}.resource_limits
      ADD CONSTRAINT resource_limits_unit_chk CHECK (
        (kind = 'CPU' AND unit IN ('cores','millicores','percent')) OR
        (kind IN ('MEMORY','SERVER_DISK','STORAGE','DATABASE_SIZE') AND unit IN ('bytes','GiB','GB')) OR
        (kind = 'SEATS' AND unit = 'seats') OR
        (kind = 'ACTIVE_USERS' AND unit = 'users') OR
        (kind = 'DATABASE_CONNECTIONS' AND unit = 'connections') OR
        (kind = 'API_QUOTA' AND unit = 'requests') OR
        (kind = 'LOAD' AND unit = 'load')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'resource_limits_managed_chk' AND connamespace = '{{schema}}'::regnamespace
  ) THEN
    ALTER TABLE {{schema}}.resource_limits
      ADD CONSTRAINT resource_limits_managed_chk CHECK (
        managed_by IS NULL OR managed_by IN ('server-plan','agent-db','agent-load')
      );
  END IF;
END $$;
