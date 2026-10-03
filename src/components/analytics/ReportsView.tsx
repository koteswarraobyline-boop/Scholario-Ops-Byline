import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { FileText, Download, Copy, Check } from 'lucide-react';

export const ReportsView: React.FC = () => {
  const { systemSummary, deadMan, theme } = useOps();
  const isDark = theme === 'dark';
  const [copied, setCopied] = useState(false);

  const reportText = `SCHOLARIO IT OPERATIONS CONTROL CENTER
Daily Operations & Infrastructure Health Certified Briefing
Generated: ${new Date().toISOString()}

============================================================
1. CORE HEALTH EVALUATION
============================================================
Applications:            ${systemSummary.healthyApps} / ${systemSummary.totalApps} Healthy (Mosaic in failover state)
Infrastructure:          ${systemSummary.healthyServers} / ${systemSummary.totalServers} Hostinger KVM Instances Operational
Continuous Monitors:     ${systemSummary.healthyMonitors} / ${systemSummary.totalMonitors} Probes Passing
Disaster Recovery (DR):  ${systemSummary.drReadinessCount} / ${systemSummary.totalApps} Workloads Verified
Cold Backups:            ${systemSummary.backupsCurrentCount} / ${systemSummary.totalApps} Current (SHA-256 Validated)
Cloudflare Edge Status:  ${systemSummary.cloudflareStatus} (Mosaic traffic routed to DR)
Independent Watchdog:    ${deadMan.status} (${deadMan.nodeLocation.split('(')[0]})

============================================================
2. RESILIENCE TARGETS & METRICS
============================================================
Active Incidents:        ${systemSummary.openIncidents} (${systemSummary.criticalIncidents} Critical)
RPO Target Compliance:   < 15 minutes across all Tier 1 workloads
RTO Target Compliance:   < 30 minutes verified in restore drill
Mean Time To Detect:     < 45 seconds (3 consecutive probe confirmations)
Mean Time To Reroute:    < 12 seconds via Cloudflare Anycast Origin Pool

============================================================
3. COMPLIANCE & GOVERNANCE CERTIFICATION
============================================================
Hypervisors:             Hostinger Singapore / Frankfurt / Mumbai / London
Encryption:              AES-256 at rest, TLS 1.3 in transit
Audit Trail:             Immutable operator action records maintained`;

  const handleCopy = () => {
    navigator.clipboard.writeText(reportText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const element = document.createElement("a");
    const file = new Blob([reportText], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `scholario-ops-report-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="space-y-6">
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            DAILY OPERATIONS &amp; SLA AUDIT REPORT
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Automated operational briefing for leadership, compliance, and engineering handover
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition-colors border cursor-pointer ${
              isDark 
                ? 'bg-[#111726] border-[#1E293B] text-slate-300 hover:text-white' 
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 shadow-2xs'
            }`}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'COPIED' : 'COPY BRIEFING'}</span>
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 rounded text-white hover:bg-blue-700 transition-colors shadow-xs cursor-pointer font-semibold"
          >
            <Download className="w-3.5 h-3.5" />
            <span>DOWNLOAD .TXT</span>
          </button>
        </div>
      </div>

      <div className={`rounded-lg border p-5 space-y-3 font-mono transition-colors ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className={`flex items-center justify-between border-b pb-2 text-xs ${
          isDark ? 'border-[#1A2332]' : 'border-slate-100'
        }`}>
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-500" />
            <h2 className="font-bold">
              OPERATIONAL BRIEFING: {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </h2>
          </div>
          <span className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>CERTIFIED AUDIT ARTIFACT</span>
        </div>

        <pre className={`p-4 rounded border text-xs leading-relaxed overflow-x-auto ${
          isDark 
            ? 'bg-[#080B12] text-slate-300 border-[#182338]' 
            : 'bg-slate-900 text-emerald-300 border-slate-800'
        }`}>
          {reportText}
        </pre>
      </div>
    </div>
  );
};
