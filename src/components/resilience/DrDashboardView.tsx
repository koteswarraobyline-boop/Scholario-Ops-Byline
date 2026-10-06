import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { DrReadinessItem, DrOverall, VpsServer } from '../../types';
import { Users, Globe, AlertTriangle, RefreshCw, ShieldCheck, Loader2 } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { Ago, verdictColor } from '../ui/Freshness';
import { LbFailoverConsole } from './LbFailoverConsole';
import { routeState } from '../ui/routing';
import { LbPoolCard } from '../providers/LoadBalancerPanel';

const validDate = (s?: string | null) => Boolean(s) && !Number.isNaN(Date.parse(s as string));
const fmtDateTime = (s?: string | null, fallback = '—') => (validDate(s) ? new Date(s as string).toLocaleString() : fallback);

const readinessColor = (s: DrReadinessItem['status']) => verdictColor(s);

const statusColor = (s?: string) =>
  s === 'HEALTHY' ? 'text-emerald-500' : s === 'WARNING' || s === 'STALE' ? 'text-amber-500' : s === 'CRITICAL' ? 'text-rose-500' : 'text-slate-400';

export const DrDashboardView: React.FC = () => {
  const { applications, servers, monitors, cloudflareZones, triggerFailover, theme, isLoading, loadBalancer } = useOps();
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const isDark = theme === 'dark';
  const canFailover = hasRole('super_admin');

  const [selectedAppId, setSelectedAppId] = useState<string>('');
  const [confirmingFailover, setConfirmingFailover] = useState(false);
  const [failoverReason, setFailoverReason] = useState('');
  const [failoverBusy, setFailoverBusy] = useState(false);

  const [checks, setChecks] = useState<DrReadinessItem[]>([]);
  const [overall, setOverall] = useState<DrOverall | null>(null);
  const [score, setScore] = useState<{ passed: number; total: number } | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [readinessAt, setReadinessAt] = useState<string>('');

  const selectedApp = applications.find(a => a.id === selectedAppId) || applications[0];
  const appId = selectedApp?.id;

  const loadReadiness = useCallback(async () => {
    if (!appId) return;
    setReadinessLoading(true);
    try {
      const r = await api.getDrReadiness(appId);
      setChecks(r.checks ?? []);
      setOverall(r.overall ?? null);
      setScore(typeof r.passed === 'number' ? { passed: r.passed, total: r.total } : null);
      setReadinessError(null);
      setReadinessAt(r.evaluatedAt ?? '');
    } catch (err) {
      setReadinessError(err instanceof Error ? err.message : 'Failed to load DR readiness');
    } finally {
      setReadinessLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    setChecks([]);
    setOverall(null);
    setReadinessError(null);
    if (!appId) return;
    void loadReadiness();
    const timer = setInterval(() => { void loadReadiness(); }, 30_000);
    return () => clearInterval(timer);
  }, [appId, loadReadiness]);

  if (!selectedApp) {
    return (
      <div className="space-y-6">
        <div className={`pb-3 border-b ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
          <h1 className="text-lg font-bold font-mono tracking-tight">DISASTER RECOVERY &amp; TRAFFIC FAILOVER</h1>
        </div>
        {isLoading ? (
          <div className={`text-xs font-mono animate-pulse ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Loading DR dashboard…</div>
        ) : (
          <EmptyState
            icon={ShieldCheck}
            title="No applications registered"
            description="Register applications with a PRD and DR server, Cloudflare zone and DNS record in Setup to enable DR failover."
            action={{ label: 'Open Setup', onClick: () => navigate('/setup') }}
          />
        )}
      </div>
    );
  }

  const prdServer = servers.find(s => s.id === selectedApp.prdServerId);
  const drServer = servers.find(s => s.id === selectedApp.drServerId);
  const cfZone = cloudflareZones.find(z => selectedApp.cloudflareZone && (z.domain === selectedApp.cloudflareZone || selectedApp.cloudflareZone.endsWith(`.${z.domain}`)));
  const dnsRecord = cfZone?.dnsRecords.find(r => r.name === selectedApp.dnsRecordName && (r.type === 'A' || r.type === 'AAAA'));
  const prdMonitors = monitors.filter(m => m.applicationId === selectedApp.id && m.environment === 'PRD' && m.enabled);
  const drMonitors = monitors.filter(m => m.applicationId === selectedApp.id && m.environment === 'DR' && m.enabled);

  const lbMapped = Boolean(selectedApp.loadBalancer);
  const routing = lbMapped ? loadBalancer?.routing.find(r => r.hostname === selectedApp.loadBalancer!.hostname) : undefined;
  const lbPools = lbMapped ? (loadBalancer?.pools ?? []).filter(p => p.applicationId === selectedApp.id) : [];
  // For LB apps, "receiving traffic" comes from Cloudflare routing; null = unknown
  const lbServing = (env: 'PRD' | 'DR'): boolean | null => {
    if (!routing?.found || !routing.activePoolId) return null;
    const poolId = env === 'PRD' ? selectedApp.loadBalancer!.prdPoolId : selectedApp.loadBalancer!.drPoolId;
    return routing.activePoolId === poolId;
  };
  const isDrActive = lbMapped ? lbServing('DR') === true : selectedApp.failoverState === 'DR_ACTIVE';
  const isFailingOver = selectedApp.failoverState === 'FAILING_OVER';
  const target: 'DR' | 'PRIMARY' = isDrActive ? 'PRIMARY' : 'DR';
  const targetServer = target === 'DR' ? drServer : prdServer;

  const blockers: string[] = [];
  if (!selectedApp.cloudflareZone) blockers.push('no Cloudflare zone');
  if (!selectedApp.dnsRecordName) blockers.push('no DNS record');
  if (!targetServer) blockers.push(`no ${target === 'DR' ? 'DR' : 'PRD'} server linked`);
  else if (!targetServer.ip) blockers.push(`${target === 'DR' ? 'DR' : 'PRD'} server has no IP`);

  const handleFailover = async () => {
    setFailoverBusy(true);
    try {
      const ok = await triggerFailover(selectedApp.id, target, failoverReason.trim() || undefined);
      if (ok) {
        setConfirmingFailover(false);
        setFailoverReason('');
        void loadReadiness();
      }
    } finally {
      setFailoverBusy(false);
    }
  };

  const muted = isDark ? 'text-slate-400' : 'text-slate-500';

  const originRow = (srv: VpsServer | undefined, env: 'PRD' | 'DR', active: boolean | null, envMonitors: typeof monitors) => {
    const healthy = envMonitors.length > 0 && envMonitors.every(m => m.status === 'HEALTHY');
    return (
      <div className={`p-2.5 rounded border flex items-center justify-between gap-2 ${
        active
          ? (isDark ? 'bg-[#0E1A14] border-emerald-900/80 text-emerald-300' : 'bg-emerald-50 border-emerald-300 text-emerald-950')
          : (isDark ? 'bg-[#0B0F17] border-[#1A2436] text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-600')
      }`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-emerald-500' : 'bg-slate-500'}`} />
          <div className="min-w-0">
            <div className="font-bold truncate">{env === 'PRD' ? 'PRIMARY (PRD)' : 'STANDBY (DR)'}: {srv ? srv.hostname.split('.')[0] : 'Not linked'}</div>
            <div className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              {srv ? <>{srv.ip || 'No IP'}{srv.region ? ` · ${srv.region}` : ''} · <span className={statusColor(srv.status)}>{srv.status}</span> · agent {srv.agentStatus}</> : 'Link a server in Setup'}
            </div>
            <div className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
              {envMonitors.length === 0
                ? 'No monitors for this environment'
                : <span className={healthy ? 'text-emerald-500' : 'text-amber-500'}>{envMonitors.filter(m => m.status === 'HEALTHY').length}/{envMonitors.length} monitors healthy</span>}
            </div>
          </div>
        </div>
        <span className="font-bold text-[11px] shrink-0">{active === null ? 'ROUTING UNKNOWN' : active ? 'RECEIVING TRAFFIC' : 'STANDBY'}</span>
      </div>
    );
  };

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            DISASTER RECOVERY &amp; TRAFFIC FAILOVER
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            DR readiness from live checks, and failover between PRD and DR (Cloudflare Load Balancer or DNS)
          </p>
        </div>

        {/* App Selector */}
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>Application:</span>
          <select
            value={selectedApp.id}
            onChange={e => {
              setSelectedAppId(e.target.value);
              setConfirmingFailover(false);
              setFailoverReason('');
            }}
            className={`px-2.5 py-1 rounded border outline-none cursor-pointer ${
              isDark ? 'bg-[#0B0F17] border-[#1E293B] text-slate-200' : 'bg-white border-slate-300 text-slate-800 shadow-2xs'
            }`}
          >
            {applications.map(app => (
              <option key={app.id} value={app.id}>
                {app.name} ({({ PRD: 'Primary active', DR: 'DR active', MOVING: 'switching', UNKNOWN: 'routing unknown' } as const)[routeState(app, loadBalancer)]})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ROUTING TOPOLOGY */}
      <div className={`rounded-lg border p-5 space-y-5 font-mono transition-colors ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className={`flex items-center justify-between border-b pb-2.5 ${isDark ? 'border-[#1A2332]' : 'border-slate-100'}`}>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            <h2 className="text-xs font-bold uppercase tracking-wider">Routing: {selectedApp.name}</h2>
          </div>
          <span className={`text-xs font-bold ${lbMapped && lbServing('PRD') === null ? 'text-slate-400' : isFailingOver || isDrActive ? 'text-amber-500' : 'text-emerald-500'}`}>
            {lbMapped && lbServing('PRD') === null ? 'ROUTING UNKNOWN' : isFailingOver ? 'FAILOVER IN PROGRESS' : isDrActive ? 'ROUTED TO DR' : 'ROUTED TO PRIMARY'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-center text-xs">
          <div className={`p-3 rounded border text-center space-y-1 ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`}>
            <Users className="w-4 h-4 mx-auto text-blue-500" />
            <div className="font-bold">Public traffic</div>
            <div className={`text-[10px] truncate ${muted}`}>{selectedApp.loadBalancer?.hostname || selectedApp.dnsRecordName || 'DNS record not configured'}</div>
          </div>

          <div className={`p-3 rounded border text-center space-y-1 ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`}>
            <Globe className="w-4 h-4 mx-auto text-amber-500" />
            <div className="font-bold">{lbMapped ? 'Cloudflare Load Balancer' : 'Cloudflare DNS'}</div>
            <div className={`text-[10px] truncate ${muted}`}>{selectedApp.cloudflareZone || 'Zone not configured'}</div>
            {lbMapped ? (
              <div className={`text-[10px] font-semibold ${routing?.found ? 'text-emerald-500' : muted}`}>
                {routing?.found
                  ? `order: ${routing.defaultPools.map(id => lbPools.find(p => p.id === id)?.name || id).join(' → ')}`
                  : routing?.error ? 'Routing: ' + routing.error.slice(0, 80) : loadBalancer?.status === 'OK' ? 'Routing not read' : (loadBalancer?.status ?? 'Not loaded').replace('_', ' ')}
              </div>
            ) : (
              <div className={`text-[10px] font-semibold truncate ${dnsRecord ? 'text-emerald-500' : muted}`}>
                {dnsRecord ? `${dnsRecord.name} → ${dnsRecord.target}` : cfZone ? 'Record not found in synced zone' : 'Zone not synced'}
              </div>
            )}
          </div>

          <div className="md:col-span-2 space-y-2">
            {originRow(prdServer, 'PRD', lbMapped ? lbServing('PRD') : !isDrActive && !isFailingOver, prdMonitors)}
            {originRow(drServer, 'DR', lbMapped ? lbServing('DR') : isDrActive, drMonitors)}
          </div>
        </div>

        {lbMapped && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {lbPools.length === 0
              ? <div className={`text-[11px] ${muted}`}>Cloudflare pool state not loaded</div>
              : lbPools.map(p => <LbPoolCard key={p.id} pool={p} isDark={isDark} compact active={routing?.found ? (routing.activePoolId ? routing.activePoolId === p.id : null) : undefined} />)}
          </div>
        )}

        <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] pt-3 border-t ${isDark ? 'border-[#1A2332]' : 'border-slate-100'}`}>
          <div>
            <span className={muted}>Auto-failover:</span>
            <div className={`font-semibold ${selectedApp.autoFailover ? 'text-emerald-500' : ''}`}>{selectedApp.autoFailover ? 'Enabled' : 'Disabled'}</div>
          </div>
          <div>
            <span className={muted}>Last failover:</span>
            <div className="font-semibold">{fmtDateTime(selectedApp.lastFailoverAt, 'Never')}</div>
          </div>
          <div>
            <span className={muted}>Replication lag:</span>
            <div className="font-semibold">{selectedApp.currentReplicationLagSec === null ? 'No data' : `${selectedApp.currentReplicationLagSec}s`}</div>
          </div>
          <div>
            <span className={muted}>RTO / RPO target:</span>
            <div className="font-semibold">{selectedApp.rtoTargetMin}m / {selectedApp.rpoTargetMin}m</div>
          </div>
        </div>

        {/* Failover Controls */}
        <div className={`pt-3 border-t space-y-2 text-xs ${isDark ? 'border-[#1A2332]' : 'border-slate-100'}`}>
          {lbMapped ? (
            <LbFailoverConsole app={selectedApp} />
          ) : !canFailover ? (
            <div className={`font-sans ${muted}`}>Only super administrators can switch traffic between PRD and DR.</div>
          ) : blockers.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 font-sans">
              <span className="text-amber-500">Failover unavailable: {blockers.join(', ')}.</span>
              <button onClick={() => navigate('/setup')} className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-mono font-semibold cursor-pointer">
                Configure in Setup
              </button>
            </div>
          ) : !confirmingFailover ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className={muted}>
                Switching will point <strong className={isDark ? 'text-slate-200' : 'text-slate-900'}>{selectedApp.dnsRecordName}</strong> to{' '}
                <strong className={isDark ? 'text-slate-200' : 'text-slate-900'}>{targetServer?.ip}</strong>.
              </div>
              <button
                disabled={isFailingOver}
                onClick={() => setConfirmingFailover(true)}
                className={`px-3 py-1.5 rounded font-semibold text-xs text-white transition-colors cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed ${
                  isDrActive ? 'bg-blue-600 hover:bg-blue-700' : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {isFailingOver ? 'FAILOVER IN PROGRESS…' : isDrActive ? 'FAIL BACK TO PRIMARY' : 'FAIL OVER TO DR'}
              </button>
            </div>
          ) : (
            <div className={`p-3 rounded font-sans border space-y-2 ${isDark ? 'bg-[#1F1710] border-amber-900' : 'bg-amber-50 border-amber-200'}`}>
              <div className="font-bold text-amber-500 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                <span>Confirm Cloudflare DNS switch for {selectedApp.name}</span>
              </div>
              <p className={`text-[11px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                <strong className="font-mono">{selectedApp.dnsRecordName}</strong> (zone <span className="font-mono">{selectedApp.cloudflareZone}</span>)
                {dnsRecord ? <> currently → <span className="font-mono">{dnsRecord.target}</span></> : null} will be pointed to the{' '}
                {target === 'DR' ? 'DR' : 'PRD'} server <strong className="font-mono">{targetServer?.hostname}</strong> (<strong className="font-mono">{targetServer?.ip}</strong>).
                {target === 'DR' && overall !== null && overall !== 'READY' && <span className="text-rose-500 font-semibold"> DR readiness is {overall.replace('_', ' ')}.</span>}
              </p>
              <input
                type="text"
                value={failoverReason}
                onChange={e => setFailoverReason(e.target.value)}
                placeholder="Reason (recorded in the audit log)"
                className={`w-full px-2 py-1 rounded border text-xs font-mono outline-none ${
                  isDark ? 'bg-[#0B0F17] border-[#1E293B] text-slate-200' : 'bg-white border-slate-300 text-slate-800'
                }`}
              />
              <div className="flex items-center gap-2">
                <button
                  disabled={failoverBusy}
                  onClick={handleFailover}
                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold font-mono cursor-pointer flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {failoverBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>{failoverBusy ? 'Switching DNS…' : 'Switch DNS now'}</span>
                </button>
                <button
                  disabled={failoverBusy}
                  onClick={() => setConfirmingFailover(false)}
                  className={`px-2 py-1 rounded text-xs cursor-pointer disabled:opacity-60 ${
                    isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                  }`}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* DR READINESS (from the backend) */}
      <div className={`rounded-lg border p-5 space-y-4 font-mono text-xs transition-colors ${
        isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className={`flex flex-wrap items-center justify-between gap-2 border-b pb-2 ${isDark ? 'border-[#1A2332]' : 'border-slate-100'}`}>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider">DR Readiness: {selectedApp.name}</h2>
            <p className={`text-[11px] font-sans ${muted}`}>
              Evaluated by the server from live monitors, agent telemetry and Cloudflare pool health{readinessAt ? <> · evaluated <Ago iso={readinessAt} /></> : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {overall !== null && (
              <span className={`text-xs font-bold ${verdictColor(overall)}`}>
                OVERALL: {overall.replace('_', ' ')}{score ? ` · ${score.passed}/${score.total} checks pass` : ''}
              </span>
            )}
            <button
              onClick={() => void loadReadiness()}
              disabled={readinessLoading}
              className={`p-1 rounded border cursor-pointer disabled:opacity-60 ${isDark ? 'border-[#1E293B] text-slate-300 hover:bg-[#1A2436]' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}
              title="Refresh readiness"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${readinessLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {readinessError ? (
          <div className="text-rose-500 text-[11px]">Could not load DR readiness: {readinessError}</div>
        ) : checks.length === 0 ? (
          <div className={`text-[11px] ${muted} ${readinessLoading ? 'animate-pulse' : ''}`}>
            {readinessLoading ? 'Evaluating readiness…' : 'No readiness checks returned.'}
          </div>
        ) : (
          <div className="space-y-4">
            {(['core', 'capacity'] as const).map(group => {
              const list = checks.filter(c => (c.group ?? 'core') === group);
              if (!list.length) return null;
              return (
                <div key={group} className="space-y-2">
                  <div className={`text-[10px] uppercase tracking-wider font-bold ${muted}`}>
                    {group === 'core' ? 'DR readiness checks (count toward READY)' : 'DR server capacity (telemetry agent — informational)'}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {list.map((chk, i) => (
                      <div key={chk.key} className={`p-3 rounded border space-y-1 ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{group === 'core' ? `${i + 1}. ` : ''}{chk.label}</span>
                          <span className={`text-[10px] font-bold ${readinessColor(chk.status)}`}>{chk.status.replace('_', ' ')}</span>
                        </div>
                        <p className={`text-[11px] font-sans break-words ${muted}`}>{chk.detail}</p>
                        <p className={`text-[10px] ${muted}`}>Data: <Ago iso={chk.observedAt} /></p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
};
