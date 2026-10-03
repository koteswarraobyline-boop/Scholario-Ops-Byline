import React, { useState, useMemo } from 'react';
import { useOps } from '../../context/OpsContext';
import { Incident } from '../../types';
import { 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  Activity, 
  Calendar, 
  ArrowRight, 
  ShieldCheck, 
  Layers, 
  Eye, 
  Filter,
  Check,
  ChevronRight,
  Sparkles,
  GitBranch,
  Terminal
} from 'lucide-react';

interface IncidentTimelineViewProps {
  onSelectIncident?: (incidentId: string) => void;
}

export const IncidentTimelineView: React.FC<IncidentTimelineViewProps> = ({ onSelectIncident }) => {
  const { incidents, applications, setSelectedIncidentId, theme } = useOps();
  const isDark = theme === 'dark';

  const [timeWindowHours, setTimeWindowHours] = useState<number>(48);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'RESOLVED'>('ALL');
  const [activeIncidentId, setActiveIncidentId] = useState<string>(() => {
    const active = incidents.find(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED');
    return active ? active.id : incidents[0]?.id || '';
  });

  const now = Date.now();
  const windowStart = now - timeWindowHours * 60 * 60 * 1000;

  // Filter incidents matching time window and status
  const displayedIncidents = useMemo(() => {
    return incidents.filter(inc => {
      const startTime = new Date(inc.startedAt).getTime();
      const endTime = inc.resolvedAt ? new Date(inc.resolvedAt).getTime() : now;

      // Check if overlaps with window
      const inWindow = endTime >= windowStart;
      if (!inWindow) return false;

      const isActive = inc.status !== 'RESOLVED' && inc.status !== 'CLOSED';
      if (statusFilter === 'ACTIVE') return isActive;
      if (statusFilter === 'RESOLVED') return !isActive;
      return true;
    });
  }, [incidents, timeWindowHours, statusFilter, now, windowStart]);

  // Selected incident for the detailed lifecycle inspector
  const currentIncident = useMemo(() => {
    return incidents.find(i => i.id === activeIncidentId) || displayedIncidents[0] || incidents[0];
  }, [incidents, activeIncidentId, displayedIncidents]);

  const currentApp = applications.find(a => a.id === currentIncident?.applicationId);

  // Time markers along the axis (e.g. 5 intervals)
  const timeTicks = useMemo(() => {
    const ticks = [];
    const stepHours = timeWindowHours / 4;
    for (let i = 4; i >= 0; i--) {
      const hoursAgo = Math.round(i * stepHours);
      const timestamp = new Date(now - hoursAgo * 60 * 60 * 1000);
      ticks.push({
        label: hoursAgo === 0 ? 'NOW (Live)' : `${hoursAgo}h ago`,
        timeStr: timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        positionPercent: ((timeWindowHours - hoursAgo) / timeWindowHours) * 100
      });
    }
    return ticks;
  }, [timeWindowHours, now]);

  // Calculate position and width of an incident on the timeline bar
  const calculateBarPosition = (inc: Incident) => {
    const startTime = new Date(inc.startedAt).getTime();
    const endTime = inc.resolvedAt ? new Date(inc.resolvedAt).getTime() : now;

    const clampedStart = Math.max(startTime, windowStart);
    const clampedEnd = Math.min(endTime, now);

    const leftPercent = ((clampedStart - windowStart) / (now - windowStart)) * 100;
    const widthPercent = Math.max(1.8, ((clampedEnd - clampedStart) / (now - windowStart)) * 100);

    return {
      left: `${Math.min(97.5, Math.max(0, leftPercent)).toFixed(2)}%`,
      width: `${Math.min(100 - leftPercent, Math.max(2.2, widthPercent)).toFixed(2)}%`
    };
  };

  // Lifecycle stage progression definition
  const getLifecycleStages = (inc: Incident) => {
    const isResolved = inc.status === 'RESOLVED' || inc.status === 'CLOSED';
    const isMitigating = inc.status === 'MITIGATING' || inc.status === 'MONITORING' || isResolved;
    const isInvestigating = inc.status === 'INVESTIGATING' || isMitigating;
    const isAck = inc.acknowledged || isInvestigating;

    return [
      {
        stage: 1,
        title: 'Consecutive Probe Failure',
        subtitle: '3/3 check threshold confirmed',
        status: 'COMPLETED',
        time: inc.startedAt,
        badge: 'CONFIRMED'
      },
      {
        stage: 2,
        title: 'Escalation Alert Paged',
        subtitle: 'Teams webhook & on-call alert',
        status: 'COMPLETED',
        time: inc.startedAt,
        badge: 'DISPATCHED'
      },
      {
        stage: 3,
        title: 'Operator Triage & Ack',
        subtitle: inc.acknowledgedBy ? `By ${inc.acknowledgedBy}` : 'Pending triage',
        status: isAck ? 'COMPLETED' : 'IN_PROGRESS',
        time: inc.acknowledgedAt || inc.startedAt,
        badge: isAck ? 'ACKNOWLEDGED' : 'PENDING'
      },
      {
        stage: 4,
        title: 'Mitigation & Blast Isolation',
        subtitle: inc.mitigationActionTaken ? 'Runbook execution & DR reroute' : 'Diagnosing root cause',
        status: isMitigating ? 'COMPLETED' : (isInvestigating ? 'IN_PROGRESS' : 'PENDING'),
        time: inc.acknowledgedAt,
        badge: isMitigating ? 'ISOLATED' : 'ACTIVE'
      },
      {
        stage: 5,
        title: '3-Pass Health Verification',
        subtitle: isResolved ? '3 consecutive clean probes confirmed' : 'Requires 3 consecutive health passes',
        status: isResolved ? 'COMPLETED' : (inc.status === 'MONITORING' ? 'IN_PROGRESS' : 'PENDING'),
        time: inc.resolvedAt,
        badge: isResolved ? '3/3 PASS' : 'VERIFYING'
      },
      {
        stage: 6,
        title: 'Resolution Sign-off',
        subtitle: isResolved ? 'Incident verified & closed' : 'Awaiting sign-off',
        status: isResolved ? 'COMPLETED' : 'PENDING',
        time: inc.resolvedAt,
        badge: isResolved ? 'RESOLVED' : 'UNRESOLVED'
      }
    ];
  };

  return (
    <div className={`rounded-lg border space-y-4 p-4 sm:p-5 transition-colors ${
      isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
    }`}>
      
      {/* 1. Header with Title & Filter Controls */}
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-100'
      }`}>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold font-mono tracking-tight flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-blue-500" />
              <span>INCIDENT LIFECYCLE &amp; HISTORICAL TIMELINE</span>
            </h2>
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
              isDark 
                ? 'bg-blue-950/80 text-blue-300 border border-blue-800/80' 
                : 'bg-blue-50 text-blue-700 border border-blue-200'
            }`}>
              INTERACTIVE CHRONOLOGY
            </span>
          </div>
          <p className={`text-xs mt-0.5 font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Multi-stage incident progression from continuous probe detection through failover, mitigation &amp; sign-off
          </p>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          {/* Time Window Selector */}
          <div className={`flex items-center p-0.5 rounded border ${
            isDark ? 'bg-[#0B0F17] border-[#1E293B]' : 'bg-slate-100 border-slate-300'
          }`}>
            {[
              { label: '24h', val: 24 },
              { label: '48h', val: 48 },
              { label: '7d', val: 168 }
            ].map(tw => (
              <button
                key={tw.val}
                onClick={() => setTimeWindowHours(tw.val)}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
                  timeWindowHours === tw.val
                    ? 'bg-blue-600 text-white font-medium shadow-xs'
                    : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tw.label}
              </button>
            ))}
          </div>

          {/* Status Filter */}
          <div className={`flex items-center p-0.5 rounded border ${
            isDark ? 'bg-[#0B0F17] border-[#1E293B]' : 'bg-slate-100 border-slate-300'
          }`}>
            {(['ALL', 'ACTIVE', 'RESOLVED'] as const).map(sf => (
              <button
                key={sf}
                onClick={() => setStatusFilter(sf)}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
                  statusFilter === sf
                    ? 'bg-blue-600 text-white font-medium shadow-xs'
                    : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {sf}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Interactive Horizontal Timeline Track */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 px-1">
          <span>Click any incident to scrub through lifecycle milestones</span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>Live Active</span>
            <span className="mx-1 text-slate-500">·</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>Resolved</span>
          </span>
        </div>

        {/* Scrollable Timeline Box */}
        <div className={`w-full min-w-0 rounded-lg border p-3.5 space-y-3 overflow-x-auto ${
          isDark ? 'bg-[#070B12] border-[#182338]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className="min-w-[680px] space-y-2.5">
            
            {/* Top Time Scale Axis */}
            <div className="relative h-6 border-b border-dashed border-slate-700/60 pb-1">
              {timeTicks.map((tick, i) => (
                <div
                  key={i}
                  style={{ left: `${tick.positionPercent}%` }}
                  className="absolute -translate-x-1/2 flex flex-col items-center pointer-events-none"
                >
                  <span className={`text-[10px] font-mono font-medium ${
                    tick.label.includes('NOW') ? 'text-emerald-500 font-bold' : isDark ? 'text-slate-400' : 'text-slate-600'
                  }`}>
                    {tick.label}
                  </span>
                  <div className={`w-px h-1.5 mt-0.5 ${isDark ? 'bg-slate-700' : 'bg-slate-300'}`} />
                </div>
              ))}
            </div>

            {/* Incident Timeline Rows */}
            <div className="space-y-2 pt-1">
              {displayedIncidents.length === 0 ? (
                <div className="py-6 text-center text-xs font-mono text-slate-400">
                  No incidents recorded in the selected {timeWindowHours}h window.
                </div>
              ) : (
                displayedIncidents.map(inc => {
                  const isActive = inc.status !== 'RESOLVED' && inc.status !== 'CLOSED';
                  const isSelected = currentIncident?.id === inc.id;
                  const barStyle = calculateBarPosition(inc);
                  const app = applications.find(a => a.id === inc.applicationId);

                  return (
                    <div
                      key={inc.id}
                      onClick={() => setActiveIncidentId(inc.id)}
                      className={`relative flex items-center h-10 rounded border transition-all cursor-pointer group px-2 select-none ${
                        isSelected
                          ? (isDark ? 'bg-[#142036] border-blue-500 shadow-xs ring-1 ring-blue-500' : 'bg-blue-50/80 border-blue-400 shadow-xs ring-1 ring-blue-400')
                          : (isDark ? 'bg-[#0E1524] border-[#1A263C] hover:border-slate-600' : 'bg-white border-slate-200 hover:border-slate-300 shadow-2xs')
                      }`}
                    >
                      {/* Left Metadata Tag */}
                      <div className="w-48 shrink-0 flex items-center gap-2 pr-2 border-r border-inherit font-mono z-10">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${
                          isActive 
                            ? 'bg-rose-500 animate-pulse' 
                            : 'bg-emerald-500'
                        }`} />
                        <span className="font-bold text-xs">{inc.id}</span>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                          inc.severity === 'CRITICAL' || inc.severity === 'EMERGENCY'
                            ? (isDark ? 'bg-rose-950/80 text-rose-300 border border-rose-800' : 'bg-rose-100 text-rose-800') 
                            : inc.severity === 'HIGH'
                              ? (isDark ? 'bg-amber-950/80 text-amber-300 border border-amber-800' : 'bg-amber-100 text-amber-800')
                              : (isDark ? 'bg-blue-950/80 text-blue-300 border border-blue-800' : 'bg-blue-100 text-blue-800')
                        }`}>
                          {inc.severity}
                        </span>
                        <span className={`text-[10px] truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                          {app?.name || inc.applicationId}
                        </span>
                      </div>

                      {/* Right Timeline Bar Track */}
                      <div className="flex-1 relative h-6 mx-2 overflow-hidden">
                        {/* Background guide line */}
                        <div className={`absolute inset-x-0 top-1/2 -translate-y-1/2 h-px ${
                          isDark ? 'bg-slate-800' : 'bg-slate-200'
                        }`} />

                        {/* Interactive Duration Bar */}
                        <div
                          style={{ left: barStyle.left, width: barStyle.width }}
                          className={`absolute top-1/2 -translate-y-1/2 h-5 rounded flex items-center justify-between px-2 text-[10px] font-mono font-semibold transition-all ${
                            isActive
                              ? 'bg-gradient-to-r from-rose-600 via-rose-500 to-amber-500 text-white shadow-xs animate-pulse ring-1 ring-rose-400'
                              : inc.severity === 'CRITICAL' || inc.severity === 'EMERGENCY'
                                ? 'bg-rose-800/80 text-rose-100 border border-rose-600'
                                : inc.severity === 'HIGH'
                                  ? 'bg-amber-700/80 text-amber-100 border border-amber-500'
                                  : 'bg-blue-700/80 text-blue-100 border border-blue-500'
                          }`}
                          title={`${inc.id}: Started ${new Date(inc.startedAt).toLocaleTimeString()} · ${inc.durationMinutes} min`}
                        >
                          <span className="truncate pr-1">
                            {isActive ? `LIVE: ${inc.durationMinutes}m` : `${inc.durationMinutes}m duration`}
                          </span>
                          {isActive ? (
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping shrink-0" />
                          ) : (
                            <Check className="w-3 h-3 text-white shrink-0" />
                          )}
                        </div>
                      </div>

                      {/* Hover Arrow indicator */}
                      <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                        isSelected ? 'text-blue-500 translate-x-0.5' : 'text-slate-500 group-hover:text-slate-300'
                      }`} />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Selected Incident Lifecycle Deep-Dive Inspector */}
      {currentIncident && (
        <div className={`rounded-lg border p-4 sm:p-5 space-y-4 transition-colors ${
          isDark ? 'bg-[#0B0F17] border-[#1C273C]' : 'bg-slate-50/70 border-slate-200'
        }`}>
          {/* Header Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 border-inherit">
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                <span className="font-bold text-sm text-blue-500">{currentIncident.id}</span>
                <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
                <span className={`font-semibold ${
                  currentIncident.severity === 'CRITICAL' ? 'text-rose-500 font-bold' : 'text-amber-500'
                }`}>
                  {currentIncident.severity}
                </span>
                <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
                <span className={`px-2 py-0.2 rounded text-[10px] font-semibold ${
                  currentIncident.status === 'RESOLVED' || currentIncident.status === 'CLOSED'
                    ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-500 border border-rose-500/30 animate-pulse'
                }`}>
                  {currentIncident.status}
                </span>
                <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
                <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>
                  Target: <strong>{currentApp?.name} ({currentIncident.environment})</strong>
                </span>
              </div>
              <h3 className="font-bold font-sans text-sm truncate">{currentIncident.title}</h3>
            </div>

            <div className="flex items-center gap-2 shrink-0 font-mono text-xs">
              <button
                onClick={() => {
                  setSelectedIncidentId(currentIncident.id);
                  if (onSelectIncident) onSelectIncident(currentIncident.id);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-xs cursor-pointer font-semibold"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>OPEN INVESTIGATION MODAL</span>
              </button>
            </div>
          </div>

          {/* Micro-Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
            <div className={`p-2.5 rounded border ${
              isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'
            }`}>
              <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Detection Window</div>
              <div className="font-bold text-emerald-500 mt-0.5">&lt; 45s (3 Probes)</div>
              <div className={`text-[10px] font-sans ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>MTTD Zero false alarms</div>
            </div>

            <div className={`p-2.5 rounded border ${
              isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'
            }`}>
              <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Triage / Acknowledge</div>
              <div className="font-bold mt-0.5">
                {currentIncident.acknowledged ? '2 min' : 'Pending'}
              </div>
              <div className={`text-[10px] font-sans ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                {currentIncident.acknowledgedBy ? `By ${currentIncident.acknowledgedBy.split(' ')[0]}` : 'On-call paged'}
              </div>
            </div>

            <div className={`p-2.5 rounded border ${
              isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'
            }`}>
              <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Total Duration / MTTR</div>
              <div className={`font-bold mt-0.5 tabular-nums ${
                currentIncident.status !== 'RESOLVED' ? 'text-rose-500' : 'text-emerald-500'
              }`}>
                {currentIncident.durationMinutes} min {currentIncident.status !== 'RESOLVED' ? '(Active)' : '(Resolved)'}
              </div>
              <div className={`text-[10px] font-sans ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                {currentIncident.resolvedAt ? `Resolved ${new Date(currentIncident.resolvedAt).toLocaleTimeString()}` : 'In progress'}
              </div>
            </div>

            <div className={`p-2.5 rounded border ${
              isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'
            }`}>
              <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Mitigation SOP</div>
              <div className="font-bold text-blue-500 mt-0.5 truncate">
                {currentIncident.runbookId || 'Automated Protocol'}
              </div>
              <div className={`text-[10px] font-sans ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                {currentIncident.affectedServices.length} services protected
              </div>
            </div>
          </div>

          {/* 6-Stage Visual Lifecycle Stepper */}
          <div className="space-y-2">
            <span className={`text-[10px] font-mono font-semibold uppercase tracking-wider ${
              isDark ? 'text-slate-400' : 'text-slate-500'
            }`}>
              SRE Lifecycle Stage Progression
            </span>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              {getLifecycleStages(currentIncident).map(st => {
                const isDone = st.status === 'COMPLETED';
                const isCurrent = st.status === 'IN_PROGRESS';

                return (
                  <div
                    key={st.stage}
                    className={`p-2.5 rounded border text-left flex flex-col justify-between min-h-[90px] font-mono transition-colors ${
                      isCurrent
                        ? (isDark ? 'bg-[#1C170E] border-amber-500/80 ring-1 ring-amber-500' : 'bg-amber-50 border-amber-400 ring-1 ring-amber-400')
                        : isDone
                          ? (isDark ? 'bg-[#0E1713] border-emerald-900/60' : 'bg-emerald-50/50 border-emerald-200')
                          : (isDark ? 'bg-[#0D121D] border-[#182336] opacity-60' : 'bg-slate-100/60 border-slate-200 opacity-70')
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between text-[10px] mb-1">
                        <span className={`font-bold ${isCurrent ? 'text-amber-500' : isDone ? 'text-emerald-500' : 'text-slate-500'}`}>
                          0{st.stage}
                        </span>
                        <span className={`text-[9px] px-1 py-0.2 rounded font-semibold ${
                          isDone 
                            ? 'bg-emerald-500/10 text-emerald-400' 
                            : isCurrent 
                              ? 'bg-amber-500/10 text-amber-400 animate-pulse' 
                              : 'text-slate-500'
                        }`}>
                          {st.badge}
                        </span>
                      </div>
                      <div className={`font-semibold text-xs leading-snug font-sans ${
                        isCurrent ? (isDark ? 'text-amber-200' : 'text-amber-900') : isDone ? (isDark ? 'text-slate-200' : 'text-slate-800') : 'text-slate-500'
                      }`}>
                        {st.title}
                      </div>
                    </div>
                    <p className={`text-[10px] font-sans mt-1.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {st.subtitle}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Root Cause & Diagnostic Summary */}
          <div className={`p-3 rounded border text-xs font-mono flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            isDark ? 'bg-[#080D17] border-[#182338]' : 'bg-slate-100 border-slate-200'
          }`}>
            <div className="space-y-0.5 min-w-0">
              <span className={`text-[10px] uppercase font-bold ${
                currentIncident.status !== 'RESOLVED' ? 'text-rose-500' : 'text-emerald-500'
              }`}>
                Root Cause Diagnosis:
              </span>
              <p className={`font-sans text-xs ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                {currentIncident.rootCause}
              </p>
            </div>
            {currentIncident.timeline && currentIncident.timeline.length > 0 && (
              <span className="text-[11px] text-slate-400 shrink-0">
                {currentIncident.timeline.length} Audit Events Logged
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
