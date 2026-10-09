import { Response } from 'express';
import crypto from 'crypto';
import { AuditLog } from '../src/types/index.ts';
import { db, persist } from './store.ts';
import { config } from './config.ts';

/** Open SSE streams with the user and session version they were opened with */
const clients = new Map<Response, { userId: string; ver: number }>();

export function addSseClient(res: Response, user: { id: string; tokenVersion: number }) {
  clients.set(res, { userId: user.id, ver: user.tokenVersion });
  res.on('close', () => clients.delete(res));
}

/** Ends every stream (graceful shutdown) — browsers reconnect to the next process automatically. */
export function closeAllSseClients() {
  for (const res of clients.keys()) { try { res.end(); } catch { /* already closed */ } }
  clients.clear();
}

export function sseClientCount() {
  return clients.size;
}

/**
 * Events that carry secrets admins may see but other users must not — the same masking the REST
 * endpoints apply: push-monitor heartbeat tokens and notification channel endpoints (webhook URLs,
 * routing keys). Viewers and operators get the redacted copy.
 */
const REDACT: Record<string, (data: unknown) => unknown> = {
  monitor_update: d => {
    if (!d || typeof d !== 'object') return d;
    const { heartbeatToken: _t, ...rest } = d as Record<string, unknown>;
    return rest;
  },
  monitors_probed: d => (Array.isArray(d) ? d.map(x => REDACT.monitor_update(x)) : d),
  channel_update: d => (d && typeof d === 'object'
    ? { ...(d as Record<string, unknown>), targetEndpoint: (d as Record<string, unknown>).targetEndpoint ? '••••••' : '' }
    : d),
};
const ADMIN_ROLES = new Set(['it_administrator', 'super_admin']);
/** Above this many buffered bytes a stream is considered stalled and is dropped (the browser reconnects) */
const MAX_BUFFERED = 4 * 1024 * 1024;

export function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const redact = REDACT[event];
  const redacted = redact ? `event: ${event}\ndata: ${JSON.stringify(redact(data))}\n\n` : payload;
  for (const [client, who] of clients) {
    try {
      if (client.writableLength > MAX_BUFFERED) { client.end(); clients.delete(client); continue; }
      const admin = ADMIN_ROLES.has(db.users.find(u => u.id === who.userId)?.roleName ?? '');
      client.write(admin ? payload : redacted);
    } catch {
      clients.delete(client);
    }
  }
}

// Keep proxies (nginx, Cloudflare) from closing idle SSE connections
setInterval(() => {
  for (const [client, who] of clients) {
    // Drop streams of users who were deactivated or whose sessions were revoked
    const user = db.users.find(u => u.id === who.userId);
    if (!user || !user.isActive || user.tokenVersion !== who.ver) { try { client.end(); } catch { /* closed */ } clients.delete(client); continue; }
    try { client.write(': keepalive\n\n'); } catch { clients.delete(client); }
  }
}, 25_000).unref();

export function audit(
  operator: string,
  action: string,
  category: AuditLog['category'],
  targetId: string,
  details: string,
) {
  const entry: AuditLog = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    operator,
    action,
    category,
    targetId,
    details,
  };
  db.auditLogs.unshift(entry);
  if (db.auditLogs.length > config.auditRetention) db.auditLogs.length = config.auditRetention;
  persist();
  broadcast('audit', entry);
  return entry;
}
