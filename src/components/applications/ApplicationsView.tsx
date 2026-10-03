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
    setActiveTab,
    theme
  } = useOps();

  const isDark = theme === 'dark';

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
        className={`w-full max-w-4xl rounded border overflow-hidden flex flex-col max-h-[90vh] shadow-2xl ${
          isDark ? 'bg-[#101624] text-slate-100 border-[#223048]' : 'bg-white text-slate-900 border-slate-300'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className={`p-4 px-4 sm:px-6 border-b flex items-center justify-between ${
          isDark ? 'border-[#1E293B] bg-[#0A0F1A]' : 'border-slate-200 bg-slate-50'
        }`}>
          <div className="flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full ${application.status === 'HEALTHY' ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
            <div>
              <div className="flex items-center gap-2 font-mono">
                <h2 className={`text-base font-bold font-sans ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{application.name}</h2>
                <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>· {application.tier.replace('_', ' ')}</span>
                <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
                <span className={`text-xs font-semibold ${application.status === 'HEALTHY' ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {application.status}
                </span>
              </div>
              <p className={`text-xs font-sans mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{application.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className={`text-[11px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Checked {new Date(application.lastChecked).toLocaleTimeString()}
            </span>
            <button
              onClick={onClose}
              className={`p-1 transition-colors cursor-pointer ${isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'}`}
            >
              <X className="w-5 h-5" />
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
                <div className={`p-3 rounded border ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Availability 24h</div>
                  <div className={`text-base font-bold tabular-nums ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{application.uptime24h}%</div>
                </div>
                <div className={`p-3 rounded border ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Availability 30d</div>
                  <div className={`text-base font-bold tabular-nums ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{application.uptime30d}%</div>
                </div>
                <div className={`p-3 rounded border ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>RTO Target</div>
                  <div className={`text-base font-bold tabular-nums ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{application.rtoTargetMin} min</div>
                </div>
                <div className={`p-3 rounded border ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>RPO Target</div>
                  <div className={`text-base font-bold tabular-nums ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{application.rpoTargetMin} min</div>
                </div>
              </div>

              <div className={`p-4 rounded border space-y-2 ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                <div className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Domain &amp; Routing Topology</div>
                <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  <div>
                    <span className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Public Domain:</span>
                    <div className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{application.cloudflareZone}</div>
                  </div>
                  <div>
                    <span className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Active Routing Target:</span>
                    <div className={`font-semibold ${application.failoverState === 'DR_ACTIVE' ? 'text-rose-500' : 'text-emerald-500'}`}>
                      {application.failoverState === 'DR_ACTIVE' ? 'DR Standby Origin' : 'Primary Origin'}
                    </div>
                  </div>
                </div>
              </div>

              <div className={`p-4 rounded border space-y-2 ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                <div className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Dedicated Compute Fleet (Hostinger)</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className={`p-3 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
                    <span className="text-[10px] text-blue-500 font-semibold uppercase">PRIMARY (PRD)</span>
                    <div className={`font-semibold mt-1 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{prdServer?.hostname}</div>
                    <div className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{prdServer?.ip} · {prdServer?.region}</div>
                  </div>
                  <div className={`p-3 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
                    <span className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>STANDBY (DR)</span>
                    <div className={`font-semibold mt-1 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{drServer?.hostname}</div>
                    <div className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{drServer?.ip} · {drServer?.region}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: HEALTH & METRICS */}
          {activeTab === 'health' && (
            <div className="space-y-4 font-mono">
              <div className="grid grid-cols-3 gap-3">
                <div className={`p-3 rounded border ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Latency P50</div>
                  <div className={`text-lg font-bold tabular-nums ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{application.p50Ms}ms</div>
                </div>
                <div className={`p-3 rounded border ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Latency P95</div>
                  <div className={`text-lg font-bold tabular-nums ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{application.p95Ms}ms</div>
                </div>
                <div className={`p-3 rounded border ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Latency P99</div>
                  <div className={`text-lg font-bold tabular-nums ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{application.p99Ms}ms</div>
                </div>
              </div>

              <div className={`p-4 rounded border space-y-2 ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                <div className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>HTTP Status Distribution (24h)</div>
                <div className={`flex items-center gap-2 h-2 rounded overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                  <div className="bg-emerald-500 h-full" style={{ width: `${Math.max(0, 100 - application.errorRatePercent)}%` }} />
                  <div className="bg-rose-500 h-full" style={{ width: `${application.errorRatePercent}%` }} />
                </div>
                <div className={`flex justify-between text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  <span>2xx/3xx Success: {(100 - application.errorRatePercent).toFixed(2)}%</span>
                  <span className={application.errorRatePercent > 0.1 ? 'text-rose-500 font-bold' : ''}>
                    5xx Errors: {application.errorRatePercent}%
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB: MONITORS */}
          {activeTab === 'monitors' && (
            <div className="space-y-3 font-mono">
              <div className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Attached Monitor Probes</div>
              <div className="space-y-2">
                {appMonitors.map(m => (
                  <div key={m.id} className={`p-3 rounded border flex items-center justify-between ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                    <div>
                      <div className={`font-semibold flex items-center gap-2 font-sans ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                        <span>{m.name}</span>
                        <span className={`font-mono text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>· {m.type}</span>
                      </div>
                      <div className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{m.target}</div>
                    </div>
                    <div className="text-right">
                      <div className={`font-semibold ${m.status === 'HEALTHY' ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {m.status}
                      </div>
                      <div className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{m.responseTimeMs}ms</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB: INFRASTRUCTURE */}
          {activeTab === 'infra' && (
            <div className="space-y-4 font-mono">
              <div className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Compute Node Specs &amp; Telemetry</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {prdServer && (
                  <div className={`p-4 border rounded space-y-2 ${isDark ? 'border-[#1E293B] bg-[#0A0F1A]' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="flex justify-between items-center">
                      <span className={`font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{prdServer.hostname}</span>
                      <span className="text-[10px] text-blue-500 font-semibold uppercase">PRD</span>
                    </div>
                    <div className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{prdServer.ip} · {prdServer.region}</div>
                    <div className={`pt-2 border-t space-y-1 ${isDark ? 'border-[#1E293B] text-slate-300' : 'border-slate-200 text-slate-700'}`}>
                      <div className="flex justify-between"><span>CPU:</span> <strong>{prdServer.telemetry.cpuPercent}%</strong></div>
                      <div className="flex justify-between"><span>RAM:</span> <strong>{prdServer.telemetry.ramPercent}%</strong></div>
                      <div className="flex justify-between"><span>Disk:</span> <strong>{prdServer.telemetry.diskPercent}%</strong></div>
                      <div className="flex justify-between"><span>Load:</span> <strong>{prdServer.telemetry.loadAvg.join(', ')}</strong></div>
                    </div>
                  </div>
                )}
                {drServer && (
                  <div className={`p-4 border rounded space-y-2 ${isDark ? 'border-[#1E293B] bg-[#0A0F1A]' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="flex justify-between items-center">
                      <span className={`font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{drServer.hostname}</span>
                      <span className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>DR</span>
                    </div>
                    <div className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{drServer.ip} · {drServer.region}</div>
                    <div className={`pt-2 border-t space-y-1 ${isDark ? 'border-[#1E293B] text-slate-300' : 'border-slate-200 text-slate-700'}`}>
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
              <div className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Upstream &amp; Downstream Dependencies</div>
              <div className="space-y-2">
                {application.dependencies.map(d => (
                  <div key={d.id} className={`p-3 rounded border flex items-center justify-between ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                    <div>
                      <div className={`font-semibold flex items-center gap-2 font-sans ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                        <span>{d.name}</span>
                        <span className={`font-mono text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>· {d.type}</span>
                      </div>
                      <div className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{d.target}</div>
                    </div>
                    <div className="text-right">
                      <span className={`font-semibold ${d.status === 'HEALTHY' ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {d.status}
                      </span>
                      <div className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{d.latencyMs}ms</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB: PRD / DR & FAILOVER */}
          {activeTab === 'dr' && (
            <div className="space-y-4 font-mono">
              <div className={`p-4 rounded border space-y-3 ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                <div className="flex items-center justify-between">
                  <div className={`text-xs font-bold font-sans ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Disaster Recovery Readiness</div>
                  <span className="text-xs text-blue-500 font-semibold">
                    {application.failoverState}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className={`p-2.5 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
                    <span className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Replication Lag</span>
                    <div className={`font-bold text-sm mt-0.5 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{application.currentReplicationLagSec} seconds</div>
                  </div>
                  <div className={`p-2.5 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
                    <span className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Last Drill Verification</span>
                    <div className={`font-bold text-sm mt-0.5 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{application.lastTestedRecoveryDate || '2026-09-18'} ({application.lastTestedRecoveryDurationMin || 22}m)</div>
                  </div>
                </div>

                <div className={`pt-2 border-t ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
                  {!confirmFailover ? (
                    <button
                      onClick={() => setConfirmFailover(true)}
                      className={`px-3 py-1.5 rounded text-xs font-semibold text-white transition-colors cursor-pointer shadow-xs ${
                        application.failoverState === 'DR_ACTIVE' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-rose-600 hover:bg-rose-700'
                      }`}
                    >
                      {application.failoverState === 'DR_ACTIVE' ? 'Initiate Failback to Primary Origin' : 'Initiate Emergency DR Failover'}
                    </button>
                  ) : (
                    <div className={`p-3 rounded border space-y-2 font-sans ${isDark ? 'bg-[#1F1710] border-amber-900' : 'bg-amber-50 border-amber-300'}`}>
                      <div className="font-bold text-amber-500 flex items-center gap-1.5 text-xs">
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        <span>Confirm Cloudflare Edge Traffic Reroute</span>
                      </div>
                      <p className={`text-[11px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                        This action modifies Cloudflare Load Balancer origin pool immediately for {application.name}.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleFailoverClick(application.failoverState === 'DR_ACTIVE' ? 'PRIMARY' : 'DR')}
                          className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold cursor-pointer"
                        >
                          Execute Reroute
                        </button>
                        <button
                          onClick={() => setConfirmFailover(false)}
                          className={`px-3 py-1 rounded text-xs cursor-pointer ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
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
              <div className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Cold Snapshot &amp; Database Dumps</div>
              {appBackups.map(b => (
                <div key={b.id} className={`p-3 rounded border space-y-1 ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex justify-between items-center">
                    <span className={`font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{b.type} · {b.sizeGb} GB</span>
                    <span className="text-[10px] text-emerald-500 uppercase font-semibold">
                      VERIFIED
                    </span>
                  </div>
                  <div className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Destination: {b.destination}</div>
                  <div className={`text-[10px] truncate ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>SHA-256: {b.integrityHash}</div>
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
                    <div className={`text-[11px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{inc.rootCause}</div>
                  </div>
                ))
              ) : (
                <div className={`p-4 text-center font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>No incident records for this application.</div>
              )}
            </div>
          )}

          {/* TAB: DEPLOYMENTS */}
          {activeTab === 'deployments' && (
            <div className="space-y-3 font-mono">
              {appDeployments.map(d => (
                <div key={d.id} className={`p-3 rounded border space-y-1 ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex justify-between items-center">
                    <span className={`font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{d.version} ({d.commitHash})</span>
                    <span className="text-[10px] text-emerald-500 uppercase font-semibold">{d.status}</span>
                  </div>
                  <div className={`text-xs font-sans ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{d.commitMessage}</div>
                  <div className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
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
                  <div key={a.id} className={`p-2.5 rounded border space-y-0.5 text-xs ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                    <div className={`flex justify-between text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                      <span>{a.operator}</span>
                      <span>{new Date(a.timestamp).toLocaleString()}</span>
                    </div>
                    <div className="font-semibold text-blue-500">{a.action}</div>
                    <div className={`text-[11px] font-sans ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{a.details}</div>
                  </div>
                ))
              ) : (
                <div className={`p-4 text-center ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>No audit log entries found.</div>
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
              className={`rounded border p-3.5 cursor-pointer transition-all flex flex-col justify-between space-y-3 min-w-0 ${
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
