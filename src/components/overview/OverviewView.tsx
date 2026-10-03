import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { 
  Layers, 
  Server, 
  Radio, 
  AlertTriangle, 
  Cloud, 
  Database, 
  ShieldCheck, 
  Activity, 
  ArrowRight, 
  RefreshCw, 
  CheckCircle2, 
  Terminal,
  Zap,
  Cpu,
  Globe,
  Sliders
} from 'lucide-react';
import { HeartbeatPulseChart } from '../visuals/HeartbeatPulseChart';
import { TrafficFlowChart } from '../visuals/TrafficFlowChart';
import { IncidentFlowChart } from '../visuals/IncidentFlowChart';
import { TelemetryAreaGraph } from '../visuals/TelemetryAreaGraph';

export const OverviewView: React.FC = () => {
  const { 
    applications, 
    servers, 
    deadMan, 
    systemSummary, 
    lastUpdatedSecondsAgo, 
    setActiveTab, 
    setSelectedAppId, 
    setSelectedIncidentId,
    incidents,
    triggerSimulatedScenario,
    runAllProbes,
    theme
  } = useOps();

  const isDark = theme === 'dark';
  const activeIncident = incidents.find(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED');

  // Simulated time-series telemetry data points for live graphs
  const cpuData = [42, 45, 48, 52, 68, 88, 94, 96, 95, 92, 89, 91];
  const ramData = [62, 63, 65, 68, 74, 82, 86, 91, 93, 94, 92, 93];
  const networkData = [12, 14, 15, 18, 24, 45, 62, 78, 65, 52, 48, 55];
  const latencyData = [18, 20, 22, 21, 35, 84, 145, 280, 210, 160, 42, 38];

  return (
    <div className="space-y-6">
      
      {/* 1. Header Section */}
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight font-mono">
              OPERATIONS COMMAND CENTER
            </h1>
            <span className={`text-[10px] font-mono px-2 py-0.2 rounded font-semibold ${
              isDark 
                ? 'text-emerald-400 bg-emerald-950/60 border border-emerald-800/80' 
                : 'text-emerald-700 bg-emerald-50 border border-emerald-200'
            }`}>
              LIVE TELEMETRY
            </span>
          </div>
          <p className={`text-xs mt-0.5 flex items-center gap-2 font-mono ${
            isDark ? 'text-slate-400' : 'text-slate-600'
          }`}>
            <span>Continuous infrastructure, DR resilience &amp; monitor plane</span>
            <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
            <span>Telemetry refreshed {lastUpdatedSecondsAgo}s ago</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => runAllProbes()}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium rounded transition-colors border cursor-pointer ${
              isDark 
                ? 'text-slate-200 bg-[#162033] hover:bg-[#1C2942] border-[#243552]' 
                : 'text-slate-700 bg-white hover:bg-slate-50 border-slate-300 shadow-2xs'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5 text-blue-500" />
            <span>PROBE MONITORS</span>
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors shadow-xs cursor-pointer"
          >
            <span>DAILY REPORT</span>
          </button>
        </div>
      </div>

      {/* 2. Global Health Metrics Bar (High-Density & Clean) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
        
        {/* Applications */}
        <button
          onClick={() => setActiveTab('applications')}
          className={`p-3 rounded border text-left transition-all group cursor-pointer ${
            isDark 
              ? 'bg-[#111726] border-[#1E293B] hover:border-blue-500' 
              : 'bg-white border-slate-200 hover:border-blue-400 shadow-xs'
          }`}
        >
          <div className="text-[10px] font-mono font-medium text-slate-400 flex items-center justify-between">
            <span>APPLICATIONS</span>
            <Layers className="w-3 h-3 text-slate-400 group-hover:text-blue-500" />
          </div>
          <div className={`mt-1 text-base font-bold font-mono tabular-nums ${
            isDark ? 'text-slate-100' : 'text-slate-900'
          }`}>
            {systemSummary.healthyApps} / {systemSummary.totalApps}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
            {systemSummary.healthyApps === systemSummary.totalApps ? 'All nominal' : '1 degraded'}
          </div>
        </button>

        {/* Infrastructure */}
        <button
          onClick={() => setActiveTab('infrastructure')}
          className={`p-3 rounded border text-left transition-all group cursor-pointer ${
            isDark 
              ? 'bg-[#111726] border-[#1E293B] hover:border-blue-500' 
              : 'bg-white border-slate-200 hover:border-blue-400 shadow-xs'
          }`}
        >
          <div className="text-[10px] font-mono font-medium text-slate-400 flex items-center justify-between">
            <span>VPS FLEET</span>
            <Server className="w-3 h-3 text-slate-400 group-hover:text-blue-500" />
          </div>
          <div className={`mt-1 text-base font-bold font-mono tabular-nums ${
            isDark ? 'text-slate-100' : 'text-slate-900'
          }`}>
            {systemSummary.healthyServers} / {systemSummary.totalServers}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
            Hostinger Nodes
          </div>
        </button>

        {/* Monitors */}
        <button
          onClick={() => setActiveTab('monitors')}
          className={`p-3 rounded border text-left transition-all group cursor-pointer ${
            isDark 
              ? 'bg-[#111726] border-[#1E293B] hover:border-blue-500' 
              : 'bg-white border-slate-200 hover:border-blue-400 shadow-xs'
          }`}
        >
          <div className="text-[10px] font-mono font-medium text-slate-400 flex items-center justify-between">
            <span>MONITORS</span>
            <Radio className="w-3 h-3 text-slate-400 group-hover:text-blue-500" />
          </div>
          <div className={`mt-1 text-base font-bold font-mono tabular-nums ${
            isDark ? 'text-slate-100' : 'text-slate-900'
          }`}>
            {systemSummary.healthyMonitors} / {systemSummary.totalMonitors}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
            30s intervals
          </div>
        </button>

        {/* Incidents */}
        <button
          onClick={() => setActiveTab('incidents')}
          className={`p-3 rounded border text-left transition-all group cursor-pointer ${
            systemSummary.openIncidents > 0 
              ? (isDark ? 'bg-[#180E13] border-rose-900/80 hover:border-rose-700' : 'bg-rose-50/70 border-rose-300 hover:border-rose-400')
              : (isDark ? 'bg-[#111726] border-[#1E293B] hover:border-blue-500' : 'bg-white border-slate-200 hover:border-blue-400 shadow-xs')
          }`}
        >
          <div className="text-[10px] font-mono font-medium text-slate-400 flex items-center justify-between">
            <span>INCIDENTS</span>
            <AlertTriangle className={`w-3 h-3 ${systemSummary.openIncidents > 0 ? 'text-rose-500' : 'text-slate-400'}`} />
          </div>
          <div className={`mt-1 text-base font-bold font-mono tabular-nums ${
            systemSummary.openIncidents > 0 ? 'text-rose-500' : (isDark ? 'text-slate-100' : 'text-slate-900')
          }`}>
            {systemSummary.openIncidents} open
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
            {systemSummary.criticalIncidents > 0 ? `${systemSummary.criticalIncidents} critical` : 'None critical'}
          </div>
        </button>

        {/* DR Readiness */}
        <button
          onClick={() => setActiveTab('resilience')}
          className={`p-3 rounded border text-left transition-all group cursor-pointer ${
            isDark 
              ? 'bg-[#111726] border-[#1E293B] hover:border-blue-500' 
              : 'bg-white border-slate-200 hover:border-blue-400 shadow-xs'
          }`}
        >
          <div className="text-[10px] font-mono font-medium text-slate-400 flex items-center justify-between">
            <span>DR READY</span>
            <Cloud className="w-3 h-3 text-slate-400 group-hover:text-blue-500" />
          </div>
          <div className={`mt-1 text-base font-bold font-mono tabular-nums ${
            isDark ? 'text-slate-100' : 'text-slate-900'
          }`}>
            {systemSummary.drReadinessCount} / {systemSummary.totalApps}
          </div>
          <div className="text-[10px] text-emerald-500 font-mono mt-0.5 font-medium">
            RPO &lt; 15m
          </div>
        </button>

        {/* Backups */}
        <button
          onClick={() => setActiveTab('backups')}
          className={`p-3 rounded border text-left transition-all group cursor-pointer ${
            isDark 
              ? 'bg-[#111726] border-[#1E293B] hover:border-blue-500' 
              : 'bg-white border-slate-200 hover:border-blue-400 shadow-xs'
          }`}
        >
          <div className="text-[10px] font-mono font-medium text-slate-400 flex items-center justify-between">
            <span>BACKUPS</span>
            <Database className="w-3 h-3 text-slate-400 group-hover:text-blue-500" />
          </div>
          <div className={`mt-1 text-base font-bold font-mono tabular-nums ${
            isDark ? 'text-slate-100' : 'text-slate-900'
          }`}>
            {systemSummary.backupsCurrentCount} / {systemSummary.totalApps}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
            SHA-256 ok
          </div>
        </button>

        {/* Cloudflare */}
        <button
          onClick={() => setActiveTab('cloudflare')}
          className={`p-3 rounded border text-left transition-all group cursor-pointer ${
            isDark 
              ? 'bg-[#111726] border-[#1E293B] hover:border-blue-500' 
              : 'bg-white border-slate-200 hover:border-blue-400 shadow-xs'
          }`}
        >
          <div className="text-[10px] font-mono font-medium text-slate-400 flex items-center justify-between">
            <span>CLOUDFLARE</span>
            <ShieldCheck className="w-3 h-3 text-slate-400 group-hover:text-blue-500" />
          </div>
          <div className={`mt-1 text-xs font-bold font-mono truncate ${
            systemSummary.cloudflareStatus === 'DEGRADED' ? 'text-amber-500' : 'text-emerald-500'
          }`}>
            {systemSummary.cloudflareStatus === 'DEGRADED' ? 'LB Failover' : 'Nominal'}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
            WAF / Anycast
          </div>
        </button>

        {/* External Watchdog */}
        <button
          onClick={() => setActiveTab('monitors')}
          className={`p-3 rounded border text-left transition-all group cursor-pointer ${
            isDark 
              ? 'bg-[#111726] border-[#1E293B] hover:border-blue-500' 
              : 'bg-white border-slate-200 hover:border-blue-400 shadow-xs'
          }`}
        >
          <div className="text-[10px] font-mono font-medium text-slate-400 flex items-center justify-between">
            <span>DEAD-MAN</span>
            <Activity className="w-3 h-3 text-slate-400 group-hover:text-blue-500" />
          </div>
          <div className={`mt-1 text-xs font-bold font-mono truncate ${
            deadMan.status === 'HEALTHY' ? 'text-emerald-500' : 'text-rose-500'
          }`}>
            {deadMan.status === 'HEALTHY' ? 'Active' : 'Silence Alert'}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
            Zurich node
          </div>
        </button>
      </div>

      {/* 3. The 5 Core Operational Answers Panel */}
      <div className={`rounded-lg border p-4 transition-colors ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className={`flex items-center justify-between mb-3 pb-2 border-b ${
          isDark ? 'border-[#1A2332]' : 'border-slate-100'
        }`}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <h2 className="text-xs font-bold uppercase tracking-wider font-mono">
              Core Operations Health Assessment (The 5 Answers)
            </h2>
          </div>
          <span className={`text-[10px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Automated correlation engine · Zero manual inference
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs font-mono">
          {/* Q1 */}
          <div className={`p-3 rounded border space-y-1 ${
            isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'
          }`}>
            <div className={`text-[9px] uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              1. What is healthy right now?
            </div>
            <div className={`font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              {systemSummary.healthyApps} Apps &amp; 15 Nodes
            </div>
            <div className={`text-[11px] font-sans ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Cipher, Apex, Nimbus, Ascend, Vantage, Lumo, Beacon nominal.
            </div>
          </div>

          {/* Q2 */}
          <div className={`p-3 rounded border space-y-1 ${
            activeIncident 
              ? (isDark ? 'bg-[#180E13] border-rose-900/60' : 'bg-rose-50 border-rose-200') 
              : (isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200')
          }`}>
            <div className="text-[9px] text-rose-500 uppercase tracking-wider font-semibold">
              2. What is failing right now?
            </div>
            <div className={`font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              {activeIncident ? 'Mosaic Primary & DB Pool' : 'No active failures'}
            </div>
            <div className={`text-[11px] font-sans ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              {activeIncident ? 'MySQL pool starved (500 connections) on vps-sg-mosa-prd-01.' : 'All health endpoints returning 200.'}
            </div>
          </div>

          {/* Q3 */}
          <div className={`p-3 rounded border space-y-1 ${
            activeIncident 
              ? (isDark ? 'bg-[#18130E] border-amber-900/60' : 'bg-amber-50 border-amber-200') 
              : (isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200')
          }`}>
            <div className="text-[9px] text-amber-500 uppercase tracking-wider font-semibold">
              3. What is affected?
            </div>
            <div className={`font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              {activeIncident ? 'Mosaic Exam Reports' : 'Zero blast radius'}
            </div>
            <div className={`text-[11px] font-sans ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              {activeIncident ? 'Public traffic moved to DR standby; Primary origin quarantined.' : 'All user journeys normal.'}
            </div>
          </div>

          {/* Q4 */}
          <div className={`p-3 rounded border space-y-1 ${
            isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'
          }`}>
            <div className="text-[9px] text-blue-500 uppercase tracking-wider font-semibold">
              4. What should IT do?
            </div>
            <div className={`font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              {activeIncident ? 'Execute Runbook RB-01' : 'Maintain standard watch'}
            </div>
            <div className={`text-[11px] font-sans ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              {activeIncident ? 'Recycle connections, drain pool, verify 3 consecutive health checks.' : 'Continuous monitoring active.'}
            </div>
          </div>

          {/* Q5 */}
          <div className={`p-3 rounded border space-y-1 ${
            activeIncident 
              ? (isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200') 
              : (isDark ? 'bg-[#0E1713] border-emerald-900/60' : 'bg-emerald-50 border-emerald-200')
          }`}>
            <div className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold">
              5. Has it recovered?
            </div>
            <div className={`font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              {activeIncident ? 'Pending 3 Consecutive Checks' : 'Verified (3/3 Checks)'}
            </div>
            <div className={`text-[11px] font-sans ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              {activeIncident ? 'Flapping prevention in effect; currently 0/3 verified on Primary.' : 'Confirmed nominal.'}
            </div>
          </div>
        </div>
      </div>

      {/* 4. VISUAL FLOW CHARTS & HEARTBEAT WAVEFORM MONITOR */}
      <div className="space-y-6">
        {/* Real Heartbeat ECG Pulse Waveform Chart */}
        <HeartbeatPulseChart />

        {/* Live Anycast Traffic & Failover Routing Architecture Flow Chart */}
        <TrafficFlowChart />

        {/* Incident Mitigation & 3-Pass Recovery Flow State Machine */}
        <IncidentFlowChart />
      </div>

      {/* 5. LIVE TELEMETRY TIME-SERIES AREA GRAPHS */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            <h3 className="text-xs font-bold uppercase tracking-wider font-mono">
              Hostinger Infrastructure &amp; Latency Time-Series (Past 60 Minutes)
            </h3>
          </div>
          <span className={`text-[10px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Real-time sampling every 10s · Adaptive threshold markers
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <TelemetryAreaGraph
            title="Cluster CPU Load"
            subtitle="Singapore Origin"
            data={cpuData}
            unit="%"
            warningThreshold={80}
            color="rose"
          />
          <TelemetryAreaGraph
            title="System Memory"
            subtitle="16 Nodes Aggregated"
            data={ramData}
            unit="%"
            warningThreshold={85}
            color="amber"
          />
          <TelemetryAreaGraph
            title="Network Throughput"
            subtitle="Outbound Anycast"
            data={networkData}
            unit=" Mbps"
            color="blue"
          />
          <TelemetryAreaGraph
            title="P95 Monitor Latency"
            subtitle="Global Probes"
            data={latencyData}
            unit=" ms"
            warningThreshold={150}
            color="emerald"
          />
        </div>
      </div>

      {/* 6. Scholario Applications Health Grid */}
      <div className={`rounded-lg border overflow-hidden transition-colors ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className={`p-3.5 border-b flex items-center justify-between ${
          isDark ? 'border-[#1A2332]' : 'border-slate-100'
        }`}>
          <div>
            <h2 className="text-xs font-bold font-mono uppercase tracking-wider">
              Application Systems Catalog &amp; Failover Matrix
            </h2>
            <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Live operational health, RTO/RPO targets, replication lag &amp; origin routing state
            </p>
          </div>
          <button
            onClick={() => setActiveTab('applications')}
            className="text-xs text-blue-500 hover:text-blue-600 font-mono font-medium flex items-center gap-1 cursor-pointer"
          >
            <span>All details</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className={`font-medium border-b ${
              isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}>
              <tr>
                <th className="py-2.5 px-3.5">Application</th>
                <th className="py-2.5 px-3.5">Status</th>
                <th className="py-2.5 px-3.5">Primary (PRD)</th>
                <th className="py-2.5 px-3.5">Standby (DR)</th>
                <th className="py-2.5 px-3.5">Replication Lag</th>
                <th className="py-2.5 px-3.5">RTO / RPO</th>
                <th className="py-2.5 px-3.5 text-right">Uptime (30d)</th>
                <th className="py-2.5 px-3.5 text-right">Latency P95</th>
                <th className="py-2.5 px-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
              {applications.map(app => {
                const prdServer = servers.find(s => s.id === app.prdServerId);
                const drServer = servers.find(s => s.id === app.drServerId);
                const isHealthy = app.status === 'HEALTHY';
                const isDr = app.failoverState === 'DR_ACTIVE';

                return (
                  <tr 
                    key={app.id} 
                    className={`transition-colors ${
                      isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-2.5 px-3.5 font-sans">
                      <div className="font-semibold flex items-center gap-2">
                        <span>{app.name}</span>
                        <span className={`text-[10px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                          · {app.tier.replace('_', ' ')}
                        </span>
                      </div>
                      <div className={`text-[11px] truncate max-w-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        {app.description}
                      </div>
                    </td>

                    <td className="py-2.5 px-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${isHealthy ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
                        <span className={`font-semibold ${isHealthy ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {isHealthy ? 'Operational' : 'Critical'}
                        </span>
                      </div>
                      <div className={`text-[10px] mt-0.5 ${
                        isDr ? 'text-amber-500 font-bold' : (isDark ? 'text-slate-400' : 'text-slate-500')
                      }`}>
                        {isDr ? 'DR Routed' : 'Primary Origin'}
                      </div>
                    </td>

                    <td className="py-2.5 px-3.5">
                      <div>{prdServer?.hostname.split('.')[0]}</div>
                      <div className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        {prdServer?.ip}
                      </div>
                    </td>

                    <td className="py-2.5 px-3.5">
                      <div>{drServer?.hostname.split('.')[0]}</div>
                      <div className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        {drServer?.ip}
                      </div>
                    </td>

                    <td className="py-2.5 px-3.5 tabular-nums">
                      <div className={app.currentReplicationLagSec > 60 ? 'text-amber-500 font-bold' : ''}>
                        {app.currentReplicationLagSec}s lag
                      </div>
                      <div className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        Target &lt; {app.rpoTargetMin * 60}s
                      </div>
                    </td>

                    <td className={`py-2.5 px-3.5 tabular-nums ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      <div>RTO: {app.rtoTargetMin}m</div>
                      <div>RPO: {app.rpoTargetMin}m</div>
                    </td>

                    <td className="py-2.5 px-3.5 text-right tabular-nums font-semibold">
                      {app.uptime30d}%
                    </td>

                    <td className="py-2.5 px-3.5 text-right tabular-nums">
                      {app.p95Ms}ms
                    </td>

                    <td className="py-2.5 px-3.5 text-right font-sans">
                      <button
                        onClick={() => {
                          setSelectedAppId(app.id);
                          setActiveTab('applications');
                        }}
                        className={`px-2 py-0.5 rounded text-[11px] transition-colors border cursor-pointer ${
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

      {/* 7. Hostinger VPS Fleet Preview */}
      <div className={`rounded-lg border p-4 transition-colors ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className={`flex items-center justify-between pb-2 border-b ${
          isDark ? 'border-[#1A2332]' : 'border-slate-100'
        }`}>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider font-mono">
              Hostinger VPS Fleet Status (Singapore, Frankfurt, Mumbai, London)
            </h3>
            <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              16 Dedicated Nodes · Continuous telemetry and power control
            </p>
          </div>
          <button
            onClick={() => setActiveTab('infrastructure')}
            className="text-xs text-blue-500 hover:text-blue-600 font-mono font-medium cursor-pointer"
          >
            All 16 Nodes →
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-3 text-xs font-mono">
          {servers.slice(0, 6).map(srv => {
            const isCrit = srv.status === 'CRITICAL';
            return (
              <div 
                key={srv.id}
                onClick={() => setActiveTab('infrastructure')}
                className={`p-2.5 rounded border cursor-pointer transition-all ${
                  isCrit 
                    ? (isDark ? 'bg-[#180E13] border-rose-900/80 hover:border-rose-700' : 'bg-rose-50 border-rose-300 hover:border-rose-400')
                    : (isDark ? 'bg-[#0B0F17] border-[#1A2436] hover:border-blue-500' : 'bg-slate-50 border-slate-200 hover:border-blue-400')
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold truncate">
                    {srv.hostname.split('.')[0]}
                  </span>
                  <span className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {srv.region.slice(0, 3)}
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] tabular-nums">
                  <div>
                    <div className="text-[9px] text-slate-400 uppercase">CPU</div>
                    <div className={srv.telemetry.cpuPercent > 80 ? 'text-rose-500 font-bold' : ''}>
                      {srv.telemetry.cpuPercent}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-400 uppercase">RAM</div>
                    <div className={srv.telemetry.ramPercent > 80 ? 'text-rose-500 font-bold' : ''}>
                      {srv.telemetry.ramPercent}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-400 uppercase">Disk</div>
                    <div>
                      {srv.telemetry.diskPercent}%
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
};
