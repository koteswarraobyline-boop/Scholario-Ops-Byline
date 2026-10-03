-- Migration 002: Authentication — users, roles, permissions, RBAC

CREATE TABLE IF NOT EXISTS roles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action      VARCHAR(100) NOT NULL,  -- e.g. 'incidents:acknowledge'
  resource    VARCHAR(100) NOT NULL,  -- e.g. 'incidents'
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (action, resource)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email                 VARCHAR(255) UNIQUE NOT NULL,
  password_hash         VARCHAR(255) NOT NULL,
  full_name             VARCHAR(255) NOT NULL,
  display_name          VARCHAR(100),
  avatar_url            TEXT,
  role_id               UUID NOT NULL REFERENCES roles(id),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  is_on_call            BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at         TIMESTAMPTZ,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  password_reset_token  VARCHAR(255),
  password_reset_expires TIMESTAMPTZ,
  activation_token      VARCHAR(255),
  activated_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ  -- soft delete
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- Seed default roles
INSERT INTO roles (id, name, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'viewer',           'Read-only access to all dashboards and reports'),
  ('00000000-0000-0000-0000-000000000002', 'operator',         'Can acknowledge incidents, run probes, execute runbooks'),
  ('00000000-0000-0000-0000-000000000003', 'it_administrator', 'Manage monitors, applications, servers, users'),
  ('00000000-0000-0000-0000-000000000004', 'super_admin',      'Full system access')
ON CONFLICT (name) DO NOTHING;

-- Seed permissions
INSERT INTO permissions (action, resource) VALUES
  -- Viewing
  ('read', 'applications'),
  ('read', 'servers'),
  ('read', 'monitors'),
  ('read', 'incidents'),
  ('read', 'backups'),
  ('read', 'deployments'),
  ('read', 'runbooks'),
  ('read', 'maintenance'),
  ('read', 'communications'),
  ('read', 'reports'),
  ('read', 'audit_logs'),
  ('read', 'cloudflare'),
  ('read', 'hostinger'),
  ('read', 'dependencies'),
  -- Operator
  ('acknowledge', 'incidents'),
  ('update_status', 'incidents'),
  ('add_note', 'incidents'),
  ('assign', 'incidents'),
  ('resolve', 'incidents'),
  ('execute', 'runbooks'),
  ('run', 'monitors'),
  ('create', 'maintenance'),
  ('update', 'maintenance'),
  -- IT Admin
  ('create', 'applications'),
  ('update', 'applications'),
  ('delete', 'applications'),
  ('create', 'servers'),
  ('update', 'servers'),
  ('delete', 'servers'),
  ('create', 'monitors'),
  ('update', 'monitors'),
  ('delete', 'monitors'),
  ('manage', 'communications'),
  ('manage', 'escalations'),
  ('manage', 'users'),
  -- Super Admin
  ('manage', 'roles'),
  ('manage', 'system'),
  ('failover', 'applications'),
  ('failback', 'applications')
ON CONFLICT (action, resource) DO NOTHING;
