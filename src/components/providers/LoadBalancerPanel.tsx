import React, { useState } from 'react';
import { RefreshCw, KeyRound, Network } from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { LbPool, LbOrigin, LoadBalancerState } from '../../types';
import { Ago, triText, triColor } from '../ui/Freshness';

const STATUS_TEXT: Record<LoadBalancerState['status'], string> = {
  OK: 'Live',
  PENDING: 'Waiting for first sync',
  NOT_CONFIGURED: 'Not configured',
  PERMISSION_REQUIRED: 'Cloudflare permission required',
  ERROR: 'Check failed',
};

export function originHealthy(o: LbOrigin): boolean | null {
  const known = o.health.map(h => h.healthy).filter((x): x is boolean => x !== null);
  return known.length ? known.every(Boolean) : o.healthy;
}
export function originRtt(o: LbOrigin): number | null {
  const r = o.health.map(h => h.rttMs).filter((x): x is number => x !== null);
  return r.length ? Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 10) / 10 : null;
}

export const LbStatusBadge: React.FC<{ state: LoadBalancerState | null }> = ({ state }) => {
  const s = state?.status ?? 'PENDING';
  const tone = s === 'OK' ? 'text-emerald-500 border-emerald-500/40' : s === 'ERROR' ? 'text-rose-500 border-rose-500/40' : s === 'PERMISSION_REQUIRED' ? 'text-amber-500 border-amber-500/40' : 'text-slate-400 border-slate-500/40';
  return <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${tone}`}>{STATUS_TEXT[s]}</span>;
};

/** One Cloudflare pool with every field the API returned; unknown values say so. */
export const LbPoolCard: React.FC<{ pool: LbPool; isDark: boolean; active?: boolean | null; compact?: boolean }> = ({ pool, isDark, active, compact }) => {
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-0.5">
      <span className={muted}>{k}</span>
      <span className="text-right break-all">{v}</span>
    </div>
  );
  return (
    <div className={`p-3 rounded border text-[11px] font-mono space-y-2 ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-xs truncate">{pool.name || (pool.found ? '(unnamed pool)' : 'Pool not read')}</div>
          <div className={`text-[10px] ${muted}`}>{pool.role === 'PRD' ? 'Production / Primary' : 'Disaster Recovery / Standby'}</div>
        </div>
        <div className="text-right shrink-0">
          <div className={`font-bold ${pool.found ? triColor(pool.healthy) : 'text-slate-400'}`}>
            {pool.found ? triText(pool.healthy, 'HEALTHY', 'UNHEALTHY', 'HEALTH UNKNOWN') : 'NO DATA'}
          </div>
          {active !== undefined && (
            <div className={`text-[10px] ${active === true ? 'text-blue-400' : muted}`}>
              {active === true ? 'SERVING TRAFFIC' : active === false ? 'not serving' : 'routing unknown'}
            </div>
          )}
        </div>
      </div>
      {!compact && (
        <div className={`border-t pt-1.5 ${isDark ? 'border-[#1A2332]' : 'border-slate-200'}`}>
          {row('Pool ID', pool.id)}
          {row('Description', pool.description || (pool.found ? '—' : 'No data'))}
          {row('Enabled', <span className={triColor(pool.enabled)}>{triText(pool.enabled)}</span>)}
          {row('Healthy', <span className={triColor(pool.healthy)}>{triText(pool.healthy)}</span>)}
        </div>
      )}
      {pool.origins.length === 0 ? (
        <div className={muted}>{pool.found ? 'No origins in pool' : 'Origin state not available'}</div>
      ) : pool.origins.map(o => {
        const h = originHealthy(o);
        const rtt = originRtt(o);
        return (
          <div key={o.address} className={`border-t pt-1.5 ${isDark ? 'border-[#1A2332]' : 'border-slate-200'}`}>
            {row('Origin', <span className="font-semibold">{o.name ? `${o.name} · ` : ''}{o.address}</span>)}
            {row('Origin health', <span className={`font-bold ${triColor(h)}`}>{triText(h, 'Healthy', 'Unhealthy')}</span>)}
            {row('RTT', rtt === null ? <span className={muted}>No data</span> : `${rtt} ms`)}
            {!compact && row('Origin enabled', <span className={triColor(o.enabled)}>{triText(o.enabled)}</span>)}
            {!compact && row('Weight', o.weight ?? <span className={muted}>No data</span>)}
            {row('Failure reason', o.health.find(x => x.failureReason && x.healthy === false)?.failureReason ?? o.failureReason ?? o.health[0]?.failureReason ?? <span className={muted}>No data</span>)}
            {o.health.length > 0 && !compact && (
              <div className="mt-1 space-y-0.5">
                {o.health.map(ph => (
                  <div key={ph.pop} className={`flex justify-between text-[10px] ${muted}`}>
                    <span>PoP {ph.pop}</span>
                    <span>
                      <span className={triColor(ph.healthy)}>{triText(ph.healthy, 'healthy', 'unhealthy')}</span>
                      {' · '}{ph.rttMs === null ? 'rtt n/a' : `${ph.rttMs} ms`}
                      {' · '}{ph.responseCode === null ? 'HTTP n/a' : `HTTP ${ph.responseCode}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className={`text-[10px] ${muted} flex justify-between gap-2`}>
        <span>Pool list: <Ago iso={pool.listFetchedAt} staleAfterSec={300} /></span>
        <span>Health: <Ago iso={pool.healthFetchedAt} staleAfterSec={300} missing={pool.healthError ? 'Check failed' : 'No data'} /></span>
      </div>
      {pool.healthError && <div className="text-[10px] text-rose-500 break-words">{pool.healthError}</div>}
    </div>
  );
};

/** Full Load Balancer section: account, sync state, routing and both pools. */
export const LoadBalancerPanel: React.FC<{ appId?: string }> = ({ appId }) => {
  const { loadBalancer, syncLoadBalancers, theme, applications } = useOps();
  const { hasRole } = useAuth();
  const isDark = theme === 'dark';
  const [busy, setBusy] = useState(false);
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const pools = (loadBalancer?.pools ?? []).filter(p => !appId || p.applicationId === appId);
  const apps = applications.filter(a => a.loadBalancer && (!appId || a.id === appId));

  return (
    <div className={`rounded-lg border p-4 space-y-3 font-mono text-xs ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-orange-500" />
          <h2 className="text-xs font-bold uppercase tracking-wider">Cloudflare Load Balancing</h2>
          <LbStatusBadge state={loadBalancer} />
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] ${muted}`}>Last sync <Ago iso={loadBalancer?.lastSyncAt} missing="never" /> · last success <Ago iso={loadBalancer?.lastSuccessAt} missing="never" /></span>
          {hasRole('operator') && (
            <button
              onClick={async () => { setBusy(true); try { await syncLoadBalancers(); } finally { setBusy(false); } }}
              disabled={busy}
              className={`p-1 rounded border cursor-pointer disabled:opacity-60 ${isDark ? 'border-[#1E293B] text-slate-300 hover:bg-[#1A2436]' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}
              title="Read pools and pool health from Cloudflare now"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>
      <div className={`text-[11px] ${muted}`}>
        Account <span className={isDark ? 'text-slate-200' : 'text-slate-800'}>{loadBalancer?.accountId ?? apps[0]?.loadBalancer?.accountId ?? 'Not configured'}</span> · read-only (Scholario Ops never changes pools)
      </div>
      {loadBalancer && loadBalancer.status !== 'OK' && loadBalancer.lastError && (
        <div className={`p-2 rounded border text-[11px] flex gap-2 ${loadBalancer.status === 'PERMISSION_REQUIRED' ? 'border-amber-500/40 text-amber-500' : loadBalancer.status === 'ERROR' ? 'border-rose-500/40 text-rose-500' : `border-slate-500/40 ${muted}`}`}>
          <KeyRound className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="break-words">{loadBalancer.lastError}</span>
        </div>
      )}
      {apps.map(app => {
        const routing = loadBalancer?.routing.find(r => r.hostname === app.loadBalancer!.hostname);
        const name = (id: string) => pools.find(p => p.id === id)?.name || id;
        return (
          <div key={app.id} className={`text-[11px] p-2 rounded border ${isDark ? 'border-[#1A2436]' : 'border-slate-200'}`}>
            <span className="font-bold">{app.loadBalancer!.hostname}</span>{' '}
            {!routing ? <span className={muted}>· routing not read</span>
              : routing.found ? (
                <span className={muted}>
                  · steering {routing.steeringPolicy ?? 'default'} · pool order {routing.defaultPools.map(name).join(' → ') || '—'} · fallback {routing.fallbackPool ? name(routing.fallbackPool) : '—'} ·{' '}
                  serving <span className={routing.activePoolId ? 'text-blue-400 font-semibold' : ''}>{routing.activePoolId ? name(routing.activePoolId) : 'unknown'}</span> · <Ago iso={routing.fetchedAt} />
                </span>
              ) : <span className="text-amber-500">· routing: {routing.error ?? 'not found'}</span>}
          </div>
        );
      })}
      {pools.length === 0 ? (
        <div className={muted}>No pools mapped.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {pools.map(p => {
            const routing = loadBalancer?.routing.find(r => apps.find(a => a.id === p.applicationId)?.loadBalancer?.hostname === r.hostname);
            const active = routing?.found ? (routing.activePoolId ? routing.activePoolId === p.id : null) : undefined;
            return <LbPoolCard key={`${p.applicationId}-${p.id}`} pool={p} isDark={isDark} active={active} />;
          })}
        </div>
      )}
    </div>
  );
};
