import React, { useState, useEffect } from 'react';
import { useOps } from '../../context/OpsContext';
import { Activity, AlertTriangle, Settings2 } from 'lucide-react';

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

export const HeartbeatPulseChart: React.FC = () => {
  const { deadMan, theme } = useOps();
  const isDark = theme === 'dark';

  // 1s clock so "last heartbeat" ages and the silence budget counts down in real time
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const isConfigured = deadMan.status !== 'NOT_CONFIGURED';
  const isHealthy = deadMan.status === 'HEALTHY';
  const lastBeat = parseTs(deadMan.lastHeartbeatReceivedAt);
  const intervalSec = deadMan.intervalSec;
  const toleranceSec = deadMan.toleranceSec;

  // Remaining silence budget before the watchdog would flag CRITICAL_SILENCE (derived from the real last heartbeat)
  const remainingSec = lastBeat !== null ? Math.max(0, Math.round((lastBeat + toleranceSec * 1000 - now) / 1000)) : null;
  const remainingPct = remainingSec !== null && toleranceSec > 0 ? Math.min(100, (remainingSec / toleranceSec) * 100) : 0;
  const lastAlert = parseTs(deadMan.lastAlertSentAt);

  const cardClass = `p-2.5 rounded border ${isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200'}`;
  const labelClass = `text-[10px] uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`;
  const subClass = `text-[10px] mt-0.5 truncate ${isDark ? 'text-slate-400' : 'text-slate-600'}`;

  const badge = !isConfigured
    ? { text: 'NOT CONFIGURED', cls: isDark ? 'bg-slate-800 text-slate-300 border border-slate-700' : 'bg-slate-100 text-slate-700 border border-slate-300' }
    : isHealthy
      ? { text: lastBeat !== null ? 'HEARTBEAT OK' : 'AWAITING FIRST HEARTBEAT', cls: isDark ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-emerald-100 text-emerald-800 border border-emerald-300' }
      : { text: 'HEARTBEAT SILENCED', cls: isDark ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-rose-100 text-rose-800 border border-rose-300' };

  return (
    <div className={`rounded-lg border p-4 transition-colors ${
      isDark
        ? 'bg-[#111726] border-[#1E293B] text-slate-100'
        : 'bg-white border-[#E2E8F0] text-slate-900 shadow-xs'
    }`}>
      {/* Top Header */}
      <div className={`flex flex-wrap items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-100'
      }`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`p-1.5 rounded ${
            !isConfigured
              ? (isDark ? 'bg-slate-800 text-slate-400 border border-slate-700' : 'bg-slate-100 text-slate-500 border border-slate-200')
              : isHealthy
                ? (isDark ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' : 'bg-emerald-50 text-emerald-700 border border-emerald-200')
                : (isDark ? 'bg-rose-950 text-rose-400 border border-rose-900' : 'bg-rose-50 text-rose-700 border border-rose-200')
          }`}>
            <Activity className={`w-4 h-4 ${isConfigured && isHealthy ? 'animate-pulse' : ''}`} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-xs tracking-tight">{deadMan.name || 'Dead-Man Heartbeat'}</span>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${badge.cls}`}>{badge.text}</span>
            </div>
            <p className={`text-[11px] font-mono mt-0.5 truncate ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              {isConfigured
                ? `This control plane pings ${deadMan.nodeLocation || 'the external heartbeat service'} every ${fmtDuration(intervalSec)} · silence alert after ${fmtDuration(toleranceSec)}`
                : 'Outbound heartbeat to an external watchdog is not set up'}
            </p>
          </div>
        </div>
      </div>

      {!isConfigured ? (
        <div className={`mt-3 p-3 rounded border font-mono text-xs space-y-2 ${
          isDark ? 'bg-[#0B0F17] border-[#1D283E] text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
        }`}>
          <div className="flex items-center gap-2 font-semibold">
            <Settings2 className="w-3.5 h-3.5 text-blue-400" />
            <span>How to enable the dead-man switch</span>
          </div>
          <p className={`font-sans leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            The dead-man switch makes this server ping an <strong>external</strong> heartbeat service (for example a
            healthchecks-style "ping URL"). If this control plane goes down, the external service stops receiving
            pings and alerts you independently.
          </p>
          <p className={`font-sans leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Set <code className="px-1 rounded bg-blue-500/10 text-blue-400">DEADMAN_HEARTBEAT_URL</code> in the server
            <code className="px-1 rounded bg-blue-500/10 text-blue-400 ml-1">.env</code> and restart. Optional:
            <code className="px-1 rounded bg-blue-500/10 text-blue-400 ml-1">DEADMAN_INTERVAL_SEC</code> (default 60) and
            <code className="px-1 rounded bg-blue-500/10 text-blue-400 ml-1">DEADMAN_TOLERANCE_SEC</code> (default 180).
          </p>
        </div>
      ) : (
        <>
          {/* Heartbeat waveform (decorative — the numbers below are the real state) */}
          <div className="py-3">
            <div className={`relative h-20 rounded border overflow-hidden ${
              isDark ? 'bg-[#070B12] border-[#182438]' : 'bg-[#F8FAFC] border-[#E2E8F0]'
            }`}>
              <div
                className="absolute inset-0 opacity-20 pointer-events-none"
                style={{
                  backgroundImage: isDark
                    ? 'linear-gradient(to right, #2563EB 1px, transparent 1px), linear-gradient(to bottom, #2563EB 1px, transparent 1px)'
                    : 'linear-gradient(to right, #94A3B8 1px, transparent 1px), linear-gradient(to bottom, #94A3B8 1px, transparent 1px)',
                  backgroundSize: '20px 10px'
                }}
              />
              <svg className="w-full h-full" viewBox="0 0 600 50" preserveAspectRatio="none" aria-hidden="true">
                <path d="M 0,28 L 600,28" stroke={isDark ? '#1E293B' : '#CBD5E1'} strokeWidth="1" strokeDasharray="2 2" fill="none" />
                <path
                  d={isHealthy ? normalEcgPath : flatlinePath}
                  stroke={isHealthy ? '#10B981' : '#F43F5E'}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  className={isHealthy ? 'animate-ecg' : ''}
                  style={{
                    filter: isHealthy
                      ? 'drop-shadow(0px 0px 4px rgba(16, 185, 129, 0.7))'
                      : 'drop-shadow(0px 0px 4px rgba(244, 63, 94, 0.7))'
                  }}
                />
              </svg>
              <div className="absolute top-2 right-3 flex items-center gap-2 font-mono text-[10px]">
                <span className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-emerald-500 animate-ping' : 'bg-rose-500'}`} />
                <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>
                  {isHealthy
                    ? (lastBeat !== null ? `LAST PING ${fmtAgo(now - lastBeat).toUpperCase()}` : 'WAITING FOR FIRST PING')
                    : `HEARTBEAT FAILING · ${deadMan.consecutiveMisses} MISSED`}
                </span>
              </div>
            </div>
          </div>

          {/* Real dead-man state */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-xs">
            <div className={cardClass}>
              <div className={labelClass}>Ping Interval</div>
              <div className="font-semibold text-sm mt-0.5 text-blue-500">{fmtDuration(intervalSec)}</div>
              <div className={subClass} title={deadMan.targetControlPlane}>{deadMan.targetControlPlane || deadMan.nodeLocation}</div>
            </div>

            <div className={cardClass}>
              <div className={labelClass}>Last Successful Ping</div>
              <div className={`font-semibold text-sm mt-0.5 ${lastBeat !== null ? 'text-emerald-500' : (isDark ? 'text-slate-400' : 'text-slate-500')}`}>
                {lastBeat !== null ? fmtAgo(now - lastBeat) : 'None yet'}
              </div>
              <div className={subClass}>
                {lastBeat !== null ? new Date(lastBeat).toLocaleString() : 'Since server start'}
              </div>
            </div>

            <div className={`p-2.5 rounded border ${
              deadMan.consecutiveMisses > 0
                ? (isDark ? 'bg-amber-950/30 border-amber-900/60' : 'bg-amber-50 border-amber-300')
                : (isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200')
            }`}>
              <div className={labelClass}>Consecutive Misses</div>
              <div className={`font-semibold text-sm mt-0.5 ${deadMan.consecutiveMisses > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                {deadMan.consecutiveMisses}
              </div>
              <div className={subClass}>
                {lastAlert !== null ? `Last alert ${fmtAgo(now - lastAlert)}` : 'No silence alerts sent'}
              </div>
            </div>

            <div className={`p-2.5 rounded border ${
              !isHealthy
                ? (isDark ? 'bg-rose-950/30 border-rose-900/60' : 'bg-rose-50 border-rose-300')
                : (isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200')
            }`}>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] uppercase tracking-wider ${!isHealthy ? 'text-rose-400 font-semibold' : (isDark ? 'text-slate-400' : 'text-slate-500')}`}>
                  Silence Budget
                </span>
                <span className={`text-[10px] font-bold ${!isHealthy ? 'text-rose-500' : 'text-emerald-500'}`}>
                  {!isHealthy ? 'EXCEEDED' : remainingSec !== null ? `${remainingSec}s / ${toleranceSec}s` : '—'}
                </span>
              </div>
              <div className="w-full bg-slate-700/30 h-1.5 rounded-full overflow-hidden mt-1.5">
                <div
                  className={`h-full transition-all duration-500 ${!isHealthy ? 'bg-rose-500' : 'bg-emerald-500'}`}
                  style={{ width: !isHealthy ? '100%' : `${remainingPct}%` }}
                />
              </div>
              <div className={`text-[10px] mt-1 truncate flex items-center gap-1 ${!isHealthy ? 'text-rose-400 font-semibold' : (isDark ? 'text-slate-400' : 'text-slate-600')}`}>
                {!isHealthy && <AlertTriangle className="w-3 h-3 shrink-0" />}
                {!isHealthy ? 'Outbound pings are failing' : `Tolerance window ${fmtDuration(toleranceSec)}`}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
