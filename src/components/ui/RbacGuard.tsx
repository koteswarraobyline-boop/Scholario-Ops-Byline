import React, { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';

type Role = 'viewer' | 'operator' | 'it_administrator' | 'super_admin';

interface RbacGuardProps {
  minRole?: Role;
  action?: string;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Conditionally renders children based on the current user's role.
 * This is a UX-layer guard only — backend enforces real authorization.
 *
 * Usage:
 *   <RbacGuard minRole="operator"><AcknowledgeButton /></RbacGuard>
 *   <RbacGuard action="trigger_failover"><FailoverButton /></RbacGuard>
 */
export const RbacGuard: React.FC<RbacGuardProps> = ({
  minRole,
  action,
  children,
  fallback = null,
}) => {
  const { hasRole, canDo, isAuthenticated } = useAuth();

  if (!isAuthenticated) return <>{fallback}</>;

  if (minRole && !hasRole(minRole)) return <>{fallback}</>;
  if (action  && !canDo(action))   return <>{fallback}</>;

  return <>{children}</>;
};

/**
 * Hook version for conditional logic inside components.
 */
export const useRbac = () => {
  const { hasRole, canDo, user } = useAuth();
  return { hasRole, canDo, user, roleName: user?.roleName };
};
