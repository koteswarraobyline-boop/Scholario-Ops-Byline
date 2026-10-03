import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { Incident, IncidentStatus, IncidentSeverity } from '../../types';
import { 
  AlertTriangle, 
  X, 
  CheckCircle2, 
  Send, 
  ArrowRight
} from 'lucide-react';
import { IncidentFlowChart } from '../visuals/IncidentFlowChart';

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
    runbooks,
    setSelectedRunbookId,
    setActiveTab
  } = useOps();

  const [activeTab, setActiveTabLocal] = useState<'summary' | 'timeline' | 'signals' | 'correlation' | 'communications' | 'runbook' | 'notes'>('summary');
  const [noteText, setNoteText] = useState('');
  const [resolutionText, setResolutionText] = useState('');
  const [showResolveBox, setShowResolveBox] = useState(false);

  const attachedRunbook = runbooks.find(r => r.id === incident.runbookId);

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    addIncidentNote(incident.id, noteText);
    setNoteText('');
  };

  const handleResolve = () => {
    resolveIncident(incident.id, resolutionText);
    setShowResolveBox(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in">
      <div 
        className="w-full max-w-4xl bg-[#101624] text-slate-100 rounded border border-[#223048] overflow-hidden flex flex-col max-h-[92vh] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 px-6 border-b border-[#1E293B] bg-[#0A0F1A] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-mono">
              <span className="text-sm font-bold text-slate-100">
                {incident.id}
              </span>
              <span className="text-slate-600">·</span>
              <span className={`text-xs font-bold uppercase ${
                incident.severity === 'CRITICAL' ? 'text-rose-400' : 'text-amber-400'
              }`}>
                {incident.severity}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-xs text-slate-400 font-semibold">
                {incident.status}
              </span>
            </div>
            <h2 className="text-base font-bold text-slate-100 font-sans">{incident.title}</h2>
          </div>

          <div className="flex items-center gap-2 font-mono">
            {!incident.acknowledged && (
              <button
                onClick={() => acknowledgeIncident(incident.id)}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold transition-colors"
              >
                ACKNOWLEDGE
              </button>
            )}
            {incident.status !== 'RESOLVED' && (
              <button
                onClick={() => setShowResolveBox(true)}
                className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold transition-colors"
              >
                RESOLVE
              </button>
            )}
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Quick Meta Strip */}
        <div className="px-6 py-2 bg-[#0C121E] border-b border-[#1E293B] flex flex-wrap items-center justify-between text-xs text-slate-400 font-mono gap-2">
          <div className="flex items-center gap-4">
            <span>Started: <strong className="text-slate-200">{new Date(incident.startedAt).toLocaleTimeString()}</strong></span>
            <span>Duration: <strong className="text-rose-400 tabular-nums">{incident.durationMinutes} min</strong></span>
            <span>Owner: <strong className="text-slate-200">{incident.owner}</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <span>Status:</span>
            <select
              value={incident.status}
              onChange={e => changeIncidentStatus(incident.id, e.target.value as IncidentStatus)}
              className="bg-[#0A0F1A] border border-[#1E293B] rounded px-1.5 py-0.5 text-xs text-slate-200 font-mono focus:outline-none"
            >
              <option value="OPEN">OPEN</option>
              <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
              <option value="INVESTIGATING">INVESTIGATING</option>
              <option value="MITIGATING">MITIGATING</option>
              <option value="MONITORING">MONITORING</option>
              <option value="RESOLVED">RESOLVED</option>
            </select>
          </div>
        </div>

        {/* Resolve Box */}
        {showResolveBox && (
          <div className="p-4 bg-[#0E1A14] border-b border-emerald-900/80 space-y-2 text-xs font-mono">
            <div className="font-bold text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Sign Off &amp; Confirm Incident Resolution</span>
            </div>
            <p className="text-[11px] text-slate-300 font-sans">
              Verify root cause mitigation and ensure 3 consecutive monitor passes have passed.
            </p>
            <input
              type="text"
              placeholder="Resolution summary (e.g. Killed rogue report query PID 2841, 3/3 health checks verified)..."
              value={resolutionText}
              onChange={e => setResolutionText(e.target.value)}
              className="w-full p-2 bg-[#08100C] border border-emerald-800 rounded text-xs text-slate-100 focus:outline-none"
            />
            <div className="flex items-center gap-2 pt-1 font-sans">
              <button
                onClick={handleResolve}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-semibold transition-colors"
              >
                Sign Off &amp; Close Incident
              </button>
              <button
                onClick={() => setShowResolveBox(false)}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 border-b border-[#1E293B] bg-[#0C121E] text-xs font-mono overflow-x-auto">
          {[
            { id: 'summary', label: 'Summary' },
            { id: 'timeline', label: `Timeline (${incident.timeline.length})` },
            { id: 'signals', label: 'Signals & Monitors' },
            { id: 'correlation', label: 'Correlation & Blast Radius' },
            { id: 'communications', label: 'Communications' },
            { id: 'runbook', label: 'Runbook' },
            { id: 'notes', label: `Investigation Notes (${incident.notes.length})` }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTabLocal(tab.id as any)}
              className={`py-2 px-2.5 font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs font-mono">
          
          {/* TAB: SUMMARY */}
          {activeTab === 'summary' && (
            <div className="space-y-4">
              <div className="p-4 bg-[#0A0F1A] border border-[#1E293B] rounded space-y-2">
                <div className="text-xs font-bold text-slate-300 uppercase">Root Cause Diagnosis</div>
                <p className="text-slate-300 leading-relaxed font-sans text-xs">{incident.rootCause}</p>
                <div className="text-[11px] text-slate-400 pt-1 border-t border-[#1E293B]">
                  Deduplication Fingerprint: <span className="text-slate-200">{incident.fingerprint}</span>
                </div>
              </div>

              <div className="p-4 bg-[#0A0F1A] border border-[#1E293B] rounded space-y-2">
                <div className="text-xs font-bold text-slate-300 uppercase">Current Mitigation State</div>
                <p className="text-slate-300 font-sans text-xs">
                  {incident.mitigationActionTaken || 'Investigating thread locks and database connection spikes.'}
                </p>
                <div className="p-2.5 bg-[#111726] border border-[#1E293B] rounded text-slate-300 text-[11px]">
                  Recovery Verification: <strong className="text-slate-100">{incident.recoveryStatus}</strong>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 bg-[#0A0F1A] border border-[#1E293B] rounded space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase">Affected Workloads</span>
                  <div className="space-y-0.5 text-slate-300">
                    {incident.affectedServices.map(s => <div key={s}>• {s}</div>)}
                  </div>
                </div>

                <div className="p-3 bg-[#0A0F1A] border border-[#1E293B] rounded space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase">Triggering Probes</span>
                  <div className="space-y-0.5 text-slate-300">
                    {incident.affectedMonitors.map(m => <div key={m}>• {m}</div>)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: TIMELINE */}
          {activeTab === 'timeline' && (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-slate-300 font-sans">
                Timestamped Micro-Event Sequence
              </div>
              <div className="border-l border-slate-700 ml-2 pl-4 space-y-3.5">
                {incident.timeline.map((ev, idx) => (
                  <div key={ev.id || idx} className="relative">
                    <span className={`w-1.5 h-1.5 rounded-full absolute -left-[20px] top-1.5 ${
                      ev.level === 'CRITICAL' ? 'bg-rose-500' :
                      ev.level === 'WARN' ? 'bg-amber-400' :
                      ev.level === 'SUCCESS' ? 'bg-emerald-400' :
                      'bg-blue-400'
                    }`} />
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-200">
                        {new Date(ev.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        [{ev.source}]
                      </span>
                    </div>
                    <div className="text-xs text-slate-300 font-sans mt-0.5">
                      {ev.message}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB: CORRELATION */}
          {activeTab === 'correlation' && (
            <div className="space-y-4">
              <div className="p-4 bg-[#0A0F1A] border border-[#1E293B] rounded space-y-3">
                <div className="text-xs font-bold text-slate-300 uppercase">Dependency Correlation Flow</div>
                <div className="space-y-2">
                  {incident.dependentFailures.map((dep, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <span className="w-5 h-5 rounded bg-[#162033] text-blue-400 flex items-center justify-center font-bold text-[10px]">
                        {idx + 1}
                      </span>
                      <span className="text-slate-300 font-sans">{dep}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB: SIGNALS */}
          {activeTab === 'signals' && (
            <div className="space-y-2">
              {incident.affectedMonitors.map(mId => (
                <div key={mId} className="p-3 bg-[#180E13] border border-rose-900/80 rounded flex items-center justify-between">
                  <div>
                    <div className="font-bold text-rose-300">{mId}</div>
                    <div className="text-[11px] text-slate-400">Consecutive failures: 3 / 3 (Confirmed incident threshold)</div>
                  </div>
                  <span className="text-rose-400 font-bold text-[10px]">
                    CRITICAL
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* TAB: COMMUNICATIONS */}
          {activeTab === 'communications' && (
            <div className="space-y-3 font-sans">
              <div className="p-3 bg-[#0A0F1A] border border-[#1E293B] rounded space-y-1">
                <div className="flex justify-between items-center text-slate-200 font-semibold font-mono text-xs">
                  <span>Microsoft Teams (#ops-incidents)</span>
                  <span className="text-emerald-400 text-[10px]">DELIVERED</span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  Alert payload dispatched to engineering webhook immediately upon failure confirmation.
                </p>
              </div>

              <div className="p-3 bg-[#0A0F1A] border border-[#1E293B] rounded space-y-1">
                <div className="flex justify-between items-center text-slate-200 font-semibold font-mono text-xs">
                  <span>Email oncall@scholario.net</span>
                  <span className="text-emerald-400 text-[10px]">DELIVERED</span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  Paging email sent to active on-call rotation lead.
                </p>
              </div>
            </div>
          )}

          {/* TAB: RUNBOOK */}
          {activeTab === 'runbook' && (
            <div className="space-y-3 font-sans">
              {attachedRunbook ? (
                <div className="p-4 bg-[#0A0F1A] border border-[#1E293B] rounded space-y-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-bold text-slate-100 text-sm font-mono">{attachedRunbook.title}</div>
                      <div className="text-slate-400 text-xs mt-0.5">{attachedRunbook.description}</div>
                    </div>
                    <button
                      onClick={() => {
                        onClose();
                        setSelectedRunbookId(attachedRunbook.id);
                        setActiveTab('runbooks');
                      }}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold font-mono transition-colors"
                    >
                      OPEN RUNBOOK
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 text-center text-slate-500">No automated runbook attached.</div>
              )}
            </div>
          )}

          {/* TAB: NOTES */}
          {activeTab === 'notes' && (
            <div className="space-y-4 font-sans">
              <form onSubmit={handleAddNote} className="space-y-2">
                <textarea
                  rows={3}
                  placeholder="Record investigation update or diagnostic finding..."
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  className="w-full p-2.5 bg-[#0A0F1A] border border-[#1E293B] rounded text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
                />
                <button
                  type="submit"
                  disabled={!noteText.trim()}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded font-semibold text-xs transition-colors flex items-center gap-1.5 ml-auto"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Post Note</span>
                </button>
              </form>

              <div className="space-y-2">
                {incident.notes.map(note => (
                  <div key={note.id} className="p-3 bg-[#0A0F1A] border border-[#1E293B] rounded space-y-1">
                    <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                      <span><strong className="text-slate-300">{note.author}</strong> ({note.role})</span>
                      <span>{new Date(note.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-slate-300 text-xs">{note.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-3 px-6 border-t border-[#1E293B] bg-[#0A0F1A] flex justify-end">
          <button onClick={onClose} className="px-3 py-1 bg-[#1A2436] hover:bg-[#23324C] text-slate-200 rounded text-xs font-mono transition-colors">
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
};

export const IncidentsView: React.FC = () => {
  const { incidents, selectedIncidentId, setSelectedIncidentId, applications, theme } = useOps();
  const isDark = theme === 'dark';
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'CRITICAL' | 'RESOLVED'>('ALL');

  const selectedIncident = incidents.find(i => i.id === selectedIncidentId);

  const filteredIncidents = incidents.filter(inc => {
    if (filter === 'OPEN') return inc.status !== 'RESOLVED' && inc.status !== 'CLOSED';
    if (filter === 'CRITICAL') return inc.severity === 'CRITICAL';
    if (filter === 'RESOLVED') return inc.status === 'RESOLVED' || inc.status === 'CLOSED';
    return true;
  });

  return (
    <div className="space-y-6">
      {selectedIncident && (
        <IncidentDetailModal
          incident={selectedIncident}
          onClose={() => setSelectedIncidentId(null)}
        />
      )}

      {/* Header */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            INCIDENT COMMAND WORKSPACE
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Consecutive failure-confirmed incidents, blast radius correlation &amp; mitigation timelines
          </p>
        </div>

        {/* Filter */}
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
      </div>

      {/* Active Incident Mitigation State Machine Flowchart */}
      <IncidentFlowChart />

      {/* Incidents Table */}
      <div className={`rounded-lg border overflow-hidden transition-colors ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className={`font-medium border-b ${
              isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}>
              <tr>
                <th className="py-2.5 px-3.5">ID</th>
                <th className="py-2.5 px-3.5">Severity</th>
                <th className="py-2.5 px-3.5">Status</th>
                <th className="py-2.5 px-3.5">Title &amp; Root Cause Diagnosis</th>
                <th className="py-2.5 px-3.5">Workload</th>
                <th className="py-2.5 px-3.5">Duration</th>
                <th className="py-2.5 px-3.5">Owner</th>
                <th className="py-2.5 px-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
              {filteredIncidents.map(inc => {
                const app = applications.find(a => a.id === inc.applicationId);
                const isCrit = inc.severity === 'CRITICAL' && inc.status !== 'RESOLVED';

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
                    <td className="py-2.5 px-3.5 font-bold">
                      {inc.id}
                    </td>

                    <td className="py-2.5 px-3.5">
                      <span className={`font-semibold ${
                        inc.severity === 'CRITICAL' ? 'text-rose-500 font-bold' : 'text-amber-500'
                      }`}>
                        {inc.severity}
                      </span>
                    </td>

                    <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                      {inc.status}
                    </td>

                    <td className="py-2.5 px-3.5 font-sans max-w-md">
                      <div className="font-semibold">{inc.title}</div>
                      <div className={`text-[11px] truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{inc.rootCause}</div>
                    </td>

                    <td className={`py-2.5 px-3.5 font-sans font-medium ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                      {app?.name} ({inc.environment})
                    </td>

                    <td className={`py-2.5 px-3.5 tabular-nums ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                      {inc.durationMinutes} min
                    </td>

                    <td className={`py-2.5 px-3.5 font-sans ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                      {inc.owner}
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
      </div>
    </div>
  );
};
