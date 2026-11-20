import React, {
  createContext, useContext, useState, useEffect,
  useCallback, ReactNode
} from 'react';
import { AuthService } from '../services/auth';
import { ApiError, SafeUser, setLogoutHandler, tokenStore } from '../services/api';
import { canPerform, hasMinRole } from '../lib/roles';

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
    return hasMinRole(user?.roleName, minRole);
  }, [user]);

  const canDo = useCallback((action: string): boolean => canPerform(user?.roleName, action), [user]);

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
