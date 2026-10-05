import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { 
  Radio, 
  Search, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Activity,
  Heart,
  Plus,
  Trash2,
  PauseCircle,
  PlayCircle,
  ExternalLink,
  ShieldCheck,
  BarChart3,
  List,
  X,
  ChevronDown,
  Loader2
} from 'lucide-react';
import { HeartbeatPulseChart } from '../visuals/HeartbeatPulseChart';
import { EndpointMetricsVisualizer } from './EndpointMetricsVisualizer';
import { MonitorsService } from '../../services/monitors';
import { ApiError } from '../../services/api';
import { RbacGuard } from '../ui/RbacGuard';

// ── Monitor type options ──────────────────────────────────────────────────────
const MONITOR_TYPES = [
  'HTTP', 'HTTPS', 'APP_HEALTH', 'APP_READINESS', 'API_BUSINESS',
  'TCP', 'DNS', 'SSL', 'DB_CONN', 'DB_REPLICATION',
  'CRON_HEARTBEAT', 'WORKER_HEARTBEAT',
  'INFRA_CPU', 'INFRA_RAM', 'INFRA_DISK',
  'BACKUP_FRESHNESS', 'DEAD_MAN',
] as const;

// ── Default form values ───────────────────────────────────────────────────────
const DEFAULTS = {
  name: '',
  type: 'HTTP' as string,
  target: '',
  environment: 'PRD' as string,
  intervalSec: 60,
  timeoutSec: 10,
  retries: 2,
  warningThresholdMs: 1000,
  criticalThresholdMs: 3000,
  failureConfirmationThreshold: 3,
  recoveryConfirmationThreshold: 3,
  enabled: true,
};

// ── Add Monitor Form ──────────────────────────────────────────────────────────
interface AddMonitorFormProps {
  onClose: () => void;
  onCreated: () => void;
  isDark: boolean;
}

const AddMonitorForm: React.FC<AddMonitorFormProps> = ({ onClose, onCreated, isDark }) => {
  const [form, setForm] = useState({ ...DEFAULTS });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const set = (key: string, value: unknown) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Monitor name is required.'); return; }
    if (!form.target.trim()) { setError('Target URL or address is required.'); return; }

    setSaving(true);
    setError(null);
    try {
      await MonitorsService.create({
        name: form.name.trim(),
        type: form.type,
        target: form.target.trim(),
        environment: form.environment as 'PRD' | 'DR',
        interval_sec: form.intervalSec,
        timeout_sec: form.timeoutSec,
        retries: form.retries,
        warning_threshold_ms: form.warningThresholdMs,
        critical_threshold_ms: form.criticalThresholdMs,
        failure_confirmation_threshold: form.failureConfirmationThreshold,
        recovery_confirmation_threshold: form.recoveryConfirmationThreshold,
        enabled: form.enabled,
      } as Parameters<typeof MonitorsService.create>[0]);

      setSuccess(true);
      setTimeout(() => {
        onCreated();
        onClose();
      }, 800);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to create monitor. Check your credentials and try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const inputCls = `w-full px-2.5 py-1.5 rounded text-xs font-mono border focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 transition-colors ${
    isDark
      ? 'bg-[#0A0F1A] border-[#1E293B] text-slate-200 placeholder-slate-600'
      : 'bg-white border-slate-300 text-slate-800 placeholder-slate-400 shadow-xs'
  }`;
  const labelCls = `block text-[10px] font-mono font-semibold uppercase tracking-wider mb-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`h-full w-full max-w-md shadow-2xl overflow-y-auto flex flex-col animate-in slide-in-from-right duration-200 ${
          isDark ? 'bg-[#0D1220] border-l border-[#1E293B]' : 'bg-white border-l border-slate-200'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b shrink-0 ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
          <div>
            <h2 className={`text-sm font-bold font-mono ${isDark ? 'text-white' : 'text-slate-900'}`}>ADD MONITOR</h2>
            <p className={`text-[11px] font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              New probe via existing monitoring engine
            </p>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded transition-colors cursor-pointer ${isDark ? 'text-slate-500 hover:text-white hover:bg-[#1D2B44]' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 px-5 py-4 space-y-4">

          {/* Error / Success feedback */}
          {error && (
            <div className={`px-3 py-2.5 rounded border text-[11px] font-mono flex items-start gap-2 ${isDark ? 'bg-rose-950/60 border-rose-800/60 text-rose-300' : 'bg-rose-50 border-rose-300 text-rose-700'}`}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className={`px-3 py-2.5 rounded border text-[11px] font-mono flex items-center gap-2 ${isDark ? 'bg-emerald-950/60 border-emerald-800/60 text-emerald-300' : 'bg-emerald-50 border-emerald-300 text-emerald-700'}`}>
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Monitor created! Activating probe engine...</span>
            </div>
          )}

          {/* Name */}
          <div>
            <label className={labelCls}>Monitor Name *</label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. VPS1 - QR Production" className={inputCls} autoFocus />
          </div>

          {/* Type */}
          <div>
            <label className={labelCls}>Monitor Type *</label>
            <div className="relative">
              <select value={form.type} onChange={e => set('type', e.target.value)}
                className={`${inputCls} appearance-none pr-7 cursor-pointer`}>
                {MONITOR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-2 pointer-events-none text-slate-400" />
            </div>
          </div>

          {/* Target */}
          <div>
            <label className={labelCls}>Target URL / Address *</label>
            <input type="text" value={form.target} onChange={e => set('target', e.target.value)}
              placeholder="https://qr.kodeitglobal.com/api/videos" className={inputCls} />
            <p className={`text-[10px] font-mono mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
              HTTP/HTTPS: full URL · TCP: host:port · DNS: hostname
            </p>
          </div>

          {/* Environment */}
          <div>
            <label className={labelCls}>Environment</label>
            <div className="relative">
              <select value={form.environment} onChange={e => set('environment', e.target.value)}
                className={`${inputCls} appearance-none pr-7 cursor-pointer`}>
                <option value="PRD">PRD — Production</option>
                <option value="DR">DR — Disaster Recovery</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-2 pointer-events-none text-slate-400" />
            </div>
          </div>

          {/* Interval + Timeout */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Interval (sec)</label>
              <input type="number" min={10} max={3600} value={form.intervalSec}
                onChange={e => set('intervalSec', parseInt(e.target.value) || 60)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Timeout (sec)</label>
              <input type="number" min={1} max={60} value={form.timeoutSec}
                onChange={e => set('timeoutSec', parseInt(e.target.value) || 10)} className={inputCls} />
            </div>
          </div>

          {/* Retries */}
          <div>
            <label className={labelCls}>Retries</label>
            <input type="number" min={0} max={5} value={form.retries}
              onChange={e => set('retries', parseInt(e.target.value) || 0)} className={inputCls} />
          </div>

          {/* Warning + Critical thresholds */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Warning threshold (ms)</label>
              <input type="number" min={100} value={form.warningThresholdMs}
                onChange={e => set('warningThresholdMs', parseInt(e.target.value) || 1000)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Critical threshold (ms)</label>
              <input type="number" min={100} value={form.criticalThresholdMs}
                onChange={e => set('criticalThresholdMs', parseInt(e.target.value) || 3000)} className={inputCls} />
            </div>
          </div>

          {/* Failure / Recovery confirmation */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Failure confirm (checks)</label>
              <input type="number" min={1} max={10} value={form.failureConfirmationThreshold}
                onChange={e => set('failureConfirmationThreshold', parseInt(e.target.value) || 3)} className={inputCls} />
              <p className={`text-[10px] font-mono mt-0.5 ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>
                Default: 3 failures → incident
              </p>
            </div>
            <div>
              <label className={labelCls}>Recovery confirm (checks)</label>
              <input type="number" min={1} max={10} value={form.recoveryConfirmationThreshold}
                onChange={e => set('recoveryConfirmationThreshold', parseInt(e.target.value) || 3)} className={inputCls} />
              <p className={`text-[10px] font-mono mt-0.5 ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>
                Default: 3 passes → resolve
              </p>
            </div>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => set('enabled', !form.enabled)}
              className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${form.enabled ? 'bg-emerald-500' : isDark ? 'bg-slate-700' : 'bg-slate-300'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
            <span className={`text-xs font-mono ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
              {form.enabled ? 'Enabled — probe will start immediately' : 'Disabled — will not probe until enabled'}
            </span>
          </div>

          {/* Quick-fill button for QR Production */}
          <div className={`pt-1 border-t ${isDark ? 'border-[#1E293B]' : 'border-slate-100'}`}>
            <p className={`text-[10px] font-mono uppercase tracking-wider mb-2 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Quick fill</p>
            <button
              type="button"
              onClick={() => setForm({
                name: 'VPS1 - QR Production',
                type: 'HTTP',
                target: 'https://qr.kodeitglobal.com/api/videos',
                environment: 'PRD',
                intervalSec: 60,
                timeoutSec: 10,
                retries: 2,
                warningThresholdMs: 1000,
                criticalThresholdMs: 3000,
                failureConfirmationThreshold: 3,
                recoveryConfirmationThreshold: 3,
                enabled: true,
              })}
              className={`w-full px-3 py-2 text-[11px] font-mono rounded border cursor-pointer transition-colors text-left ${
                isDark ? 'border-[#243552] bg-[#111726] text-blue-400 hover:bg-[#162033]' : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
              }`}
            >
              ⚡ Fill: VPS1 - QR Production (https://qr.kodeitglobal.com/api/videos)
            </button>
          </div>

        </form>

        {/* Footer */}
        <div className={`px-5 py-4 border-t shrink-0 flex items-center gap-3 ${isDark ? 'border-[#1E293B] bg-[#080C14]' : 'border-slate-200 bg-slate-50'}`}>
          <button type="button" onClick={onClose}
            className={`flex-1 py-2 text-xs font-mono rounded border cursor-pointer transition-colors ${isDark ? 'border-[#243552] text-slate-300 hover:bg-[#1D2B44]' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`}>
            CANCEL
          </button>
          <button
            type="submit"
            form="add-monitor-form"
            disabled={saving || success}
            onClick={handleSubmit}
            className="flex-1 flex items-center justify-center gap-2 py-2 text-xs font-mono font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed rounded transition-colors cursor-pointer"
          >
            {saving
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating...</>
              : success
                ? <><CheckCircle2 className="w-3.5 h-3.5" /> Created!</>
                : <><Plus className="w-3.5 h-3.5" /> CREATE MONITOR</>
            }
          </button>
        </div>
      </div>
    </div>
  );
};


// ── Main MonitorsView ─────────────────────────────────────────────────────────
export const MonitorsView: React.FC = () => {
  const { 
    monitors, 
    applications, 
    runProbeCheck, 
    runAllProbes, 
    deleteMonitor,
    toggleMonitorStatus,
    setIsAddMonitorModalOpen,
    openAddMonitorWithContext,
    theme 
  } = useOps();
  const isDark = theme === 'dark';

  const [showAddForm, setShowAddForm] = useState(false);
  const [filterType, setFilterType] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [probingId, setProbingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'visualizer' | 'table'>('visualizer');

  const refreshData = () => {
    runAllProbes();
  };

  const handleManualCheck = async (id: string) => {
    setProbingId(id);
    await runProbeCheck(id);
    setTimeout(() => setProbingId(null), 1200);
  };

  const filteredMonitors = monitors
    .filter(m => {
      if (filterType === 'ALL') return true;
      if (filterType === 'FAILING') return m.status !== 'HEALTHY';
      return m.type === filterType;
    })
    .filter(m => {
      const q = search.toLowerCase();
      const app = applications.find(a => a.id === m.applicationId);
      return (
        m.name.toLowerCase().includes(q) ||
        m.target.toLowerCase().includes(q) ||
        (app?.name ?? '').toLowerCase().includes(q)
      );
    });

  return (
    <div className="space-y-6">

      {/* Add Monitor slide-in panel */}
      {showAddForm && (
        <AddMonitorForm
          onClose={() => setShowAddForm(false)}
          onCreated={() => refreshData()}
          isDark={isDark}
        />
      )}

      {/* Header */}
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            MONITORING PROBE ENGINE &amp; HEARTBEAT STREAM
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Continuous probes — HTTPS, TCP, DNS, SSL, DB, worker heartbeats &amp; dead-man watchdog
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Segmented View Mode Switcher */}
          <div className={`p-0.5 rounded-md border flex items-center ${
            isDark ? 'bg-[#0B0F17] border-[#1E293B]' : 'bg-slate-100 border-slate-300'
          }`}>
            <button
              onClick={() => setViewMode('visualizer')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-medium rounded transition-colors cursor-pointer ${
                viewMode === 'visualizer'
                  ? 'bg-blue-600 text-white font-bold shadow-xs'
                  : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>LATENCY &amp; UPTIME MATRIX</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-medium rounded transition-colors cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-blue-600 text-white font-bold shadow-xs'
                  : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>PROBES TABLE</span>
            </button>
          </div>

          <button
            onClick={() => setIsAddMonitorModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold rounded transition-all bg-blue-600 hover:bg-blue-500 text-white shadow-sm hover:shadow-blue-500/20 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>CREATE MONITOR</span>
          </button>

          <button
            onClick={() => runAllProbes()}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium rounded transition-colors border cursor-pointer ${
              isDark
                ? 'text-slate-200 bg-[#162033] hover:bg-[#1C2942] border-[#243552]'
                : 'text-slate-700 bg-white hover:bg-slate-50 border-slate-300 shadow-xs'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5 text-blue-500" />
            <span>PROBE ALL</span>
          </button>

          {/* Add Monitor button — visible to it_administrator and super_admin */}
          <RbacGuard minRole="it_administrator">
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors shadow-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>ADD MONITOR</span>
            </button>
          </RbacGuard>
        </div>
      </div>

      {/* Embedded Live Dead-Man Watchdog Heartbeat Waveform */}
      <HeartbeatPulseChart />

      {/* VIEW MODE 1: DEDICATED REAL-TIME LATENCY & UPTIME VISUALIZER */}
      {viewMode === 'visualizer' ? (
        <EndpointMetricsVisualizer onAddMonitorClick={() => setIsAddMonitorModalOpen(true)} />
      ) : (
        /* VIEW MODE 2: COMPREHENSIVE PROBES TABLE & PRINCIPLES */
        <>
          {/* 4 Monitoring Operational Principles */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 font-mono text-xs">
        <div className={`p-3 rounded border space-y-1 ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="text-[9px] font-bold text-blue-500 uppercase tracking-wider">1. Consecutive Failures</div>
          <div className="text-xs font-semibold">3-Failure Threshold</div>
          <p className={`text-[11px] font-sans leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Automatic retry on blips #1 &amp; #2. Incidents fire exclusively upon confirmed 3/3 failure sequence.
          </p>
        </div>

        <div className={`p-3 rounded border space-y-1 ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">2. Consecutive Recovery</div>
          <div className="text-xs font-semibold">3-Pass Verification</div>
          <p className={`text-[11px] font-sans leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Flapping prevention. Incidents do not resolve until 3 consecutive successful health probe confirmations.
          </p>
        </div>

        <div className={`p-3 rounded border space-y-1 ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="text-[9px] font-bold text-amber-500 uppercase tracking-wider">3. Incident Deduplication</div>
          <div className="text-xs font-semibold">Fingerprint Matching</div>
          <p className={`text-[11px] font-sans leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Repeated failures update existing incident timeline instead of opening duplicate tickets.
          </p>
        </div>

        <div className={`p-3 rounded border space-y-1 ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="text-[9px] font-bold text-indigo-500 uppercase tracking-wider">4. Watchdog Decoupling</div>
          <div className="text-xs font-semibold">Zurich Control Plane</div>
          <p className={`text-[11px] font-sans leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Independent monitoring outside Hostinger cluster verifies system is alive even if agents crash.
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-xs">
        <div className="flex flex-wrap items-center gap-1">
          {['ALL', 'FAILING', 'HTTP', 'HTTPS', 'TCP', 'DB_CONN', 'DEAD_MAN', 'SSL'].map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                filterType === t
                  ? 'bg-blue-600 text-white font-semibold shadow-xs'
                  : isDark
                    ? 'text-slate-400 hover:bg-[#162033]'
                    : 'text-slate-600 hover:bg-slate-200 bg-slate-100'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
          <input
            type="text"
            placeholder="Search probe or target..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`w-full pl-8 pr-3 py-1 rounded text-xs focus:outline-none focus:border-blue-500 border ${
              isDark
                ? 'bg-[#0B0F17] border-[#1E293B] text-slate-200'
                : 'bg-white border-slate-300 text-slate-900 shadow-xs'
            }`}
          />
        </div>
      </div>

      {/* Monitor count summary */}
      <div className={`text-[11px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
        Showing {filteredMonitors.length} of {monitors.length} monitors
        {monitors.filter(m => m.status !== 'HEALTHY').length > 0 && (
          <span className="text-rose-400 ml-2 font-semibold">
            · {monitors.filter(m => m.status !== 'HEALTHY').length} failing
          </span>
        )}
      </div>

      {/* Monitors Table */}
      <div className={`rounded-lg border overflow-hidden transition-colors ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className="w-full min-w-0 overflow-x-auto">
          <table className="w-full text-left text-xs font-mono min-w-[820px]">
            <thead className={`font-medium border-b ${
              isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}>
              <tr>
                <th className="py-2.5 px-3.5">Probe Target</th>
                <th className="py-2.5 px-3.5">Type</th>
                <th className="py-2.5 px-3.5">Application</th>
                <th className="py-2.5 px-3.5">24h Strip</th>
                <th className="py-2.5 px-3.5">Interval</th>
                <th className="py-2.5 px-3.5">Consecutive</th>
                <th className="py-2.5 px-3.5">Last Check</th>
                <th className="py-2.5 px-3.5">Latency</th>
                <th className="py-2.5 px-3.5">Health</th>
                <th className="py-2.5 px-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
              {filteredMonitors.length === 0 ? (
                <tr>
                  <td colSpan={10} className={`py-12 text-center text-xs font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    {monitors.length === 0
                      ? 'No monitors configured. Click ADD MONITOR to create the first probe.'
                      : 'No monitors match your filter.'}
                  </td>
                </tr>
              ) : filteredMonitors.map(m => {
                const app = applications.find(a => a.id === m.applicationId);
                const isCrit = m.status === 'CRITICAL' || m.status === 'WARNING';
                const isProbing = probingId === m.id;
                const lastCheckStr = m.lastCheck
                  ? new Date(m.lastCheck).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  : '—';

                // 24-bucket heartbeat bars
                const heartbeatBars = Array.from({ length: 24 }).map((_, i) => {
                  if (isCrit && i >= 20) return 'FAIL';
                  if (!isCrit && (i === 4 || i === 15)) return 'WARN';
                  return 'PASS';
                });

                return (
                  <tr
                    key={m.id}
                    className={`transition-colors ${
                      isCrit
                        ? (isDark ? 'bg-[#180E13]' : 'bg-rose-50/60')
                        : (isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50')
                    }`}
                  >
                    {/* Name + target */}
                    <td className="py-2.5 px-3.5 font-sans">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          m.status === 'HEALTHY' ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'
                        }`} />
                        <span className="font-semibold truncate max-w-[160px]" title={m.name}>{m.name}</span>
                      </div>
                      <div className={`text-[10px] font-mono mt-0.5 truncate max-w-[200px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`} title={m.target}>
                        {m.target}
                      </div>
                    </td>

                    {/* Type */}
                    <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                      {m.type}
                    </td>

                    {/* Application */}
                    <td className="py-2.5 px-3.5 font-sans">
                      {app?.name || <span className={`italic ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>None</span>}
                    </td>

                    {/* 24h heartbeat strip */}
                    <td className="py-2.5 px-3.5">
                      <div className="flex items-center gap-0.5">
                        {heartbeatBars.map((hb, idx) => (
                          <span key={idx} className={`w-1 h-3.5 rounded-sm ${
                            hb === 'PASS' ? 'bg-emerald-500/80' : hb === 'WARN' ? 'bg-amber-500' : 'bg-rose-500'
                          }`} />
                        ))}
                      </div>
                      <div className={`text-[9px] mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                        {isCrit ? 'Recent failures' : 'Passing'}
                      </div>
                    </td>

                    {/* Interval */}
                    <td className={`py-2.5 px-3.5 tabular-nums ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                      {m.intervalSec}s
                    </td>

                    {/* Consecutive status */}
                    <td className="py-2.5 px-3.5 tabular-nums">
                      {m.consecutiveFailures > 0 ? (
                        <span className="text-rose-500 font-bold">
                          {m.consecutiveFailures}/{m.failureConfirmationThreshold} fails
                        </span>
                      ) : (
                        <span className="text-emerald-500">
                          {m.consecutiveRecoveries} passes
                        </span>
                      )}
                    </td>

                    {/* Last check */}
                    <td className={`py-2.5 px-3.5 tabular-nums text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {lastCheckStr}
                    </td>

                    {/* Latency */}
                    <td className="py-2.5 px-3.5 tabular-nums">
                      <span className={
                        (m.responseTimeMs ?? 0) > 2000 ? 'text-rose-500 font-bold' :
                        (m.responseTimeMs ?? 0) > 500  ? 'text-amber-500' : ''
                      }>
                        {m.responseTimeMs != null ? `${m.responseTimeMs}ms` : '—'}
                      </span>
                    </td>

                    {/* Health */}
                    <td className="py-2.5 px-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-semibold ${
                          !m.enabled 
                            ? 'text-slate-500' 
                            : m.status === 'HEALTHY' 
                              ? 'text-emerald-500' 
                              : 'text-rose-500'
                        }`}>
                          {!m.enabled ? 'PAUSED' : m.status}
                        </span>
                        {!m.enabled && (
                          <span className={`text-[9px] px-1 py-0.2 rounded border font-mono ${
                            isDark ? 'bg-slate-900 border-slate-700 text-slate-400' : 'bg-slate-100 border-slate-300 text-slate-600'
                          }`}>OFF</span>
                        )}
                      </div>
                    </td>

                    {/* Probe button */}
                    <td className="py-2.5 px-3.5 text-right font-sans">
                      <div className="flex items-center justify-end gap-1 font-mono">
                        <button
                          onClick={() => handleManualCheck(m.id)}
                          disabled={isProbing || !m.enabled}
                          className={`px-2 py-0.5 rounded text-[11px] transition-colors inline-flex items-center gap-1 border cursor-pointer ${
                            isDark 
                              ? 'text-slate-300 hover:text-white hover:bg-[#1D2B44] border-[#23334E] disabled:opacity-40' 
                              : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100 border-slate-300 disabled:opacity-40'
                          }`}
                          title="Run probe now"
                        >
                          <RefreshCw className={`w-3 h-3 ${isProbing ? 'animate-spin text-blue-500' : ''}`} />
                          <span className="hidden sm:inline">PROBE</span>
                        </button>

                        <button
                          onClick={() => toggleMonitorStatus(m.id)}
                          className={`p-1 rounded text-[11px] transition-colors border cursor-pointer ${
                            m.enabled
                              ? (isDark ? 'text-amber-400 hover:bg-amber-950/40 border-amber-900/40' : 'text-amber-600 hover:bg-amber-50 border-amber-200')
                              : (isDark ? 'text-emerald-400 hover:bg-emerald-950/40 border-emerald-900/40' : 'text-emerald-600 hover:bg-emerald-50 border-emerald-200')
                          }`}
                          title={m.enabled ? 'Pause continuous monitoring' : 'Resume continuous monitoring'}
                        >
                          {m.enabled ? <PauseCircle className="w-3.5 h-3.5" /> : <PlayCircle className="w-3.5 h-3.5" />}
                        </button>

                        {confirmDeleteId === m.id ? (
                          <div className="flex items-center gap-1 animate-in fade-in">
                            <button
                              onClick={() => {
                                deleteMonitor(m.id);
                                setConfirmDeleteId(null);
                              }}
                              className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer"
                              title="Confirm delete"
                            >
                              YES
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-1.5 py-0.5 rounded text-[10px] bg-slate-600 hover:bg-slate-500 text-white cursor-pointer"
                              title="Cancel"
                            >
                              NO
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(m.id)}
                            className={`p-1 rounded transition-colors border cursor-pointer ${
                              isDark 
                                ? 'text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 border-transparent hover:border-rose-900/50' 
                                : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50 border-transparent hover:border-rose-200'
                            }`}
                            title="Delete this monitor probe"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredMonitors.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center font-mono">
                    <Activity className="w-8 h-8 text-slate-500 mx-auto mb-2 opacity-40 animate-pulse" />
                    <div className="text-sm font-semibold">No monitor probes match your filter</div>
                    <p className={`text-xs mt-1 max-w-sm mx-auto ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                      Create a new continuous health probe using real Hostinger VPS and application data.
                    </p>
                    <button
                      onClick={() => setIsAddMonitorModalOpen(true)}
                      className="mt-3 px-3 py-1.5 rounded text-xs font-mono font-bold bg-blue-600 hover:bg-blue-500 text-white inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>CREATE NEW MONITOR</span>
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

    </div>
  );
};
