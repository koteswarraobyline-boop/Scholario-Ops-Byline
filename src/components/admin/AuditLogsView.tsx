import React from 'react';
import { useOps } from '../../context/OpsContext';
import { Shield } from 'lucide-react';

export const AuditLogsView: React.FC = () => {
  const { auditLogs, theme } = useOps();
  const isDark = theme === 'dark';

  return (
    <div className="space-y-6">
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            ADMINISTRATIVE AUDIT LOGS
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Immutable record of all privileged operator commands, failovers, incident actions &amp; Cloudflare routing alterations
          </p>
        </div>
      </div>

      <div className={`rounded-lg border overflow-hidden transition-colors ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className={`font-medium border-b ${
              isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}>
              <tr>
                <th className="py-2.5 px-3.5">Timestamp</th>
                <th className="py-2.5 px-3.5">Operator</th>
                <th className="py-2.5 px-3.5">Category</th>
                <th className="py-2.5 px-3.5">Action</th>
                <th className="py-2.5 px-3.5">Target Resource</th>
                <th className="py-2.5 px-3.5">Details</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
              {auditLogs.map(log => (
                <tr key={log.id} className={isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}>
                  <td className={`py-2.5 px-3.5 whitespace-nowrap ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {new Date(log.timestamp).toLocaleString()}
                  </td>

                  <td className={`py-2.5 px-3.5 font-sans font-semibold whitespace-nowrap ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                    {log.operator}
                  </td>

                  <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {log.category}
                  </td>

                  <td className="py-2.5 px-3.5 text-blue-500 font-semibold whitespace-nowrap">
                    {log.action}
                  </td>

                  <td className={`py-2.5 px-3.5 whitespace-nowrap ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    {log.targetId}
                  </td>

                  <td className={`py-2.5 px-3.5 font-sans max-w-md ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    {log.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
