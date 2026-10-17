import React, {
  createContext, useContext, useState, useEffect,
  useCallback, ReactNode
} from 'react';
import { AuthService } from '../services/auth';
import { ApiError, SafeUser, setLogoutHandler, tokenStore } from '../services/api';

interface AuthContextType {
  user: SafeUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  // Permission helpers
  hasRole: (minRole: 'viewer' | 'operator' | 'it_administrator' | 'super_admin') => boolean;
  canDo: (action: string) => boolean;
}

const ROLE_LEVEL: Record<string, number> = {
  viewer: 1,
  operator: 2,
  it_administrator: 3,
  super_admin: 4,
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<SafeUser | null>(() => tokenStore.getUser());
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Validate stored token on mount
  useEffect(() => {
    const validate = async () => {
      if (!tokenStore.getAccess()) {
        setUser(null);
        setIsLoading(false);
        return;
      }
      try {
        const me = await AuthService.getMe();
        setUser(me);
      } catch (err) {
        // Only a rejected session signs the user out. A network error or a 5xx (backend restarting,
        // database blip) keeps the stored session; requests retry once the server is back.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          tokenStore.clear();
          setUser(null);
        } else {
          setUser(tokenStore.getUser());
        }
      } finally {
        setIsLoading(false);
      }
    };
    validate();
  }, []);

  const logout = useCallback(async () => {
    await AuthService.logout();
    setUser(null);
  }, []);

  // Register global logout handler for 401 responses
  useEffect(() => {
    setLogoutHandler(() => {
      tokenStore.clear();
      setUser(null);
    });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const me = await AuthService.login(email, password);
    setUser(me);
  }, []);

  const hasRole = useCallback((minRole: 'viewer' | 'operator' | 'it_administrator' | 'super_admin'): boolean => {
    if (!user) return false;
    return (ROLE_LEVEL[user.roleName] ?? 0) >= (ROLE_LEVEL[minRole] ?? 999);
  }, [user]);

  // Simple action-based permission check for common operations
  const canDo = useCallback((action: string): boolean => {
    if (!user) return false;
    const role = user.roleName;
    const level = ROLE_LEVEL[role] ?? 0;

    // Mirrors the role checks enforced by the API (server/routes.ts)
    const operatorActions = [
      'acknowledge_incident', 'resolve_incident', 'add_note', 'assign_incident', 'declare_incident',
      'run_probe', 'execute_runbook', 'create_maintenance', 'test_channel', 'sync_providers',
    ];
    const adminActions = [
      'create_monitor', 'update_monitor', 'delete_monitor',
      'create_server', 'update_server', 'delete_server',
      'create_application', 'update_application', 'delete_application',
      'manage_users', 'manage_communications', 'manage_runbooks', 'delete_maintenance',
    ];
    const superAdminActions = ['trigger_failover', 'manage_roles', 'delete_user'];

    if (superAdminActions.includes(action)) return level >= 4;
    if (adminActions.includes(action)) return level >= 3;
    if (operatorActions.includes(action)) return level >= 2;
    if (action === 'view' || action === 'read') return level >= 1;
    return false; // unknown action: deny (a typo must never grant access)
  }, [user]);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      login,
      logout,
      hasRole,
      canDo,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
