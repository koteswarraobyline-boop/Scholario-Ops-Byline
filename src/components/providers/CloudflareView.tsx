import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { AlertTriangle, ShieldCheck, Globe, CheckCircle2 } from 'lucide-react';
import { TrafficFlowChart } from '../visuals/TrafficFlowChart';

export const CloudflareView: React.FC = () => {
  const { cloudflareZones, theme } = useOps();
  const isDark = theme === 'dark';
  const [selectedZoneId, setSelectedZoneId] = useState<string>(cloudflareZones[0]?.id || 'cf-mosaic');

  const selectedZone = cloudflareZones.find(z => z.id === selectedZoneId) || cloudflareZones[0];

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            CLOUDFLARE ANYCAST EDGE &amp; TRAFFIC ROUTING
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Read-only edge telemetry, TLS certificates, WAF events, DNS records &amp; configuration drift detection
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-mono px-2 py-0.5 rounded flex items-center gap-1.5 ${
            isDark 
              ? 'text-emerald-400 bg-emerald-950/60 border border-emerald-900/80' 
              : 'text-emerald-700 bg-emerald-50 border border-emerald-200'
          }`}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>Edge API: Synchronized</span>
          </span>
        </div>
      </div>

      {/* Real Anycast Traffic & Failover Architecture Flow Chart */}
      <TrafficFlowChart />

      {/* Configuration Drift Warning (if detected) */}
      {selectedZone.driftDetected && (
        <div className={`p-3.5 rounded border text-xs space-y-1 font-mono ${
          isDark ? 'bg-[#1F1710] border-amber-900/80' : 'bg-amber-50 border-amber-300'
        }`}>
          <div className="font-bold text-amber-500 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span>Configuration Drift Detected on {selectedZone.domain}</span>
          </div>
          <p className={`font-sans ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            Edge DNS record target differs from Terraform state repository. {selectedZone.driftDetails}
          </p>
        </div>
      )}

      {/* Zone Selector */}
      <div className="flex items-center gap-2 font-mono text-xs">
        <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>Select Zone:</span>
        <div className="flex items-center gap-1">
          {cloudflareZones.map(z => (
            <button
              key={z.id}
              onClick={() => setSelectedZoneId(z.id)}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                selectedZone.id === z.id
                  ? 'bg-blue-600 text-white font-medium shadow-xs'
                  : isDark ? 'bg-[#111726] border border-[#1E293B] text-slate-400 hover:text-slate-200' : 'bg-slate-100 border border-slate-300 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {z.domain}
            </button>
          ))}
        </div>
      </div>

      {/* Zone Detail Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs font-mono">
        <div className={`p-3 rounded border ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Zone Status</div>
          <div className={`text-base font-bold mt-0.5 ${selectedZone.status === 'ACTIVE' ? 'text-emerald-500' : 'text-amber-500'}`}>
            {selectedZone.status}
          </div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Proxy active &amp; accelerated</div>
        </div>

        <div className={`p-3 rounded border ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>SSL / TLS Version</div>
          <div className={`text-base font-bold mt-0.5 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{selectedZone.tlsVersion}</div>
          <div className="text-[10px] text-emerald-500 mt-0.5">Valid until {new Date(selectedZone.sslExpiresAt).toLocaleDateString()}</div>
        </div>

        <div className={`p-3 rounded border ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Active Origin Route</div>
          <div className={`text-xs font-bold truncate mt-1 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
            {selectedZone.loadBalancer.activeOrigin}
          </div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Pool: {selectedZone.loadBalancer.poolName}</div>
        </div>

        <div className={`p-3 rounded border ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>WAF Mitigated Events (24h)</div>
          <div className={`text-base font-bold tabular-nums mt-0.5 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{selectedZone.wafEvents24h.toLocaleString()}</div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>DDoS &amp; Bot Defense Shielded</div>
        </div>
      </div>

      {/* DNS Records Table */}
      <div className={`rounded-lg border overflow-hidden space-y-3 p-4 font-mono text-xs transition-colors ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className={`flex items-center justify-between border-b pb-2 ${
          isDark ? 'border-[#1A2332]' : 'border-slate-100'
        }`}>
          <h2 className="text-xs font-bold uppercase tracking-wider font-mono">
            DNS Zone Records ({selectedZone.domain})
          </h2>
          <span className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Last checked {new Date(selectedZone.lastChecked).toLocaleTimeString()}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className={`border-b ${
              isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}>
              <tr>
                <th className="py-2 px-3">Type</th>
                <th className="py-2 px-3">Name</th>
                <th className="py-2 px-3">Target Content</th>
                <th className="py-2 px-3">Proxy</th>
                <th className="py-2 px-3">TTL</th>
                <th className="py-2 px-3 text-right">Modified</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
              {selectedZone.dnsRecords.map(rec => (
                <tr key={rec.id} className={isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}>
                  <td className={`py-2 px-3 font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{rec.type}</td>
                  <td className={`py-2 px-3 font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{rec.name}</td>
                  <td className={`py-2 px-3 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{rec.target}</td>
                  <td className="py-2 px-3">
                    <span className={rec.proxied ? 'text-amber-500 font-semibold' : (isDark ? 'text-slate-400' : 'text-slate-500')}>
                      {rec.proxied ? 'Proxied' : 'DNS Only'}
                    </span>
                  </td>
                  <td className={`py-2 px-3 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{rec.ttl === 1 ? 'Auto' : `${rec.ttl}s`}</td>
                  <td className={`py-2 px-3 text-right ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{rec.lastModified}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
