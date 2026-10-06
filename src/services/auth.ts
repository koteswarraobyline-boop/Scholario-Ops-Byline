import { api, ApiResponse, SafeUser, tokenStore } from './api';

interface SessionResponse {
  user: SafeUser;
  tokens: { accessToken: string; refreshToken: string; expiresIn: string };
}

export const AuthService = {
  async login(email: string, password: string): Promise<SafeUser> {
    const res = await api.post<ApiResponse<SessionResponse>>('/api/auth/login', { email, password });
    tokenStore.setTokens(res.data.tokens.accessToken, res.data.tokens.refreshToken, res.data.user);
    return res.data.user;
  },

  async logout(): Promise<void> {
    const refreshToken = tokenStore.getRefresh();
    try {
      if (refreshToken) await api.post('/api/auth/logout', { refreshToken });
    } catch { /* best-effort: the local session is cleared regardless */ }
    tokenStore.clear();
  },

  async getMe(): Promise<SafeUser> {
    const res = await api.get<ApiResponse<SafeUser>>('/api/auth/me');
    return res.data;
  },

  /** Changing the password signs out every other session; this session gets fresh tokens. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const res = await api.post<ApiResponse<SessionResponse>>('/api/auth/change-password', { currentPassword, newPassword });
    tokenStore.setTokens(res.data.tokens.accessToken, res.data.tokens.refreshToken, res.data.user);
  },

  isAuthenticated(): boolean {
    return !!tokenStore.getAccess();
  },

  getCurrentUser(): SafeUser | null {
    return tokenStore.getUser();
  },
};
