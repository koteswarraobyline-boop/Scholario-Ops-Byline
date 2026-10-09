import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gauge, HardDrive, MemoryStick, Activity, RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import { api } from '../../services/api';
import { ErrorState } from '../ui/ErrorState';
import { EmptyState } from '../ui/EmptyState';
import { BURN, formatEta } from '../../lib/insights';
import type { ReliabilityInsights, InsightForecast, ApplicationSlo } from '../../types';

/** Refresh period; the server recomputes on every request from stored data */
const POLL_MS = 60_000;

const budgetColor = (s: ApplicationSlo['budget']['status']) =>
  s === 'EXHAUSTED' ? 'text-rose-500' : s === 'AT_RISK' ? 'text-amber-500' : s === 'HEALTHY' ? 'text-emerald-500' : 'text-slate-400';
const budgetBar = (s: ApplicationSlo['budget']['status']) =>
  s === 'EXHAUSTED' ? 'bg-rose-500' : s === 'AT_RISK' ? 'bg-amber-500' : 'bg-emerald-500';
const burnColor = (v: number | null, limit: number) => (v === null ? 'text-slate-400' : v >= limit ? 'text-rose-500' : v >= 1 ? 'text-amber-500' : 'text-emerald-500');
const fmtBurn = (v: number | null) => (v === null ? '—' : `${v}×`);

export const ReliabilityView: React.FC = () => {
  const { theme } = useOps();
  const isDark = theme === 'dark';
  const navigate = useNavigate();
  const [data, setData] = useState<ReliabilityInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.getInsights());
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const card = `rounded border min-w-0 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`;
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const label = `text-[10px] uppercase font-mono ${muted}`;
  const sectionTitle = `text-xs font-bold font-mono tracking-wider uppercase ${isDark ? 'text-slate-300' : 'text-slate-700'}`;

  const ForecastRow: React.FC<{ icon: React.ElementType; name: string; f: InsightForecast | null }> = ({ icon: Icon, name, f }) => {
    const Trend = !f ? Minus : f.slopePerDay > 0.05 ? TrendingUp : f.slopePerDay < -0.05 ? TrendingDown : Minus;
    const soon = f?.etaHours !== null && f?.etaHours !== undefined && f.etaHours <= 72;
    return (
      <div className="flex items-center justify-between gap-2 text-xs font-mono py-1.5">
        <span className={`flex items-center gap-1.5 min-w-0 ${muted}`}><Icon className="w-3.5 h-3.5 shrink-0" />{name}</span>
        {!f ? (
          <span className={`text-[11px] ${muted}`} title="Needs at least 6 hours of per-minute metrics from the agent">collecting data…</span>
        ) : (
          <span className="flex items-center gap-2 shrink-0 tabular-nums">
            <span className={isDark ? 'text-slate-200' : 'text-slate-800'}>{f.current}%</span>
            <span className={`flex items-center gap-0.5 ${f.slopePerDay > 0.05 ? 'text-amber-500' : muted}`}>
              <Trend className="w-3 h-3" />{f.slopePerDay > 0 ? '+' : ''}{f.slopePerDay}/d
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${soon ? 'bg-rose-500/15 text-rose-500' : isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}
              title={`${f.threshold}% reached in ${formatEta(f.etaHours)} · fit r²=${f.r2} over ${f.spanHours} h (${f.samples} samples) · ${f.confidence} confidence`}
            >
              {f.etaHours === null ? 'stable' : `${f.threshold}% in ${formatEta(f.etaHours)}`}
            </span>
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className={`flex flex-wrap items-center justify-between gap-3 pb-3 border-b ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
        <div className="min-w-0">
          <h1 className="text-lg font-bold font-mono tracking-tight">RELIABILITY &amp; CAPACITY</h1>
          <p className={`text-xs font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            SLO error budgets, capacity forecasts and flapping checks — computed from recorded checks and agent metrics
            {data ? ` · updated ${new Date(data.generatedAt).toLocaleTimeString()}` : ''}
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-mono cursor-pointer disabled:opacity-50 ${isDark ? 'bg-[#111726] border-[#1E293B] text-slate-300 hover:text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 shadow-xs'}`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>

      {error && !data ? <ErrorState error={error} onRetry={() => void load()} /> : !data ? (
        <div className={`text-xs font-mono animate-pulse ${muted}`}>Loading insights…</div>
      ) : (
        <>
          {/* SLO error budgets */}
          <section className="space-y-2">
            <h2 className={sectionTitle}>SLO error budget · 30 days · PRD monitors</h2>
            {data.applications.length === 0 ? (
              <EmptyState icon={Gauge} title="No applications registered" description="Register an application and its monitors in Setup to track its SLO." action={{ label: 'Open Setup', onClick: () => navigate('/setup') }} />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
                {data.applications.map(a => {
                  const b = a.budget;
                  const used = Math.min(100, b.consumedPercent ?? 0);
                  return (
                    <div key={a.applicationId} className={`${card} p-3.5 space-y-2.5`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div title={a.name} className="font-bold text-sm break-words line-clamp-2">{a.name}</div>
                          <div className={`text-[10px] font-mono ${muted}`}>{a.tier.replace('_', ' ')} · target {b.targetPercent}% · {a.monitorCount} monitor{a.monitorCount === 1 ? '' : 's'}</div>
                        </div>
                        <span className={`text-[10px] font-mono font-bold whitespace-nowrap shrink-0 ${budgetColor(b.status)}`}>{b.status.replace('_', ' ')}</span>
                      </div>

                      {b.status === 'NO_DATA' ? (
                        <p className={`text-[11px] font-mono ${muted}`}>
                          {a.monitorCount === 0 ? 'No enabled PRD monitors — add one to measure this SLO.' : 'No checks recorded yet.'}
                        </p>
                      ) : (
                        <>
                          <div>
                            <div className="flex items-baseline justify-between text-xs font-mono">
                              <span className={muted}>Budget left</span>
                              <span className={`font-bold tabular-nums ${budgetColor(b.status)}`}>{b.remainingPercent}%</span>
                            </div>
                            <div className={`h-1.5 rounded mt-1 overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} title={`${b.failedChecks} of ${b.allowedFailures} allowed failed checks used`}>
                              <div className={`h-full ${budgetBar(b.status)}`} style={{ width: `${100 - used}%` }} />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono">
                            <span className={muted}>Availability</span><span className="text-right tabular-nums">{b.availabilityPercent ?? '—'}%</span>
                            <span className={muted}>Failed / allowed</span><span className="text-right tabular-nums">{b.failedChecks} / {b.allowedFailures}</span>
                          </div>
                          <div className={`grid grid-cols-3 gap-1.5 pt-2 border-t text-center text-[11px] font-mono ${isDark ? 'border-[#1A2332]' : 'border-slate-100'}`}>
                            {([['1h burn', b.burnRate1h, BURN.fast.short], ['6h burn', b.burnRate6h, BURN.fast.long], ['24h burn', b.burnRate24h, BURN.slow.long]] as const).map(([l, v, lim]) => (
                              <div key={l} title={`Error rate ÷ allowed error rate. Alerts at ${lim}×`}>
                                <div className={label}>{l}</div>
                                <div className={`font-bold tabular-nums ${burnColor(v, lim)}`}>{fmtBurn(v)}</div>
                              </div>
                            ))}
                          </div>
                          {b.alert !== 'NONE' && (
                            <p className={`text-[11px] font-mono font-semibold ${b.alert === 'FAST_BURN' ? 'text-rose-500' : 'text-amber-500'}`}>
                              {b.alert === 'FAST_BURN' ? 'Fast burn — budget gone within days at this rate' : 'Slow burn — budget will run out before the window ends'}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Capacity forecasts */}
          <section className="space-y-2">
            <h2 className={sectionTitle}>Capacity forecast · trend of the last {`≤`}48 h</h2>
            {data.servers.length === 0 ? (
              <EmptyState icon={HardDrive} title="No servers registered" description="Register servers and install the agent to forecast disk and memory." action={{ label: 'Open Setup', onClick: () => navigate('/setup') }} />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
                {data.servers.map(s => (
                  <div key={s.serverId} className={`${card} p-3.5`}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div title={s.hostname} className="font-bold text-sm truncate min-w-0">{s.hostname}</div>
                      <span className={`text-[10px] font-mono whitespace-nowrap shrink-0 ${s.agentState === 'ONLINE' ? 'text-emerald-500' : s.agentState === 'NOT_CONNECTED' ? muted : 'text-amber-500'}`}>
                        {s.environment} · {s.agentState.replace('_', ' ')}
                      </span>
                    </div>
                    <div className={`divide-y ${isDark ? 'divide-[#1A2332]' : 'divide-slate-100'}`}>
                      <ForecastRow icon={HardDrive} name="Disk" f={s.disk} />
                      <ForecastRow icon={MemoryStick} name="Memory" f={s.memory} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Flapping monitors */}
          <section className="space-y-2">
            <h2 className={sectionTitle}>Flapping checks · last 20 results</h2>
            {data.flapping.length === 0 ? (
              <div className={`${card} p-3.5 text-xs font-mono flex items-center gap-2 ${muted}`}>
                <Activity className="w-3.5 h-3.5 text-emerald-500 shrink-0" />No monitor is alternating between pass and fail.
              </div>
            ) : (
              <div className={`${card} divide-y ${isDark ? 'divide-[#1A2332]' : 'divide-slate-100'}`}>
                {data.flapping.map(f => (
                  <button
                    key={f.monitorId}
                    onClick={() => navigate('/monitors')}
                    className={`w-full flex items-center justify-between gap-3 px-3.5 py-2 text-left text-xs font-mono cursor-pointer ${isDark ? 'hover:bg-[#151C2C]' : 'hover:bg-slate-50'}`}
                  >
                    <span title={f.name} className="truncate min-w-0">{f.name} <span className={muted}>({f.environment})</span></span>
                    <span className="text-amber-500 font-bold whitespace-nowrap shrink-0">{f.transitions} changes</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
