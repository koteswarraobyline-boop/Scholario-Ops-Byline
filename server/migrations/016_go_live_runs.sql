-- Recorded go-live checks (URLs, agents, Cloudflare pools and origins, DR score) and any logged defect.
CREATE TABLE IF NOT EXISTS {{schema}}.go_live_runs (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
