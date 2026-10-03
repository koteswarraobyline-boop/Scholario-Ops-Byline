import React from 'react';
import { useOps } from '../../context/OpsContext';
import { CheckCircle2 } from 'lucide-react';

export const BackupsView: React.FC = () => {
  const { backups, applications, theme } = useOps();
  const isDark = theme === 'dark';

  return (
    <div className="space-y-6">
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            BACKUP MANAGEMENT &amp; RESTORE AUDIT
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Automated snapshot retention, AES-256 encryption at rest, SHA-256 integrity checks &amp; sandboxed drills
          </p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 font-mono text-xs">
        <div className={`p-3 rounded border ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="text-[10px] text-slate-400 uppercase">Active Backups</div>
          <div className="text-base font-bold tabular-nums">{backups.length} Registered</div>
          <div className="text-[10px] text-emerald-500 font-sans mt-0.5">All 100% current</div>
        </div>
        <div className={`p-3 rounded border ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="text-[10px] text-slate-400 uppercase">Encryption At Rest</div>
          <div className="text-base font-bold">AES-256</div>
          <div className={`text-[10px] font-sans mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Compliant with PCI-DSS</div>
        </div>
        <div className={`p-3 rounded border ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="text-[10px] text-slate-400 uppercase">SHA-256 Integrity</div>
          <div className="text-base font-bold text-emerald-500">100% Verified</div>
          <div className={`text-[10px] font-sans mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Zero corruption detected</div>
        </div>
        <div className={`p-3 rounded border ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="text-[10px] text-slate-400 uppercase">Latest Restore Drill</div>
          <div className="text-base font-bold">Sept 2026</div>
          <div className="text-[10px] text-emerald-500 font-sans mt-0.5">Avg recovery: 23 min</div>
        </div>
      </div>

      {/* Backups Table */}
      <div className={`rounded-lg border overflow-hidden transition-colors ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className={`font-medium border-b ${
              isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}>
              <tr>
                <th className="py-2.5 px-3.5">Application</th>
                <th className="py-2.5 px-3.5">Type</th>
                <th className="py-2.5 px-3.5">Size</th>
                <th className="py-2.5 px-3.5">Destination Vault</th>
                <th className="py-2.5 px-3.5">Retention</th>
                <th className="py-2.5 px-3.5">Integrity Hash (SHA-256)</th>
                <th className="py-2.5 px-3.5">Sandboxed Drill Verification</th>
                <th className="py-2.5 px-3.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
              {backups.map(b => {
                const app = applications.find(a => a.id === b.applicationId);
                return (
                  <tr key={b.id} className={`transition-colors ${isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}`}>
                    <td className="py-2.5 px-3.5 font-sans font-bold">
                      {app?.name}
                    </td>

                    <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                      {b.type}
                    </td>

                    <td className="py-2.5 px-3.5 tabular-nums">
                      {b.sizeGb} GB
                    </td>

                    <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                      {b.destination}
                    </td>

                    <td className={`py-2.5 px-3.5 tabular-nums ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                      {b.retentionDays}d
                    </td>

                    <td className={`py-2.5 px-3.5 max-w-xs truncate text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {b.integrityHash}
                    </td>

                    <td className="py-2.5 px-3.5 font-sans">
                      <div className="text-emerald-500 font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Verified ({b.restoreDurationMin}m)</span>
                      </div>
                      <div className={`text-[10px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        Tested: {new Date(b.restoreTestedAt).toLocaleDateString()}
                      </div>
                    </td>

                    <td className="py-2.5 px-3.5 text-right text-emerald-500 font-bold">
                      {b.status}
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
