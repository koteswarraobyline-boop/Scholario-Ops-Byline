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
  Activity
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
        ? 'bg-[#0F172A] border-[#1E293B] text-slate-100' 
        : 'bg-white border-[#E2E8F0] text-slate-900 shadow-xs'
    }`}>
      {/* Header and App Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-inherit">
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded ${
            isDark ? 'bg-blue-950 text-blue-400 border border-blue-900' : 'bg-blue-50 text-blue-700 border border-blue-200'
          }`}>
            <Globe className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs tracking-tight">Anycast Edge &amp; Disaster Recovery Flow Architecture</span>
              <span className={`text-[10px] font-mono px-2 py-0.2 rounded font-semibold ${
                isDrActive 
                  ? (isDark ? 'bg-amber-950 text-amber-300 border border-amber-800' : 'bg-amber-100 text-amber-800 border border-amber-300')
                  : (isDark ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-emerald-100 text-emerald-800 border border-emerald-300')
              }`}>
                {isDrActive ? 'TRAFFIC DIVERTED TO DR STANDBY' : 'NOMINAL PRIMARY ROUTING'}
              </span>
            </div>
            <p className={`text-[11px] font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Cloudflare Anycast Director → Hostinger Primary Origin vs Standby DR Origin (Zero-Downtime Reroute)
            </p>
          </div>
        </div>

        {/* Application Selector */}
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Target System:</span>
          <select
            value={selectedAppId}
            onChange={e => setSelectedAppId(e.target.value)}
            className={`text-xs font-mono px-2.5 py-1 rounded border outline-none cursor-pointer ${
              isDark 
                ? 'bg-[#121A2B] border-[#223048] text-slate-100 focus:border-blue-500' 
                : 'bg-slate-50 border-slate-300 text-slate-800 focus:border-blue-500'
            }`}
          >
            {applications.map(a => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.failoverState === 'DR_ACTIVE' ? 'DR STANDBY ACTIVE' : a.status})
              </option>
            ))}
          </select>

          {/* Quick Failover / Failback Trigger Button */}
          <button
            onClick={() => triggerFailover(app.id, isDrActive ? 'PRIMARY' : 'DR')}
            className={`px-3 py-1 text-xs font-mono rounded flex items-center gap-1.5 transition-colors border shadow-xs ${
              isDrActive
                ? (isDark ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-400' : 'bg-blue-600 hover:bg-blue-700 text-white border-blue-700')
                : (isDark ? 'bg-rose-950 hover:bg-rose-900 text-rose-200 border-rose-800' : 'bg-rose-600 hover:bg-rose-700 text-white border-rose-700')
            }`}
            title="Divert live Anycast traffic"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{isDrActive ? 'Failback to Primary' : 'Emergency DR Divert'}</span>
          </button>
        </div>
      </div>

      {/* Interactive Flow Architecture Diagram */}
      <div className="py-4">
        <div className={`p-4 rounded-lg border overflow-x-auto ${
          isDark ? 'bg-[#080C14] border-[#182336]' : 'bg-[#F8FAFC] border-[#E2E8F0]'
        }`}>
          <div className="min-w-[760px] flex items-center justify-between relative py-2">
            
            {/* Step 1: Global Clients */}
            <div className={`w-44 p-3 rounded-lg border flex flex-col items-center text-center relative z-10 ${
              isDark ? 'bg-[#121A2B] border-[#1E2C44]' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-500 flex items-center justify-center mb-1.5">
                <Globe className="w-4 h-4" />
              </div>
              <span className="font-semibold text-xs font-mono">1. Worldwide Clients</span>
              <span className={`text-[10px] font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                14,200 req/min
              </span>
              <span className="text-[10px] text-emerald-500 font-mono mt-1 px-1.5 py-0.2 rounded bg-emerald-500/10">
                Anycast Global PoP
              </span>
            </div>

            {/* Connecting Connector 1 to 2 */}
            <div className="flex-1 flex flex-col items-center px-2 relative">
              <svg className="w-full h-8" preserveAspectRatio="none">
                <line 
                  x1="0" y1="16" x2="100%" y2="16" 
                  stroke={isDark ? '#2563EB' : '#3B82F6'} 
                  strokeWidth="2.5" 
                  className="animate-flow-packet"
                />
              </svg>
              <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border -mt-2 ${
                isDark ? 'bg-[#0B0F17] text-blue-400 border-blue-900' : 'bg-white text-blue-700 border-blue-200 shadow-xs'
              }`}>
                TLS 1.3 · 14ms
              </span>
            </div>

            {/* Step 2: Cloudflare Edge & WAF */}
            <div className={`w-52 p-3 rounded-lg border flex flex-col items-center text-center relative z-10 ${
              isDark ? 'bg-[#121A2B] border-[#1E2C44]' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-1.5">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <span className="font-semibold text-xs font-mono">2. Cloudflare Edge &amp; WAF</span>
              <span className={`text-[10px] font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Zone: {app.cloudflareZone}
              </span>
              <div className="flex items-center gap-1 mt-1 text-[9px] font-mono text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>SSL Full (Strict) · WAF Active</span>
              </div>
            </div>

            {/* Connecting Connector 2 to 3 */}
            <div className="flex-1 flex flex-col items-center px-2 relative">
              <svg className="w-full h-8" preserveAspectRatio="none">
                <line 
                  x1="0" y1="16" x2="100%" y2="16" 
                  stroke={isDark ? '#4F46E5' : '#6366F1'} 
                  strokeWidth="2.5" 
                  className="animate-flow-packet"
                />
              </svg>
              <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border -mt-2 ${
                isDark ? 'bg-[#0B0F17] text-indigo-400 border-indigo-900' : 'bg-white text-indigo-700 border-indigo-200 shadow-xs'
              }`}>
                LB Health Probe: 5s
              </span>
            </div>

            {/* Step 3: Cloudflare Load Balancer Pool */}
            <div className={`w-48 p-3 rounded-lg border flex flex-col items-center text-center relative z-10 ${
              isDark ? 'bg-[#121A2B] border-[#1E2C44]' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center mb-1.5">
                <Sliders className="w-4 h-4" />
              </div>
              <span className="font-semibold text-xs font-mono">3. Traffic Director</span>
              <span className={`text-[10px] font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Active Route: {isDrActive ? 'STANDBY DR' : 'PRIMARY'}
              </span>
              <span className={`text-[9px] font-mono mt-1 px-1.5 py-0.2 rounded font-semibold ${
                isDrActive ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'
              }`}>
                Failover: Zero-Loss
              </span>
            </div>

            {/* Split connectors to Origin Servers */}
            <div className="w-16 flex flex-col items-center justify-center relative">
              <div className="h-28 w-full flex flex-col justify-between items-center py-2">
                <div className={`w-full border-t-2 ${!isDrActive ? 'border-emerald-500' : 'border-dashed border-slate-600'}`} />
                <div className={`w-full border-t-2 ${isDrActive ? 'border-amber-500' : 'border-dashed border-slate-600'}`} />
              </div>
            </div>

            {/* Step 4: Origins (Primary vs DR Standby) */}
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
                    {!isDrActive ? '100% TRAFFIC' : '0% DIVERTED'}
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
                  : (isDark ? 'bg-[#121A2B] border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600')
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
        <div className={`p-2 rounded border ${
          isDark ? 'bg-[#121A2B] border-[#1D283E]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Replication Lag
          </div>
          <div className="font-semibold text-sm mt-0.5 text-emerald-500">
            {app.currentReplicationLagSec} seconds
          </div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
            Target RPO: {app.rpoTargetMin}m
          </div>
        </div>

        <div className={`p-2 rounded border ${
          isDark ? 'bg-[#121A2B] border-[#1D283E]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Failover RTO
          </div>
          <div className="font-semibold text-sm mt-0.5 text-blue-500">
            {app.rtoTargetMin} minutes
          </div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
            Automated DNS switch
          </div>
        </div>

        <div className={`p-2 rounded border ${
          isDark ? 'bg-[#121A2B] border-[#1D283E]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Origin Health Probe
          </div>
          <div className={`font-semibold text-sm mt-0.5 ${
            isHealthy ? 'text-emerald-500' : 'text-rose-500'
          }`}>
            {isHealthy ? 'Passing (200 OK)' : 'Failed (500 Error)'}
          </div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
            Polling every 10s
          </div>
        </div>

        <div className={`p-2 rounded border ${
          isDark ? 'bg-[#121A2B] border-[#1D283E]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Cloudflare Load Balancer
          </div>
          <div className="font-semibold text-sm mt-0.5 text-indigo-400">
            {isDrActive ? 'Manual Override' : 'Automatic Failover'}
          </div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
            Session affinity enabled
          </div>
        </div>
      </div>
    </div>
  );
};
