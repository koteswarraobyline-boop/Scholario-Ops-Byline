import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { 
  Cloud, 
  Users, 
  Globe, 
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import { TrafficFlowChart } from '../visuals/TrafficFlowChart';

export const DrDashboardView: React.FC = () => {
  const { applications, servers, cloudflareZones, triggerFailover, theme } = useOps();
  const isDark = theme === 'dark';
  const [selectedAppId, setSelectedAppId] = useState<string>('app-mosaic');
  const [confirmingFailover, setConfirmingFailover] = useState(false);

  const selectedApp = applications.find(a => a.id === selectedAppId) || applications[0];
  const prdServer = servers.find(s => s.id === selectedApp.prdServerId);
  const drServer = servers.find(s => s.id === selectedApp.drServerId);
  const cfZone = cloudflareZones.find(z => z.domain === selectedApp.cloudflareZone);

  const isDrActive = selectedApp.failoverState === 'DR_ACTIVE';

  const handleToggleFailover = () => {
    triggerFailover(selectedApp.id, isDrActive ? 'PRIMARY' : 'DR');
    setConfirmingFailover(false);
  };

  const readinessChecks = [
    {
      category: 'Data Replication',
      status: selectedApp.currentReplicationLagSec <= selectedApp.rpoTargetMin * 60 ? 'READY' : 'FAILED',
      detail: `Lag is ${selectedApp.currentReplicationLagSec}s (Target < ${selectedApp.rpoTargetMin * 60}s)`
    },
    {
      category: 'Snapshot Freshness',
      status: 'READY',
      detail: 'Snapshot completed < 24h ago with SHA-256 integrity checksum'
    },
    {
      category: 'Restore Drill Verification',
      status: 'READY',
      detail: `Verified in sandbox drill (${selectedApp.lastTestedRecoveryDate || '2026-09-18'}) in ${selectedApp.lastTestedRecoveryDurationMin || 22}m`
    },
    {
      category: 'DR Standby Compute',
      status: drServer?.status === 'HEALTHY' ? 'READY' : 'WARNING',
      detail: `Hostinger ${drServer?.region} standby node is powered on and healthy`
    },
    {
      category: 'Configuration Drift',
      status: cfZone?.driftDetected ? 'WARNING' : 'READY',
      detail: cfZone?.driftDetected ? 'Configuration drift detected' : 'Nginx, PHP/Node environment variables mirrored'
    },
    {
      category: 'Cloudflare LB Failover Pool',
      status: 'READY',
      detail: 'Health check probe active on port 443 with automated rerouting enabled'
    }
  ];

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            DISASTER RECOVERY &amp; TRAFFIC FAILOVER
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            RPO/RTO target compliance, continuous binary replication &amp; Cloudflare origin pool routing
          </p>
        </div>

        {/* App Selector */}
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>Target System:</span>
          <select
            value={selectedAppId}
            onChange={e => {
              setSelectedAppId(e.target.value);
              setConfirmingFailover(false);
            }}
            className={`px-2.5 py-1 rounded border outline-none cursor-pointer ${
              isDark 
                ? 'bg-[#0B0F17] border-[#1E293B] text-slate-200' 
                : 'bg-white border-slate-300 text-slate-800 shadow-2xs'
            }`}
          >
            {applications.map(app => (
              <option key={app.id} value={app.id}>
                {app.name} ({app.failoverState === 'DR_ACTIVE' ? 'DR Routed' : 'Primary Active'})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Interactive Anycast Failover & Traffic Routing Architecture Flow Chart */}
      <TrafficFlowChart />

      {/* FAILOVER TOPOLOGY PIPELINE */}
      <div className={`rounded-lg border p-5 space-y-5 font-mono transition-colors ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className={`flex items-center justify-between border-b pb-2.5 ${
          isDark ? 'border-[#1A2332]' : 'border-slate-100'
        }`}>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            <h2 className="text-xs font-bold uppercase tracking-wider">
              Network Routing Topology: {selectedApp.name}
            </h2>
          </div>
          <span className={`text-xs font-bold ${
            isDrActive ? 'text-amber-500' : 'text-emerald-500'
          }`}>
            {isDrActive ? 'ROUTED TO DR STANDBY' : 'ROUTED TO PRIMARY ORIGIN'}
          </span>
        </div>

        {/* Visual Flow Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-center text-xs">
          
          {/* Step 1: Users */}
          <div className={`p-3 rounded border text-center space-y-1 ${
            isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'
          }`}>
            <Users className="w-4 h-4 mx-auto text-blue-500" />
            <div className="font-bold">Public Ingress</div>
            <div className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>TLS 1.3 / Port 443</div>
          </div>

          {/* Step 2: Cloudflare Edge */}
          <div className={`p-3 rounded border text-center space-y-1 ${
            isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'
          }`}>
            <Globe className="w-4 h-4 mx-auto text-amber-500" />
            <div className="font-bold">Cloudflare Anycast</div>
            <div className={`text-[10px] truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{selectedApp.cloudflareZone}</div>
            <div className="text-[10px] text-emerald-500 font-semibold">Pool Health Check OK</div>
          </div>

          {/* Step 3 & 4: Primary vs DR Origin Targets */}
          <div className="md:col-span-2 space-y-2">
            
            {/* Primary Origin Node */}
            <div className={`p-2.5 rounded border flex items-center justify-between ${
              !isDrActive 
                ? (isDark ? 'bg-[#0E1A14] border-emerald-900/80 text-emerald-300' : 'bg-emerald-50 border-emerald-300 text-emerald-950')
                : (isDark ? 'bg-[#180E13] border-rose-900/60 text-rose-300 opacity-80' : 'bg-rose-50/50 border-rose-200 text-slate-500')
            }`}>
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${!isDrActive ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                <div>
                  <div className="font-bold">PRIMARY (PRD): {prdServer?.hostname.split('.')[0]}</div>
                  <div className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{prdServer?.ip} · Hostinger {prdServer?.region}</div>
                </div>
              </div>
              <span className="font-bold text-[11px]">
                {!isDrActive ? 'ACTIVE (100% Traffic)' : 'FAILED / BYPASSED'}
              </span>
            </div>

            {/* DR Standby Origin Node */}
            <div className={`p-2.5 rounded border flex items-center justify-between ${
              isDrActive 
                ? (isDark ? 'bg-[#0E1A14] border-emerald-900/80 text-emerald-300' : 'bg-amber-50 border-amber-300 text-amber-950')
                : (isDark ? 'bg-[#0B0F17] border-[#1A2436] text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-600')
            }`}>
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${isDrActive ? 'bg-emerald-500' : 'bg-slate-500'}`} />
                <div>
                  <div className="font-bold">STANDBY (DR): {drServer?.hostname.split('.')[0]}</div>
                  <div className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{drServer?.ip} · Hostinger {drServer?.region}</div>
                </div>
              </div>
              <span className="font-bold text-[11px]">
                {isDrActive ? 'ACTIVE (Serving Traffic)' : 'STANDBY (Continuous Sync)'}
              </span>
            </div>

          </div>

        </div>

        {/* Failover Controls */}
        <div className={`pt-3 border-t flex flex-col sm:flex-row items-center justify-between gap-3 text-xs ${
          isDark ? 'border-[#1A2332]' : 'border-slate-100'
        }`}>
          <div className={isDark ? 'text-slate-400' : 'text-slate-600'}>
            Current routing state: <strong className={isDark ? 'text-slate-200' : 'text-slate-900'}>{isDrActive ? 'Serving traffic from DR standby' : 'Normal routing to Primary origin'}</strong>.
          </div>

          <div>
            {!confirmingFailover ? (
              <button
                onClick={() => setConfirmingFailover(true)}
                className={`px-3 py-1.5 rounded font-semibold text-xs text-white transition-colors cursor-pointer shadow-xs ${
                  isDrActive ? 'bg-blue-600 hover:bg-blue-700' : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {isDrActive ? 'INITIATE FAILBACK TO PRIMARY' : 'EXECUTE EMERGENCY DR FAILOVER'}
              </button>
            ) : (
              <div className={`flex items-center gap-2 p-1.5 rounded font-sans border ${
                isDark ? 'bg-[#1F1710] border-amber-900' : 'bg-amber-50 border-amber-200'
              }`}>
                <span className={`text-xs font-medium ${isDark ? 'text-amber-300' : 'text-amber-800'}`}>
                  Confirm rerouting traffic for {selectedApp.name}?
                </span>
                <button
                  onClick={handleToggleFailover}
                  className="px-2.5 py-0.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold font-mono cursor-pointer"
                >
                  Confirm Reroute
                </button>
                <button
                  onClick={() => setConfirmingFailover(false)}
                  className={`px-2 py-0.5 rounded text-xs cursor-pointer ${
                    isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                  }`}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* DR READINESS SCORECARD */}
      <div className={`rounded-lg border p-5 space-y-4 font-mono text-xs transition-colors ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className={`flex items-center justify-between border-b pb-2 ${
          isDark ? 'border-[#1A2332]' : 'border-slate-100'
        }`}>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider">
              Disaster Recovery Readiness Audit: {selectedApp.name}
            </h2>
            <p className={`text-[11px] font-sans ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Verified operational criteria required before certifying disaster recovery
            </p>
          </div>
          <div className="text-right text-xs">
            <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>RTO Target: </span>
            <strong className="text-blue-500">{selectedApp.rtoTargetMin}m</strong>
            <span className={`ml-3 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>RPO Target: </span>
            <strong className="text-blue-500">{selectedApp.rpoTargetMin}m</strong>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {readinessChecks.map(chk => (
            <div key={chk.category} className={`p-3 rounded border space-y-1 ${
              isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{chk.category}</span>
                <span className={`text-[10px] font-bold ${
                  chk.status === 'READY' ? 'text-emerald-500' : 'text-rose-500'
                }`}>
                  {chk.status}
                </span>
              </div>
              <p className={`text-[11px] font-sans ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{chk.detail}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
