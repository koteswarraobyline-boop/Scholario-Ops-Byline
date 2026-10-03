import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { VpsServer } from '../../types';
import { 
  Server, 
  Search, 
  X, 
  Terminal, 
  ArrowRight,
  Cpu,
  Database,
  Activity,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { TelemetryAreaGraph } from '../visuals/TelemetryAreaGraph';

interface VpsDetailModalProps {
  server: VpsServer;
  onClose: () => void;
  isDark: boolean;
}

export const VpsDetailModal: React.FC<VpsDetailModalProps> = ({ server, onClose, isDark }) => {
  const { applications } = useOps();
  const [activeTab, setActiveTab] = useState<'system' | 'processes' | 'services' | 'logs'>('system');
  const app = applications.find(a => a.id === server.applicationId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in">
      <div 
        className={`w-full max-w-4xl rounded-lg border overflow-hidden flex flex-col max-h-[90vh] shadow-2xl transition-colors ${
          isDark ? 'bg-[#101624] text-slate-100 border-[#223048]' : 'bg-white text-slate-900 border-slate-200'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-4 px-6 border-b flex items-center justify-between ${
          isDark ? 'border-[#1E293B] bg-[#0A0F1A]' : 'border-slate-200 bg-slate-50'
        }`}>
          <div className="flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full ${server.status === 'HEALTHY' ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
            <div>
              <div className="flex items-center gap-2 font-mono">
                <h2 className="text-base font-bold">{server.hostname}</h2>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                  server.environment === 'PRD' 
                    ? (isDark ? 'bg-blue-950 text-blue-400 border border-blue-900' : 'bg-blue-50 text-blue-700 border border-blue-200')
                    : (isDark ? 'bg-amber-950 text-amber-400 border border-amber-900' : 'bg-amber-50 text-amber-700 border border-amber-200')
                }`}>{server.environment}</span>
                <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
                <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{server.ip}</span>
              </div>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Hostinger {server.region} · {server.plan} · Workload: <strong>{app?.name}</strong>
              </p>
            </div>
          </div>
          <button onClick={onClose} className={`p-1 transition-colors cursor-pointer ${isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className={`flex items-center gap-1 px-6 border-b text-xs font-mono ${
          isDark ? 'border-[#1E293B] bg-[#0C121E]' : 'border-slate-200 bg-slate-100'
        }`}>
          {[
            { id: 'system', label: 'System & Telemetry' },
            { id: 'processes', label: `Processes (${server.processes.length})` },
            { id: 'services', label: `Services (${server.services.length})` },
            { id: 'logs', label: `Operational Logs (${server.logs.length})` }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-2 px-3 font-medium whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-500 font-semibold'
                  : isDark ? 'border-transparent text-slate-400 hover:text-slate-200' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs font-mono">
          
          {/* TAB: SYSTEM */}
          {activeTab === 'system' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className={`p-3 rounded border ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>CPU Load</div>
                  <div className={`text-base font-bold tabular-nums ${server.telemetry.cpuPercent > 80 ? 'text-rose-500' : (isDark ? 'text-slate-100' : 'text-slate-900')}`}>
                    {server.telemetry.cpuPercent}%
                  </div>
                  <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{server.cpuCores} vCPU Cores</div>
                </div>

                <div className={`p-3 rounded border ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Memory RAM</div>
                  <div className={`text-base font-bold tabular-nums ${server.telemetry.ramPercent > 80 ? 'text-rose-500' : (isDark ? 'text-slate-100' : 'text-slate-900')}`}>
                    {server.telemetry.ramPercent}%
                  </div>
                  <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{server.ramGb} GB DDR5</div>
                </div>

                <div className={`p-3 rounded border ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>NVMe Storage</div>
                  <div className={`text-base font-bold tabular-nums ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                    {server.telemetry.diskPercent}%
                  </div>
                  <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{server.diskGb} GB NVMe</div>
                </div>

                <div className={`p-3 rounded border ${isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Load Average</div>
                  <div className={`text-base font-bold tabular-nums ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                    {server.telemetry.loadAvg[0].toFixed(2)}
                  </div>
                  <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    5m: {server.telemetry.loadAvg[1].toFixed(2)} · 15m: {server.telemetry.loadAvg[2].toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Hostinger Specifications */}
              <div className={`p-4 rounded border space-y-2 font-mono ${
                isDark ? 'bg-[#0A0F1A] border-[#1E293B]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="text-xs font-semibold text-blue-500 uppercase tracking-wider">Hostinger Hypervisor Metadata</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>OS Platform:</span>
                    <p className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{server.os}</p>
                  </div>
                  <div>
                    <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Network In / Out:</span>
                    <p className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                      {(server.telemetry.networkInKbps / 1024).toFixed(1)} / {(server.telemetry.networkOutKbps / 1024).toFixed(1)} Mbps
                    </p>
                  </div>
                  <div>
                    <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Kernel:</span>
                    <p className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>Linux 6.8.0-45-generic</p>
                  </div>
                  <div>
                    <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Uptime:</span>
                    <p className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{server.uptimeDays} days</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: PROCESSES */}
          {activeTab === 'processes' && (
            <div className="space-y-3">
              <div className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Top Workload Daemons</div>
              <div className={`border rounded overflow-hidden ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
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
                      <tr key={p.pid} className={isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}>
                        <td className="py-2 px-3">{p.pid}</td>
                        <td className={`py-2 px-3 font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{p.name}</td>
                        <td className={`py-2 px-3 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{p.user}</td>
                        <td className={`py-2 px-3 text-right tabular-nums ${p.cpuPercent > 50 ? 'text-rose-500 font-bold' : (isDark ? 'text-slate-200' : 'text-slate-800')}`}>
                          {p.cpuPercent}%
                        </td>
                        <td className={`py-2 px-3 text-right tabular-nums ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{p.memMb} MB</td>
                        <td className="py-2 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            p.status === 'running' ? 'bg-emerald-500/20 text-emerald-500 font-bold' : 'text-slate-500'
                          }`}>
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB: SERVICES */}
          {activeTab === 'services' && (
            <div className="space-y-3">
              <div className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Managed Systemd Daemons</div>
              <div className={`border rounded overflow-hidden ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
                <table className="w-full text-left text-xs">
                  <thead className={`border-b ${isDark ? 'bg-[#0A0F1A] text-slate-400 border-[#1E293B]' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                    <tr>
                      <th className="py-2 px-3">Service Name</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Version</th>
                      <th className="py-2 px-3">PID</th>
                      <th className="py-2 px-3 text-right">Memory</th>
                      <th className="py-2 px-3 text-right">Last Restart</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-200'}`}>
                    {server.services.map(svc => (
                      <tr key={svc.name} className={isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}>
                        <td className={`py-2 px-3 font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{svc.name}</td>
                        <td className="py-2 px-3">
                          <span className={`font-semibold ${svc.status === 'active' ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {svc.status}
                          </span>
                        </td>
                        <td className={`py-2 px-3 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{svc.version}</td>
                        <td className={`py-2 px-3 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{svc.pid}</td>
                        <td className={`py-2 px-3 text-right tabular-nums ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{svc.memoryMb} MB</td>
                        <td className={`py-2 px-3 text-right ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{svc.lastRestart}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB: LOGS */}
          {activeTab === 'logs' && (
            <div className="space-y-3">
              <div className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Operational Syslog Stream</div>
              <div className={`p-3 rounded border space-y-1.5 text-[11px] max-h-64 overflow-y-auto ${
                isDark ? 'bg-[#070A10] text-slate-300 border-[#1E293B]' : 'bg-slate-900 text-slate-100 border-slate-800'
              }`}>
                {server.logs.length > 0 ? (
                  server.logs.map(log => (
                    <div key={log.id} className="flex items-start gap-2">
                      <span className="text-slate-500 shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
                      <span className={`px-1 rounded text-[9px] uppercase font-bold shrink-0 ${
                        log.level === 'error' ? 'bg-rose-950 text-rose-300 border border-rose-900' : 'bg-blue-950 text-blue-300 border border-blue-900'
                      }`}>
                        {log.level}
                      </span>
                      <span className="text-slate-400 shrink-0">[{log.service}]</span>
                      <span className={log.level === 'error' ? 'text-rose-300 font-semibold' : 'text-slate-300'}>
                        {log.message}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-slate-500 py-4 text-center">No anomalous syslog events.</div>
                )}
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
  const { servers, applications, selectedServerId, setSelectedServerId, theme } = useOps();
  const isDark = theme === 'dark';

  const [filter, setFilter] = useState<'ALL' | 'PRD' | 'DR' | 'HEALTHY' | 'CRITICAL'>('ALL');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'hostname' | 'cpu' | 'ram' | 'disk'>('hostname');

  const selectedServer = servers.find(s => s.id === selectedServerId);

  // Time-series sample points for Fleet Telemetry Area Graphs
  const fleetCpuHistory = [38, 41, 44, 48, 55, 62, 70, 78, 82, 85, 76, 72];
  const fleetRamHistory = [60, 61, 62, 64, 66, 71, 74, 76, 78, 77, 76, 75];
  const fleetDiskHistory = [48, 48, 49, 49, 50, 50, 51, 51, 52, 52, 52, 52];
  const fleetNetworkHistory = [18, 22, 25, 29, 38, 56, 72, 88, 70, 60, 52, 58];

  const filteredServers = servers
    .filter(s => {
      if (filter === 'PRD') return s.environment === 'PRD';
      if (filter === 'DR') return s.environment === 'DR';
      if (filter === 'HEALTHY') return s.status === 'HEALTHY';
      if (filter === 'CRITICAL') return s.status !== 'HEALTHY';
      return true;
    })
    .filter(s => {
      const q = search.toLowerCase();
      return (
        s.hostname.toLowerCase().includes(q) ||
        s.ip.includes(q) ||
        s.region.toLowerCase().includes(q) ||
        s.plan.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === 'cpu') return b.telemetry.cpuPercent - a.telemetry.cpuPercent;
      if (sortBy === 'ram') return b.telemetry.ramPercent - a.telemetry.ramPercent;
      if (sortBy === 'disk') return b.telemetry.diskPercent - a.telemetry.diskPercent;
      return a.hostname.localeCompare(b.hostname);
    });

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
            HOSTINGER VPS INFRASTRUCTURE
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            16 Dedicated Virtual Private Servers across Singapore, Frankfurt, Mumbai, London
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
                isDark 
                  ? 'bg-[#0B0F17] border-[#1E293B] text-slate-200' 
                  : 'bg-white border-slate-300 text-slate-800'
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
            onChange={e => setSortBy(e.target.value as any)}
            className={`px-2 py-1 rounded text-xs focus:outline-none border cursor-pointer ${
              isDark 
                ? 'bg-[#0B0F17] border-[#1E293B] text-slate-300' 
                : 'bg-white border-slate-300 text-slate-700'
            }`}
          >
            <option value="hostname">Sort: Hostname</option>
            <option value="cpu">Sort: CPU %</option>
            <option value="ram">Sort: RAM %</option>
            <option value="disk">Sort: Disk %</option>
          </select>
        </div>
      </div>

      {/* Fleet Resource Graphs */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            <h3 className="text-xs font-bold uppercase tracking-wider font-mono">
              Fleet Telemetry Aggregation (16 Nodes)
            </h3>
          </div>
          <span className={`text-[10px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Hypervisor telemetry pulled via Hostinger API
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <TelemetryAreaGraph
            title="Fleet Average CPU"
            subtitle="16 Hostinger VPS"
            data={fleetCpuHistory}
            unit="%"
            warningThreshold={80}
            color="rose"
          />
          <TelemetryAreaGraph
            title="Fleet Average RAM"
            subtitle="ECC Memory Mesh"
            data={fleetRamHistory}
            unit="%"
            warningThreshold={85}
            color="amber"
          />
          <TelemetryAreaGraph
            title="NVMe Disk Allocation"
            subtitle="RAID-10 Arrays"
            data={fleetDiskHistory}
            unit="%"
            color="blue"
          />
          <TelemetryAreaGraph
            title="Network Inbound / Out"
            subtitle="Bandwidth Saturation"
            data={fleetNetworkHistory}
            unit=" Mbps"
            color="emerald"
          />
        </div>
      </div>

      {/* Servers Table */}
      <div className={`rounded-lg border overflow-hidden transition-colors ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className={`font-medium border-b ${
              isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}>
              <tr>
                <th className="py-2.5 px-3.5">VPS Hostname</th>
                <th className="py-2.5 px-3.5">Environment</th>
                <th className="py-2.5 px-3.5">Application</th>
                <th className="py-2.5 px-3.5">Region</th>
                <th className="py-2.5 px-3.5">CPU Load</th>
                <th className="py-2.5 px-3.5">RAM Usage</th>
                <th className="py-2.5 px-3.5">Disk NVMe</th>
                <th className="py-2.5 px-3.5">Load (1m)</th>
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
                      isCrit 
                        ? (isDark ? 'bg-[#180E13]' : 'bg-rose-50/70') 
                        : (isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50')
                    }`}
                  >
                    <td className="py-2.5 px-3.5">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${s.status === 'HEALTHY' ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
                        <span className={`font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{s.hostname.split('.')[0]}</span>
                      </div>
                      <div className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{s.ip}</div>
                    </td>

                    <td className="py-2.5 px-3.5">
                      <span className={s.environment === 'PRD' ? 'text-blue-500 font-semibold' : (isDark ? 'text-slate-400' : 'text-slate-500')}>
                        {s.environment}
                      </span>
                    </td>

                    <td className={`py-2.5 px-3.5 font-sans ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                      {app?.name}
                    </td>

                    <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                      {s.region}
                    </td>

                    <td className="py-2.5 px-3.5 tabular-nums">
                      <div className="flex items-center gap-2">
                        <div className={`w-14 h-1.5 rounded overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                          <div 
                            className={`h-full ${s.telemetry.cpuPercent > 80 ? 'bg-rose-500' : 'bg-blue-500'}`}
                            style={{ width: `${Math.min(100, s.telemetry.cpuPercent)}%` }}
                          />
                        </div>
                        <span className={s.telemetry.cpuPercent > 80 ? 'text-rose-500 font-bold' : (isDark ? 'text-slate-200' : 'text-slate-800')}>
                          {s.telemetry.cpuPercent}%
                        </span>
                      </div>
                    </td>

                    <td className="py-2.5 px-3.5 tabular-nums">
                      <div className="flex items-center gap-2">
                        <div className={`w-14 h-1.5 rounded overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                          <div 
                            className={`h-full ${s.telemetry.ramPercent > 80 ? 'bg-rose-500' : 'bg-blue-400'}`}
                            style={{ width: `${Math.min(100, s.telemetry.ramPercent)}%` }}
                          />
                        </div>
                        <span className={s.telemetry.ramPercent > 80 ? 'text-rose-500 font-bold' : (isDark ? 'text-slate-200' : 'text-slate-800')}>
                          {s.telemetry.ramPercent}%
                        </span>
                      </div>
                    </td>

                    <td className={`py-2.5 px-3.5 tabular-nums ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                      {s.telemetry.diskPercent}%
                    </td>

                    <td className={`py-2.5 px-3.5 tabular-nums ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                      {s.telemetry.loadAvg[0].toFixed(2)}
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
      </div>
    </div>
  );
};
