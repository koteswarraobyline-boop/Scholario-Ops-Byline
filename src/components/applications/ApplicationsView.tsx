import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { Application } from '../../types';
import { 
  X, 
  Activity, 
  Server, 
  Radio, 
  Cpu, 
  Cloud, 
  Database, 
  AlertTriangle, 
  GitBranch, 
  FileText, 
  CheckCircle2, 
  ArrowRight
} from 'lucide-react';
import { TrafficFlowChart } from '../visuals/TrafficFlowChart';

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
    setSelectedIncidentId,
    setActiveTab
  } = useOps();

  const [activeTab, setActiveTabLocal] = useState<'overview' | 'health' | 'monitors' | 'infra' | 'deps' | 'dr' | 'backups' | 'incidents' | 'deployments' | 'history'>('overview');
  const [confirmFailover, setConfirmFailover] = useState(false);

  const prdServer = servers.find(s => s.id === application.prdServerId);
  const drServer = servers.find(s => s.id === application.drServerId);
  const appMonitors = monitors.filter(m => m.applicationId === application.id);
  const appIncidents = incidents.filter(i => i.applicationId === application.id);
  const appBackups = backups.filter(b => b.applicationId === application.id);
  const appDeployments = deployments.filter(d => d.applicationId === application.id);
  const appAudits = auditLogs.filter(a => a.targetId === application.id);

  const handleFailoverClick = (target: 'DR' | 'PRIMARY') => {
    triggerFailover(application.id, target);
    setConfirmFailover(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in">
      <div 
        className="w-full max-w-4xl bg-[#101624] text-slate-100 rounded border border-[#223048] overflow-hidden flex flex-col max-h-[90vh] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 px-6 border-b border-[#1E293B] bg-[#0A0F1A] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full ${application.status === 'HEALTHY' ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
            <div>
              <div className="flex items-center gap-2 font-mono">
                <h2 className="text-base font-bold text-slate-100 font-sans">{application.name}</h2>
                <span className="text-xs text-slate-400">· {application.tier.replace('_', ' ')}</span>
                <span className="text-slate-600">·</span>
                <span className={`text-xs font-semibold ${application.status === 'HEALTHY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {application.status}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-sans mt-0.5">{application.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-slate-400">
              Checked {new Date(application.lastChecked).toLocaleTimeString()}
            </span>
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-6 border-b border-[#1E293B] bg-[#0C121E] overflow-x-auto text-xs font-mono">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'health', label: 'Health & Metrics' },
            { id: 'monitors', label: `Monitors (${appMonitors.length})` },
            { id: 'infra', label: 'Infrastructure' },
            { id: 'deps', label: `Dependencies (${application.dependencies.length})` },
            { id: 'dr', label: 'PRD / DR' },
            { id: 'backups', label: `Backups (${appBackups.length})` },
            { id: 'incidents', label: `Incidents (${appIncidents.length})` },
            { id: 'deployments', label: 'Deployments' },
            { id: 'history', label: 'History' }
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

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs">
          
          {/* TAB: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-4 font-mono">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-[#0A0F1A] border border-[#1E293B] rounded">
                  <div className="text-[10px] text-slate-400 uppercase">Availability 24h</div>
                  <div className="text-base font-bold text-slate-100 tabular-nums">{application.uptime24h}%</div>
                </div>
                <div className="p-3 bg-[#0A0F1A] border border-[#1E293B] rounded">
                  <div className="text-[10px] text-slate-400 uppercase">Availability 30d</div>
                  <div className="text-base font-bold text-slate-100 tabular-nums">{application.uptime30d}%</div>
                </div>
                <div className="p-3 bg-[#0A0F1A] border border-[#1E293B] rounded">
                  <div className="text-[10px] text-slate-400 uppercase">RTO Target</div>
                  <div className="text-base font-bold text-slate-100 tabular-nums">{application.rtoTargetMin} min</div>
                </div>
                <div className="p-3 bg-[#0A0F1A] border border-[#1E293B] rounded">
                  <div className="text-[10px] text-slate-400 uppercase">RPO Target</div>
                  <div className="text-base font-bold text-slate-100 tabular-nums">{application.rpoTargetMin} min</div>
                </div>
              </div>

              <div className="p-4 bg-[#0A0F1A] rounded border border-[#1E293B] space-y-2">
                <div className="text-xs font-bold text-slate-300">Domain &amp; Routing Topology</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-400">
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase">Public Domain:</span>
                    <div className="text-slate-200 font-semibold">{application.cloudflareZone}</div>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase">Active Routing Target:</span>
                    <div className={`font-semibold ${application.failoverState === 'DR_ACTIVE' ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {application.failoverState === 'DR_ACTIVE' ? 'DR Standby Origin' : 'Primary Origin'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-[#0A0F1A] rounded border border-[#1E293B] space-y-2">
                <div className="text-xs font-bold text-slate-300">Dedicated Compute Fleet (Hostinger)</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 bg-[#111726] border border-[#1E293B] rounded">
                    <span className="text-[10px] text-blue-400 uppercase">PRIMARY (PRD)</span>
                    <div className="font-semibold text-slate-100 mt-1">{prdServer?.hostname}</div>
                    <div className="text-[11px] text-slate-400">{prdServer?.ip} · {prdServer?.region}</div>
                  </div>
                  <div className="p-3 bg-[#111726] border border-[#1E293B] rounded">
                    <span className="text-[10px] text-slate-400 uppercase">STANDBY (DR)</span>
                    <div className="font-semibold text-slate-100 mt-1">{drServer?.hostname}</div>
                    <div className="text-[11px] text-slate-400">{drServer?.ip} · {drServer?.region}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: HEALTH & METRICS */}
          {activeTab === 'health' && (
            <div className="space-y-4 font-mono">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-[#0A0F1A] border border-[#1E293B] rounded">
                  <div className="text-[10px] text-slate-400 uppercase">Latency P50</div>
                  <div className="text-lg font-bold text-slate-100 tabular-nums">{application.p50Ms}ms</div>
                </div>
                <div className="p-3 bg-[#0A0F1A] border border-[#1E293B] rounded">
                  <div className="text-[10px] text-slate-400 uppercase">Latency P95</div>
                  <div className="text-lg font-bold text-slate-100 tabular-nums">{application.p95Ms}ms</div>
                </div>
                <div className="p-3 bg-[#0A0F1A] border border-[#1E293B] rounded">
                  <div className="text-[10px] text-slate-400 uppercase">Latency P99</div>
                  <div className="text-lg font-bold text-slate-100 tabular-nums">{application.p99Ms}ms</div>
                </div>
              </div>

              <div className="p-4 bg-[#0A0F1A] rounded border border-[#1E293B] space-y-2">
                <div className="text-xs font-bold text-slate-300">HTTP Status Distribution (24h)</div>
                <div className="flex items-center gap-2 h-2 rounded bg-slate-800 overflow-hidden">
                  <div className="bg-emerald-500 h-full" style={{ width: `${Math.max(0, 100 - application.errorRatePercent)}%` }} />
                  <div className="bg-rose-500 h-full" style={{ width: `${application.errorRatePercent}%` }} />
                </div>
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>2xx/3xx Success: {(100 - application.errorRatePercent).toFixed(2)}%</span>
                  <span className={application.errorRatePercent > 0.1 ? 'text-rose-400 font-bold' : ''}>
                    5xx Errors: {application.errorRatePercent}%
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB: MONITORS */}
          {activeTab === 'monitors' && (
            <div className="space-y-3 font-mono">
              <div className="text-xs font-semibold text-slate-300">Attached Monitor Probes</div>
              <div className="space-y-2">
                {appMonitors.map(m => (
                  <div key={m.id} className="p-3 bg-[#0A0F1A] border border-[#1E293B] rounded flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-slate-100 flex items-center gap-2 font-sans">
                        <span>{m.name}</span>
                        <span className="font-mono text-[10px] text-slate-400">· {m.type}</span>
                      </div>
                      <div className="text-slate-400 text-[11px]">{m.target}</div>
                    </div>
                    <div className="text-right">
                      <div className={`font-semibold ${m.status === 'HEALTHY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {m.status}
                      </div>
                      <div className="text-[11px] text-slate-400">{m.responseTimeMs}ms</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB: INFRASTRUCTURE */}
          {activeTab === 'infra' && (
            <div className="space-y-4 font-mono">
              <div className="text-xs font-semibold text-slate-300">Compute Node Specs &amp; Telemetry</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {prdServer && (
                  <div className="p-4 border border-[#1E293B] rounded bg-[#0A0F1A] space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-100">{prdServer.hostname}</span>
                      <span className="text-[10px] text-blue-400 uppercase">PRD</span>
                    </div>
                    <div className="text-[11px] text-slate-400">{prdServer.ip} · {prdServer.region}</div>
                    <div className="pt-2 border-t border-[#1E293B] space-y-1 text-slate-300">
                      <div className="flex justify-between"><span>CPU:</span> <strong>{prdServer.telemetry.cpuPercent}%</strong></div>
                      <div className="flex justify-between"><span>RAM:</span> <strong>{prdServer.telemetry.ramPercent}%</strong></div>
                      <div className="flex justify-between"><span>Disk:</span> <strong>{prdServer.telemetry.diskPercent}%</strong></div>
                      <div className="flex justify-between"><span>Load:</span> <strong>{prdServer.telemetry.loadAvg.join(', ')}</strong></div>
                    </div>
                  </div>
                )}
                {drServer && (
                  <div className="p-4 border border-[#1E293B] rounded bg-[#0A0F1A] space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-100">{drServer.hostname}</span>
                      <span className="text-[10px] text-slate-400 uppercase">DR</span>
                    </div>
                    <div className="text-[11px] text-slate-400">{drServer.ip} · {drServer.region}</div>
                    <div className="pt-2 border-t border-[#1E293B] space-y-1 text-slate-300">
                      <div className="flex justify-between"><span>CPU:</span> <strong>{drServer.telemetry.cpuPercent}%</strong></div>
                      <div className="flex justify-between"><span>RAM:</span> <strong>{drServer.telemetry.ramPercent}%</strong></div>
                      <div className="flex justify-between"><span>Disk:</span> <strong>{drServer.telemetry.diskPercent}%</strong></div>
                      <div className="flex justify-between"><span>Load:</span> <strong>{drServer.telemetry.loadAvg.join(', ')}</strong></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: DEPENDENCIES */}
          {activeTab === 'deps' && (
            <div className="space-y-3 font-mono">
              <div className="text-xs font-semibold text-slate-300">Upstream &amp; Downstream Dependencies</div>
              <div className="space-y-2">
                {application.dependencies.map(d => (
                  <div key={d.id} className="p-3 bg-[#0A0F1A] border border-[#1E293B] rounded flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-slate-100 flex items-center gap-2 font-sans">
                        <span>{d.name}</span>
                        <span className="font-mono text-[10px] text-slate-400">· {d.type}</span>
                      </div>
                      <div className="text-slate-400 text-[11px]">{d.target}</div>
                    </div>
                    <div className="text-right">
                      <span className={`font-semibold ${d.status === 'HEALTHY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {d.status}
                      </span>
                      <div className="text-[10px] text-slate-400">{d.latencyMs}ms</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB: PRD / DR & FAILOVER */}
          {activeTab === 'dr' && (
            <div className="space-y-4 font-mono">
              <div className="p-4 bg-[#0A0F1A] rounded border border-[#1E293B] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-300 font-sans">Disaster Recovery Readiness</div>
                  <span className="text-xs text-blue-400 font-semibold">
                    {application.failoverState}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-2.5 bg-[#111726] border border-[#1E293B] rounded">
                    <span className="text-[10px] text-slate-400 uppercase">Replication Lag</span>
                    <div className="font-bold text-slate-100 text-sm mt-0.5">{application.currentReplicationLagSec} seconds</div>
                  </div>
                  <div className="p-2.5 bg-[#111726] border border-[#1E293B] rounded">
                    <span className="text-[10px] text-slate-400 uppercase">Last Drill Verification</span>
                    <div className="font-bold text-slate-100 text-sm mt-0.5">{application.lastTestedRecoveryDate || '2026-09-18'} ({application.lastTestedRecoveryDurationMin || 22}m)</div>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#1E293B]">
                  {!confirmFailover ? (
                    <button
                      onClick={() => setConfirmFailover(true)}
                      className={`px-3 py-1.5 rounded text-xs font-semibold text-white transition-colors ${
                        application.failoverState === 'DR_ACTIVE' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-rose-600 hover:bg-rose-500'
                      }`}
                    >
                      {application.failoverState === 'DR_ACTIVE' ? 'Initiate Failback to Primary Origin' : 'Initiate Emergency DR Failover'}
                    </button>
                  ) : (
                    <div className="p-3 bg-[#1F1710] border border-amber-900 rounded space-y-2 font-sans">
                      <div className="font-bold text-amber-300 flex items-center gap-1.5 text-xs">
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                        <span>Confirm Cloudflare Edge Traffic Reroute</span>
                      </div>
                      <p className="text-[11px] text-slate-300">
                        This action modifies Cloudflare Load Balancer origin pool immediately for {application.name}.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleFailoverClick(application.failoverState === 'DR_ACTIVE' ? 'PRIMARY' : 'DR')}
                          className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-semibold"
                        >
                          Execute Reroute
                        </button>
                        <button
                          onClick={() => setConfirmFailover(false)}
                          className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs"
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
              <div className="text-xs font-semibold text-slate-300">Cold Snapshot &amp; Database Dumps</div>
              {appBackups.map(b => (
                <div key={b.id} className="p-3 bg-[#0A0F1A] border border-[#1E293B] rounded space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-200">{b.type} · {b.sizeGb} GB</span>
                    <span className="text-[10px] text-emerald-400 uppercase font-semibold">
                      VERIFIED
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">Destination: {b.destination}</div>
                  <div className="text-[10px] text-slate-500 truncate">SHA-256: {b.integrityHash}</div>
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
                    className="p-3 bg-[#180E13] border border-rose-900/80 rounded cursor-pointer hover:border-rose-700 transition-colors"
                  >
                    <div className="flex justify-between items-center font-mono">
                      <span className="font-bold text-rose-300">{inc.id} · {inc.severity}</span>
                      <span className="text-[10px] text-slate-400">{inc.status}</span>
                    </div>
                    <div className="text-slate-100 font-semibold text-xs mt-1">{inc.title}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{inc.rootCause}</div>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-slate-500 font-mono">No incident records for this application.</div>
              )}
            </div>
          )}

          {/* TAB: DEPLOYMENTS */}
          {activeTab === 'deployments' && (
            <div className="space-y-3 font-mono">
              {appDeployments.map(d => (
                <div key={d.id} className="p-3 bg-[#0A0F1A] border border-[#1E293B] rounded space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-100">{d.version} ({d.commitHash})</span>
                    <span className="text-[10px] text-emerald-400 uppercase">{d.status}</span>
                  </div>
                  <div className="text-slate-300 text-xs font-sans">{d.commitMessage}</div>
                  <div className="text-[10px] text-slate-500">
                    Deployed by {d.author} · {new Date(d.startedAt).toLocaleString()}
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
                  <div key={a.id} className="p-2.5 bg-[#0A0F1A] border border-[#1E293B] rounded space-y-0.5 text-xs">
                    <div className="flex justify-between text-slate-500 text-[10px]">
                      <span>{a.operator}</span>
                      <span>{new Date(a.timestamp).toLocaleString()}</span>
                    </div>
                    <div className="font-semibold text-blue-400">{a.action}</div>
                    <div className="text-slate-300 text-[11px] font-sans">{a.details}</div>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-slate-500">No audit log entries found.</div>
              )}
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="p-3 px-6 border-t border-[#1E293B] bg-[#0A0F1A] flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1 bg-[#1A2436] hover:bg-[#23324C] text-slate-200 rounded text-xs font-mono transition-colors"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
};

export const ApplicationsView: React.FC = () => {
  const { applications, servers, setSelectedAppId, selectedAppId, theme } = useOps();
  const isDark = theme === 'dark';
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
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            APPLICATION SYSTEMS &amp; FLOW TOPOLOGY
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Scholario platform catalog across Primary and Disaster Recovery environments
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
              className={`px-2.5 py-1 transition-colors rounded cursor-pointer ${
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

      {/* Real Live Anycast Traffic & Failover Architecture Flow Chart */}
      <TrafficFlowChart />

      {/* Applications Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {filteredApps.map(app => {
          const prdServer = servers.find(s => s.id === app.prdServerId);
          const isHealthy = app.status === 'HEALTHY';
          const isDr = app.failoverState === 'DR_ACTIVE';

          return (
            <div
              key={app.id}
              onClick={() => setSelectedAppId(app.id)}
              className={`rounded border p-3.5 cursor-pointer transition-all flex flex-col justify-between space-y-3 ${
                !isHealthy 
                  ? (isDark ? 'border-rose-900/80 bg-[#160E13]' : 'border-rose-300 bg-rose-50/60 shadow-xs') 
                  : (isDark ? 'bg-[#111726] border-[#1E293B] hover:border-blue-500' : 'bg-white border-slate-200 hover:border-blue-400 shadow-xs')
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${isHealthy ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
                    <h3 className="font-bold text-sm">{app.name}</h3>
                  </div>
                  <span className={`font-mono text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {app.tier.replace('_', ' ')}
                  </span>
                </div>
                <p className={`text-[11px] mt-1 line-clamp-2 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{app.description}</p>
              </div>

              {/* Metrics */}
              <div className={`space-y-1.5 pt-2 border-t font-mono text-xs ${isDark ? 'border-[#1A2332]' : 'border-slate-100'}`}>
                <div className={`flex justify-between items-center ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  <span className="text-[10px] uppercase">Replication Lag</span>
                  <span className={`tabular-nums ${app.currentReplicationLagSec > 30 ? 'text-amber-500 font-bold' : ''}`}>
                    {app.currentReplicationLagSec}s
                  </span>
                </div>
                <div className={`flex justify-between items-center ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  <span className="text-[10px] uppercase">Uptime (30d)</span>
                  <span className="tabular-nums font-semibold">{app.uptime30d}%</span>
                </div>
                <div className={`flex justify-between items-center ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  <span className="text-[10px] uppercase">Latency P95</span>
                  <span className="tabular-nums">{app.p95Ms}ms</span>
                </div>
                <div className={`flex justify-between items-center ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  <span className="text-[10px] uppercase">Routing Target</span>
                  <span className={isDr ? 'text-rose-500 font-bold' : 'text-emerald-500 font-semibold'}>
                    {isDr ? 'DR Standby' : 'Primary'}
                  </span>
                </div>
              </div>

              {/* Footer */}
              <div className={`pt-2 border-t flex items-center justify-between text-[11px] font-mono ${isDark ? 'border-[#1A2332]' : 'border-slate-100'}`}>
                <span className={`truncate max-w-[140px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  {prdServer?.hostname.split('.')[0]}
                </span>
                <span className="text-blue-500 font-semibold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                  <span>Inspect</span>
                  <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
