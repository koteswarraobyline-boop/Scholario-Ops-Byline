import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { 
  Radio, 
  Search, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Activity,
  Heart
} from 'lucide-react';
import { HeartbeatPulseChart } from '../visuals/HeartbeatPulseChart';

export const MonitorsView: React.FC = () => {
  const { monitors, applications, runProbeCheck, runAllProbes, theme } = useOps();
  const isDark = theme === 'dark';

  const [filterType, setFilterType] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [probingId, setProbingId] = useState<string | null>(null);

  const handleManualCheck = (id: string) => {
    setProbingId(id);
    runProbeCheck(id);
    setTimeout(() => setProbingId(null), 500);
  };

  const filteredMonitors = monitors
    .filter(m => {
      if (filterType === 'ALL') return true;
      if (filterType === 'FAILING') return m.status !== 'HEALTHY';
      return m.type === filterType;
    })
    .filter(m => {
      const q = search.toLowerCase();
      const app = applications.find(a => a.id === m.applicationId);
      return (
        m.name.toLowerCase().includes(q) ||
        m.target.toLowerCase().includes(q) ||
        app?.name.toLowerCase().includes(q)
      );
    });

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            MONITORING PROBE ENGINE &amp; HEARTBEAT STREAM
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            55+ continuous probes (HTTPS, DB replication, connection pools, worker heartbeats &amp; dead-man watchdog)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => runAllProbes()}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium rounded transition-colors border cursor-pointer ${
              isDark 
                ? 'text-slate-200 bg-[#162033] hover:bg-[#1C2942] border-[#243552]' 
                : 'text-slate-700 bg-white hover:bg-slate-50 border-slate-300 shadow-2xs'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5 text-blue-500" />
            <span>PROBE ALL TARGETS</span>
          </button>
        </div>
      </div>

      {/* Embedded Live Dead-Man Watchdog Heartbeat Waveform */}
      <HeartbeatPulseChart />

      {/* 4 Monitoring Operational Principles */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 font-mono text-xs">
        <div className={`p-3 rounded border space-y-1 ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="text-[9px] font-bold text-blue-500 uppercase tracking-wider">1. Consecutive Failures</div>
          <div className="text-xs font-semibold">3-Failure Threshold</div>
          <p className={`text-[11px] font-sans leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Automatic retry on blips #1 &amp; #2. Incidents fire exclusively upon confirmed 3/3 failure sequence.
          </p>
        </div>

        <div className={`p-3 rounded border space-y-1 ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">2. Consecutive Recovery</div>
          <div className="text-xs font-semibold">3-Pass Verification</div>
          <p className={`text-[11px] font-sans leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Flapping prevention. Incidents do not resolve until 3 consecutive successful health probe confirmations.
          </p>
        </div>

        <div className={`p-3 rounded border space-y-1 ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="text-[9px] font-bold text-amber-500 uppercase tracking-wider">3. Incident Deduplication</div>
          <div className="text-xs font-semibold">Fingerprint Matching</div>
          <p className={`text-[11px] font-sans leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Repeated failures update existing incident timeline instead of opening duplicate tickets.
          </p>
        </div>

        <div className={`p-3 rounded border space-y-1 ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="text-[9px] font-bold text-indigo-500 uppercase tracking-wider">4. Watchdog Decoupling</div>
          <div className="text-xs font-semibold">Zurich Control Plane</div>
          <p className={`text-[11px] font-sans leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Independent monitoring outside Hostinger cluster verifies system is alive even if agents crash.
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-xs">
        <div className="flex flex-wrap items-center gap-1">
          {['ALL', 'FAILING', 'HTTPS', 'TCP', 'DB_CONN', 'DEAD_MAN'].map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                filterType === t 
                  ? 'bg-blue-600 text-white font-semibold shadow-xs' 
                  : isDark 
                    ? 'text-slate-400 hover:bg-[#162033]' 
                    : 'text-slate-600 hover:bg-slate-200 bg-slate-100'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
          <input
            type="text"
            placeholder="Search probe or target..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`w-full pl-8 pr-3 py-1 rounded text-xs focus:outline-none focus:border-blue-500 border ${
              isDark 
                ? 'bg-[#0B0F17] border-[#1E293B] text-slate-200' 
                : 'bg-white border-slate-300 text-slate-900 shadow-2xs'
            }`}
          />
        </div>
      </div>

      {/* Monitors List */}
      <div className={`rounded-lg border overflow-hidden transition-colors ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className={`font-medium border-b ${
              isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}>
              <tr>
                <th className="py-2.5 px-3.5">Probe Target</th>
                <th className="py-2.5 px-3.5">Type</th>
                <th className="py-2.5 px-3.5">Application</th>
                <th className="py-2.5 px-3.5">24h Heartbeat Strip</th>
                <th className="py-2.5 px-3.5">Interval</th>
                <th className="py-2.5 px-3.5">Consecutive Status</th>
                <th className="py-2.5 px-3.5">Latency</th>
                <th className="py-2.5 px-3.5">Health</th>
                <th className="py-2.5 px-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
              {filteredMonitors.map(m => {
                const app = applications.find(a => a.id === m.applicationId);
                const isCrit = m.status === 'CRITICAL';
                const isProbing = probingId === m.id;

                // Simulated 24-bucket heartbeat timeline
                const heartbeatBars = Array.from({ length: 24 }).map((_, i) => {
                  if (isCrit && i >= 20) return 'FAIL';
                  if (!isCrit && (i === 4 || i === 15)) return 'WARN';
                  return 'PASS';
                });

                return (
                  <tr 
                    key={m.id} 
                    className={`transition-colors ${
                      isCrit 
                        ? (isDark ? 'bg-[#180E13]' : 'bg-rose-50/60') 
                        : (isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50')
                    }`}
                  >
                    <td className="py-2.5 px-3.5 font-sans">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${m.status === 'HEALTHY' ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
                        <span className="font-semibold">{m.name}</span>
                      </div>
                      <div className={`text-[11px] font-mono mt-0.5 truncate max-w-xs ${
                        isDark ? 'text-slate-400' : 'text-slate-500'
                      }`}>
                        {m.target}
                      </div>
                    </td>

                    <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                      {m.type}
                    </td>

                    <td className="py-2.5 px-3.5 font-sans">
                      {app?.name || 'Platform Core'}
                    </td>

                    {/* 24-Hour Heartbeat Bars Graph */}
                    <td className="py-2.5 px-3.5">
                      <div className="flex items-center gap-0.5">
                        {heartbeatBars.map((hb, idx) => (
                          <span
                            key={idx}
                            title={hb === 'PASS' ? 'Check OK: 200 nominal' : hb === 'WARN' ? 'Check Warn: latency > 300ms' : 'Check Fail: 500 error'}
                            className={`w-1 h-3.5 rounded-2xs ${
                              hb === 'PASS' 
                                ? 'bg-emerald-500/80 hover:bg-emerald-400' 
                                : hb === 'WARN' 
                                  ? 'bg-amber-500 hover:bg-amber-400' 
                                  : 'bg-rose-500 hover:bg-rose-400'
                            }`}
                          />
                        ))}
                      </div>
                      <div className={`text-[9px] mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                        {isCrit ? 'Recent checks failing' : '99.98% 24h uptime'}
                      </div>
                    </td>

                    <td className={`py-2.5 px-3.5 tabular-nums ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                      {m.intervalSec}s
                    </td>

                    <td className="py-2.5 px-3.5 tabular-nums">
                      {m.consecutiveFailures > 0 ? (
                        <span className="text-rose-500 font-bold">
                          {m.consecutiveFailures}/{m.failureConfirmationThreshold} Consecutive Fails
                        </span>
                      ) : (
                        <span className="text-emerald-500">
                          {m.consecutiveRecoveries} Consecutive Passes
                        </span>
                      )}
                    </td>

                    <td className="py-2.5 px-3.5 tabular-nums">
                      <span className={m.responseTimeMs > 2000 ? 'text-rose-500 font-bold' : ''}>
                        {m.responseTimeMs}ms
                      </span>
                    </td>

                    <td className="py-2.5 px-3.5">
                      <span className={`font-semibold ${m.status === 'HEALTHY' ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {m.status}
                      </span>
                    </td>

                    <td className="py-2.5 px-3.5 text-right font-sans">
                      <button
                        onClick={() => handleManualCheck(m.id)}
                        disabled={isProbing}
                        className={`px-2 py-0.5 rounded text-[11px] transition-colors inline-flex items-center gap-1 font-mono border cursor-pointer ${
                          isDark 
                            ? 'text-slate-300 hover:text-white hover:bg-[#1D2B44] border-[#23334E]' 
                            : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100 border-slate-300'
                        }`}
                      >
                        <RefreshCw className={`w-3 h-3 ${isProbing ? 'animate-spin text-blue-500' : ''}`} />
                        <span>PROBE</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
