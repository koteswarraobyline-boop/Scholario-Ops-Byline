import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import { VpsServer, TelemetryLevel } from '../../types';
import { Search, X, Server, ChevronRight } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { THRESHOLDS } from '../../lib/thresholds';
import { fmtNum, fmtAgo, fmtTime, LevelBadge } from './telemetryUi';
import { OverviewTab, ResourcesTab, ApplicationsTab, ServicesTab, NetworkTab, StorageTab, DatabaseTab, AgentTab } from './ServerTabs';

/** True once the agent has reported at least once (telemetry values are meaningful). */
const hasReported = (s: VpsServer) => Boolean(s.lastSeen);

const agentColor = (a: VpsServer['agentStatus']) =>
  a === 'CONNECTED' ? 'text-emerald-500' : a === 'STALE' ? 'text-amber-500' : 'text-rose-500';

const statusDot = (s: string) =>
  s === 'HEALTHY' ? 'bg-emerald-500'
    : s === 'WARNING' || s === 'STALE' ? 'bg-amber-500'
      : s === 'CRITICAL' ? 'bg-rose-500 animate-pulse'
        : 'bg-slate-500';

// Fleet issue predicates (shared by the fleet strip counts and its filters)
const failedServices = (s: VpsServer) => s.services.filter(x => x.status === 'failed').length;
const pm2Issues = (s: VpsServer) => (s.warnings ?? []).filter(w => w.category === 'pm2').length;
const dbIssues = (s: VpsServer) => (s.warnings ?? []).filter(w => w.category === 'database').length;
const worstWarning = (s: VpsServer): TelemetryLevel | null =>
  (s.warnings ?? []).some(w => w.level === 'CRITICAL') ? 'CRITICAL' : (s.warnings ?? []).length ? 'WARNING' : null;

type FleetIssue = 'CONNECTED' | 'STALE' | 'DISCONNECTED' | 'OUTDATED' | 'CLOCK' | 'FAILED_SERVICES' | 'PM2' | 'DB';
type DrawerTab = 'overview' | 'resources' | 'applications' | 'services' | 'network' | 'storage' | 'database' | 'agent' | 'processes' | 'logs';

/** One journal entry; long messages are collapsed until clicked */
const LogRow: React.FC<{ log: VpsServer['logs'][number] }> = ({ log }) => {
  const [open, setOpen] = useState(false);
  const long = log.message.length > 160;
  return (
    <div className="flex items-start gap-2">
      <span className="text-slate-500 shrink-0 w-20">{fmtTime(log.timestamp)}</span>
      <span className={`px-1 rounded text-[9px] uppercase font-bold shrink-0 w-12 text-center ${
        log.level === 'error' ? 'bg-rose-950 text-rose-300 border border-rose-900'
          : log.level === 'warn' ? 'bg-amber-950 text-amber-300 border border-amber-900'
            : 'bg-blue-950 text-blue-300 border border-blue-900'
      }`}>
        {log.level}
      </span>
      <span className="text-slate-400 shrink-0 max-w-[10rem] truncate" title={log.service}>[{log.service}]</span>
      {long ? (
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className={`text-left break-all cursor-pointer ${log.level === 'error' ? 'text-rose-300 font-semibold' : 'text-slate-300'}`}>
          <ChevronRight className={`w-3 h-3 inline mr-0.5 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
          {open ? log.message : `${log.message.slice(0, 160)}…`}
        </button>
      ) : (
        <span className={log.level === 'error' ? 'text-rose-300 font-semibold break-all' : 'text-slate-300 break-all'}>{log.message}</span>
      )}
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
  const [activeTab, setActiveTab] = useState<DrawerTab>('overview');
  const app = applications.find(a => a.id === server.applicationId);
  const reported = hasReported(server);
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';

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

  const failed = failedServices(server);
  const tabs: Array<{ id: DrawerTab; label: string; level?: TelemetryLevel | null }> = [
    { id: 'overview', label: 'Overview', level: worstWarning(server) },
    { id: 'resources', label: 'Resources' },
    { id: 'applications', label: `Applications${server.pm2 ? ` (${server.pm2.length})` : ''}`, level: (server.warnings ?? []).some(w => (w.category === 'pm2' || w.category === 'apps') && w.level === 'CRITICAL') ? 'CRITICAL' : null },
    { id: 'services', label: `Services (${server.services.length})`, level: failed ? 'CRITICAL' : null },
    { id: 'network', label: 'Network' },
    { id: 'storage', label: `Storage${server.filesystems ? ` (${server.filesystems.length})` : ''}` },
    { id: 'database', label: `Database${server.databases?.length ? ` (${server.databases.length})` : ''}` },
    { id: 'agent', label: 'Agent', level: server.agent?.outdated || (server.warnings ?? []).some(w => w.category === 'time') ? 'WARNING' : null },
    { id: 'processes', label: `Processes (${server.processes.length})` },
    { id: 'logs', label: `Logs (${server.logs.length})` },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in">
      <div
        className={`w-full max-w-6xl rounded-lg border overflow-hidden flex flex-col max-h-[90vh] shadow-2xl transition-colors ${
          isDark ? 'bg-[#101624] text-slate-100 border-[#223048]' : 'bg-white text-slate-900 border-slate-200'
        }`}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Server ${server.hostname}`}
      >
        {/* Header */}
        <div className={`p-4 px-6 border-b flex items-center justify-between ${
          isDark ? 'border-[#1E293B] bg-[#0A0F1A]' : 'border-slate-200 bg-slate-50'
        }`}>
          <div className="flex items-center gap-3 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDot(server.status)}`} aria-hidden="true" />
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
                <span className={`text-xs font-semibold ${agentColor(server.agentStatus)}`}>Agent {reported ? server.agentStatus : 'NEVER REPORTED'}</span>
                {server.agent?.outdated && <span className="text-[10px] font-bold px-1.5 rounded border border-amber-500/60 text-amber-500">OUTDATED AGENT</span>}
              </div>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                {server.provider || 'Provider: Not available'} · {server.region || 'Region: Not available'}
                {server.planSpec ? ` · ${server.planSpec.name}: ${server.planSpec.cpuCores} CPU · ${server.planSpec.ramGb} GB RAM · ${server.planSpec.diskGb} GB disk (${server.planSpec.source === 'hostinger' ? 'Hostinger API' : 'configured plan'})` : server.plan ? ` · ${server.plan}` : ''}
                {' · '}Application: <strong>{app?.name ?? 'Unassigned'}</strong>
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className={`p-1 transition-colors cursor-pointer ${isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div role="tablist" className={`flex items-center gap-1 px-4 sm:px-6 border-b text-xs font-mono overflow-x-auto min-w-0 ${
          isDark ? 'border-[#1E293B] bg-[#0C121E]' : 'border-slate-200 bg-slate-100'
        }`}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-2 px-3 font-medium whitespace-nowrap border-b-2 transition-colors cursor-pointer inline-flex items-center gap-1 ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-500 font-semibold'
                  : isDark ? 'border-transparent text-slate-400 hover:text-slate-200' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
              {tab.level && tab.level !== 'HEALTHY' && tab.level !== 'UNKNOWN' && (
                <span className={`w-1.5 h-1.5 rounded-full ${tab.level === 'CRITICAL' ? 'bg-rose-500' : 'bg-amber-500'}`} aria-label={`${tab.level.toLowerCase()} issues`} />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs font-mono" role="tabpanel">
          {activeTab === 'overview' && (
            <>
              {!reported && notReported('telemetry')}
              <OverviewTab server={server} isDark={isDark} onNavigateTab={tab => setActiveTab(tab as DrawerTab)} />
            </>
          )}
          {activeTab === 'resources' && <ResourcesTab server={server} isDark={isDark} />}
          {activeTab === 'applications' && <ApplicationsTab server={server} isDark={isDark} />}
          {activeTab === 'services' && <ServicesTab server={server} isDark={isDark} />}
          {activeTab === 'network' && <NetworkTab server={server} isDark={isDark} />}
          {activeTab === 'storage' && <StorageTab server={server} isDark={isDark} />}
          {activeTab === 'database' && <DatabaseTab server={server} isDark={isDark} />}
          {activeTab === 'agent' && <AgentTab server={server} isDark={isDark} />}

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


          {/* TAB: LOGS */}
          {activeTab === 'logs' && (
            server.logs.length === 0 ? notReported('log entries') : (
              <div className="space-y-3">
                <div className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Recent journal warnings and errors (reported by the agent) — click a long message to expand</div>
                <div className={`p-3 rounded border space-y-1.5 text-[11px] max-h-96 overflow-y-auto ${
                  isDark ? 'bg-[#070A10] text-slate-300 border-[#1E293B]' : 'bg-slate-900 text-slate-100 border-slate-800'
                }`}>
                  <div className="flex gap-2 text-[10px] uppercase text-slate-500 pb-1 border-b border-slate-800">
                    <span className="w-20">Time</span><span className="w-12 text-center">Severity</span><span>Service · Message</span>
                  </div>
                  {server.logs.map(log => <LogRow key={log.id} log={log} />)}
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
  // Fleet strip filter (combines with the environment / status filter above)
  const [issue, setIssue] = useState<FleetIssue | null>(null);
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
  const fleet: Array<{ id: FleetIssue; label: string; count: number; level: TelemetryLevel }> = [
    { id: 'CONNECTED', label: 'Connected', count: connected, level: 'HEALTHY' },
    { id: 'STALE', label: 'Stale', count: stale, level: 'WARNING' },
    { id: 'DISCONNECTED', label: 'Disconnected', count: disconnected, level: 'CRITICAL' },
    { id: 'OUTDATED', label: 'Outdated agent', count: servers.filter(x => x.agent?.outdated).length, level: 'WARNING' },
    { id: 'CLOCK', label: 'Clock issues', count: servers.filter(x => (x.warnings ?? []).some(w => w.category === 'time')).length, level: 'WARNING' },
    { id: 'FAILED_SERVICES', label: 'Failed services', count: servers.reduce((a, x) => a + failedServices(x), 0), level: 'CRITICAL' },
    { id: 'PM2', label: 'PM2 issues', count: servers.reduce((a, x) => a + pm2Issues(x), 0), level: 'WARNING' },
    { id: 'DB', label: 'DB issues', count: servers.reduce((a, x) => a + dbIssues(x), 0), level: 'WARNING' },
  ];
  const matchesIssue = (x: VpsServer) => {
    switch (issue) {
      case 'CONNECTED': return x.agentStatus === 'CONNECTED';
      case 'STALE': return x.agentStatus === 'STALE';
      case 'DISCONNECTED': return x.agentStatus === 'DISCONNECTED';
      case 'OUTDATED': return Boolean(x.agent?.outdated);
      case 'CLOCK': return (x.warnings ?? []).some(w => w.category === 'time');
      case 'FAILED_SERVICES': return failedServices(x) > 0;
      case 'PM2': return pm2Issues(x) > 0;
      case 'DB': return dbIssues(x) > 0;
      default: return true;
    }
  };

  const metricValue = (s: VpsServer, v: number) => (hasReported(s) ? v : -1);

  const filteredServers = servers
    .filter(s => {
      if (filter === 'PRD') return s.environment === 'PRD';
      if (filter === 'DR') return s.environment === 'DR';
      if (filter === 'HEALTHY') return s.status === 'HEALTHY';
      if (filter === 'CRITICAL') return s.status !== 'HEALTHY';
      return true;
    })
    .filter(matchesIssue)
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
          {/* Fleet health strip — click a count to filter the list */}
          <div className={`${statCard} font-mono text-xs flex flex-wrap items-stretch gap-1`} role="group" aria-label="Fleet health">
            <div className="px-2 py-1 mr-1">
              <div className={`text-[10px] uppercase ${muted}`}>Servers</div>
              <div className="text-base font-bold tabular-nums">{servers.length}</div>
            </div>
            {fleet.map(f => {
              const active = issue === f.id;
              const lvl: TelemetryLevel = f.count === 0 ? (f.id === 'CONNECTED' ? 'UNKNOWN' : 'HEALTHY') : f.level;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setIssue(active ? null : f.id)}
                  aria-pressed={active}
                  title={active ? 'Show all servers' : `Show only: ${f.label.toLowerCase()}`}
                  className={`px-2 py-1 rounded border text-left cursor-pointer transition-colors ${active ? 'border-blue-500 bg-blue-500/10' : isDark ? 'border-transparent hover:border-[#2A3A57]' : 'border-transparent hover:border-slate-300'}`}
                >
                  <div className={`text-[10px] uppercase ${muted}`}>{f.label}</div>
                  <LevelBadge level={lvl} label={String(f.count)} className="text-base" />
                </button>
              );
            })}
            {issue && (
              <button type="button" onClick={() => setIssue(null)} className="ml-auto self-center px-2 py-0.5 text-[11px] text-blue-500 hover:underline cursor-pointer">Clear filter</button>
            )}
          </div>

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
              <div className={`text-base font-bold tabular-nums ${fleetDiskMax !== null && fleetDiskMax >= THRESHOLDS.diskPercent.warning ? 'text-rose-500' : ''}`}>
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
                      <th className="py-2.5 px-3.5">Warnings</th>
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
                          <td className="py-2.5 px-3.5 tabular-nums">{bar(s, s.telemetry.cpuPercent, THRESHOLDS.cpuPercent.warning, 'bg-blue-500')}</td>
                          <td className="py-2.5 px-3.5 tabular-nums">{bar(s, s.telemetry.ramPercent, THRESHOLDS.memoryPercent.warning, 'bg-blue-400')}</td>
                          <td className="py-2.5 px-3.5 tabular-nums">{bar(s, s.telemetry.diskPercent, THRESHOLDS.diskPercent.warning, 'bg-indigo-400')}</td>
                          <td className={`py-2.5 px-3.5 tabular-nums ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                            {hasReported(s) ? fmtNum(s.telemetry.loadAvg?.[0], 2) : '—'}
                          </td>
                          <td className="py-2.5 px-3.5">
                            {!hasReported(s) ? <span className={muted}>—</span>
                              : worstWarning(s) ? <LevelBadge level={worstWarning(s)!} label={String(s.warnings!.length)} />
                                : s.warnings ? <LevelBadge level="HEALTHY" label="0" /> : <span className={muted}>—</span>}
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
