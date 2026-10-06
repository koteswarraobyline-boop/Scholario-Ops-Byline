import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { Environment, OperationalStatus, VpsServer } from '../../types';
import { Globe, ShieldCheck, Server, RefreshCw, Network, Loader2, X } from 'lucide-react';
import { routeState } from '../ui/routing';

const parseTs = (iso?: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

const fmtWhen = (iso?: string | null) => {
  const t = parseTs(iso);
  return t === null ? '—' : new Date(t).toLocaleString();
};

const statusText = (s: OperationalStatus) =>
  s === 'HEALTHY' ? 'text-emerald-500' : s === 'WARNING' || s === 'STALE' ? 'text-amber-500' : s === 'CRITICAL' ? 'text-rose-500' : 'text-slate-400';

export const TrafficFlowChart: React.FC = () => {
  const { applications, servers, monitors, cloudflareZones, integrations, triggerFailover, theme, loadBalancer } = useOps();
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const isDark = theme === 'dark';
  const canFailover = hasRole('super_admin');

  const [selectedAppId, setSelectedAppId] = useState<string>('');
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const app = applications.find(a => a.id === selectedAppId) || applications[0];

  const shell = `rounded-lg border p-4 transition-colors ${
    isDark ? 'bg-[#111726] border-[#1E293B] text-slate-100' : 'bg-white border-[#E2E8F0] text-slate-900 shadow-xs'
  }`;

  if (!app) {
    return (
      <div className={shell}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded ${isDark ? 'bg-blue-950 text-blue-400 border border-blue-900' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <div className="font-semibold text-xs tracking-tight">Traffic &amp; Failover Routing</div>
              <p className={`text-[11px] font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                No applications registered. Register an application with its PRD/DR servers and Cloudflare DNS record in Setup.
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/setup')}
            className="px-3 py-1 text-xs font-mono font-semibold rounded bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
          >
            Open Setup
          </button>
        </div>
      </div>
    );
  }

  const route = routeState(app, loadBalancer);
  const routeUnknown = route === 'UNKNOWN';
  const isDrActive = route === 'DR';
  const isFailingOver = route === 'MOVING';
  const lbRouting = app.loadBalancer ? loadBalancer?.routing.find(r => r.hostname === app.loadBalancer!.hostname) : undefined;
  const lbPoolName = (id: string) => loadBalancer?.pools.find(x => x.id === id)?.name || id;
  const prdServer = servers.find(s => s.id === app.prdServerId);
  const drServer = servers.find(s => s.id === app.drServerId);
  const zone = cloudflareZones.find(z => z.domain === app.cloudflareZone);
  const dnsRecord = app.dnsRecordName ? zone?.dnsRecords.find(r => r.name === app.dnsRecordName) : undefined;
  const pointsAt: 'PRD' | 'DR' | 'OTHER' | null = dnsRecord
    ? dnsRecord.target === prdServer?.ip ? 'PRD' : dnsRecord.target === drServer?.ip ? 'DR' : 'OTHER'
    : null;

  const availability = (env: Environment) => {
    const list = monitors.filter(m => m.applicationId === app.id && m.environment === env && m.enabled);
    return { total: list.length, healthy: list.filter(m => m.status === 'HEALTHY').length, critical: list.filter(m => m.status === 'CRITICAL').length };
  };
  const prdAvail = availability('PRD');
  const drAvail = availability('DR');

  const target: 'DR' | 'PRIMARY' = isDrActive ? 'PRIMARY' : 'DR';
  const targetServer = target === 'DR' ? drServer : prdServer;
  const blocker = app.loadBalancer
    ? 'Routed by the Cloudflare Load Balancer — use the failover pre-flight on PRD / DR Readiness'
    : !integrations?.cloudflare.configured
    ? 'Cloudflare is not configured'
    : !app.cloudflareZone || !app.dnsRecordName
      ? 'No Cloudflare zone / DNS record set for this application'
      : !targetServer
        ? `No ${target === 'DR' ? 'DR' : 'PRD'} server linked`
        : isFailingOver
          ? 'A failover is already in progress'
          : null;

  const runFailover = async () => {
    setBusy(true);
    const ok = await triggerFailover(app.id, target, reason.trim() || undefined);
    setBusy(false);
    if (ok) { setConfirming(false); setReason(''); }
  };

  const tile = `p-3 rounded-lg border flex flex-col items-center text-center relative z-10 ${
    isDark ? 'bg-[#111726] border-[#1E2C44]' : 'bg-white border-slate-200 shadow-xs'
  }`;
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const cardClass = `p-2.5 rounded border ${isDark ? 'bg-[#0B0F17] border-[#1D283E]' : 'bg-slate-50 border-slate-200'}`;

  const renderOrigin = (env: 'PRD' | 'DR', srv: VpsServer | undefined, active: boolean, avail: { total: number; healthy: number; critical: number }) => {
    const routeLabel = routeUnknown ? 'ROUTING UNKNOWN' : active ? 'ACTIVE' : 'STANDBY';
    return (
    <div className={`p-2.5 rounded-lg border transition-all ${
      active
        ? env === 'PRD'
          ? (isDark ? 'bg-[#0E2018] border-emerald-600 ring-1 ring-emerald-500/40 text-emerald-300' : 'bg-emerald-50 border-emerald-400 text-emerald-950')
          : (isDark ? 'bg-[#221B0E] border-amber-500 ring-1 ring-amber-500/40 text-amber-200' : 'bg-amber-50 border-amber-400 text-amber-950')
        : (isDark ? 'bg-[#111726] border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600')
    }`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-xs font-mono flex items-center gap-1.5 min-w-0">
          <Server className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{env} · {srv ? srv.hostname : 'Not linked'}</span>
        </span>
        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold shrink-0 ${
          active ? (env === 'PRD' ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white') : (isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-600')
        }`}>
          {routeLabel}
        </span>
      </div>
      {srv ? (
        <>
          <div className="flex items-center justify-between text-[10px] font-mono mt-1 opacity-90 gap-2">
            <span>{srv.ip || '—'}</span>
            <span className="truncate">{srv.region || 'Region not set'}</span>
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono mt-0.5 gap-2">
            <span>Server: <span className={statusText(srv.status)}>{srv.status}</span></span>
            <span>Agent: {srv.agentStatus}</span>
          </div>
        </>
      ) : (
        <div className="text-[10px] font-mono mt-1 opacity-90">Link a {env} server to this application in Setup</div>
      )}
      <div className="text-[10px] font-mono mt-0.5">
        Monitors: {avail.total === 0 ? 'none configured' : `${avail.healthy}/${avail.total} healthy${avail.critical ? ` · ${avail.critical} critical` : ''}`}
      </div>
    </div>
    );
  };

  return (
    <div className={shell}>
      {/* Header and App Selector */}
      <div className={`flex flex-wrap items-center justify-between gap-3 pb-3 border-b ${isDark ? 'border-[#1E293B]' : 'border-slate-100'}`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`p-1.5 rounded ${isDark ? 'bg-blue-950 text-blue-400 border border-blue-900' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
            <Globe className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-xs tracking-tight">Traffic &amp; Failover Routing</span>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
                routeUnknown
                  ? (isDark ? 'bg-slate-900 text-slate-300 border border-slate-700' : 'bg-slate-100 text-slate-700 border border-slate-300')
                  : isFailingOver
                  ? (isDark ? 'bg-blue-950 text-blue-300 border border-blue-800' : 'bg-blue-100 text-blue-800 border border-blue-300')
                  : isDrActive
                    ? (isDark ? 'bg-amber-950 text-amber-300 border border-amber-800' : 'bg-amber-100 text-amber-800 border border-amber-300')
                    : (isDark ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-emerald-100 text-emerald-800 border border-emerald-300')
              }`}>
                {routeUnknown ? 'ROUTING UNKNOWN' : isFailingOver ? 'FAILOVER IN PROGRESS' : isDrActive ? 'DR ACTIVE' : 'PRIMARY ACTIVE'}
              </span>
            </div>
            <p className={`text-[11px] font-mono mt-0.5 ${muted}`}>
              Clients → Cloudflare DNS record → active origin (PRD or DR). Failover switches the DNS record between server IPs.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-mono ${muted}`}>App:</span>
          <select
            value={app.id}
            onChange={e => { setSelectedAppId(e.target.value); setConfirming(false); }}
            className={`text-xs font-mono px-2.5 py-1 rounded border outline-none cursor-pointer ${
              isDark ? 'bg-[#0B0F17] border-[#223048] text-slate-100 focus:border-blue-500' : 'bg-slate-50 border-slate-300 text-slate-800 focus:border-blue-500'
            }`}
          >
            {applications.map(a => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.failoverState === 'DR_ACTIVE' ? 'DR ACTIVE' : a.status})
              </option>
            ))}
          </select>

          {canFailover && !confirming && (
            <button
              onClick={() => setConfirming(true)}
              disabled={Boolean(blocker) || busy}
              title={blocker ?? `Switch ${app.dnsRecordName} to the ${target === 'DR' ? 'DR' : 'PRD'} server`}
              className={`px-3 py-1 text-xs font-mono rounded flex items-center gap-1.5 transition-colors border shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                isDrActive
                  ? (isDark ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-400' : 'bg-blue-600 hover:bg-blue-700 text-white border-blue-700')
                  : (isDark ? 'bg-rose-950 hover:bg-rose-900 text-rose-200 border-rose-800' : 'bg-rose-600 hover:bg-rose-700 text-white border-rose-700')
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{isDrActive ? 'Fail back to PRD' : 'Fail over to DR'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Inline failover confirmation */}
      {canFailover && confirming && (
        <div className={`mt-3 p-3 rounded-lg border font-mono text-xs space-y-2 ${
          isDark ? 'bg-rose-950/20 border-rose-900/60' : 'bg-rose-50 border-rose-200'
        }`}>
          <div className="font-semibold">
            Switch <span className="text-blue-400">{app.dnsRecordName}</span> from {isDrActive ? `DR (${drServer?.ip ?? '—'})` : `PRD (${prdServer?.ip ?? '—'})`} to{' '}
            {target === 'DR' ? `DR (${drServer?.ip ?? '—'})` : `PRD (${prdServer?.ip ?? '—'})`}?
          </div>
          <p className={muted}>This changes the live Cloudflare DNS record and notifies all channels.</p>
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Reason (recorded in the audit log)"
            disabled={busy}
            className={`w-full px-2.5 py-1.5 rounded border outline-none ${
              isDark ? 'bg-[#0B0F17] border-[#223048] text-slate-100 focus:border-blue-500' : 'bg-white border-slate-300 text-slate-800 focus:border-blue-500'
            }`}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={runFailover}
              disabled={busy}
              className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span>{busy ? 'Switching DNS…' : `Confirm ${target === 'DR' ? 'failover' : 'failback'}`}</span>
            </button>
            <button
              onClick={() => { setConfirming(false); setReason(''); }}
              disabled={busy}
              className={`px-3 py-1 rounded border flex items-center gap-1.5 cursor-pointer disabled:opacity-60 ${
                isDark ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <X className="w-3.5 h-3.5" />
              <span>Cancel</span>
            </button>
          </div>
        </div>
      )}

      {/* Routing topology */}
      <div className="py-3 w-full min-w-0">
        <div className={`w-full min-w-0 p-4 rounded-lg border overflow-x-auto ${
          isDark ? 'bg-[#070B12] border-[#182336]' : 'bg-[#F8FAFC] border-[#E2E8F0]'
        }`}>
          <div className="min-w-[760px] flex items-center justify-between relative py-2">
            {/* Stage 1: Clients */}
            <div className={`w-36 ${tile}`}>
              <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-500 flex items-center justify-center mb-1.5">
                <Globe className="w-4 h-4" />
              </div>
              <span className="font-semibold text-xs font-mono">Clients</span>
              <span className={`text-[10px] font-mono mt-0.5 break-all ${muted}`}>{app.loadBalancer?.hostname || app.dnsRecordName || 'No DNS record set'}</span>
            </div>

            <div className="flex-1 px-1.5">
              <svg className="w-full h-8" preserveAspectRatio="none" aria-hidden="true">
                <line x1="0" y1="16" x2="100%" y2="16" stroke="#3B82F6" strokeWidth="2.5" className="animate-flow-packet" />
              </svg>
            </div>

            {/* Stage 2: Cloudflare zone */}
            <div className={`w-48 ${tile}`}>
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-1.5">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <span className="font-semibold text-xs font-mono">Cloudflare Zone</span>
              <span className={`text-[10px] font-mono mt-0.5 ${muted}`}>{app.cloudflareZone || 'Not set'}</span>
              <span className={`text-[9px] font-mono mt-1 ${
                !integrations?.cloudflare.configured ? 'text-slate-400' : zone ? (zone.status === 'ACTIVE' ? 'text-emerald-400' : 'text-amber-400') : 'text-amber-400'
              }`}>
                {!integrations?.cloudflare.configured
                  ? 'Cloudflare not configured'
                  : zone ? `Zone ${zone.status}${zone.sslMode ? ` · SSL ${zone.sslMode}` : ''}` : 'Zone not found in account'}
              </span>
            </div>

            <div className="flex-1 px-1.5">
              <svg className="w-full h-8" preserveAspectRatio="none" aria-hidden="true">
                <line x1="0" y1="16" x2="100%" y2="16" stroke="#6366F1" strokeWidth="2.5" className="animate-flow-packet" />
              </svg>
            </div>

            {/* Stage 3: DNS record */}
            <div className={`w-48 ${tile}`}>
              <div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center mb-1.5">
                <Network className="w-4 h-4" />
              </div>
              <span className="font-semibold text-xs font-mono">{app.loadBalancer ? 'Load Balancer' : 'DNS Record'}</span>
              <span className={`text-[10px] font-mono mt-0.5 ${muted}`}>
                {app.loadBalancer
                  ? (lbRouting?.found ? `order ${lbRouting.defaultPools.map(lbPoolName).join(' → ')}` : lbRouting?.error ? 'Routing not readable' : `Cloudflare LB: ${(loadBalancer?.status ?? 'PENDING').replace('_', ' ')}`)
                  : dnsRecord ? `${dnsRecord.type} → ${dnsRecord.target}` : 'Record not synced'}
              </span>
              <span className={`text-[9px] font-mono mt-1 px-1.5 py-0.5 rounded font-semibold ${
                pointsAt === 'PRD' ? 'bg-emerald-500/15 text-emerald-400'
                  : pointsAt === 'DR' ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-slate-500/15 text-slate-400'
              }`}>
                {app.loadBalancer
                  ? (route === 'PRD' ? 'Serving PRD pool' : route === 'DR' ? 'Serving DR pool' : 'Serving pool unknown')
                  : pointsAt === 'PRD' ? 'Points at PRD' : pointsAt === 'DR' ? 'Points at DR' : pointsAt === 'OTHER' ? 'Points at unknown IP' : `State: ${app.failoverState.replace('_', ' ')}`}
                {!app.loadBalancer && dnsRecord ? (dnsRecord.proxied ? ' · proxied' : ' · DNS only') : ''}
              </span>
            </div>

            {/* Split connectors to origins */}
            <div className="w-12 flex flex-col items-center justify-center relative">
              <div className="h-28 w-full flex flex-col justify-between items-center py-2">
                <div className={`w-full border-t-2 ${route === 'PRD' ? 'border-emerald-500' : 'border-dashed border-slate-600'}`} />
                <div className={`w-full border-t-2 ${isDrActive ? 'border-amber-500' : 'border-dashed border-slate-600'}`} />
              </div>
            </div>

            {/* Stage 4: Origins */}
            <div className="w-64 space-y-2.5 z-10">
              {renderOrigin('PRD', prdServer, route === 'PRD', prdAvail)}
              {renderOrigin('DR', drServer, isDrActive, drAvail)}
            </div>
          </div>
        </div>
      </div>

      {/* Footer: configured targets and measured values */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-xs">
        <div className={cardClass}>
          <div className={`text-[10px] uppercase tracking-wider ${muted}`}>Replication Lag</div>
          <div className={`font-semibold text-sm mt-0.5 ${app.currentReplicationLagSec === null ? muted : app.currentReplicationLagSec > app.rpoTargetMin * 60 ? 'text-rose-500' : 'text-emerald-500'}`}>
            {app.currentReplicationLagSec === null ? 'No data' : `${app.currentReplicationLagSec}s`}
          </div>
          <div className={`text-[10px] mt-0.5 ${muted}`}>
            {app.currentReplicationLagSec === null ? 'Add a DB_REPLICATION monitor' : `RPO target ${app.rpoTargetMin}m`}
          </div>
        </div>

        <div className={cardClass}>
          <div className={`text-[10px] uppercase tracking-wider ${muted}`}>RTO / RPO Targets</div>
          <div className="font-semibold text-sm mt-0.5 text-blue-500">{app.rtoTargetMin}m / {app.rpoTargetMin}m</div>
          <div className={`text-[10px] mt-0.5 ${muted}`}>Configured objectives</div>
        </div>

        <div className={cardClass}>
          <div className={`text-[10px] uppercase tracking-wider ${muted}`}>Auto-Failover</div>
          <div className={`font-semibold text-sm mt-0.5 ${app.autoFailover ? 'text-emerald-500' : muted}`}>
            {app.autoFailover ? 'Enabled' : 'Disabled'}
          </div>
          <div className={`text-[10px] mt-0.5 ${muted}`}>
            {app.autoFailover ? 'On confirmed PRD failure if DR healthy' : 'Manual failover only'}
          </div>
        </div>

        <div className={cardClass}>
          <div className={`text-[10px] uppercase tracking-wider ${muted}`}>Last Failover</div>
          <div className="font-semibold text-sm mt-0.5 text-indigo-400">{app.lastFailoverAt ? fmtWhen(app.lastFailoverAt) : 'Never'}</div>
          <div className={`text-[10px] mt-0.5 ${muted}`}>
            {canFailover ? (blocker ?? 'Failover available') : 'Failover requires super_admin'}
          </div>
        </div>
      </div>
    </div>
  );
};
