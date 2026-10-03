import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, withTransaction } from '../../database/pool';
import { getRedis } from '../../database/redis';
import { config } from '../../config';
import { generateToken, hashToken } from '../../utils/crypto';
import {
  AuthError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from '../../utils/errors';
import { JwtPayload } from '../../middleware/authenticate';

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  display_name: string | null;
  role_id: string;
  role_name: string;
  is_active: boolean;
  is_on_call: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
}

export interface SafeUser {
  id: string;
  email: string;
  fullName: string;
  displayName: string | null;
  roleId: string;
  roleName: string;
  isActive: boolean;
  isOnCall: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MIN = 15;

function toSafeUser(u: UserRecord): SafeUser {
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    displayName: u.display_name,
    roleId: u.role_id,
    roleName: u.role_name,
    isActive: u.is_active,
    isOnCall: u.is_on_call,
  };
}

function signAccessToken(user: UserRecord): string {
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: user.id,
    email: user.email,
    role: user.role_id,
    roleName: user.role_name,
  };
  return jwt.sign(payload, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export async function login(
  email: string,
  password: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ user: SafeUser; tokens: TokenPair }> {
  const user = await queryOne<UserRecord>(
    `SELECT u.*, r.name AS role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.email = $1 AND u.deleted_at IS NULL`,
    [email.toLowerCase().trim()]
  );

  if (!user) throw new AuthError('Invalid email or password');

  // Check account lock
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AuthError(
      `Account locked. Try again after ${new Date(user.locked_until).toISOString()}`
    );
  }

  if (!user.is_active) throw new ForbiddenError('Account is inactive');

  const valid = await bcrypt.compare(password, user.password_hash);

  if (!valid) {
    const newAttempts = user.failed_login_attempts + 1;
    const lockUntil =
      newAttempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCK_DURATION_MIN * 60_000).toISOString()
        : null;

    await query(
      `UPDATE users SET failed_login_attempts = $1, locked_until = $2, updated_at = NOW()
       WHERE id = $3`,
      [newAttempts, lockUntil, user.id]
    );
    throw new AuthError('Invalid email or password');
  }

  // Reset failed attempts on success
  await query(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL,
      last_login_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [user.id]
  );

  const tokens = await issueTokens(user, ipAddress, userAgent);

  return { user: toSafeUser(user), tokens };
}

async function issueTokens(
  user: UserRecord,
  ipAddress?: string,
  userAgent?: string
): Promise<TokenPair> {
  const accessToken = signAccessToken(user);
  const rawRefresh = generateToken(48);
  const tokenHash = hashToken(rawRefresh);

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

  await query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [uuidv4(), user.id, tokenHash, expiresAt, ipAddress ?? null, userAgent ?? null]
  );

  return {
    accessToken,
    refreshToken: rawRefresh,
    expiresIn: config.auth.jwtExpiresIn,
  };
}

export async function refreshTokens(
  rawRefreshToken: string
): Promise<{ user: SafeUser; tokens: TokenPair }> {
  const tokenHash = hashToken(rawRefreshToken);

  const stored = await queryOne<{
    id: string;
    user_id: string;
    expires_at: Date;
    revoked: boolean;
  }>(
    `SELECT id, user_id, expires_at, revoked FROM refresh_tokens WHERE token_hash = $1`,
    [tokenHash]
  );

  if (!stored || stored.revoked) throw new AuthError('Invalid refresh token');
  if (new Date(stored.expires_at) < new Date()) {
    throw new AuthError('Refresh token expired');
  }

  // Rotate — revoke old token
  await query(`UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1`, [stored.id]);

  const user = await queryOne<UserRecord>(
    `SELECT u.*, r.name AS role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.deleted_at IS NULL AND u.is_active = TRUE`,
    [stored.user_id]
  );

  if (!user) throw new AuthError('User no longer active');

  const tokens = await issueTokens(user);
  return { user: toSafeUser(user), tokens };
}

export async function logout(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashToken(rawRefreshToken);
  await query(
    `UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1`,
    [tokenHash]
  );
}

export async function logoutAll(userId: string): Promise<void> {
  await query(
    `UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1`,
    [userId]
  );
  // Blacklist in Redis for access token duration
  const redis = getRedis();
  await redis.set(`blacklist:${userId}`, '1', 'EX', 60 * 60);
}

export async function createUser(data: {
  email: string;
  password: string;
  fullName: string;
  displayName?: string;
  roleName: string;
}): Promise<SafeUser> {
  const existing = await queryOne(
    `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`,
    [data.email.toLowerCase().trim()]
  );
  if (existing) throw new ConflictError('Email already in use');

  const role = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM roles WHERE name = $1`,
    [data.roleName]
  );
  if (!role) throw new NotFoundError('Role');

  const passwordHash = await bcrypt.hash(data.password, config.auth.bcryptRounds);

  const [user] = await query<UserRecord>(
    `INSERT INTO users (id, email, password_hash, full_name, display_name, role_id, activated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING *, (SELECT name FROM roles WHERE id = $6) AS role_name`,
    [
      uuidv4(),
      data.email.toLowerCase().trim(),
      passwordHash,
      data.fullName,
      data.displayName ?? null,
      role.id,
    ]
  );

  return toSafeUser({ ...user, role_name: data.roleName });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await queryOne<{ id: string; password_hash: string }>(
    `SELECT id, password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  if (!user) throw new NotFoundError('User');

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) throw new AuthError('Current password is incorrect');

  const hash = await bcrypt.hash(newPassword, config.auth.bcryptRounds);
  await query(
    `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
    [hash, userId]
  );
}

export async function getMe(userId: string): Promise<SafeUser> {
  const user = await queryOne<UserRecord>(
    `SELECT u.*, r.name AS role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId]
  );
  if (!user) throw new NotFoundError('User');
  return toSafeUser(user);
}
