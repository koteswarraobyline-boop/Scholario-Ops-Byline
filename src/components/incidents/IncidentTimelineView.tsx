import React, { useState, useMemo } from 'react';
import { useOps } from '../../context/OpsContext';
import { Incident } from '../../types';
import { Clock, Eye, Check, ChevronRight } from 'lucide-react';

interface IncidentTimelineViewProps {
  onSelectIncident?: (incidentId: string) => void;
}

/** Parses an ISO string; returns null for empty/invalid values. */
const parseTs = (iso?: string): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

const fmtDateTime = (iso?: string) => {
  const t = parseTs(iso);
  return t === null ? '—' : new Date(t).toLocaleString();
};

const fmtMinutes = (ms: number) => {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
};

const isClosed = (inc: Incident) => inc.status === 'RESOLVED' || inc.status === 'CLOSED';

type StageStatus = 'COMPLETED' | 'IN_PROGRESS' | 'PENDING';

export const IncidentTimelineView: React.FC<IncidentTimelineViewProps> = ({ onSelectIncident }) => {
  const { incidents, applications, runbooks, setSelectedIncidentId, theme } = useOps();
  const isDark = theme === 'dark';

  const [timeWindowHours, setTimeWindowHours] = useState<number>(48);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'RESOLVED'>('ALL');
  const [activeIncidentId, setActiveIncidentId] = useState<string>('');

  const now = Date.now();
  const windowStart = now - timeWindowHours * 60 * 60 * 1000;

  const displayedIncidents = useMemo(() => {
    return incidents.filter(inc => {
      const startTime = parseTs(inc.startedAt);
      if (startTime === null) return false;
      const endTime = parseTs(inc.resolvedAt) ?? now;
      if (endTime < windowStart) return false;

      const active = !isClosed(inc);
      if (statusFilter === 'ACTIVE') return active;
      if (statusFilter === 'RESOLVED') return !active;
      return true;
    });
  }, [incidents, statusFilter, now, windowStart]);

  const currentIncident = useMemo(() => {
    return incidents.find(i => i.id === activeIncidentId)
      || displayedIncidents.find(i => !isClosed(i))
      || displayedIncidents[0];
  }, [incidents, activeIncidentId, displayedIncidents]);

  const currentApp = applications.find(a => a.id === currentIncident?.applicationId);
  const currentRunbook = runbooks.find(r => r.id === currentIncident?.runbookId);

  const timeTicks = useMemo(() => {
    const ticks = [];
    const stepHours = timeWindowHours / 4;
    for (let i = 4; i >= 0; i--) {
      const hoursAgo = Math.round(i * stepHours);
      ticks.push({
        label: hoursAgo === 0 ? 'NOW' : `${hoursAgo}h ago`,
        positionPercent: ((timeWindowHours - hoursAgo) / timeWindowHours) * 100
      });
    }
    return ticks;
  }, [timeWindowHours]);

  const calculateBarPosition = (inc: Incident) => {
    const startTime = parseTs(inc.startedAt) ?? now;
    const endTime = parseTs(inc.resolvedAt) ?? now;

    const clampedStart = Math.max(startTime, windowStart);
    const clampedEnd = Math.min(endTime, now);

    const leftPercent = ((clampedStart - windowStart) / (now - windowStart)) * 100;
    const widthPercent = Math.max(1.8, ((clampedEnd - clampedStart) / (now - windowStart)) * 100);

    return {
      left: `${Math.min(97.5, Math.max(0, leftPercent)).toFixed(2)}%`,
      width: `${Math.min(100 - leftPercent, Math.max(2.2, widthPercent)).toFixed(2)}%`
    };
  };

  /** Lifecycle derived purely from the incident's recorded status and timestamps. */
  const getLifecycleStages = (inc: Incident) => {
    const resolved = isClosed(inc);
    const order = ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'MITIGATING', 'MONITORING', 'RESOLVED', 'CLOSED'];
    const idx = order.indexOf(inc.status);
    const reached = (s: string) => idx >= order.indexOf(s);
    const stage = (done: boolean, current: boolean): StageStatus => done ? 'COMPLETED' : current ? 'IN_PROGRESS' : 'PENDING';
    const acked = inc.acknowledged || reached('ACKNOWLEDGED');

    return [
      { stage: 1, title: 'Detected / Declared', subtitle: fmtDateTime(inc.startedAt), status: 'COMPLETED' as StageStatus, badge: 'OPENED' },
      {
        stage: 2, title: 'Acknowledged',
        subtitle: acked ? (inc.acknowledgedBy ? `By ${inc.acknowledgedBy}` : fmtDateTime(inc.acknowledgedAt)) : 'Awaiting acknowledgement',
        status: stage(acked, !acked), badge: acked ? 'DONE' : 'PENDING',
      },
      { stage: 3, title: 'Investigating', subtitle: inc.status === 'INVESTIGATING' ? 'Current status' : reached('INVESTIGATING') ? 'Passed' : 'Not reached', status: stage(reached('MITIGATING'), inc.status === 'INVESTIGATING'), badge: inc.status === 'INVESTIGATING' ? 'ACTIVE' : reached('MITIGATING') ? 'DONE' : '—' },
      { stage: 4, title: 'Mitigating', subtitle: inc.mitigationActionTaken ? 'Mitigation recorded' : inc.status === 'MITIGATING' ? 'Current status' : 'Not reached', status: stage(reached('MONITORING'), inc.status === 'MITIGATING'), badge: inc.status === 'MITIGATING' ? 'ACTIVE' : reached('MONITORING') ? 'DONE' : '—' },
      { stage: 5, title: 'Monitoring', subtitle: inc.status === 'MONITORING' ? 'Watching for recovery' : resolved ? 'Passed' : 'Not reached', status: stage(resolved, inc.status === 'MONITORING'), badge: inc.status === 'MONITORING' ? 'ACTIVE' : resolved ? 'DONE' : '—' },
      { stage: 6, title: 'Resolved', subtitle: resolved ? fmtDateTime(inc.resolvedAt) : 'Not resolved', status: stage(resolved, false), badge: resolved ? inc.status : 'OPEN' },
    ];
  };

  const ackDelay = (inc: Incident) => {
    const s = parseTs(inc.startedAt);
    const a = parseTs(inc.acknowledgedAt);
    return s !== null && a !== null ? fmtMinutes(a - s) : null;
  };

  return (
    <div className={`rounded-lg border space-y-4 p-4 sm:p-5 transition-colors ${
      isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
    }`}>

      {/* Header & filters */}
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-100'
      }`}>
        <div>
          <h2 className="text-sm font-bold font-mono tracking-tight flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-blue-500" />
            <span>INCIDENT TIMELINE</span>
          </h2>
          <p className={`text-xs mt-0.5 font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            When each incident started and how long it lasted, with its recorded lifecycle
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <div className={`flex items-center p-0.5 rounded border ${
            isDark ? 'bg-[#0B0F17] border-[#1E293B]' : 'bg-slate-100 border-slate-300'
          }`}>
            {[
              { label: '24h', val: 24 },
              { label: '48h', val: 48 },
              { label: '7d', val: 168 }
            ].map(tw => (
              <button
                key={tw.val}
                onClick={() => setTimeWindowHours(tw.val)}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
                  timeWindowHours === tw.val
                    ? 'bg-blue-600 text-white font-medium shadow-xs'
                    : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tw.label}
              </button>
            ))}
          </div>

          <div className={`flex items-center p-0.5 rounded border ${
            isDark ? 'bg-[#0B0F17] border-[#1E293B]' : 'bg-slate-100 border-slate-300'
          }`}>
            {(['ALL', 'ACTIVE', 'RESOLVED'] as const).map(sf => (
              <button
                key={sf}
                onClick={() => setStatusFilter(sf)}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
                  statusFilter === sf
                    ? 'bg-blue-600 text-white font-medium shadow-xs'
                    : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {sf}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline track */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 px-1">
          <span>Click an incident to inspect its lifecycle</span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>Active</span>
            <span className="mx-1 text-slate-500">·</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>Resolved</span>
          </span>
        </div>

        <div className={`w-full min-w-0 rounded-lg border p-3.5 space-y-3 overflow-x-auto ${
          isDark ? 'bg-[#070B12] border-[#182338]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className="min-w-[680px] space-y-2.5">
            <div className="relative h-6 border-b border-dashed border-slate-700/60 pb-1">
              {timeTicks.map((tick, i) => (
                <div
                  key={i}
                  style={{ left: `${tick.positionPercent}%` }}
                  className="absolute -translate-x-1/2 flex flex-col items-center pointer-events-none"
                >
                  <span className={`text-[10px] font-mono font-medium ${
                    tick.label === 'NOW' ? 'text-emerald-500 font-bold' : isDark ? 'text-slate-400' : 'text-slate-600'
                  }`}>
                    {tick.label}
                  </span>
                  <div className={`w-px h-1.5 mt-0.5 ${isDark ? 'bg-slate-700' : 'bg-slate-300'}`} />
                </div>
              ))}
            </div>

            <div className="space-y-2 pt-1">
              {displayedIncidents.length === 0 ? (
                <div className="py-6 text-center text-xs font-mono text-slate-400">
                  No incidents in the selected {timeWindowHours >= 168 ? '7-day' : `${timeWindowHours}h`} window.
                </div>
              ) : (
                displayedIncidents.map(inc => {
                  const active = !isClosed(inc);
                  const isSelected = currentIncident?.id === inc.id;
                  const barStyle = calculateBarPosition(inc);
                  const app = applications.find(a => a.id === inc.applicationId);

                  return (
                    <div
                      key={inc.id}
                      onClick={() => setActiveIncidentId(inc.id)}
                      className={`relative flex items-center h-10 rounded border transition-all cursor-pointer group px-2 select-none ${
                        isSelected
                          ? (isDark ? 'bg-[#142036] border-blue-500 shadow-xs ring-1 ring-blue-500' : 'bg-blue-50/80 border-blue-400 shadow-xs ring-1 ring-blue-400')
                          : (isDark ? 'bg-[#0E1524] border-[#1A263C] hover:border-slate-600' : 'bg-white border-slate-200 hover:border-slate-300 shadow-2xs')
                      }`}
                    >
                      <div className="w-48 shrink-0 flex items-center gap-2 pr-2 border-r border-inherit font-mono z-10">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${active ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`} />
                        <span className="font-bold text-xs">{inc.id}</span>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                          inc.severity === 'CRITICAL' || inc.severity === 'EMERGENCY'
                            ? (isDark ? 'bg-rose-950/80 text-rose-300 border border-rose-800' : 'bg-rose-100 text-rose-800')
                            : inc.severity === 'HIGH'
                              ? (isDark ? 'bg-amber-950/80 text-amber-300 border border-amber-800' : 'bg-amber-100 text-amber-800')
                              : (isDark ? 'bg-blue-950/80 text-blue-300 border border-blue-800' : 'bg-blue-100 text-blue-800')
                        }`}>
                          {inc.severity}
                        </span>
                        <span className={`text-[10px] truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                          {app?.name ?? '—'}
                        </span>
                      </div>

                      <div className="flex-1 relative h-6 mx-2 overflow-hidden">
                        <div className={`absolute inset-x-0 top-1/2 -translate-y-1/2 h-px ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
                        <div
                          style={{ left: barStyle.left, width: barStyle.width }}
                          className={`absolute top-1/2 -translate-y-1/2 h-5 rounded flex items-center justify-between px-2 text-[10px] font-mono font-semibold transition-all ${
                            active
                              ? 'bg-gradient-to-r from-rose-600 via-rose-500 to-amber-500 text-white shadow-xs ring-1 ring-rose-400'
                              : inc.severity === 'CRITICAL' || inc.severity === 'EMERGENCY'
                                ? 'bg-rose-800/80 text-rose-100 border border-rose-600'
                                : inc.severity === 'HIGH'
                                  ? 'bg-amber-700/80 text-amber-100 border border-amber-500'
                                  : 'bg-blue-700/80 text-blue-100 border border-blue-500'
                          }`}
                          title={`${inc.id}: started ${fmtDateTime(inc.startedAt)} · ${inc.durationMinutes ?? 0} min`}
                        >
                          <span className="truncate pr-1">
                            {active ? `OPEN: ${inc.durationMinutes ?? 0}m` : `${inc.durationMinutes ?? 0}m`}
                          </span>
                          {active ? (
                            <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />
                          ) : (
                            <Check className="w-3 h-3 text-white shrink-0" />
                          )}
                        </div>
                      </div>

                      <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                        isSelected ? 'text-blue-500 translate-x-0.5' : 'text-slate-500 group-hover:text-slate-300'
                      }`} />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Selected incident inspector */}
      {currentIncident && (
        <div className={`rounded-lg border p-4 sm:p-5 space-y-4 transition-colors ${
          isDark ? 'bg-[#0B0F17] border-[#1C273C]' : 'bg-slate-50/70 border-slate-200'
        }`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 border-inherit">
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                <span className="font-bold text-sm text-blue-500">{currentIncident.id}</span>
                <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
                <span className={`font-semibold ${
                  currentIncident.severity === 'CRITICAL' || currentIncident.severity === 'EMERGENCY' ? 'text-rose-500 font-bold' : 'text-amber-500'
                }`}>
                  {currentIncident.severity}
                </span>
                <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
                <span className={`px-2 py-0.2 rounded text-[10px] font-semibold ${
                  isClosed(currentIncident)
                    ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-500 border border-rose-500/30'
                }`}>
                  {currentIncident.status}
                </span>
                <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
                <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>
                  Target: <strong>{currentApp?.name ?? '—'} ({currentIncident.environment})</strong>
                </span>
              </div>
              <h3 className="font-bold font-sans text-sm truncate">{currentIncident.title}</h3>
            </div>

            <div className="flex items-center gap-2 shrink-0 font-mono text-xs">
              <button
                onClick={() => {
                  setSelectedIncidentId(currentIncident.id);
                  if (onSelectIncident) onSelectIncident(currentIncident.id);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-xs cursor-pointer font-semibold"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>OPEN INCIDENT</span>
              </button>
            </div>
          </div>

          {/* Metrics derived from recorded timestamps */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
            <div className={`p-2.5 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'}`}>
              <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Started</div>
              <div className="font-bold mt-0.5">{fmtDateTime(currentIncident.startedAt)}</div>
              <div className={`text-[10px] font-sans ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                {(currentIncident.affectedMonitors ?? []).length > 0 ? `${currentIncident.affectedMonitors.length} monitor(s) involved` : 'Declared manually'}
              </div>
            </div>

            <div className={`p-2.5 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'}`}>
              <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Time to Acknowledge</div>
              <div className="font-bold mt-0.5">
                {currentIncident.acknowledged ? (ackDelay(currentIncident) ?? '—') : 'Pending'}
              </div>
              <div className={`text-[10px] font-sans truncate ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                {currentIncident.acknowledgedBy ? `By ${currentIncident.acknowledgedBy}` : 'Not acknowledged'}
              </div>
            </div>

            <div className={`p-2.5 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'}`}>
              <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Duration</div>
              <div className={`font-bold mt-0.5 tabular-nums ${isClosed(currentIncident) ? 'text-emerald-500' : 'text-rose-500'}`}>
                {currentIncident.durationMinutes ?? 0} min {isClosed(currentIncident) ? '' : '(ongoing)'}
              </div>
              <div className={`text-[10px] font-sans ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                {currentIncident.resolvedAt ? `Resolved ${fmtDateTime(currentIncident.resolvedAt)}` : 'Not resolved'}
              </div>
            </div>

            <div className={`p-2.5 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'}`}>
              <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Runbook</div>
              <div className="font-bold text-blue-500 mt-0.5 truncate">
                {currentRunbook?.title ?? 'None attached'}
              </div>
              <div className={`text-[10px] font-sans ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                Owner: {currentIncident.owner || 'Unassigned'}
              </div>
            </div>
          </div>

          {/* Lifecycle stepper */}
          <div className="space-y-2">
            <span className={`text-[10px] font-mono font-semibold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Lifecycle
            </span>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              {getLifecycleStages(currentIncident).map(st => {
                const isDone = st.status === 'COMPLETED';
                const isCurrent = st.status === 'IN_PROGRESS';

                return (
                  <div
                    key={st.stage}
                    className={`p-2.5 rounded border text-left flex flex-col justify-between min-h-[90px] font-mono transition-colors ${
                      isCurrent
                        ? (isDark ? 'bg-[#1C170E] border-amber-500/80 ring-1 ring-amber-500' : 'bg-amber-50 border-amber-400 ring-1 ring-amber-400')
                        : isDone
                          ? (isDark ? 'bg-[#0E1713] border-emerald-900/60' : 'bg-emerald-50/50 border-emerald-200')
                          : (isDark ? 'bg-[#0D121D] border-[#182336] opacity-60' : 'bg-slate-100/60 border-slate-200 opacity-70')
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between text-[10px] mb-1">
                        <span className={`font-bold ${isCurrent ? 'text-amber-500' : isDone ? 'text-emerald-500' : 'text-slate-500'}`}>
                          0{st.stage}
                        </span>
                        <span className={`text-[9px] px-1 py-0.2 rounded font-semibold ${
                          isDone ? 'bg-emerald-500/10 text-emerald-400' : isCurrent ? 'bg-amber-500/10 text-amber-400' : 'text-slate-500'
                        }`}>
                          {st.badge}
                        </span>
                      </div>
                      <div className={`font-semibold text-xs leading-snug font-sans ${
                        isCurrent ? (isDark ? 'text-amber-200' : 'text-amber-900') : isDone ? (isDark ? 'text-slate-200' : 'text-slate-800') : 'text-slate-500'
                      }`}>
                        {st.title}
                      </div>
                    </div>
                    <p className={`text-[10px] font-sans mt-1.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {st.subtitle}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={`p-3 rounded border text-xs font-mono flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            isDark ? 'bg-[#080D17] border-[#182338]' : 'bg-slate-100 border-slate-200'
          }`}>
            <div className="space-y-0.5 min-w-0">
              <span className={`text-[10px] uppercase font-bold ${isClosed(currentIncident) ? 'text-emerald-500' : 'text-rose-500'}`}>
                Root cause / detail:
              </span>
              <p className={`font-sans text-xs ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                {currentIncident.rootCause || 'Not recorded yet.'}
              </p>
            </div>
            {(currentIncident.timeline ?? []).length > 0 && (
              <span className="text-[11px] text-slate-400 shrink-0">
                {currentIncident.timeline.length} timeline event(s)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
