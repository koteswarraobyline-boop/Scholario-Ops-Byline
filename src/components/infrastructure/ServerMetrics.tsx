/**
 * Server metric history (agent samples): 1h = live 5-second samples, 6h–48h = 1-minute rollups.
 * Missing values (older agent, no swap, platform without the counter) are gaps in the line —
 * never drawn as 0. "No historical data available" when a series has no samples at all.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ServerMetricPoint } from '../../types';
import { api } from '../../services/api';
import { fmtNum, fmtBytesRate, fmtKbps } from './telemetryUi';

export type MetricRange = '1h' | '6h' | '24h' | '48h';
type Key = Exclude<keyof ServerMetricPoint, 't'>;
interface Series { key: Key; label: string; color: string }

const valueOf = (p: ServerMetricPoint, k: Key): number | null => {
  const v = p[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

export const MetricChart: React.FC<{
  title: string;
  points: ServerMetricPoint[];
  series: Series[];
  format: (v: number | null) => string;
  fixedMax?: number;
  isDark: boolean;
}> = ({ title, points, series, format, fixedMax, isDark }) => {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = 140, PAD_L = 44, PAD_B = 18, PAD_T = 8, PAD_R = 8;
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';

  const stats = useMemo(() => series.map(s => {
    const vals = points.map(p => valueOf(p, s.key)).filter((v): v is number => v !== null);
    const last = [...points].reverse().map(p => valueOf(p, s.key)).find(v => v !== null) ?? null;
    return { ...s, has: vals.length > 0, min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null, last };
  }), [points, series]);

  if (!stats.some(s => s.has)) {
    return (
      <div className={`p-3 rounded border ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
        <span className={`text-[10px] uppercase font-semibold ${muted}`}>{title}</span>
        <div className={`h-32 flex items-center justify-center text-[11px] font-sans ${muted}`}>No historical data available</div>
      </div>
    );
  }

  const dataMax = Math.max(0, ...stats.map(s => s.max ?? 0));
  const max = fixedMax ?? (dataMax > 0 ? dataMax * 1.15 : 1);
  const times = points.map(p => Date.parse(p.t));
  const tMin = Math.min(...times), tMax = Math.max(...times);
  const x = (t: number) => PAD_L + ((t - tMin) / Math.max(1, tMax - tMin)) * (W - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + (1 - Math.min(1, Math.max(0, v / max))) * (H - PAD_T - PAD_B);
  const hp = hover !== null ? points[hover] : null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = tMin + ((((e.clientX - rect.left) / rect.width) * W - PAD_L) / (W - PAD_L - PAD_R)) * (tMax - tMin);
    let best = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
    setHover(best);
  };

  return (
    <div className={`p-3 rounded border ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
      <div className="flex items-start justify-between mb-1 gap-2 flex-wrap">
        <span className={`text-[10px] uppercase font-semibold ${muted}`}>{title}</span>
        <div className="flex flex-col items-end gap-0.5 text-[10px]">
          {stats.filter(s => s.has).map(s => (
            <span key={s.key} className="flex items-center gap-1">
              <span className="w-2 h-0.5 inline-block" style={{ background: s.color }} />
              <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>{s.label}</span>
              <strong className={isDark ? 'text-slate-200' : 'text-slate-800'}>{format(hp ? valueOf(hp, s.key) : s.last)}</strong>
              <span className={muted}>min {format(s.min)} · max {format(s.max)}</span>
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={`${title} history`}>
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(max * f)} y2={y(max * f)} stroke={isDark ? '#1E293B' : '#E2E8F0'} strokeWidth={1} />
            <text x={PAD_L - 4} y={y(max * f) + 3} textAnchor="end" fontSize={9} fill={isDark ? '#64748B' : '#94A3B8'}>{format(max * f)}</text>
          </g>
        ))}
        {stats.filter(s => s.has).map(s => {
          // Break the line at missing samples instead of drawing them as 0
          let d = '', pen = false;
          points.forEach((p, i) => {
            const v = valueOf(p, s.key);
            if (v === null) { pen = false; return; }
            d += `${pen ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(v).toFixed(1)} `;
            pen = true;
          });
          return <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
        })}
        {hp && <line x1={x(times[hover!])} x2={x(times[hover!])} y1={PAD_T} y2={H - PAD_B} stroke={isDark ? '#475569' : '#94A3B8'} strokeDasharray="3 3" />}
        <text x={PAD_L} y={H - 4} fontSize={9} fill={isDark ? '#64748B' : '#94A3B8'}>{new Date(tMin).toLocaleTimeString()}</text>
        <text x={W - PAD_R} y={H - 4} fontSize={9} textAnchor="end" fill={isDark ? '#64748B' : '#94A3B8'}>{hp ? new Date(times[hover!]).toLocaleString() : new Date(tMax).toLocaleTimeString()}</text>
      </svg>
    </div>
  );
};

const pct = (v: number | null) => (v === null ? '—' : `${fmtNum(v, v >= 10 ? 0 : 1)}%`);
const load = (v: number | null) => fmtNum(v, 2);

export type ChartKey = 'cpu' | 'memory' | 'disk' | 'load' | 'network' | 'diskio' | 'diskutil';

const CHARTS: Record<ChartKey, { title: string; series: Series[]; format: (v: number | null) => string; fixedMax?: number }> = {
  cpu: { title: 'CPU (%)', fixedMax: 100, format: pct, series: [{ key: 'cpu', label: 'Busy', color: '#F43F5E' }, { key: 'iowait', label: 'I/O wait', color: '#F59E0B' }, { key: 'steal', label: 'Steal', color: '#A855F7' }] },
  memory: { title: 'Memory & swap (%)', fixedMax: 100, format: pct, series: [{ key: 'ram', label: 'RAM', color: '#F59E0B' }, { key: 'swap', label: 'Swap', color: '#EC4899' }] },
  disk: { title: 'Root disk used (%)', fixedMax: 100, format: pct, series: [{ key: 'disk', label: 'Disk', color: '#3B82F6' }] },
  load: { title: 'Load average (1m)', format: load, series: [{ key: 'load1', label: 'Load 1m', color: '#10B981' }] },
  network: { title: 'Network (all interfaces)', format: v => fmtKbps(v), series: [{ key: 'netIn', label: 'In', color: '#6366F1' }, { key: 'netOut', label: 'Out', color: '#14B8A6' }] },
  diskio: { title: 'Disk I/O throughput', format: v => fmtBytesRate(v), series: [{ key: 'diskRead', label: 'Read', color: '#0EA5E9' }, { key: 'diskWrite', label: 'Write', color: '#F97316' }] },
  diskutil: { title: 'Disk utilisation (%)', fixedMax: 100, format: pct, series: [{ key: 'diskUtil', label: 'Busiest disk', color: '#EF4444' }] },
};

const ALL: ChartKey[] = ['cpu', 'memory', 'disk', 'load', 'network', 'diskio', 'diskutil'];

export const ServerMetricsPanel: React.FC<{ serverId: string; isDark: boolean; charts?: ChartKey[]; title?: string }> = ({ serverId, isDark, charts = ALL, title = 'Metrics history' }) => {
  const [range, setRange] = useState<MetricRange>('1h');
  const [points, setPoints] = useState<ServerMetricPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Only the response for the current server + range may update the chart (a slow 48h request must
  // not overwrite a newer 1h one)
  const current = useRef(`${serverId}|${range}`);
  current.current = `${serverId}|${range}`;
  const load = useCallback(async () => {
    const key = `${serverId}|${range}`;
    try {
      const data = await api.getServerMetrics(serverId, range);
      if (current.current !== key) return;
      setPoints(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      if (current.current === key) setError(err instanceof Error ? err.message : 'Failed to load metrics');
    } finally {
      if (current.current === key) setLoading(false);
    }
  }, [serverId, range]);

  // History is not part of the realtime stream: refresh it at the rate new points can appear
  useEffect(() => {
    setLoading(true);
    setPoints([]);
    void load();
    const timer = setInterval(() => { void load(); }, range === '1h' ? 30_000 : 60_000);
    return () => clearInterval(timer);
  }, [load, range]);

  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{title}</div>
        <div className="flex items-center gap-2">
          {loading && <RefreshCw className={`w-3 h-3 animate-spin ${muted}`} aria-label="Loading" />}
          <div className={`flex items-center gap-1 p-0.5 rounded border ${isDark ? 'bg-[#0B0F17] border-[#1E293B]' : 'bg-slate-100 border-slate-300'}`} role="group" aria-label="Time range">
            {(['1h', '6h', '24h', '48h'] as const).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                aria-pressed={range === r}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                  range === r ? 'bg-blue-600 text-white font-medium' : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error ? (
        <div className="text-[11px] text-rose-500">Could not load metrics: {error}</div>
      ) : loading && points.length === 0 ? (
        <div className={`p-4 rounded border text-center text-[11px] font-sans animate-pulse ${isDark ? 'border-[#1E293B] text-slate-500' : 'border-slate-200 text-slate-500'}`}>Loading metric history…</div>
      ) : points.length === 0 ? (
        <div className={`p-4 rounded border text-center text-[11px] font-sans ${isDark ? 'border-[#1E293B] text-slate-500' : 'border-slate-200 text-slate-500'}`}>
          No historical data available for the last {range}. Samples appear once the agent is reporting.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {charts.map(k => <MetricChart key={k} {...CHARTS[k]} points={points} isDark={isDark} />)}
        </div>
      )}
    </div>
  );
};
