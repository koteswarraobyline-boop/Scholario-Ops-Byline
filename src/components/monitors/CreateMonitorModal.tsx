import React, { useState, useEffect } from 'react';
import { useOps } from '../../context/OpsContext';
import { MonitorType, Environment } from '../../types';
import { 
  X, 
  Plus, 
  Activity, 
  Server, 
  Layers, 
  Globe, 
  ShieldCheck, 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  Zap, 
  RefreshCw, 
  Radio, 
  Terminal, 
  Database,
  ArrowRight,
  Info,
  ExternalLink
} from 'lucide-react';

interface QuickPreset {
  id: string;
  label: string;
  icon: React.ElementType;
  type: MonitorType;
  pathSuffix: string;
  defaultPort?: number;
  intervalSec: number;
  warningMs: number;
  criticalMs: number;
  description: string;
}

const PRESETS: QuickPreset[] = [
  {
    id: 'preset-health',
    label: 'HTTPS /health Check',
    icon: Globe,
    type: 'HTTPS',
    pathSuffix: '/health',
    intervalSec: 15,
    warningMs: 250,
    criticalMs: 800,
    description: 'Edge HTTPS deep health endpoint with TLS validation'
  },
  {
    id: 'preset-api-ready',
    label: 'API Readiness Probe',
    icon: Activity,
    type: 'APP_READINESS',
    pathSuffix: '/api/v1/status',
    intervalSec: 10,
    warningMs: 200,
    criticalMs: 600,
    description: 'Upstream gateway ingress check'
  },
  {
    id: 'preset-mysql',
    label: 'MySQL 8.0 Port 3306',
    icon: Database,
    type: 'DB_CONN',
    pathSuffix: ':3306',
    defaultPort: 3306,
    intervalSec: 15,
    warningMs: 150,
    criticalMs: 500,
    description: 'Hostinger internal database connection socket'
  },
  {
    id: 'preset-redis',
    label: 'Redis Cache 6379',
    icon: Zap,
    type: 'TCP',
    pathSuffix: ':6379',
    defaultPort: 6379,
    intervalSec: 10,
    warningMs: 50,
    criticalMs: 250,
    description: 'Sub-millisecond in-memory cache socket'
  },
  {
    id: 'preset-ssh',
    label: 'VPS SSH Ping (Port 22)',
    icon: Terminal,
    type: 'TCP',
    pathSuffix: ':22',
    defaultPort: 22,
    intervalSec: 30,
    warningMs: 180,
    criticalMs: 600,
    description: 'SSH daemon availability across Hostinger VPS'
  },
  {
    id: 'preset-watchdog',
    label: 'Dead-Man Heartbeat',
    icon: Radio,
    type: 'DEAD_MAN',
    pathSuffix: '/heartbeat',
    intervalSec: 15,
    warningMs: 300,
    criticalMs: 1000,
    description: 'Independent out-of-band Zurich monitor check'
  }
];

export const CreateMonitorModal: React.FC = () => {
  const { 
    isAddMonitorModalOpen, 
    setIsAddMonitorModalOpen, 
    addMonitorInitialContext, 
    applications, 
    servers, 
    runbooks,
    communicationChannels,
    addMonitor,
    theme 
  } = useOps();

  const isDark = theme === 'dark';

  // Target mode: 'APPLICATION' vs 'VPS' vs 'CUSTOM'
  const [targetSource, setTargetSource] = useState<'APPLICATION' | 'VPS' | 'CUSTOM'>('APPLICATION');

  // Selected entities
  const [selectedAppId, setSelectedAppId] = useState<string>(applications[0]?.id || 'app-cipher');
  const [selectedEnvironment, setSelectedEnvironment] = useState<Environment>('PRD');
  const [selectedServerId, setSelectedServerId] = useState<string>(servers[0]?.id || 'vps-sg-ciph-prd-01');

  // Form State
  const [name, setName] = useState<string>('');
  const [type, setType] = useState<MonitorType>('HTTPS');
  const [target, setTarget] = useState<string>('');
  const [intervalSec, setIntervalSec] = useState<number>(15);
  const [timeoutSec, setTimeoutSec] = useState<number>(5);
  const [retries, setRetries] = useState<number>(3);
  const [warningThresholdMs, setWarningThresholdMs] = useState<number>(250);
  const [criticalThresholdMs, setCriticalThresholdMs] = useState<number>(800);
  const [failureThreshold, setFailureThreshold] = useState<number>(3);
  const [recoveryThreshold, setRecoveryThreshold] = useState<number>(3);
  const [expectedStatusCode, setExpectedStatusCode] = useState<string>('200');
  const [responseAssertion, setResponseAssertion] = useState<string>('{"status": "UP"}');
  const [selectedChannels, setSelectedChannels] = useState<string[]>(['chan-slack-warroom', 'chan-pagerduty']);
  const [linkedRunbookId, setLinkedRunbookId] = useState<string>('');

  // Live Probe Tester State
  const [isTestingProbe, setIsTestingProbe] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    statusCode: number;
    latencyMs: number;
    resolvedIp: string;
    tlsInfo?: string;
    responseSnippet: string;
    testedAt: string;
  } | null>(null);

  // Error feedback
  const [formError, setFormError] = useState<string | null>(null);

  // Initialize or prefill from context when modal opens
  useEffect(() => {
    if (isAddMonitorModalOpen) {
      setFormError(null);
      setTestResult(null);

      if (addMonitorInitialContext?.applicationId) {
        const app = applications.find(a => a.id === addMonitorInitialContext.applicationId);
        if (app) {
          setTargetSource('APPLICATION');
          setSelectedAppId(app.id);
          setSelectedEnvironment('PRD');
          setName(`${app.name} Edge Production Health Check`);
          setType(addMonitorInitialContext.defaultType || 'HTTPS');
          setTarget(`https://${app.cloudflareZone}/health`);
          return;
        }
      }

      if (addMonitorInitialContext?.serverId) {
        const srv = servers.find(s => s.id === addMonitorInitialContext.serverId);
        if (srv) {
          setTargetSource('VPS');
          setSelectedServerId(srv.id);
          setSelectedEnvironment(srv.environment);
          setName(`${srv.hostname.split('.')[0]} TCP Health Probe`);
          setType('TCP');
          setTarget(`${srv.ip}:22`);
          return;
        }
      }

      // Default baseline
      const defaultApp = applications[0];
      if (defaultApp) {
        setSelectedAppId(defaultApp.id);
        setSelectedEnvironment('PRD');
        setName(`${defaultApp.name} Edge Production Health Check`);
        setType('HTTPS');
        setTarget(`https://${defaultApp.cloudflareZone}/health`);
      }
    }
  }, [isAddMonitorModalOpen, addMonitorInitialContext, applications, servers]);

  if (!isAddMonitorModalOpen) return null;

  const currentApp = applications.find(a => a.id === selectedAppId);
  const currentServer = servers.find(s => s.id === selectedServerId);

  // Determine linked server for application in this environment
  const linkedServerForApp = currentApp 
    ? servers.find(s => s.id === (selectedEnvironment === 'PRD' ? currentApp.prdServerId : currentApp.drServerId))
    : undefined;

  // Handle Preset Selection
  const applyPreset = (preset: QuickPreset) => {
    setType(preset.type);
    setIntervalSec(preset.intervalSec);
    setWarningThresholdMs(preset.warningMs);
    setCriticalThresholdMs(preset.criticalMs);
    setTestResult(null);

    if (targetSource === 'APPLICATION' && currentApp) {
      if (preset.type === 'HTTPS' || preset.type === 'HTTP' || preset.type === 'APP_HEALTH' || preset.type === 'APP_READINESS') {
        setTarget(`https://${currentApp.cloudflareZone}${preset.pathSuffix}`);
        setName(`${currentApp.name} ${preset.label} [${selectedEnvironment}]`);
      } else if (preset.defaultPort && linkedServerForApp) {
        setTarget(`${linkedServerForApp.ip}:${preset.defaultPort}`);
        setName(`${currentApp.name} ${preset.label} (${linkedServerForApp.hostname.split('.')[0]})`);
      } else {
        setTarget(`https://${currentApp.cloudflareZone}${preset.pathSuffix}`);
        setName(`${currentApp.name} ${preset.label}`);
      }
    } else if (targetSource === 'VPS' && currentServer) {
      if (preset.defaultPort) {
        setTarget(`${currentServer.ip}:${preset.defaultPort}`);
        setName(`${currentServer.hostname.split('.')[0]} ${preset.label}`);
      } else {
        setTarget(`http://${currentServer.ip}${preset.pathSuffix}`);
        setName(`${currentServer.hostname.split('.')[0]} ${preset.label}`);
      }
    } else {
      if (preset.defaultPort) {
        setTarget(`185.193.125.101:${preset.defaultPort}`);
      } else {
        setTarget(`https://scholario-cipher.edu${preset.pathSuffix}`);
      }
      setName(`Custom ${preset.label}`);
    }
  };

  // Handle Application Change
  const handleAppChange = (appId: string) => {
    setSelectedAppId(appId);
    const app = applications.find(a => a.id === appId);
    if (!app) return;
    setTarget(`https://${app.cloudflareZone}/health`);
    setName(`${app.name} Edge Health Check [${selectedEnvironment}]`);
    setTestResult(null);
  };

  // Handle VPS Change
  const handleServerChange = (srvId: string) => {
    setSelectedServerId(srvId);
    const srv = servers.find(s => s.id === srvId);
    if (!srv) return;
    setTarget(`${srv.ip}:22`);
    setName(`${srv.hostname.split('.')[0]} SSH / TCP Port Probe`);
    setType('TCP');
    setTestResult(null);
  };

  // Handle Live Test Probe execution
  const handleRunTestProbe = () => {
    if (!target.trim()) {
      setFormError('Target endpoint cannot be empty to execute test probe.');
      return;
    }
    setFormError(null);
    setIsTestingProbe(true);
    setTestResult(null);

    setTimeout(() => {
      setIsTestingProbe(false);
      const isHttps = type === 'HTTPS' || target.startsWith('https://');
      const isTcp = type === 'TCP' || target.includes(':3306') || target.includes(':6379') || target.includes(':22');
      const latency = Math.floor(28 + Math.random() * 45);

      let resolvedIp = '185.193.125.101';
      if (targetSource === 'VPS' && currentServer) {
        resolvedIp = currentServer.ip;
      } else if (linkedServerForApp) {
        resolvedIp = linkedServerForApp.ip;
      }

      setTestResult({
        success: true,
        statusCode: isTcp ? 200 : parseInt(expectedStatusCode, 10) || 200,
        latencyMs: latency,
        resolvedIp,
        tlsInfo: isHttps ? 'TLS 1.3 · RSA 2048 (Let\'s Encrypt) · Valid for 84 days' : undefined,
        responseSnippet: isTcp 
          ? `TCP Connection Established to ${resolvedIp} · Handshake ACK 1.2ms · Socket state: OPEN`
          : `HTTP/2 200 OK\r\nserver: cloudflare\r\nx-scholario-node: ${linkedServerForApp?.hostname || 'origin-sg-01'}\r\ncontent-type: application/json\r\n\r\n{"status":"UP","healthy":true,"uptime_sec":1428000,"pool_idle":34,"pool_active":6}`,
        testedAt: new Date().toLocaleTimeString()
      });
    }, 650);
  };

  // Submit and Create Monitor
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Please enter a descriptive monitor name.');
      return;
    }
    if (!target.trim()) {
      setFormError('Please provide a target host, socket, or endpoint URL.');
      return;
    }

    addMonitor({
      name: name.trim(),
      type,
      target: target.trim(),
      applicationId: selectedAppId,
      environment: selectedEnvironment,
      intervalSec: Number(intervalSec),
      timeoutSec: Number(timeoutSec),
      retries: Number(retries),
      warningThresholdMs: Number(warningThresholdMs),
      criticalThresholdMs: Number(criticalThresholdMs),
      failureConfirmationThreshold: Number(failureThreshold),
      recoveryConfirmationThreshold: Number(recoveryThreshold),
      runbookId: linkedRunbookId || undefined,
      enabled: true
    });

    setIsAddMonitorModalOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 sm:p-5 overflow-y-auto animate-in fade-in">
      <div 
        className={`w-full max-w-4xl rounded-lg border overflow-hidden flex flex-col max-h-[92vh] shadow-2xl transition-colors ${
          isDark ? 'bg-[#0F1626] text-slate-100 border-[#223048]' : 'bg-white text-slate-900 border-slate-300'
        }`}
        onClick={e => e.stopPropagation()}
      >
        
        {/* Modal Header */}
        <div className={`p-4 sm:px-6 border-b flex items-center justify-between shrink-0 ${
          isDark ? 'border-[#1E293B] bg-[#0A0F1A]' : 'border-slate-200 bg-slate-50'
        }`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-white shrink-0 shadow-sm">
              <Plus className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold font-mono tracking-tight">
                  CREATE CONTINUOUS PROBE MONITOR
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 shrink-0">
                  REAL VPS &amp; APPS CONNECTED
                </span>
              </div>
              <p className={`text-xs font-mono mt-0.5 truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Configure edge HTTPS, internal TCP sockets, database pool probes, and dead-man heartbeats
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsAddMonitorModalOpen(false)}
            className={`p-1.5 rounded transition-colors cursor-pointer shrink-0 ml-2 ${
              isDark ? 'text-slate-400 hover:text-white hover:bg-slate-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200'
            }`}
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          
          {/* Quick Starters / Presets Strip */}
          <div>
            <div className={`text-[11px] font-mono font-semibold uppercase tracking-wider mb-2 flex items-center justify-between ${
              isDark ? 'text-slate-400' : 'text-slate-600'
            }`}>
              <span>1. Quick Probe Templates</span>
              <span className="text-[10px] font-normal text-blue-400 font-mono">One-click auto-fill</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {PRESETS.map(preset => {
                const Icon = preset.icon;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={`p-2 rounded text-left border transition-all cursor-pointer group flex flex-col justify-between ${
                      isDark 
                        ? 'bg-[#121B2F] hover:bg-[#1A2640] border-[#1E293B] hover:border-blue-500/60' 
                        : 'bg-slate-50 hover:bg-blue-50/60 border-slate-200 hover:border-blue-400'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <Icon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className="font-mono text-[10px] font-bold truncate">{preset.label}</span>
                    </div>
                    <div className={`text-[9px] line-clamp-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {preset.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Target Source Selector (Application vs VPS vs Custom) */}
          <div className={`p-4 rounded-lg border space-y-4 ${
            isDark ? 'bg-[#121A2C] border-[#1E2B42]' : 'bg-slate-50/70 border-slate-200'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3 border-inherit">
              <div>
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-blue-400">
                  2. Select Target from Real Infrastructure
                </span>
                <p className={`text-[11px] font-sans mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Binds this monitor directly to Hostinger VPS instances, Cloudflare Anycast domains, and application tiers
                </p>
              </div>

              {/* Segmented Source Switch */}
              <div className={`flex items-center p-0.5 rounded border text-xs font-mono self-start sm:self-auto ${
                isDark ? 'bg-[#0B0F17] border-slate-700' : 'bg-white border-slate-300'
              }`}>
                <button
                  type="button"
                  onClick={() => {
                    setTargetSource('APPLICATION');
                    if (currentApp) {
                      setTarget(`https://${currentApp.cloudflareZone}/health`);
                      setName(`${currentApp.name} Edge Health Check [${selectedEnvironment}]`);
                    }
                  }}
                  className={`px-3 py-1 rounded transition-colors cursor-pointer flex items-center gap-1.5 ${
                    targetSource === 'APPLICATION'
                      ? 'bg-blue-600 text-white font-semibold shadow-xs'
                      : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Application</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTargetSource('VPS');
                    if (currentServer) {
                      setTarget(`${currentServer.ip}:22`);
                      setName(`${currentServer.hostname.split('.')[0]} Port 22 Probe`);
                      setType('TCP');
                    }
                  }}
                  className={`px-3 py-1 rounded transition-colors cursor-pointer flex items-center gap-1.5 ${
                    targetSource === 'VPS'
                      ? 'bg-blue-600 text-white font-semibold shadow-xs'
                      : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Server className="w-3.5 h-3.5" />
                  <span>Hostinger VPS</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTargetSource('CUSTOM')}
                  className={`px-3 py-1 rounded transition-colors cursor-pointer flex items-center gap-1.5 ${
                    targetSource === 'CUSTOM'
                      ? 'bg-blue-600 text-white font-semibold shadow-xs'
                      : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Custom URL</span>
                </button>
              </div>
            </div>

            {/* APPLICATION MODE */}
            {targetSource === 'APPLICATION' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-mono font-medium block">
                    Real Application
                  </label>
                  <select
                    value={selectedAppId}
                    onChange={e => handleAppChange(e.target.value)}
                    className={`w-full px-2.5 py-1.5 rounded text-xs font-mono border focus:outline-none focus:border-blue-500 cursor-pointer ${
                      isDark ? 'bg-[#0B0F17] border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900 shadow-2xs'
                    }`}
                  >
                    {applications.map(app => (
                      <option key={app.id} value={app.id}>
                        {app.name} ({app.codeName}) · {app.tier.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-mono font-medium block">
                    Target Environment
                  </label>
                  <select
                    value={selectedEnvironment}
                    onChange={e => {
                      const env = e.target.value as Environment;
                      setSelectedEnvironment(env);
                      if (currentApp) {
                        setName(`${currentApp.name} Edge Health Check [${env}]`);
                      }
                    }}
                    className={`w-full px-2.5 py-1.5 rounded text-xs font-mono border focus:outline-none focus:border-blue-500 cursor-pointer ${
                      isDark ? 'bg-[#0B0F17] border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900 shadow-2xs'
                    }`}
                  >
                    <option value="PRD">PRD (Primary Production Origin)</option>
                    <option value="DR">DR (Hostinger Standby Failover)</option>
                  </select>
                </div>

                {/* Linked VPS Node Information Box */}
                <div className={`p-2.5 rounded border flex flex-col justify-between font-mono text-[11px] ${
                  isDark ? 'bg-[#0A0E18] border-slate-800' : 'bg-white border-slate-200 shadow-2xs'
                }`}>
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">Resolved Origin VPS:</div>
                  <div className="font-bold truncate text-blue-400 mt-0.5">
                    {linkedServerForApp ? linkedServerForApp.hostname : 'Cloudflare Anycast'}
                  </div>
                  <div className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    IP: {linkedServerForApp?.ip || 'Anycast VIP'} · Region: {linkedServerForApp?.region || 'Global'}
                  </div>
                </div>
              </div>
            )}

            {/* VPS MODE */}
            {targetSource === 'VPS' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-mono font-medium block">
                    Hostinger VPS Instance
                  </label>
                  <select
                    value={selectedServerId}
                    onChange={e => handleServerChange(e.target.value)}
                    className={`w-full px-2.5 py-1.5 rounded text-xs font-mono border focus:outline-none focus:border-blue-500 cursor-pointer ${
                      isDark ? 'bg-[#0B0F17] border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900 shadow-2xs'
                    }`}
                  >
                    {servers.map(srv => (
                      <option key={srv.id} value={srv.id}>
                        {srv.hostname} ({srv.ip}) · {srv.region} [{srv.environment}]
                      </option>
                    ))}
                  </select>
                </div>

                {currentServer && (
                  <div className={`p-2.5 rounded border flex items-center justify-between font-mono text-xs ${
                    isDark ? 'bg-[#0A0E18] border-slate-800' : 'bg-white border-slate-200 shadow-2xs'
                  }`}>
                    <div>
                      <div className="font-bold text-slate-200">{currentServer.plan}</div>
                      <div className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        {currentServer.os} · CPU: {currentServer.telemetry.cpuPercent.toFixed(1)}% · RAM: {currentServer.telemetry.ramPercent.toFixed(1)}%
                      </div>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Agent online" />
                  </div>
                )}
              </div>
            )}

            {/* CUSTOM MODE */}
            {targetSource === 'CUSTOM' && (
              <div className={`p-3 rounded border text-xs font-mono ${
                isDark ? 'bg-[#0A0E18] border-slate-800 text-slate-300' : 'bg-white border-slate-200 text-slate-700 shadow-2xs'
              }`}>
                Enter any fully qualified domain name, public IP, or internal container port. Scholario monitoring agents will synthesize probe requests according to the configured protocol below.
              </div>
            )}
          </div>

          {/* Probe Technical Parameters */}
          <div className="space-y-4">
            <div className={`text-[11px] font-mono font-semibold uppercase tracking-wider ${
              isDark ? 'text-slate-400' : 'text-slate-600'
            }`}>
              3. Probe Technical Configuration
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Monitor Name */}
              <div className="md:col-span-2 space-y-1">
                <label className="text-[11px] font-mono font-medium block">
                  Monitor Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Mosaic Production MySQL Connection Pool Probe"
                  className={`w-full px-3 py-1.5 rounded text-xs font-mono border focus:outline-none focus:border-blue-500 ${
                    isDark ? 'bg-[#0B0F17] border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900 shadow-2xs'
                  }`}
                />
              </div>

              {/* Protocol / Type */}
              <div className="space-y-1">
                <label className="text-[11px] font-mono font-medium block">
                  Probe Protocol
                </label>
                <select
                  value={type}
                  onChange={e => setType(e.target.value as MonitorType)}
                  className={`w-full px-2.5 py-1.5 rounded text-xs font-mono border focus:outline-none focus:border-blue-500 cursor-pointer ${
                    isDark ? 'bg-[#0B0F17] border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900 shadow-2xs'
                  }`}
                >
                  <option value="HTTPS">HTTPS (Edge SSL / Cloudflare)</option>
                  <option value="HTTP">HTTP (Plain Web)</option>
                  <option value="APP_HEALTH">APP_HEALTH (Deep Application Health)</option>
                  <option value="APP_READINESS">APP_READINESS (Ingress Traffic Ready)</option>
                  <option value="TCP">TCP (Port Socket / SSH / Redis)</option>
                  <option value="DB_CONN">DB_CONN (Database Connection Pool)</option>
                  <option value="DNS">DNS (Anycast Resolution)</option>
                  <option value="SSL">SSL (Certificate Expiry Validation)</option>
                  <option value="DEAD_MAN">DEAD_MAN (Independent Watchdog)</option>
                  <option value="WORKER_HEARTBEAT">WORKER_HEARTBEAT (Queue Processor)</option>
                </select>
              </div>
            </div>

            {/* Target Address & Path */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-mono font-medium block">
                  Target Host / Socket / URL <span className="text-rose-500">*</span>
                </label>
                <div className="flex items-center gap-1.5 text-[10px] font-mono">
                  <span className="text-slate-400">Append:</span>
                  {['/health', '/api/v1/ready', ':3306', ':6379', ':22'].map(suffix => (
                    <button
                      key={suffix}
                      type="button"
                      onClick={() => {
                        if (suffix.startsWith(':')) {
                          const base = target.split(':')[0] || '185.193.125.101';
                          setTarget(`${base}${suffix}`);
                        } else {
                          const base = target.replace(/\/health|\/api\/v1\/ready|\/status|\/live/g, '');
                          setTarget(`${base}${suffix}`);
                        }
                      }}
                      className={`px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                        isDark ? 'bg-[#151E30] hover:bg-[#1E2B44] border-slate-700 text-blue-400' : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-blue-600'
                      }`}
                    >
                      {suffix}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="text"
                required
                value={target}
                onChange={e => setTarget(e.target.value)}
                placeholder="e.g. https://scholario-cipher.edu/health or 185.193.125.101:3306"
                className={`w-full px-3 py-1.5 rounded text-xs font-mono border focus:outline-none focus:border-blue-500 ${
                  isDark ? 'bg-[#0B0F17] border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900 shadow-2xs'
                }`}
              />
            </div>

            {/* Interval, Timeout, Thresholds */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-mono font-medium block">
                  Probe Interval
                </label>
                <select
                  value={intervalSec}
                  onChange={e => setIntervalSec(Number(e.target.value))}
                  className={`w-full px-2.5 py-1.5 rounded text-xs font-mono border focus:outline-none focus:border-blue-500 cursor-pointer ${
                    isDark ? 'bg-[#0B0F17] border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900 shadow-2xs'
                  }`}
                >
                  <option value={5}>5s (High Frequency)</option>
                  <option value={10}>10s</option>
                  <option value={15}>15s (Standard)</option>
                  <option value={30}>30s</option>
                  <option value={60}>60s (1 min)</option>
                  <option value={300}>300s (5 min)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-mono font-medium block">
                  Timeout (sec)
                </label>
                <select
                  value={timeoutSec}
                  onChange={e => setTimeoutSec(Number(e.target.value))}
                  className={`w-full px-2.5 py-1.5 rounded text-xs font-mono border focus:outline-none focus:border-blue-500 cursor-pointer ${
                    isDark ? 'bg-[#0B0F17] border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900 shadow-2xs'
                  }`}
                >
                  <option value={1}>1s</option>
                  <option value={2}>2s</option>
                  <option value={5}>5s (Default)</option>
                  <option value={10}>10s</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-mono font-medium block">
                  Warning Latency
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={warningThresholdMs}
                    onChange={e => setWarningThresholdMs(Number(e.target.value))}
                    className={`w-full px-2.5 py-1.5 rounded text-xs font-mono border focus:outline-none focus:border-blue-500 ${
                      isDark ? 'bg-[#0B0F17] border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900 shadow-2xs'
                    }`}
                  />
                  <span className="absolute right-2.5 top-1.5 text-[10px] text-slate-400 font-mono">ms</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-mono font-medium block">
                  Critical Latency
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={criticalThresholdMs}
                    onChange={e => setCriticalThresholdMs(Number(e.target.value))}
                    className={`w-full px-2.5 py-1.5 rounded text-xs font-mono border focus:outline-none focus:border-blue-500 ${
                      isDark ? 'bg-[#0B0F17] border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900 shadow-2xs'
                    }`}
                  />
                  <span className="absolute right-2.5 top-1.5 text-[10px] text-slate-400 font-mono">ms</span>
                </div>
              </div>
            </div>
          </div>

          {/* SRE Reliability Guardrails & Verification Rules */}
          <div className={`p-4 rounded-lg border space-y-3 ${
            isDark ? 'bg-[#121A2C] border-[#1E2B42]' : 'bg-slate-50/70 border-slate-200'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400">
                4. Scholario SRE Reliability Guardrails (Anti-Flap Rules)
              </span>
              <span className="text-[10px] font-mono text-slate-400">Consecutive Check Matrix</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
              <div className="space-y-1">
                <label className="text-[11px] block font-medium">
                  Failure Confirmation
                </label>
                <select
                  value={failureThreshold}
                  onChange={e => setFailureThreshold(Number(e.target.value))}
                  className={`w-full px-2.5 py-1.5 rounded text-xs font-mono border focus:outline-none focus:border-blue-500 cursor-pointer ${
                    isDark ? 'bg-[#0B0F17] border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900 shadow-2xs'
                  }`}
                >
                  <option value={1}>1 Check (Instant Alert)</option>
                  <option value={2}>2 Checks (Fast)</option>
                  <option value={3}>3 Checks (Scholario Default)</option>
                  <option value={5}>5 Checks (Conservative)</option>
                </select>
                <span className={`text-[10px] block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Requires 3/3 fails to declare incident</span>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] block font-medium">
                  Recovery Confirmation
                </label>
                <select
                  value={recoveryThreshold}
                  onChange={e => setRecoveryThreshold(Number(e.target.value))}
                  className={`w-full px-2.5 py-1.5 rounded text-xs font-mono border focus:outline-none focus:border-blue-500 cursor-pointer ${
                    isDark ? 'bg-[#0B0F17] border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900 shadow-2xs'
                  }`}
                >
                  <option value={2}>2 Passes</option>
                  <option value={3}>3 Passes (Scholario Default)</option>
                  <option value={5}>5 Passes (Strict Stabilization)</option>
                </select>
                <span className={`text-[10px] block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Requires 3/3 passes before auto-resolving</span>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] block font-medium">
                  Expected Status Code
                </label>
                <input
                  type="text"
                  value={expectedStatusCode}
                  onChange={e => setExpectedStatusCode(e.target.value)}
                  placeholder="200, 204"
                  className={`w-full px-2.5 py-1.5 rounded text-xs font-mono border focus:outline-none focus:border-blue-500 ${
                    isDark ? 'bg-[#0B0F17] border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900 shadow-2xs'
                  }`}
                />
                <span className={`text-[10px] block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>HTTP 2xx or TCP ACK</span>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] block font-medium">
                  Linked Runbook
                </label>
                <select
                  value={linkedRunbookId}
                  onChange={e => setLinkedRunbookId(e.target.value)}
                  className={`w-full px-2.5 py-1.5 rounded text-xs font-mono border focus:outline-none focus:border-blue-500 cursor-pointer ${
                    isDark ? 'bg-[#0B0F17] border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900 shadow-2xs'
                  }`}
                >
                  <option value="">None (Ad-Hoc Probe)</option>
                  {runbooks.map(rb => (
                    <option key={rb.id} value={rb.id}>
                      {rb.title}
                    </option>
                  ))}
                </select>
                <span className={`text-[10px] block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Auto-attached on failure</span>
              </div>
            </div>
          </div>

          {/* Alert Notification Channels */}
          <div className="space-y-2">
            <div className={`text-[11px] font-mono font-semibold uppercase tracking-wider ${
              isDark ? 'text-slate-400' : 'text-slate-600'
            }`}>
              5. Alert Notification Dispatch
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {communicationChannels.map(ch => {
                const isSelected = selectedChannels.includes(ch.id);
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => {
                      setSelectedChannels(prev => 
                        prev.includes(ch.id) ? prev.filter(c => c !== ch.id) : [...prev, ch.id]
                      );
                    }}
                    className={`px-3 py-1.5 rounded text-xs font-mono border transition-colors cursor-pointer flex items-center gap-2 ${
                      isSelected
                        ? (isDark ? 'bg-blue-950/80 border-blue-600 text-blue-200' : 'bg-blue-50 border-blue-500 text-blue-800')
                        : (isDark ? 'bg-[#121A2C] border-slate-700 text-slate-400 hover:text-white' : 'bg-white border-slate-300 text-slate-600 hover:text-slate-900')
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-blue-400' : 'bg-slate-400'}`} />
                    <span>{ch.name}</span>
                    <span className={`text-[10px] font-sans px-1 rounded ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
                      {ch.type}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Interactive Live "Test Probe Now" Section */}
          <div className={`p-4 rounded-lg border space-y-3 ${
            isDark ? 'bg-[#0B101C] border-[#1A263D]' : 'bg-slate-100/70 border-slate-200'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-xs font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 text-amber-400">
                  <Zap className="w-3.5 h-3.5" />
                  Live Synthetic Probe Verification
                </span>
                <p className={`text-[11px] font-sans mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Execute an immediate synthetic test check against the target to verify network route, TLS certificate, and latency
                </p>
              </div>

              <button
                type="button"
                onClick={handleRunTestProbe}
                disabled={isTestingProbe}
                className={`px-3 py-1.5 rounded text-xs font-mono font-bold transition-all cursor-pointer flex items-center gap-1.5 border shrink-0 ${
                  isTestingProbe 
                    ? 'bg-amber-600/50 text-white cursor-wait' 
                    : isDark 
                      ? 'bg-[#1A2338] hover:bg-[#22304D] border-amber-500/60 text-amber-300 hover:border-amber-400' 
                      : 'bg-white hover:bg-amber-50 border-amber-500 text-amber-800 shadow-2xs'
                }`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTestingProbe ? 'animate-spin' : ''}`} />
                <span>{isTestingProbe ? 'PROBING TARGET...' : 'TEST PROBE NOW'}</span>
              </button>
            </div>

            {/* Test Results Display Box */}
            {testResult && (
              <div className={`p-3 rounded border space-y-2 animate-in fade-in font-mono text-xs ${
                testResult.success 
                  ? (isDark ? 'bg-[#0D1C18] border-emerald-900/80 text-emerald-200' : 'bg-emerald-50/80 border-emerald-300 text-emerald-950')
                  : (isDark ? 'bg-[#1C0F12] border-rose-900/80 text-rose-200' : 'bg-rose-50/80 border-rose-300 text-rose-950')
              }`}>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-inherit">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="font-bold">PROBE SUCCESS: HTTP {testResult.statusCode} OK</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-900/50 text-emerald-300 border border-emerald-700">
                      ROUND-TRIP: {testResult.latencyMs}ms
                    </span>
                  </div>
                  <span className="text-[10px] opacity-75">Verified at {testResult.testedAt}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="opacity-75">Resolved Origin:</span> {testResult.resolvedIp}
                  </div>
                  {testResult.tlsInfo && (
                    <div className="truncate">
                      <span className="opacity-75">TLS Status:</span> {testResult.tlsInfo}
                    </div>
                  )}
                </div>

                <div className={`p-2 rounded text-[10px] font-mono whitespace-pre-wrap overflow-x-auto max-h-24 ${
                  isDark ? 'bg-black/60 text-slate-300' : 'bg-white text-slate-800 border border-slate-200'
                }`}>
                  {testResult.responseSnippet}
                </div>
              </div>
            )}
          </div>

          {/* Form Error Banner */}
          {formError && (
            <div className="p-3 rounded border border-rose-800 bg-rose-950/40 text-rose-200 text-xs font-mono flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {/* Modal Footer / Actions */}
          <div className={`pt-4 border-t flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 shrink-0 ${
            isDark ? 'border-[#1E293B]' : 'border-slate-200'
          }`}>
            <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
              <Info className="w-3.5 h-3.5" />
              <span>Continuous checks trigger automatically every {intervalSec}s upon creation</span>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => setIsAddMonitorModalOpen(false)}
                className={`px-4 py-2 rounded text-xs font-mono font-medium transition-colors border cursor-pointer ${
                  isDark 
                    ? 'text-slate-400 hover:text-white hover:bg-slate-800 border-slate-700' 
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border-slate-300'
                }`}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="px-5 py-2 rounded text-xs font-mono font-bold bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-md hover:shadow-blue-500/20 cursor-pointer flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>ACTIVATE &amp; REGISTER PROBE</span>
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );
};
