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
  const [customPort, setCustomPort] = useState<number>(80);
  const [tcpResults, setTcpResults] = useState<Record<number, RealVpsTcpProbeResult>>({});
  const [isScanningTcp, setIsScanningTcp] = useState<boolean>(false);
  const [scanningPort, setScanningPort] = useState<number | null>(null);

  // Synthetic E2E Tester states
  const [synthUrl, setSynthUrl] = useState<string>(realVpsConfig?.main.healthUrl || 'http://185.193.125.101/health');
  const [synthMethod, setSynthMethod] = useState<'GET' | 'POST' | 'PUT'>('GET');
  const [synthBody, setSynthBody] = useState<string>('{"ping":"test"}');
  const [synthExpectedStatus, setSynthExpectedStatus] = useState<number>(200);
  const [synthMatchText, setSynthMatchText] = useState<string>('');
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
    name: realVpsConfig?.main.name || 'Main VPS (Primary / PRD)',
    ip: realVpsConfig?.main.ip || '185.193.125.101',
    hostname: realVpsConfig?.main.hostname || 'prd-vps1.main-server.net',
    port: realVpsConfig?.main.port || 80,
    healthUrl: realVpsConfig?.main.healthUrl || 'http://185.193.125.101/health',
    provider: realVpsConfig?.main.provider || 'Hostinger Cloud VPS',
    region: realVpsConfig?.main.region || 'Singapore (PRD)'
  });

  const [isEditingDr, setIsEditingDr] = useState(false);
  const [drForm, setDrForm] = useState({
    name: realVpsConfig?.dr.name || 'DR VPS (Disaster Recovery / Standby)',
    ip: realVpsConfig?.dr.ip || '185.193.125.102',
    hostname: realVpsConfig?.dr.hostname || 'dr-vps2.standby-server.net',
    port: realVpsConfig?.dr.port || 80,
    healthUrl: realVpsConfig?.dr.healthUrl || 'http://185.193.125.102/health',
    provider: realVpsConfig?.dr.provider || 'Hostinger Cloud VPS',
    region: realVpsConfig?.dr.region || 'Frankfurt (DR Standby)'
  });

  const [isEditingApp, setIsEditingApp] = useState(false);
  const [appForm, setAppForm] = useState({
    name: realVpsConfig?.testApp.name || 'Production 2-VPS Application',
    domain: realVpsConfig?.testApp.domain || 'app.scholario.net',
    healthPath: realVpsConfig?.testApp.healthPath || '/health'
  });

  const [probeResultModal, setProbeResultModal] = useState<RealVpsProbeResult | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Sync edit forms when realVpsConfig changes
  React.useEffect(() => {
    if (realVpsConfig) {
      setMainForm({
        name: realVpsConfig.main.name,
        ip: realVpsConfig.main.ip,
        hostname: realVpsConfig.main.hostname,
        port: realVpsConfig.main.port,
        healthUrl: realVpsConfig.main.healthUrl,
        provider: realVpsConfig.main.provider,
        region: realVpsConfig.main.region
      });
      setDrForm({
        name: realVpsConfig.dr.name,
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
    }
  }, [realVpsConfig]);

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

  const { main, dr, routing, autoFailover, testApp } = realVpsConfig;
  const isMainActive = routing === 'MAIN';

  const handleSaveMain = async () => {
    await updateRealVpsConfig({
      main: {
        ...main,
        ...mainForm,
        port: Number(mainForm.port) || 80
      }
    });
    setIsEditingMain(false);
    setStatusMessage('Saved Main VPS configuration');
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleSaveDr = async () => {
    await updateRealVpsConfig({
      dr: {
        ...dr,
        ...drForm,
        port: Number(drForm.port) || 80
      }
    });
    setIsEditingDr(false);
    setStatusMessage('Saved DR VPS configuration');
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
      setStatusMessage(`Probed Main VPS: ${res.reachable ? 'REACHABLE' : 'UNREACHABLE'} (${res.latencyMs}ms)`);
      setTimeout(() => setStatusMessage(null), 4000);
    }
  };

  const handleProbeDr = async () => {
    const res = await probeRealVps('dr');
    if (res) {
      setProbeResultModal(res);
      setStatusMessage(`Probed DR VPS: ${res.reachable ? 'REACHABLE' : 'UNREACHABLE'} (${res.latencyMs}ms)`);
      setTimeout(() => setStatusMessage(null), 4000);
    }
  };

  const handleProbeBoth = async () => {
    const res = await probeBothRealVps();
    if (res) {
      setStatusMessage(`Probed Both Nodes: Main (${res.mainResult.latencyMs}ms) | DR (${res.drResult.latencyMs}ms)`);
      setTimeout(() => setStatusMessage(null), 4000);
    }
  };

  const handleToggleFailover = async () => {
    const target = isMainActive ? 'DR' : 'MAIN';
    await failoverRealVps(target, `Operator toggled traffic to ${target} via 2-VPS Testbench`);
    setStatusMessage(`Traffic routed to ${target} node (${target === 'MAIN' ? main.ip : dr.ip})`);
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const handleToggleAutoFailover = async () => {
    await updateRealVpsConfig({ autoFailover: !autoFailover });
    setStatusMessage(`Automated Failover ${!autoFailover ? 'ENABLED' : 'DISABLED'}`);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const commonPorts = [
    { port: 80, name: 'HTTP Web Ingress' },
    { port: 443, name: 'HTTPS TLS Secure' },
    { port: 22, name: 'SSH Remote Console' },
    { port: 3000, name: 'Node.js / App Service' },
    { port: 8080, name: 'Proxy / Alternate Web' },
    { port: 5432, name: 'PostgreSQL Database' },
    { port: 3306, name: 'MySQL / MariaDB' },
    { port: 6379, name: 'Redis In-Memory Cache' },
  ];

  const handleScanTcp = async (portToScan: number) => {
    setScanningPort(portToScan);
    const host = tcpTarget === 'dr' ? dr.ip : main.ip;
    const res = await tcpProbe({ targetVps: tcpTarget, host, port: portToScan });
    if (res) {
      setTcpResults(prev => ({ ...prev, [portToScan]: res }));
      setStatusMessage(`Port ${portToScan} on ${tcpTarget.toUpperCase()} (${host}): ${res.open ? 'OPEN / ACCEPTING' : 'CLOSED / FILTERED'} (${res.latencyMs}ms)`);
      setTimeout(() => setStatusMessage(null), 4000);
    }
    setScanningPort(null);
  };

  const handleScanAllCommonPorts = async () => {
    setIsScanningTcp(true);
    const host = tcpTarget === 'dr' ? dr.ip : main.ip;
    for (const p of commonPorts) {
      setScanningPort(p.port);
      const res = await tcpProbe({ targetVps: tcpTarget, host, port: p.port });
      if (res) {
        setTcpResults(prev => ({ ...prev, [p.port]: res }));
      }
    }
    setScanningPort(null);
    setIsScanningTcp(false);
    setStatusMessage(`Completed TCP reachability scan across 8 common ports on ${tcpTarget.toUpperCase()} node (${host})`);
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
              CURRENTLY ACTIVE: {isMainActive ? 'MAIN VPS' : 'DR STANDBY'}
            </span>
          </div>
        </div>

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
                  100% {isMainActive ? '-> Main VPS' : '-> DR Node'}
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
                <span>VPS 1: MAIN (PRD)</span>
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                isMainActive ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'
              }`}>
                {isMainActive ? 'ACTIVE (100%)' : 'STANDBY (0%)'}
              </span>
            </div>

            <div className="space-y-1">
              <div className="font-bold text-sm text-slate-100 truncate">{main.ip}</div>
              <div className="text-[11px] text-slate-400 truncate">{main.hostname}</div>
            </div>

            <div className="pt-2 border-t text-[11px] space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Probe Status:</span>
                <span className={`font-bold ${main.status === 'HEALTHY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {main.status} · {main.latencyMs}ms
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">HTTP Status:</span>
                <span className="font-bold">{main.httpStatus ? `${main.httpStatus} OK` : 'Unknown'}</span>
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
                <span>VPS 2: DR STANDBY</span>
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                !isMainActive ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-300'
              }`}>
                {!isMainActive ? 'ACTIVE (100%)' : 'HOT STANDBY'}
              </span>
            </div>

            <div className="space-y-1">
              <div className="font-bold text-sm text-slate-100 truncate">{dr.ip}</div>
              <div className="text-[11px] text-slate-400 truncate">{dr.hostname}</div>
            </div>

            <div className="pt-2 border-t text-[11px] space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Probe Status:</span>
                <span className={`font-bold ${dr.status === 'HEALTHY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {dr.status} · {dr.latencyMs}ms
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Replication:</span>
                <span className="font-bold text-blue-400">Lag: 2s (Synchronized)</span>
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
            <div className="flex items-center justify-between pb-3 border-b">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <h2 className="text-sm font-bold font-mono text-slate-100">
                  VPS 1: {main.name}
                </h2>
              </div>
              <button
                onClick={handleProbeMain}
                disabled={isRealVpsProbing}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-mono bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isRealVpsProbing ? 'animate-spin' : ''}`} />
                <span>PROBE MAIN</span>
              </button>
            </div>

            {/* IP & Health URL details */}
            <div className="space-y-2 text-xs font-mono">
              <div className={`p-3 rounded border space-y-1.5 ${
                isDark ? 'bg-[#121927] border-[#1E293B]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex justify-between">
                  <span className="text-slate-400">IP Address:</span>
                  <span className="font-bold text-slate-200">{main.ip}:{main.port}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Hostname:</span>
                  <span className="text-slate-300">{main.hostname}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Health Endpoint:</span>
                  <span className="text-blue-400 font-bold truncate max-w-xs">{main.healthUrl}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Datacenter Region:</span>
                  <span className="text-slate-300">{main.region}</span>
                </div>
              </div>

              {/* Live Probe Diagnostics */}
              <div className={`p-3 rounded border space-y-2 ${
                main.status === 'HEALTHY' 
                  ? (isDark ? 'bg-emerald-950/30 border-emerald-900/60 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-900')
                  : (isDark ? 'bg-rose-950/30 border-rose-900/60 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-900')
              }`}>
                <div className="flex items-center justify-between font-bold">
                  <span>LIVE PROBE STATUS:</span>
                  <span>{main.status} ({main.latencyMs}ms roundtrip)</span>
                </div>
                <div className="text-[11px] space-y-0.5 opacity-90">
                  <div>HTTP Code: <span className="font-bold">{main.httpStatus || 'N/A'}</span> · TLS: <span className="font-bold">{main.tlsStatus || 'None'}</span></div>
                  <div className="truncate">Response: <span className="italic">{main.responseSnippet || 'Nominal 200 OK'}</span></div>
                  <div className="text-[10px] opacity-75">Last checked: {new Date(main.lastCheckedAt || Date.now()).toLocaleTimeString()}</div>
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
            <div className="flex items-center justify-between pb-3 border-b">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                <h2 className="text-sm font-bold font-mono text-slate-100">
                  VPS 2: {dr.name}
                </h2>
              </div>
              <button
                onClick={handleProbeDr}
                disabled={isRealVpsProbing}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-mono bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isRealVpsProbing ? 'animate-spin' : ''}`} />
                <span>PROBE DR</span>
              </button>
            </div>

            {/* IP & Health URL details */}
            <div className="space-y-2 text-xs font-mono">
              <div className={`p-3 rounded border space-y-1.5 ${
                isDark ? 'bg-[#121927] border-[#1E293B]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex justify-between">
                  <span className="text-slate-400">IP Address:</span>
                  <span className="font-bold text-slate-200">{dr.ip}:{dr.port}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Hostname:</span>
                  <span className="text-slate-300">{dr.hostname}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Health Endpoint:</span>
                  <span className="text-blue-400 font-bold truncate max-w-xs">{dr.healthUrl}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Datacenter Region:</span>
                  <span className="text-slate-300">{dr.region}</span>
                </div>
              </div>

              {/* Live Probe Diagnostics */}
              <div className={`p-3 rounded border space-y-2 ${
                dr.status === 'HEALTHY' 
                  ? (isDark ? 'bg-emerald-950/30 border-emerald-900/60 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-900')
                  : (isDark ? 'bg-rose-950/30 border-rose-900/60 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-900')
              }`}>
                <div className="flex items-center justify-between font-bold">
                  <span>LIVE PROBE STATUS:</span>
                  <span>{dr.status} ({dr.latencyMs}ms roundtrip)</span>
                </div>
                <div className="text-[11px] space-y-0.5 opacity-90">
                  <div>HTTP Code: <span className="font-bold">{dr.httpStatus || 'N/A'}</span> · TLS: <span className="font-bold">{dr.tlsStatus || 'None'}</span></div>
                  <div className="truncate">Response: <span className="italic">{dr.responseSnippet || 'Standby Ready'}</span></div>
                  <div className="text-[10px] opacity-75">Last checked: {new Date(dr.lastCheckedAt || Date.now()).toLocaleTimeString()}</div>
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
                <span className="font-bold text-sm">RESILIENCE &amp; CHAOS FAILOVER TESTING STATION</span>
              </div>
              <span className="text-[11px] text-slate-400">
                Simulate node failures to verify automatic or manual traffic rerouting without waiting for real downtime.
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
                    VPS 1 (MAIN / PRD) SIMULATOR
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    main.status === 'HEALTHY' ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'
                  }`}>
                    CURRENT: {main.status}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Injects synthetic 504 gateway timeout / connection refused on Main node. If Auto-Failover is ON and traffic is on Main, the system automatically redirects live traffic to DR!
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
                    {main.status === 'HEALTHY' ? '🔥 TRIGGER MAIN OUTAGE (FAIL TO DR)' : '✅ RESTORE MAIN NODE (HEALTHY)'}
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
                    VPS 2 (DR STANDBY) SIMULATOR
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    dr.status === 'HEALTHY' ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'
                  }`}>
                    CURRENT: {dr.status}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Tests how the system handles degraded standby readiness or alerts operators when the secondary backup site loses connectivity.
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
                    {dr.status === 'HEALTHY' ? '🔥 SIMULATE DR STANDBY OUTAGE' : '✅ RESTORE DR STANDBY'}
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
                  Tests live raw socket connection establishment to standard services (SSH, HTTP, HTTPS, DBs) on your VPS.
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
                    VPS 1: MAIN ({main.ip})
                  </button>
                  <button
                    onClick={() => setTcpTarget('dr')}
                    className={`px-3 py-1 rounded transition-colors cursor-pointer font-bold ${
                      tcpTarget === 'dr' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    VPS 2: DR ({dr.ip})
                  </button>
                </div>
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
                  <span>{isScanningTcp ? 'SCANNING 8 PORTS...' : 'SCAN ALL 8 COMMON PORTS'}</span>
                </button>
              </div>

              {/* Custom port test */}
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Custom Port:</span>
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={customPort}
                  onChange={e => setCustomPort(parseInt(e.target.value, 10) || 80)}
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
                const result = tcpResults[p.port];
                const isScanning = scanningPort === p.port;
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
                      <span className="font-bold text-sm">PORT {p.port}</span>
                      <button
                        onClick={() => handleScanTcp(p.port)}
                        disabled={isScanning}
                        className="px-2 py-0.5 rounded text-[10px] bg-black/40 text-blue-400 hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
                      >
                        {isScanning ? 'SCANNING...' : 'CHECK'}
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-400 mb-2 truncate">{p.name}</div>
                    
                    <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between">
                      <span className="text-[10px] text-slate-400">STATE:</span>
                      {result ? (
                        <span className={`font-bold flex items-center gap-1 ${result.open ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {result.open ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                          <span>{result.open ? `OPEN (${result.latencyMs}ms)` : 'CLOSED'}</span>
                        </span>
                      ) : (
                        <span className="text-slate-500 italic">Not tested</span>
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
