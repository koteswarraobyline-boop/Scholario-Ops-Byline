-- Migration 010: Assign permissions to roles

-- ─── Helper: get role id ──────────────────────────────────────────────────────
-- viewer (1) — read-only across all resources
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'viewer'
  AND p.action = 'read'
ON CONFLICT DO NOTHING;

-- operator (2) — viewer + incident actions + run probes + execute runbooks + maintenance
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'operator'
  AND (
    p.action = 'read'
    OR (p.action = 'acknowledge'    AND p.resource = 'incidents')
    OR (p.action = 'update_status'  AND p.resource = 'incidents')
    OR (p.action = 'add_note'       AND p.resource = 'incidents')
    OR (p.action = 'assign'         AND p.resource = 'incidents')
    OR (p.action = 'resolve'        AND p.resource = 'incidents')
    OR (p.action = 'execute'        AND p.resource = 'runbooks')
    OR (p.action = 'run'            AND p.resource = 'monitors')
    OR (p.action = 'create'         AND p.resource = 'maintenance')
    OR (p.action = 'update'         AND p.resource = 'maintenance')
  )
ON CONFLICT DO NOTHING;

-- it_administrator (3) — operator + manage monitors/apps/servers/comms/users
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'it_administrator'
  AND (
    p.action = 'read'
    OR (p.action = 'acknowledge'    AND p.resource = 'incidents')
    OR (p.action = 'update_status'  AND p.resource = 'incidents')
    OR (p.action = 'add_note'       AND p.resource = 'incidents')
    OR (p.action = 'assign'         AND p.resource = 'incidents')
    OR (p.action = 'resolve'        AND p.resource = 'incidents')
    OR (p.action = 'execute'        AND p.resource = 'runbooks')
    OR (p.action = 'run'            AND p.resource = 'monitors')
    OR (p.action IN ('create','update','delete') AND p.resource = 'monitors')
    OR (p.action IN ('create','update','delete') AND p.resource = 'applications')
    OR (p.action IN ('create','update','delete') AND p.resource = 'servers')
    OR (p.action = 'manage'         AND p.resource = 'communications')
    OR (p.action = 'manage'         AND p.resource = 'escalations')
    OR (p.action = 'manage'         AND p.resource = 'users')
    OR (p.action IN ('create','update') AND p.resource = 'maintenance')
  )
ON CONFLICT DO NOTHING;

-- super_admin (4) — all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;
