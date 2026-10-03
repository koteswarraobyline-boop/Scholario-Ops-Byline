import React from 'react';
import { useOps } from '../../context/OpsContext';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  ArrowRight, 
  Radio, 
  ShieldAlert, 
  RotateCcw, 
  Check, 
  FileText,
  Sliders,
  Cloud
} from 'lucide-react';

export const IncidentFlowChart: React.FC = () => {
  const { incidents, triggerSimulatedScenario, theme } = useOps();
  const isDark = theme === 'dark';

  const mosaicIncident = incidents.find(i => i.id === 'INC-1042');
  const isResolved = !mosaicIncident || mosaicIncident.status === 'RESOLVED';

  // 7 standard incident lifecycle steps
  const steps = [
    {
      num: 1,
      title: 'Telemetry Anomaly',
      detail: 'Mosaic PRD MySQL max pool 500/500 saturated',
      status: 'COMPLETED',
      time: '18m ago'
    },
    {
      num: 2,
      title: '3-Check Confirmation',
      detail: 'Continuous probe failed 3 consecutive times',
      status: 'COMPLETED',
      time: '16m ago'
    },
    {
      num: 3,
      title: 'Incident Deduplication',
      detail: 'INC-1042 fingerprinted & dispatched to MS Teams',
      status: 'COMPLETED',
      time: '15m ago'
    },
    {
      num: 4,
      title: 'Cloudflare DR Reroute',
      detail: 'Anycast origin shifted to Singapore DR Standby',
      status: 'COMPLETED',
      time: '14m ago'
    },
    {
      num: 5,
      title: 'Root Mitigation',
      detail: 'Pool recycled & connections drained via Runbook RB-01',
      status: isResolved ? 'COMPLETED' : 'ACTIVE',
      time: isResolved ? '2m ago' : 'In Progress'
    },
    {
      num: 6,
      title: '3-Check Verification',
      detail: 'Monitor confirms 3 consecutive passing health checks',
      status: isResolved ? 'COMPLETED' : 'PENDING',
      time: isResolved ? 'Just now' : 'Awaiting 3 passes'
    },
    {
      num: 7,
      title: 'Incident Resolution',
      detail: 'SLA restored & immutable postmortem created',
      status: isResolved ? 'COMPLETED' : 'PENDING',
      time: isResolved ? 'Resolved' : 'Pending signoff'
    }
  ];

  return (
    <div className={`rounded-lg border p-4 transition-colors ${
      isDark 
        ? 'bg-[#0F172A] border-[#1E293B] text-slate-100' 
        : 'bg-white border-[#E2E8F0] text-slate-900 shadow-xs'
    }`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-inherit">
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded ${
            isResolved 
              ? (isDark ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' : 'bg-emerald-50 text-emerald-700 border border-emerald-200')
              : (isDark ? 'bg-rose-950 text-rose-400 border border-rose-900' : 'bg-rose-50 text-rose-700 border border-rose-200')
          }`}>
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs tracking-tight">Incident Mitigation &amp; Recovery State Machine</span>
              <span className={`text-[10px] font-mono px-2 py-0.2 rounded font-semibold ${
                isResolved 
                  ? (isDark ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-emerald-100 text-emerald-800 border border-emerald-300')
                  : (isDark ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-rose-100 text-rose-800 border border-rose-300')
              }`}>
                {isResolved ? 'INC-1042 RESOLVED · 3 CHECKS VERIFIED' : 'ACTIVE MITIGATION: STEP 5/7'}
              </span>
            </div>
            <p className={`text-[11px] font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Lifecycle for INC-1042: Consecutive Failure Threshold → Blast Radius Containment → Recovery Verification
            </p>
          </div>
        </div>

        {/* Action button */}
        <div>
          {isResolved ? (
            <button
              onClick={() => triggerSimulatedScenario('TRIGGER_MOSAIC_FAIL')}
              className={`px-3 py-1 text-xs font-mono rounded flex items-center gap-1.5 transition-colors border ${
                isDark 
                  ? 'bg-[#182030] hover:bg-[#202B40] text-rose-300 border-rose-900/60' 
                  : 'bg-rose-50 hover:bg-rose-100 text-rose-800 border-rose-200'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
              <span>Re-inject Failure Scenario</span>
            </button>
          ) : (
            <button
              onClick={() => triggerSimulatedScenario('RESOLVE_MOSAIC')}
              className={`px-3 py-1 text-xs font-mono rounded flex items-center gap-1.5 transition-colors border shadow-xs ${
                isDark 
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400' 
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Verify 3 Passes &amp; Resolve</span>
            </button>
          )}
        </div>
      </div>

      {/* Horizontal Flow Steps */}
      <div className="py-4">
        <div className={`p-4 rounded-lg border overflow-x-auto ${
          isDark ? 'bg-[#080C14] border-[#182336]' : 'bg-[#F8FAFC] border-[#E2E8F0]'
        }`}>
          <div className="min-w-[840px] flex items-center justify-between relative">
            {steps.map((st, idx) => {
              const isCurrent = st.status === 'ACTIVE';
              const isDone = st.status === 'COMPLETED';

              return (
                <React.Fragment key={st.num}>
                  {/* Step Card */}
                  <div className={`w-28 p-2.5 rounded-lg border flex flex-col items-center text-center relative transition-all ${
                    isCurrent
                      ? (isDark ? 'bg-[#21160C] border-amber-500 ring-2 ring-amber-500/40' : 'bg-amber-50 border-amber-400 ring-2 ring-amber-400/40 shadow-xs')
                      : isDone
                        ? (isDark ? 'bg-[#0D1F15] border-emerald-800/80 text-emerald-300' : 'bg-white border-emerald-300 text-emerald-950 shadow-xs')
                        : (isDark ? 'bg-[#121A2B] border-slate-800 text-slate-500' : 'bg-slate-100 border-slate-200 text-slate-400')
                  }`}>
                    {/* Circle icon */}
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center font-mono text-[10px] font-bold mb-1.5 ${
                      isCurrent
                        ? 'bg-amber-500 text-black animate-pulse'
                        : isDone
                          ? 'bg-emerald-600 text-white'
                          : (isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-500')
                    }`}>
                      {isDone ? <Check className="w-3.5 h-3.5" /> : st.num}
                    </div>

                    <span className="font-semibold text-[11px] font-mono leading-tight">
                      {st.title}
                    </span>

                    <span className={`text-[9px] font-mono mt-1 line-clamp-2 ${
                      isCurrent 
                        ? (isDark ? 'text-amber-300' : 'text-amber-800') 
                        : isDone 
                          ? (isDark ? 'text-slate-300' : 'text-slate-600') 
                          : (isDark ? 'text-slate-500' : 'text-slate-400')
                    }`}>
                      {st.detail}
                    </span>

                    <span className={`text-[9px] font-mono mt-1.5 px-1.5 py-0.2 rounded font-semibold ${
                      isCurrent 
                        ? 'bg-amber-500/20 text-amber-400' 
                        : isDone 
                          ? 'bg-emerald-500/20 text-emerald-400' 
                          : 'text-slate-500'
                    }`}>
                      {st.time}
                    </span>
                  </div>

                  {/* Flow Arrow Connector between steps */}
                  {idx < steps.length - 1 && (
                    <div className="flex-1 flex items-center justify-center px-1">
                      <div className={`h-0.5 w-full relative ${
                        isDone 
                          ? 'bg-emerald-500' 
                          : (isDark ? 'bg-slate-800' : 'bg-slate-300')
                      }`}>
                        {isCurrent && (
                          <div className="absolute inset-0 bg-amber-400 animate-pulse" />
                        )}
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recovery Principle Callout */}
      <div className={`p-2.5 rounded border text-xs font-mono flex items-center justify-between gap-3 ${
        isDark ? 'bg-[#0B1220] border-[#182338] text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
      }`}>
        <div className="flex items-center gap-2">
          <span className="text-blue-500 font-bold">OPERATIONAL PRINCIPLE:</span>
          <span>Never resolve an incident on a single green check. Require 3 consecutive passing probes across 30 seconds.</span>
        </div>
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
          isResolved 
            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
        }`}>
          {isResolved ? '3/3 PASSES CONFIRMED' : '1/3 CHECKS PASSING'}
        </span>
      </div>
    </div>
  );
};
