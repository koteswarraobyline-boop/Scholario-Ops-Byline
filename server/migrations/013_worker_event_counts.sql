-- Optional request and error counts posted with a Worker event. Null means that event did not include a count.
ALTER TABLE {{schema}}.worker_events ADD COLUMN IF NOT EXISTS requests integer;
ALTER TABLE {{schema}}.worker_events ADD COLUMN IF NOT EXISTS errors integer;
ALTER TABLE {{schema}}.worker_events DROP CONSTRAINT IF EXISTS worker_events_requests_nonneg;
ALTER TABLE {{schema}}.worker_events DROP CONSTRAINT IF EXISTS worker_events_errors_nonneg;
ALTER TABLE {{schema}}.worker_events ADD CONSTRAINT worker_events_requests_nonneg CHECK (requests IS NULL OR requests >= 0);
ALTER TABLE {{schema}}.worker_events ADD CONSTRAINT worker_events_errors_nonneg CHECK (errors IS NULL OR errors >= 0);
