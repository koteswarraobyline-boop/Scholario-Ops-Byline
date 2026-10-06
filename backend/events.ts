import { Response } from 'express';
import crypto from 'crypto';
import { AuditLog } from '../src/types/index.ts';
import { db, persist } from './store.ts';
import { config } from './config.ts';

const clients = new Set<Response>();

export function addSseClient(res: Response) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function sseClientCount() {
  return clients.size;
}

export function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

// Keep proxies (nginx, Cloudflare) from closing idle SSE connections
setInterval(() => {
  for (const client of clients) {
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
