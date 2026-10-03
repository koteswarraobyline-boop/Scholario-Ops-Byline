import React from 'react';
import { useOps } from '../../context/OpsContext';
import { Calendar, BellOff, ShieldAlert, CheckCircle2 } from 'lucide-react';

export const MaintenanceView: React.FC = () => {
  const { maintenanceWindows, applications, theme } = useOps();
  const isDark = theme === 'dark';

  return (
    <div className="space-y-6">
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            MAINTENANCE WINDOWS &amp; ALERT SILENCING
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Scheduled maintenance with selective alert silencing (application alerts suppressed, watchdog &amp; security unmuted)
          </p>
        </div>
      </div>

      <div className="space-y-3 font-mono text-xs">
        {maintenanceWindows.map(m => {
          const app = applications.find(a => a.id === m.applicationId);
          return (
            <div key={m.id} className={`p-4 rounded-lg border space-y-3 transition-colors ${
              isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3 ${
                isDark ? 'border-[#1A2332]' : 'border-slate-100'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded flex items-center justify-center ${
                    isDark ? 'bg-[#162033] text-indigo-400' : 'bg-indigo-50 text-indigo-600 border border-indigo-200'
                  }`}>
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm font-sans">{m.title}</span>
                      <span className="text-xs text-blue-500 font-semibold">
                        {app?.name} ({m.environment})
                      </span>
                    </div>
                    <p className={`text-xs font-sans mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{m.reason}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-amber-500 font-bold text-[10px] uppercase">
                    {m.status}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className={`p-2.5 rounded border ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`}>
                  <span className={`text-[9px] uppercase ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Window Period</span>
                  <div className={`font-semibold mt-0.5 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                    {new Date(m.startTime).toLocaleDateString()} {new Date(m.startTime).toLocaleTimeString()}
                  </div>
                </div>

                <div className={`p-2.5 rounded border ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`}>
                  <span className={`text-[9px] uppercase ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Expected Impact</span>
                  <div className={`font-semibold mt-0.5 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{m.expectedImpact}</div>
                </div>

                <div className={`p-2.5 rounded border ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`}>
                  <span className={`text-[9px] uppercase ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Alert Silencing Scope</span>
                  <div className="text-blue-500 font-semibold mt-0.5">
                    {m.suppressMonitors.length} Monitors Suppressed ({m.suppressMonitors.join(', ')})
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
