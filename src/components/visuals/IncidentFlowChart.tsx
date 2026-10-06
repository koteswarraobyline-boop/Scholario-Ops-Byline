import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import { Incident, IncidentStatus } from '../../types';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ExternalLink } from 'lucide-react';

const parseTs = (iso?: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

const fmtAgo = (t: number | null) => {
  if (t === null) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const fmtMinutes = (min: number) => (min < 60 ? `${Math.round(min)}m` : `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`);

const isOpen = (i: Incident) => i.status !== 'RESOLVED' && i.status !== 'CLOSED';

/** Index of each status in the lifecycle (RESOLVED and CLOSED are both terminal). */
const STAGE_INDEX: Record<IncidentStatus, number> = {
  OPEN: 0, ACKNOWLEDGED: 1, INVESTIGATING: 2, MITIGATING: 3, MONITORING: 4, RESOLVED: 5, CLOSED: 5,
};

/** Finds when the incident entered a status, from its real timeline ("Status changed to X"). */
const statusEnteredAt = (inc: Incident, status: IncidentStatus): number | null => {
  const ev = inc.timeline.find(e => e.message.startsWith(`Status changed to ${status}`));
  return ev ? parseTs(ev.timestamp) : null;
};

export const IncidentFlowChart: React.FC = () => {
  const { incidents, monitors, applications, theme, setSelectedIncidentId } = useOps();
  const navigate = useNavigate();
  const isDark = theme === 'dark';

  // Open incidents first (newest first), then the most recent closed ones
  const ordered = useMemo(() => {
    const byStart = (a: Incident, b: Incident) => (parseTs(b.startedAt) ?? 0) - (parseTs(a.startedAt) ?? 0);
    return [...incidents.filter(isOpen).sort(byStart), ...incidents.filter(i => !isOpen(i)).sort(byStart)];
  }, [incidents]);

  const [pickedId, setPickedId] = useState<string>('');
  const incident = ordered.find(i => i.id === pickedId) ?? ordered[0];

  // Real aggregate stats
  const openCount = incidents.filter(isOpen).length;
  const unackedCount = incidents.filter(i => isOpen(i) && !i.acknowledged).length;
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const resolved7d = incidents.filter(i => !isOpen(i) && (parseTs(i.resolvedAt) ?? 0) > weekAgo);
  const mttrMin = resolved7d.length
    ? resolved7d.reduce((a, i) => a + (i.durationMinutes || 0), 0) / resolved7d.length
    : null;
  const ackDelays = incidents
    .map(i => {
      const s = parseTs(i.startedAt);
      const a = parseTs(i.acknowledgedAt);
      return s !== null && a !== null && a >= s ? (a - s) / 60000 : null;
    })
    .filter((v): v is number => v !== null);
  const mttaMin = ackDelays.length ? ackDelays.reduce((a, b) => a + b, 0) / ackDelays.length : null;

  const cardClass = `p-2.5 rounded border ${isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200'}`;
  const labelClass = `text-[10px] uppercase tracking-wider font-semibold`;
  const subClass = `text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`;

  const shell = `rounded-lg border p-4 transition-colors ${
    isDark ? 'bg-[#111726] border-[#1E293B] text-slate-100' : 'bg-white border-[#E2E8F0] text-slate-900 shadow-xs'
  }`;

  if (!incident) {
    return (
      <div className={shell}>
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded ${isDark ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div>
            <div className="font-semibold text-xs tracking-tight">Incident Lifecycle</div>
            <p className={`text-[11px] font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              No incidents have been recorded yet. Incidents are opened automatically when a monitor fails its confirmation threshold, or declared manually.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const stage = STAGE_INDEX[incident.status];
  const resolved = !isOpen(incident);
  const app = applications.find(a => a.id === incident.applicationId);
  const affected = monitors.filter(m => incident.affectedMonitors.includes(m.id));
  const recoveryProgress = affected.length
    ? affected.map(m => `${m.name}: ${Math.min(m.consecutiveRecoveries, m.recoveryConfirmationThreshold)}/${m.recoveryConfirmationThreshold} passes`).join(' · ')
    : '';

  const steps: Array<{ title: string; detail: string; at: number | null; idx: number }> = [
    {
      idx: 0,
      title: 'Detected',
      detail: incident.timeline[0]?.message || incident.rootCause || incident.title,
      at: parseTs(incident.startedAt),
    },
    {
      idx: 1,
      title: 'Acknowledged',
      detail: incident.acknowledged ? `By ${incident.acknowledgedBy || 'operator'}` : 'Awaiting acknowledgement',
      at: parseTs(incident.acknowledgedAt) ?? statusEnteredAt(incident, 'ACKNOWLEDGED'),
    },
    { idx: 2, title: 'Investigating', detail: `Owner: ${incident.owner || 'Unassigned'}`, at: statusEnteredAt(incident, 'INVESTIGATING') },
    { idx: 3, title: 'Mitigating', detail: incident.mitigationActionTaken || 'Mitigation in progress', at: statusEnteredAt(incident, 'MITIGATING') },
    { idx: 4, title: 'Monitoring Recovery', detail: recoveryProgress || incident.recoveryStatus || 'Watching for recovery', at: statusEnteredAt(incident, 'MONITORING') },
    {
      idx: 5,
      title: incident.status === 'CLOSED' ? 'Closed' : 'Resolved',
      detail: resolved ? (incident.recoveryStatus || 'Resolved') : 'Not yet resolved',
      at: parseTs(incident.resolvedAt) ?? statusEnteredAt(incident, incident.status === 'CLOSED' ? 'CLOSED' : 'RESOLVED'),
    },
  ];

  const stepState = (idx: number): 'DONE' | 'ACTIVE' | 'PENDING' | 'SKIPPED' => {
    if (idx === 1 && incident.acknowledged) return 'DONE';
    if (idx < stage) return steps[idx].at !== null || idx === 0 ? 'DONE' : 'SKIPPED';
    if (idx === stage) return resolved ? 'DONE' : 'ACTIVE';
    return 'PENDING';
  };

  const openIncident = () => {
    setSelectedIncidentId(incident.id);
    navigate('/incidents');
  };

  return (
    <div className={shell}>
      {/* Header */}
      <div className={`flex flex-wrap items-center justify-between gap-3 pb-3 border-b ${isDark ? 'border-[#1E293B]' : 'border-slate-100'}`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`p-1.5 rounded ${
            resolved
              ? (isDark ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' : 'bg-emerald-50 text-emerald-700 border border-emerald-200')
              : (isDark ? 'bg-rose-950 text-rose-400 border border-rose-900' : 'bg-rose-50 text-rose-700 border border-rose-200')
          }`}>
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-xs tracking-tight">Incident Lifecycle</span>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
                resolved
                  ? (isDark ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-emerald-100 text-emerald-800 border border-emerald-300')
                  : (isDark ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-rose-100 text-rose-800 border border-rose-300')
              }`}>
                {incident.id} · {incident.severity} · {incident.status}
              </span>
            </div>
            <p className={`text-[11px] font-mono mt-0.5 truncate ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              {incident.title}{app ? ` · ${app.name} ${incident.environment}` : ''} · started {fmtAgo(parseTs(incident.startedAt)) || '—'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {ordered.length > 1 && (
            <select
              value={incident.id}
              onChange={e => setPickedId(e.target.value)}
              className={`text-xs font-mono px-2.5 py-1 rounded border outline-none cursor-pointer max-w-[220px] ${
                isDark ? 'bg-[#0B0F17] border-[#223048] text-slate-100 focus:border-blue-500' : 'bg-slate-50 border-slate-300 text-slate-800 focus:border-blue-500'
              }`}
            >
              {ordered.slice(0, 25).map(i => (
                <option key={i.id} value={i.id}>{i.id} · {i.status} · {i.title.slice(0, 40)}</option>
              ))}
            </select>
          )}
          <button
            onClick={openIncident}
            className={`px-3 py-1 text-xs font-mono rounded flex items-center gap-1.5 transition-colors border cursor-pointer ${
              isDark ? 'bg-[#182030] hover:bg-[#202B40] text-slate-200 border-[#243552]' : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
            }`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open incident</span>
          </button>
        </div>
      </div>

      {/* Horizontal Flow Steps */}
      <div className="py-3 w-full min-w-0">
        <div className={`w-full min-w-0 p-4 rounded-lg border overflow-x-auto ${
          isDark ? 'bg-[#070B12] border-[#182336]' : 'bg-[#F8FAFC] border-[#E2E8F0]'
        }`}>
          <div className="min-w-[820px] flex items-center justify-between relative">
            {steps.map((st, i) => {
              const state = stepState(st.idx);
              const isCurrent = state === 'ACTIVE';
              const isDone = state === 'DONE';
              const isSkipped = state === 'SKIPPED';
              const timeLabel = isDone || isCurrent
                ? (st.at !== null ? fmtAgo(st.at) : isCurrent ? 'Current' : '—')
                : isSkipped ? 'Skipped' : 'Pending';

              return (
                <React.Fragment key={st.idx}>
                  <div className={`w-32 p-2.5 rounded-lg border flex flex-col items-center text-center relative transition-all ${
                    isCurrent
                      ? (isDark ? 'bg-[#21160C] border-amber-500 ring-2 ring-amber-500/40' : 'bg-amber-50 border-amber-400 ring-2 ring-amber-400/40 shadow-xs')
                      : isDone
                        ? (isDark ? 'bg-[#0D1F15] border-emerald-800/80 text-emerald-300' : 'bg-white border-emerald-300 text-emerald-950 shadow-xs')
                        : (isDark ? 'bg-[#111726] border-slate-800 text-slate-500' : 'bg-slate-100 border-slate-200 text-slate-400')
                  }`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold font-mono mb-1.5 ${
                      isCurrent
                        ? 'bg-amber-500 text-white animate-pulse'
                        : isDone
                          ? 'bg-emerald-500 text-white'
                          : (isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-500')
                    }`}>
                      {isDone ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : st.idx + 1}
                    </div>
                    <span className="font-semibold text-[11px] font-mono leading-tight">{st.title}</span>
                    <span className={`text-[9px] font-mono mt-1 ${
                      isCurrent ? 'text-amber-400 font-semibold' : isDone ? (isDark ? 'text-emerald-400' : 'text-emerald-600') : 'text-slate-500'
                    }`}>
                      {timeLabel}
                    </span>
                    {(isDone || isCurrent) && (
                      <p className={`text-[9px] font-sans mt-1 line-clamp-2 ${isDark ? 'text-slate-400' : 'text-slate-600'}`} title={st.detail}>
                        {st.detail}
                      </p>
                    )}
                  </div>

                  {i < steps.length - 1 && (
                    <div className="flex-1 px-1 flex justify-center">
                      <ArrowRight className={`w-3.5 h-3.5 ${
                        isDone && stepState(steps[i + 1].idx) !== 'PENDING'
                          ? 'text-emerald-500'
                          : isCurrent
                            ? 'text-amber-500 animate-pulse'
                            : (isDark ? 'text-slate-700' : 'text-slate-300')
                      }`} />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Real incident statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 pt-1 font-mono text-xs">
        <div className={cardClass}>
          <div className={`${labelClass} text-rose-500`}>Open Incidents</div>
          <div className={`font-semibold text-sm mt-0.5 ${openCount > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>{openCount}</div>
          <div className={subClass}>{unackedCount} unacknowledged</div>
        </div>
        <div className={cardClass}>
          <div className={`${labelClass} text-emerald-500`}>Resolved (7d)</div>
          <div className="font-semibold text-sm mt-0.5 text-emerald-500">{resolved7d.length}</div>
          <div className={subClass}>{incidents.length} recorded in total</div>
        </div>
        <div className={cardClass}>
          <div className={`${labelClass} text-blue-500`}>MTTR (7d)</div>
          <div className="font-semibold text-sm mt-0.5 text-blue-500">{mttrMin !== null ? fmtMinutes(mttrMin) : '—'}</div>
          <div className={subClass}>{mttrMin !== null ? 'Mean time to resolve' : 'No resolved incidents in 7d'}</div>
        </div>
        <div className={cardClass}>
          <div className={`${labelClass} text-amber-500`}>MTTA</div>
          <div className="font-semibold text-sm mt-0.5 text-amber-500">{mttaMin !== null ? fmtMinutes(mttaMin) : '—'}</div>
          <div className={subClass}>{mttaMin !== null ? `Mean time to acknowledge (${ackDelays.length})` : 'No acknowledgements yet'}</div>
        </div>
      </div>
    </div>
  );
};
