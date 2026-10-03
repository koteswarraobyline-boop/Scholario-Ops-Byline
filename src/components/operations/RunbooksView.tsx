import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { Terminal, CheckCircle2, Square } from 'lucide-react';

export const RunbooksView: React.FC = () => {
  const { runbooks, selectedRunbookId, setSelectedRunbookId, toggleRunbookStep, theme } = useOps();
  const isDark = theme === 'dark';
  const [activeRbId, setActiveRbId] = useState<string>(selectedRunbookId || runbooks[0]?.id || 'run-db-starve');

  const currentRunbook = runbooks.find(r => r.id === activeRbId) || runbooks[0];

  return (
    <div className="space-y-6">
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            OPERATIONAL RUNBOOKS &amp; MITIGATION SOPs
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Standard Operating Procedures, incident checklists &amp; read-only CLI diagnostic commands
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        
        {/* Left List */}
        <div className="space-y-2">
          <div className={`text-[10px] font-semibold uppercase tracking-wider font-mono px-1 ${
            isDark ? 'text-slate-400' : 'text-slate-500'
          }`}>
            Available Runbooks
          </div>
          {runbooks.map(rb => {
            const completedCount = rb.steps.filter(s => s.completed).length;
            const isSelected = rb.id === currentRunbook.id;

            return (
              <button
                key={rb.id}
                onClick={() => setActiveRbId(rb.id)}
                className={`w-full text-left p-3 rounded-lg border transition-all text-xs space-y-1 font-mono cursor-pointer ${
                  isSelected
                    ? 'bg-blue-600 text-white font-medium shadow-xs'
                    : isDark 
                      ? 'bg-[#111726] border-[#1E293B] text-slate-400 hover:text-slate-200' 
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 shadow-xs'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`font-bold ${isSelected ? 'text-white' : (isDark ? 'text-slate-200' : 'text-slate-800')}`}>{rb.id}</span>
                  <span className={`text-[10px] ${isSelected ? 'text-blue-100' : (isDark ? 'text-slate-500' : 'text-slate-400')}`}>~{rb.estimatedDurationMin}m</span>
                </div>
                <div className={`font-semibold line-clamp-1 font-sans ${isSelected ? 'text-white' : (isDark ? 'text-slate-100' : 'text-slate-900')}`}>{rb.title}</div>
                <div className={`flex items-center justify-between text-[11px] pt-1 ${isSelected ? 'text-blue-100' : (isDark ? 'text-slate-400' : 'text-slate-500')}`}>
                  <span>Progress:</span>
                  <span className={completedCount === rb.steps.length ? (isSelected ? 'text-emerald-200 font-bold' : 'text-emerald-500 font-bold') : (isSelected ? 'text-white' : 'text-blue-500')}>
                    {completedCount} / {rb.steps.length} steps
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Right Runbook Workspace */}
        <div className={`md:col-span-3 rounded-lg border p-5 space-y-5 transition-colors ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className={`border-b pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 font-mono ${
            isDark ? 'border-[#1A2332]' : 'border-slate-100'
          }`}>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-blue-500 font-bold">
                  {currentRunbook.id}
                </span>
                <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
                <span className={`text-xs uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Category: {currentRunbook.category}
                </span>
              </div>
              <h2 className="text-base font-bold font-sans mt-0.5">{currentRunbook.title}</h2>
              <p className={`text-xs font-sans mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{currentRunbook.description}</p>
            </div>

            <div className={`text-xs text-right ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              <span>Estimated Execution: </span>
              <strong className={isDark ? 'text-slate-200' : 'text-slate-800'}>~{currentRunbook.estimatedDurationMin}m</strong>
            </div>
          </div>

          {/* Interactive Steps Checklist */}
          <div className="space-y-3 font-mono text-xs">
            {currentRunbook.steps.map(step => (
              <div
                key={step.id}
                onClick={() => toggleRunbookStep(currentRunbook.id, step.id)}
                className={`p-3.5 rounded border cursor-pointer transition-all ${
                  step.completed
                    ? (isDark ? 'bg-[#0E1A14] border-emerald-900/60' : 'bg-emerald-50 border-emerald-300')
                    : (isDark ? 'bg-[#0B0F17] border-[#1A2436] hover:border-slate-700' : 'bg-slate-50 border-slate-200 hover:border-slate-300')
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    {step.completed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <Square className={`w-4 h-4 ${isDark ? 'text-slate-600' : 'text-slate-400'}`} />
                    )}
                  </div>

                  <div className="space-y-1 flex-1">
                    <div className="flex items-center justify-between">
                      <span className={`font-bold ${step.completed ? 'text-emerald-600 line-through' : (isDark ? 'text-slate-100' : 'text-slate-900')}`}>
                        Step {step.id}: {step.title}
                      </span>
                      {step.completedAt && (
                        <span className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                          Verified {step.completedAt} by {step.completedBy}
                        </span>
                      )}
                    </div>

                    <p className={`font-sans text-xs ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{step.instruction}</p>

                    {step.command && (
                      <div className={`mt-2 p-2 rounded border text-[11px] flex items-center justify-between ${
                        isDark ? 'bg-[#05080E] text-slate-200 border-[#182338]' : 'bg-slate-900 text-slate-100 border-slate-800'
                      }`}>
                        <code>$ {step.command}</code>
                        <span className="text-[10px] text-slate-400 uppercase font-sans">Diagnostic Only</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};
