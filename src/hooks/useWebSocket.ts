import { useEffect, useRef, useCallback, useState } from 'react';
import { tokenStore } from '../services/api';

// In dev: use relative WS URL so it goes through Vite proxy
// In prod: use the configured WS URL
const _wsUrl = (import.meta.env.VITE_WS_URL as string) || 'ws://localhost:4000/ws';
const WS_URL = _wsUrl === 'ws://localhost:4000/ws'
  ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
  : _wsUrl;
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
  const esRef           = useRef<EventSource | null>(null);
  const handlersRef     = useRef<Map<string, Set<EventHandler>>>(new Map());
  const reconnectTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef      = useRef(0);
  const mountedRef      = useRef(true);

  const [status, setStatus] = useState<WsConnectionStatus>('CONNECTING');

  const emit = useCallback((eventType: string, data: unknown) => {
    const handlers = handlersRef.current.get(eventType);
    if (handlers) handlers.forEach(h => h(data));
  }, []);

  const scheduleReconnect = useCallback((connectFn: () => void) => {
    if (!mountedRef.current) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attemptRef.current, RECONNECT_MAX_MS);
    attemptRef.current++;
    reconnectTimer.current = setTimeout(connectFn, delay);
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (typeof window === 'undefined' || !window.EventSource) {
      setStatus('LIVE');
      return;
    }

    esRef.current?.close();
    setStatus(attemptRef.current === 0 ? 'CONNECTING' : 'RECONNECTING');

    try {
      const es = new EventSource('/api/v1/realtime/stream');
      esRef.current = es;

      es.onopen = () => {
        if (!mountedRef.current) return;
        attemptRef.current = 0;
        setStatus('LIVE');
      };

      es.addEventListener('connected', () => {
        if (!mountedRef.current) return;
        attemptRef.current = 0;
        setStatus('LIVE');
      });

      es.addEventListener('telemetry_tick', (e) => {
        try {
          emit('server.health.changed', JSON.parse((e as MessageEvent).data));
        } catch {}
      });

      es.addEventListener('incident_update', (e) => {
        try {
          emit('incident.updated', JSON.parse((e as MessageEvent).data));
        } catch {}
      });

      es.onerror = () => {
        es.close();
        if (!mountedRef.current) return;
        setStatus('OFFLINE');
        scheduleReconnect(connect);
      };
    } catch {
      scheduleReconnect(connect);
    }
  }, [emit, scheduleReconnect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      esRef.current?.close();
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

  const send = useCallback((_msg: unknown) => {
    // No-op over SSE
  }, []);

  return { status, on, send };
}
