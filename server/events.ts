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

export function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients.keys()) {
    try {
      client.write(payload);
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
