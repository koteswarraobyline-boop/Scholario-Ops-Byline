-- Agent >= 3.3: extra 1-minute rollup series. All nullable: NULL = not reported (older agent,
-- no swap configured, platform without the counter) — never stored as a made-up 0.
-- Same table, same retention (METRICS_RETENTION_HOURS); existing rows are untouched.
ALTER TABLE {{schema}}.server_metrics ADD COLUMN IF NOT EXISTS swap       double precision;
ALTER TABLE {{schema}}.server_metrics ADD COLUMN IF NOT EXISTS iowait     double precision;
ALTER TABLE {{schema}}.server_metrics ADD COLUMN IF NOT EXISTS steal      double precision;
ALTER TABLE {{schema}}.server_metrics ADD COLUMN IF NOT EXISTS disk_read  double precision;
ALTER TABLE {{schema}}.server_metrics ADD COLUMN IF NOT EXISTS disk_write double precision;
ALTER TABLE {{schema}}.server_metrics ADD COLUMN IF NOT EXISTS disk_util  double precision;
