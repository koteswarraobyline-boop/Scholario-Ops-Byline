/**
 * Optional OpenID Connect sign-in. Off unless OIDC_ISSUER, OIDC_CLIENT_ID and
 * OIDC_CLIENT_SECRET are set. An identity-provider account can sign in only when
 * that email already exists here. No account is created, and no role is granted.
 */
import crypto from 'crypto';
import { config } from './config.ts';

export function oidcConfigured(): boolean {
  return Boolean(config.oidcIssuer && config.oidcClientId && config.oidcClientSecret);
}

const pending = new Map<string, { verifier: string; nonce: string; exp: number }>();
const tickets = new Map<string, { userId: string; exp: number }>();

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function issuerAllowed(issuer: string): boolean {
  let url: URL;
  try { url = new URL(issuer); } catch { return false; }
  if (url.protocol === 'https:') return true;
  if (!config.oidcAllowInsecure || url.protocol !== 'http:') return false;
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}

interface Discovery { authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
let discoveryCache: { at: number; value: Discovery } | null = null;

async function discovery(): Promise<Discovery> {
  if (!oidcConfigured() || !issuerAllowed(config.oidcIssuer)) throw new Error('SSO is not configured');
  if (discoveryCache && Date.now() - discoveryCache.at < 10 * 60_000) return discoveryCache.value;
  const res = await fetch(`${config.oidcIssuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error('The identity provider configuration could not be read');
  const body = await res.json() as Partial<Discovery>;
  if (!body.authorization_endpoint || !body.token_endpoint || !body.jwks_uri) throw new Error('The identity provider configuration is incomplete');
  const origin = new URL(config.oidcIssuer).origin;
  for (const endpoint of [body.authorization_endpoint, body.token_endpoint, body.jwks_uri]) {
    if (!issuerAllowed(endpoint) || new URL(endpoint).origin !== origin) throw new Error('The identity provider returned an address this server will not use');
  }
  discoveryCache = { at: Date.now(), value: body as Discovery };
  return body as Discovery;
}

export function redirectUri(): string {
  const base = config.publicUrl || '';
  return `${base}/api/auth/oidc/callback`;
}

export async function authorizationRedirect(): Promise<string> {
  const doc = await discovery();
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const nonce = b64url(crypto.randomBytes(16));
  const state = b64url(crypto.randomBytes(16));
  pending.set(state, { verifier, nonce, exp: Date.now() + 10 * 60_000 });
  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.oidcClientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('scope', 'openid email');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function takeState(state: string): { verifier: string; nonce: string } | null {
  const row = pending.get(state);
  pending.delete(state);
  if (!row || row.exp < Date.now()) return null;
  return row;
}

type Jwk = JsonWebKey & { kid?: string }

async function keyFor(jwksUri: string, kid: string | undefined): Promise<Jwk> {
  const res = await fetch(jwksUri);
  if (!res.ok) throw new Error('The identity provider keys could not be read');
  const body = await res.json() as { keys?: Jwk[] };
  const keys = (body.keys ?? []).filter(k => k.kty === 'RSA' && (k.use === undefined || k.use === 'sig'));
  const key = kid ? keys.find(k => k.kid === kid) : keys[0];
  if (!key) throw new Error('The identity provider key was not found');
  return key;
}

export function verifyIdToken(token: string, jwk: Jwk, expected: { nonce: string }): { email: string } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('The identity token is not valid');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { alg?: string; kid?: string };
  if (header.alg !== 'RS256') throw new Error('The identity token algorithm is not accepted');
  const key = crypto.createPublicKey({ key: jwk as unknown as crypto.JsonWebKey, format: 'jwk' });
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  if (!crypto.verify('RSA-SHA256', signed, key, Buffer.from(parts[2], 'base64url'))) throw new Error('The identity token signature is not valid');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { iss?: string; aud?: string | string[]; exp?: number; nonce?: string; email?: string; email_verified?: boolean };
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== config.oidcIssuer) throw new Error('The identity token issuer is not valid');
  const aud = payload.aud;
  const audOk = aud === config.oidcClientId || (Array.isArray(aud) && aud.includes(config.oidcClientId));
  if (!audOk) throw new Error('The identity token audience is not valid');
  if (payload.nonce !== expected.nonce) throw new Error('The identity token nonce is not valid');
  if (typeof payload.exp !== 'number' || payload.exp < now - 30) throw new Error('The identity token has expired');
  if (payload.email_verified === false) throw new Error('The identity provider has not verified this email');
  const email = String(payload.email ?? '').trim().toLowerCase();
  if (!email.includes('@')) throw new Error('The identity token has no email');
  return { email };
}

export async function completeLogin(code: string, state: string): Promise<{ email: string }> {
  const saved = takeState(state);
  if (!saved) throw new Error('The sign-in attempt expired. Start again.');
  const doc = await discovery();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: config.oidcClientId,
    client_secret: config.oidcClientSecret,
    code_verifier: saved.verifier,
  });
  const res = await fetch(doc.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error('The identity provider rejected the sign-in');
  const token = await res.json() as { id_token?: string };
  if (!token.id_token) throw new Error('The identity provider did not return an identity token');
  const header = JSON.parse(Buffer.from(token.id_token.split('.')[0], 'base64url').toString()) as { kid?: string };
  const jwk = await keyFor(doc.jwks_uri, header.kid);
  return verifyIdToken(token.id_token, jwk, { nonce: saved.nonce });
}

export function issueSsoTicket(userId: string): string {
  const ticket = b64url(crypto.randomBytes(32));
  tickets.set(ticket, { userId, exp: Date.now() + 60_000 });
  return ticket;
}

export function consumeSsoTicket(ticket: string): string | null {
  const row = tickets.get(ticket);
  tickets.delete(ticket);
  if (!row || row.exp < Date.now()) return null;
  return row.userId;
}
