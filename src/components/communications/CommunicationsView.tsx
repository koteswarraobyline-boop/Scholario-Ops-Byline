import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { 
  Send, 
  CheckCircle2, 
  Bell, 
  Radio, 
  Shield, 
  Activity, 
  AlertTriangle, 
  RefreshCw, 
  Flame, 
  Zap,
  Server,
  ArrowRight
} from 'lucide-react';

export const CommunicationsView: React.FC = () => {
  const { 
    communicationChannels, 
    escalationPolicies, 
    sendTestNotification, 
    apiHealth,
    triggerHealthCheck,
    simulateApiOutage,
    theme 
  } = useOps();
  const isDark = theme === 'dark';
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testSuccessMessage, setTestSuccessMessage] = useState<string | null>(null);
  const [isProbingHealth, setIsProbingHealth] = useState(false);

  const handleTestDispatch = async (channelId: string, channelName: string) => {
    setTestingId(channelId);
    setTestSuccessMessage(null);
    await sendTestNotification(channelId);
    setTestingId(null);
    setTestSuccessMessage(`Test notification confirmed delivered to ${channelName}`);
    setTimeout(() => setTestSuccessMessage(null), 4000);
  };

  const handleManualHealthProbe = async () => {
    setIsProbingHealth(true);
    await triggerHealthCheck();
    setTimeout(() => setIsProbingHealth(false), 500);
  };

  const isOutage = !apiHealth.reachable || apiHealth.status === 'UNREACHABLE';

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            COMMUNICATIONS &amp; ESCALATION MATRIX
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Real-time /health endpoint monitoring, notification triggers, Microsoft Teams webhooks &amp; on-call matrix
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-2 px-2.5 py-1 rounded text-xs font-mono border ${
            isOutage 
              ? 'bg-rose-950/80 border-rose-800 text-rose-300 animate-pulse' 
              : isDark 
                ? 'bg-[#111726] border-[#1E293B] text-emerald-400' 
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isOutage ? 'bg-rose-500' : 'bg-emerald-500'}`} />
            <span>API SERVICE: {apiHealth.status} ({apiHealth.latencyMs}ms)</span>
          </div>
        </div>
      </div>

      {/* CRITICAL ALERT BANNER IF /health CHECK BECOMES UNREACHABLE */}
      {isOutage && (
        <div className="p-4 rounded-lg border border-rose-600 bg-rose-950/90 text-rose-100 shadow-2xl animate-in fade-in space-y-3 font-mono">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-rose-800/80 pb-2.5">
            <div className="flex items-center gap-2.5">
              <span className="w-3 h-3 rounded-full bg-rose-500 animate-ping shrink-0" />
              <div className="font-bold text-sm tracking-wide text-rose-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                <span>EMERGENCY NOTIFICATION TRIGGER: SCHOLARIO OPS API UNREACHABLE</span>
              </div>
            </div>
            <span className="text-[10px] text-rose-300 font-normal">
              Detected: {new Date(apiHealth.lastChecked).toLocaleTimeString()}
            </span>
          </div>

          <p className="text-xs font-sans text-rose-200 leading-relaxed">
            The <strong>/health</strong> check endpoint failed consecutive probes (Status: UNREACHABLE / Timeout). Automated escalation rules have engaged: 
            emergency dispatch sent to <strong>#ops-war-room (Teams)</strong>, Priority 1 page routed to <strong>PagerDuty Primary SRE</strong>, and standby origins are on alert.
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={handleManualHealthProbe}
              disabled={isProbingHealth}
              className="px-3 py-1 rounded text-xs font-bold bg-white text-rose-950 hover:bg-rose-100 transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isProbingHealth ? 'animate-spin' : ''}`} />
              <span>RE-PROBE /health NOW</span>
            </button>

            <button
              onClick={() => simulateApiOutage(false)}
              className="px-3 py-1 rounded text-xs font-bold bg-rose-800 hover:bg-rose-700 text-white transition-colors cursor-pointer border border-rose-600"
            >
              RESTORE SERVICE TO NOMINAL
            </button>
          </div>
        </div>
      )}

      {/* REAL-TIME /health NOTIFICATION TRIGGER CARD */}
      <div className={`p-4 sm:p-5 rounded-lg border transition-colors space-y-4 ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-inherit">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded ${
              isOutage 
                ? 'bg-rose-950 text-rose-400 border border-rose-800' 
                : isDark 
                  ? 'bg-blue-950/80 text-blue-400 border border-blue-900' 
                  : 'bg-blue-50 text-blue-700 border border-blue-200'
            }`}>
              <Activity className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-tight font-sans">
                  Scholario Ops API /health Check Notification Trigger
                </span>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold border ${
                  isOutage 
                    ? 'bg-rose-950 border-rose-800 text-rose-300' 
                    : isDark 
                      ? 'bg-emerald-950 border-emerald-800 text-emerald-300' 
                      : 'bg-emerald-50 border-emerald-300 text-emerald-800'
                }`}>
                  {isOutage ? 'CRITICAL TRIGGER FIRED' : 'LIVE & ACTIVE (4.0s POLLING)'}
                </span>
              </div>
              <p className={`text-xs font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Automated continuous watchdog on endpoint: <code className="text-blue-400 font-bold">GET /health</code>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleManualHealthProbe}
              disabled={isProbingHealth}
              className={`px-3 py-1.5 rounded text-xs font-mono font-medium transition-colors border cursor-pointer flex items-center gap-1.5 ${
                isDark 
                  ? 'bg-[#162033] hover:bg-[#1D2B44] text-slate-200 border-[#23334E]' 
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 text-blue-500 ${isProbingHealth ? 'animate-spin' : ''}`} />
              <span>TEST /health PROBE</span>
            </button>

            <button
              onClick={() => simulateApiOutage(!isOutage)}
              className={`px-3 py-1.5 rounded text-xs font-mono font-bold transition-colors border cursor-pointer ${
                isOutage
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-700'
                  : isDark 
                    ? 'bg-rose-950/60 hover:bg-rose-900 border-rose-800 text-rose-300' 
                    : 'bg-rose-50 hover:bg-rose-100 border-rose-300 text-rose-700'
              }`}
            >
              {isOutage ? 'RESTORE /health' : 'SIMULATE OUTAGE'}
            </button>
          </div>
        </div>

        {/* Live Matrix Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
          <div className={`p-2.5 rounded border ${isDark ? 'bg-[#0B0F17] border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
            <div className="text-[10px] uppercase text-slate-400">Endpoint Status</div>
            <div className={`text-sm font-bold mt-0.5 ${isOutage ? 'text-rose-500' : 'text-emerald-500'}`}>
              {isOutage ? 'UNREACHABLE' : '200 OK'}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">Round-trip: {apiHealth.latencyMs}ms</div>
          </div>

          <div className={`p-2.5 rounded border ${isDark ? 'bg-[#0B0F17] border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
            <div className="text-[10px] uppercase text-slate-400">Escalation Rule</div>
            <div className="text-sm font-bold text-blue-400 mt-0.5">P1 Emergency</div>
            <div className="text-[9px] text-slate-400 mt-0.5">Threshold: 2 missed checks</div>
          </div>

          <div className={`p-2.5 rounded border ${isDark ? 'bg-[#0B0F17] border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
            <div className="text-[10px] uppercase text-slate-400">Cluster Core</div>
            <div className="text-sm font-bold mt-0.5 truncate text-slate-200">
              {apiHealth.details?.cluster || 'Hostinger Singapore'}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">Origin: sg-prd-core</div>
          </div>

          <div className={`p-2.5 rounded border ${isDark ? 'bg-[#0B0F17] border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
            <div className="text-[10px] uppercase text-slate-400">Target Dispatches</div>
            <div className="text-sm font-bold mt-0.5 text-amber-400">Teams + PagerDuty</div>
            <div className="text-[9px] text-slate-400 mt-0.5">Audited &amp; Logged</div>
          </div>
        </div>

        {/* Notification Trigger Specification Notice */}
        <div className={`p-3 rounded border text-xs font-mono flex items-start gap-2.5 ${
          isDark ? 'bg-[#0E1524] border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
        }`}>
          <Bell className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <strong>Active Trigger Policy:</strong> Continuous synthetic health watchdog pings <code className="text-blue-400">/health</code> every 4 seconds. If consecutive probes fail or latency exceeds 3000ms, the system immediately fires an out-of-band notification to the team across all operational channels and marks the core service degraded.
          </div>
        </div>
      </div>

      {testSuccessMessage && (
        <div className={`p-3.5 rounded border text-xs font-mono flex items-center gap-2 animate-in fade-in ${
          isDark ? 'bg-[#0E1A14] border-emerald-900 text-emerald-300' : 'bg-emerald-50 border-emerald-300 text-emerald-800'
        }`}>
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>{testSuccessMessage}</span>
        </div>
      )}

      {/* Channels Section */}
      <div className="space-y-3">
        <h2 className={`text-xs font-bold uppercase tracking-wider font-mono ${
          isDark ? 'text-slate-400' : 'text-slate-600'
        }`}>Configured Operational Channels</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
          {communicationChannels.map(ch => {
            const isTesting = testingId === ch.id;

            return (
              <div key={ch.id} className={`p-4 rounded-lg border space-y-3 flex flex-col justify-between transition-colors ${
                isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
              }`}>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold font-sans text-sm">{ch.name}</span>
                    <span className="text-[10px] text-blue-500 font-semibold uppercase">
                      {ch.type}
                    </span>
                  </div>

                  <div className={`mt-2.5 text-[11px] break-all p-2 rounded border ${
                    isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2436]' : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}>
                    Endpoint: {ch.targetEndpoint.slice(0, 28)}••••••••
                  </div>

                  <div className={`mt-2.5 text-[11px] space-y-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    <div className="flex justify-between">
                      <span>Status:</span>
                      <strong className="text-emerald-500">ENABLED</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Last Delivery:</span>
                      <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>
                        {new Date(ch.lastDeliveryAt).toLocaleTimeString()} ({ch.lastDeliveryStatus})
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => handleTestDispatch(ch.id, ch.name)}
                  disabled={isTesting}
                  className={`w-full mt-2 py-1.5 rounded font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 border cursor-pointer ${
                    isDark 
                      ? 'bg-[#1A2436] hover:bg-[#23324C] border-[#23334E] text-slate-200' 
                      : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'
                  }`}
                >
                  <Send className={`w-3 h-3 ${isTesting ? 'animate-spin text-blue-500' : ''}`} />
                  <span>{isTesting ? 'DISPATCHING...' : 'DISPATCH TEST PAYLOAD'}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Escalation Policies */}
      <div className="space-y-3">
        <h2 className={`text-xs font-bold uppercase tracking-wider font-mono ${
          isDark ? 'text-slate-400' : 'text-slate-600'
        }`}>Incident Escalation Policy Matrix</h2>
        <div className={`rounded-lg border overflow-hidden transition-colors ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="w-full min-w-0 overflow-x-auto">
            <table className="w-full text-left text-xs font-mono min-w-[700px]">
              <thead className={`font-medium border-b ${
                isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}>
                <tr>
                  <th className="py-2.5 px-3.5">Severity Tier</th>
                  <th className="py-2.5 px-3.5">Dispatched Channels</th>
                  <th className="py-2.5 px-3.5">Initial Delay</th>
                  <th className="py-2.5 px-3.5">Reminder Repeat</th>
                  <th className="py-2.5 px-3.5">Auto-Escalate Window</th>
                  <th className="py-2.5 px-3.5 text-right">Escalate Target</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
                {escalationPolicies.map(pol => (
                  <tr key={pol.id} className={isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}>
                    <td className="py-2.5 px-3.5 font-bold">
                      <span className={pol.severity === 'CRITICAL' ? 'text-rose-500' : 'text-amber-500'}>
                        {pol.severity}
                      </span>
                    </td>

                    <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                      {pol.channels.map(c => c.replace('comm-', '').toUpperCase()).join(', ')}
                    </td>

                    <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                      {pol.initialDelayMin === 0 ? 'Immediate (0s)' : `${pol.initialDelayMin} min`}
                    </td>

                    <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                      Every {pol.repeatIntervalMin} min
                    </td>

                    <td className="py-2.5 px-3.5 text-rose-500 font-bold">
                      If unacknowledged &gt; {pol.autoEscalateAfterMin} min
                    </td>

                    <td className={`py-2.5 px-3.5 text-right font-sans ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                      {pol.escalateToTeam}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>
  );
};
