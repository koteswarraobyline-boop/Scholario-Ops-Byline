import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { OpsUser } from '../src/types/index.ts';
import { config } from './config.ts';
import { db, persist, UserRecord } from './store.ts';

export type Role = OpsUser['roleName'];
export const ROLES: Role[] = ['viewer', 'operator', 'it_administrator', 'super_admin'];
const ROLE_LEVEL: Record<Role, number> = { viewer: 1, operator: 2, it_administrator: 3, super_admin: 4 };

// ── Password hashing (scrypt) ────────────────────────────────────────────────
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length < 10) return 'Password must be at least 10 characters';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain upper-case, lower-case and a number';
  }
  return null;
}

// ── Signed tokens (JWT HS256) ────────────────────────────────────────────────
interface TokenPayload {
  sub: string;
  typ: 'access' | 'refresh';
  ver: number;
  jti?: string;
  iat: number;
  exp: number;
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

function sign(payload: TokenPayload): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', config.jwtSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verify(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', config.jwtSecret).update(`${header}.${body}`).digest();
  let given: Buffer;
  try { given = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function issueTokens(user: UserRecord) {
  const now = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();
  const accessToken = sign({ sub: user.id, typ: 'access', ver: user.tokenVersion, iat: now, exp: now + config.accessTokenTtlSec });
  const refreshToken = sign({ sub: user.id, typ: 'refresh', ver: user.tokenVersion, jti, iat: now, exp: now + config.refreshTokenTtlSec });
  // Drop expired refresh tokens while we are here
  const nowMs = Date.now();
  db.refreshTokens = db.refreshTokens.filter(t => t.expiresAt > nowMs);
  db.refreshTokens.push({ id: jti, userId: user.id, expiresAt: (now + config.refreshTokenTtlSec) * 1000 });
  persist();
  return { accessToken, refreshToken, expiresIn: `${config.accessTokenTtlSec}s` };
}

/** Validates a refresh token and rotates it (single use). */
export function consumeRefreshToken(token: string): UserRecord | null {
  const payload = verify(token);
  if (!payload || payload.typ !== 'refresh' || !payload.jti) return null;
  const idx = db.refreshTokens.findIndex(t => t.id === payload.jti);
  if (idx === -1) return null;
  db.refreshTokens.splice(idx, 1);
  persist();
  const user = db.users.find(u => u.id === payload.sub);
  if (!user || !user.isActive || user.tokenVersion !== payload.ver) return null;
  return user;
}

export function revokeRefreshToken(token: string) {
  const payload = verify(token);
  if (!payload?.jti) return;
  db.refreshTokens = db.refreshTokens.filter(t => t.id !== payload.jti);
  persist();
}

export function safeUser(u: UserRecord): OpsUser {
  const { passwordHash: _h, tokenVersion: _v, ...rest } = u;
  return rest;
}

// ── Express middleware ───────────────────────────────────────────────────────
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: UserRecord }
  }
}

function userFromAccessToken(token: string | undefined): UserRecord | null {
  if (!token) return null;
  const payload = verify(token);
  if (!payload || payload.typ !== 'access') return null;
  const user = db.users.find(u => u.id === payload.sub);
  if (!user || !user.isActive || user.tokenVersion !== payload.ver) return null;
  return user;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  // EventSource cannot send headers, so the SSE stream passes the token in the query string
  const queryToken = req.path.endsWith('/realtime/stream') ? (req.query.token as string | undefined) : undefined;
  const user = userFromAccessToken(bearer ?? queryToken);
  if (!user) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }
  req.user = user;
  next();
}

export function requireRole(minRole: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    const level = req.user ? ROLE_LEVEL[req.user.roleName] ?? 0 : 0;
    if (level < ROLE_LEVEL[minRole]) {
      res.status(403).json({ success: false, message: `Requires ${minRole} role or higher` });
      return;
    }
    next();
  };
}

export const operatorName = (req: Request) => req.user ? (req.user.displayName || req.user.fullName || req.user.email) : 'system';

// ── Login rate limiting (per IP + per account) ───────────────────────────────
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function loginRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) return false;
  return entry.count >= MAX_ATTEMPTS;
}

export function recordLoginFailure(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count += 1;
}

export function clearLoginFailures(key: string) {
  attempts.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
}, 60_000).unref();

// ── First-run bootstrap ──────────────────────────────────────────────────────
export function bootstrapAdmin() {
  if (db.users.length > 0) return;
  const email = config.adminEmail;
  if (!email) {
    console.warn('\n[auth] No users exist. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env and restart to create the first administrator.\n');
    return;
  }
  let password = config.adminPassword;
  let generated = false;
  if (!password || validatePasswordStrength(password)) {
    if (password) console.warn(`[auth] ADMIN_PASSWORD rejected: ${validatePasswordStrength(password)}. Generating a random one.`);
    password = `${crypto.randomBytes(9).toString('base64url')}A1a`;
    generated = true;
  }
  const now = new Date().toISOString();
  db.users.push({
    id: crypto.randomUUID(),
    email,
    fullName: config.adminName,
    displayName: config.adminName,
    roleName: 'super_admin',
    isActive: true,
    isOnCall: true,
    createdAt: now,
    lastLoginAt: null,
    passwordHash: hashPassword(password),
    tokenVersion: 0,
  });
  persist();
  console.log(`\n[auth] Created super_admin ${email}${generated ? ` with generated password: ${password}\n       Change it after first login.` : ''}\n`);
}
