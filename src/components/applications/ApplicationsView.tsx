import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import { LbFailoverConsole } from '../resilience/LbFailoverConsole';
import { useAuth } from '../../context/AuthContext';
import { Application, Monitor, OperationalStatus, VpsServer } from '../../types';
import { X, AlertTriangle, ArrowRight, Plus, Layers, Loader2, Pencil, Trash2 } from 'lucide-react';
import { AppEditor } from '../setup/SetupView';
import { HealthDimensions } from './HealthDimensions';
import { effectiveRoutingMethod, explainVps, ROUTING_METHOD_LABELS } from '../../lib/trafficHealth';
import { registerLinks, statusCause } from '../../lib/statusCause';
import { dnsPointsAt, routeState, servingLabel } from '../ui/routing';
import { MonitorFormModal } from '../monitors/CreateMonitorModal';
import { EmptyState } from '../ui/EmptyState';
import { useDialog } from '../ui/useDialog';

// ── Formatting helpers (null-safe) ──────────────────────────────────────────
const fmtPct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(2)}%`);
const fmtMs = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v)}ms`);
const fmtLag = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v}s`);
const validDate = (s?: string | null) => Boolean(s) && !Number.isNaN(Date.parse(s as string));
const fmtDateTime = (s?: string | null, fallback = '—') => (validDate(s) ? new Date(s as string).toLocaleString() : fallback);
const fmtTime = (s?: string | null, fallback = '—') => (validDate(s) ? new Date(s as string).toLocaleTimeString() : fallback);

const statusColor = (s: OperationalStatus | string) =>
  s === 'HEALTHY' ? 'text-emerald-500'
    : s === 'WARNING' || s === 'STALE' ? 'text-amber-500'
      : s === 'CRITICAL' ? 'text-rose-500'
        : s === 'MAINTENANCE' ? 'text-blue-500'
          : 'text-slate-400';

const statusDot = (s: OperationalStatus | string) =>
  s === 'HEALTHY' ? 'bg-emerald-500'
    : s === 'WARNING' || s === 'STALE' ? 'bg-amber-500'
      : s === 'CRITICAL' ? 'bg-rose-500 animate-pulse'
        : s === 'MAINTENANCE' ? 'bg-blue-500'
          : 'bg-slate-500';

interface ApplicationDetailModalProps {
  application: Application;
  onClose: () => void;
}

export const ApplicationDetailModal: React.FC<ApplicationDetailModalProps> = ({ application, onClose }) => {
  const {
    servers,
    monitors,
    incidents,
    backups,
    deployments,
    auditLogs,
    triggerFailover,
    cloudflareZones,
    loadBalancer,
    integrations,
    workerMonitor,
    setSelectedIncidentId,
    setActiveTab,
    openAddMonitorWithContext,
    deleteMonitor,
    deleteApplication,
    theme,
  } = useOps();
  const { hasRole, canDo } = useAuth();
  const navigate = useNavigate();
  const dialog = useDialog(onClose);

  const isDark = theme === 'dark';
  const canFailover = hasRole('super_admin');
  const canAddMonitor = canDo('create_monitor');
  const canEditApp = canDo('update_application');
  const canDeleteApp = canDo('delete_application');
  const canEditMonitor = canDo('update_monitor');
  const canDeleteMonitor = canDo('delete_monitor');

  const [activeTab, setActiveTabLocal] = useState<'overview' | 'health' | 'monitors' | 'infra' | 'deps' | 'dr' | 'backups' | 'incidents' | 'deployments' | 'history'>('overview');
  const [confirmFailover, setConfirmFailover] = useState(false);
  const [failoverReason, setFailoverReason] = useState('');
  const [failoverBusy, setFailoverBusy] = useState(false);
  const [editingApp, setEditingApp] = useState(false);
  const [confirmDeleteApp, setConfirmDeleteApp] = useState(false);
  const [deletingApp, setDeletingApp] = useState(false);
  const [editingMonitor, setEditingMonitor] = useState<Monitor | null>(null);
  const [confirmDeleteMonitor, setConfirmDeleteMonitor] = useState<string | null>(null);
  const [deletingMonitor, setDeletingMonitor] = useState<string | null>(null);

  const prdServer = servers.find(s => s.id === application.prdServerId);
  const drServer = servers.find(s => s.id === application.drServerId);
  const appMonitors = monitors.filter(m => m.applicationId === application.id);
  const appIncidents = incidents.filter(i => i.applicationId === application.id);
  const appBackups = backups.filter(b => b.applicationId === application.id);
  const appDeployments = deployments.filter(d => d.applicationId === application.id);
  const appAudits = auditLogs.filter(a => a.targetId === application.id);

  const route = routeState(application, loadBalancer, dnsPointsAt(application, servers, cloudflareZones));
  const isDrActive = route === 'DR';
  const isFailingOver = route === 'MOVING' || application.failoverState === 'FAILING_OVER';
  const failoverTarget: 'DR' | 'PRIMARY' = isDrActive ? 'PRIMARY' : 'DR';
  const targetServer = failoverTarget === 'DR' ? drServer : prdServer;
  const failoverBlockers: string[] = [];
  if (!application.cloudflareZone) failoverBlockers.push('No Cloudflare zone configured');
  if (!application.dnsRecordName) failoverBlockers.push('No DNS record configured');
  if (!targetServer) failoverBlockers.push(`No ${failoverTarget === 'DR' ? 'DR' : 'PRD'} server linked`);
  else if (!targetServer.ip) failoverBlockers.push(`${failoverTarget === 'DR' ? 'DR' : 'PRD'} server has no IP`);

  const handleFailover = async () => {
    setFailoverBusy(true);
    try {
      const ok = await triggerFailover(application.id, failoverTarget, failoverReason.trim() || undefined);
      if (ok) {
        setConfirmFailover(false);
        setFailoverReason('');
      }
    } finally {
      setFailoverBusy(false);
    }
  };

  const card = `p-3 rounded border ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`;
  const label = `text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`;
  const value = `text-base font-bold tabular-nums ${isDark ? 'text-slate-100' : 'text-slate-900'}`;
  const muted = isDark ? 'text-slate-400' : 'text-slate-600';
  const emptyText = `p-4 text-center font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`;

  const renderServerCard = (srv: VpsServer | undefined, env: 'PRD' | 'DR') => (
    <div className={`p-3 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
      <span className={`text-[10px] font-semibold uppercase ${env === 'PRD' ? 'text-blue-500' : (isDark ? 'text-slate-400' : 'text-slate-500')}`}>
        {env === 'PRD' ? 'PRIMARY (PRD)' : 'STANDBY (DR)'}
      </span>
      {srv ? (
        <>
          <div className={`font-semibold mt-1 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{srv.hostname}</div>
          <div className={`text-[11px] ${muted}`}>{srv.ip || 'No IP'}{srv.region ? ` · ${srv.region}` : ''}</div>
          <div className={`text-[10px] mt-0.5 ${statusColor(explainVps(srv).status)}`}>VPS {explainVps(srv).status.replace(/_/g, ' ')} · agent {srv.lastSeen ? srv.agentStatus : 'NOT CONNECTED'}</div>
          <div className={`text-[10px] mt-0.5 font-sans ${muted}`}>{explainVps(srv).detail}</div>
        </>
      ) : (
        <div className={`mt-1 text-[11px] italic ${muted}`}>No {env} server linked — configure it in Setup</div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in">
      <div
        {...dialog}
        aria-labelledby="application-detail-title"
        className={`w-full max-w-4xl rounded border overflow-hidden flex flex-col max-h-[90vh] shadow-2xl focus:outline-none ${
          isDark ? 'bg-[#101624] text-slate-100 border-[#223048]' : 'bg-white text-slate-900 border-slate-300'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className={`p-4 px-4 sm:px-6 border-b flex items-center justify-between ${
          isDark ? 'border-[#1E293B] bg-[#0A0F1A]' : 'border-slate-200 bg-slate-50'
        }`}>
          <div className="flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full ${statusDot(application.status)}`} />
            <div>
              <div className="flex items-center gap-2 font-mono">
                <h2 id="application-detail-title" className={`text-base font-bold font-sans ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{application.name}</h2>
                <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>· {application.tier.replace('_', ' ')}</span>
                <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
                <span className={`text-xs font-semibold ${statusColor(application.status)}`}>{application.status}</span>
              </div>
              {application.description && (
                <p className={`text-xs font-sans mt-0.5 ${muted}`}>{application.description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Checked {fmtTime(application.lastChecked, 'never')}
            </span>
            {canEditApp && (
              <button
                type="button"
                onClick={() => setEditingApp(true)}
                className={`px-2 py-1 rounded text-[11px] font-mono border cursor-pointer inline-flex items-center gap-1 ${isDark ? 'border-[#223048] text-slate-200 hover:bg-[#1A2436]' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`}
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
            )}
            {canDeleteApp && (
              confirmDeleteApp ? (
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    disabled={deletingApp}
                    onClick={async () => {
                      setDeletingApp(true);
                      const ok = await deleteApplication(application.id);
                      setDeletingApp(false);
                      if (ok) onClose();
                    }}
                    className="px-2 py-1 rounded text-[11px] font-semibold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer disabled:opacity-60"
                  >
                    {deletingApp ? 'Deleting…' : 'Delete'}
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteApp(false)} className={`px-2 py-1 rounded text-[11px] cursor-pointer ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>Cancel</button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteApp(true)}
                  className="px-2 py-1 rounded text-[11px] font-mono border border-rose-800/40 text-rose-500 hover:bg-rose-950/30 cursor-pointer inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              )
            )}
            <button
              onClick={onClose}
              aria-label="Close application details"
              title="Close (Esc)"
              className={`p-1 transition-colors cursor-pointer ${isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'}`}
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className={`flex items-center gap-1 px-4 sm:px-6 border-b overflow-x-auto min-w-0 text-xs font-mono ${
          isDark ? 'border-[#1E293B] bg-[#0C121E]' : 'border-slate-200 bg-slate-100'
        }`}>
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'health', label: 'Health & Metrics' },
            { id: 'monitors', label: `Monitors (${appMonitors.length})` },
            { id: 'infra', label: 'Infrastructure' },
            { id: 'deps', label: `Dependencies (${appMonitors.length})` },
            { id: 'dr', label: 'PRD / DR' },
            { id: 'backups', label: `Backups (${appBackups.length})` },
            { id: 'incidents', label: `Incidents (${appIncidents.length})` },
            { id: 'deployments', label: `Deployments (${appDeployments.length})` },
            { id: 'history', label: 'History' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTabLocal(tab.id as typeof activeTab)}
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

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs">

          {/* TAB: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-4 font-mono">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className={card}>
                  <div className={label}>Availability 24h</div>
                  <div className={value}>{fmtPct(application.uptime24h)}</div>
                </div>
                <div className={card}>
                  <div className={label}>Availability 30d</div>
                  <div className={value}>{fmtPct(application.uptime30d)}</div>
                </div>
                <div className={card}>
                  <div className={label}>RTO Target</div>
                  <div className={value}>{application.rtoTargetMin} min</div>
                </div>
                <div className={card}>
                  <div className={label}>RPO Target</div>
                  <div className={value}>{application.rpoTargetMin} min</div>
                </div>
              </div>
              {application.uptime24h === null && (
                <p className={`text-[11px] font-sans ${muted}`}>
                  Availability is computed from this application's monitors. No checks have been recorded yet.
                </p>
              )}

              <HealthDimensions
                application={application}
                servers={servers}
                monitors={monitors}
                zones={cloudflareZones}
                loadBalancer={loadBalancer}
                cloudflareConfigured={Boolean(integrations?.cloudflare.configured)}
                workerMonitor={workerMonitor}
                isDark={isDark}
              />

              <div className={`p-4 rounded border space-y-2 ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                <div className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Domain &amp; Routing</div>
                <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${muted}`}>
                  <div>
                    <span className={label}>Cloudflare Zone:</span>
                    <div className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{application.cloudflareZone || 'Not configured'}</div>
                  </div>
                  <div>
                    <span className={label}>Traffic routing method:</span>
                    <div className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{ROUTING_METHOD_LABELS[effectiveRoutingMethod(application)]}</div>
                  </div>
                  <div>
                    <span className={label}>Active routing target:</span>
                    <div className={`font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                      {servingLabel(route)}
                    </div>
                  </div>
                  <div>
                    <span className={label}>Auto-Failover:</span>
                    <div className={`font-semibold ${application.autoFailover ? 'text-emerald-500' : (isDark ? 'text-slate-300' : 'text-slate-700')}`}>
                      {application.autoFailover ? 'Enabled' : 'Disabled (manual only)'}
                    </div>
                  </div>
                </div>
              </div>

              <div className={`p-4 rounded border space-y-2 ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                <div className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Servers</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {renderServerCard(prdServer, 'PRD')}
                  {renderServerCard(drServer, 'DR')}
                </div>
              </div>
            </div>
          )}

          {/* TAB: HEALTH & METRICS */}
          {activeTab === 'health' && (
            <div className="space-y-4 font-mono">
              <div className="grid grid-cols-3 gap-3">
                <div className={card}>
                  <div className={label}>Latency P50</div>
                  <div className={value}>{fmtMs(application.p50Ms)}</div>
                </div>
                <div className={card}>
                  <div className={label}>Latency P95</div>
                  <div className={value}>{fmtMs(application.p95Ms)}</div>
                </div>
                <div className={card}>
                  <div className={label}>Latency P99</div>
                  <div className={value}>{fmtMs(application.p99Ms)}</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className={card}>
                  <div className={label}>Uptime 24h</div>
                  <div className={value}>{fmtPct(application.uptime24h)}</div>
                </div>
                <div className={card}>
                  <div className={label}>Uptime 7d</div>
                  <div className={value}>{fmtPct(application.uptime7d)}</div>
                </div>
                <div className={card}>
                  <div className={label}>Uptime 30d</div>
                  <div className={value}>{fmtPct(application.uptime30d)}</div>
                </div>
              </div>

              <div className={`p-4 rounded border space-y-2 ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                <div className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Failed Check Rate (24h)</div>
                {application.errorRatePercent === null ? (
                  <div className={`text-[11px] font-sans ${muted}`}>No data yet — computed from this application's monitor checks.</div>
                ) : (
                  <>
                    <div className={`flex items-center h-2 rounded overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                      <div className="bg-emerald-500 h-full" style={{ width: `${Math.max(0, Math.min(100, 100 - application.errorRatePercent))}%` }} />
                      <div className="bg-rose-500 h-full" style={{ width: `${Math.max(0, Math.min(100, application.errorRatePercent))}%` }} />
                    </div>
                    <div className={`flex justify-between text-[11px] ${muted}`}>
                      <span>Successful checks: {(100 - application.errorRatePercent).toFixed(2)}%</span>
                      <span className={application.errorRatePercent > 0.1 ? 'text-rose-500 font-bold' : ''}>
                        Failed checks: {application.errorRatePercent.toFixed(2)}%
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* TAB: MONITORS */}
          {activeTab === 'monitors' && (
            <div className="space-y-3 font-mono">
              <div className="flex items-center justify-between">
                <div className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  Monitors ({appMonitors.length})
                </div>
                {canAddMonitor && (
                  <button
                    onClick={() => openAddMonitorWithContext({ applicationId: application.id })}
                    className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1 cursor-pointer shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Monitor</span>
                  </button>
                )}
              </div>
              {appMonitors.length === 0 ? (
                <div className={emptyText}>No monitors attached to this application yet.</div>
              ) : (
                <div className="space-y-2">
                  {appMonitors.map(m => (
                    <div key={m.id} className={`p-3 rounded border flex items-center justify-between ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="min-w-0">
                        <div className={`font-semibold flex items-center gap-2 font-sans ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                          <span className="truncate">{m.name}</span>
                          <span className={`font-mono text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>· {m.type} · {m.environment}</span>
                          {!m.enabled && <span className="font-mono text-[10px] text-slate-500">(paused)</span>}
                        </div>
                        <div className={`text-[11px] truncate ${muted}`}>{m.target}</div>
                      </div>
                      <div className="text-right shrink-0 pl-3 flex items-center gap-2">
                        <div>
                          <div className={`font-semibold ${statusColor(m.status)}`}>{m.status}</div>
                          <div className={`text-[11px] ${muted}`}>
                            {m.lastCheck ? `${fmtMs(m.responseTimeMs)} · ${fmtTime(m.lastCheck)}` : 'Not checked yet'}
                          </div>
                        </div>
                        <MonitorActions
                          isDark={isDark}
                          canEdit={canEditMonitor}
                          canDelete={canDeleteMonitor}
                          confirming={confirmDeleteMonitor === m.id}
                          deleting={deletingMonitor === m.id}
                          onEdit={() => setEditingMonitor(m)}
                          onAskDelete={() => setConfirmDeleteMonitor(m.id)}
                          onCancelDelete={() => setConfirmDeleteMonitor(null)}
                          onDelete={async () => {
                            setDeletingMonitor(m.id);
                            if (await deleteMonitor(m.id)) setConfirmDeleteMonitor(null);
                            setDeletingMonitor(null);
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB: INFRASTRUCTURE */}
          {activeTab === 'infra' && (
            <div className="space-y-4 font-mono">
              <div className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Server Telemetry (reported by the agent)</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {([['PRD', prdServer], ['DR', drServer]] as const).map(([env, srv]) => (
                  <div key={env} className={`p-4 border rounded space-y-2 ${isDark ? 'border-[#1E293B] bg-[#0A0F1A]' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="flex justify-between items-center">
                      <span className={`font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{srv?.hostname ?? 'Not linked'}</span>
                      <span className={`text-[10px] font-semibold uppercase ${env === 'PRD' ? 'text-blue-500' : (isDark ? 'text-slate-400' : 'text-slate-500')}`}>{env}</span>
                    </div>
                    {srv ? (
                      <>
                        <div className={`text-[11px] ${muted}`}>{srv.ip || 'No IP'}{srv.region ? ` · ${srv.region}` : ''} · agent {srv.agentStatus}</div>
                        {srv.lastSeen ? (
                          <div className={`pt-2 border-t space-y-1 ${isDark ? 'border-[#1E293B] text-slate-300' : 'border-slate-200 text-slate-700'}`}>
                            <div className="flex justify-between"><span>CPU:</span> <strong>{srv.telemetry.cpuPercent.toFixed(1)}%</strong></div>
                            <div className="flex justify-between"><span>RAM:</span> <strong>{srv.telemetry.ramPercent.toFixed(1)}%</strong></div>
                            <div className="flex justify-between"><span>Disk:</span> <strong>{srv.telemetry.diskPercent.toFixed(1)}%</strong></div>
                            <div className="flex justify-between"><span>Load:</span> <strong>{srv.telemetry.loadAvg.map(l => l.toFixed(2)).join(', ')}</strong></div>
                            <div className={`text-[10px] pt-1 ${muted}`}>Last report {fmtDateTime(srv.lastSeen)}</div>
                          </div>
                        ) : (
                          <div className={`pt-2 border-t text-[11px] italic font-sans ${isDark ? 'border-[#1E293B] text-slate-500' : 'border-slate-200 text-slate-500'}`}>
                            The agent has never reported. Install it from Setup.
                          </div>
                        )}
                      </>
                    ) : (
                      <div className={`text-[11px] italic font-sans ${muted}`}>No {env} server linked to this application.</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB: DEPENDENCIES (derived from monitors) */}
          {activeTab === 'deps' && (
            <div className="space-y-3 font-mono">
              <div className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Dependencies (checked by monitors)</div>
              <p className={`text-[11px] font-sans ${muted}`}>
                Each monitor attached to this application represents a dependency the system actually checks (endpoints, databases, workers, backups).
              </p>
              {appMonitors.length === 0 && registerLinks(application.dependencies).length === 0 ? (
                <div className={emptyText}>No monitored dependencies. Add monitors for databases, workers and endpoints.</div>
              ) : (
                <div className="space-y-2">
                  {appMonitors.map(m => (
                    <div key={m.id} className={`p-3 rounded border flex items-center justify-between ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="min-w-0">
                        <div className={`font-semibold flex items-center gap-2 font-sans ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                          <span className="truncate">{m.name}</span>
                          <span className={`font-mono text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>· {m.type} [{m.environment}]</span>
                        </div>
                        <div className={`text-[11px] truncate ${muted}`}>{m.target}</div>
                      </div>
                      <div className="text-right shrink-0 pl-3 flex items-center gap-2">
                        <div>
                          <span className={`font-semibold ${statusColor(m.status)}`}>{m.status}</span>
                          <div className={`text-[10px] ${muted}`}>{m.lastCheck ? fmtMs(m.responseTimeMs) : '—'}</div>
                        </div>
                        <MonitorActions
                          isDark={isDark}
                          canEdit={canEditMonitor}
                          canDelete={canDeleteMonitor}
                          confirming={confirmDeleteMonitor === m.id}
                          deleting={deletingMonitor === m.id}
                          onEdit={() => setEditingMonitor(m)}
                          onAskDelete={() => setConfirmDeleteMonitor(m.id)}
                          onCancelDelete={() => setConfirmDeleteMonitor(null)}
                          onDelete={async () => {
                            setDeletingMonitor(m.id);
                            if (await deleteMonitor(m.id)) setConfirmDeleteMonitor(null);
                            setDeletingMonitor(null);
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  {registerLinks(application.dependencies).map(d => (
                    <div key={d.id} className={`p-3 rounded border flex items-center justify-between ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="min-w-0">
                        <div className={`font-semibold font-sans truncate ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{d.name}</div>
                        <div className={`text-[11px] ${muted}`}>Register link with a real check</div>
                      </div>
                      <span className={`font-semibold shrink-0 pl-3 ${statusColor(d.status)}`}>{d.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB: PRD / DR & FAILOVER */}
          {activeTab === 'dr' && (
            <div className="space-y-4 font-mono">
              <div className={`p-4 rounded border space-y-3 ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                <div className="flex items-center justify-between">
                  <div className={`text-xs font-bold font-sans ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Disaster Recovery</div>
                  <span className={`text-xs font-semibold ${isFailingOver ? 'text-amber-500' : 'text-blue-500'}`}>{application.failoverState}</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className={`p-2.5 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
                    <span className={label}>Replication Lag</span>
                    <div className={`font-bold text-sm mt-0.5 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                      {application.currentReplicationLagSec === null ? 'No data' : `${application.currentReplicationLagSec} seconds`}
                    </div>
                    {application.currentReplicationLagSec === null && (
                      <div className={`text-[10px] font-sans ${muted}`}>Add a DB_REPLICATION monitor to report lag</div>
                    )}
                  </div>
                  <div className={`p-2.5 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
                    <span className={label}>Last Failover</span>
                    <div className={`font-bold text-sm mt-0.5 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                      {fmtDateTime(application.lastFailoverAt, 'Never')}
                    </div>
                  </div>
                  <div className={`p-2.5 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
                    <span className={label}>DNS Record</span>
                    <div className={`font-bold text-sm mt-0.5 truncate ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                      {application.dnsRecordName || 'Not configured'}
                    </div>
                    <div className={`text-[10px] ${muted}`}>Zone: {application.cloudflareZone || 'Not configured'}</div>
                  </div>
                  <div className={`p-2.5 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
                    <span className={label}>Auto-Failover</span>
                    <div className={`font-bold text-sm mt-0.5 ${application.autoFailover ? 'text-emerald-500' : (isDark ? 'text-slate-100' : 'text-slate-900')}`}>
                      {application.autoFailover ? 'Enabled' : 'Disabled'}
                    </div>
                  </div>
                </div>

                <div className={`pt-2 border-t space-y-2 ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
                  {effectiveRoutingMethod(application) === 'cloudflare_lb' && application.loadBalancer ? (
                    <LbFailoverConsole app={application} />
                  ) : effectiveRoutingMethod(application) === 'cloudflare_worker' || effectiveRoutingMethod(application) === 'cloudflare_worker_failover' || effectiveRoutingMethod(application) === 'custom' ? (
                    <div className={`text-[11px] font-sans ${muted}`}>{ROUTING_METHOD_LABELS[effectiveRoutingMethod(application)]}. Scholario Ops does not change Worker routes, origins, or custom routing. Automatic failover stays off.</div>
                  ) : !canFailover ? (
                    <div className={`text-[11px] font-sans ${muted}`}>Only super administrators can switch traffic between PRD and DR.</div>
                  ) : failoverBlockers.length > 0 ? (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-sans text-amber-500">Failover unavailable: {failoverBlockers.join(' · ')}.</div>
                      <button
                        onClick={() => { onClose(); navigate('/setup'); }}
                        className="px-3 py-1 rounded text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                      >
                        Configure in Setup
                      </button>
                    </div>
                  ) : !confirmFailover ? (
                    <button
                      disabled={isFailingOver}
                      onClick={() => setConfirmFailover(true)}
                      className={`px-3 py-1.5 rounded text-xs font-semibold text-white transition-colors cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed ${
                        isDrActive ? 'bg-blue-600 hover:bg-blue-700' : 'bg-rose-600 hover:bg-rose-700'
                      }`}
                    >
                      {isFailingOver ? 'Failover in progress…' : isDrActive ? 'Fail back to Primary (PRD)' : 'Fail over to DR'}
                    </button>
                  ) : (
                    <div className={`p-3 rounded border space-y-2 font-sans ${isDark ? 'bg-[#1F1710] border-amber-900' : 'bg-amber-50 border-amber-300'}`}>
                      <div className="font-bold text-amber-500 flex items-center gap-1.5 text-xs">
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        <span>Confirm Cloudflare DNS switch</span>
                      </div>
                      <p className={`text-[11px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                        The DNS record <strong className="font-mono">{application.dnsRecordName}</strong> in zone{' '}
                        <strong className="font-mono">{application.cloudflareZone}</strong> will be pointed to the{' '}
                        {failoverTarget === 'DR' ? 'DR' : 'PRD'} server <strong className="font-mono">{targetServer?.hostname}</strong>{' '}
                        (<strong className="font-mono">{targetServer?.ip}</strong>). Live traffic for {application.name} moves immediately.
                      </p>
                      <input
                        type="text"
                        value={failoverReason}
                        onChange={e => setFailoverReason(e.target.value)}
                        placeholder="Reason (recorded in the audit log)"
                        className={`w-full px-2 py-1 rounded border text-xs font-mono outline-none ${
                          isDark ? 'bg-[#0B0F17] border-[#1E293B] text-slate-200' : 'bg-white border-slate-300 text-slate-800'
                        }`}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          disabled={failoverBusy}
                          onClick={handleFailover}
                          className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold cursor-pointer flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {failoverBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                          <span>{failoverBusy ? 'Switching DNS…' : 'Switch DNS now'}</span>
                        </button>
                        <button
                          disabled={failoverBusy}
                          onClick={() => setConfirmFailover(false)}
                          className={`px-3 py-1 rounded text-xs cursor-pointer disabled:opacity-60 ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB: BACKUPS */}
          {activeTab === 'backups' && (
            <div className="space-y-3 font-mono">
              <div className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Reported Backups</div>
              {appBackups.length === 0 ? (
                <div className={emptyText}>No backups reported for this application. See the Backups page for how to report them.</div>
              ) : appBackups.map(b => (
                <div key={b.id} className={`p-3 rounded border space-y-1 ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex justify-between items-center">
                    <span className={`font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{b.type} · {b.sizeGb} GB</span>
                    <span className={`text-[10px] uppercase font-semibold ${b.status === 'SUCCESS' ? 'text-emerald-500' : b.status === 'FAILED' ? 'text-rose-500' : 'text-amber-500'}`}>
                      {b.status}
                    </span>
                  </div>
                  <div className={`text-[11px] ${muted}`}>Completed {fmtDateTime(b.completedAt)} · Destination: {b.destination || '—'}</div>
                  <div className={`text-[10px] truncate ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Hash: {b.integrityHash || 'not provided'}</div>
                </div>
              ))}
            </div>
          )}

          {/* TAB: INCIDENTS */}
          {activeTab === 'incidents' && (
            <div className="space-y-3">
              {appIncidents.length > 0 ? (
                appIncidents.map(inc => (
                  <div
                    key={inc.id}
                    onClick={() => {
                      onClose();
                      setSelectedIncidentId(inc.id);
                      setActiveTab('incidents');
                    }}
                    className={`p-3 rounded border cursor-pointer transition-colors ${
                      isDark
                        ? 'bg-[#180E13] border-rose-900/80 hover:border-rose-700'
                        : 'bg-rose-50 border-rose-300 hover:border-rose-400'
                    }`}
                  >
                    <div className="flex justify-between items-center font-mono">
                      <span className="font-bold text-rose-500">{inc.id} · {inc.severity}</span>
                      <span className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{inc.status}</span>
                    </div>
                    <div className={`font-semibold text-xs mt-1 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{inc.title}</div>
                    {inc.rootCause && <div className={`text-[11px] mt-0.5 ${muted}`}>{inc.rootCause}</div>}
                  </div>
                ))
              ) : (
                <div className={emptyText}>No incident records for this application.</div>
              )}
            </div>
          )}

          {/* TAB: DEPLOYMENTS */}
          {activeTab === 'deployments' && (
            <div className="space-y-3 font-mono">
              {appDeployments.length === 0 ? (
                <div className={emptyText}>No deployments recorded for this application.</div>
              ) : appDeployments.map(d => (
                <div key={d.id} className={`p-3 rounded border space-y-1 ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex justify-between items-center">
                    <span className={`font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{d.version}{d.commitHash ? ` (${d.commitHash})` : ''}</span>
                    <span className={`text-[10px] uppercase font-semibold ${d.status === 'SUCCESS' ? 'text-emerald-500' : d.status === 'FAILED' || d.status === 'ROLLED_BACK' ? 'text-rose-500' : 'text-amber-500'}`}>{d.status}</span>
                  </div>
                  {d.commitMessage && <div className={`text-xs font-sans ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{d.commitMessage}</div>}
                  <div className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    {d.environment} · {d.author || 'unknown author'} · {fmtDateTime(d.startedAt)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB: HISTORY */}
          {activeTab === 'history' && (
            <div className="space-y-2 font-mono">
              {appAudits.length > 0 ? (
                appAudits.map(a => (
                  <div key={a.id} className={`p-2.5 rounded border space-y-0.5 text-xs ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                    <div className={`flex justify-between text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                      <span>{a.operator}</span>
                      <span>{fmtDateTime(a.timestamp)}</span>
                    </div>
                    <div className="font-semibold text-blue-500">{a.action}</div>
                    <div className={`text-[11px] font-sans ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{a.details}</div>
                  </div>
                ))
              ) : (
                <div className={emptyText}>No audit log entries found.</div>
              )}
            </div>
          )}

        </div>

        {/* Modal Footer */}
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
      {editingApp && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/60 p-4" onMouseDown={() => setEditingApp(false)}>
          <div className="max-w-5xl mx-auto" onMouseDown={e => e.stopPropagation()}>
            <AppEditor initial={application} onDone={() => setEditingApp(false)} />
          </div>
        </div>
      )}
      {editingMonitor && <MonitorFormModal key={editingMonitor.id} existing={editingMonitor} onClose={() => setEditingMonitor(null)} />}
    </div>
  );
};

const MonitorActions: React.FC<{
  isDark: boolean;
  canEdit: boolean;
  canDelete: boolean;
  confirming: boolean;
  deleting: boolean;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}> = ({ isDark, canEdit, canDelete, confirming, deleting, onEdit, onAskDelete, onCancelDelete, onDelete }) => {
  if (!canEdit && !canDelete) return null;
  const quiet = `p-1 rounded border cursor-pointer ${isDark ? 'border-[#23334E] text-slate-300 hover:bg-[#1D2B44]' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`;
  return (
    <div className="flex items-center gap-1">
      {canEdit && (
        <button type="button" onClick={onEdit} className={quiet} title="Edit" aria-label="Edit">
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
      {canDelete && (confirming ? (
        <>
          <button type="button" disabled={deleting} onClick={onDelete} className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-600 text-white cursor-pointer disabled:opacity-60">
            {deleting ? '…' : 'Delete'}
          </button>
          <button type="button" disabled={deleting} onClick={onCancelDelete} className="px-1.5 py-0.5 rounded text-[10px] bg-slate-600 text-white cursor-pointer">No</button>
        </>
      ) : (
        <button type="button" onClick={onAskDelete} className={`${quiet} hover:text-rose-500`} title="Delete" aria-label="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      ))}
    </div>
  );
};

export const ApplicationsView: React.FC = () => {
  const { applications, servers, monitors, cloudflareZones, loadBalancer, setSelectedAppId, selectedAppId, deleteApplication, theme, isLoading } = useOps();
  const { canDo } = useAuth();
  const navigate = useNavigate();
  const isDark = theme === 'dark';
  const canEditApp = canDo('update_application');
  const canDeleteApp = canDo('delete_application');
  const [editingApp, setEditingApp] = useState<Application | null>(null);
  const [confirmDeleteApp, setConfirmDeleteApp] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'TIER_1' | 'TIER_2' | 'HEALTHY' | 'DEGRADED'>('ALL');

  const selectedApp = applications.find(a => a.id === selectedAppId);

  const filteredApps = applications.filter(a => {
    if (filter === 'TIER_1') return a.tier === 'TIER_1';
    if (filter === 'TIER_2') return a.tier === 'TIER_2';
    if (filter === 'HEALTHY') return a.status === 'HEALTHY';
    if (filter === 'DEGRADED') return a.status !== 'HEALTHY';
    return true;
  });

  return (
    <div className="space-y-6">
      {selectedApp && (
        <ApplicationDetailModal
          application={selectedApp}
          onClose={() => setSelectedAppId(null)}
        />
      )}

      {/* Header */}
      <div className={`flex flex-wrap items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            APPLICATIONS
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {applications.length} registered application{applications.length === 1 ? '' : 's'} across Primary and Disaster Recovery servers
          </p>
        </div>

        {/* Filters */}
        <div className={`flex items-center gap-1 p-0.5 rounded border text-xs font-mono ${
          isDark ? 'bg-[#0B0F17] border-[#1E293B]' : 'bg-slate-100 border-slate-300'
        }`}>
          {(['ALL', 'TIER_1', 'TIER_2', 'HEALTHY', 'DEGRADED'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 whitespace-nowrap transition-colors rounded cursor-pointer ${
                filter === f
                  ? 'bg-blue-600 text-white font-medium shadow-xs'
                  : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {applications.length === 0 ? (
        isLoading ? (
          <div className={`text-xs font-mono animate-pulse ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Loading applications…</div>
        ) : (
          <EmptyState
            icon={Layers}
            title="No applications registered"
            description="Register your servers and applications (PRD/DR server, Cloudflare zone and DNS record) in Setup."
            action={{ label: 'Open Setup', onClick: () => navigate('/setup') }}
          />
        )
      ) : filteredApps.length === 0 ? (
        <EmptyState title="No applications match this filter" />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
          {filteredApps.map(app => {
            const prdServer = servers.find(s => s.id === app.prdServerId);
            const isHealthy = app.status === 'HEALTHY';
            const isBad = app.status === 'CRITICAL' || app.status === 'WARNING';
            const cause = statusCause(app.status, app.dependencies);
            const route = routeState(app, loadBalancer, dnsPointsAt(app, servers, cloudflareZones));
            const lag = app.currentReplicationLagSec;

            return (
              <div
                key={app.id}
                onClick={() => setSelectedAppId(app.id)}
                className={`rounded border p-3.5 cursor-pointer transition-all flex flex-col justify-between space-y-3 min-w-0 ${
                  isBad
                    ? (isDark ? 'border-rose-900/80 bg-[#160E13]' : 'border-rose-300 bg-rose-50/60 shadow-xs')
                    : (isDark ? 'bg-[#111726] border-[#1E293B] hover:border-blue-500' : 'bg-white border-slate-200 hover:border-blue-400 shadow-xs')
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${statusDot(app.status)}`} />
                      <h3 title={app.name} className="font-bold text-sm line-clamp-2 break-words min-w-0">{app.name}</h3>
                    </div>
                    <span className={`font-mono text-[10px] whitespace-nowrap shrink-0 mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {app.tier.replace('_', ' ')}
                    </span>
                  </div>
                  <p className={`text-[11px] mt-1 line-clamp-2 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {app.description || app.dnsRecordName || app.codeName}
                  </p>
                  {!isHealthy && (
                    <p className={`text-[10px] font-mono mt-1 ${statusColor(app.status)}`}>{app.status}{cause ? ` · ${cause}` : ''}</p>
                  )}
                </div>

                {/* Metrics */}
                <div className={`space-y-1.5 pt-2 border-t font-mono text-xs ${isDark ? 'border-[#1A2332]' : 'border-slate-100'}`}>
                  <div className={`flex justify-between items-center ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    <span className="text-[10px] uppercase">Replication Lag</span>
                    <span className={`tabular-nums ${lag !== null && lag > 30 ? 'text-amber-500 font-bold' : ''}`}>{fmtLag(lag)}</span>
                  </div>
                  <div className={`flex justify-between items-center ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    <span className="text-[10px] uppercase">Uptime (30d)</span>
                    <span className="tabular-nums font-semibold">{fmtPct(app.uptime30d)}</span>
                  </div>
                  <div className={`flex justify-between items-center ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    <span className="text-[10px] uppercase">Latency P95</span>
                    <span className="tabular-nums">{fmtMs(app.p95Ms)}</span>
                  </div>
                  <div className={`flex justify-between items-center ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    <span className="text-[10px] uppercase">Routing Target</span>
                    <span className={route === 'DR' ? 'text-rose-500 font-bold' : route === 'PRD' ? 'text-emerald-500 font-semibold' : route === 'MOVING' || route === 'SPLIT' ? 'text-amber-500 font-bold' : (isDark ? 'text-slate-400' : 'text-slate-500')}>
                      {servingLabel(route)}
                    </span>
                  </div>
                  <div className={`flex justify-between items-center ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    <span className="text-[10px] uppercase">Auto-Failover</span>
                    <span>{app.autoFailover ? 'On' : 'Off'}</span>
                  </div>
                </div>

                {/* Footer */}
                <div className={`pt-2 border-t flex items-center justify-between gap-2 text-[11px] font-mono ${isDark ? 'border-[#1A2332]' : 'border-slate-100'}`}>
                  <span title={prdServer?.hostname} className={`truncate min-w-0 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {prdServer ? prdServer.hostname.split('.')[0] : 'No PRD server'}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    {canEditApp && (
                      <button type="button" onClick={e => { e.stopPropagation(); setEditingApp(app); }} className="px-1.5 py-0.5 rounded text-blue-500 hover:bg-blue-500/10 cursor-pointer inline-flex items-center gap-1" title={`Edit ${app.name}`}>
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                    )}
                    {canDeleteApp && (confirmDeleteApp === app.id ? (
                      <button
                        type="button"
                        onClick={async e => {
                          e.stopPropagation();
                          if (await deleteApplication(app.id)) {
                            setConfirmDeleteApp(null);
                            if (selectedAppId === app.id) setSelectedAppId(null);
                          }
                        }}
                        className="px-1.5 py-0.5 rounded bg-rose-600 text-white cursor-pointer"
                      >
                        Delete
                      </button>
                    ) : (
                      <button type="button" onClick={e => { e.stopPropagation(); setConfirmDeleteApp(app.id); }} className="px-1.5 py-0.5 rounded text-rose-500 hover:bg-rose-500/10 cursor-pointer inline-flex items-center gap-1" title={`Delete ${app.name}`}>
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    ))}
                    <span className="text-blue-500 font-semibold flex items-center gap-1">
                      <span>Inspect</span>
                      <ArrowRight className="w-3 h-3" />
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editingApp && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/60 p-4" onMouseDown={() => setEditingApp(null)}>
          <div className="max-w-5xl mx-auto" onMouseDown={e => e.stopPropagation()}>
            <AppEditor key={editingApp.id} initial={editingApp} onDone={() => setEditingApp(null)} />
          </div>
        </div>
      )}
    </div>
  );
};
