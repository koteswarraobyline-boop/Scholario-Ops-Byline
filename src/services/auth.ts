import { api, ApiResponse, SafeUser, tokenStore } from './api';

interface LoginResponse {
  user: SafeUser;
  tokens: { accessToken: string; refreshToken: string; expiresIn: string };
}

export const AuthService = {
  async login(email: string, password: string): Promise<SafeUser> {
    const res = await api.post<ApiResponse<LoginResponse>>('/api/auth/login', { email, password });
    tokenStore.setTokens(res.data.tokens.accessToken, res.data.tokens.refreshToken, res.data.user);
    return res.data.user;
  },

  async logout(): Promise<void> {
    const refresh = tokenStore.getRefresh();
    try {
      if (refresh) await api.post('/api/auth/logout', { refreshToken: refresh });
    } catch { /* best-effort */ }
    tokenStore.clear();
  },

  async getMe(): Promise<SafeUser> {
    const res = await api.get<ApiResponse<SafeUser>>('/api/auth/me');
    return res.data;
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await api.post('/api/auth/change-password', { currentPassword, newPassword });
  },

  isAuthenticated(): boolean {
    return !!tokenStore.getAccess();
  },

  getCurrentUser(): SafeUser | null {
    return tokenStore.getUser();
  },
};
