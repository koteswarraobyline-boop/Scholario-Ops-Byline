import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { GitBranch, CheckCircle2, RotateCcw } from 'lucide-react';

export const DeploymentsView: React.FC = () => {
  const { deployments, applications, addAuditEntry, theme } = useOps();
  const isDark = theme === 'dark';
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);

  const handleRollback = (id: string, version: string) => {
    setRollingBackId(id);
    setTimeout(() => {
      addAuditEntry('DEPLOYMENT_ROLLBACK', 'INCIDENT', id, `Initiated rollback of release ${version}`);
      setRollingBackId(null);
    }, 800);
  };

  return (
    <div className="space-y-6">
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            DEPLOYMENT PIPELINE &amp; RELEASE VERIFICATION
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Automated CI/CD stages: Build → Deploy → Health Check → Smoke Test → Success with 1-click rollback
          </p>
        </div>
      </div>

      <div className="space-y-3 font-mono text-xs">
        {deployments.map(dep => {
          const app = applications.find(a => a.id === dep.applicationId);
          const isRollbackActive = rollingBackId === dep.id;

          return (
            <div key={dep.id} className={`p-4 rounded-lg border space-y-3 transition-colors ${
              isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3 ${
                isDark ? 'border-[#1A2332]' : 'border-slate-100'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded flex items-center justify-center ${
                    isDark ? 'bg-[#162033] text-blue-400' : 'bg-blue-50 text-blue-600 border border-blue-200'
                  }`}>
                    <GitBranch className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm font-sans">{app?.name}</span>
                      <span className="text-xs text-blue-500 font-semibold">{dep.version}</span>
                      <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>({dep.commitHash})</span>
                    </div>
                    <p className={`text-xs font-sans mt-0.5 ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{dep.commitMessage}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-emerald-500 font-bold text-[10px] uppercase">
                    {dep.status}
                  </span>
                  {dep.rollbackAvailable && (
                    <button
                      onClick={() => handleRollback(dep.id, dep.version)}
                      disabled={isRollbackActive}
                      className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-colors border cursor-pointer ${
                        isDark 
                          ? 'bg-[#1A2436] hover:bg-[#23324C] border-[#23334E] text-slate-200' 
                          : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                      }`}
                    >
                      <RotateCcw className={`w-3 h-3 ${isRollbackActive ? 'animate-spin text-rose-500' : ''}`} />
                      <span>{isRollbackActive ? 'Rolling back...' : 'Rollback Release'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Pipeline Stages */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {['1. Build Artifact', '2. VPS Rolling Deploy', '3. Health Check Probe', '4. Synthetic Smoke Test'].map((stage) => (
                  <div key={stage} className={`p-2 rounded border flex items-center justify-between ${
                    isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>{stage}</span>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  </div>
                ))}
              </div>

              <div className={`flex justify-between text-[11px] pt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                <span>Author: {dep.author} · Pipeline: {dep.durationSec}s</span>
                <span>Completed: {new Date(dep.startedAt).toLocaleString()}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
