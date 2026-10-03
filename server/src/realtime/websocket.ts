import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../utils/logger';
import { JwtPayload } from '../middleware/authenticate';

interface AuthenticatedSocket extends WebSocket {
  userId?: string;
  userEmail?: string;
  roleName?: string;
  isAlive: boolean;
}

export type RealtimeEvent =
  | 'server.health.changed'
  | 'monitor.status.changed'
  | 'incident.created'
  | 'incident.updated'
  | 'incident.resolved'
  | 'notification.sent'
  | 'backup.status.changed'
  | 'replication.status.changed'
  | 'failover.started'
  | 'failover.completed'
  | 'deployment.updated'
  | 'deadman.status.changed'
  | 'system.summary.updated';

interface RealtimeMessage {
  event: RealtimeEvent;
  data: unknown;
  timestamp: string;
}

let wss: WebSocketServer | null = null;

export function initWebSocket(httpServer: Server): WebSocketServer {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (socket: AuthenticatedSocket, req: IncomingMessage) => {
    socket.isAlive = true;

    // Authenticate via query param token: ws://host/ws?token=<jwt>
    const url = new URL(req.url ?? '/', `ws://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (token) {
      try {
        const payload = jwt.verify(token, config.auth.jwtSecret) as JwtPayload;
        socket.userId = payload.sub;
        socket.userEmail = payload.email;
        socket.roleName = payload.roleName;
        logger.debug({ userId: payload.sub }, 'WebSocket client authenticated');
      } catch {
        logger.warn('WebSocket: invalid token, sending as unauthenticated');
      }
    }

    socket.on('pong', () => { socket.isAlive = true; });

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        // Handle client ping
        if (msg.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }
      } catch { /* ignore malformed messages */ }
    });

    socket.on('close', () => {
      logger.debug({ userId: socket.userId }, 'WebSocket client disconnected');
    });

    socket.on('error', (err) => {
      logger.error({ err, userId: socket.userId }, 'WebSocket error');
    });

    // Welcome message
    socket.send(JSON.stringify({
      type: 'connected',
      message: 'Scholario Ops realtime stream connected',
      timestamp: new Date().toISOString(),
    }));
  });

  // Heartbeat: ping all clients every 30s, close dead ones
  const pingInterval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((rawSocket) => {
      const socket = rawSocket as AuthenticatedSocket;
      if (!socket.isAlive) {
        socket.terminate();
        return;
      }
      socket.isAlive = false;
      socket.ping();
    });
  }, 30_000);

  wss.on('close', () => clearInterval(pingInterval));

  logger.info('WebSocket server initialized at /ws');
  return wss;
}

// Broadcast a realtime event to all connected (authenticated) clients
export function broadcast(event: RealtimeEvent, data: unknown): void {
  if (!wss) return;

  const message: RealtimeMessage = {
    event,
    data,
    timestamp: new Date().toISOString(),
  };

  const payload = JSON.stringify(message);
  let sent = 0;

  wss.clients.forEach((rawSocket) => {
    const socket = rawSocket as AuthenticatedSocket;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
      sent++;
    }
  });

  if (sent > 0) {
    logger.debug({ event, clients: sent }, 'Realtime event broadcast');
  }
}

// Broadcast to a specific user only
export function broadcastToUser(userId: string, event: RealtimeEvent, data: unknown): void {
  if (!wss) return;
  const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });

  wss.clients.forEach((rawSocket) => {
    const socket = rawSocket as AuthenticatedSocket;
    if (socket.userId === userId && socket.readyState === WebSocket.OPEN) {
      socket.send(message);
    }
  });
}

export function getConnectedCount(): number {
  return wss?.clients.size ?? 0;
}
