/**
 * RealVpsTestbenchView
 *
 * This component is reserved for the live VPS connection testbench.
 * It will be fully implemented when the real VPS details are provided.
 *
 * Placeholder until VPS IP / credentials are configured.
 */
import React from 'react';
import { useOps } from '../../context/OpsContext';
import { Server, Zap, Terminal, Globe, Activity, ShieldCheck } from 'lucide-react';

export const RealVpsTestbenchView: React.FC = () => {
  const { theme } = useOps();
  const isDark = theme === 'dark';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            REAL VPS TESTBENCH &amp; LIVE CONNECTION
          </h1>
          <p className={`text-xs font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Live probe testing, port scanner, TCP checks &amp; real telemetry agent deployment
          </p>
        </div>
      </div>

      {/* Coming soon card */}
      <div className={`rounded-xl border p-10 flex flex-col items-center justify-center text-center space-y-5 ${
        isDark ? 'bg-[#0E131F] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
          isDark ? 'bg-[#162033]' : 'bg-blue-50'
        }`}>
          <Server className="w-8 h-8 text-blue-500" />
        </div>

        <div>
          <h2 className={`text-base font-bold font-mono ${isDark ? 'text-white' : 'text-slate-900'}`}>
            VPS DETAILS PENDING
          </h2>
          <p className={`text-sm mt-2 max-w-md ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Share your real Hostinger VPS IP address and credentials to activate the live testbench.
            Once connected, you can run real HTTP probes, TCP port scans, and deploy the telemetry agent.
          </p>
        </div>

        {/* Feature list */}
        <div className={`grid grid-cols-2 sm:grid-cols-3 gap-3 w-full max-w-lg text-xs font-mono`}>
          {[
            { icon: Activity,    label: 'Live HTTP Probes',     color: 'text-emerald-500' },
            { icon: Terminal,    label: 'TCP Port Scanner',     color: 'text-blue-500' },
            { icon: Globe,       label: 'Synthetic E2E Tests',  color: 'text-purple-500' },
            { icon: Zap,         label: 'Failover Testing',     color: 'text-amber-500' },
            { icon: ShieldCheck, label: 'SSL/TLS Check',        color: 'text-cyan-500' },
            { icon: Server,      label: 'Telemetry Agent',      color: 'text-rose-500' },
          ].map(({ icon: Icon, label, color }) => (
            <div key={label} className={`flex items-center gap-2 p-2.5 rounded border ${
              isDark ? 'border-[#1E293B] bg-[#111726]' : 'border-slate-200 bg-slate-50'
            }`}>
              <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
              <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>{label}</span>
            </div>
          ))}
        </div>

        <div className={`text-[11px] font-mono px-4 py-2 rounded-full border ${
          isDark ? 'border-blue-800/60 bg-blue-950/40 text-blue-300' : 'border-blue-200 bg-blue-50 text-blue-700'
        }`}>
          ⚡ Ready to connect — waiting for VPS details
        </div>
      </div>

      {/* Instructions */}
      <div className={`rounded-lg border p-4 space-y-3 ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <h3 className={`text-xs font-bold font-mono uppercase tracking-wider ${
          isDark ? 'text-slate-300' : 'text-slate-700'
        }`}>
          WHAT TO SHARE
        </h3>
        <div className={`space-y-2 text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          <div className="flex items-start gap-2">
            <span className="text-blue-400 font-bold shrink-0">1.</span>
            <span>Public IP address of the VPS (e.g. <code className={`px-1 rounded ${isDark ? 'bg-[#1A2436] text-emerald-300' : 'bg-slate-100 text-emerald-700'}`}>185.193.x.x</code>)</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-blue-400 font-bold shrink-0">2.</span>
            <span>Any existing public HTTP endpoint to probe (e.g. <code className={`px-1 rounded ${isDark ? 'bg-[#1A2436] text-emerald-300' : 'bg-slate-100 text-emerald-700'}`}>https://qr.kodeitglobal.com/api/videos</code>)</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-blue-400 font-bold shrink-0">3.</span>
            <span>Which ports are open / which services are running (Nginx, Node, MySQL, etc.)</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-blue-400 font-bold shrink-0">4.</span>
            <span>Whether SSH access is available for the optional telemetry agent installation</span>
          </div>
        </div>
      </div>
    </div>
  );
};
