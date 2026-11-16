-- API keys, tokens and subscriptions tracked by expiry. The secret is never stored.
CREATE TABLE IF NOT EXISTS {{schema}}.tracked_credentials (
  id              uuid PRIMARY KEY,
  name            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('API_KEY', 'TOKEN', 'SUBSCRIPTION')),
  provider        text NOT NULL DEFAULT '',
  application_id  uuid REFERENCES {{schema}}.applications(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  owner           text NOT NULL DEFAULT '',
  environment     text NOT NULL CHECK (environment IN ('PRD', 'DR')),
  expires_at      timestamptz NOT NULL,
  notes           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tracked_credentials_expires_idx ON {{schema}}.tracked_credentials(expires_at);
