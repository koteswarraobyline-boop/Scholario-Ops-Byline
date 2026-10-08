import React, { useState, useEffect } from 'react';
import { useOps } from '../../context/OpsContext';
import { Activity, Settings2, Info } from 'lucide-react';
import { DeadManControlPlane } from '../../types';
import { LevelBadge } from '../infrastructure/telemetryUi';
import { deadManLabel, deadManLevel, deadManLatency } from '../ui/deadman';

/** Parses an ISO timestamp; returns null for '' / invalid values. */
const parseTs = (iso?: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

const fmtAgo = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
};

const fmtDuration = (sec: number) => (sec >= 60 && sec % 60 === 0 ? `${sec / 60}m` : `${sec}s`);

// ECG path (purely decorative waveform)
const normalEcgPath = `
  M 0,28 L 30,28 Q 36,22 42,28 L 60,28 L 65,32 L 72,4 L 78,44 L 84,28 L 94,28 Q 104,18 114,28 L 140,28
  L 170,28 Q 176,22 182,28 L 200,28 L 205,32 L 212,4 L 218,44 L 224,28 L 234,28 Q 244,18 254,28 L 280,28
  L 310,28 Q 316,22 322,28 L 340,28 L 345,32 L 352,4 L 358,44 L 364,28 L 374,28 Q 384,18 394,28 L 420,28
  L 450,28 Q 456,22 462,28 L 480,28 L 485,32 L 492,4 L 498,44 L 504,28 L 514,28 Q 524,18 534,28 L 560,28
  L 600,28
`;
const flatlinePath = 'M 0,28 L 600,28';

/**
 * Dead-man heartbeat panel. Every value is the backend's (server/deadman.ts); the heartbeat URL is
 * never sent to the browser. Missing values are "—" / "None yet", never 0.
 */
export const DeadManPanel: React.FC<{ deadMan: DeadManControlPlane; isDark: boolean; now: number }> = ({ deadMan, isDark, now }) => {
  const configured = deadMan.configured;
  const level = deadManLevel(deadMan.status);
  const healthy = deadMan.status === 'HEALTHY';
  const lastOk = parseTs(deadMan.lastSuccessAt ?? deadMan.lastHeartbeatReceivedAt);
  const lastTry = parseTs(deadMan.lastAttemptAt);
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const cell = `p-2.5 rounded border min-w-0 ${isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200'}`;
  const label = `text-[10px] uppercase tracking-wider ${muted}`;
  const value = 'font-semibold text-sm mt-0.5 break-words';
  const remainingSec = lastOk !== null ? Math.max(0, Math.round((lastOk + deadMan.toleranceSec * 1000 - now) / 1000)) : null;

  const Field: React.FC<{ k: string; children: React.ReactNode; sub?: React.ReactNode; tone?: string }> = ({ k, children, sub, tone }) => (
    <div className={cell}>
      <div className={label}>{k}</div>
      <div className={`${value} ${tone ?? ''}`}>{children}</div>
      {sub && <div className={`text-[10px] mt-0.5 break-words ${muted}`}>{sub}</div>}
    </div>
  );

  return (
    <div className={`rounded-lg border p-4 transition-colors min-w-0 ${isDark ? 'bg-[#111726] border-[#1E293B] text-slate-100' : 'bg-white border-[#E2E8F0] text-slate-900 shadow-xs'}`}>
      <div className={`flex flex-wrap items-start justify-between gap-3 pb-3 border-b ${isDark ? 'border-[#1E293B]' : 'border-slate-100'}`}>
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <div className={`p-1.5 rounded shrink-0 ${
            level === 'HEALTHY' ? (isDark ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' : 'bg-emerald-50 text-emerald-700 border border-emerald-200')
              : level === 'CRITICAL' ? (isDark ? 'bg-rose-950 text-rose-400 border border-rose-900' : 'bg-rose-50 text-rose-700 border border-rose-200')
                : level === 'WARNING' ? (isDark ? 'bg-amber-950 text-amber-400 border border-amber-900' : 'bg-amber-50 text-amber-700 border border-amber-200')
                  : (isDark ? 'bg-slate-800 text-slate-400 border border-slate-700' : 'bg-slate-100 text-slate-500 border border-slate-200')
          }`}>
            <Activity className={`w-4 h-4 ${healthy ? 'animate-pulse' : ''}`} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold text-xs tracking-tight">Dead-Man Heartbeat</span>
              <LevelBadge level={level} label={deadManLabel(deadMan.status).toUpperCase()} className="text-[10px] font-mono" />
            </div>
            <p className={`text-[11px] font-mono mt-0.5 break-words ${muted}`}>
              {configured
                ? `This control plane pings an external watchdog (${deadMan.nodeLocation}) every ${fmtDuration(deadMan.intervalSec)}; the watchdog alerts if pings stop for longer than its own grace period.`
                : deadMan.configError ?? 'Outbound heartbeat to an external watchdog is not set up'}
            </p>
          </div>
        </div>
      </div>

      {!configured ? (
        <div className={`mt-3 p-3 rounded border font-mono text-xs space-y-2 ${isDark ? 'bg-[#0B0F17] border-[#1D283E] text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
          <div className="flex items-center gap-2 font-semibold">
            <Settings2 className="w-3.5 h-3.5 text-blue-400 shrink-0" aria-hidden="true" />
            <span>How to enable the dead-man switch</span>
          </div>
          <p className={`font-sans leading-relaxed break-words ${muted}`}>
            This control plane sends periodic outbound heartbeats to an <strong>external</strong> watchdog (for example a
            healthchecks-style ping URL). The external watchdog is responsible for alerting if heartbeats stop — so a
            complete outage of Scholario Ops is still detected.
          </p>
          <p className={`font-sans leading-relaxed break-words ${muted}`}>
            Set <code className="px-1 rounded bg-blue-500/10 text-blue-400 break-all">DEADMAN_HEARTBEAT_URL</code> on the Scholario Ops
            server and restart the backend. Optional: <code className="px-1 rounded bg-blue-500/10 text-blue-400 break-all">DEADMAN_INTERVAL_SEC</code> (default 60)
            and <code className="px-1 rounded bg-blue-500/10 text-blue-400 break-all">DEADMAN_TOLERANCE_SEC</code> (default 180).
          </p>
        </div>
      ) : (
        <>
          {/* Decorative waveform — the fields below are the real state */}
          <div className="py-3">
            <div className={`relative h-14 rounded border overflow-hidden ${isDark ? 'bg-[#070B12] border-[#182438]' : 'bg-[#F8FAFC] border-[#E2E8F0]'}`}>
              <svg className="w-full h-full" viewBox="0 0 600 50" preserveAspectRatio="none" aria-hidden="true">
                <path d="M 0,28 L 600,28" stroke={isDark ? '#1E293B' : '#CBD5E1'} strokeWidth="1" strokeDasharray="2 2" fill="none" />
                <path d={healthy ? normalEcgPath : flatlinePath} stroke={healthy ? '#10B981' : level === 'WARNING' ? '#F59E0B' : level === 'CRITICAL' ? '#F43F5E' : '#64748B'}
                  strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" className={healthy ? 'animate-ecg' : ''} />
              </svg>
              <div className={`absolute top-1.5 right-2 left-2 text-right font-mono text-[10px] truncate ${muted}`}>
                {healthy && lastOk !== null ? `LAST PING ${fmtAgo(now - lastOk).toUpperCase()}`
                  : deadMan.status === 'PENDING' ? 'FIRST PING IN PROGRESS'
                    : `${deadMan.consecutiveFailures} FAILED ATTEMPT(S)`}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2 font-mono text-xs">
            <Field k="State"><LevelBadge level={level} label={deadManLabel(deadMan.status)} /></Field>
            <Field k="Heartbeat worker" sub="loop in this process" tone={deadMan.workerRunning ? 'text-emerald-500' : 'text-rose-500'}>
              {deadMan.workerRunning ? 'Running' : 'Stopped'}
            </Field>
            <Field k="External watchdog" sub={deadMan.nodeLocation}>Configured</Field>
            <Field k="Interval / tolerance">{fmtDuration(deadMan.intervalSec)} / {fmtDuration(deadMan.toleranceSec)}</Field>
            <Field k="Last successful ping" tone={lastOk !== null ? 'text-emerald-500' : muted}
              sub={lastOk !== null ? new Date(lastOk).toLocaleString() : 'Since server start'}>
              {lastOk !== null ? fmtAgo(now - lastOk) : 'None yet'}
            </Field>
            <Field k="Last attempt" sub={deadMan.lastHttpStatus !== null ? `HTTP ${deadMan.lastHttpStatus}` : lastTry !== null ? 'no HTTP response' : undefined}>
              {lastTry !== null ? fmtAgo(now - lastTry) : 'Not reported'}
            </Field>
            <Field k="Latency">{deadManLatency(deadMan)}</Field>
            <Field k="Consecutive failures" tone={deadMan.consecutiveFailures > 0 ? 'text-amber-500' : undefined}
              sub={remainingSec !== null && deadMan.consecutiveFailures > 0 ? `${remainingSec}s of tolerance left` : undefined}>
              {deadMan.lastAttemptAt ? deadMan.consecutiveFailures : '—'}
            </Field>
          </div>
          {deadMan.lastError && (
            <div className="mt-2 text-[11px] font-mono text-rose-500 break-words">Last error: {deadMan.lastError}</div>
          )}
          <p className={`mt-2 flex items-start gap-1.5 text-[11px] font-sans leading-relaxed ${muted}`}>
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span className="min-w-0 break-words">
              These are this server's own results (did our ping succeed). Whether the external watchdog received the pings —
              and its alerting — is checked in the watchdog service itself; Scholario Ops cannot verify it from here.
            </span>
          </p>
        </>
      )}
    </div>
  );
};

export const HeartbeatPulseChart: React.FC = () => {
  const { deadMan, theme } = useOps();
  // 1s clock so "last ping" ages in real time
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <DeadManPanel deadMan={deadMan} isDark={theme === 'dark'} now={now} />;
};
