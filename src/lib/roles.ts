/**
 * Nested roles. A higher role includes every right of the roles below it.
 * The numbers match server/auth.ts ROLE_LEVEL. The API is the real check;
 * the dashboard uses this so a button is hidden for the same minimum role.
 */
export type RoleName = 'viewer' | 'operator' | 'it_administrator' | 'super_admin';

export const ROLE_LEVEL: Record<RoleName, number> = {
  viewer: 1,
  operator: 2,
  it_administrator: 3,
  super_admin: 4,
};

export function hasMinRole(role: string | null | undefined, minRole: RoleName): boolean {
  const level = role ? ROLE_LEVEL[role as RoleName] ?? 0 : 0;
  return level >= ROLE_LEVEL[minRole];
}

const OPERATOR_ACTIONS = [
  'acknowledge_incident', 'resolve_incident', 'add_note', 'assign_incident', 'declare_incident',
  'run_probe', 'execute_runbook', 'create_maintenance', 'test_channel', 'sync_providers',
] as const;

const ADMIN_ACTIONS = [
  'create_monitor', 'update_monitor', 'delete_monitor',
  'create_server', 'update_server', 'delete_server',
  'create_application', 'update_application', 'delete_application',
  'manage_users', 'manage_communications', 'manage_runbooks', 'delete_maintenance',
] as const;

const SUPER_ADMIN_ACTIONS = ['trigger_failover', 'manage_roles', 'delete_user'] as const;

/** Whether this role may use a dashboard action. An unknown action is refused. */
export function canPerform(role: string | null | undefined, action: string): boolean {
  const level = role ? ROLE_LEVEL[role as RoleName] ?? 0 : 0;
  if ((SUPER_ADMIN_ACTIONS as readonly string[]).includes(action)) return level >= 4;
  if ((ADMIN_ACTIONS as readonly string[]).includes(action)) return level >= 3;
  if ((OPERATOR_ACTIONS as readonly string[]).includes(action)) return level >= 2;
  if (action === 'view' || action === 'read') return level >= 1;
  return false;
}
