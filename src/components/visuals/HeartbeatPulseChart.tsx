import React, { useState, useEffect } from 'react';
import { useOps } from '../../context/OpsContext';
import { Activity, Info, ChevronRight } from 'lucide-react';
import { DeadManControlPlane, HeartbeatCheck, HeartbeatGroup, ServerHeartbeat } from '../../types';
import { LevelBadge } from '../infrastructure/telemetryUi';
import { deadManBadge, deadManLabel, deadManLevel, fmtLatency } from '../ui/deadman';

/** Parses an ISO timestamp; returns null for '' / invalid values. */
const parseTs = (iso?: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

const fmtAge = (iso: string | null | undefined, now: number) => {
  const t = parseTs(iso);
  if (t === null) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m ago` : `${Math.floor(h / 24)}d ago`;
};

const fmtSec = (sec: number | null | undefined) =>
  sec === null || sec === undefined ? '—' : sec >= 120 && sec % 60 === 0 ? `${sec / 60}m` : `${Math.round(sec)}s`;

// ECG path (purely decorative waveform — the UI animation, not a network heartbeat)
const normalEcgPath = `
  M 0,28 L 30,28 Q 36,22 42,28 L 60,28 L 65,32 L 72,4 L 78,44 L 84,28 L 94,28 Q 104,18 114,28 L 140,28
  L 170,28 Q 176,22 182,28 L 200,28 L 205,32 L 212,4 L 218,44 L 224,28 L 234,28 Q 244,18 254,28 L 280,28
  L 310,28 Q 316,22 322,28 L 340,28 L 345,32 L 352,4 L 358,44 L 364,28 L 374,28 Q 384,18 394,28 L 420,28
  L 450,28 Q 456,22 462,28 L 480,28 L 485,32 L 492,4 L 498,44 L 504,28 L 514,28 Q 524,18 534,28 L 560,28
  L 600,28
`;
const flatlinePath = 'M 0,28 L 600,28';

const KIND_LABEL = { applications: 'Application checks', services: 'Services', databases: 'Database' } as const;

/** One check, expanded under its row */
const CheckLine: React.FC<{ c: HeartbeatCheck; now: number; muted: string }> = ({ c, now, muted }) => (
  <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-1 min-w-0">
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <LevelBadge level={deadManLevel(c.state)} label={deadManLabel(c.state).toUpperCase()} className="text-[10px] shrink-0" />
        <span className="font-semibold break-words min-w-0">{c.name}</span>
      </div>
      <div className={`text-[10px] break-words ${muted}`}>{c.detail}{c.target ? ` · ${c.target}` : ''}</div>
    </div>
    <div className={`text-[10px] text-right tabular-nums ${muted}`}>
      <div>checked {fmtAge(c.lastCheckAt, now)}</div>
      <div>
        {c.latencyMs !== null ? fmtLatency(c.latencyMs) : ''}
        {c.httpStatus !== null ? `${c.latencyMs !== null ? ' · ' : ''}HTTP ${c.httpStatus}` : ''}
        {c.failures ? ` · ${c.failures} fail` : ''}
        {c.restartCount ? ` · ${c.restartCount} restart(s)` : ''}
      </div>
      {c.state !== 'HEALTHY' && c.lastSuccessAt && <div>last OK {fmtAge(c.lastSuccessAt, now)}</div>}
    </div>
  </li>
);

/** A row of the per-server card: label · state · key metrics, expandable to every individual check */
const GroupRow: React.FC<{ label: string; g: HeartbeatGroup; now: number; muted: string; empty: string }> = ({ label, g, now, muted, empty }) => {
  const latest = g.checks.map(c => c.lastCheckAt).filter(Boolean).sort().at(-1) ?? null;
  const failures = g.checks.reduce((a, c) => a + (c.failures ?? 0), 0);
  const latencies = g.checks.map(c => c.latencyMs).filter((x): x is number => x !== null);
  const summary = (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] sm:grid-cols-[10rem_7.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 items-baseline min-w-0">
      <span className="flex items-center gap-1 min-w-0">
        {g.total > 0 && <ChevronRight className="w-3 h-3 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />}
        <span className="truncate" title={label}>{label}</span>
      </span>
      <span>{g.total ? <LevelBadge level={deadManLevel(g.state)} label={deadManLabel(g.state).toUpperCase()} /> : <span className={muted}>—</span>}</span>
      <span className={`col-span-2 sm:col-span-1 text-[10px] break-words ${muted}`}>
        {g.total === 0 ? empty
          : `${g.healthy}/${g.total} healthy · checked ${fmtAge(latest, now)}${latencies.length ? ` · ${fmtLatency(Math.max(...latencies))} max` : ''}${failures ? ` · ${failures} failure(s)` : ''}`}
      </span>
    </div>
  );
  if (g.total === 0) return <div className="py-1.5 pl-4">{summary}</div>;
  return (
    <details className="group py-1.5">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{summary}</summary>
      <ul className="mt-1 ml-4 pl-2 border-l border-slate-500/30">
        {g.checks.map(c => <CheckLine key={c.key} c={c} now={now} muted={muted} />)}
      </ul>
    </details>
  );
};

const ServerCard: React.FC<{ s: ServerHeartbeat; now: number; isDark: boolean }> = ({ s, now, isDark }) => {
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const hb = s.server;
  return (
    <div className={`p-3 rounded border min-w-0 font-mono text-[11px] ${isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 pb-2 mb-1 border-b border-slate-500/20 min-w-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-[10px] font-bold px-1.5 rounded border ${s.environment === 'PRD' ? 'text-blue-500 border-blue-500/40' : 'text-amber-500 border-amber-500/40'}`}>{s.environment}</span>
            <span className="font-bold text-xs break-all min-w-0">{s.environment} VPS · {s.hostname}</span>
          </div>
          <div className={`text-[10px] ${muted}`}>{s.ip}</div>
        </div>
        <LevelBadge level={deadManLevel(s.state)} label={deadManLabel(s.state).toUpperCase()} className="text-xs" />
      </div>

      {/* Server heartbeat = the agent's telemetry delivery */}
      <div className="py-1.5 pl-4">
        <div className="grid grid-cols-[9rem_minmax(0,1fr)] sm:grid-cols-[10rem_7.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 items-baseline min-w-0">
          <span>Server heartbeat</span>
          <span><LevelBadge level={deadManLevel(hb.state)} label={deadManLabel(hb.state).toUpperCase()} /></span>
          <span className={`col-span-2 sm:col-span-1 text-[10px] break-words ${muted}`}>
            {hb.lastSuccessAt
              ? `last report ${fmtAge(hb.lastSuccessAt, now)} · every ${fmtSec(hb.intervalSec)} · delivery ${fmtLatency(hb.latencyMs)}${hb.failures ? ` · ${hb.failures} missed` : ''}`
              : hb.detail}
          </span>
        </div>
        {hb.lastSuccessAt && <div className={`text-[10px] pl-0 mt-0.5 break-words ${muted}`}>{hb.detail} · fresh for {fmtSec(hb.toleranceSec)}</div>}
      </div>
      <GroupRow label={KIND_LABEL.applications} g={s.applications} now={now} muted={muted} empty="No application with an app port on this server (Setup → application → environment details)" />
      <GroupRow label={KIND_LABEL.services} g={s.services} now={now} muted={muted} empty="No watched services (SERVICES= in /etc/scholario-agent.conf)" />
      <GroupRow label={KIND_LABEL.databases} g={s.databases} now={now} muted={muted} empty="No database probe (DB_ENGINE= in /etc/scholario-agent.conf)" />
    </div>
  );
};

/**
 * Dead-Man Watchdog Heartbeat Stream: the heartbeat of the MONITORED infrastructure (PRD / DR servers and
 * the applications, services and databases on them), from the agent reports Scholario Ops receives.
 * Scholario Ops is the monitoring control plane, not a target. No external watchdog, no URL.
 */
export const DeadManPanel: React.FC<{ deadMan: DeadManControlPlane; isDark: boolean; now: number }> = ({ deadMan, isDark, now }) => {
  const level = deadManLevel(deadMan.status);
  const healthy = deadMan.status === 'HEALTHY';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const c = deadMan.counts;
  const tone = level === 'HEALTHY' ? (isDark ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-emerald-100 text-emerald-800 border border-emerald-300')
    : level === 'CRITICAL' ? (isDark ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-rose-100 text-rose-800 border border-rose-300')
      : level === 'WARNING' ? (isDark ? 'bg-amber-950 text-amber-300 border border-amber-800' : 'bg-amber-100 text-amber-800 border border-amber-300')
        : (isDark ? 'bg-slate-800 text-slate-300 border border-slate-700' : 'bg-slate-100 text-slate-700 border border-slate-300');

  return (
    <div className={`rounded-lg border p-4 transition-colors min-w-0 ${isDark ? 'bg-[#111726] border-[#1E293B] text-slate-100' : 'bg-white border-[#E2E8F0] text-slate-900 shadow-xs'}`}>
      <div className={`flex flex-wrap items-start justify-between gap-3 pb-3 border-b ${isDark ? 'border-[#1E293B]' : 'border-slate-100'}`}>
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <div className={`p-1.5 rounded shrink-0 ${tone}`}>
            <Activity className={`w-4 h-4 ${healthy ? 'animate-pulse' : ''}`} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold text-xs tracking-tight">Dead-Man Watchdog Heartbeat Stream</span>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${tone}`}>{deadManBadge(deadMan.status)}</span>
            </div>
            <p className={`text-[11px] font-mono mt-0.5 break-words ${muted}`}>
              {deadMan.servers.length
                ? `Monitoring ${deadMan.servers.map(s => `${s.environment} VPS`).join(', ')} — server heartbeats, application checks, services and databases. Scholario Ops is the monitoring control plane.`
                : 'No server registered yet — add the PRD and DR VPS in Setup and install the agent.'}
            </p>
          </div>
        </div>
        {c.total > 0 && (
          <div className={`text-[10px] font-mono text-right ${muted}`}>
            <span className="text-emerald-500 font-semibold">{c.healthy} healthy</span>
            {c.degraded > 0 && <> · <span className="text-amber-500 font-semibold">{c.degraded} degraded</span></>}
            {c.failing > 0 && <> · <span className="text-rose-500 font-semibold">{c.failing} failing</span></>}
            {c.unknown > 0 && <> · {c.unknown} unknown</>}
          </div>
        )}
      </div>

      {/* Waveform: a UI animation only (it does not mean a network heartbeat every second) */}
      <div className="py-3">
        <div className={`relative h-14 rounded border overflow-hidden ${isDark ? 'bg-[#070B12] border-[#182438]' : 'bg-[#F8FAFC] border-[#E2E8F0]'}`}>
          <svg className="w-full h-full" viewBox="0 0 600 50" preserveAspectRatio="none" aria-hidden="true">
            <path d="M 0,28 L 600,28" stroke={isDark ? '#1E293B' : '#CBD5E1'} strokeWidth="1" strokeDasharray="2 2" fill="none" />
            <path d={healthy ? normalEcgPath : flatlinePath} stroke={healthy ? '#10B981' : level === 'WARNING' ? '#F59E0B' : level === 'CRITICAL' ? '#F43F5E' : '#64748B'}
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" className={healthy ? 'animate-ecg' : ''} />
          </svg>
        </div>
        <div className={`mt-1 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[10px] ${muted}`}>
          <span>UI stream: 1 Hz refresh (animation only)</span>
          <span>Server telemetry: agent reports every {fmtSec(deadMan.telemetryIntervalSec)}</span>
          <span>Applications / services / databases: every {deadMan.telemetryIntervalSec ? fmtSec(deadMan.telemetryIntervalSec * 3) : '—'}</span>
          <span>Stale after {fmtSec(deadMan.staleAfterSec)} · disconnected after {fmtSec(deadMan.disconnectedAfterSec)}</span>
        </div>
      </div>

      {deadMan.servers.length > 0 && (
        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3 [&>*]:min-w-0">
          {deadMan.servers.map(s => <ServerCard key={s.serverId} s={s} now={now} isDark={isDark} />)}
        </div>
      )}

      <p className={`mt-3 flex items-start gap-1.5 text-[11px] font-sans leading-relaxed ${muted}`}>
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
        <span className="min-w-0 break-words">
          Heartbeats come from the read-only telemetry agent on each server. A server whose agent stops reporting turns STALE, then
          DISCONNECTED, and opens an incident; failing application checks, failed services and unavailable databases do too, and
          recover automatically. Expand a row to see every check.
        </span>
      </p>
    </div>
  );
};

export const HeartbeatPulseChart: React.FC = () => {
  const { deadMan, theme } = useOps();
  // 1 Hz UI clock so ages ("12s ago") stay current between data updates
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <DeadManPanel deadMan={deadMan} isDark={theme === 'dark'} now={now} />;
};
