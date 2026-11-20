-- Per-application traffic routing. Existing Load Balancer rows are not modified.
-- Method "unknown" is the default. Applications that already have a Load Balancer
-- mapping are marked cloudflare_lb. Other saved fields (DNS, pools) stay where they are.
-- Worker events are facts posted by an instrumented Worker. The table starts empty.

CREATE TABLE IF NOT EXISTS {{schema}}.application_routing (
  application_id  uuid PRIMARY KEY REFERENCES {{schema}}.applications(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  method          text NOT NULL DEFAULT 'unknown' CHECK (method IN (
    'direct_dns', 'cloudflare_lb', 'cloudflare_worker', 'cloudflare_worker_failover', 'custom', 'unknown'
  )),
  direct          jsonb NOT NULL DEFAULT '{}'::jsonb,
  worker          jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom          jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO {{schema}}.application_routing (application_id, method)
SELECT a.id,
       CASE WHEN EXISTS (
         SELECT 1 FROM {{schema}}.application_load_balancers lb WHERE lb.application_id = a.id
       ) THEN 'cloudflare_lb' ELSE 'unknown' END
FROM {{schema}}.applications a
ON CONFLICT (application_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS {{schema}}.worker_events (
  id              uuid PRIMARY KEY,
  application_id  uuid NOT NULL REFERENCES {{schema}}.applications(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  kind            text NOT NULL CHECK (kind IN ('origin_selected', 'failover', 'failback', 'origin_error', 'health')),
  origin          text,
  prd_health      text CHECK (prd_health IS NULL OR prd_health IN ('healthy', 'unhealthy', 'unknown')),
  dr_health       text CHECK (dr_health IS NULL OR dr_health IN ('healthy', 'unhealthy', 'unknown')),
  detail          text NOT NULL DEFAULT '',
  observed_at     timestamptz NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS worker_events_app_idx ON {{schema}}.worker_events (application_id, observed_at DESC);
