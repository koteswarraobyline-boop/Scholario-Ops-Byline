import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import { VpsServer, ServerMetricPoint } from '../../types';
import { api } from '../../services/api';
import { Search, X, Server, RefreshCw } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';

// ── Helpers ─────────────────────────────────────────────────────────────────
const validDate = (s?: string | null) => Boolean(s) && !Number.isNaN(Date.parse(s as string));
const fmtDateTime = (s?: string | null, fallback = '—') => (validDate(s) ? new Date(s as string).toLocaleString() : fallback);
const fmtTime = (s?: string | null, fallback = '—') => (validDate(s) ? new Date(s as string).toLocaleTimeString() : fallback);
const fmtNum = (v: number | null | undefined, digits = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits));
const fmtAgo = (s?: string | null) => {
  if (!validDate(s)) return 'never';
  const sec = Math.max(0, Math.round((Date.now() - Date.parse(s as string)) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
};
/** True once the agent has reported at least once (telemetry values are meaningful). */
const hasReported = (s: VpsServer) => Boolean(s.lastSeen);

const agentColor = (a: VpsServer['agentStatus']) =>
  a === 'CONNECTED' ? 'text-emerald-500' : a === 'STALE' ? 'text-amber-500' : 'text-rose-500';

const statusDot = (s: string) =>
  s === 'HEALTHY' ? 'bg-emerald-500'
    : s === 'WARNING' || s === 'STALE' ? 'bg-amber-500'
      : s === 'CRITICAL' ? 'bg-rose-500 animate-pulse'
        : 'bg-slate-500';

type MetricRange = '1h' | '6h' | '24h' | '48h';

// ── Inline SVG line chart (no external dependencies) ────────────────────────
interface Series { key: keyof ServerMetricPoint; label: string; color: string }

const MetricChart: React.FC<{
  title: string;
  unit: string;
  points: ServerMetricPoint[];
  series: Series[];
  fixedMax?: number;
  isDark: boolean;
}> = ({ title, unit, points, series, fixedMax, isDark }) => {
  const W = 600, H = 140, PAD_L = 34, PAD_B = 18, PAD_T = 8, PAD_R = 8;
  const values = points.flatMap(p => series.map(s => Number(p[s.key]) || 0));
  const dataMax = values.length ? Math.max(...values) : 0;
  const max = fixedMax ?? (dataMax > 0 ? dataMax * 1.15 : 1);
  const times = points.map(p => Date.parse(p.t)).filter(t => Number.isFinite(t));
  const tMin = times.length ? Math.min(...times) : 0;
  const tMax = times.length ? Math.max(...times) : 1;
  const x = (t: number) => PAD_L + ((t - tMin) / Math.max(1, tMax - tMin)) * (W - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + (1 - Math.min(1, Math.max(0, v / max))) * (H - PAD_T - PAD_B);
  const latest = points[points.length - 1];

  return (
    <div className={`p-3 rounded border ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
      <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
        <span className={`text-[10px] uppercase font-semibold ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{title}</span>
        <div className="flex items-center gap-3 text-[10px]">
          {series.map(s => (
            <span key={s.key} className="flex items-center gap-1">
              <span className="w-2 h-0.5 inline-block" style={{ background: s.color }} />
              <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>{s.label}</span>
              {latest && <strong className={isDark ? 'text-slate-200' : 'text-slate-800'}>{fmtNum(Number(latest[s.key]), unit === '%' ? 1 : 2)}{unit}</strong>}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none">
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(max * f)} y2={y(max * f)} stroke={isDark ? '#1E293B' : '#E2E8F0'} strokeWidth={1} />
            <text x={PAD_L - 4} y={y(max * f) + 3} textAnchor="end" fontSize={9} fill={isDark ? '#64748B' : '#94A3B8'}>
              {fmtNum(max * f, max * f >= 10 || f === 0 ? 0 : 1)}
            </text>
          </g>
        ))}
        {series.map(s => {
          const d = points
            .map(p => ({ t: Date.parse(p.t), v: Number(p[s.key]) || 0 }))
            .filter(p => Number.isFinite(p.t))
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
            .join(' ');
          return <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
        })}
        {times.length > 0 && (
          <>
            <text x={PAD_L} y={H - 4} fontSize={9} fill={isDark ? '#64748B' : '#94A3B8'}>{new Date(tMin).toLocaleTimeString()}</text>
            <text x={W - PAD_R} y={H - 4} fontSize={9} textAnchor="end" fill={isDark ? '#64748B' : '#94A3B8'}>{new Date(tMax).toLocaleTimeString()}</text>
          </>
        )}
      </svg>
    </div>
  );
};

const ServerMetricsPanel: React.FC<{ serverId: string; isDark: boolean }> = ({ serverId, isDark }) => {
  const [range, setRange] = useState<MetricRange>('1h');
  const [points, setPoints] = useState<ServerMetricPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getServerMetrics(serverId, range);
      setPoints(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }, [serverId, range]);

  useEffect(() => {
    setLoading(true);
    void load();
    const timer = setInterval(() => { void load(); }, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const muted = isDark ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Metrics history</div>
        <div className="flex items-center gap-2">
          {loading && <RefreshCw className={`w-3 h-3 animate-spin ${muted}`} />}
          <div className={`flex items-center gap-1 p-0.5 rounded border ${isDark ? 'bg-[#0B0F17] border-[#1E293B]' : 'bg-slate-100 border-slate-300'}`}>
            {(['1h', '6h', '24h', '48h'] as const).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
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
      ) : !loading && points.length === 0 ? (
        <div className={`p-4 rounded border text-center text-[11px] font-sans ${isDark ? 'border-[#1E293B] text-slate-500' : 'border-slate-200 text-slate-500'}`}>
          No metric samples in the last {range}. Samples appear once the agent is reporting.
        </div>
      ) : points.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <MetricChart
            title="CPU / RAM / Disk"
            unit="%"
            fixedMax={100}
            points={points}
            isDark={isDark}
            series={[
              { key: 'cpu', label: 'CPU', color: '#F43F5E' },
              { key: 'ram', label: 'RAM', color: '#F59E0B' },
              { key: 'disk', label: 'Disk', color: '#3B82F6' },
            ]}
          />
          <MetricChart
            title="Load average (1m)"
            unit=""
            points={points}
            isDark={isDark}
            series={[{ key: 'load1', label: 'Load 1m', color: '#10B981' }]}
          />
          <MetricChart
            title="Network (kbps)"
            unit=""
            points={points}
            isDark={isDark}
            series={[
              { key: 'netIn', label: 'In', color: '#6366F1' },
              { key: 'netOut', label: 'Out', color: '#14B8A6' },
            ]}
          />
        </div>
      ) : null}
    </div>
  );
};

interface VpsDetailModalProps {
  server: VpsServer;
  onClose: () => void;
  isDark: boolean;
}

export const VpsDetailModal: React.FC<VpsDetailModalProps> = ({ server, onClose, isDark }) => {
  const { applications } = useOps();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'system' | 'processes' | 'services' | 'logs'>('system');
  const app = applications.find(a => a.id === server.applicationId);
  const reported = hasReported(server);
  const t = server.telemetry;
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const card = `p-3 rounded border ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`;

  const goSetup = () => { onClose(); navigate('/setup'); };

  const notReported = (what: string) => (
    <div className={`p-6 rounded border text-center space-y-2 font-sans ${isDark ? 'border-[#1E293B] text-slate-400' : 'border-slate-200 text-slate-600'}`}>
      <div>
        {reported
          ? `The agent has not reported any ${what} for this server.`
          : `No ${what} yet — the telemetry agent has never reported from this server.`}
      </div>
      {!reported && (
        <button onClick={goSetup} className="px-3 py-1 rounded text-xs font-mono font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer">
          Install the agent from Setup
        </button>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in">
      <div
        className={`w-full max-w-5xl rounded-lg border overflow-hidden flex flex-col max-h-[90vh] shadow-2xl transition-colors ${
          isDark ? 'bg-[#101624] text-slate-100 border-[#223048]' : 'bg-white text-slate-900 border-slate-200'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-4 px-6 border-b flex items-center justify-between ${
          isDark ? 'border-[#1E293B] bg-[#0A0F1A]' : 'border-slate-200 bg-slate-50'
        }`}>
          <div className="flex items-center gap-3 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDot(server.status)}`} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-mono flex-wrap">
                <h2 className="text-base font-bold">{server.hostname}</h2>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                  server.environment === 'PRD'
                    ? (isDark ? 'bg-blue-950 text-blue-400 border border-blue-900' : 'bg-blue-50 text-blue-700 border border-blue-200')
                    : (isDark ? 'bg-amber-950 text-amber-400 border border-amber-900' : 'bg-amber-50 text-amber-700 border border-amber-200')
                }`}>{server.environment}</span>
                <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
                <span className={`text-xs ${muted}`}>{server.ip || 'No IP'}</span>
                <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
                <span className={`text-xs font-semibold ${agentColor(server.agentStatus)}`}>Agent {server.agentStatus}</span>
              </div>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                {[server.provider, server.region, server.plan].filter(Boolean).join(' · ') || 'Provider details not set'}
                {' · '}Application: <strong>{app?.name ?? 'Unassigned'}</strong>
              </p>
            </div>
          </div>
          <button onClick={onClose} className={`p-1 transition-colors cursor-pointer ${isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className={`flex items-center gap-1 px-4 sm:px-6 border-b text-xs font-mono overflow-x-auto min-w-0 ${
          isDark ? 'border-[#1E293B] bg-[#0C121E]' : 'border-slate-200 bg-slate-100'
        }`}>
          {[
            { id: 'system', label: 'System & Telemetry' },
            { id: 'processes', label: `Processes (${server.processes.length})` },
            { id: 'services', label: `Services (${server.services.length})` },
            { id: 'logs', label: `Logs (${server.logs.length})` },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`py-2 px-3 font-medium whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-500 font-semibold'
                  : isDark ? 'border-transparent text-slate-400 hover:text-slate-200' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs font-mono">

          {/* TAB: SYSTEM */}
          {activeTab === 'system' && (
            <div className="space-y-4">
              {/* Agent status */}
              <div className={`${card} grid grid-cols-2 sm:grid-cols-4 gap-3`}>
                <div>
                  <span className={muted}>Agent:</span>
                  <p className={`font-semibold ${agentColor(server.agentStatus)}`}>{server.agentStatus}</p>
                </div>
                <div>
                  <span className={muted}>Last report:</span>
                  <p className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`} title={fmtDateTime(server.lastSeen)}>
                    {reported ? fmtAgo(server.lastSeen) : 'Never'}
                  </p>
                </div>
                <div>
                  <span className={muted}>Agent version:</span>
                  <p className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{server.agentVersion || '—'}</p>
                </div>
                <div>
                  <span className={muted}>Server status:</span>
                  <p className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{server.status}</p>
                </div>
              </div>

              {!reported ? (
                notReported('telemetry')
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className={card}>
                      <div className={`text-[10px] uppercase ${muted}`}>CPU</div>
                      <div className={`text-base font-bold tabular-nums ${t.cpuPercent > 80 ? 'text-rose-500' : (isDark ? 'text-slate-100' : 'text-slate-900')}`}>
                        {fmtNum(t.cpuPercent)}%
                      </div>
                      <div className={`text-[10px] mt-0.5 ${muted}`}>{server.cpuCores ? `${server.cpuCores} vCPU` : '—'}</div>
                    </div>
                    <div className={card}>
                      <div className={`text-[10px] uppercase ${muted}`}>Memory</div>
                      <div className={`text-base font-bold tabular-nums ${t.ramPercent > 80 ? 'text-rose-500' : (isDark ? 'text-slate-100' : 'text-slate-900')}`}>
                        {fmtNum(t.ramPercent)}%
                      </div>
                      <div className={`text-[10px] mt-0.5 ${muted}`}>{server.ramGb ? `${server.ramGb} GB` : '—'}</div>
                    </div>
                    <div className={card}>
                      <div className={`text-[10px] uppercase ${muted}`}>Disk</div>
                      <div className={`text-base font-bold tabular-nums ${t.diskPercent > 85 ? 'text-rose-500' : (isDark ? 'text-slate-100' : 'text-slate-900')}`}>
                        {fmtNum(t.diskPercent)}%
                      </div>
                      <div className={`text-[10px] mt-0.5 ${muted}`}>{server.diskGb ? `${server.diskGb} GB` : '—'}</div>
                    </div>
                    <div className={card}>
                      <div className={`text-[10px] uppercase ${muted}`}>Load Average</div>
                      <div className={`text-base font-bold tabular-nums ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                        {fmtNum(t.loadAvg?.[0], 2)}
                      </div>
                      <div className={`text-[10px] mt-0.5 ${muted}`}>
                        5m: {fmtNum(t.loadAvg?.[1], 2)} · 15m: {fmtNum(t.loadAvg?.[2], 2)}
                      </div>
                    </div>
                  </div>

                  <div className={`${card} grid grid-cols-2 sm:grid-cols-4 gap-3`}>
                    <div>
                      <span className={muted}>OS:</span>
                      <p className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{server.os || '—'}</p>
                    </div>
                    <div>
                      <span className={muted}>Network In / Out:</span>
                      <p className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                        {fmtNum(t.networkInKbps / 1024)} / {fmtNum(t.networkOutKbps / 1024)} Mbps
                      </p>
                    </div>
                    <div>
                      <span className={muted}>Uptime:</span>
                      <p className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{server.uptimeDays} days</p>
                    </div>
                    <div>
                      <span className={muted}>Sample observed:</span>
                      <p className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{fmtTime(t.observedAt)}</p>
                    </div>
                  </div>
                </>
              )}

              <ServerMetricsPanel serverId={server.id} isDark={isDark} />
            </div>
          )}

          {/* TAB: PROCESSES */}
          {activeTab === 'processes' && (
            server.processes.length === 0 ? notReported('processes') : (
              <div className="space-y-3">
                <div className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Top processes (reported by the agent)</div>
                <div className={`border rounded overflow-x-auto ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
                  <table className="w-full text-left text-xs">
                    <thead className={`border-b ${isDark ? 'bg-[#0A0F1A] text-slate-400 border-[#1E293B]' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                      <tr>
                        <th className="py-2 px-3">PID</th>
                        <th className="py-2 px-3">Command</th>
                        <th className="py-2 px-3">User</th>
                        <th className="py-2 px-3 text-right">CPU %</th>
                        <th className="py-2 px-3 text-right">Memory</th>
                        <th className="py-2 px-3">State</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-200'}`}>
                      {server.processes.map(p => (
                        <tr key={`${p.pid}-${p.name}`} className={isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}>
                          <td className="py-2 px-3">{p.pid}</td>
                          <td className={`py-2 px-3 font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{p.name}</td>
                          <td className={`py-2 px-3 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{p.user}</td>
                          <td className={`py-2 px-3 text-right tabular-nums ${p.cpuPercent > 50 ? 'text-rose-500 font-bold' : (isDark ? 'text-slate-200' : 'text-slate-800')}`}>
                            {fmtNum(p.cpuPercent)}%
                          </td>
                          <td className={`py-2 px-3 text-right tabular-nums ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{fmtNum(p.memMb, 0)} MB</td>
                          <td className="py-2 px-3">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${p.status === 'running' ? 'bg-emerald-500/20 text-emerald-500 font-bold' : 'text-slate-500'}`}>
                              {p.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}

          {/* TAB: SERVICES */}
          {activeTab === 'services' && (
            server.services.length === 0 ? notReported('services') : (
              <div className="space-y-3">
                <div className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Systemd services (reported by the agent)</div>
                <div className={`border rounded overflow-x-auto ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
                  <table className="w-full text-left text-xs">
                    <thead className={`border-b ${isDark ? 'bg-[#0A0F1A] text-slate-400 border-[#1E293B]' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                      <tr>
                        <th className="py-2 px-3">Service</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 px-3">Version</th>
                        <th className="py-2 px-3">PID</th>
                        <th className="py-2 px-3 text-right">Memory</th>
                        <th className="py-2 px-3 text-right">Last Restart</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-200'}`}>
                      {server.services.map(svc => (
                        <tr key={svc.name} className={isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}>
                          <td className={`py-2 px-3 font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{svc.name}</td>
                          <td className="py-2 px-3">
                            <span className={`font-semibold ${svc.status === 'active' ? 'text-emerald-500' : svc.status === 'restarting' ? 'text-amber-500' : 'text-rose-500'}`}>
                              {svc.status}
                            </span>
                          </td>
                          <td className={`py-2 px-3 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{svc.version || '—'}</td>
                          <td className={`py-2 px-3 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{svc.pid || '—'}</td>
                          <td className={`py-2 px-3 text-right tabular-nums ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{svc.memoryMb ? `${fmtNum(svc.memoryMb, 0)} MB` : '—'}</td>
                          <td className={`py-2 px-3 text-right ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{validDate(svc.lastRestart) ? fmtDateTime(svc.lastRestart) : (svc.lastRestart || '—')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}

          {/* TAB: LOGS */}
          {activeTab === 'logs' && (
            server.logs.length === 0 ? notReported('log entries') : (
              <div className="space-y-3">
                <div className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Recent log entries (reported by the agent)</div>
                <div className={`p-3 rounded border space-y-1.5 text-[11px] max-h-80 overflow-y-auto ${
                  isDark ? 'bg-[#070A10] text-slate-300 border-[#1E293B]' : 'bg-slate-900 text-slate-100 border-slate-800'
                }`}>
                  {server.logs.map(log => (
                    <div key={log.id} className="flex items-start gap-2">
                      <span className="text-slate-500 shrink-0">{fmtTime(log.timestamp)}</span>
                      <span className={`px-1 rounded text-[9px] uppercase font-bold shrink-0 ${
                        log.level === 'error' ? 'bg-rose-950 text-rose-300 border border-rose-900'
                          : log.level === 'warn' ? 'bg-amber-950 text-amber-300 border border-amber-900'
                            : 'bg-blue-950 text-blue-300 border border-blue-900'
                      }`}>
                        {log.level}
                      </span>
                      <span className="text-slate-400 shrink-0">[{log.service}]</span>
                      <span className={log.level === 'error' ? 'text-rose-300 font-semibold break-all' : 'text-slate-300 break-all'}>{log.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}

        </div>

        {/* Footer */}
        <div className={`p-3 px-6 border-t flex justify-end ${
          isDark ? 'border-[#1E293B] bg-[#0A0F1A]' : 'border-slate-200 bg-slate-50'
        }`}>
          <button
            onClick={onClose}
            className={`px-3 py-1 rounded text-xs font-mono transition-colors cursor-pointer ${
              isDark ? 'bg-[#1A2436] hover:bg-[#23324C] text-slate-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-800'
            }`}
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
};

export const InfrastructureView: React.FC = () => {
  const { servers, applications, selectedServerId, setSelectedServerId, theme, isLoading } = useOps();
  const navigate = useNavigate();
  const isDark = theme === 'dark';

  const [filter, setFilter] = useState<'ALL' | 'PRD' | 'DR' | 'HEALTHY' | 'CRITICAL'>('ALL');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'hostname' | 'cpu' | 'ram' | 'disk'>('hostname');

  const selectedServer = servers.find(s => s.id === selectedServerId);

  // Fleet summary computed from the latest agent reports only
  const reporting = servers.filter(hasReported);
  const avg = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
  const fleetCpu = avg(reporting.map(s => s.telemetry.cpuPercent));
  const fleetRam = avg(reporting.map(s => s.telemetry.ramPercent));
  const fleetDiskMax = reporting.length ? Math.max(...reporting.map(s => s.telemetry.diskPercent)) : null;
  const connected = servers.filter(s => s.agentStatus === 'CONNECTED').length;
  const stale = servers.filter(s => s.agentStatus === 'STALE').length;
  const disconnected = servers.length - connected - stale;

  const metricValue = (s: VpsServer, v: number) => (hasReported(s) ? v : -1);

  const filteredServers = servers
    .filter(s => {
      if (filter === 'PRD') return s.environment === 'PRD';
      if (filter === 'DR') return s.environment === 'DR';
      if (filter === 'HEALTHY') return s.status === 'HEALTHY';
      if (filter === 'CRITICAL') return s.status !== 'HEALTHY';
      return true;
    })
    .filter(s => {
      const q = search.toLowerCase();
      return (
        s.hostname.toLowerCase().includes(q) ||
        (s.ip || '').includes(q) ||
        (s.region || '').toLowerCase().includes(q) ||
        (s.plan || '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === 'cpu') return metricValue(b, b.telemetry.cpuPercent) - metricValue(a, a.telemetry.cpuPercent);
      if (sortBy === 'ram') return metricValue(b, b.telemetry.ramPercent) - metricValue(a, a.telemetry.ramPercent);
      if (sortBy === 'disk') return metricValue(b, b.telemetry.diskPercent) - metricValue(a, a.telemetry.diskPercent);
      return a.hostname.localeCompare(b.hostname);
    });

  const statCard = `p-3 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`;
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';

  const bar = (s: VpsServer, v: number, warn: number, color: string) => (
    hasReported(s) ? (
      <div className="flex items-center gap-2">
        <div className={`w-14 h-1.5 rounded overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
          <div className={`h-full ${v > warn ? 'bg-rose-500' : color}`} style={{ width: `${Math.min(100, Math.max(0, v))}%` }} />
        </div>
        <span className={v > warn ? 'text-rose-500 font-bold' : (isDark ? 'text-slate-200' : 'text-slate-800')}>{fmtNum(v)}%</span>
      </div>
    ) : <span className={muted}>—</span>
  );

  return (
    <div className="space-y-6">
      {selectedServer && (
        <VpsDetailModal
          server={selectedServer}
          onClose={() => setSelectedServerId(null)}
          isDark={isDark}
        />
      )}

      {/* Header */}
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            VPS INFRASTRUCTURE
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {servers.length} registered server{servers.length === 1 ? '' : 's'} · telemetry reported by the Scholario agent
          </p>
        </div>

        {/* Search, Filter & Sort */}
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search hostname, IP, region..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={`pl-8 pr-3 py-1 rounded text-xs focus:outline-none focus:border-blue-500 w-48 border ${
                isDark ? 'bg-[#0B0F17] border-[#1E293B] text-slate-200' : 'bg-white border-slate-300 text-slate-800'
              }`}
            />
          </div>

          <div className={`flex items-center gap-1 p-0.5 rounded border ${
            isDark ? 'bg-[#0B0F17] border-[#1E293B]' : 'bg-slate-100 border-slate-300'
          }`}>
            {(['ALL', 'PRD', 'DR', 'HEALTHY', 'CRITICAL'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                  filter === f
                    ? 'bg-blue-600 text-white font-medium shadow-xs'
                    : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className={`px-2 py-1 rounded text-xs focus:outline-none border cursor-pointer ${
              isDark ? 'bg-[#0B0F17] border-[#1E293B] text-slate-300' : 'bg-white border-slate-300 text-slate-700'
            }`}
          >
            <option value="hostname">Sort: Hostname</option>
            <option value="cpu">Sort: CPU %</option>
            <option value="ram">Sort: RAM %</option>
            <option value="disk">Sort: Disk %</option>
          </select>
        </div>
      </div>

      {servers.length === 0 ? (
        isLoading ? (
          <div className={`text-xs font-mono animate-pulse ${muted}`}>Loading servers…</div>
        ) : (
          <EmptyState
            icon={Server}
            title="No servers registered"
            description="Register your PRD and DR VPS servers in Setup, then install the telemetry agent on each one."
            action={{ label: 'Open Setup', onClick: () => navigate('/setup') }}
          />
        )
      ) : (
        <>
          {/* Fleet summary (current agent reports) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
            <div className={statCard}>
              <div className={`text-[10px] uppercase ${muted}`}>Agents</div>
              <div className="text-base font-bold tabular-nums">{connected}/{servers.length} connected</div>
              <div className={`text-[10px] mt-0.5 ${muted}`}>
                {stale > 0 && <span className="text-amber-500">{stale} stale · </span>}
                {disconnected > 0 ? <span className="text-rose-500">{disconnected} disconnected</span> : 'none disconnected'}
              </div>
            </div>
            <div className={statCard}>
              <div className={`text-[10px] uppercase ${muted}`}>Avg CPU</div>
              <div className="text-base font-bold tabular-nums">{fleetCpu === null ? '—' : `${fleetCpu.toFixed(1)}%`}</div>
              <div className={`text-[10px] mt-0.5 ${muted}`}>across {reporting.length} reporting server{reporting.length === 1 ? '' : 's'}</div>
            </div>
            <div className={statCard}>
              <div className={`text-[10px] uppercase ${muted}`}>Avg RAM</div>
              <div className="text-base font-bold tabular-nums">{fleetRam === null ? '—' : `${fleetRam.toFixed(1)}%`}</div>
              <div className={`text-[10px] mt-0.5 ${muted}`}>latest agent samples</div>
            </div>
            <div className={statCard}>
              <div className={`text-[10px] uppercase ${muted}`}>Fullest Disk</div>
              <div className={`text-base font-bold tabular-nums ${fleetDiskMax !== null && fleetDiskMax > 85 ? 'text-rose-500' : ''}`}>
                {fleetDiskMax === null ? '—' : `${fleetDiskMax.toFixed(1)}%`}
              </div>
              <div className={`text-[10px] mt-0.5 ${muted}`}>highest disk usage in the fleet</div>
            </div>
          </div>

          {/* Servers Table */}
          <div className={`rounded-lg border overflow-hidden transition-colors ${
            isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
          }`}>
            {filteredServers.length === 0 ? (
              <div className={`p-8 text-center text-xs font-mono ${muted}`}>No servers match the current filter.</div>
            ) : (
              <div className="w-full min-w-0 overflow-x-auto">
                <table className="w-full text-left text-xs font-mono min-w-[860px]">
                  <thead className={`font-medium border-b ${
                    isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}>
                    <tr>
                      <th className="py-2.5 px-3.5">Hostname</th>
                      <th className="py-2.5 px-3.5">Env</th>
                      <th className="py-2.5 px-3.5">Application</th>
                      <th className="py-2.5 px-3.5">Agent</th>
                      <th className="py-2.5 px-3.5">CPU</th>
                      <th className="py-2.5 px-3.5">RAM</th>
                      <th className="py-2.5 px-3.5">Disk</th>
                      <th className="py-2.5 px-3.5">Load (1m)</th>
                      <th className="py-2.5 px-3.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
                    {filteredServers.map(s => {
                      const app = applications.find(a => a.id === s.applicationId);
                      const isCrit = s.status === 'CRITICAL';

                      return (
                        <tr
                          key={s.id}
                          onClick={() => setSelectedServerId(s.id)}
                          className={`cursor-pointer transition-colors ${
                            isCrit ? (isDark ? 'bg-[#180E13]' : 'bg-rose-50/70') : (isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50')
                          }`}
                        >
                          <td className="py-2.5 px-3.5">
                            <div className="flex items-center gap-2">
                              <span className={`w-1.5 h-1.5 rounded-full ${statusDot(s.status)}`} />
                              <span className={`font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{s.hostname.split('.')[0]}</span>
                            </div>
                            <div className={`text-[10px] ${muted}`}>{s.ip || 'No IP'}{s.region ? ` · ${s.region}` : ''}</div>
                          </td>
                          <td className="py-2.5 px-3.5">
                            <span className={s.environment === 'PRD' ? 'text-blue-500 font-semibold' : muted}>{s.environment}</span>
                          </td>
                          <td className={`py-2.5 px-3.5 font-sans ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                            {app?.name ?? <span className={muted}>Unassigned</span>}
                          </td>
                          <td className="py-2.5 px-3.5">
                            <div className={`font-semibold ${agentColor(s.agentStatus)}`}>{s.agentStatus}</div>
                            <div className={`text-[10px] ${muted}`}>
                              {hasReported(s) ? fmtAgo(s.lastSeen) : 'never reported'}{s.agentVersion ? ` · v${s.agentVersion.replace(/^v/, '')}` : ''}
                            </div>
                          </td>
                          <td className="py-2.5 px-3.5 tabular-nums">{bar(s, s.telemetry.cpuPercent, 80, 'bg-blue-500')}</td>
                          <td className="py-2.5 px-3.5 tabular-nums">{bar(s, s.telemetry.ramPercent, 80, 'bg-blue-400')}</td>
                          <td className="py-2.5 px-3.5 tabular-nums">{bar(s, s.telemetry.diskPercent, 85, 'bg-indigo-400')}</td>
                          <td className={`py-2.5 px-3.5 tabular-nums ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                            {hasReported(s) ? fmtNum(s.telemetry.loadAvg?.[0], 2) : '—'}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-sans">
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                setSelectedServerId(s.id);
                              }}
                              className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors border cursor-pointer ${
                                isDark
                                  ? 'text-slate-300 hover:text-white hover:bg-[#1D2B44] border-[#23334E]'
                                  : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100 border-slate-300'
                              }`}
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {reporting.length < servers.length && (
            <p className={`text-[11px] font-mono ${muted}`}>
              {servers.length - reporting.length} server{servers.length - reporting.length === 1 ? ' has' : 's have'} never reported telemetry.{' '}
              <button onClick={() => navigate('/setup')} className="text-blue-500 hover:underline cursor-pointer">Install the agent from Setup</button>.
            </p>
          )}
        </>
      )}
    </div>
  );
};
