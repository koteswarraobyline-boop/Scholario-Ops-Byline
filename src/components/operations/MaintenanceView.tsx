import React, { useMemo, useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { MaintenanceWindow } from '../../types';
import { Calendar, BellOff, Plus, X, CheckCircle2, Trash2, Info } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';

const fmtDateTime = (iso?: string) => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '—' : new Date(t).toLocaleString();
};

/** Formats a Date as a value for <input type="datetime-local"> in local time. */
const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const localInputToIso = (v: string): string | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

const statusColor = (s: MaintenanceWindow['status']) =>
  s === 'IN_PROGRESS' ? 'text-amber-500' : s === 'SCHEDULED' ? 'text-blue-500' : 'text-slate-500';

const CreateMaintenanceForm: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { applications, monitors, createMaintenance, theme } = useOps();
  const isDark = theme === 'dark';

  const [title, setTitle] = useState('');
  const [applicationId, setApplicationId] = useState(applications[0]?.id ?? '');
  const [environment, setEnvironment] = useState<'PRD' | 'DR'>('PRD');
  const [start, setStart] = useState(() => toLocalInput(new Date()));
  const [end, setEnd] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60 * 1000)));
  const [reason, setReason] = useState('');
  const [expectedImpact, setExpectedImpact] = useState('');
  const [suppress, setSuppress] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const appMonitors = useMemo(
    () => monitors.filter(m => m.applicationId === applicationId && m.environment === environment),
    [monitors, applicationId, environment],
  );

  const startIso = localInputToIso(start);
  const endIso = localInputToIso(end);
  const rangeError = startIso && endIso && Date.parse(endIso) <= Date.parse(startIso) ? 'End must be after start' : null;
  const valid = Boolean(title.trim() && applicationId && startIso && endIso && !rangeError);

  const inputCls = `w-full p-2 border rounded text-xs font-mono focus:outline-none focus:border-blue-500 ${
    isDark ? 'bg-[#0A0F1A] border-[#1E293B] text-slate-100' : 'bg-white border-slate-300 text-slate-900'
  }`;
  const labelCls = `block text-[10px] uppercase font-semibold mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`;
  const muted = isDark ? 'text-slate-400' : 'text-slate-600';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || !startIso || !endIso) return;
    setSaving(true);
    try {
      const w = await createMaintenance({
        title: title.trim(),
        applicationId,
        environment,
        startTime: startIso,
        endTime: endIso,
        reason: reason.trim(),
        expectedImpact: expectedImpact.trim(),
        suppressMonitors: suppress.filter(id => appMonitors.some(m => m.id === id)),
      });
      if (w) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className={`p-4 sm:p-5 rounded-lg border space-y-3 font-mono text-xs ${
      isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
    }`}>
      <div className="flex items-center justify-between">
        <span className="font-bold text-sm">Schedule maintenance window</span>
        <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>

      <div>
        <label className={labelCls}>Title *</label>
        <input className={inputCls} required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. OS patching and reboot" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Application *</label>
          <select className={inputCls} value={applicationId} onChange={e => { setApplicationId(e.target.value); setSuppress([]); }}>
            {applications.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Environment</label>
          <select className={inputCls} value={environment} onChange={e => { setEnvironment(e.target.value as 'PRD' | 'DR'); setSuppress([]); }}>
            <option value="PRD">PRD</option>
            <option value="DR">DR</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Start *</label>
          <input type="datetime-local" className={inputCls} required value={start} onChange={e => setStart(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>End *</label>
          <input type="datetime-local" className={inputCls} required value={end} onChange={e => setEnd(e.target.value)} />
          {rangeError && <p className="text-[11px] text-rose-500 mt-1">{rangeError}</p>}
        </div>
      </div>

      <div>
        <label className={labelCls}>Reason</label>
        <input className={inputCls} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why this work is happening" />
      </div>
      <div>
        <label className={labelCls}>Expected impact</label>
        <input className={inputCls} maxLength={1000} value={expectedImpact} onChange={e => setExpectedImpact(e.target.value)} placeholder="e.g. Site unavailable for up to 10 minutes" />
      </div>

      <div>
        <label className={labelCls}>Monitors to suppress</label>
        {appMonitors.length === 0 ? (
          <p className={`text-[11px] font-sans ${muted}`}>This application has no {environment} monitors yet.</p>
        ) : (
          <div className={`p-2 rounded border max-h-40 overflow-y-auto space-y-1 ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`}>
            {appMonitors.map(m => (
              <label key={m.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={suppress.includes(m.id)}
                  onChange={() => setSuppress(prev => prev.includes(m.id) ? prev.filter(x => x !== m.id) : [...prev, m.id])}
                />
                <span className="truncate">{m.name}</span>
                <span className="text-[10px] text-slate-500 shrink-0">{m.type}</span>
              </label>
            ))}
          </div>
        )}
        <p className={`text-[11px] font-sans mt-1 ${muted}`}>
          {suppress.length === 0
            ? `None selected = all monitors of this application in ${environment} are suppressed.`
            : `${suppress.length} monitor(s) selected; other monitors keep alerting.`}
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className={`px-3 py-1 rounded text-[11px] font-semibold border cursor-pointer ${
            isDark ? 'bg-[#1A2436] hover:bg-[#23324C] border-[#23334E] text-slate-200' : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'
          }`}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid || saving}
          className="px-3 py-1 rounded text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer"
        >
          {saving ? 'Scheduling…' : 'Schedule window'}
        </button>
      </div>
    </form>
  );
};

export const MaintenanceView: React.FC = () => {
  const { maintenanceWindows, applications, monitors, completeMaintenance, deleteMaintenance, theme } = useOps();
  const { hasRole } = useAuth();
  const isDark = theme === 'dark';
  const isOperator = hasRole('operator');
  const isAdmin = hasRole('it_administrator');

  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const withBusy = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); } finally { setBusy(null); }
  };

  const secondaryBtn = `px-2.5 py-1 rounded text-[11px] font-semibold flex items-center gap-1 border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
    isDark ? 'bg-[#1A2436] hover:bg-[#23324C] border-[#23334E] text-slate-200' : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'
  }`;

  return (
    <div className="space-y-6">
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            MAINTENANCE WINDOWS &amp; ALERT SILENCING
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Planned work during which selected monitors do not open incidents
          </p>
        </div>
        {isOperator && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            disabled={applications.length === 0}
            title={applications.length === 0 ? 'Register an application in Setup first' : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Schedule window</span>
          </button>
        )}
      </div>

      <div className={`p-3 rounded border text-xs font-mono flex items-start gap-2.5 ${
        isDark ? 'bg-[#0E1524] border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
      }`}>
        <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <span className="font-sans leading-relaxed">
          While a window is active, its monitors keep running checks but failures do <strong>not</strong> open incidents or send notifications.
          If no specific monitors are chosen, every monitor of that application in the selected environment is suppressed. Windows end automatically at their end time, or can be completed early.
        </span>
      </div>

      {showForm && <CreateMaintenanceForm onClose={() => setShowForm(false)} />}

      {maintenanceWindows.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No maintenance windows"
          description={applications.length === 0
            ? 'Register your applications in Setup, then schedule maintenance here to silence alerts during planned work.'
            : 'Schedule a window before planned work so expected downtime does not open incidents.'}
          action={isOperator && !showForm && applications.length > 0 ? { label: 'Schedule window', onClick: () => setShowForm(true) } : undefined}
        />
      ) : (
        <div className="space-y-3 font-mono text-xs">
          {maintenanceWindows.map(m => {
            const app = applications.find(a => a.id === m.applicationId);
            const active = m.status === 'SCHEDULED' || m.status === 'IN_PROGRESS';
            const suppressed = m.suppressMonitors ?? [];
            const suppressedNames = suppressed.map(id => monitors.find(x => x.id === id)?.name ?? id);
            const confirming = confirmDeleteId === m.id;

            return (
              <div key={m.id} className={`p-4 rounded-lg border space-y-3 transition-colors ${
                isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
              } ${active ? '' : 'opacity-75'}`}>
                <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3 min-w-0 ${
                  isDark ? 'border-[#1A2332]' : 'border-slate-100'
                }`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${
                      isDark ? 'bg-[#162033] text-indigo-400' : 'bg-indigo-50 text-indigo-600 border border-indigo-200'
                    }`}>
                      <Calendar className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-sm font-sans truncate">{m.title}</span>
                        <span className="text-xs text-blue-500 font-semibold shrink-0">
                          {app?.name ?? (m.applicationId ? 'Deleted application' : 'Specific monitors')} ({m.environment})
                        </span>
                      </div>
                      {m.reason && (
                        <p className={`text-xs font-sans mt-0.5 break-words ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{m.reason}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className={`font-bold text-[10px] uppercase ${statusColor(m.status)}`}>
                      {m.status.replace('_', ' ')}
                    </span>
                    {isOperator && active && !confirming && (
                      <button
                        onClick={() => withBusy(`complete:${m.id}`, () => completeMaintenance(m.id))}
                        disabled={busy !== null}
                        className={secondaryBtn}
                      >
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                        <span>{busy === `complete:${m.id}` ? 'Completing…' : 'Complete now'}</span>
                      </button>
                    )}
                    {isAdmin && !confirming && (
                      <button onClick={() => setConfirmDeleteId(m.id)} disabled={busy !== null} className={`${secondaryBtn} text-rose-500`}>
                        <Trash2 className="w-3 h-3" />
                        <span>Delete</span>
                      </button>
                    )}
                    {isAdmin && confirming && (
                      <>
                        <span className="text-[11px] text-rose-500">Delete this window?</span>
                        <button
                          onClick={() => withBusy(`delete:${m.id}`, async () => { if (await deleteMaintenance(m.id)) setConfirmDeleteId(null); })}
                          disabled={busy !== null}
                          className="px-2.5 py-1 rounded text-[11px] font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white cursor-pointer"
                        >
                          {busy === `delete:${m.id}` ? 'Deleting…' : 'Delete'}
                        </button>
                        <button onClick={() => setConfirmDeleteId(null)} className={secondaryBtn}>Cancel</button>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className={`p-2.5 rounded border ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`}>
                    <span className={`text-[9px] uppercase ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Window</span>
                    <div className={`font-semibold mt-0.5 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                      {fmtDateTime(m.startTime)}
                    </div>
                    <div className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>→ {fmtDateTime(m.endTime)}</div>
                  </div>

                  <div className={`p-2.5 rounded border ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`}>
                    <span className={`text-[9px] uppercase ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Expected Impact</span>
                    <div className={`font-semibold mt-0.5 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{m.expectedImpact || '—'}</div>
                    {m.approvedBy && <div className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Scheduled by {m.approvedBy}</div>}
                  </div>

                  <div className={`p-2.5 rounded border ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`}>
                    <span className={`text-[9px] uppercase flex items-center gap-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                      <BellOff className="w-3 h-3" /> Suppressed Monitors
                    </span>
                    <div className="text-blue-500 font-semibold mt-0.5 break-words">
                      {suppressed.length === 0
                        ? `All ${app?.name ?? ''} ${m.environment} monitors`.replace(/\s+/g, ' ')
                        : `${suppressed.length}: ${suppressedNames.join(', ')}`}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
