import React, { useState } from 'react';
import { IncidentMinutes } from '../ui/IncidentMinutes';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { Incident, IncidentStatus, IncidentSeverity, RootCauseCategory } from '../../types';
import {
  AlertTriangle,
  X,
  CheckCircle2,
  Send,
  Plus,
  UserCheck,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import { IncidentFlowChart } from '../visuals/IncidentFlowChart';
import { IncidentTimelineView } from './IncidentTimelineView';
import { EmptyState } from '../ui/EmptyState';
import { useDialog } from '../ui/useDialog';
import { ROOT_CAUSE_CATEGORIES, ROOT_CAUSE_LABELS } from '../../lib/rootCause';
import { featureAction } from '../../lib/featureAction';
import { useDependencyDemo } from '../../context/DependencyDemoContext';
import { DemoBanner, DemoScenarios, DemoToggle } from '../resilience/DemoModeControls';
import { demoIncident } from '../../mocks/dependencyDemoData';

const SEVERITIES: IncidentSeverity[] = ['INFO', 'WARNING', 'HIGH', 'CRITICAL', 'EMERGENCY'];
const STATUSES: IncidentStatus[] = ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'MITIGATING', 'MONITORING', 'RESOLVED', 'CLOSED'];

const fmtDateTime = (iso?: string) => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '—' : new Date(t).toLocaleString();
};

const isClosed = (inc: Incident) => inc.status === 'RESOLVED' || inc.status === 'CLOSED';

const severityClass = (sev: IncidentSeverity) =>
  sev === 'CRITICAL' || sev === 'EMERGENCY' ? 'text-rose-500 font-bold'
    : sev === 'HIGH' ? 'text-orange-500'
      : sev === 'WARNING' ? 'text-amber-500'
        : 'text-blue-500';

interface IncidentDetailModalProps {
  incident: Incident;
  onClose: () => void;
}

export const IncidentDetailModal: React.FC<IncidentDetailModalProps> = ({ incident, onClose }) => {
  const {
    acknowledgeIncident,
    changeIncidentStatus,
    changeIncidentSeverity,
    assignIncidentOwner,
    addIncidentNote,
    resolveIncident,
    updateIncidentRootCause,
    updateIncidentRunbook,
    setIncidentFixSteps,
    toggleIncidentFixStep,
    refreshIncidentImpact,
    runbooks,
    monitors,
    applications,
    setSelectedRunbookId,
    setActiveTab,
    theme
  } = useOps();
  const { user, canDo } = useAuth();
  const dialog = useDialog(onClose);

  const isDark = theme === 'dark';
  const canAck = canDo('acknowledge_incident');
  const canResolve = canDo('resolve_incident');
  const canNote = canDo('add_note');
  const canAssign = canDo('assign_incident');

  const [activeTab, setActiveTabLocal] = useState<'summary' | 'timeline' | 'signals' | 'correlation' | 'runbook' | 'notes'>('summary');
  const [noteText, setNoteText] = useState('');
  const [resolutionText, setResolutionText] = useState('');
  const [showResolveBox, setShowResolveBox] = useState(false);
  const [showAssignBox, setShowAssignBox] = useState(false);
  const [ownerText, setOwnerText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [causeDraft, setCauseDraft] = useState(incident.rootCause || '');
  const [categoryDraft, setCategoryDraft] = useState<RootCauseCategory>(incident.rootCauseCategory || 'UNKNOWN');
  const [newStepText, setNewStepText] = useState('');
  const [forceResolve, setForceResolve] = useState(false);

  const attachedRunbook = runbooks.find(r => r.id === incident.runbookId);
  const app = applications.find(a => a.id === incident.applicationId);
  const timeline = incident.timeline ?? [];
  const notes = incident.notes ?? [];
  const affectedMonitors = incident.affectedMonitors ?? [];
  const affectedServices = incident.affectedServices ?? [];
  const dependentFailures = incident.dependentFailures ?? [];
  const closed = isClosed(incident);

  const withBusy = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); } finally { setBusy(null); }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    await withBusy('note', async () => {
      if (await addIncidentNote(incident.id, noteText)) setNoteText('');
    });
  };

  const handleResolve = async () => {
    await withBusy('resolve', async () => {
      if (await resolveIncident(incident.id, resolutionText.trim() || undefined, forceResolve || undefined)) {
        setShowResolveBox(false);
        setResolutionText('');
        setForceResolve(false);
      }
    });
  };

  const handleSaveRootCause = async () => {
    await withBusy('root-cause', async () => {
      await updateIncidentRootCause(incident.id, {
        rootCauseCategory: categoryDraft,
        description: causeDraft,
      });
    });
  };

  const handleAddFixStep = async () => {
    const text = newStepText.trim();
    if (!text) return;
    const existing = (incident.fixSteps ?? []).map(s => ({ id: s.id, text: s.text }));
    await withBusy('fix-steps', async () => {
      if (await setIncidentFixSteps(incident.id, [...existing, text])) setNewStepText('');
    });
  };

  const openAssign = () => {
    setOwnerText(user?.displayName || user?.fullName || '');
    setShowAssignBox(true);
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    const owner = ownerText.trim();
    if (!owner) return;
    await withBusy('assign', async () => {
      if (await assignIncidentOwner(incident.id, owner)) setShowAssignBox(false);
    });
  };

  const selectCls = `border rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
    isDark ? 'bg-[#0A0F1A] border-[#1E293B] text-slate-200' : 'bg-white border-slate-300 text-slate-800'
  }`;
  const panelCls = `p-4 rounded border space-y-2 ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`;
  const mutedText = isDark ? 'text-slate-500' : 'text-slate-400';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in" onClick={onClose}>
      <div
        {...dialog}
        aria-labelledby="incident-detail-title"
        className={`w-full max-w-4xl rounded border overflow-hidden flex flex-col max-h-[92vh] shadow-2xl focus:outline-none ${
          isDark ? 'bg-[#101624] text-slate-100 border-[#223048]' : 'bg-white text-slate-900 border-slate-300'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-4 px-4 sm:px-6 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          isDark ? 'border-[#1E293B] bg-[#0A0F1A]' : 'border-slate-200 bg-slate-50'
        }`}>
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 font-mono flex-wrap">
              <span className={`text-sm font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                {incident.id}
              </span>
              <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
              <span className={`text-xs font-bold uppercase ${severityClass(incident.severity)}`}>
                {incident.severity}
              </span>
              <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
              <span className={`text-xs font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                {incident.status}
              </span>
              <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
              <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                {app?.name ?? 'No application'} ({incident.environment})
              </span>
            </div>
            <h2 id="incident-detail-title" className={`text-base font-bold font-sans ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{incident.title}</h2>
            {incident.severityReason && (
              <p className={`text-[11px] font-sans ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Suggested {incident.suggestedSeverity ?? incident.severity}: {incident.severityReason}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 font-mono shrink-0">
            {!incident.acknowledged && !closed && canAck && (
              <button
                onClick={() => withBusy('ack', () => acknowledgeIncident(incident.id))}
                disabled={busy !== null}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-semibold transition-colors cursor-pointer"
              >
                {busy === 'ack' ? 'ACKNOWLEDGING…' : 'ACKNOWLEDGE'}
              </button>
            )}
            {!closed && canResolve && (
              <button
                onClick={() => setShowResolveBox(true)}
                disabled={busy !== null}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-semibold transition-colors cursor-pointer"
              >
                RESOLVE
              </button>
            )}
            <button onClick={onClose} aria-label="Close incident details" title="Close (Esc)" className={`p-1 cursor-pointer ${isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Quick Meta Strip */}
        <div className={`px-4 sm:px-6 py-2 border-b flex flex-wrap items-center justify-between text-xs font-mono gap-2 ${
          isDark ? 'bg-[#0C121E] border-[#1E293B] text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-600'
        }`}>
          <div className="flex flex-wrap items-center gap-4">
            <span>Started: <strong className={isDark ? 'text-slate-200' : 'text-slate-800'}>{fmtDateTime(incident.startedAt)}</strong></span>
            <span>Duration: <strong className={`tabular-nums ${closed ? 'text-emerald-500' : 'text-rose-500'}`}><IncidentMinutes incident={incident} /> min</strong></span>
            <span className="flex items-center gap-1.5">
              Owner:{' '}
              <strong className={incident.owner && incident.owner !== 'Unassigned' ? (isDark ? 'text-slate-200' : 'text-slate-800') : 'text-amber-500'}>
                {incident.owner || 'Unassigned'}
              </strong>
              {canAssign && !closed && (
                <button
                  onClick={openAssign}
                  disabled={busy !== null}
                  className="text-blue-500 hover:underline cursor-pointer disabled:opacity-50"
                >
                  {incident.owner && incident.owner !== 'Unassigned' ? 'reassign' : 'assign'}
                </button>
              )}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5">
              <span>Severity:</span>
              <select
                value={incident.severity}
                disabled={!canAck || busy !== null}
                onChange={e => { const v = e.target.value as IncidentSeverity; void withBusy('severity', () => changeIncidentSeverity(incident.id, v)); }}
                className={selectCls}
              >
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span>Status:</span>
              <select
                value={incident.status}
                disabled={!canAck || busy !== null}
                onChange={e => { const v = e.target.value as IncidentStatus; void withBusy('status', () => changeIncidentStatus(incident.id, v)); }}
                className={selectCls}
              >
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {(busy === 'status' || busy === 'severity') && <span className="text-blue-500">saving…</span>}
          </div>
        </div>

        {/* Assign Box */}
        {showAssignBox && (
          <form onSubmit={handleAssign} className={`p-4 border-b space-y-2 text-xs font-mono ${
            isDark ? 'bg-[#0E1424] border-[#1E293B]' : 'bg-blue-50 border-blue-200'
          }`}>
            <div className="font-bold text-blue-500 flex items-center gap-1.5">
              <UserCheck className="w-4 h-4" />
              <span>Assign incident owner</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                autoFocus
                maxLength={120}
                placeholder="Owner name"
                value={ownerText}
                onChange={e => setOwnerText(e.target.value)}
                className={`flex-1 p-2 border rounded text-xs focus:outline-none ${
                  isDark ? 'bg-[#0A0F1A] border-[#1E293B] text-slate-100' : 'bg-white border-slate-300 text-slate-900'
                }`}
              />
              <button
                type="submit"
                disabled={!ownerText.trim() || busy !== null}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-semibold transition-colors cursor-pointer"
              >
                {busy === 'assign' ? 'Assigning…' : 'Assign'}
              </button>
              <button
                type="button"
                onClick={() => setShowAssignBox(false)}
                className={`px-3 py-1 rounded font-semibold transition-colors cursor-pointer ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                }`}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Resolve Box */}
        {showResolveBox && (
          <div className={`p-4 border-b space-y-2 text-xs font-mono ${
            isDark ? 'bg-[#0E1A14] border-emerald-900/80' : 'bg-emerald-50 border-emerald-200'
          }`}>
            <div className="font-bold text-emerald-600 dark:text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span>Sign off &amp; resolve incident</span>
            </div>
            <p className={`text-[11px] font-sans ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
              Confirm the affected monitors are passing again before signing off. The summary is recorded on the incident timeline and sent to the notification channels.
            </p>
            <input
              type="text"
              placeholder="Resolution summary — what was done to fix it"
              value={resolutionText}
              onChange={e => setResolutionText(e.target.value)}
              className={`w-full p-2 border rounded text-xs focus:outline-none ${
                isDark ? 'bg-[#08100C] border-emerald-800 text-slate-100' : 'bg-white border-emerald-300 text-slate-900'
              }`}
            />
            {(incident.fixSteps ?? []).some(s => !s.completed) && (
              <label className={`flex items-center gap-2 text-[11px] font-sans cursor-pointer ${isDark ? 'text-amber-300' : 'text-amber-800'}`}>
                <input type="checkbox" checked={forceResolve} onChange={e => setForceResolve(e.target.checked)} />
                Force resolve with {(incident.fixSteps ?? []).filter(s => !s.completed).length} open fix step(s)
              </label>
            )}
            <div className="flex items-center gap-2 pt-1 font-sans">
              <button
                onClick={handleResolve}
                disabled={busy !== null}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-semibold transition-colors cursor-pointer"
              >
                {busy === 'resolve' ? 'Resolving…' : 'Sign off & resolve'}
              </button>
              <button
                onClick={() => setShowResolveBox(false)}
                className={`px-3 py-1 rounded font-semibold transition-colors cursor-pointer ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                }`}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className={`flex items-center gap-1 px-4 sm:px-6 border-b text-xs font-mono overflow-x-auto min-w-0 ${
          isDark ? 'border-[#1E293B] bg-[#0C121E]' : 'border-slate-200 bg-slate-100'
        }`}>
          {([
            { id: 'summary', label: 'Summary' },
            { id: 'timeline', label: `Timeline (${timeline.length})` },
            { id: 'signals', label: `Signals & Monitors (${affectedMonitors.length})` },
            { id: 'correlation', label: 'Correlation' },
            { id: 'runbook', label: 'Runbook' },
            { id: 'notes', label: `Notes (${notes.length})` }
          ] as const).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTabLocal(tab.id)}
              className={`py-2 px-2.5 font-medium whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-500 font-semibold'
                  : isDark ? 'border-transparent text-slate-400 hover:text-slate-200' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs font-mono">

          {activeTab === 'summary' && (
            <div className="space-y-4">
              <div className={panelCls}>
                <div className={`text-xs font-bold uppercase ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Root cause</div>
                <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                  <label className={`text-[10px] uppercase shrink-0 ${mutedText}`}>Category</label>
                  <select
                    className={selectCls}
                    value={categoryDraft}
                    disabled={!canAssign || closed || busy !== null}
                    onChange={e => setCategoryDraft(e.target.value as RootCauseCategory)}
                  >
                    {ROOT_CAUSE_CATEGORIES.map(c => (
                      <option key={c} value={c}>{ROOT_CAUSE_LABELS[c]}</option>
                    ))}
                  </select>
                  <span className={`text-[11px] ${mutedText}`}>
                    Current: {ROOT_CAUSE_LABELS[incident.rootCauseCategory || 'UNKNOWN']}
                  </span>
                </div>
                {incident.likelyCause && (
                  <div className={`rounded border p-2 space-y-1 ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
                    <div className={`text-[10px] uppercase ${mutedText}`}>
                      Likely cause · {incident.likelyCause.confidence}
                    </div>
                    <p className={isDark ? 'text-slate-200' : 'text-slate-800'}>{incident.likelyCause.summary}</p>
                    {incident.likelyCause.evidence.length > 0 && (
                      <ul className="space-y-0.5">
                        {incident.likelyCause.evidence.map(item => (
                          <li key={`${item.source}-${item.detail}`} className={mutedText}>
                            {item.source}: {item.detail}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <textarea
                  className={`w-full min-h-[72px] p-2 rounded border text-xs font-sans focus:outline-none focus:border-blue-500 ${
                    isDark ? 'bg-[#0A0F1A] border-[#1E293B] text-slate-200' : 'bg-white border-slate-300 text-slate-800'
                  }`}
                  value={causeDraft}
                  disabled={!canAssign || closed}
                  onChange={e => setCauseDraft(e.target.value)}
                  placeholder="Description and evidence from checks, metrics and logs"
                />
                {canAssign && !closed && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void handleSaveRootCause()}
                    className="px-2.5 py-1 rounded text-[11px] font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white cursor-pointer self-start"
                  >
                    {busy === 'root-cause' ? 'Saving…' : 'Save root cause'}
                  </button>
                )}
                {incident.fingerprint && (
                  <div className={`text-[11px] pt-1 border-t ${isDark ? 'border-[#1E293B] text-slate-400' : 'border-slate-200 text-slate-600'}`}>
                    Deduplication fingerprint: <span className={isDark ? 'text-slate-200' : 'text-slate-800'}>{incident.fingerprint}</span>
                  </div>
                )}
              </div>

              <div className={panelCls}>
                <div className="flex items-center justify-between gap-2">
                  <div className={`text-xs font-bold uppercase ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Impact Analysis</div>
                  {canAssign && (
                    <button
                      type="button"
                      title="Refresh from dependency register"
                      disabled={busy !== null}
                      onClick={() => void withBusy('impact', () => refreshIncidentImpact(incident.id))}
                      className={`p-1 rounded border cursor-pointer disabled:opacity-50 ${isDark ? 'border-[#1E293B] text-slate-300' : 'border-slate-300 text-slate-600'}`}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${busy === 'impact' ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                </div>
                {!incident.impactAnalysis || (!incident.impactAnalysis.componentId && incident.impactAnalysis.hardCount === 0 && incident.impactAnalysis.softCount === 0) ? (
                  <p className={mutedText}>
                    No register match yet. Link this application in Setup → Dependencies, then refresh.
                  </p>
                ) : (
                  <>
                    <p className={isDark ? 'text-slate-300' : 'text-slate-700'}>
                      From <strong>{incident.impactAnalysis.componentName ?? 'register'}</strong>
                      {' · '}hard {incident.impactAnalysis.hardCount} / soft {incident.impactAnalysis.softCount}
                      {incident.impactAnalysis.usersStopped != null && <> · users stopped ≥{incident.impactAnalysis.usersStopped.toLocaleString()}</>}
                      {incident.impactAnalysis.usersAffected != null && incident.impactAnalysis.usersAffected !== incident.impactAnalysis.usersStopped && <> · users affected ≥{incident.impactAnalysis.usersAffected.toLocaleString()}</>}
                      {incident.impactAnalysis.served.length > 0 && <> · {incident.impactAnalysis.served.join(', ')}</>}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <div className={`text-[10px] uppercase ${mutedText}`}>Applications</div>
                        {(incident.impactAnalysis.applications.length === 0)
                          ? <div className={mutedText}>None</div>
                          : incident.impactAnalysis.applications.map(a => (
                            <div key={a.id}>{a.name} <span className={a.via === 'HARD' ? 'text-rose-500' : 'text-amber-500'}>{a.via}</span></div>
                          ))}
                      </div>
                      <div>
                        <div className={`text-[10px] uppercase ${mutedText}`}>Features</div>
                        {(incident.impactAnalysis.features.length === 0)
                          ? <div className={mutedText}>None</div>
                          : incident.impactAnalysis.features.map(f => (
                            <div key={f.id}>
                              {f.name} <span className={f.via === 'HARD' ? 'text-rose-500' : 'text-amber-500'}>{f.via}</span>
                              <div className={mutedText}>{f.action || featureAction(f.name, f.via, incident.impactAnalysis?.componentName || f.name)}</div>
                            </div>
                          ))}
                      </div>
                    </div>
                    {incident.notifiedOwners && incident.notifiedOwners.length > 0 && (
                      <p className={isDark ? 'text-slate-300' : 'text-slate-700'}>
                        Owners notified: {incident.notifiedOwners.join(', ')}
                      </p>
                    )}
                  </>
                )}
                <div className={`text-[11px] space-y-1 break-words ${mutedText}`}>
                  <div>Root provider: {incident.impactAnalysis?.componentName ?? 'Not captured on this incident'}</div>
                  <div>Incident status: {incident.status}. Recovery status: {incident.recoveryStatus || 'Not recorded'}.</div>
                  <div>
                    {incident.resolvedAt
                      ? `Resolved ${fmtDateTime(incident.resolvedAt)}. Closing still follows the existing incident lifecycle.`
                      : 'Not resolved. A provider becoming healthy does not close this incident by itself.'}
                  </div>
                  <div>
                    Dependent rechecks use the triggering monitors
                    {affectedMonitors.length === 0
                      ? ' (none recorded).'
                      : `: ${affectedMonitors.map(id => {
                        const mon = monitors.find(m => m.id === id);
                        return mon ? `${mon.name} ${mon.consecutiveRecoveries}/${mon.recoveryConfirmationThreshold} passes, status ${mon.status}` : id;
                      }).join('; ')}.`}
                  </div>
                  <div>There is no separate feature-verification field. Feature impact is the captured register snapshot, not a new recovery engine.</div>
                </div>
              </div>

              {incident.outage && (
                <div className={panelCls}>
                  <div className={`text-xs font-bold uppercase ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Outage path</div>
                  <p className={isDark ? 'text-slate-300' : 'text-slate-700'}>
                    {incident.outage.probeIntervalSec != null
                      ? `Probe every ${incident.outage.probeIntervalSec}s`
                      : 'Not a timed probe'}
                    {incident.outage.confirmedFailures != null && <> · confirmed after {incident.outage.confirmedFailures} failure{incident.outage.confirmedFailures === 1 ? '' : 's'}</>}
                    {incident.outage.confirmationThreshold != null && <> (threshold {incident.outage.confirmationThreshold})</>}
                  </p>
                  <p className={isDark ? 'text-slate-300' : 'text-slate-700'}>
                    Cloudflare origin: {incident.outage.cloudflareOrigin.replaceAll('_', ' ')}. {incident.outage.cloudflareDetail}
                  </p>
                  <p className={isDark ? 'text-slate-300' : 'text-slate-700'}>
                    DR readiness: {incident.outage.drReadiness.replaceAll('_', ' ')}. {incident.outage.drDetail}
                  </p>
                  <p className={mutedText}>
                    {incident.outage.notified ? 'Notification handed to the channels for this severity.' : 'Notification not sent yet (no channel, or still inside the initial delay).'}
                    {' '}
                    {incident.outage.escalationReady ? 'Escalation is armed while this stays unacknowledged.' : 'No escalation step is armed for this severity.'}
                  </p>
                </div>
              )}

              <div className={panelCls}>
                <div className={`text-xs font-bold uppercase ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  Required action · fix steps
                  {(incident.fixSteps?.length ?? 0) > 0 && (
                    <span className={`ml-2 font-normal normal-case ${mutedText}`}>
                      {(incident.fixSteps ?? []).filter(s => s.completed).length}/{incident.fixSteps!.length} done
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-[11px] ${mutedText}`}>Owner:</span>
                  <strong className={incident.owner && incident.owner !== 'Unassigned' ? (isDark ? 'text-slate-200' : 'text-slate-800') : 'text-amber-500'}>
                    {incident.owner || 'Unassigned'}
                  </strong>
                  <span className={`text-[11px] ${mutedText}`}>· Runbook:</span>
                  <select
                    className={selectCls}
                    value={incident.runbookId || ''}
                    disabled={!canAssign || closed || busy !== null}
                    onChange={e => void withBusy('runbook', () => updateIncidentRunbook(incident.id, e.target.value || null))}
                  >
                    <option value="">None linked</option>
                    {runbooks.map(rb => <option key={rb.id} value={rb.id}>{rb.title}</option>)}
                  </select>
                </div>
                <ul className="space-y-1.5">
                  {(incident.fixSteps ?? []).length === 0 ? (
                    <li className={mutedText}>No fix steps yet. Add the actions required to close this incident.</li>
                  ) : (incident.fixSteps ?? []).map(step => (
                    <li key={step.id} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 cursor-pointer"
                        checked={step.completed}
                        disabled={!canAssign || closed || busy !== null}
                        onChange={() => void withBusy(`step-${step.id}`, () => toggleIncidentFixStep(incident.id, step.id))}
                      />
                      <span className={step.completed ? `line-through ${mutedText}` : (isDark ? 'text-slate-200' : 'text-slate-800')}>
                        {step.text}
                        {step.completed && step.completedBy && (
                          <span className={`ml-1 text-[10px] ${mutedText}`}>· {step.completedBy}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                {canAssign && !closed && (
                  <div className="flex gap-2">
                    <input
                      className={`flex-1 p-1.5 rounded border text-xs focus:outline-none focus:border-blue-500 ${
                        isDark ? 'bg-[#0A0F1A] border-[#1E293B] text-slate-200' : 'bg-white border-slate-300'
                      }`}
                      value={newStepText}
                      onChange={e => setNewStepText(e.target.value)}
                      placeholder="Add a fix step"
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleAddFixStep(); } }}
                    />
                    <button
                      type="button"
                      disabled={!newStepText.trim() || busy !== null}
                      onClick={() => void handleAddFixStep()}
                      className="px-2 py-1 rounded text-[11px] font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>

              {incident.context && (() => {
                const c = incident.context;
                const cfc = c.cloudflare;
                const tri = (v: boolean | null | undefined, y: string, n: string) => (v === true ? y : v === false ? n : 'Unknown');
                const rows: Array<[string, React.ReactNode]> = [
                  ['Application', `${c.application} · ${c.environment}`],
                  ['VPS / IP', `${c.vps ?? '—'} · ${c.ip ?? '—'}`],
                  ['Monitor', `${c.monitor ?? '—'}${c.target ? ` (${c.target})` : ''}`],
                  ['First detected', fmtDateTime(c.firstDetectedAt)],
                  ['Latest detected', fmtDateTime(c.latestDetectedAt)],
                  ['Failure reason', c.failureReason],
                  ['Probe result', c.probeStatus ?? '—'],
                  ['Response code', c.responseCode ?? 'No response'],
                  ['Latency', c.latencyMs === null ? '—' : `${c.latencyMs} ms`],
                  ['Cloudflare pool', cfc ? `${cfc.poolName} · enabled ${tri(cfc.poolEnabled, 'yes', 'no')} · ${tri(cfc.poolHealthy, 'healthy', 'unhealthy')}` : 'Not load-balanced'],
                  ['Cloudflare origin', cfc ? `${cfc.originAddress ?? '—'} · ${tri(cfc.originHealthy, 'healthy', 'unhealthy')}${cfc.originFailureReason ? ` · ${cfc.originFailureReason}` : ''}${cfc.checkedAt ? ` (read ${fmtDateTime(cfc.checkedAt)})` : ''}` : '—'],
                  ['Recovered', c.recoveredAt ? `${fmtDateTime(c.recoveredAt)} · duration ${c.durationMinutes ?? 0} min` : 'Not yet'],
                ];
                return (
                  <div className={panelCls}>
                    <div className={`text-xs font-bold uppercase ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Monitoring facts</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                      {rows.map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <span className={`shrink-0 w-32 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{k}</span>
                          <span className={`break-words ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className={panelCls}>
                <div className={`text-xs font-bold uppercase ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Mitigation</div>
                <p className={`font-sans text-xs ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  {incident.mitigationActionTaken || <span className={mutedText}>No mitigation recorded yet.</span>}
                </p>
                <div className={`p-2.5 rounded text-[11px] border ${isDark ? 'bg-[#111726] border-[#1E293B] text-slate-300' : 'bg-white border-slate-200 text-slate-700 shadow-2xs'}`}>
                  Recovery status: <strong className={isDark ? 'text-slate-100' : 'text-slate-900'}>{incident.recoveryStatus || '—'}</strong>
                </div>
                <div className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Acknowledged: {incident.acknowledged ? `${fmtDateTime(incident.acknowledgedAt)}${incident.acknowledgedBy ? ` by ${incident.acknowledgedBy}` : ''}` : 'Not yet'}
                  {incident.resolvedAt && <> · Resolved: {fmtDateTime(incident.resolvedAt)}</>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className={`p-3 rounded border space-y-1 ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <span className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Affected Services</span>
                  <div className={`space-y-0.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    {affectedServices.length === 0
                      ? <div className={mutedText}>None recorded</div>
                      : affectedServices.map(s => <div key={s}>• {s}</div>)}
                  </div>
                </div>

                <div className={`p-3 rounded border space-y-1 ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <span className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Triggering Monitors</span>
                  <div className={`space-y-0.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    {affectedMonitors.length === 0
                      ? <div className={mutedText}>None (declared manually)</div>
                      : affectedMonitors.map(id => <div key={id}>• {monitors.find(m => m.id === id)?.name ?? id}</div>)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'timeline' && (
            <div className="space-y-3">
              {timeline.length === 0 ? (
                <div className={`p-4 text-center ${mutedText}`}>No timeline events recorded.</div>
              ) : (
                <div className={`border-l ml-2 pl-4 space-y-3.5 ${isDark ? 'border-slate-700' : 'border-slate-300'}`}>
                  {timeline.map((ev, idx) => (
                    <div key={ev.id || idx} className="relative">
                      <span className={`w-1.5 h-1.5 rounded-full absolute -left-[20px] top-1.5 ${
                        ev.level === 'CRITICAL' ? 'bg-rose-500' :
                        ev.level === 'WARN' ? 'bg-amber-400' :
                        ev.level === 'SUCCESS' ? 'bg-emerald-400' :
                        'bg-blue-400'
                      }`} />
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                          {fmtDateTime(ev.timestamp)}
                        </span>
                        {ev.source && (
                          <span className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                            [{ev.source}]
                          </span>
                        )}
                      </div>
                      <div className={`text-xs font-sans mt-0.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                        {ev.message}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'correlation' && (
            <div className={panelCls}>
              <div className={`text-xs font-bold uppercase ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Dependent Failures</div>
              {dependentFailures.length === 0 ? (
                <div className={mutedText}>No correlated dependent failures were recorded for this incident.</div>
              ) : (
                <div className="space-y-2">
                  {dependentFailures.map((dep, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <span className={`w-5 h-5 rounded flex items-center justify-center font-bold text-[10px] ${
                        isDark ? 'bg-[#162033] text-blue-400' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {idx + 1}
                      </span>
                      <span className={`font-sans ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{dep}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'signals' && (
            <div className="space-y-2">
              {affectedMonitors.length === 0 ? (
                <div className={`p-4 text-center ${mutedText}`}>No monitors are linked to this incident.</div>
              ) : affectedMonitors.map(mId => {
                const m = monitors.find(x => x.id === mId);
                const bad = m && (m.status === 'CRITICAL' || m.status === 'WARNING');
                return (
                  <div key={mId} className={`p-3 rounded border flex items-center justify-between gap-3 ${
                    bad
                      ? (isDark ? 'bg-[#180E13] border-rose-900/80' : 'bg-rose-50 border-rose-200')
                      : (isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200')
                  }`}>
                    <div className="min-w-0">
                      <div className={`font-bold truncate ${bad ? (isDark ? 'text-rose-300' : 'text-rose-700') : ''}`}>{m?.name ?? mId}</div>
                      <div className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        {m
                          ? `${m.type} · ${m.target} · consecutive failures ${m.consecutiveFailures}/${m.failureConfirmationThreshold} · last check ${fmtDateTime(m.lastCheck)}`
                          : 'Monitor no longer exists'}
                      </div>
                    </div>
                    <span className={`font-bold text-[10px] shrink-0 ${
                      !m ? mutedText
                        : m.status === 'HEALTHY' ? 'text-emerald-500'
                          : bad ? (isDark ? 'text-rose-400' : 'text-rose-600')
                            : mutedText
                    }`}>
                      {m?.status ?? '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'runbook' && (
            <div className="space-y-3 font-sans">
              {attachedRunbook ? (
                <div className={`p-4 rounded border space-y-3 ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex justify-between items-center gap-3">
                    <div className="min-w-0">
                      <div className={`font-bold text-sm font-mono ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{attachedRunbook.title}</div>
                      <div className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{attachedRunbook.description}</div>
                      <div className={`text-[11px] mt-1 font-mono ${mutedText}`}>
                        {attachedRunbook.steps.filter(s => s.completed).length}/{attachedRunbook.steps.length} steps completed
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        onClose();
                        setSelectedRunbookId(attachedRunbook.id);
                        setActiveTab('runbooks');
                      }}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold font-mono transition-colors shadow-xs cursor-pointer shrink-0"
                    >
                      OPEN RUNBOOK
                    </button>
                  </div>
                </div>
              ) : (
                <div className={`p-4 text-center ${mutedText}`}>
                  No runbook attached. Link a runbook to the triggering monitor so future incidents carry it.
                </div>
              )}
            </div>
          )}

          {activeTab === 'notes' && (
            <div className="space-y-4 font-sans">
              {canNote ? (
                <form onSubmit={handleAddNote} className="space-y-2">
                  <textarea
                    rows={3}
                    placeholder="Record an investigation update or finding..."
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    className={`w-full p-2.5 rounded border text-xs focus:outline-none focus:border-blue-500 font-mono ${
                      isDark ? 'bg-[#0A0F1A] border-[#1E293B] text-slate-200' : 'bg-white border-slate-300 text-slate-900'
                    }`}
                  />
                  <button
                    type="submit"
                    disabled={!noteText.trim() || busy !== null}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-semibold text-xs transition-colors flex items-center gap-1.5 ml-auto cursor-pointer shadow-xs"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{busy === 'note' ? 'Posting…' : 'Post Note'}</span>
                  </button>
                </form>
              ) : (
                <div className={`text-[11px] font-mono ${mutedText}`}>Operators and above can add notes.</div>
              )}

              <div className="space-y-2">
                {notes.length === 0 && <div className={`text-center p-3 font-mono ${mutedText}`}>No notes yet.</div>}
                {notes.map(note => (
                  <div key={note.id} className={`p-3 rounded border space-y-1 ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                    <div className={`flex justify-between items-center text-[10px] font-mono ${mutedText}`}>
                      <span><strong className={isDark ? 'text-slate-300' : 'text-slate-700'}>{note.author}</strong>{note.role ? ` (${note.role})` : ''}</span>
                      <span>{fmtDateTime(note.timestamp)}</span>
                    </div>
                    <p className={`text-xs whitespace-pre-wrap ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{note.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className={`p-3 px-6 border-t flex justify-end ${
          isDark ? 'border-[#1E293B] bg-[#0A0F1A]' : 'border-slate-200 bg-slate-50'
        }`}>
          <button
            onClick={onClose}
            className={`px-3 py-1 rounded text-xs font-mono transition-colors border cursor-pointer ${
              isDark
                ? 'bg-[#1A2436] hover:bg-[#23324C] border-[#223048] text-slate-200'
                : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700 shadow-2xs'
            }`}
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
};

const DeclareIncidentModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { createIncident, applications, setSelectedIncidentId, theme } = useOps();
  const isDark = theme === 'dark';
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('HIGH');
  const [applicationId, setApplicationId] = useState('');
  const [environment, setEnvironment] = useState<'PRD' | 'DR'>('PRD');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const dialog = useDialog(onClose);

  const inputCls = `w-full p-2 border rounded text-xs font-mono focus:outline-none focus:border-blue-500 ${
    isDark ? 'bg-[#0A0F1A] border-[#1E293B] text-slate-100' : 'bg-white border-slate-300 text-slate-900'
  }`;
  const labelCls = `block text-[10px] uppercase font-semibold mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const inc = await createIncident({
        title: title.trim(),
        severity,
        applicationId: applicationId || undefined,
        environment,
        description: description.trim() || undefined,
      });
      if (inc) {
        onClose();
        setSelectedIncidentId(inc.id);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto" onClick={onClose}>
      <form
        {...dialog}
        aria-labelledby="declare-incident-title"
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className={`w-full max-w-lg rounded border shadow-2xl p-5 space-y-4 font-mono text-xs focus:outline-none ${
          isDark ? 'bg-[#101624] text-slate-100 border-[#223048]' : 'bg-white text-slate-900 border-slate-300'
        }`}
      >
        <div className="flex items-center justify-between">
          <h2 id="declare-incident-title" className="text-sm font-bold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-500" aria-hidden="true" />
            DECLARE INCIDENT
          </h2>
          <button type="button" onClick={onClose} aria-label="Close declare incident" title="Close (Esc)" className={`p-1 cursor-pointer ${isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <p className={`font-sans text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          Open an incident manually for a problem the monitors have not detected. Notification channels are alerted according to the escalation policy for the chosen severity.
        </p>

        <div>
          <label className={labelCls}>Title *</label>
          <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required autoFocus placeholder="Short description of the problem" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Severity</label>
            <select className={inputCls} value={severity} onChange={e => setSeverity(e.target.value as IncidentSeverity)}>
              {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Application</label>
            <select className={inputCls} value={applicationId} onChange={e => setApplicationId(e.target.value)}>
              <option value="">— None —</option>
              {applications.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Environment</label>
            <select className={inputCls} value={environment} onChange={e => setEnvironment(e.target.value as 'PRD' | 'DR')}>
              <option value="PRD">PRD</option>
              <option value="DR">DR</option>
            </select>
          </div>
        </div>

        <div>
          <label className={labelCls}>Description</label>
          <textarea className={inputCls} rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="What is happening, who is affected, what has been tried" />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={`px-3 py-1.5 rounded font-semibold cursor-pointer ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || saving}
            className="px-3 py-1.5 rounded font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer"
          >
            {saving ? 'Declaring…' : 'Declare incident'}
          </button>
        </div>
      </form>
    </div>
  );
};

export const IncidentsView: React.FC = () => {
  const { incidents, selectedIncidentId, setSelectedIncidentId, applications, theme } = useOps();
  const { hasRole } = useAuth();
  const demo = useDependencyDemo();
  const isDark = theme === 'dark';
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'CRITICAL' | 'RESOLVED'>('ALL');
  const [showDeclare, setShowDeclare] = useState(false);

  const selectedIncident = incidents.find(i => i.id === selectedIncidentId);

  const filteredIncidents = incidents.filter(inc => {
    if (filter === 'OPEN') return !isClosed(inc);
    if (filter === 'CRITICAL') return inc.severity === 'CRITICAL' || inc.severity === 'EMERGENCY';
    if (filter === 'RESOLVED') return isClosed(inc);
    return true;
  });

  if (demo.enabled) {
    const picture = demo.scenario ? demoIncident(demo.scenario) : null;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-bold font-mono">INCIDENT COMMAND WORKSPACE</h1>
          <DemoToggle isDark={isDark} />
        </div>
        <DemoBanner />
        <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          HYPOTHETICAL SIMULATION. This is not a confirmed live incident. Live incidents are hidden until DEMO mode is off. Nothing is created or resolved.
        </p>
        <div className={`rounded-lg p-3 ${isDark ? 'bg-slate-950' : 'bg-slate-900'}`}>
          <DemoScenarios />
        </div>
        {!picture && <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Select a scenario to see an illustrative blast radius.</p>}
        {picture && (
          <article className={`rounded border p-4 space-y-2 text-xs font-mono ${isDark ? 'border-violet-800 bg-[#111726]' : 'border-violet-300 bg-white'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-violet-600 text-white text-[10px] font-bold">DEMO</span>
              <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>{picture.id}</span>
            </div>
            <h2 className="text-base font-bold font-sans">{picture.title}</h2>
            <div>Root provider: {picture.simulation.rootName}</div>
            <div>Detection time: {fmtDateTime(picture.detectedAt)}</div>
            <div>Direct {picture.simulation.direct.length} · indirect {picture.simulation.indirect.length} · applications {picture.simulation.affectedApplications}</div>
            <div>Recovery status: {picture.recovery}</div>
            <ul className="space-y-1">
              {picture.timeline.map(event => <li key={event.at}>{event.at} · {event.text}</li>)}
            </ul>
          </article>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {selectedIncident && (
        <IncidentDetailModal
          incident={selectedIncident}
          onClose={() => setSelectedIncidentId(null)}
        />
      )}
      {showDeclare && <DeclareIncidentModal onClose={() => setShowDeclare(false)} />}

      {/* Header */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            INCIDENT COMMAND WORKSPACE
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Incidents opened by confirmed monitor failures or declared by operators
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className={`flex items-center gap-1 p-0.5 rounded border text-xs font-mono ${
            isDark ? 'bg-[#0B0F17] border-[#1E293B]' : 'bg-slate-100 border-slate-300'
          }`}>
            {(['ALL', 'OPEN', 'CRITICAL', 'RESOLVED'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  filter === f
                    ? 'bg-blue-600 text-white font-medium shadow-xs'
                    : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          {hasRole('operator') && (
            <button
              onClick={() => setShowDeclare(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Declare incident</span>
            </button>
          )}
        </div>
      </div>

      {incidents.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No incidents recorded"
          description="Incidents open automatically when a monitor confirms consecutive failures, or an operator can declare one manually."
        />
      ) : (
        <>
          <IncidentTimelineView onSelectIncident={(id) => setSelectedIncidentId(id)} />

          <IncidentFlowChart />

          <div className={`rounded-lg border overflow-hidden transition-colors ${
            isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
          }`}>
            {filteredIncidents.length === 0 ? (
              <div className={`p-8 text-center text-xs font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                No incidents match the {filter} filter.
              </div>
            ) : (
              <div className="w-full min-w-0 overflow-x-auto">
                <table className="w-full text-left text-xs font-mono min-w-[760px]">
                  <thead className={`font-medium border-b ${
                    isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}>
                    <tr>
                      <th className="py-2.5 px-3.5">ID</th>
                      <th className="py-2.5 px-3.5">Severity</th>
                      <th className="py-2.5 px-3.5">Status</th>
                      <th className="py-2.5 px-3.5">Title &amp; Detail</th>
                      <th className="py-2.5 px-3.5">Workload</th>
                      <th className="py-2.5 px-3.5">Duration</th>
                      <th className="py-2.5 px-3.5">Owner</th>
                      <th className="py-2.5 px-3.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
                    {filteredIncidents.map(inc => {
                      const app = applications.find(a => a.id === inc.applicationId);
                      const isCrit = (inc.severity === 'CRITICAL' || inc.severity === 'EMERGENCY') && !isClosed(inc);
                      const unassigned = !inc.owner || inc.owner === 'Unassigned';

                      return (
                        <tr
                          key={inc.id}
                          onClick={() => setSelectedIncidentId(inc.id)}
                          className={`cursor-pointer transition-colors ${
                            isCrit
                              ? (isDark ? 'bg-[#180E13]' : 'bg-rose-50/60')
                              : (isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50')
                          }`}
                        >
                          <td className="py-2.5 px-3.5 font-bold">{inc.id}</td>
                          <td className="py-2.5 px-3.5">
                            <span className={`font-semibold ${severityClass(inc.severity)}`}>{inc.severity}</span>
                          </td>
                          <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{inc.status}</td>
                          <td className="py-2.5 px-3.5 font-sans max-w-md">
                            <div className="font-semibold">{inc.title}</div>
                            {inc.rootCause && (
                              <div className={`text-[11px] truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{inc.rootCause}</div>
                            )}
                          </td>
                          <td className={`py-2.5 px-3.5 font-sans font-medium ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                            {app?.name ?? '—'} ({inc.environment})
                          </td>
                          <td className={`py-2.5 px-3.5 tabular-nums ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                            <IncidentMinutes incident={inc} /> min
                          </td>
                          <td className={`py-2.5 px-3.5 font-sans ${unassigned ? 'text-amber-500' : isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                            {inc.owner || 'Unassigned'}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-sans">
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                setSelectedIncidentId(inc.id);
                              }}
                              className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors border cursor-pointer ${
                                isDark
                                  ? 'text-slate-300 hover:text-white hover:bg-[#1D2B44] border-[#23334E]'
                                  : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100 border-slate-300'
                              }`}
                            >
                              INSPECT
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
        </>
      )}
    </div>
  );
};
