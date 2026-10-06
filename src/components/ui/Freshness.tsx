import React, { useEffect, useState } from 'react';

/** Re-renders every `intervalMs` so relative ages stay current. */
export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** "12s ago" / "4m ago" / "3h ago" / "2d ago"; null for missing or invalid timestamps. */
export function ageText(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * Data-age label for a live value. Turns amber when older than `staleAfterSec`.
 * Shows `missing` (default "No data") when there is no timestamp.
 */
export const Ago: React.FC<{ iso: string | null | undefined; prefix?: string; staleAfterSec?: number; missing?: string; className?: string }> = ({
  iso, prefix = '', staleAfterSec, missing = 'No data', className = '',
}) => {
  const now = useNow();
  const text = ageText(iso, now);
  if (!text) return <span className={`text-slate-500 ${className}`}>{missing}</span>;
  const stale = staleAfterSec !== undefined && now - Date.parse(iso as string) > staleAfterSec * 1000;
  return (
    <span className={`${stale ? 'text-amber-500' : ''} ${className}`} title={new Date(iso as string).toLocaleString()}>
      {prefix}{text}{stale ? ' (stale)' : ''}
    </span>
  );
};

/** GREEN healthy · YELLOW degraded · RED failed · GRAY no reliable data (UNKNOWN / NOT_CONFIGURED are never green) */
export const verdictColor = (s: string | null | undefined) =>
  s === 'PASS' || s === 'READY' || s === 'OK' || s === 'UP' || s === 'HEALTHY' || s === 'ONLINE' || s === 'CONNECTED' || s === 'CONFIGURED' ? 'text-emerald-500'
    : s === 'WARNING' || s === 'DEGRADED' || s === 'STALE' || s === 'PARTIALLY_READY' || s === 'RATE_LIMITED' ? 'text-amber-500'
      : s === 'FAIL' || s === 'FAILED' || s === 'NOT_READY' || s === 'CRITICAL' || s === 'DOWN' || s === 'ERROR' || s === 'TIMEOUT' || s === 'DNS_ERROR' || s === 'TLS_ERROR' || s === 'CONNECTION_ERROR' || s === 'UNAVAILABLE' || s === 'OFFLINE' || s === 'AUTH_FAILED' || s === 'DISCONNECTED' ? 'text-rose-500'
        : 'text-slate-400';

/** Tri-state boolean from an API: true / false / unknown */
export const triText = (v: boolean | null | undefined, yes = 'Yes', no = 'No', unknown = 'Unknown') =>
  v === true ? yes : v === false ? no : unknown;
export const triColor = (v: boolean | null | undefined) => (v === true ? 'text-emerald-500' : v === false ? 'text-rose-500' : 'text-slate-400');
