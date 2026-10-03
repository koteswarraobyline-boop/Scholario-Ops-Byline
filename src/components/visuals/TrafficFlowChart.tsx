import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { 
  Globe, 
  ShieldCheck, 
  Server, 
  Database, 
  ArrowRight, 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle2, 
  Sliders,
  Layers,
  Zap,
  Activity,
  ShieldAlert,
  Cpu
} from 'lucide-react';

export const TrafficFlowChart: React.FC = () => {
  const { applications, servers, triggerFailover, theme } = useOps();
  const isDark = theme === 'dark';

  // Allow selecting an app to view its live traffic & failover routing flow
  const [selectedAppId, setSelectedAppId] = useState<string>('app-mosaic');

  const app = applications.find(a => a.id === selectedAppId) || applications[0];
  const isDrActive = app.failoverState === 'DR_ACTIVE';
  const isHealthy = app.status === 'HEALTHY';

  const prdServer = servers.find(s => s.id === app.prdServerId);
  const drServer = servers.find(s => s.id === app.drServerId);

  return (
    <div className={`rounded-lg border p-4 transition-colors ${
      isDark 
        ? 'bg-[#111726] border-[#1E293B] text-slate-100' 
        : 'bg-white border-[#E2E8F0] text-slate-900 shadow-xs'
    }`}>
      {/* Header and App Selector */}
      <div className={`flex flex-wrap items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-100'
      }`}>
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded ${
            isDark ? 'bg-blue-950 text-blue-400 border border-blue-900' : 'bg-blue-50 text-blue-700 border border-blue-200'
          }`}>
            <Globe className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs tracking-tight">Traffic &amp; Failover Architecture Flow</span>
              <span className={`text-[10px] font-mono px-2 py-0.2 rounded font-semibold ${
                isDrActive 
                  ? (isDark ? 'bg-amber-950 text-amber-300 border border-amber-800' : 'bg-amber-100 text-amber-800 border border-amber-300')
                  : (isDark ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-emerald-100 text-emerald-800 border border-emerald-300')
              }`}>
                {isDrActive ? 'TRAFFIC DIVERTED TO DR STANDBY' : 'NOMINAL PRIMARY ROUTING'}
              </span>
            </div>
            <p className={`text-[11px] font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              End Users → Cloudflare Anycast CDN → WAF Bot Defense → Origin Pool Load Balancer → Primary (PRD) vs Standby (DR) Origins
            </p>
          </div>
        </div>

        {/* Target System & Reroute Controls */}
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Target:</span>
          <select
            value={selectedAppId}
            onChange={e => setSelectedAppId(e.target.value)}
            className={`text-xs font-mono px-2.5 py-1 rounded border outline-none cursor-pointer ${
              isDark 
                ? 'bg-[#0B0F17] border-[#223048] text-slate-100 focus:border-blue-500' 
                : 'bg-slate-50 border-slate-300 text-slate-800 focus:border-blue-500'
            }`}
          >
            {applications.map(a => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.failoverState === 'DR_ACTIVE' ? 'DR STANDBY ACTIVE' : a.status})
              </option>
            ))}
          </select>

          {/* Interactive Reroute Origin Traffic Toggle */}
          <button
            onClick={() => triggerFailover(app.id, isDrActive ? 'PRIMARY' : 'DR')}
            className={`px-3 py-1 text-xs font-mono rounded flex items-center gap-1.5 transition-colors border shadow-xs cursor-pointer ${
              isDrActive
                ? (isDark ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-400' : 'bg-blue-600 hover:bg-blue-700 text-white border-blue-700')
                : (isDark ? 'bg-rose-950 hover:bg-rose-900 text-rose-200 border-rose-800' : 'bg-rose-600 hover:bg-rose-700 text-white border-rose-700')
            }`}
            title="Interactive Reroute Origin Traffic Toggle"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{isDrActive ? 'Reroute to Primary' : 'Reroute Origin Traffic'}</span>
          </button>
        </div>
      </div>

      {/* Interactive 5-Stage Topology Architecture Diagram */}
      <div className="py-3 w-full min-w-0">
        <div className={`w-full min-w-0 p-4 rounded-lg border overflow-x-auto ${
          isDark ? 'bg-[#070B12] border-[#182336]' : 'bg-[#F8FAFC] border-[#E2E8F0]'
        }`}>
          <div className="min-w-[940px] flex items-center justify-between relative py-2">
            
            {/* Stage 1: End Users */}
            <div className={`w-38 p-3 rounded-lg border flex flex-col items-center text-center relative z-10 ${
              isDark ? 'bg-[#111726] border-[#1E2C44]' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-500 flex items-center justify-center mb-1.5">
                <Globe className="w-4 h-4" />
              </div>
              <span className="font-semibold text-xs font-mono">1. End Users</span>
              <span className={`text-[10px] font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                14,200 req/min
              </span>
              <span className="text-[10px] text-emerald-500 font-mono mt-1 px-1.5 py-0.2 rounded bg-emerald-500/10">
                Worldwide PoPs
              </span>
            </div>

            {/* Path 1 -> 2: Green Healthy Packet Pulse */}
            <div className="flex-1 flex flex-col items-center px-1.5 relative">
              <svg className="w-full h-8" preserveAspectRatio="none">
                <line 
                  x1="0" y1="16" x2="100%" y2="16" 
                  stroke="#10B981" 
                  strokeWidth="2.5" 
                  className="animate-flow-packet"
                />
              </svg>
              <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border -mt-2 ${
                isDark ? 'bg-[#0B0F17] text-emerald-400 border-emerald-900' : 'bg-white text-emerald-700 border-emerald-200 shadow-xs'
              }`}>
                TLS 1.3 · 14ms
              </span>
            </div>

            {/* Stage 2: Cloudflare Anycast CDN */}
            <div className={`w-44 p-3 rounded-lg border flex flex-col items-center text-center relative z-10 ${
              isDark ? 'bg-[#111726] border-[#1E2C44]' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-1.5">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <span className="font-semibold text-xs font-mono">2. Anycast CDN</span>
              <span className={`text-[10px] font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Edge PoPs · 330+ Cities
              </span>
              <div className="flex items-center gap-1 mt-1 text-[9px] font-mono text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>SSL Full (Strict)</span>
              </div>
            </div>

            {/* Path 2 -> 3: Split into Green Healthy & Amber Quarantined Bypass */}
            <div className="flex-1 flex flex-col items-center px-1.5 relative">
              <svg className="w-full h-12" preserveAspectRatio="none">
                {/* Main line: Green healthy flow */}
                <line 
                  x1="0" y1="14" x2="100%" y2="14" 
                  stroke="#10B981" 
                  strokeWidth="2.5" 
                  className="animate-flow-packet"
                />
                {/* Lower line: Amber Quarantined Bypass */}
                <line 
                  x1="0" y1="36" x2="100%" y2="36" 
                  stroke="#F59E0B" 
                  strokeWidth="2" 
                  strokeDasharray="4 3"
                  className="animate-flow-packet"
                />
              </svg>
              <div className="flex items-center gap-1.5 -mt-3">
                <span className={`text-[8px] font-mono px-1 py-0.2 rounded border ${
                  isDark ? 'bg-[#0B0F17] text-emerald-400 border-emerald-900' : 'bg-white text-emerald-700 border-emerald-200 shadow-xs'
                }`}>
                  Clean: 98.4%
                </span>
                <span className={`text-[8px] font-mono px-1 py-0.2 rounded border ${
                  isDark ? 'bg-[#0B0F17] text-amber-400 border-amber-900' : 'bg-white text-amber-800 border-amber-200 shadow-xs'
                }`}>
                  Quarantine: 1.6%
                </span>
              </div>
            </div>

            {/* Stage 3: WAF Bot Defense */}
            <div className={`w-44 p-3 rounded-lg border flex flex-col items-center text-center relative z-10 ${
              isDark ? 'bg-[#111726] border-[#1E2C44]' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <div className="w-8 h-8 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mb-1.5">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <span className="font-semibold text-xs font-mono">3. WAF Bot Defense</span>
              <span className={`text-[10px] font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Managed Rules &amp; ML
              </span>
              <span className="text-[9px] font-mono mt-1 px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 font-semibold">
                Quarantined Bypasses
              </span>
            </div>

            {/* Path 3 -> 4: Green Filtered Flow to LB */}
            <div className="flex-1 flex flex-col items-center px-1.5 relative">
              <svg className="w-full h-8" preserveAspectRatio="none">
                <line 
                  x1="0" y1="16" x2="100%" y2="16" 
                  stroke="#3B82F6" 
                  strokeWidth="2.5" 
                  className="animate-flow-packet"
                />
              </svg>
              <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border -mt-2 ${
                isDark ? 'bg-[#0B0F17] text-blue-400 border-blue-900' : 'bg-white text-blue-700 border-blue-200 shadow-xs'
              }`}>
                Filter · 1.2ms
              </span>
            </div>

            {/* Stage 4: Origin Pool Load Balancer */}
            <div className={`w-44 p-3 rounded-lg border flex flex-col items-center text-center relative z-10 ${
              isDark ? 'bg-[#111726] border-[#1E2C44]' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center mb-1.5">
                <Sliders className="w-4 h-4" />
              </div>
              <span className="font-semibold text-xs font-mono">4. Pool Load Balancer</span>
              <span className={`text-[10px] font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Route: {isDrActive ? 'STANDBY DR' : 'PRIMARY'}
              </span>
              <span className={`text-[9px] font-mono mt-1 px-1.5 py-0.2 rounded font-semibold ${
                isDrActive ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'
              }`}>
                Probe Rate: 5s
              </span>
            </div>

            {/* Split connectors to Origin Servers */}
            <div className="w-14 flex flex-col items-center justify-center relative">
              <div className="h-28 w-full flex flex-col justify-between items-center py-2">
                <div className={`w-full border-t-2 ${!isDrActive ? 'border-emerald-500' : 'border-dashed border-slate-600'}`} />
                <div className={`w-full border-t-2 ${isDrActive ? 'border-amber-500' : 'border-dashed border-slate-600'}`} />
              </div>
            </div>

            {/* Stage 5: Primary (PRD) vs Standby (DR) Origins */}
            <div className="w-60 space-y-2.5 z-10">
              {/* Primary Origin Node */}
              <div className={`p-2.5 rounded-lg border transition-all ${
                !isDrActive
                  ? (isDark ? 'bg-[#0E2018] border-emerald-600 ring-1 ring-emerald-500/40 text-emerald-300' : 'bg-emerald-50 border-emerald-400 text-emerald-950')
                  : (isDark ? 'bg-[#1A1215] border-rose-900/80 opacity-60 text-slate-400' : 'bg-rose-50/50 border-rose-200 opacity-60 text-slate-600')
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs font-mono flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5" />
                    <span>Hostinger PRD ({app.prdServerId})</span>
                  </span>
                  <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold ${
                    !isDrActive ? 'bg-emerald-600 text-white' : 'bg-rose-900/60 text-rose-300'
                  }`}>
                    {!isDrActive ? '100% ACTIVE' : '0% STANDBY'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono mt-1 opacity-90">
                  <span>Region: {prdServer?.region || 'Singapore'}</span>
                  <span>Port: 443 HTTPS</span>
                </div>
                <div className="text-[10px] font-mono mt-0.5">
                  MySQL Status: {!isHealthy && !isDrActive ? 'Starved (500 conn)' : 'Replicating'}
                </div>
              </div>

              {/* Standby DR Origin Node */}
              <div className={`p-2.5 rounded-lg border transition-all ${
                isDrActive
                  ? (isDark ? 'bg-[#221B0E] border-amber-500 ring-1 ring-amber-500/40 text-amber-200' : 'bg-amber-50 border-amber-400 text-amber-950')
                  : (isDark ? 'bg-[#111726] border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600')
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs font-mono flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5" />
                    <span>Hostinger DR ({app.drServerId})</span>
                  </span>
                  <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold ${
                    isDrActive ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {isDrActive ? '100% DIVERTED' : '0% STANDBY'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono mt-1 opacity-90">
                  <span>Region: {drServer?.region || 'Singapore'}</span>
                  <span>Lag: {app.currentReplicationLagSec}s</span>
                </div>
                <div className="text-[10px] font-mono mt-0.5">
                  Target RTO: {app.rtoTargetMin}m · Target RPO: {app.rpoTargetMin}m
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* High-Level Resilience Metrics Footer */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-xs">
        <div className={`p-2.5 rounded border ${
          isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Replication Lag
          </div>
          <div className="font-semibold text-sm mt-0.5 text-emerald-500">
            {app.currentReplicationLagSec} seconds
          </div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Target RPO: {app.rpoTargetMin}m
          </div>
        </div>

        <div className={`p-2.5 rounded border ${
          isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Failover RTO
          </div>
          <div className="font-semibold text-sm mt-0.5 text-blue-500">
            {app.rtoTargetMin} minutes
          </div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Automated DNS switch
          </div>
        </div>

        <div className={`p-2.5 rounded border ${
          isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Origin Health Probe
          </div>
          <div className={`font-semibold text-sm mt-0.5 ${
            isHealthy ? 'text-emerald-500' : 'text-rose-500'
          }`}>
            {isHealthy ? 'Passing (200 OK)' : 'Failed (500 Error)'}
          </div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Polling every 5s
          </div>
        </div>

        <div className={`p-2.5 rounded border ${
          isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Cloudflare Load Balancer
          </div>
          <div className="font-semibold text-sm mt-0.5 text-indigo-400">
            {isDrActive ? 'Manual Override Active' : 'Automatic Failover Nominal'}
          </div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Session affinity enabled
          </div>
        </div>
      </div>
    </div>
  );
};
