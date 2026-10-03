/**
 * Central API client for Scholario Ops.
 * Handles: base URL, Authorization header, automatic token refresh on 401,
 * logout on invalid refresh, typed responses, error normalization.
 *
 * In development: uses empty BASE_URL so all requests go through the Vite
 * proxy at port 3000 → backend at port 4000 (avoids CORS issues).
 * In production: set VITE_API_URL to the real backend domain.
 */

// Use relative URL in dev (proxy handles it), absolute in production
const BASE_URL = (import.meta.env.VITE_API_URL as string) === 'http://localhost:4000'
  ? ''  // relative — goes through Vite proxy
  : ((import.meta.env.VITE_API_URL as string) || '');

// ── Token storage (localStorage keys) ────────────────────────────────────────
const ACCESS_KEY  = 'scholario_access_token';
const REFRESH_KEY = 'scholario_refresh_token';
const USER_KEY    = 'scholario_user';

export const tokenStore = {
  getAccess:    (): string | null => localStorage.getItem(ACCESS_KEY),
  getRefresh:   (): string | null => localStorage.getItem(REFRESH_KEY),
  getUser:      (): SafeUser | null => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null'); }
    catch { return null; }
  },
  setTokens: (access: string, refresh: string, user: SafeUser) => {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear: () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export interface SafeUser {
  id: string;
  email: string;
  fullName: string;
  displayName: string | null;
  roleId: string;
  roleName: 'viewer' | 'operator' | 'it_administrator' | 'super_admin';
  isActive: boolean;
  isOnCall: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export interface PaginatedApiResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let _onLogout: (() => void) | null = null;
let _refreshPromise: Promise<boolean> | null = null;

export function setLogoutHandler(fn: () => void) {
  _onLogout = fn;
}

async function tryRefresh(): Promise<boolean> {
  // Deduplicate concurrent refresh calls
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    const refresh = tokenStore.getRefresh();
    if (!refresh) return false;
    try {
      const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as ApiResponse<{
        user: SafeUser;
        tokens: { accessToken: string; refreshToken: string };
      }>;
      if (body.success) {
        tokenStore.setTokens(body.data.tokens.accessToken, body.data.tokens.refreshToken, body.data.user);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  })();

  const result = await _refreshPromise;
  _refreshPromise = null;
  return result;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  retrying = false
): Promise<T> {
  const access = tokenStore.getAccess();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (access) headers['Authorization'] = `Bearer ${access}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  // Automatic refresh on 401
  if (res.status === 401 && !retrying) {
    const refreshed = await tryRefresh();
    if (refreshed) return apiFetch<T>(path, options, true);
    tokenStore.clear();
    _onLogout?.();
    throw new ApiError(401, 'UNAUTHORIZED', 'Session expired — please log in again');
  }

  if (!res.ok) {
    let code = 'ERROR';
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      code = body?.error?.code ?? code;
      message = body?.error?.message ?? message;
    } catch { /* ignore */ }
    throw new ApiError(res.status, code, message);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  const body = await res.json();
  return body as T;
}

// Convenience wrappers
export const api = {
  get:    <T>(path: string) => apiFetch<T>(path),
  post:   <T>(path: string, data?: unknown) => apiFetch<T>(path, { method: 'POST',  body: data ? JSON.stringify(data) : undefined }),
  patch:  <T>(path: string, data?: unknown) => apiFetch<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  put:    <T>(path: string, data?: unknown) => apiFetch<T>(path, { method: 'PUT',   body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) =>                apiFetch<T>(path, { method: 'DELETE' }),
};
