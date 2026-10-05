import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { 
  Server, 
  Globe, 
  Activity, 
  Zap, 
  ArrowLeftRight, 
  RefreshCw, 
  Terminal, 
  Copy, 
  Check, 
  ShieldCheck, 
  Sliders, 
  Database, 
  HardDrive, 
  Cpu, 
  Radio, 
  Trash2, 
  RotateCcw, 
  Info,
  Network,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Play,
  Flame,
  Send,
  Code
} from 'lucide-react';
import { RealVpsProbeResult, RealVpsTcpProbeResult, SyntheticTransactionResult, OperationalStatus } from '../../types';

export const RealVpsTestbenchView: React.FC = () => {
  const { 
    realVpsConfig, 
    isRealVpsOnlyMode, 
    isRealVpsProbing,
    updateRealVpsConfig, 
    probeRealVps, 
    probeBothRealVps, 
    failoverRealVps, 
    purgeMockData, 
    restoreMockData,
    tcpProbe,
    testSynthetic,
    simulateOutage,
    theme 
  } = useOps();
  const isDark = theme === 'dark';

  const [copiedScript, setCopiedScript] = useState<'main' | 'dr' | 'python' | 'node' | 'nginx' | 'docker' | null>(null);
  const [activeTab, setActiveTab] = useState<'topology' | 'port-scanner' | 'synthetic' | 'config' | 'agent'>('topology');

  // TCP Port Scanner states
  const [tcpTarget, setTcpTarget] = useState<'main' | 'dr'>('main');
  const [customPort, setCustomPort] = useState<number>(6423);
  const [tcpResults, setTcpResults] = useState<Record<string, RealVpsTcpProbeResult>>({});
  const [isScanningTcp, setIsScanningTcp] = useState<boolean>(false);
  const [scanningPort, setScanningPort] = useState<number | null>(null);

  // Synthetic E2E Tester states
  const [synthTarget, setSynthTarget] = useState<'main' | 'dr' | 'custom'>('main');
  const [synthUrl, setSynthUrl] = useState<string>(realVpsConfig?.main.healthUrl || 'http://72.61.239.86:6423/api/health');
  const [synthMethod, setSynthMethod] = useState<'GET' | 'POST' | 'PUT'>('GET');
  const [synthBody, setSynthBody] = useState<string>('{"ping":"test"}');
  const [synthExpectedStatus, setSynthExpectedStatus] = useState<number>(200);
  const [synthMatchText, setSynthMatchText] = useState<string>('"status":"ok"');
  const [synthResult, setSynthResult] = useState<SyntheticTransactionResult | null>(null);
  const [isTestingSynth, setIsTestingSynth] = useState<boolean>(false);

  // Outage Simulator state
  const [isSimulatingOutage, setIsSimulatingOutage] = useState<boolean>(false);

  // Quick Paste/Import Details State
  const [showQuickPaste, setShowQuickPaste] = useState<boolean>(false);
  const [quickPasteText, setQuickPasteText] = useState<string>('');

  // Edit states for Main & DR
  const [isEditingMain, setIsEditingMain] = useState(false);
  const [mainForm, setMainForm] = useState({
    name: realVpsConfig?.main.name || 'VPS 1 - MAIN',
    role: realVpsConfig?.main.role || 'PRIMARY / PRODUCTION',
    ip: realVpsConfig?.main.ip || '72.61.239.86',
    hostname: realVpsConfig?.main.hostname || '72.61.239.86',
    port: realVpsConfig?.main.port || 6423,
    healthUrl: realVpsConfig?.main.healthUrl || 'http://72.61.239.86:6423/api/health',
    provider: realVpsConfig?.main.provider || 'Hostinger Cloud VPS',
    region: realVpsConfig?.main.region || 'Primary Region (PRD)'
  });

  const [isEditingDr, setIsEditingDr] = useState(false);
  const [drForm, setDrForm] = useState({
    name: realVpsConfig?.dr.name || 'VPS 2 - DR',
    role: realVpsConfig?.dr.role || 'DISASTER RECOVERY / STANDBY',
    ip: realVpsConfig?.dr.ip || '187.126.112.188',
    hostname: realVpsConfig?.dr.hostname || '187.126.112.188',
    port: realVpsConfig?.dr.port || 6423,
    healthUrl: realVpsConfig?.dr.healthUrl || 'http://187.126.112.188:6423/api/health',
    provider: realVpsConfig?.dr.provider || 'Hostinger Cloud VPS',
    region: realVpsConfig?.dr.region || 'DR Region (Standby)'
  });

  const [isEditingApp, setIsEditingApp] = useState(false);
  const [appForm, setAppForm] = useState({
    name: realVpsConfig?.testApp.name || 'Node.js / Express API',
    domain: realVpsConfig?.testApp.domain || '72.61.239.86:6423',
    healthPath: realVpsConfig?.testApp.healthPath || '/api/health'
  });

  const [probeResultModal, setProbeResultModal] = useState<RealVpsProbeResult | null>(null);
  const [dualProbeResult, setDualProbeResult] = useState<{ mainResult: RealVpsProbeResult; drResult: RealVpsProbeResult } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Sync edit forms when realVpsConfig changes
  React.useEffect(() => {
    if (realVpsConfig) {
      setMainForm({
        name: realVpsConfig.main.name,
        role: realVpsConfig.main.role || 'PRIMARY / PRODUCTION',
        ip: realVpsConfig.main.ip,
        hostname: realVpsConfig.main.hostname,
        port: realVpsConfig.main.port,
        healthUrl: realVpsConfig.main.healthUrl,
        provider: realVpsConfig.main.provider,
        region: realVpsConfig.main.region
      });
      setDrForm({
        name: realVpsConfig.dr.name,
        role: realVpsConfig.dr.role || 'DISASTER RECOVERY / STANDBY',
        ip: realVpsConfig.dr.ip,
        hostname: realVpsConfig.dr.hostname,
        port: realVpsConfig.dr.port,
        healthUrl: realVpsConfig.dr.healthUrl,
        provider: realVpsConfig.dr.provider,
        region: realVpsConfig.dr.region
      });
      setAppForm({
        name: realVpsConfig.testApp.name,
        domain: realVpsConfig.testApp.domain,
        healthPath: realVpsConfig.testApp.healthPath
      });
      if (synthTarget === 'main') {
        setSynthUrl(realVpsConfig.main.healthUrl);
      } else if (synthTarget === 'dr') {
        setSynthUrl(realVpsConfig.dr.healthUrl);
      }
    }
  }, [realVpsConfig, synthTarget]);

  if (!realVpsConfig) {
    return (
      <div className={`p-8 rounded border flex flex-col items-center justify-center space-y-3 font-mono ${
        isDark ? 'bg-[#0E131F] border-[#1E293B] text-slate-300' : 'bg-white border-slate-200 text-slate-700'
      }`}>
        <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
        <span className="text-sm">Initializing 2-VPS Real Testbench Engine...</span>
      </div>
    );
  }

  const { main, dr, routing, autoFailover, testApp, lastFailoverReason } = realVpsConfig;
  const isMainActive = routing === 'MAIN';

  const handleSaveMain = async () => {
    await updateRealVpsConfig({
      main: {
        ...main,
        ...mainForm,
        port: Number(mainForm.port) || 6423
      }
    });
    setIsEditingMain(false);
    setStatusMessage('Saved VPS 1 - MAIN configuration');
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleSaveDr = async () => {
    await updateRealVpsConfig({
      dr: {
        ...dr,
        ...drForm,
        port: Number(drForm.port) || 6423
      }
    });
    setIsEditingDr(false);
    setStatusMessage('Saved VPS 2 - DR configuration');
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleSaveApp = async () => {
    await updateRealVpsConfig({
      testApp: {
        ...testApp,
        ...appForm
      }
    });
    setIsEditingApp(false);
    setStatusMessage('Saved Application settings');
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleProbeMain = async () => {
    const res = await probeRealVps('main');
    if (res) {
      setProbeResultModal(res);
      const stateLabel = res.probeState || (res.reachable ? 'HEALTHY' : 'UNREACHABLE');
      setStatusMessage(`Probed VPS 1 MAIN (${main.ip}:${main.port}): ${res.reachable ? 'REACHABLE' : 'UNREACHABLE'} [${stateLabel}] (${res.latencyMs}ms)`);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const handleProbeDr = async () => {
    const res = await probeRealVps('dr');
    if (res) {
      setProbeResultModal(res);
      const stateLabel = res.probeState || (res.reachable ? 'HEALTHY' : 'UNREACHABLE');
      setStatusMessage(`Probed VPS 2 DR (${dr.ip}:${dr.port}): ${res.reachable ? 'REACHABLE' : 'UNREACHABLE'} [${stateLabel}] (${res.latencyMs}ms)`);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const handleProbeBoth = async () => {
    const res = await probeBothRealVps();
    if (res) {
      setDualProbeResult(res);
      setStatusMessage(
        `Probed Both VPSs: VPS 1 MAIN [${res.mainResult.reachable ? 'REACHABLE' : 'UNREACHABLE'} · ${res.mainResult.latencyMs}ms] | VPS 2 DR [${res.drResult.reachable ? 'REACHABLE' : 'UNREACHABLE'} · ${res.drResult.latencyMs}ms]`
      );
      setTimeout(() => setStatusMessage(null), 6000);
    }
  };

  const handleToggleFailover = async () => {
    const target = isMainActive ? 'DR' : 'MAIN';
    await failoverRealVps(target, `Operator manually switched routing to ${target} via 2-VPS Testbench`);
    setStatusMessage(`Traffic routed to ${target} node (${target === 'MAIN' ? `${main.ip}:${main.port}` : `${dr.ip}:${dr.port}`})`);
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const handleToggleAutoFailover = async () => {
    await updateRealVpsConfig({ autoFailover: !autoFailover });
    setStatusMessage(`Automated Failover ${!autoFailover ? 'ENABLED' : 'DISABLED'}`);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const commonPorts = [
    { port: 6423, name: 'Node.js / Express API (6423)' },
    { port: 80, name: 'HTTP Web Ingress' },
    { port: 443, name: 'HTTPS TLS Secure' },
    { port: 22, name: 'SSH Remote Console' },
    { port: 3000, name: 'Node.js / Alternate App' },
    { port: 8080, name: 'Proxy / Alternate Web' },
    { port: 5432, name: 'PostgreSQL Database' },
    { port: 6379, name: 'Redis In-Memory Cache' },
  ];

  const handleScanTcpForNode = async (targetNode: 'main' | 'dr', portToScan: number) => {
    setTcpTarget(targetNode);
    setScanningPort(portToScan);
    const host = targetNode === 'dr' ? dr.ip : main.ip;
    const res = await tcpProbe({ targetVps: targetNode, host, port: portToScan });
    if (res) {
      setTcpResults(prev => ({ ...prev, [`${targetNode}-${portToScan}`]: res }));
      setStatusMessage(
        `${targetNode === 'main' ? 'VPS 1 MAIN' : 'VPS 2 DR'} (${host}) → TCP ${portToScan}: ${res.open ? 'OPEN / ACCEPTING' : `CLOSED / FILTERED${res.error ? ` (${res.error})` : ''}`} (${res.latencyMs}ms)`
      );
      setTimeout(() => setStatusMessage(null), 5000);
    }
    setScanningPort(null);
  };

  const handleScanTcp = async (portToScan: number) => {
    await handleScanTcpForNode(tcpTarget, portToScan);
  };

  const handleScanAllCommonPorts = async () => {
    setIsScanningTcp(true);
    const host = tcpTarget === 'dr' ? dr.ip : main.ip;
    for (const p of commonPorts) {
      setScanningPort(p.port);
      const res = await tcpProbe({ targetVps: tcpTarget, host, port: p.port });
      if (res) {
        setTcpResults(prev => ({ ...prev, [`${tcpTarget}-${p.port}`]: res }));
      }
    }
    setScanningPort(null);
    setIsScanningTcp(false);
    setStatusMessage(`Completed TCP reachability scan across ${commonPorts.length} ports on ${tcpTarget === 'main' ? 'VPS 1 MAIN' : 'VPS 2 DR'} (${host})`);
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const handleRunSynthetic = async () => {
    setIsTestingSynth(true);
    const res = await testSynthetic({
      url: synthUrl,
      method: synthMethod,
      body: synthMethod !== 'GET' ? synthBody : undefined,
      expectedStatus: Number(synthExpectedStatus),
      matchText: synthMatchText.trim() || undefined
    });
    if (res) {
      setSynthResult(res);
      setStatusMessage(`Synthetic Test ${res.expectedMatch ? 'PASSED (All Assertions Met)' : 'FAILED / ASSERTION MISMATCH'}: HTTP ${res.statusCode || 'ERR'} (${res.latencyMs}ms)`);
      setTimeout(() => setStatusMessage(null), 5000);
    }
    setIsTestingSynth(false);
  };

  const handleSimulateOutageToggle = async (target: 'main' | 'dr', currentStatus: OperationalStatus) => {
    setIsSimulatingOutage(true);
    const nextStatus = currentStatus === 'HEALTHY' ? 'CRITICAL' : 'HEALTHY';
    await simulateOutage(target, nextStatus);
    setStatusMessage(`Node ${target.toUpperCase()} simulated as ${nextStatus}. ${nextStatus === 'CRITICAL' ? 'Watchdog triggered auto-failover to standby.' : 'Node restored to nominal.'}`);
    setTimeout(() => setStatusMessage(null), 4500);
    setIsSimulatingOutage(false);
  };

  const getAgentCommand = (vpsTarget: 'main' | 'dr') => {
    const origin = window.location.origin;
    return `curl -sSL "${origin}/api/vps/agent.sh?vps=${vpsTarget}" | bash`;
  };

  const copyToClipboard = (text: string, type: 'main' | 'dr' | 'python' | 'node' | 'nginx' | 'docker') => {
    navigator.clipboard.writeText(text);
    setCopiedScript(type);
    setTimeout(() => setCopiedScript(null), 2500);
  };

  const handleQuickPaste = async () => {
    try {
      let mainIp = mainForm.ip;
      let drIp = drForm.ip;
      let mainHealth = mainForm.healthUrl;
      let drHealth = drForm.healthUrl;
      let appDomain = appForm.domain;
      let appName = appForm.name;

      const trimmed = quickPasteText.trim();
      if (!trimmed) return;

      if (trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed);
        if (parsed.mainIp || parsed.main_ip || parsed.vps1_ip || parsed.vps1) mainIp = parsed.mainIp || parsed.main_ip || parsed.vps1_ip || parsed.vps1;
        if (parsed.drIp || parsed.dr_ip || parsed.vps2_ip || parsed.vps2) drIp = parsed.drIp || parsed.dr_ip || parsed.vps2_ip || parsed.vps2;
        if (parsed.mainHealth || parsed.healthUrl || parsed.health_url) mainHealth = parsed.mainHealth || parsed.healthUrl || parsed.health_url;
        if (parsed.drHealth || parsed.dr_health) drHealth = parsed.drHealth || parsed.dr_health;
        if (parsed.domain || parsed.appDomain) appDomain = parsed.domain || parsed.appDomain;
        if (parsed.name || parsed.appName) appName = parsed.name || parsed.appName;
      } else {
        const lines = trimmed.split('\n');
        for (const line of lines) {
          const l = line.toLowerCase();
          if (l.includes('main') || l.includes('vps1') || l.includes('vps 1') || l.includes('primary')) {
            const foundIp = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/) || line.match(/https?:\/\/[^\s]+/);
            if (foundIp) mainIp = foundIp[0].replace(/^https?:\/\//, '').split('/')[0];
          }
          if (l.includes('dr') || l.includes('vps2') || l.includes('vps 2') || l.includes('secondary') || l.includes('standby')) {
            const foundIp = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/) || line.match(/https?:\/\/[^\s]+/);
            if (foundIp) drIp = foundIp[0].replace(/^https?:\/\//, '').split('/')[0];
          }
          if (l.includes('health') || l.includes('url') || l.includes('endpoint')) {
            const foundUrl = line.match(/https?:\/\/[^\s]+/);
            if (foundUrl) {
              if (l.includes('dr') || l.includes('vps2')) drHealth = foundUrl[0];
              else mainHealth = foundUrl[0];
            }
          }
          if (l.includes('domain') || l.includes('app')) {
            const foundDomain = line.match(/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (foundDomain) appDomain = foundDomain[0];
          }
        }
        const allIps = trimmed.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g);
        if (allIps && allIps.length >= 2) {
          mainIp = allIps[0];
          drIp = allIps[1];
        }
      }

      if (!mainHealth.startsWith('http')) {
        mainHealth = `http://${mainIp}${mainHealth.startsWith('/') ? mainHealth : `/${mainHealth}`}`;
      }
      if (!drHealth.startsWith('http')) {
        drHealth = `http://${drIp}${drHealth.startsWith('/') ? drHealth : `/${drHealth}`}`;
      }

      await updateRealVpsConfig({
        main: {
          ...realVpsConfig.main,
          ip: mainIp,
          hostname: `${mainIp}.vps`,
          healthUrl: mainHealth
        },
        dr: {
          ...realVpsConfig.dr,
          ip: drIp,
          hostname: `${drIp}.vps`,
          healthUrl: drHealth
        },
        testApp: {
          ...realVpsConfig.testApp,
          name: appName,
          domain: appDomain
        }
      });

      setShowQuickPaste(false);
      setQuickPasteText('');
      setStatusMessage(`VPS details imported successfully: Main (${mainIp}) & DR (${drIp})`);
      setTimeout(() => setStatusMessage(null), 5000);
    } catch (err) {
      setStatusMessage('Failed to parse text. Please enter details directly in the fields below.');
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      
      {/* ── TOP CONTROL BANNER ──────────────────────────────────────────────── */}
      <div className={`p-4 sm:p-5 rounded-lg border shadow-sm transition-colors ${
        isDark ? 'bg-[#0D1322] border-[#1D2A42]' : 'bg-white border-slate-200'
      }`}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded bg-blue-600/20 text-blue-400 border border-blue-500/30">
                <Zap className="w-4 h-4 text-blue-400" />
              </span>
              <h1 className="text-lg font-bold font-mono tracking-tight flex items-center gap-2 flex-wrap">
                <span>REAL 2-VPS TESTBENCH &amp; FAILOVER ENGINE</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold tracking-wide border ${
                  isRealVpsOnlyMode 
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800' 
                    : 'bg-amber-950/80 text-amber-300 border-amber-800'
                }`}>
                  {isRealVpsOnlyMode ? 'MODE: 2-VPS REAL NODES ONLY' : 'MODE: MULTI-CLUSTER SAMPLE + REAL'}
                </span>
              </h1>
            </div>
            <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Direct real HTTP/HTTPS connectivity checks, hot-standby DR traffic routing, and live telemetry for your 2 VPS instances.
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Probe Both Nodes Button */}
            <button
              onClick={handleProbeBoth}
              disabled={isRealVpsProbing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold rounded transition-all bg-blue-600 hover:bg-blue-500 text-white shadow-sm hover:shadow-blue-500/20 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRealVpsProbing ? 'animate-spin' : ''}`} />
              <span>{isRealVpsProbing ? 'PROBING NODES...' : 'PROBE BOTH VPSs'}</span>
            </button>

            {/* Failover Switch Button */}
            <button
              onClick={handleToggleFailover}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold rounded transition-all border cursor-pointer ${
                isMainActive
                  ? 'bg-amber-600 hover:bg-amber-500 text-white border-amber-500 shadow-sm'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 shadow-sm'
              }`}
              title="Switch live production traffic between Main and DR"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>{isMainActive ? 'DIVERT TRAFFIC TO DR' : 'FAILBACK TO MAIN VPS'}</span>
            </button>

            {/* Toggle Real Only / Purge Mock Data Button */}
            {isRealVpsOnlyMode ? (
              <button
                onClick={restoreMockData}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded transition-colors border cursor-pointer ${
                  isDark ? 'bg-[#151D2E] text-slate-300 border-[#243552] hover:bg-[#1C2942]' : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                }`}
                title="Restore default sample apps and servers alongside your 2 real VPSs"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                <span>RESTORE SAMPLE DATA</span>
              </button>
            ) : (
              <button
                onClick={purgeMockData}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold rounded transition-colors bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 cursor-pointer"
                title="Remove all dummy/mock servers and applications, keeping ONLY your 2 Real VPSs!"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                <span>REMOVE MOCK DATA</span>
              </button>
            )}
          </div>
        </div>

        {/* Status Toast Alert */}
        {statusMessage && (
          <div className="mt-3 px-3 py-2 rounded text-xs font-mono flex items-center gap-2 bg-blue-950/80 border border-blue-800 text-blue-200 animate-in fade-in">
            <Info className="w-4 h-4 text-blue-400 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}
      </div>

      {/* ── LIVE TRAFFIC ROUTING PIPELINE (ARCHITECTURAL VISUALIZER) ─────────── */}
      <div className={`p-5 rounded-lg border ${
        isDark ? 'bg-[#0B0F17] border-[#1D273B]' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b mb-4 text-xs font-mono gap-2">
          <div className="flex items-center gap-2 font-bold tracking-wider">
            <Radio className="w-4 h-4 text-blue-400" />
            <span>LIVE TRAFFIC ALLOCATION &amp; FAILOVER PIPELINE</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleToggleAutoFailover}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono border transition-colors cursor-pointer ${
                autoFailover 
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800' 
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${autoFailover ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
              <span>Auto-Failover Watchdog: {autoFailover ? 'ON' : 'OFF'}</span>
            </button>
            <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
              isMainActive ? 'bg-blue-600 text-white' : 'bg-amber-600 text-white'
            }`}>
              ACTIVE NODE: {isMainActive ? 'MAIN (VPS 1)' : 'DR (VPS 2)'} · ROUTING: {routing}
            </span>
          </div>
        </div>

        {/* Failover Metadata Bar */}
        <div className={`mb-4 px-3 py-2 rounded border text-[11px] font-mono flex flex-wrap items-center justify-between gap-2 ${
          isDark ? 'bg-[#101726]/80 border-[#1E293B] text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
        }`}>
          <div className="flex flex-wrap items-center gap-4">
            <span><span className="text-slate-400">Active Node:</span> <strong className={isMainActive ? 'text-emerald-400' : 'text-amber-400'}>{routing}</strong></span>
            <span><span className="text-slate-400">Failover State:</span> <strong>{testApp.failoverState}</strong></span>
            <span><span className="text-slate-400">Auto-Failover:</span> <strong>{autoFailover ? 'ENABLED' : 'DISABLED'}</strong></span>
            <span><span className="text-slate-400">Last Failover Time:</span> <strong>{testApp.lastFailoverAt ? new Date(testApp.lastFailoverAt).toLocaleString() : 'Never'}</strong></span>
          </div>
          {lastFailoverReason && (
            <div className="text-amber-400 truncate max-w-xl">
              <span className="text-slate-400">Last Failover Reason:</span> {lastFailoverReason}
            </div>
          )}
        </div>

        {/* Structured Dual Probe Result Summary (when PROBE BOTH VPSs is clicked) */}
        {dualProbeResult && (
          <div className={`mb-4 p-3.5 rounded border text-xs font-mono space-y-2.5 ${
            isDark ? 'bg-[#0F172A] border-blue-900/70' : 'bg-blue-50/60 border-blue-200'
          }`}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-blue-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                <span>LATEST DUAL-VPS REAL PROBE SUMMARY</span>
              </span>
              <button
                onClick={() => setDualProbeResult(null)}
                className="text-[10px] text-slate-400 hover:text-white cursor-pointer"
              >
                DISMISS [X]
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { label: 'mainResult (VPS 1 - MAIN)', res: dualProbeResult.mainResult },
                { label: 'drResult (VPS 2 - DR)', res: dualProbeResult.drResult }
              ].map(({ label, res }) => (
                <div
                  key={label}
                  className={`p-2.5 rounded border space-y-1 ${
                    res.reachable && res.probeState === 'HEALTHY'
                      ? (isDark ? 'bg-emerald-950/30 border-emerald-800/70 text-emerald-200' : 'bg-emerald-50 border-emerald-300 text-emerald-900')
                      : (isDark ? 'bg-rose-950/30 border-rose-800/70 text-rose-200' : 'bg-rose-50 border-rose-300 text-rose-900')
                  }`}
                >
                  <div className="flex items-center justify-between font-bold">
                    <span>{label}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                      res.reachable ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                    }`}>
                      {res.reachable ? 'REACHABLE' : 'UNREACHABLE'} · {res.probeState || (res.reachable ? 'HEALTHY' : 'UNREACHABLE')}
                    </span>
                  </div>
                  <div className="text-[11px] flex flex-wrap gap-3">
                    <span>Target: <strong>{res.target}</strong></span>
                    <span>HTTP: <strong>{res.statusCode ?? 'ERR'}</strong></span>
                    <span>Latency: <strong>{res.latencyMs}ms</strong></span>
                    <span>Health: <strong>{res.health ?? 'N/A'}</strong></span>
                  </div>
                  {res.error && (
                    <div className="text-[11px] text-rose-300">
                      Error [{res.errorCategory || 'NETWORK'}]: {res.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Visual Pipeline Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          
          {/* Box 1: Edge Router / Application Ingress */}
          <div className={`p-4 rounded border text-xs font-mono space-y-2.5 ${
            isDark ? 'bg-[#101726] border-[#1E293B]' : 'bg-slate-50 border-slate-300'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Ingress Gateway</span>
              <Globe className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <div className="font-bold text-sm truncate">{testApp.domain}</div>
              <div className="text-[11px] text-slate-400">{testApp.name}</div>
            </div>
            <div className="pt-2 border-t text-[11px] space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Health Endpoint:</span>
                <span className="font-bold text-blue-400">{testApp.healthPath}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Traffic Route:</span>
                <span className={`font-bold ${isMainActive ? 'text-emerald-400' : 'text-amber-400'}`}>
                  100% {isMainActive ? `-> ${main.name} (${main.ip}:${main.port})` : `-> ${dr.name} (${dr.ip}:${dr.port})`}
                </span>
              </div>
            </div>
          </div>

          {/* Box 2: Node 1 (Main VPS) */}
          <div className={`p-4 rounded border text-xs font-mono space-y-2.5 relative transition-all ${
            isMainActive 
              ? (isDark ? 'bg-[#0E1A17] border-emerald-800 shadow-md ring-1 ring-emerald-500/30' : 'bg-emerald-50 border-emerald-400 shadow-sm') 
              : (isDark ? 'bg-[#101726]/60 border-[#1E293B] opacity-80' : 'bg-slate-50 border-slate-200 opacity-80')
          }`}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-bold">
                <Server className="w-4 h-4 text-emerald-400" />
                <span>{main.name}</span>
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                isMainActive ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'
              }`}>
                {isMainActive ? 'ACTIVE (100%)' : 'STANDBY (0%)'}
              </span>
            </div>

            <div className="space-y-1">
              <div className="font-bold text-sm text-slate-100 truncate">{main.ip}:{main.port}</div>
              <div className="text-[11px] text-slate-400 truncate">{main.role || 'PRIMARY / PRODUCTION'}</div>
            </div>

            <div className="pt-2 border-t text-[11px] space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Probe State:</span>
                <span className={`font-bold ${main.probeState === 'HEALTHY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {main.probeState || main.status} · {main.latencyMs}ms
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">HTTP Status:</span>
                <span className="font-bold">{main.httpStatus ? `${main.httpStatus} OK` : 'Unreachable'}</span>
              </div>
            </div>
          </div>

          {/* Box 3: Node 2 (DR VPS) */}
          <div className={`p-4 rounded border text-xs font-mono space-y-2.5 relative transition-all ${
            !isMainActive 
              ? (isDark ? 'bg-[#1F1710] border-amber-800 shadow-md ring-1 ring-amber-500/30' : 'bg-amber-50 border-amber-400 shadow-sm') 
              : (isDark ? 'bg-[#101726]/60 border-[#1E293B] opacity-80' : 'bg-slate-50 border-slate-200 opacity-80')
          }`}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-bold">
                <ShieldCheck className="w-4 h-4 text-amber-400" />
                <span>{dr.name}</span>
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                !isMainActive ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-300'
              }`}>
                {!isMainActive ? 'ACTIVE (100%)' : 'HOT STANDBY'}
              </span>
            </div>

            <div className="space-y-1">
              <div className="font-bold text-sm text-slate-100 truncate">{dr.ip}:{dr.port}</div>
              <div className="text-[11px] text-slate-400 truncate">{dr.role || 'DISASTER RECOVERY / STANDBY'}</div>
            </div>

            <div className="pt-2 border-t text-[11px] space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Probe State:</span>
                <span className={`font-bold ${dr.probeState === 'HEALTHY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {dr.probeState || dr.status} · {dr.latencyMs}ms
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">HTTP Status:</span>
                <span className="font-bold">{dr.httpStatus ? `${dr.httpStatus} OK` : 'Unreachable'}</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── TABBED NAVIGATION FOR TESTBENCH ──────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b text-xs font-mono pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('topology')}
          className={`px-3 py-1.5 rounded transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
            activeTab === 'topology'
              ? 'bg-blue-600 text-white font-bold'
              : isDark ? 'text-slate-400 hover:text-white hover:bg-[#162033]' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>NODES &amp; FAILOVER SIMULATOR</span>
        </button>
        <button
          onClick={() => setActiveTab('port-scanner')}
          className={`px-3 py-1.5 rounded transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
            activeTab === 'port-scanner'
              ? 'bg-blue-600 text-white font-bold'
              : isDark ? 'text-slate-400 hover:text-white hover:bg-[#162033]' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Network className="w-3.5 h-3.5" />
          <span>TCP PORT SCANNER</span>
        </button>
        <button
          onClick={() => setActiveTab('synthetic')}
          className={`px-3 py-1.5 rounded transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
            activeTab === 'synthetic'
              ? 'bg-blue-600 text-white font-bold'
              : isDark ? 'text-slate-400 hover:text-white hover:bg-[#162033]' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          <span>SYNTHETIC E2E TESTER</span>
        </button>
        <button
          onClick={() => setActiveTab('config')}
          className={`px-3 py-1.5 rounded transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
            activeTab === 'config'
              ? 'bg-blue-600 text-white font-bold'
              : isDark ? 'text-slate-400 hover:text-white hover:bg-[#162033]' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>CONFIGURE IP &amp; HEALTH URLS</span>
        </button>
        <button
          onClick={() => setActiveTab('agent')}
          className={`px-3 py-1.5 rounded transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
            activeTab === 'agent'
              ? 'bg-blue-600 text-white font-bold'
              : isDark ? 'text-slate-400 hover:text-white hover:bg-[#162033]' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>MICRO SERVERS &amp; AGENT SCRIPTS</span>
        </button>
      </div>

      {/* ── TAB 1: REAL VPS NODES DIAGNOSTICS & TELEMETRY ─────────────────────── */}
      {activeTab === 'topology' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* VPS 1 (MAIN / PRD) CARD */}
          <div className={`p-5 rounded-lg border space-y-4 ${
            isDark ? 'bg-[#0E131F] border-[#1D273B]' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            <div className="flex items-center justify-between pb-3 border-b gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${main.status === 'HEALTHY' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                <div>
                  <h2 className="text-sm font-bold font-mono text-slate-100 flex items-center gap-2">
                    <span>{main.name}</span>
                    {main.isSimulated && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-600 text-white">SIMULATION MODE</span>
                    )}
                  </h2>
                  <div className="text-[10px] font-mono text-emerald-400 font-semibold">{main.role || 'PRIMARY / PRODUCTION'}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setIsEditingMain(!isEditingMain)}
                  className="px-2 py-1 rounded text-[11px] font-mono border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  {isEditingMain ? 'CANCEL' : 'EDIT CONFIG'}
                </button>
                <button
                  onClick={handleProbeMain}
                  disabled={isRealVpsProbing}
                  className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-mono bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${isRealVpsProbing ? 'animate-spin' : ''}`} />
                  <span>PROBE MAIN</span>
                </button>
              </div>
            </div>

            {isEditingMain ? (
              <div className="space-y-2.5 text-xs font-mono p-3 rounded border border-blue-800/50 bg-blue-950/10">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Name</label>
                    <input type="text" value={mainForm.name} onChange={e => setMainForm({ ...mainForm, name: e.target.value })} className="w-full px-2.5 py-1 rounded border bg-[#141B2D] border-[#243552] text-white" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Role</label>
                    <input type="text" value={mainForm.role} onChange={e => setMainForm({ ...mainForm, role: e.target.value })} className="w-full px-2.5 py-1 rounded border bg-[#141B2D] border-[#243552] text-white" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Public IP</label>
                    <input type="text" value={mainForm.ip} onChange={e => setMainForm({ ...mainForm, ip: e.target.value })} className="w-full px-2.5 py-1 rounded border bg-[#141B2D] border-[#243552] text-white" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Application Port</label>
                    <input type="number" value={mainForm.port} onChange={e => setMainForm({ ...mainForm, port: Number(e.target.value) || 6423 })} className="w-full px-2.5 py-1 rounded border bg-[#141B2D] border-[#243552] text-white" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Hostname</label>
                    <input type="text" value={mainForm.hostname} onChange={e => setMainForm({ ...mainForm, hostname: e.target.value })} className="w-full px-2.5 py-1 rounded border bg-[#141B2D] border-[#243552] text-white" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Provider &amp; Region</label>
                    <div className="flex gap-1.5">
                      <input type="text" value={mainForm.provider} onChange={e => setMainForm({ ...mainForm, provider: e.target.value })} placeholder="Provider" className="w-1/2 px-2 py-1 rounded border bg-[#141B2D] border-[#243552] text-white" />
                      <input type="text" value={mainForm.region} onChange={e => setMainForm({ ...mainForm, region: e.target.value })} placeholder="Region" className="w-1/2 px-2 py-1 rounded border bg-[#141B2D] border-[#243552] text-white" />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">Health URL</label>
                  <input type="text" value={mainForm.healthUrl} onChange={e => setMainForm({ ...mainForm, healthUrl: e.target.value })} className="w-full px-2.5 py-1 rounded border bg-[#141B2D] border-[#243552] text-white" />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={handleSaveMain} className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer">SAVE VPS 1 MAIN</button>
                </div>
              </div>
            ) : null}

            {/* IP & Health URL details */}
            <div className="space-y-2 text-xs font-mono">
              <div className={`p-3 rounded border space-y-1.5 ${
                isDark ? 'bg-[#121927] border-[#1E293B]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex justify-between">
                  <span className="text-slate-400">Name &amp; Role:</span>
                  <span className="font-bold text-slate-200">{main.name} · {main.role || 'PRIMARY / PRODUCTION'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Public IP &amp; Port:</span>
                  <span className="font-bold text-slate-200">{main.ip} (Port {main.port})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Hostname:</span>
                  <span className="text-slate-300">{main.hostname}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Health URL:</span>
                  <span className="text-blue-400 font-bold truncate max-w-xs">{main.healthUrl}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Provider / Region:</span>
                  <span className="text-slate-300">{main.provider} · {main.region}</span>
                </div>
              </div>

              {/* Live Probe Diagnostics */}
              <div className={`p-3 rounded border space-y-2 ${
                main.status === 'HEALTHY' 
                  ? (isDark ? 'bg-emerald-950/30 border-emerald-900/60 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-900')
                  : (isDark ? 'bg-rose-950/30 border-rose-900/60 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-900')
              }`}>
                <div className="flex items-center justify-between font-bold flex-wrap gap-1">
                  <span>CURRENT STATUS: {main.status}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] ${
                    main.httpStatus && main.httpStatus >= 200 && main.httpStatus < 300
                      ? 'bg-emerald-600 text-white'
                      : 'bg-rose-600 text-white'
                  }`}>
                    {main.httpStatus && main.httpStatus >= 200 && main.httpStatus < 300 ? 'REACHABLE' : 'UNREACHABLE'} · {main.probeState || main.status} ({main.latencyMs}ms)
                  </span>
                </div>
                <div className="text-[11px] space-y-1 opacity-95">
                  <div>
                    HTTP Status: <span className="font-bold">{main.httpStatus ?? 'N/A (No HTTP response)'}</span> · Latency: <span className="font-bold">{main.latencyMs}ms</span> · TLS: <span className="font-bold">{main.tlsStatus || 'HTTP Plain'}</span>
                  </div>
                  {main.errorReason && (
                    <div className="text-rose-300 font-semibold">
                      Diagnostic [{main.errorCategory || 'ERROR'}]: {main.errorReason}
                    </div>
                  )}
                  <div className="truncate">Response: <span className="italic">{main.responseSnippet || 'Awaiting probe...'}</span></div>
                  {main.healthData && Object.keys(main.healthData).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {Object.entries(main.healthData).map(([k, v]) => (
                        <span key={k} className="px-1.5 py-0.5 rounded text-[10px] bg-black/30 border border-white/10">
                          {k}: <strong>{String(v)}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="text-[10px] opacity-75">
                    Last checked: {main.lastCheckedAt ? new Date(main.lastCheckedAt).toLocaleString() : 'Not yet probed'}
                  </div>
                </div>
              </div>

              {/* Telemetry Resource Bars */}
              <div className={`p-3 rounded border space-y-2 ${
                isDark ? 'bg-[#121927] border-[#1E293B]' : 'bg-slate-50 border-slate-200'
              }`}>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Live Server Telemetry</span>
                
                {/* CPU */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="flex items-center gap-1 text-slate-400"><Cpu className="w-3 h-3" /> CPU Load</span>
                    <span className="font-bold">{main.telemetry.cpuPercent}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${main.telemetry.cpuPercent}%` }} />
                  </div>
                </div>

                {/* RAM */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="flex items-center gap-1 text-slate-400"><Database className="w-3 h-3" /> Memory (RAM)</span>
                    <span className="font-bold">{main.telemetry.ramPercent}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${main.telemetry.ramPercent}%` }} />
                  </div>
                </div>

                {/* Disk */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="flex items-center gap-1 text-slate-400"><HardDrive className="w-3 h-3" /> NVMe Storage</span>
                    <span className="font-bold">{main.telemetry.diskPercent}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${main.telemetry.diskPercent}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* VPS 2 (DR / STANDBY) CARD */}
          <div className={`p-5 rounded-lg border space-y-4 ${
            isDark ? 'bg-[#0E131F] border-[#1D273B]' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            <div className="flex items-center justify-between pb-3 border-b gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${dr.status === 'HEALTHY' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                <div>
                  <h2 className="text-sm font-bold font-mono text-slate-100 flex items-center gap-2">
                    <span>{dr.name}</span>
                    {dr.isSimulated && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-600 text-white">SIMULATION MODE</span>
                    )}
                  </h2>
                  <div className="text-[10px] font-mono text-amber-400 font-semibold">{dr.role || 'DISASTER RECOVERY / STANDBY'}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setIsEditingDr(!isEditingDr)}
                  className="px-2 py-1 rounded text-[11px] font-mono border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  {isEditingDr ? 'CANCEL' : 'EDIT CONFIG'}
                </button>
                <button
                  onClick={handleProbeDr}
                  disabled={isRealVpsProbing}
                  className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-mono bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${isRealVpsProbing ? 'animate-spin' : ''}`} />
                  <span>PROBE DR</span>
                </button>
              </div>
            </div>

            {isEditingDr ? (
              <div className="space-y-2.5 text-xs font-mono p-3 rounded border border-amber-800/50 bg-amber-950/10">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Name</label>
                    <input type="text" value={drForm.name} onChange={e => setDrForm({ ...drForm, name: e.target.value })} className="w-full px-2.5 py-1 rounded border bg-[#141B2D] border-[#243552] text-white" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Role</label>
                    <input type="text" value={drForm.role} onChange={e => setDrForm({ ...drForm, role: e.target.value })} className="w-full px-2.5 py-1 rounded border bg-[#141B2D] border-[#243552] text-white" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Public IP</label>
                    <input type="text" value={drForm.ip} onChange={e => setDrForm({ ...drForm, ip: e.target.value })} className="w-full px-2.5 py-1 rounded border bg-[#141B2D] border-[#243552] text-white" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Application Port</label>
                    <input type="number" value={drForm.port} onChange={e => setDrForm({ ...drForm, port: Number(e.target.value) || 6423 })} className="w-full px-2.5 py-1 rounded border bg-[#141B2D] border-[#243552] text-white" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Hostname</label>
                    <input type="text" value={drForm.hostname} onChange={e => setDrForm({ ...drForm, hostname: e.target.value })} className="w-full px-2.5 py-1 rounded border bg-[#141B2D] border-[#243552] text-white" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Provider &amp; Region</label>
                    <div className="flex gap-1.5">
                      <input type="text" value={drForm.provider} onChange={e => setDrForm({ ...drForm, provider: e.target.value })} placeholder="Provider" className="w-1/2 px-2 py-1 rounded border bg-[#141B2D] border-[#243552] text-white" />
                      <input type="text" value={drForm.region} onChange={e => setDrForm({ ...drForm, region: e.target.value })} placeholder="Region" className="w-1/2 px-2 py-1 rounded border bg-[#141B2D] border-[#243552] text-white" />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">Health URL</label>
                  <input type="text" value={drForm.healthUrl} onChange={e => setDrForm({ ...drForm, healthUrl: e.target.value })} className="w-full px-2.5 py-1 rounded border bg-[#141B2D] border-[#243552] text-white" />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={handleSaveDr} className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer">SAVE VPS 2 DR</button>
                </div>
              </div>
            ) : null}

            {/* IP & Health URL details */}
            <div className="space-y-2 text-xs font-mono">
              <div className={`p-3 rounded border space-y-1.5 ${
                isDark ? 'bg-[#121927] border-[#1E293B]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex justify-between">
                  <span className="text-slate-400">Name &amp; Role:</span>
                  <span className="font-bold text-slate-200">{dr.name} · {dr.role || 'DISASTER RECOVERY / STANDBY'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Public IP &amp; Port:</span>
                  <span className="font-bold text-slate-200">{dr.ip} (Port {dr.port})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Hostname:</span>
                  <span className="text-slate-300">{dr.hostname}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Health URL:</span>
                  <span className="text-blue-400 font-bold truncate max-w-xs">{dr.healthUrl}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Provider / Region:</span>
                  <span className="text-slate-300">{dr.provider} · {dr.region}</span>
                </div>
              </div>

              {/* Live Probe Diagnostics */}
              <div className={`p-3 rounded border space-y-2 ${
                dr.status === 'HEALTHY' 
                  ? (isDark ? 'bg-emerald-950/30 border-emerald-900/60 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-900')
                  : (isDark ? 'bg-rose-950/30 border-rose-900/60 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-900')
              }`}>
                <div className="flex items-center justify-between font-bold flex-wrap gap-1">
                  <span>CURRENT STATUS: {dr.status}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] ${
                    dr.httpStatus && dr.httpStatus >= 200 && dr.httpStatus < 300
                      ? 'bg-emerald-600 text-white'
                      : 'bg-rose-600 text-white'
                  }`}>
                    {dr.httpStatus && dr.httpStatus >= 200 && dr.httpStatus < 300 ? 'REACHABLE' : 'UNREACHABLE'} · {dr.probeState || dr.status} ({dr.latencyMs}ms)
                  </span>
                </div>
                <div className="text-[11px] space-y-1 opacity-95">
                  <div>
                    HTTP Status: <span className="font-bold">{dr.httpStatus ?? 'N/A (No HTTP response)'}</span> · Latency: <span className="font-bold">{dr.latencyMs}ms</span> · TLS: <span className="font-bold">{dr.tlsStatus || 'HTTP Plain'}</span>
                  </div>
                  {dr.errorReason && (
                    <div className="text-rose-300 font-semibold">
                      Diagnostic [{dr.errorCategory || 'ERROR'}]: {dr.errorReason}
                    </div>
                  )}
                  <div className="truncate">Response: <span className="italic">{dr.responseSnippet || 'Awaiting probe...'}</span></div>
                  {dr.healthData && Object.keys(dr.healthData).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {Object.entries(dr.healthData).map(([k, v]) => (
                        <span key={k} className="px-1.5 py-0.5 rounded text-[10px] bg-black/30 border border-white/10">
                          {k}: <strong>{String(v)}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="text-[10px] opacity-75">
                    Last checked: {dr.lastCheckedAt ? new Date(dr.lastCheckedAt).toLocaleString() : 'Not yet probed'}
                  </div>
                </div>
              </div>

              {/* Telemetry Resource Bars */}
              <div className={`p-3 rounded border space-y-2 ${
                isDark ? 'bg-[#121927] border-[#1E293B]' : 'bg-slate-50 border-slate-200'
              }`}>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Live Server Telemetry</span>
                
                {/* CPU */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="flex items-center gap-1 text-slate-400"><Cpu className="w-3 h-3" /> CPU Load</span>
                    <span className="font-bold">{dr.telemetry.cpuPercent}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${dr.telemetry.cpuPercent}%` }} />
                  </div>
                </div>

                {/* RAM */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="flex items-center gap-1 text-slate-400"><Database className="w-3 h-3" /> Memory (RAM)</span>
                    <span className="font-bold">{dr.telemetry.ramPercent}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${dr.telemetry.ramPercent}%` }} />
                  </div>
                </div>

                {/* Disk */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="flex items-center gap-1 text-slate-400"><HardDrive className="w-3 h-3" /> NVMe Storage</span>
                    <span className="font-bold">{dr.telemetry.diskPercent}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${dr.telemetry.diskPercent}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── REAL-TIME FAILOVER & OUTAGE SIMULATION TEST BENCH ───────────────── */}
          <div className={`col-span-1 lg:col-span-2 p-5 rounded-lg border space-y-4 ${
            isDark ? 'bg-[#0A0E18] border-[#1C273C]' : 'bg-slate-50 border-slate-200'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b gap-2 text-xs font-mono">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-rose-400" />
                <span className="font-bold text-sm">RESILIENCE &amp; CHAOS FAILOVER TESTING STATION (SIMULATION MODE)</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/90 text-amber-300 border border-amber-700">
                  SIMULATION MODE CONTROLS
                </span>
              </div>
              <span className="text-[11px] text-slate-400">
                Clearly labeled simulation mode: test failover routing logic without altering real VPS firewall or process state.
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
              {/* Main Outage Simulator */}
              <div className={`p-4 rounded border space-y-3 ${
                isDark ? 'bg-[#101625] border-[#1C273C]' : 'bg-white border-slate-200'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5" />
                    SIMULATION MODE: VPS 1 MAIN ({main.ip})
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    main.status === 'HEALTHY' ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'
                  }`}>
                    {main.isSimulated ? `SIMULATED: ${main.status}` : `REAL: ${main.status}`}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  [SIMULATION MODE] Injects synthetic outage state on Main node to test automatic or manual failover to DR. Run &quot;PROBE MAIN&quot; at any time to replace with real live VPS status.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSimulateOutageToggle('main', main.status)}
                    disabled={isSimulatingOutage}
                    className={`flex-1 py-1.5 px-3 rounded font-bold transition-colors cursor-pointer text-xs ${
                      main.status === 'HEALTHY'
                        ? 'bg-rose-600 hover:bg-rose-500 text-white'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    {main.status === 'HEALTHY' ? '[SIMULATION MODE] TRIGGER MAIN OUTAGE (FAIL TO DR)' : '[SIMULATION MODE] RESTORE MAIN NODE'}
                  </button>
                </div>
              </div>

              {/* DR Outage Simulator */}
              <div className={`p-4 rounded border space-y-3 ${
                isDark ? 'bg-[#101625] border-[#1C273C]' : 'bg-white border-slate-200'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    SIMULATION MODE: VPS 2 DR ({dr.ip})
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    dr.status === 'HEALTHY' ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'
                  }`}>
                    {dr.isSimulated ? `SIMULATED: ${dr.status}` : `REAL: ${dr.status}`}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  [SIMULATION MODE] Tests how the system handles degraded standby readiness. Run &quot;PROBE DR&quot; at any time to replace with real live VPS status.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSimulateOutageToggle('dr', dr.status)}
                    disabled={isSimulatingOutage}
                    className={`flex-1 py-1.5 px-3 rounded font-bold transition-colors cursor-pointer text-xs ${
                      dr.status === 'HEALTHY'
                        ? 'bg-rose-600 hover:bg-rose-500 text-white'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    {dr.status === 'HEALTHY' ? '[SIMULATION MODE] SIMULATE DR STANDBY OUTAGE' : '[SIMULATION MODE] RESTORE DR STANDBY'}
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ── TAB: TCP PORT SCANNER ────────────────────────────────────────────── */}
      {activeTab === 'port-scanner' && (
        <div className="space-y-6">
          <div className={`p-5 rounded-lg border space-y-4 ${
            isDark ? 'bg-[#0E131F] border-[#1D273B]' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b gap-3">
              <div>
                <h3 className="text-sm font-bold font-mono flex items-center gap-2">
                  <Network className="w-4 h-4 text-blue-400" />
                  <span>REAL TCP SOCKET PORT SCANNER</span>
                </h3>
                <p className="text-xs font-mono text-slate-400 mt-1">
                  Tests live raw TCP socket connection establishment to application port 6423 and standard services on your VPS nodes.
                </p>
              </div>

              {/* Node Selector */}
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="text-slate-400">Target VPS:</span>
                <div className="flex rounded border overflow-hidden p-0.5 border-slate-700 bg-black/30">
                  <button
                    onClick={() => setTcpTarget('main')}
                    className={`px-3 py-1 rounded transition-colors cursor-pointer font-bold ${
                      tcpTarget === 'main' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    VPS 1 MAIN ({main.ip}:{main.port})
                  </button>
                  <button
                    onClick={() => setTcpTarget('dr')}
                    className={`px-3 py-1 rounded transition-colors cursor-pointer font-bold ${
                      tcpTarget === 'dr' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    VPS 2 DR ({dr.ip}:{dr.port})
                  </button>
                </div>
              </div>
            </div>

            {/* Dedicated Application Port 6423 Quick Test Bar */}
            <div className={`p-3 rounded border flex flex-wrap items-center justify-between gap-3 text-xs font-mono ${
              isDark ? 'bg-[#121927] border-blue-900/50' : 'bg-blue-50/60 border-blue-200'
            }`}>
              <div className="flex items-center gap-2">
                <span className="font-bold text-blue-400">PRODUCTION APPLICATION PORT (TCP 6423):</span>
                <span className="text-slate-400">Direct TCP socket check for Node.js / Express API</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleScanTcpForNode('main', main.port || 6423)}
                  disabled={scanningPort === (main.port || 6423) && tcpTarget === 'main'}
                  className="px-3 py-1.5 rounded font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer disabled:opacity-50"
                >
                  VPS 1 MAIN → TCP {main.port || 6423}
                </button>
                <button
                  onClick={() => handleScanTcpForNode('dr', dr.port || 6423)}
                  disabled={scanningPort === (dr.port || 6423) && tcpTarget === 'dr'}
                  className="px-3 py-1.5 rounded font-bold bg-amber-600 hover:bg-amber-500 text-white transition-colors cursor-pointer disabled:opacity-50"
                >
                  VPS 2 DR → TCP {dr.port || 6423}
                </button>
              </div>
            </div>

            {/* Quick Actions & Custom Port Input */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleScanAllCommonPorts}
                  disabled={isScanningTcp}
                  className="px-3 py-1.5 rounded font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isScanningTcp ? 'animate-spin' : ''}`} />
                  <span>{isScanningTcp ? 'SCANNING COMMON PORTS...' : 'SCAN ALL 8 COMMON PORTS'}</span>
                </button>
              </div>

              {/* Custom port test */}
              <div className="flex items-center gap-2">
                <span className="text-slate-400">
                  {tcpTarget === 'main' ? 'VPS 1 MAIN' : 'VPS 2 DR'} → TCP Port:
                </span>
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={customPort}
                  onChange={e => setCustomPort(parseInt(e.target.value, 10) || 6423)}
                  className={`w-24 px-2.5 py-1 rounded border font-mono ${
                    isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'
                  }`}
                />
                <button
                  onClick={() => handleScanTcp(customPort)}
                  disabled={scanningPort === customPort}
                  className="px-3 py-1 rounded font-bold bg-slate-700 hover:bg-slate-600 text-slate-100 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {scanningPort === customPort ? 'TESTING...' : 'TEST PORT'}
                </button>
              </div>
            </div>

            {/* Ports Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono pt-2">
              {commonPorts.map(p => {
                const result = tcpResults[`${tcpTarget}-${p.port}`];
                const isScanning = scanningPort === p.port;
                const nodeLabel = tcpTarget === 'main' ? 'VPS 1 MAIN' : 'VPS 2 DR';
                return (
                  <div
                    key={p.port}
                    className={`p-3 rounded border transition-all ${
                      result
                        ? result.open
                          ? (isDark ? 'bg-emerald-950/40 border-emerald-800' : 'bg-emerald-50 border-emerald-300')
                          : (isDark ? 'bg-rose-950/40 border-rose-900' : 'bg-rose-50 border-rose-300')
                        : (isDark ? 'bg-[#121927] border-[#1E293B]' : 'bg-slate-50 border-slate-200')
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm">{nodeLabel} → TCP {p.port}</span>
                      <button
                        onClick={() => handleScanTcp(p.port)}
                        disabled={isScanning}
                        className="px-2 py-0.5 rounded text-[10px] bg-black/40 text-blue-400 hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
                      >
                        {isScanning ? 'SCANNING...' : 'CHECK'}
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-400 mb-2 truncate">{p.name}</div>
                    
                    <div className="pt-2 border-t border-slate-800/60 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400">STATE:</span>
                        {result ? (
                          <span className={`font-bold flex items-center gap-1 ${result.open ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {result.open ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                            <span>{result.open ? `OPEN (${result.latencyMs}ms)` : 'CLOSED / FILTERED'}</span>
                          </span>
                        ) : (
                          <span className="text-slate-500 italic">Not tested</span>
                        )}
                      </div>
                      {result?.error && (
                        <div className="text-[10px] text-rose-300 truncate" title={result.error}>
                          {result.error}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: SYNTHETIC E2E TESTER ────────────────────────────────────────── */}
      {activeTab === 'synthetic' && (
        <div className="space-y-6">
          <div className={`p-5 rounded-lg border space-y-4 ${
            isDark ? 'bg-[#0E131F] border-[#1D273B]' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b gap-2">
              <div>
                <h3 className="text-sm font-bold font-mono flex items-center gap-2">
                  <Zap className="w-4 h-4 text-blue-400" />
                  <span>SYNTHETIC END-TO-END TRANSACTION TESTER</span>
                </h3>
                <p className="text-xs font-mono text-slate-400 mt-1">
                  Execute live HTTP/HTTPS requests with response time assertions and payload text verification.
                </p>
              </div>

              {/* Quick load targets */}
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="text-slate-400">Fill Target:</span>
                <button
                  onClick={() => setSynthUrl(main.healthUrl)}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer text-[11px]"
                >
                  Main VPS Health
                </button>
                <button
                  onClick={() => setSynthUrl(dr.healthUrl)}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer text-[11px]"
                >
                  DR VPS Health
                </button>
              </div>
            </div>

            {/* Test Form */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs font-mono">
              <div className="md:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Target URL Endpoint</label>
                <input
                  type="text"
                  value={synthUrl}
                  onChange={e => setSynthUrl(e.target.value)}
                  placeholder="http://185.193.125.101/health"
                  className={`w-full px-3 py-1.5 rounded border font-mono ${
                    isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'
                  }`}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">HTTP Method</label>
                <select
                  value={synthMethod}
                  onChange={e => setSynthMethod(e.target.value as any)}
                  className={`w-full px-3 py-1.5 rounded border font-mono ${
                    isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'
                  }`}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Expected HTTP Status</label>
                <input
                  type="number"
                  value={synthExpectedStatus}
                  onChange={e => setSynthExpectedStatus(parseInt(e.target.value, 10) || 200)}
                  className={`w-full px-3 py-1.5 rounded border font-mono ${
                    isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'
                  }`}
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Expected String Match in Response Body (Optional Assertion)
                </label>
                <input
                  type="text"
                  value={synthMatchText}
                  onChange={e => setSynthMatchText(e.target.value)}
                  placeholder="e.g. healthy, ok, or database_connected"
                  className={`w-full px-3 py-1.5 rounded border font-mono ${
                    isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'
                  }`}
                />
              </div>
            </div>

            <button
              onClick={handleRunSynthetic}
              disabled={isTestingSynth}
              className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-mono font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer disabled:opacity-50"
            >
              <Send className={`w-3.5 h-3.5 ${isTestingSynth ? 'animate-bounce' : ''}`} />
              <span>{isTestingSynth ? 'SENDING LIVE SYNTHETIC PROBE...' : 'DISPATCH SYNTHETIC PROBE'}</span>
            </button>

            {/* Live Result Output */}
            {synthResult && (
              <div className={`p-4 rounded border text-xs font-mono space-y-3 animate-in fade-in ${
                synthResult.expectedMatch
                  ? (isDark ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200' : 'bg-emerald-50 border-emerald-300 text-emerald-900')
                  : (isDark ? 'bg-rose-950/40 border-rose-900 text-rose-200' : 'bg-rose-50 border-rose-300 text-rose-900')
              }`}>
                <div className="flex items-center justify-between pb-2 border-b border-black/30 font-bold">
                  <span className="flex items-center gap-2">
                    {synthResult.expectedMatch ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-rose-400" />}
                    <span>TEST RESULT: {synthResult.expectedMatch ? 'ASSERTION PASSED' : 'ASSERTION FAILED'}</span>
                  </span>
                  <span>LATENCY: {synthResult.latencyMs}ms</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div>HTTP Code: <span className="font-bold">{synthResult.statusCode || 'N/A'}</span></div>
                  <div>Expected: <span className="font-bold">{synthExpectedStatus}</span></div>
                  <div>Reachability: <span className="font-bold">{synthResult.reachable ? 'ONLINE' : 'UNREACHABLE'}</span></div>
                  <div>Keyword Match: <span className="font-bold">{synthMatchText ? (synthResult.expectedMatch ? 'MATCHED' : 'NOT FOUND') : 'SKIPPED'}</span></div>
                </div>

                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider opacity-75">Response Payload Snippet:</span>
                  <pre className="p-2.5 rounded bg-black/50 overflow-x-auto text-[11px] mt-1 text-slate-200">
                    {synthResult.responseSnippet}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 2: CONFIGURE IP & HEALTH ENDPOINTS ────────────────────────────── */}
      {activeTab === 'config' && (
        <div className="space-y-6">
          {/* Quick Paste / Import Box */}
          <div className={`p-4 rounded-lg border font-mono text-xs space-y-3 ${
            isDark ? 'bg-[#0F172A] border-blue-900/60' : 'bg-blue-50 border-blue-200'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-blue-400">
                <Sliders className="w-4 h-4" />
                <span>HOW TO ENTER OR UPLOAD YOUR REAL VPS DETAILS:</span>
              </div>
              <button
                onClick={() => setShowQuickPaste(!showQuickPaste)}
                className="px-3 py-1 rounded text-[11px] font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer shrink-0"
              >
                {showQuickPaste ? 'HIDE QUICK PASTE BOX' : '⚡ QUICK PASTE DETAILS (JSON OR TEXT)'}
              </button>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              You can either fill the individual cards below for <strong>VPS 1 (Main)</strong>, <strong>VPS 2 (DR)</strong>, and your <strong>Test Application</strong>, or click the Quick Paste button to paste raw IP addresses, domains, and health URLs directly!
            </p>

            {showQuickPaste && (
              <div className="space-y-3 pt-2 border-t border-blue-900/40 animate-in fade-in">
                <label className="block text-[11px] font-bold text-slate-300">
                  Paste raw text or JSON with your VPS 1 &amp; VPS 2 details:
                </label>
                <textarea
                  rows={4}
                  value={quickPasteText}
                  onChange={e => setQuickPasteText(e.target.value)}
                  placeholder={`Example plain text:
Main VPS IP: 185.193.125.101
DR VPS IP: 185.193.125.102
Health Check: /health
Domain: app.example.com`}
                  className={`w-full p-2.5 rounded border font-mono text-xs ${
                    isDark ? 'bg-black/50 border-slate-700 text-emerald-300' : 'bg-white border-slate-300 text-slate-800'
                  }`}
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowQuickPaste(false)}
                    className="px-3 py-1.5 rounded text-xs bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleQuickPaste}
                    className="px-4 py-1.5 rounded text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
                  >
                    APPLY &amp; SAVE VPS DETAILS
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Configure Main VPS Form */}
            <div className={`p-5 rounded-lg border space-y-4 ${
              isDark ? 'bg-[#0E131F] border-[#1D273B]' : 'bg-white border-slate-200'
            }`}>
              <div className="flex items-center justify-between pb-3 border-b">
                <h3 className="text-sm font-bold font-mono text-emerald-400">CONFIGURE VPS 1 (MAIN / PRD)</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">PRD NODE</span>
              </div>

              <div className="space-y-3 text-xs font-mono">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">VPS Name / Label</label>
                  <input
                    type="text"
                    value={mainForm.name}
                    onChange={e => setMainForm(prev => ({ ...prev, name: e.target.value }))}
                    className={`w-full px-3 py-1.5 rounded border ${isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'}`}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">IP Address / Host</label>
                  <input
                    type="text"
                    value={mainForm.ip}
                    onChange={e => setMainForm(prev => ({ ...prev, ip: e.target.value }))}
                    placeholder="e.g. 185.193.125.101"
                    className={`w-full px-3 py-1.5 rounded border ${isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'}`}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">Domain Hostname</label>
                  <input
                    type="text"
                    value={mainForm.hostname}
                    onChange={e => setMainForm(prev => ({ ...prev, hostname: e.target.value }))}
                    placeholder="e.g. prd-vps1.mydomain.com"
                    className={`w-full px-3 py-1.5 rounded border ${isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'}`}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">HTTP Port</label>
                    <input
                      type="number"
                      value={mainForm.port}
                      onChange={e => setMainForm(prev => ({ ...prev, port: parseInt(e.target.value, 10) || 80 }))}
                      className={`w-full px-3 py-1.5 rounded border ${isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'}`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">Region</label>
                    <input
                      type="text"
                      value={mainForm.region}
                      onChange={e => setMainForm(prev => ({ ...prev, region: e.target.value }))}
                      placeholder="e.g. Singapore"
                      className={`w-full px-3 py-1.5 rounded border ${isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'}`}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">Health Check URL (Target)</label>
                  <input
                    type="text"
                    value={mainForm.healthUrl}
                    onChange={e => setMainForm(prev => ({ ...prev, healthUrl: e.target.value }))}
                    placeholder="http://185.193.125.101/health"
                    className={`w-full px-3 py-1.5 rounded border font-mono ${isDark ? 'bg-[#141B2D] border-[#243552] text-blue-300' : 'bg-white border-slate-300 text-blue-700'}`}
                  />
                  <p className="text-[10px] text-slate-500 mt-1">This URL is pinged directly from this backend server to test reachability.</p>
                </div>

                <button
                  onClick={handleSaveMain}
                  className="w-full py-2 rounded text-xs font-mono font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
                >
                  SAVE MAIN VPS SETTINGS
                </button>
              </div>
            </div>

            {/* Configure DR VPS Form */}
            <div className={`p-5 rounded-lg border space-y-4 ${
              isDark ? 'bg-[#0E131F] border-[#1D273B]' : 'bg-white border-slate-200'
            }`}>
              <div className="flex items-center justify-between pb-3 border-b">
                <h3 className="text-sm font-bold font-mono text-amber-400">CONFIGURE VPS 2 (DR STANDBY)</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">DR NODE</span>
              </div>

              <div className="space-y-3 text-xs font-mono">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">VPS Name / Label</label>
                  <input
                    type="text"
                    value={drForm.name}
                    onChange={e => setDrForm(prev => ({ ...prev, name: e.target.value }))}
                    className={`w-full px-3 py-1.5 rounded border ${isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'}`}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">IP Address / Host</label>
                  <input
                    type="text"
                    value={drForm.ip}
                    onChange={e => setDrForm(prev => ({ ...prev, ip: e.target.value }))}
                    placeholder="e.g. 185.193.125.102"
                    className={`w-full px-3 py-1.5 rounded border ${isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'}`}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">Domain Hostname</label>
                  <input
                    type="text"
                    value={drForm.hostname}
                    onChange={e => setDrForm(prev => ({ ...prev, hostname: e.target.value }))}
                    placeholder="e.g. dr-vps2.mydomain.com"
                    className={`w-full px-3 py-1.5 rounded border ${isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'}`}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">HTTP Port</label>
                    <input
                      type="number"
                      value={drForm.port}
                      onChange={e => setDrForm(prev => ({ ...prev, port: parseInt(e.target.value, 10) || 80 }))}
                      className={`w-full px-3 py-1.5 rounded border ${isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'}`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">Region</label>
                    <input
                      type="text"
                      value={drForm.region}
                      onChange={e => setDrForm(prev => ({ ...prev, region: e.target.value }))}
                      placeholder="e.g. Frankfurt"
                      className={`w-full px-3 py-1.5 rounded border ${isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'}`}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">Health Check URL (Target)</label>
                  <input
                    type="text"
                    value={drForm.healthUrl}
                    onChange={e => setDrForm(prev => ({ ...prev, healthUrl: e.target.value }))}
                    placeholder="http://185.193.125.102/health"
                    className={`w-full px-3 py-1.5 rounded border font-mono ${isDark ? 'bg-[#141B2D] border-[#243552] text-blue-300' : 'bg-white border-slate-300 text-blue-700'}`}
                  />
                  <p className="text-[10px] text-slate-500 mt-1">This URL is pinged to verify standby health before routing traffic.</p>
                </div>

                <button
                  onClick={handleSaveDr}
                  className="w-full py-2 rounded text-xs font-mono font-bold bg-amber-600 hover:bg-amber-500 text-white transition-colors cursor-pointer"
                >
                  SAVE DR VPS SETTINGS
                </button>
              </div>
            </div>

          </div>

          {/* Test Application Mapping Form */}
          <div className={`p-5 rounded-lg border space-y-4 ${
            isDark ? 'bg-[#0E131F] border-[#1D273B]' : 'bg-white border-slate-200'
          }`}>
            <h3 className="text-sm font-bold font-mono text-blue-400">TEST APPLICATION MAPPING (ATTACHED WORKLOAD)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Application Name</label>
                <input
                  type="text"
                  value={appForm.name}
                  onChange={e => setAppForm(prev => ({ ...prev, name: e.target.value }))}
                  className={`w-full px-3 py-1.5 rounded border ${isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'}`}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Production Domain</label>
                <input
                  type="text"
                  value={appForm.domain}
                  onChange={e => setAppForm(prev => ({ ...prev, domain: e.target.value }))}
                  className={`w-full px-3 py-1.5 rounded border ${isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'}`}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Application Health Path</label>
                <input
                  type="text"
                  value={appForm.healthPath}
                  onChange={e => setAppForm(prev => ({ ...prev, healthPath: e.target.value }))}
                  className={`w-full px-3 py-1.5 rounded border ${isDark ? 'bg-[#141B2D] border-[#243552] text-white' : 'bg-white border-slate-300'}`}
                />
              </div>
            </div>
            <button
              onClick={handleSaveApp}
              className="px-4 py-1.5 rounded text-xs font-mono font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer"
            >
              UPDATE APPLICATION MAPPING
            </button>
          </div>
        </div>
      )}

      {/* ── TAB 3: 1-LINE VPS TELEMETRY SCRIPT ───────────────────────────────── */}
      {activeTab === 'agent' && (
        <div className={`p-5 rounded-lg border space-y-4 ${
          isDark ? 'bg-[#0E131F] border-[#1D273B]' : 'bg-white border-slate-200'
        }`}>
          <div className="flex items-center gap-2 pb-2 border-b">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold font-mono">DEPLOY REAL TELEMETRY AGENT (RUN DIRECTLY ON YOUR REAL VPS)</h3>
          </div>

          <p className="text-xs font-mono text-slate-400">
            Paste this one-line command into your terminal on your real VPS. It automatically inspects CPU, RAM, and Disk utilization and streams live telemetry to this dashboard every 5 seconds.
          </p>

          <div className="space-y-4">
            {/* Main VPS Script */}
            <div className={`p-4 rounded border space-y-2 ${
              isDark ? 'bg-[#080C14] border-[#1E293B]' : 'bg-slate-900 text-slate-100'
            }`}>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5" />
                  FOR VPS 1 (MAIN / PRD):
                </span>
                <button
                  onClick={() => copyToClipboard(getAgentCommand('main'), 'main')}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
                >
                  {copiedScript === 'main' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedScript === 'main' ? 'COPIED!' : 'COPY COMMAND'}</span>
                </button>
              </div>
              <pre className="text-xs font-mono text-emerald-300 overflow-x-auto p-2.5 rounded bg-black/40 selection:bg-emerald-500/30">
                {getAgentCommand('main')}
              </pre>
            </div>

            {/* DR VPS Script */}
            <div className={`p-4 rounded border space-y-2 ${
              isDark ? 'bg-[#080C14] border-[#1E293B]' : 'bg-slate-900 text-slate-100'
            }`}>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-bold text-amber-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  FOR VPS 2 (DR STANDBY):
                </span>
                <button
                  onClick={() => copyToClipboard(getAgentCommand('dr'), 'dr')}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
                >
                  {copiedScript === 'dr' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedScript === 'dr' ? 'COPIED!' : 'COPY COMMAND'}</span>
                </button>
              </div>
              <pre className="text-xs font-mono text-amber-300 overflow-x-auto p-2.5 rounded bg-black/40 selection:bg-amber-500/30">
                {getAgentCommand('dr')}
              </pre>
            </div>

            {/* Manual JSON Ingest API Documentation */}
            <div className={`p-4 rounded border text-xs font-mono space-y-2 ${
              isDark ? 'bg-[#121927] border-[#1E293B] text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}>
              <span className="font-bold text-blue-400">Direct Ingest REST Endpoint (For Cron / Webhooks / Python):</span>
              <pre className="p-2 rounded bg-black/30 overflow-x-auto text-[11px]">
{`curl -X POST "${window.location.origin}/api/v1/servers/telemetry/ingest" \\
  -H "Content-Type: application/json" \\
  -d '{"serverId":"vps-real-main", "cpuPercent":22.5, "ramPercent":48.0, "diskPercent":38.2}'`}
              </pre>
            </div>

            {/* Quick Micro Health Servers (If you don't have an endpoint on your VPS yet) */}
            <div className={`p-4 rounded border space-y-3 ${
              isDark ? 'bg-[#0B101D] border-[#1E293B]' : 'bg-white border-slate-200'
            }`}>
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-amber-400">
                <Code className="w-4 h-4" />
                <span>NEED A QUICK HEALTH CHECK ENDPOINT ON YOUR VPS FOR TESTING? (RUN ANY OF THESE):</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                {/* Python 3 */}
                <div className={`p-3 rounded border space-y-1.5 ${isDark ? 'bg-black/40 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-center justify-between font-bold">
                    <span className="text-emerald-400">Option 1: Python 3 (Instant One-Liner)</span>
                    <button
                      onClick={() => copyToClipboard('python3 -c "import http.server, socketserver; handler = lambda *a: http.server.SimpleHTTPRequestHandler(*a); http.server.HTTPServer((\'0.0.0.0\', 80), handler).serve_forever()"', 'python')}
                      className="px-2 py-0.5 rounded text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                    >
                      {copiedScript === 'python' ? 'COPIED!' : 'COPY'}
                    </button>
                  </div>
                  <pre className="p-2 rounded bg-black/50 text-[10px] text-slate-300 overflow-x-auto">
                    sudo python3 -m http.server 80
                  </pre>
                </div>

                {/* Node.js */}
                <div className={`p-3 rounded border space-y-1.5 ${isDark ? 'bg-black/40 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-center justify-between font-bold">
                    <span className="text-blue-400">Option 2: Node.js Micro Server</span>
                    <button
                      onClick={() => copyToClipboard('node -e \'require("http").createServer((req,res)=>{res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({status:"healthy",node:process.env.HOSTNAME||"vps",time:new Date()}))}).listen(80,()=>console.log("Listening 80"))\'', 'node')}
                      className="px-2 py-0.5 rounded text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                    >
                      {copiedScript === 'node' ? 'COPIED!' : 'COPY'}
                    </button>
                  </div>
                  <pre className="p-2 rounded bg-black/50 text-[10px] text-slate-300 overflow-x-auto">
                    {`node -e 'require("http").createServer((q,s)=>s.end(JSON.stringify({status:"ok"}))).listen(80)'`}
                  </pre>
                </div>

                {/* Docker */}
                <div className={`p-3 rounded border space-y-1.5 ${isDark ? 'bg-black/40 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-center justify-between font-bold">
                    <span className="text-cyan-400">Option 3: Docker Container</span>
                    <button
                      onClick={() => copyToClipboard('docker run -d --name test-health -p 80:80 nginxdemos/hello', 'docker')}
                      className="px-2 py-0.5 rounded text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                    >
                      {copiedScript === 'docker' ? 'COPIED!' : 'COPY'}
                    </button>
                  </div>
                  <pre className="p-2 rounded bg-black/50 text-[10px] text-slate-300 overflow-x-auto">
                    docker run -d --name test-health -p 80:80 nginxdemos/hello
                  </pre>
                </div>

                {/* Nginx */}
                <div className={`p-3 rounded border space-y-1.5 ${isDark ? 'bg-black/40 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-center justify-between font-bold">
                    <span className="text-amber-400">Option 4: Nginx Health Endpoint</span>
                    <button
                      onClick={() => copyToClipboard('location /health {\n  return 200 \'{"status":"healthy","uptime_ok":true}\';\n  add_header Content-Type application/json;\n}', 'nginx')}
                      className="px-2 py-0.5 rounded text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                    >
                      {copiedScript === 'nginx' ? 'COPIED!' : 'COPY'}
                    </button>
                  </div>
                  <pre className="p-2 rounded bg-black/50 text-[10px] text-slate-300 overflow-x-auto">
                    location /health &#123; return 200 '&#123;"status":"healthy"&#125;'; &#125;
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PROBE RESULT DETAIL MODAL ────────────────────────────────────────── */}
      {probeResultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs" onClick={() => setProbeResultModal(null)}>
          <div className={`w-full max-w-lg p-5 rounded-lg border shadow-xl font-mono text-xs space-y-3 ${
            isDark ? 'bg-[#0E131F] border-[#1E293B] text-slate-200' : 'bg-white border-slate-200 text-slate-800'
          }`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-2 border-b">
              <span className="font-bold text-sm flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-blue-400" />
                <span>LIVE PROBE DIAGNOSTIC REPORT</span>
              </span>
              <button onClick={() => setProbeResultModal(null)} className="px-2 py-0.5 rounded text-slate-400 hover:text-white">✕</button>
            </div>
            
            <pre className="p-3 rounded bg-black/50 overflow-x-auto text-[11px] text-slate-300 max-h-80">
              {JSON.stringify(probeResultModal, null, 2)}
            </pre>

            <button
              onClick={() => setProbeResultModal(null)}
              className="w-full py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors cursor-pointer"
            >
              CLOSE REPORT
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
