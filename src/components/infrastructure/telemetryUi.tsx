/**
 * Small presentational building blocks for the server telemetry UI (same look as the rest of the
 * Infrastructure page). Status is never shown by colour alone: every level has an icon and a word.
 */
import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from 'lucide-react';
import { TelemetryLevel } from '../../types';
import { Band, levelOf } from '../../lib/thresholds';

// ── Formatting ──────────────────────────────────────────────────────────────
export const validDate = (s?: string | null) => Boolean(s) && !Number.isNaN(Date.parse(s as string));
export const fmtDateTime = (s?: string | null, fallback = '—') => (validDate(s) ? new Date(s as string).toLocaleString() : fallback);
export const fmtTime = (s?: string | null, fallback = '—') => (validDate(s) ? new Date(s as string).toLocaleTimeString() : fallback);
export const fmtNum = (v: number | null | undefined, digits = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits));
export const fmtAgo = (s?: string | null) => {
  if (!validDate(s)) return 'never';
  const sec = Math.max(0, Math.round((Date.now() - Date.parse(s as string)) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
};
/** 93784 → "1d 2h", 3700 → "1h 1m", 59 → "59s" */
export const fmtDuration = (sec: number | null | undefined) => {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m` : `${Math.round(sec)}s`;
};
/** Bytes per second → "812 B/s" / "1.4 MB/s" */
export const fmtBytesRate = (v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v < 1024) return `${Math.round(v)} B/s`;
  if (v < 1024 ** 2) return `${(v / 1024).toFixed(1)} KB/s`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB/s`;
  return `${(v / 1024 ** 3).toFixed(2)} GB/s`;
};
/** Bytes per second → network bit rate "12.4 Mbps" */
export const fmtBitRate = (bytesPerSec: number | null | undefined) => {
  if (bytesPerSec === null || bytesPerSec === undefined || !Number.isFinite(bytesPerSec)) return '—';
  const bits = bytesPerSec * 8;
  if (bits < 1e3) return `${Math.round(bits)} bps`;
  if (bits < 1e6) return `${(bits / 1e3).toFixed(1)} kbps`;
  if (bits < 1e9) return `${(bits / 1e6).toFixed(1)} Mbps`;
  return `${(bits / 1e9).toFixed(2)} Gbps`;
};
/** Agent kilobits (1000 bits) per second → "1.2 Mbps" */
export const fmtKbps = (kbps: number | null | undefined) => (kbps === null || kbps === undefined ? '—' : fmtBitRate((kbps * 1000) / 8));
export const fmtMb = (mb: number | null | undefined) => (mb === null || mb === undefined ? '—' : mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);
export const fmtCount = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}k` : String(v));

// ── Theme ───────────────────────────────────────────────────────────────────
export const ui = (isDark: boolean) => ({
  muted: isDark ? 'text-slate-400' : 'text-slate-500',
  strong: isDark ? 'text-slate-100' : 'text-slate-900',
  text: isDark ? 'text-slate-200' : 'text-slate-800',
  card: `p-3 rounded border ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`,
  tableWrap: `border rounded overflow-x-auto ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`,
  thead: `border-b ${isDark ? 'bg-[#0A0F1A] text-slate-400 border-[#1E293B]' : 'bg-slate-100 text-slate-600 border-slate-200'}`,
  tbody: `divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-200'}`,
  row: isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50',
  track: isDark ? 'bg-slate-800' : 'bg-slate-200',
});

// ── Status ──────────────────────────────────────────────────────────────────
export const levelText = (l: TelemetryLevel) => (l === 'HEALTHY' ? 'text-emerald-500' : l === 'WARNING' ? 'text-amber-500' : l === 'CRITICAL' ? 'text-rose-500' : 'text-slate-400');
/** Emphasis for a value only when it needs attention (healthy / unknown values keep the normal text colour) */
export const attentionText = (l: TelemetryLevel) => (l === 'CRITICAL' ? 'text-rose-500 font-semibold' : l === 'WARNING' ? 'text-amber-500 font-semibold' : '');
const LEVEL_ICON = { HEALTHY: CheckCircle2, WARNING: AlertTriangle, CRITICAL: XCircle, UNKNOWN: HelpCircle } as const;
const LEVEL_WORD: Record<TelemetryLevel, string> = { HEALTHY: 'Healthy', WARNING: 'Warning', CRITICAL: 'Critical', UNKNOWN: 'Unknown' };

/** Icon + word + colour (never colour alone). `label` replaces the default word. */
export const LevelBadge: React.FC<{ level: TelemetryLevel; label?: string; className?: string }> = ({ level, label, className = '' }) => {
  const Icon = LEVEL_ICON[level];
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${levelText(level)} ${className}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{label ?? LEVEL_WORD[level]}</span>
    </span>
  );
};

/** Prominent banner for conditions such as OUTDATED AGENT or APPLICATION HEALTH CHECK FAILED */
export const Banner: React.FC<{ level: 'WARNING' | 'CRITICAL'; title: string; children?: React.ReactNode }> = ({ level, title, children }) => (
  <div role="alert" className={`p-2.5 rounded border text-[11px] ${level === 'CRITICAL' ? 'border-rose-500/50 bg-rose-500/5' : 'border-amber-500/50 bg-amber-500/5'}`}>
    <LevelBadge level={level} label={title} className="uppercase tracking-wide" />
    {children && <div className="mt-1 opacity-90">{children}</div>}
  </div>
);

/** Horizontal usage bar with the value as text; colour from a threshold band */
export const UsageBar: React.FC<{ value: number | null | undefined; band: Band; isDark: boolean; width?: string; label?: string }> = ({ value, band, isDark, width = 'w-24', label }) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="text-slate-400">—</span>;
  const l = levelOf(value, band);
  const color = l === 'CRITICAL' ? 'bg-rose-500' : l === 'WARNING' ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <span className="inline-flex items-center gap-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label}>
      <span className={`${width} h-1.5 rounded overflow-hidden inline-block ${ui(isDark).track}`}>
        <span className={`h-full block ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </span>
      <span className={`tabular-nums ${l === 'CRITICAL' ? 'text-rose-500 font-bold' : l === 'WARNING' ? 'text-amber-500 font-semibold' : ''}`}>{value.toFixed(1)}%</span>
    </span>
  );
};

/** Two-column key/value list */
export const KV: React.FC<{ rows: Array<[string, React.ReactNode]>; isDark: boolean }> = ({ rows, isDark }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
    {rows.map(([k, v]) => (
      <div key={k} className="flex gap-2 min-w-0"><span className={`w-36 shrink-0 ${ui(isDark).muted}`}>{k}</span><span className="break-words min-w-0">{v ?? '—'}</span></div>
    ))}
  </div>
);

export const NotReported: React.FC<{ isDark: boolean; children: React.ReactNode }> = ({ isDark, children }) => (
  <div className={`p-4 rounded border text-center text-[11px] font-sans ${isDark ? 'border-[#1E293B] text-slate-400' : 'border-slate-200 text-slate-600'}`}>{children}</div>
);

export const SectionTitle: React.FC<{ children: React.ReactNode; right?: React.ReactNode; isDark: boolean }> = ({ children, right, isDark }) => (
  <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
    <div className={`text-xs font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{children}</div>
    {right}
  </div>
);
