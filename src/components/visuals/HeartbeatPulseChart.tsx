import React, { useState, useEffect } from 'react';
import { useOps } from '../../context/OpsContext';
import { Activity, Info, ChevronRight, Filter, X } from 'lucide-react';
import { Application, DeadManControlPlane, HeartbeatCheck, HeartbeatKind, HeartbeatState, Incident, ServerHeartbeat, TelemetryLevel } from '../../types';
import { LevelBadge } from '../infrastructure/telemetryUi';
import { deadManBadge, deadManLevel, fmtLatency } from '../ui/deadman';
import {
  DEFAULT_FILTERS, GROUPS, HeartbeatFilters, NodeState, StatusFilter, TypeFilter, filterRecords, incidentFor, isDefaultView,
  matchesServer, nodeState, serverFilterOptions, stateCounts, stateWord, typeTotals,
} from '../../lib/heartbeatView';

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
  sec === null || sec === undefined ? '—' : sec < 1 ? '<1s' : sec >= 120 && sec % 60 === 0 ? `${sec / 60}m` : `${Math.round(sec)}s`;

// ECG path (purely decorative waveform — the UI animation, not a network heartbeat)
const normalEcgPath = `
  M 0,28 L 30,28 Q 36,22 42,28 L 60,28 L 65,32 L 72,4 L 78,44 L 84,28 L 94,28 Q 104,18 114,28 L 140,28
  L 170,28 Q 176,22 182,28 L 200,28 L 205,32 L 212,4 L 218,44 L 224,28 L 234,28 Q 244,18 254,28 L 280,28
  L 310,28 Q 316,22 322,28 L 340,28 L 345,32 L 352,4 L 358,44 L 364,28 L 374,28 Q 384,18 394,28 L 420,28
  L 450,28 Q 456,22 462,28 L 480,28 L 485,32 L 492,4 L 498,44 L 504,28 L 514,28 Q 524,18 534,28 L 560,28
  L 600,28
`;
const flatlinePath = 'M 0,28 L 600,28';

const nodeLevel = (n: NodeState): TelemetryLevel => (n === 'HEALTHY' ? 'HEALTHY' : n === 'DEGRADED' ? 'WARNING' : n === 'UNKNOWN' ? 'UNKNOWN' : 'CRITICAL');
const KIND_LABEL: Record<HeartbeatKind, string> = { SERVER: 'Server', APPLICATION: 'Application', SERVICE: 'Service', DATABASE: 'Database' };
const TYPE_OPTIONS: Array<{ value: TypeFilter; label: string }> = [
  { value: 'ALL', label: 'All' }, { value: 'SERVER', label: 'Servers' }, { value: 'APPLICATION', label: 'Applications' },
  { value: 'SERVICE', label: 'Services' }, { value: 'DATABASE', label: 'Databases' },
];
const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: 'All' }, { value: 'HEALTHY', label: 'Healthy / connected' }, { value: 'DEGRADED', label: 'Degraded / stale' },
  { value: 'FAILING', label: 'Failing / disconnected' }, { value: 'UNKNOWN', label: 'Unknown' },
];

/** Badge for one heartbeat, worded for its type */
const StateBadge: React.FC<{ kind: HeartbeatKind; state: HeartbeatState; className?: string }> = ({ kind, state, className = '' }) => (
  <LevelBadge level={deadManLevel(state)} label={stateWord(kind, state)} className={`text-[10px] ${className}`} />
);

const IncidentChip: React.FC<{ incident: Incident | undefined }> = ({ incident }) => (incident
  ? <span className="text-[10px] font-bold px-1.5 rounded border border-rose-500/50 text-rose-500 shrink-0" title={incident.title}>{incident.id}</span>
  : null);

/** One heartbeat (used inside an expanded server and in the filtered list) */
const CheckRow: React.FC<{ c: HeartbeatCheck; s: ServerHeartbeat; now: number; muted: string; incident: Incident | undefined; showServer?: boolean }> = ({ c, s, now, muted, incident, showServer }) => {
  const facts: string[] = [];
  facts.push(`checked ${fmtAge(c.lastCheckAt, now)}`);
  if (c.state !== 'HEALTHY' && c.lastSuccessAt) facts.push(`last success ${fmtAge(c.lastSuccessAt, now)}`);
  if (c.state !== 'HEALTHY' && !c.lastSuccessAt && c.kind !== 'SERVER') facts.push('no success recorded');
  if (c.kind === 'APPLICATION') facts.push(c.httpStatus !== null ? `HTTP ${c.httpStatus}` : c.lastCheckAt ? 'HTTP — no response' : 'HTTP —');
  if (c.latencyMs !== null) facts.push(`${c.kind === 'SERVER' ? 'delivery ' : ''}${fmtLatency(c.latencyMs)}`);
  if (c.failures) facts.push(`${c.failures} ${c.kind === 'SERVER' ? 'missed report(s)' : 'consecutive failure(s)'}`);
  if (c.restartCount) facts.push(`${c.restartCount} restart(s)`);
  if (c.intervalSec) facts.push(`every ${fmtSec(c.intervalSec)}`);
  return (
    <li className={`py-1.5 min-w-0 ${c.state === 'FAILING' ? 'pl-2 border-l-2 border-rose-500' : c.state === 'DEGRADED' ? 'pl-2 border-l-2 border-amber-500' : 'pl-2 border-l-2 border-transparent'}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
        <StateBadge kind={c.kind} state={c.state} className="shrink-0" />
        <span className="font-semibold break-words min-w-0">{c.kind === 'SERVER' ? `Server heartbeat${s.agentVersion ? ` · agent v${s.agentVersion}` : ''}` : c.name}</span>
        {showServer && <span className={`${muted} shrink-0`}>— {s.environment}{c.kind !== 'SERVER' ? '' : ` · ${s.hostname}`}</span>}
        {showServer && <span className={`text-[10px] px-1 rounded border border-slate-500/40 ${muted}`}>{KIND_LABEL[c.kind]}</span>}
        <IncidentChip incident={incident} />
      </div>
      <div className={`text-[10px] break-words ${muted}`}>{c.detail}{c.target ? ` · ${c.target}` : ''}</div>
      <div className={`text-[10px] break-words tabular-nums ${muted}`}>{facts.join(' · ')}</div>
    </li>
  );
};

/** Small "Apps ● 1/1" chip of a collapsed server card */
const Chip: React.FC<{ label: string; state: HeartbeatState | null; value: string; muted: string }> = ({ label, state, value, muted }) => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap">
    <span className={muted}>{label}</span>
    {state === null ? <span className={muted} title="Not configured — not counted as healthy">— not configured</span>
      : <LevelBadge level={deadManLevel(state)} label={value} className="text-[10px]" />}
  </span>
);

const ServerCard: React.FC<{
  s: ServerHeartbeat; now: number; isDark: boolean; expanded: boolean; onToggle: () => void;
  incidentOf: (c: HeartbeatCheck, s: ServerHeartbeat) => Incident | undefined;
}> = ({ s, now, isDark, expanded, onToggle, incidentOf }) => {
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const node = nodeState(s);
  const hb = s.server;
  const openIncidents = [hb, ...s.applications.checks, ...s.services.checks, ...s.databases.checks].map(c => incidentOf(c, s)).filter(Boolean).length;
  const border = node.state === 'HEALTHY' ? '' : node.state === 'DEGRADED' ? 'border-l-amber-500' : node.state === 'UNKNOWN' ? '' : 'border-l-rose-500';
  return (
    <div className={`rounded border min-w-0 font-mono text-[11px] ${border ? `border-l-4 ${border}` : ''} ${isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200'}`}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="w-full text-left p-3 cursor-pointer min-w-0 block">
        <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden="true" />
            <span className={`text-[10px] font-bold px-1.5 rounded border shrink-0 ${s.environment === 'PRD' ? 'text-blue-500 border-blue-500/40' : 'text-amber-500 border-amber-500/40'}`}>{s.environment}</span>
            <span className="font-bold text-xs break-all min-w-0">{s.environment} VPS · {s.ip}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {openIncidents > 0 && <span className="text-[10px] font-bold px-1.5 rounded border border-rose-500/50 text-rose-500">{openIncidents} incident{openIncidents === 1 ? '' : 's'}</span>}
            <span className={`text-[10px] ${muted}`}>Overall node</span>
            <LevelBadge level={nodeLevel(node.state)} label={node.state} className="text-xs" />
          </div>
        </div>
        <div className={`mt-1 pl-6 text-[10px] break-words ${muted}`}>
          {s.hostname}
          {hb.lastSuccessAt
            ? ` · Agent ${s.agentVersion ? `v${s.agentVersion}` : '—'} · last report ${fmtAge(hb.lastSuccessAt, now)} · every ${fmtSec(hb.intervalSec)}${hb.latencyMs !== null ? ` · delivery ${fmtLatency(hb.latencyMs)}` : ''}`
            : ` · ${hb.detail}`}
        </div>
        <div className="mt-1.5 pl-6 flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
          <Chip label="Server" state={hb.state} value={stateWord('SERVER', hb.state)} muted={muted} />
          {GROUPS.map(g => (
            <Chip key={g.key} label={g.short} state={s[g.key].total ? s[g.key].state : null} value={`${s[g.key].healthy}/${s[g.key].total}`} muted={muted} />
          ))}
        </div>
        {node.reasons.length > 0 && (
          <div className={`mt-1.5 pl-6 text-[10px] break-words ${node.state === 'UNKNOWN' ? muted : node.state === 'DEGRADED' ? 'text-amber-500' : 'text-rose-500'}`}>
            Reason: {node.reasons.join(' · ')}
          </div>
        )}
      </button>

      {expanded && (
        <div className={`px-3 pb-3 pl-9 space-y-2 border-t ${isDark ? 'border-[#1D283E]' : 'border-slate-200'}`}>
          <section className="pt-2">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">Server</div>
            <ul><CheckRow c={hb} s={s} now={now} muted={muted} incident={incidentOf(hb, s)} /></ul>
          </section>
          {GROUPS.map(g => {
            const grp = s[g.key];
            return (
              <section key={g.key}>
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
                  <span>{g.label}</span>
                  {grp.total > 0 ? <span className={`font-normal normal-case ${muted}`}>{grp.healthy}/{grp.total} healthy</span>
                    : <span className={`font-normal ${muted}`}>— NOT CONFIGURED</span>}
                </div>
                {grp.total > 0 ? (
                  <ul>{grp.checks.map(c => <CheckRow key={c.key} c={c} s={s} now={now} muted={muted} incident={incidentOf(c, s)} />)}</ul>
                ) : (
                  <div className={`text-[10px] ${muted}`}>
                    {g.key === 'applications' ? 'No application with an app port on this server (Setup → application → environment details).'
                      : g.key === 'services' ? 'No watched services (SERVICES= in /etc/scholario-agent.conf).'
                        : 'No database probe (DB_ENGINE= in /etc/scholario-agent.conf).'}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * Dead-Man Watchdog Heartbeat Stream: the heartbeat of the MONITORED infrastructure — four heartbeat
 * types per server (server agent, applications, services, databases) — from the agent reports Scholario
 * Ops receives. Filtering and the overall node state are presentation only. No external watchdog, no URL.
 */
export const DeadManPanel: React.FC<{
  deadMan: DeadManControlPlane; isDark: boolean; now: number;
  incidents?: Incident[]; applications?: Application[];
  /** For tests / deep links: initial filters and expanded servers (default: all filters ALL, all collapsed) */
  initialFilters?: Partial<HeartbeatFilters>; initialExpanded?: string[];
}> = ({ deadMan, isDark, now, incidents = [], applications = [], initialFilters, initialExpanded = [] }) => {
  const [filters, setFilters] = useState<HeartbeatFilters>({ ...DEFAULT_FILTERS, ...initialFilters });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpanded));
  const level = deadManLevel(deadMan.status);
  const healthy = deadMan.status === 'HEALTHY';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const counts = stateCounts(deadMan);
  const totals = typeTotals(deadMan);
  const incidentOf = (c: HeartbeatCheck, s: ServerHeartbeat) => incidentFor(c, s, incidents, applications);
  const tone = level === 'HEALTHY' ? (isDark ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-emerald-100 text-emerald-800 border border-emerald-300')
    : level === 'CRITICAL' ? (isDark ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-rose-100 text-rose-800 border border-rose-300')
      : level === 'WARNING' ? (isDark ? 'bg-amber-950 text-amber-300 border border-amber-800' : 'bg-amber-100 text-amber-800 border border-amber-300')
        : (isDark ? 'bg-slate-800 text-slate-300 border border-slate-700' : 'bg-slate-100 text-slate-700 border border-slate-300');
  const select = `px-2 py-1 rounded text-xs font-mono focus:outline-none focus:border-blue-500 border cursor-pointer ${isDark ? 'bg-[#0B0F17] border-[#1E293B] text-slate-200' : 'bg-white border-slate-300 text-slate-800'}`;
  const defaultView = isDefaultView(filters);
  const servers = deadMan.servers.filter(s => matchesServer(s, filters.server));
  const matches = defaultView ? [] : filterRecords(deadMan, filters);
  const toggle = (id: string) => setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const set = (patch: Partial<HeartbeatFilters>) => setFilters(f => ({ ...f, ...patch }));

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
              {counts.FAILING > 0 && <span className="text-[10px] font-mono font-bold text-rose-500">{counts.FAILING} failing</span>}
            </div>
            <p className={`text-[11px] font-mono mt-0.5 break-words ${muted}`}>
              {deadMan.servers.length
                ? `Monitoring ${deadMan.servers.map(s => `${s.environment} VPS`).join(', ')} — server, application, service and database heartbeats. Scholario Ops is the monitoring control plane.`
                : 'No server registered yet — add the PRD and DR VPS in Setup and install the agent.'}
            </p>
          </div>
        </div>
      </div>

      {/* Heartbeat status summary — counted from the heartbeat data */}
      {deadMan.servers.length > 0 && (
        <div className="pt-3 grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2 font-mono text-[11px]" aria-label="Heartbeat status">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className={`text-[10px] uppercase tracking-wider ${muted}`}>Heartbeat status</span>
            <LevelBadge level="HEALTHY" label={`${counts.HEALTHY} Healthy`} />
            <LevelBadge level="WARNING" label={`${counts.DEGRADED} Degraded`} />
            <LevelBadge level="CRITICAL" label={`${counts.FAILING} Failing`} />
            <LevelBadge level="UNKNOWN" label={`${counts.UNKNOWN} Unknown`} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {([['SERVER', 'Servers'], ['APPLICATION', 'Applications'], ['SERVICE', 'Services'], ['DATABASE', 'Databases']] as const).map(([k, label]) => (
              <span key={k} className="whitespace-nowrap">
                <span className={muted}>{label}</span>{' '}
                <b className={totals[k].total === 0 ? muted : totals[k].healthy === totals[k].total ? 'text-emerald-500' : 'text-amber-500'}>{totals[k].healthy}/{totals[k].total}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Waveform: a UI animation only (it does not mean a network heartbeat every second) */}
      <div className="py-3">
        <div className={`relative h-10 rounded border overflow-hidden ${isDark ? 'bg-[#070B12] border-[#182438]' : 'bg-[#F8FAFC] border-[#E2E8F0]'}`}>
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
        <>
          {/* Filters (client-side, over the data already loaded) */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-3 font-mono text-[11px]" role="group" aria-label="Heartbeat filters">
            <Filter className={`w-3.5 h-3.5 ${muted}`} aria-hidden="true" />
            <label className="flex items-center gap-1.5">
              <span className={muted}>Heartbeat type</span>
              <select className={select} value={filters.type} onChange={e => set({ type: e.target.value as TypeFilter })} aria-label="Heartbeat type">
                {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className={muted}>Status</span>
              <select className={select} value={filters.status} onChange={e => set({ status: e.target.value as StatusFilter })} aria-label="Status">
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className={muted}>Server</span>
              <select className={select} value={filters.server} onChange={e => set({ server: e.target.value })} aria-label="Server">
                <option value="ALL">All servers</option>
                {serverFilterOptions(deadMan).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            {(filters.type !== 'ALL' || filters.status !== 'ALL' || filters.server !== 'ALL') && (
              <button type="button" onClick={() => setFilters(DEFAULT_FILTERS)} className="inline-flex items-center gap-1 text-blue-500 hover:underline cursor-pointer">
                <X className="w-3 h-3" aria-hidden="true" /> Clear filters
              </button>
            )}
          </div>

          {defaultView ? (
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3 items-start [&>*]:min-w-0">
              {servers.map(s => (
                <ServerCard key={s.serverId} s={s} now={now} isDark={isDark} expanded={expanded.has(s.serverId)} onToggle={() => toggle(s.serverId)} incidentOf={incidentOf} />
              ))}
            </div>
          ) : (
            <div className={`rounded border p-3 font-mono text-[11px] min-w-0 ${isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200'}`}>
              <div className={`text-[10px] uppercase tracking-wider mb-1 ${muted}`}>{matches.length} matching heartbeat{matches.length === 1 ? '' : 's'}</div>
              {matches.length === 0 ? (
                <div className={`py-2 ${muted}`}>No heartbeats match these filters.</div>
              ) : (
                <ul className="divide-y divide-slate-500/15">
                  {matches.map(r => <CheckRow key={`${r.server.serverId}:${r.check.key}`} c={r.check} s={r.server} now={now} muted={muted} incident={incidentOf(r.check, r.server)} showServer />)}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      <p className={`mt-3 flex items-start gap-1.5 text-[11px] font-sans leading-relaxed ${muted}`}>
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
        <span className="min-w-0 break-words">
          The server heartbeat is the agent's own report delivery; the overall node also counts the application, service and database
          heartbeats on that server. A stopped application fails its heartbeat without disconnecting the server. Categories that are
          not configured are not counted as healthy. Failing heartbeats open incidents and recover automatically.
        </span>
      </p>
    </div>
  );
};

export const HeartbeatPulseChart: React.FC = () => {
  const { deadMan, theme, incidents, applications } = useOps();
  // 1 Hz UI clock so ages ("12s ago") stay current between data updates
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <DeadManPanel deadMan={deadMan} isDark={theme === 'dark'} now={now} incidents={incidents} applications={applications} />;
};
