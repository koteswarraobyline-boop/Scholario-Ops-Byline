import React, { useState, useEffect } from 'react';
import { useOps } from '../../context/OpsContext';
import { Activity, ShieldCheck, AlertTriangle, Radio, RefreshCw, Zap } from 'lucide-react';

export const HeartbeatPulseChart: React.FC = () => {
  const { deadMan, triggerSimulatedScenario, runAllProbes, theme } = useOps();
  const isDark = theme === 'dark';

  const [tick, setTick] = useState(0);
  const [pulseAnimation, setPulseAnimation] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => (t + 1) % 100);
    }, 1200);
    return () => clearInterval(timer);
  }, []);

  const isHealthy = deadMan.status === 'HEALTHY';

  // ECG points data string representing normal sinus rhythm with P-Q-R-S-T wave
  // Normal wave: flat baseline, slight P bump, dip Q, high sharp R peak, deep S dip, gentle T wave, flat baseline
  const normalEcgPath = `
    M 0,28
    L 30,28
    Q 36,22 42,28
    L 60,28
    L 65,32
    L 72,4
    L 78,44
    L 84,28
    L 94,28
    Q 104,18 114,28
    L 140,28
    L 170,28
    Q 176,22 182,28
    L 200,28
    L 205,32
    L 212,4
    L 218,44
    L 224,28
    L 234,28
    Q 244,18 254,28
    L 280,28
    L 310,28
    Q 316,22 322,28
    L 340,28
    L 345,32
    L 352,4
    L 358,44
    L 364,28
    L 374,28
    Q 384,18 394,28
    L 420,28
    L 450,28
    Q 456,22 462,28
    L 480,28
    L 485,32
    L 492,4
    L 498,44
    L 504,28
    L 514,28
    Q 524,18 534,28
    L 560,28
    L 600,28
  `;

  // Flatline / arrhythmia path when silenced
  const flatlinePath = `
    M 0,28
    L 600,28
  `;

  return (
    <div className={`rounded-lg border p-4 transition-colors ${
      isDark 
        ? 'bg-[#0F172A] border-[#1E293B] text-slate-100' 
        : 'bg-white border-[#E2E8F0] text-slate-900 shadow-xs'
    }`}>
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-inherit">
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded ${
            isHealthy 
              ? (isDark ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' : 'bg-emerald-50 text-emerald-700 border border-emerald-200')
              : (isDark ? 'bg-rose-950 text-rose-400 border border-rose-900' : 'bg-rose-50 text-rose-700 border border-rose-200')
          }`}>
            <Activity className={`w-4 h-4 ${isHealthy ? 'animate-pulse' : ''}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs tracking-tight">Dead-Man Watchdog Heartbeat Stream</span>
              <span className={`text-[10px] font-mono px-2 py-0.2 rounded font-semibold ${
                isHealthy 
                  ? (isDark ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-emerald-100 text-emerald-800 border border-emerald-300')
                  : (isDark ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-rose-100 text-rose-800 border border-rose-300')
              }`}>
                {isHealthy ? 'SYNCHRONIZED (1.0 Hz)' : 'HEARTBEAT SILENCED'}
              </span>
            </div>
            <p className={`text-[11px] font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Origin: Zurich Switzerland node (ch-zh-monitor-01) · Out-of-band dead-man interval: 1000ms
            </p>
          </div>
        </div>

        {/* Quick Simulator Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => triggerSimulatedScenario('DEADMAN_SILENCE')}
            className={`px-2.5 py-1 text-[11px] font-mono rounded transition-colors flex items-center gap-1.5 border ${
              isHealthy
                ? (isDark ? 'bg-[#182030] hover:bg-[#202B40] text-amber-300 border-amber-900/60' : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200')
                : (isDark ? 'bg-[#182030] hover:bg-[#202B40] text-emerald-300 border-emerald-900/60' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200')
            }`}
            title="Simulate watchdog timeout or restore heartbeat"
          >
            <Radio className="w-3.5 h-3.5" />
            <span>{isHealthy ? 'Simulate Watchdog Silence' : 'Restore Heartbeat Sync'}</span>
          </button>

          <button
            onClick={() => runAllProbes()}
            className={`p-1.5 text-xs font-mono rounded transition-colors border ${
              isDark 
                ? 'bg-[#162033] hover:bg-[#223048] text-slate-300 border-slate-700' 
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
            }`}
            title="Probe now"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Heartbeat ECG Waveform Display */}
      <div className="py-3">
        <div className={`relative h-20 rounded border overflow-hidden ${
          isDark 
            ? 'bg-[#070B12] border-[#182438]' 
            : 'bg-[#F8FAFC] border-[#E2E8F0]'
        }`}>
          {/* Grid lines background */}
          <div 
            className="absolute inset-0 opacity-20 pointer-events-none" 
            style={{
              backgroundImage: isDark
                ? 'linear-gradient(to right, #2563EB 1px, transparent 1px), linear-gradient(to bottom, #2563EB 1px, transparent 1px)'
                : 'linear-gradient(to right, #94A3B8 1px, transparent 1px), linear-gradient(to bottom, #94A3B8 1px, transparent 1px)',
              backgroundSize: '20px 10px'
            }}
          />

          {/* SVG Waveform */}
          <svg className="w-full h-full" viewBox="0 0 600 50" preserveAspectRatio="none">
            {/* Baseline ghost line */}
            <path
              d="M 0,28 L 600,28"
              stroke={isDark ? '#1E293B' : '#CBD5E1'}
              strokeWidth="1"
              strokeDasharray="2 2"
              fill="none"
            />

            {/* Glowing heartbeat path */}
            <path
              d={isHealthy ? normalEcgPath : flatlinePath}
              stroke={isHealthy ? '#10B981' : '#F43F5E'}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              className={pulseAnimation && isHealthy ? 'animate-ecg' : ''}
              style={{
                filter: isHealthy 
                  ? 'drop-shadow(0px 0px 4px rgba(16, 185, 129, 0.7))' 
                  : 'drop-shadow(0px 0px 4px rgba(244, 63, 94, 0.7))'
              }}
            />

            {/* Live scanning needle */}
            {isHealthy && (
              <line
                x1={`${(tick * 6) % 600}`}
                y1="0"
                x2={`${(tick * 6) % 600}`}
                y2="50"
                stroke="#60A5FA"
                strokeWidth="1.5"
                strokeOpacity="0.8"
              />
            )}
          </svg>

          {/* Live blip indicator */}
          <div className="absolute top-2 right-3 flex items-center gap-2 font-mono text-[10px]">
            <span className={`w-2 h-2 rounded-full ${
              isHealthy ? 'bg-emerald-500 animate-ping' : 'bg-rose-500'
            }`} />
            <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>
              {isHealthy ? 'PULSE ACTIVE · 60 BPM' : 'HEARTBEAT DROP DETECTED'}
            </span>
          </div>
        </div>
      </div>

      {/* High-Level Telemetry Cards Underneath */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-xs">
        <div className={`p-2 rounded border ${
          isDark ? 'bg-[#121A2B] border-[#1D283E]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Probe Interval
          </div>
          <div className="font-semibold text-sm mt-0.5 text-blue-500">
            {deadMan.intervalSec}s (1000ms)
          </div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
            Out-of-band independent
          </div>
        </div>

        <div className={`p-2 rounded border ${
          isDark ? 'bg-[#121A2B] border-[#1D283E]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Roundtrip Jitter
          </div>
          <div className="font-semibold text-sm mt-0.5 text-emerald-500">
            14.2 ms <span className="text-[10px] font-normal text-slate-400">±1.1ms</span>
          </div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
            Packet loss: 0.00%
          </div>
        </div>

        <div className={`p-2 rounded border ${
          isDark ? 'bg-[#121A2B] border-[#1D283E]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Tolerance Window
          </div>
          <div className="font-semibold text-sm mt-0.5 text-indigo-400">
            {deadMan.toleranceSec}s max delay
          </div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
            Misses: {deadMan.consecutiveMisses}
          </div>
        </div>

        <div className={`p-2 rounded border ${
          isDark ? 'bg-[#121A2B] border-[#1D283E]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Alert Escalation
          </div>
          <div className={`font-semibold text-sm mt-0.5 ${isHealthy ? 'text-slate-400' : 'text-rose-500'}`}>
            {isHealthy ? 'Armed (Standby)' : 'DISPATCHED'}
          </div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
            Teams + On-Call SMS
          </div>
        </div>
      </div>
    </div>
  );
};
