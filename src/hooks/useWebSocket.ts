import { useEffect, useRef, useCallback, useState } from 'react';
import { tokenStore } from '../services/api';

const WS_URL = (import.meta.env.VITE_WS_URL as string) || 'ws://localhost:4000/ws';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS  = 30000;
const PING_INTERVAL_MS  = 25000;

export type WsConnectionStatus = 'CONNECTING' | 'LIVE' | 'RECONNECTING' | 'OFFLINE';

export type RealtimeEventType =
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

export interface RealtimeEvent {
  event: RealtimeEventType;
  data: unknown;
  timestamp: string;
}

type EventHandler = (data: unknown) => void;

interface UseWebSocketReturn {
  status: WsConnectionStatus;
  on: (event: RealtimeEventType, handler: EventHandler) => () => void;
  send: (msg: unknown) => void;
}

export function useWebSocket(): UseWebSocketReturn {
  const wsRef           = useRef<WebSocket | null>(null);
  const handlersRef     = useRef<Map<string, Set<EventHandler>>>(new Map());
  const reconnectTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer       = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptRef      = useRef(0);
  const mountedRef      = useRef(true);
  const seenEventsRef   = useRef<Set<string>>(new Set());

  const [status, setStatus] = useState<WsConnectionStatus>('CONNECTING');

  const emit = useCallback((eventType: string, data: unknown) => {
    const handlers = handlersRef.current.get(eventType);
    if (handlers) handlers.forEach(h => h(data));
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const token = tokenStore.getAccess();
    const url = token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL;

    setStatus(attemptRef.current === 0 ? 'CONNECTING' : 'RECONNECTING');

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      attemptRef.current = 0;
      setStatus('LIVE');

      // Start ping loop
      pingTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (e) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(e.data as string) as RealtimeEvent;
        if (!msg.event) return;

        // Deduplicate: ignore same event+timestamp seen within 2s
        const dedupKey = `${msg.event}:${msg.timestamp}`;
        if (seenEventsRef.current.has(dedupKey)) return;
        seenEventsRef.current.add(dedupKey);
        setTimeout(() => seenEventsRef.current.delete(dedupKey), 2000);

        emit(msg.event, msg.data);
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      if (pingTimer.current) clearInterval(pingTimer.current);
      if (!mountedRef.current) return;
      setStatus('OFFLINE');
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [emit]);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attemptRef.current, RECONNECT_MAX_MS);
    attemptRef.current++;
    reconnectTimer.current = setTimeout(connect, delay);
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pingTimer.current) clearInterval(pingTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const on = useCallback((event: RealtimeEventType, handler: EventHandler): (() => void) => {
    if (!handlersRef.current.has(event)) {
      handlersRef.current.set(event, new Set());
    }
    handlersRef.current.get(event)!.add(handler);
    return () => {
      handlersRef.current.get(event)?.delete(handler);
    };
  }, []);

  const send = useCallback((msg: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { status, on, send };
}
