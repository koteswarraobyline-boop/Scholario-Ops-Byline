-- Indexes for the queries the server runs on a schedule (safe to re-run).

-- Metrics load at startup / retention delete filter on t only
CREATE INDEX IF NOT EXISTS server_metrics_t_idx ON {{schema}}.server_metrics(t);

-- Cloudflare origin history is read by monitor_id prefix ("cf-origin:<pool>:%")
CREATE INDEX IF NOT EXISTS check_results_monitor_prefix_idx ON {{schema}}.check_results(monitor_id text_pattern_ops, t);

-- Incident lookups by application / open state
CREATE INDEX IF NOT EXISTS incidents_application_idx ON {{schema}}.incidents(application_id);
CREATE INDEX IF NOT EXISTS incidents_open_idx ON {{schema}}.incidents(status) WHERE status NOT IN ('RESOLVED','CLOSED');

-- Monitors by server (server deletion, server status)
CREATE INDEX IF NOT EXISTS monitors_server_idx ON {{schema}}.monitors(server_id);

-- Servers by application
CREATE INDEX IF NOT EXISTS servers_application_idx ON {{schema}}.servers(application_id);
