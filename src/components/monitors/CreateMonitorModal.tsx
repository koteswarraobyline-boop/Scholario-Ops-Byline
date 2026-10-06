import React, { useState, useEffect, useMemo } from 'react';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Monitor, MonitorType, Environment } from '../../types';
import {
  X,
  Plus,
  Save,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Zap,
  RefreshCw,
  Info,
  Loader2,
} from 'lucide-react';

// ── Monitor type groups (mirror backend/engine.ts) ────────────────────────────
export const HTTP_MONITOR_TYPES: MonitorType[] = ['HTTP', 'HTTPS', 'APP_HEALTH', 'APP_READINESS', 'API_BUSINESS'];
export const TCP_MONITOR_TYPES: MonitorType[] = ['TCP', 'DB_CONN'];
export const INFRA_MONITOR_TYPES: MonitorType[] = ['INFRA_CPU', 'INFRA_RAM', 'INFRA_DISK'];
export const PUSH_MONITOR_TYPES: MonitorType[] = ['CRON_HEARTBEAT', 'WORKER_HEARTBEAT', 'DEAD_MAN', 'DB_REPLICATION', 'BACKUP_FRESHNESS'];

type TypeGroup = 'HTTP' | 'TCP' | 'DNS' | 'SSL' | 'INFRA' | 'PUSH';
export const monitorTypeGroup = (t: MonitorType): TypeGroup =>
  HTTP_MONITOR_TYPES.includes(t) ? 'HTTP'
    : TCP_MONITOR_TYPES.includes(t) ? 'TCP'
      : INFRA_MONITOR_TYPES.includes(t) ? 'INFRA'
        : PUSH_MONITOR_TYPES.includes(t) ? 'PUSH'
          : t === 'DNS' ? 'DNS' : 'SSL';

const TYPE_OPTIONS: { value: MonitorType; label: string }[] = [
  { value: 'HTTPS', label: 'HTTPS — web endpoint' },
  { value: 'HTTP', label: 'HTTP — plain web endpoint' },
  { value: 'APP_HEALTH', label: 'APP_HEALTH — application health URL' },
  { value: 'APP_READINESS', label: 'APP_READINESS — readiness URL' },
  { value: 'API_BUSINESS', label: 'API_BUSINESS — business API URL' },
  { value: 'TCP', label: 'TCP — host:port socket' },
  { value: 'DB_CONN', label: 'DB_CONN — database port' },
  { value: 'DNS', label: 'DNS — hostname resolution' },
  { value: 'SSL', label: 'SSL — certificate expiry' },
  { value: 'INFRA_CPU', label: 'INFRA_CPU — agent CPU %' },
  { value: 'INFRA_RAM', label: 'INFRA_RAM — agent RAM %' },
  { value: 'INFRA_DISK', label: 'INFRA_DISK — agent disk %' },
  { value: 'CRON_HEARTBEAT', label: 'CRON_HEARTBEAT — push ping' },
  { value: 'WORKER_HEARTBEAT', label: 'WORKER_HEARTBEAT — push ping' },
  { value: 'DEAD_MAN', label: 'DEAD_MAN — push ping' },
  { value: 'DB_REPLICATION', label: 'DB_REPLICATION — push lag value' },
  { value: 'BACKUP_FRESHNESS', label: 'BACKUP_FRESHNESS — push ping' },
];

const GROUP_DEFAULTS: Record<TypeGroup, { intervalSec: number; timeoutSec: number; warning: number; critical: number }> = {
  HTTP: { intervalSec: 60, timeoutSec: 10, warning: 1000, critical: 3000 },
  TCP: { intervalSec: 60, timeoutSec: 10, warning: 500, critical: 2000 },
  DNS: { intervalSec: 300, timeoutSec: 10, warning: 500, critical: 2000 },
  SSL: { intervalSec: 3600, timeoutSec: 15, warning: 1000, critical: 5000 },
  INFRA: { intervalSec: 60, timeoutSec: 10, warning: 80, critical: 95 },
  PUSH: { intervalSec: 300, timeoutSec: 60, warning: 0, critical: 0 },
};

const THRESHOLD_UNIT: Record<TypeGroup, string> = { HTTP: 'ms', TCP: 'ms', DNS: 'ms', SSL: 'ms', INFRA: '%', PUSH: 'ms' };

/** Extracts host and port from "host:port", "[v6]:port" or a URL. */
const parseHostPort = (raw: string): { host: string; port: number } | null => {
  const s = raw.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  const m = s.match(/^\[([^\]]+)\]:(\d+)$/) || s.match(/^([^:]+):(\d+)$/);
  if (!m) return null;
  const port = Number(m[2]);
  return port > 0 && port < 65536 ? { host: m[1], port } : null;
};
const hostOnly = (raw: string) => raw.trim().replace(/^[a-z]+:\/\//i, '').replace(/[/:].*$/, '');

interface TestResult {
  ok: boolean;
  latencyMs: number;
  title: string;
  lines: string[];
  snippet?: string;
  testedAt: string;
}

type InitialContext = { applicationId?: string; serverId?: string; defaultType?: MonitorType } | null;

interface MonitorFormModalProps {
  /** When set, the modal edits this monitor instead of creating a new one */
  existing?: Monitor | null;
  initialContext?: InitialContext;
  onClose: () => void;
}

export const MonitorFormModal: React.FC<MonitorFormModalProps> = ({ existing, initialContext, onClose }) => {
  const { applications, servers, runbooks, addMonitor, updateMonitor, theme } = useOps();
  const { canDo } = useAuth();
  const isDark = theme === 'dark';
  const isEdit = Boolean(existing);

  const [name, setName] = useState('');
  const [type, setType] = useState<MonitorType>('HTTPS');
  const [target, setTarget] = useState('');
  const [applicationId, setApplicationId] = useState('');
  const [environment, setEnvironment] = useState<Environment>('PRD');
  const [serverId, setServerId] = useState('');
  const [intervalSec, setIntervalSec] = useState(60);
  const [timeoutSec, setTimeoutSec] = useState(10);
  const [retries, setRetries] = useState(2);
  const [warningThreshold, setWarningThreshold] = useState(1000);
  const [criticalThreshold, setCriticalThreshold] = useState(3000);
  const [failureThreshold, setFailureThreshold] = useState(3);
  const [recoveryThreshold, setRecoveryThreshold] = useState(2);
  const [expectedStatusCode, setExpectedStatusCode] = useState('');
  const [expectedBodyContains, setExpectedBodyContains] = useState('');
  const [runbookId, setRunbookId] = useState('');
  const [enabled, setEnabled] = useState(true);

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Initialise once when the modal mounts
  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setType(existing.type);
      setTarget(existing.target === 'push' ? '' : existing.target);
      setApplicationId(existing.applicationId || '');
      setEnvironment(existing.environment);
      setServerId(existing.serverId || '');
      setIntervalSec(existing.intervalSec);
      setTimeoutSec(existing.timeoutSec);
      setRetries(existing.retries);
      setWarningThreshold(existing.warningThresholdMs);
      setCriticalThreshold(existing.criticalThresholdMs);
      setFailureThreshold(existing.failureConfirmationThreshold);
      setRecoveryThreshold(existing.recoveryConfirmationThreshold);
      setExpectedStatusCode(existing.expectedStatusCode ? String(existing.expectedStatusCode) : '');
      setExpectedBodyContains(existing.expectedBodyContains || '');
      setRunbookId(existing.runbookId || '');
      setEnabled(existing.enabled);
      return;
    }
    const initialType = initialContext?.defaultType || 'HTTPS';
    applyTypeDefaults(initialType);
    setType(initialType);
    if (initialContext?.applicationId) {
      const app = applications.find(a => a.id === initialContext.applicationId);
      if (app) {
        setApplicationId(app.id);
        setEnvironment('PRD');
        if (app.prdServerId) setServerId(app.prdServerId);
        if (app.dnsRecordName && monitorTypeGroup(initialType) === 'HTTP') setTarget(`https://${app.dnsRecordName}/health`);
        setName(`${app.name} PRD health`);
      }
    }
    if (initialContext?.serverId) {
      const srv = servers.find(s => s.id === initialContext.serverId);
      if (srv) {
        setServerId(srv.id);
        setEnvironment(srv.environment);
        if (srv.applicationId) setApplicationId(srv.applicationId);
        if (!initialContext.applicationId) setName(`${srv.hostname} ${initialType.toLowerCase()}`);
        if (INFRA_MONITOR_TYPES.includes(initialType)) setTarget(srv.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const group = monitorTypeGroup(type);
  const isPush = group === 'PUSH';
  const isInfra = group === 'INFRA';
  const unit = THRESHOLD_UNIT[group];

  function applyTypeDefaults(t: MonitorType) {
    const d = GROUP_DEFAULTS[monitorTypeGroup(t)];
    setIntervalSec(d.intervalSec);
    setTimeoutSec(d.timeoutSec);
    if (t === 'DB_REPLICATION') {
      setWarningThreshold(60_000);
      setCriticalThreshold(300_000);
    } else {
      setWarningThreshold(d.warning);
      setCriticalThreshold(d.critical);
    }
  }

  const handleTypeChange = (t: MonitorType) => {
    const prevGroup = monitorTypeGroup(type);
    setType(t);
    setTestResult(null);
    if (monitorTypeGroup(t) !== prevGroup || t === 'DB_REPLICATION' || type === 'DB_REPLICATION') {
      applyTypeDefaults(t);
      if (monitorTypeGroup(t) === 'INFRA') setTarget(serverId);
      else if (prevGroup === 'INFRA') setTarget('');
    }
  };

  const handleAppChange = (id: string) => {
    setApplicationId(id);
    const app = applications.find(a => a.id === id);
    if (!app) return;
    const linked = environment === 'PRD' ? app.prdServerId : app.drServerId;
    if (linked && !serverId) {
      setServerId(linked);
      if (isInfra) setTarget(linked);
    }
  };

  const handleEnvChange = (env: Environment) => {
    setEnvironment(env);
    const app = applications.find(a => a.id === applicationId);
    const linked = app ? (env === 'PRD' ? app.prdServerId : app.drServerId) : '';
    if (linked) {
      setServerId(linked);
      if (isInfra) setTarget(linked);
    }
  };

  const handleServerChange = (id: string) => {
    setServerId(id);
    if (isInfra) setTarget(id);
  };

  // Target suggestions derived from registered servers & applications
  const suggestions = useMemo(() => {
    const out: string[] = [];
    const appList = applicationId ? applications.filter(a => a.id === applicationId) : applications;
    const srvList = serverId ? servers.filter(s => s.id === serverId) : servers;
    if (group === 'HTTP') {
      appList.forEach(a => { if (a.dnsRecordName) out.push(`https://${a.dnsRecordName}/health`); });
      srvList.forEach(s => { if (s.ip) out.push(`http://${s.ip}/health`); });
    } else if (group === 'TCP') {
      const ports = type === 'DB_CONN' ? [3306, 5432] : [22, 443];
      srvList.forEach(s => { if (s.ip) ports.forEach(p => out.push(`${s.ip}:${p}`)); });
    } else if (group === 'DNS') {
      appList.forEach(a => { if (a.dnsRecordName) out.push(a.dnsRecordName); if (a.cloudflareZone) out.push(a.cloudflareZone); });
    } else if (group === 'SSL') {
      appList.forEach(a => { if (a.dnsRecordName) out.push(a.dnsRecordName); else if (a.cloudflareZone) out.push(a.cloudflareZone); });
    }
    return Array.from(new Set(out)).slice(0, 8);
  }, [group, type, applications, servers, applicationId, serverId]);

  // ── Live test against the real backend probe tools ──────────────────────────
  const handleRunTestProbe = async () => {
    const t = target.trim();
    if (!t) {
      setFormError('Enter a target before running a test probe.');
      return;
    }
    setFormError(null);
    setIsTesting(true);
    setTestResult(null);
    try {
      let result: TestResult;
      if (group === 'HTTP') {
        const url = /^https?:\/\//i.test(t) ? t : `${type === 'HTTP' ? 'http' : 'https'}://${t}`;
        const r = await api.httpTest({
          url,
          expectedStatus: expectedStatusCode ? Number(expectedStatusCode) : undefined,
          matchText: expectedBodyContains.trim() || undefined,
          timeoutSec,
        });
        const ok = r.reachable && r.expectedMatch;
        result = {
          ok,
          latencyMs: r.latencyMs,
          title: r.reachable ? `HTTP ${r.statusCode ?? '—'}${ok ? '' : ' — did not match expectations'}` : 'Unreachable',
          lines: [
            r.resolvedIp ? `Resolved IP: ${r.resolvedIp}` : '',
            r.tlsInfo ? `TLS: ${r.tlsInfo}` : '',
            r.error ? `Error: ${r.error}` : '',
          ].filter(Boolean),
          snippet: r.responseSnippet || undefined,
          testedAt: r.testedAt,
        };
      } else if (group === 'TCP') {
        const hp = parseHostPort(t);
        if (!hp) throw new Error('Target must be host:port, e.g. 203.0.113.10:3306');
        const r = await api.tcpTest(hp.host, hp.port);
        result = {
          ok: r.open,
          latencyMs: r.latencyMs,
          title: r.open ? `Port ${r.port} open on ${r.host}` : `Port ${r.port} closed / unreachable on ${r.host}`,
          lines: r.error ? [`Error: ${r.error}`] : [],
          testedAt: r.testedAt,
        };
      } else if (group === 'DNS') {
        const r = await api.dnsTest(hostOnly(t));
        result = { ok: r.ok, latencyMs: r.latencyMs, title: r.ok ? 'Resolved' : 'Resolution failed', lines: [r.detail].filter(Boolean), testedAt: new Date().toISOString() };
      } else if (group === 'SSL') {
        const r = await api.sslTest(hostOnly(t));
        result = {
          ok: r.ok,
          latencyMs: r.latencyMs,
          title: r.ok ? `Certificate valid${r.daysLeft !== null ? ` — ${r.daysLeft} days left` : ''}` : 'Certificate check failed',
          lines: [
            r.validTo ? `Valid to: ${new Date(r.validTo).toLocaleString()}` : '',
            r.issuer ? `Issuer: ${r.issuer}` : '',
            r.protocol ? `Protocol: ${r.protocol}` : '',
            r.detail,
          ].filter(Boolean),
          testedAt: new Date().toISOString(),
        };
      } else {
        return;
      }
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        latencyMs: 0,
        title: 'Test failed',
        lines: [err instanceof Error ? err.message : 'Unexpected error'],
        testedAt: new Date().toISOString(),
      });
    } finally {
      setIsTesting(false);
    }
  };

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setFormError('Enter a monitor name.');
    if (isInfra && !serverId) return setFormError('Select the server whose agent telemetry this monitor watches.');
    if (!isPush && !isInfra && !target.trim()) return setFormError('Enter a target host, host:port or URL.');
    if (!isPush && timeoutSec >= intervalSec) return setFormError('Timeout must be shorter than the check interval.');
    if (retries < 1 || retries > 5) return setFormError('Retries must be between 1 and 5.');
    if (intervalSec < 10) return setFormError('Interval must be at least 10 seconds.');
    if (criticalThreshold > 0 && warningThreshold > criticalThreshold) return setFormError('Warning threshold must not exceed the critical threshold.');
    if (expectedStatusCode && !/^\d{3}$/.test(expectedStatusCode)) return setFormError('Expected status code must be a 3-digit HTTP code.');

    setFormError(null);
    setIsSaving(true);
    // Built loosely so empty optional fields are sent as "clear" values the API understands
    const payload: Record<string, unknown> = {
      name: name.trim(),
      type,
      target: isInfra ? serverId : target.trim(),
      applicationId,
      environment,
      serverId: serverId || null,
      intervalSec,
      timeoutSec,
      retries,
      warningThresholdMs: warningThreshold,
      criticalThresholdMs: criticalThreshold,
      failureConfirmationThreshold: failureThreshold,
      recoveryConfirmationThreshold: recoveryThreshold,
      runbookId,
      enabled,
    };
    if (group === 'HTTP') {
      payload.expectedStatusCode = expectedStatusCode ? Number(expectedStatusCode) : null;
      payload.expectedBodyContains = expectedBodyContains.trim();
    }
    try {
      const saved = existing
        ? await updateMonitor(existing.id, payload as Partial<Monitor>)
        : await addMonitor(payload as Partial<Monitor>);
      if (saved) onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const canSave = isEdit ? canDo('update_monitor') : canDo('create_monitor');

  const inputCls = `w-full px-2.5 py-1.5 rounded text-xs font-mono border focus:outline-none focus:border-blue-500 ${
    isDark ? 'bg-[#0B0F17] border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900 shadow-2xs'
  }`;
  const labelCls = 'text-[11px] font-mono font-medium block';
  const hintCls = `text-[10px] block ${isDark ? 'text-slate-400' : 'text-slate-500'}`;
  const sectionTitleCls = `text-[11px] font-mono font-semibold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-600'}`;

  const targetPlaceholder =
    group === 'HTTP' ? 'https://app.example.com/health'
      : group === 'TCP' ? 'host:port, e.g. 203.0.113.10:3306'
        : group === 'DNS' || group === 'SSL' ? 'app.example.com'
          : 'Optional description of what pings this monitor';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 sm:p-5 overflow-y-auto animate-in fade-in" onClick={onClose}>
      <div
        className={`w-full max-w-4xl rounded-lg border overflow-hidden flex flex-col max-h-[92vh] shadow-2xl transition-colors ${
          isDark ? 'bg-[#0F1626] text-slate-100 border-[#223048]' : 'bg-white text-slate-900 border-slate-300'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-4 sm:px-6 border-b flex items-center justify-between shrink-0 ${
          isDark ? 'border-[#1E293B] bg-[#0A0F1A]' : 'border-slate-200 bg-slate-50'
        }`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-white shrink-0 shadow-sm">
              {isEdit ? <Save className="w-4 h-4" /> : <Plus className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold font-mono tracking-tight">
                {isEdit ? 'EDIT MONITOR' : 'CREATE MONITOR'}
              </h2>
              <p className={`text-xs font-mono mt-0.5 truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                {isEdit ? existing?.name : 'HTTP(S), TCP, DNS, SSL, agent resource and push-heartbeat checks'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`p-1.5 rounded transition-colors cursor-pointer shrink-0 ml-2 ${
              isDark ? 'text-slate-400 hover:text-white hover:bg-slate-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200'
            }`}
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">

          {/* 1. Basics */}
          <div className="space-y-3">
            <div className={sectionTitleCls}>1. Monitor</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 space-y-1">
                <label className={labelCls}>Monitor Name <span className="text-rose-500">*</span></label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Main site PRD health" className={inputCls} autoFocus />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Type</label>
                <select value={type} onChange={e => handleTypeChange(e.target.value as MonitorType)} className={`${inputCls} cursor-pointer`}>
                  {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* 2. Binding to real infrastructure */}
          <div className={`p-4 rounded-lg border space-y-3 ${isDark ? 'bg-[#121A2C] border-[#1E2B42]' : 'bg-slate-50/70 border-slate-200'}`}>
            <div className={sectionTitleCls}>2. Application, environment &amp; server</div>
            {applications.length === 0 && servers.length === 0 && (
              <div className={`text-[11px] font-mono flex items-center gap-1.5 ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
                <Info className="w-3.5 h-3.5 shrink-0" />
                No servers or applications registered yet — register them in Setup to link monitors to them.
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className={labelCls}>Application</label>
                <select value={applicationId} onChange={e => handleAppChange(e.target.value)} className={`${inputCls} cursor-pointer`}>
                  <option value="">None</option>
                  {applications.map(app => (
                    <option key={app.id} value={app.id}>{app.name} ({app.codeName})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Environment</label>
                <select value={environment} onChange={e => handleEnvChange(e.target.value as Environment)} className={`${inputCls} cursor-pointer`}>
                  <option value="PRD">PRD — production</option>
                  <option value="DR">DR — disaster recovery</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className={labelCls}>
                  Server {isInfra && <span className="text-rose-500">*</span>}
                </label>
                <select value={serverId} onChange={e => handleServerChange(e.target.value)} className={`${inputCls} cursor-pointer`}>
                  <option value="">{isInfra ? 'Select a server…' : 'None'}</option>
                  {servers.map(srv => (
                    <option key={srv.id} value={srv.id}>{srv.hostname} ({srv.ip || 'no IP'}) [{srv.environment}]</option>
                  ))}
                </select>
                <span className={hintCls}>{isInfra ? 'Reads CPU/RAM/disk from this server’s agent' : 'Server health includes this monitor'}</span>
              </div>
            </div>
          </div>

          {/* 3. Target */}
          {!isInfra && (
            <div className="space-y-1">
              <label className={labelCls}>
                {isPush ? 'Target / note (optional)' : <>Target <span className="text-rose-500">*</span></>}
              </label>
              <input type="text" value={target} onChange={e => { setTarget(e.target.value); setTestResult(null); }} placeholder={targetPlaceholder} className={inputCls} />
              {suggestions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px] font-mono">
                  <span className="text-slate-400">From your infrastructure:</span>
                  {suggestions.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { setTarget(s); setTestResult(null); }}
                      className={`px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                        isDark ? 'bg-[#151E30] hover:bg-[#1E2B44] border-slate-700 text-blue-400' : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-blue-600'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {isPush && (
                <span className={hintCls}>
                  Push monitors are not probed — your job pings a secret URL (shown after creation in the probes table). The monitor goes CRITICAL when no ping arrives within interval + grace.
                  {type === 'DB_REPLICATION' && ' Report lag in seconds with ?value=<seconds>.'}
                </span>
              )}
            </div>
          )}

          {/* 4. Timing & thresholds */}
          <div className="space-y-3">
            <div className={sectionTitleCls}>3. Timing &amp; thresholds</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className={labelCls}>{isPush ? 'Expected ping every (sec)' : 'Interval (sec)'}</label>
                <input type="number" min={10} value={intervalSec} onChange={e => setIntervalSec(Number(e.target.value) || 0)} className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{isPush ? 'Grace (sec)' : 'Timeout (sec)'}</label>
                <input type="number" min={1} value={timeoutSec} onChange={e => setTimeoutSec(Number(e.target.value) || 0)} className={inputCls} />
                {!isPush && <span className={hintCls}>Must be &lt; interval</span>}
              </div>
              {(!isPush || type === 'DB_REPLICATION') && (
                <>
                  <div className="space-y-1">
                    <label className={labelCls}>{isInfra ? 'Warning (%)' : type === 'DB_REPLICATION' ? 'Warning lag (ms)' : 'Warning latency (ms)'}</label>
                    <div className="relative">
                      <input type="number" min={0} value={warningThreshold} onChange={e => setWarningThreshold(Number(e.target.value) || 0)} className={inputCls} />
                      <span className="absolute right-2.5 top-1.5 text-[10px] text-slate-400 font-mono">{unit}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{isInfra ? 'Critical (%)' : type === 'DB_REPLICATION' ? 'Critical lag (ms)' : 'Critical latency (ms)'}</label>
                    <div className="relative">
                      <input type="number" min={0} value={criticalThreshold} onChange={e => setCriticalThreshold(Number(e.target.value) || 0)} className={inputCls} />
                      <span className="absolute right-2.5 top-1.5 text-[10px] text-slate-400 font-mono">{unit}</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {!isPush && !isInfra && (
                <div className="space-y-1">
                  <label className={labelCls}>Retries per check</label>
                  <select value={retries} onChange={e => setRetries(Number(e.target.value))} className={`${inputCls} cursor-pointer`}>
                    {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              )}
              <div className="space-y-1">
                <label className={labelCls}>Failure confirmation</label>
                <select value={failureThreshold} onChange={e => setFailureThreshold(Number(e.target.value))} className={`${inputCls} cursor-pointer`}>
                  {[1, 2, 3, 4, 5, 10].map(n => <option key={n} value={n}>{n} failed check{n > 1 ? 's' : ''}</option>)}
                </select>
                <span className={hintCls}>Consecutive failures before CRITICAL</span>
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Recovery confirmation</label>
                <select value={recoveryThreshold} onChange={e => setRecoveryThreshold(Number(e.target.value))} className={`${inputCls} cursor-pointer`}>
                  {[1, 2, 3, 4, 5, 10].map(n => <option key={n} value={n}>{n} passing check{n > 1 ? 's' : ''}</option>)}
                </select>
                <span className={hintCls}>Consecutive passes before recovered</span>
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Linked runbook</label>
                <select value={runbookId} onChange={e => setRunbookId(e.target.value)} className={`${inputCls} cursor-pointer`}>
                  <option value="">None</option>
                  {runbooks.map(rb => <option key={rb.id} value={rb.id}>{rb.title}</option>)}
                </select>
              </div>
            </div>

            {group === 'HTTP' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className={labelCls}>Expected status code</label>
                  <input type="text" inputMode="numeric" value={expectedStatusCode} onChange={e => setExpectedStatusCode(e.target.value.trim())} placeholder="Any 2xx/3xx" className={inputCls} />
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <label className={labelCls}>Response body must contain</label>
                  <input type="text" value={expectedBodyContains} onChange={e => setExpectedBodyContains(e.target.value)} placeholder="Optional text, e.g. ok" className={inputCls} />
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 text-xs font-mono cursor-pointer select-none">
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="cursor-pointer" />
              <span>{enabled ? 'Enabled — checks run on schedule' : 'Disabled — no checks until enabled'}</span>
            </label>
          </div>

          {/* 5. Live test against backend probe tools */}
          {!isPush && !isInfra && (
            <div className={`p-4 rounded-lg border space-y-3 ${isDark ? 'bg-[#0B101C] border-[#1A263D]' : 'bg-slate-100/70 border-slate-200'}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 text-amber-400">
                    <Zap className="w-3.5 h-3.5" />
                    Test before saving
                  </span>
                  <p className={`text-[11px] font-sans mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    Runs a one-off {group} check from the Scholario Ops server against this target.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRunTestProbe}
                  disabled={isTesting || !canDo('run_probe')}
                  title={canDo('run_probe') ? 'Run a one-off check' : 'Operator role required'}
                  className={`px-3 py-1.5 rounded text-xs font-mono font-bold transition-all cursor-pointer flex items-center gap-1.5 border shrink-0 disabled:opacity-60 disabled:cursor-not-allowed ${
                    isDark ? 'bg-[#1A2338] hover:bg-[#22304D] border-amber-500/60 text-amber-300' : 'bg-white hover:bg-amber-50 border-amber-500 text-amber-800 shadow-2xs'
                  }`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                  <span>{isTesting ? 'TESTING…' : 'TEST NOW'}</span>
                </button>
              </div>

              {testResult && (
                <div className={`p-3 rounded border space-y-2 animate-in fade-in font-mono text-xs ${
                  testResult.ok
                    ? (isDark ? 'bg-[#0D1C18] border-emerald-900/80 text-emerald-200' : 'bg-emerald-50/80 border-emerald-300 text-emerald-950')
                    : (isDark ? 'bg-[#1C0F12] border-rose-900/80 text-rose-200' : 'bg-rose-50/80 border-rose-300 text-rose-950')
                }`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-inherit">
                    <div className="flex items-center gap-2">
                      {testResult.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-rose-400" />}
                      <span className="font-bold">{testResult.title}</span>
                      {testResult.latencyMs > 0 && (
                        <span className="text-[10px] px-1.5 rounded border border-current/40">{testResult.latencyMs}ms</span>
                      )}
                    </div>
                    <span className="text-[10px] opacity-75">
                      {Number.isNaN(Date.parse(testResult.testedAt)) ? '' : `Tested ${new Date(testResult.testedAt).toLocaleTimeString()}`}
                    </span>
                  </div>
                  {testResult.lines.length > 0 && (
                    <div className="space-y-0.5 text-[11px] break-all">
                      {testResult.lines.map((l, i) => <div key={i}>{l}</div>)}
                    </div>
                  )}
                  {testResult.snippet && (
                    <div className={`p-2 rounded text-[10px] font-mono whitespace-pre-wrap overflow-x-auto max-h-24 ${
                      isDark ? 'bg-black/60 text-slate-300' : 'bg-white text-slate-800 border border-slate-200'
                    }`}>
                      {testResult.snippet}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {formError && (
            <div className={`p-3 rounded border text-xs font-mono flex items-center gap-2 ${
              isDark ? 'border-rose-800 bg-rose-950/40 text-rose-200' : 'border-rose-300 bg-rose-50 text-rose-700'
            }`}>
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {/* Footer */}
          <div className={`pt-4 border-t flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 shrink-0 ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
            <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
              <Info className="w-3.5 h-3.5" />
              <span>
                {isPush ? `Expects a ping every ${intervalSec}s (+${timeoutSec}s grace)` : `Checks run every ${intervalSec}s`}
              </span>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                onClick={onClose}
                className={`px-4 py-2 rounded text-xs font-mono font-medium transition-colors border cursor-pointer ${
                  isDark ? 'text-slate-400 hover:text-white hover:bg-slate-800 border-slate-700' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border-slate-300'
                }`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving || !canSave}
                title={canSave ? undefined : 'IT administrator role required'}
                className="px-5 py-2 rounded text-xs font-mono font-bold bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-md cursor-pointer flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : isEdit ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                <span>{isSaving ? 'SAVING…' : isEdit ? 'SAVE CHANGES' : 'CREATE MONITOR'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

/** Global "create monitor" modal driven by OpsContext (rendered once in the Shell). */
export const CreateMonitorModal: React.FC = () => {
  const { isAddMonitorModalOpen, setIsAddMonitorModalOpen, addMonitorInitialContext } = useOps();
  if (!isAddMonitorModalOpen) return null;
  return (
    <MonitorFormModal
      key={JSON.stringify(addMonitorInitialContext ?? {})}
      initialContext={addMonitorInitialContext}
      onClose={() => setIsAddMonitorModalOpen(false)}
    />
  );
};
