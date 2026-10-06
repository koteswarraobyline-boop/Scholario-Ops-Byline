import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import { api, ApplicationAvailability } from '../../services/api';
import { Application, Monitor, OperationalStatus, VpsServer, LbPool } from '../../types';
import { Ago, triText, triColor, verdictColor } from '../ui/Freshness';
import { originHealthy, originRtt } from '../providers/LoadBalancerPanel';

type Env = 'PRD' | 'DR';

/**
 * Live answer to "is the real Production and DR infrastructure healthy right now?"
 * for every application mapped to a Cloudflare Load Balancer (ICT). Every value
 * comes from the backend; missing data is shown as missing.
 */
export const IctStatusPanel: React.FC = () => {
  const { applications } = useOps();
  const apps = applications.filter(a => a.loadBalancer);
  if (apps.length === 0) return null;
  return <>{apps.map(app => <AppPanel key={app.id} app={app} />)}</>;
};

function envVerdict(http: Monitor | undefined, pool: LbPool | undefined, srv: VpsServer | undefined): { status: OperationalStatus; why: string } {
  const origin = pool?.origins.find(o => o.address === srv?.ip) ?? pool?.origins[0];
  const oh = origin ? originHealthy(origin) : null;
  if (!http || !http.lastCheck) return { status: 'UNKNOWN', why: 'Application not checked yet' };
  if (http.status === 'CRITICAL') return { status: 'CRITICAL', why: `Application DOWN (${http.lastProbeStatus})${oh === false ? ' and Cloudflare origin unhealthy' : ''}` };
  if (oh === false) return { status: 'CRITICAL', why: 'Cloudflare reports the origin unhealthy' };
  if (http.status === 'WARNING') return { status: 'WARNING', why: http.history[0]?.detail ?? 'Degraded' };
  if (http.status === 'HEALTHY') return { status: 'HEALTHY', why: oh === true ? 'Application up and Cloudflare origin healthy' : 'Application up · Cloudflare origin health not available' };
  return { status: http.status, why: http.history[0]?.detail ?? '' };
}

const AppPanel: React.FC<{ app: Application }> = ({ app }) => {
  const { servers, monitors, loadBalancer, theme } = useOps();
  const navigate = useNavigate();
  const isDark = theme === 'dark';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const [avail, setAvail] = useState<ApplicationAvailability | null>(null);
  const [availErr, setAvailErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => api.getAvailability(app.id, '24h')
      .then(a => { if (alive) { setAvail(a); setAvailErr(null); } })
      .catch(e => { if (alive) setAvailErr(e instanceof Error ? e.message : 'Check failed'); });
    void load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [app.id]);

  const env = (e: Env) => {
    const srv = servers.find(s => s.id === (e === 'PRD' ? app.prdServerId : app.drServerId));
    const http = monitors.find(m => m.enabled && m.applicationId === app.id && m.environment === e && ['HTTP', 'HTTPS', 'APP_HEALTH'].includes(m.type));
    const poolId = e === 'PRD' ? app.loadBalancer!.prdPoolId : app.loadBalancer!.drPoolId;
    const pool = loadBalancer?.pools.find(p => p.id === poolId && p.applicationId === app.id);
    return { srv, http, pool, verdict: envVerdict(http, pool, srv), stats: avail?.environments.find(x => x.environment === e) };
  };
  const prd = env('PRD');
  const dr = env('DR');
  const answer = prd.verdict.status === 'HEALTHY' && dr.verdict.status === 'HEALTHY' ? 'Yes — Production and DR are up'
    : prd.verdict.status === 'CRITICAL' ? 'No — Production is DOWN'
      : dr.verdict.status === 'CRITICAL' ? 'Production is up · DR is DOWN'
        : prd.verdict.status === 'UNKNOWN' || dr.verdict.status === 'UNKNOWN' ? 'Not enough live data to say'
          : 'Degraded';

  const card = (label: string, e: ReturnType<typeof env>) => {
    const { srv, http, pool, verdict, stats } = e;
    const origin = pool?.origins.find(o => o.address === srv?.ip) ?? pool?.origins[0];
    const oh = origin ? originHealthy(origin) : null;
    const rtt = origin ? originRtt(origin) : null;
    const plan = srv?.planSpec;
    const live = srv?.agentStatus === 'CONNECTED';
    const t = srv?.telemetry;
    return (
      <div className={`p-3 rounded-lg border space-y-2 text-[11px] font-mono ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs font-bold">{label}</div>
            <div className={muted}>{srv ? srv.ip : 'No server linked'}{srv?.provider ? ` · ${srv.provider}` : ''}{srv?.region ? ` · ${srv.region}` : ''}</div>
            <div className={muted}>{plan ? `${plan.name} · ${plan.cpuCores} Core · ${plan.ramGb} GB RAM · ${plan.diskGb} GB disk` : 'Plan not available'}</div>
          </div>
          <div className="text-right">
            <div className={`text-sm font-bold ${verdictColor(verdict.status)}`}>{verdict.status}</div>
            <div className={`text-[10px] max-w-[220px] ${muted}`}>{verdict.why}</div>
          </div>
        </div>

        <div className={`grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t ${isDark ? 'border-[#1A2332]' : 'border-slate-200'}`}>
          <div>
            <div className={muted}>Application (HTTPS)</div>
            {http?.lastCheck ? (
              <>
                <div className={`font-bold ${verdictColor(http.lastProbeStatus)}`}>{http.lastProbeStatus ?? http.status}{http.lastStatusCode ? ` · HTTP ${http.lastStatusCode}` : ''}</div>
                <div>{http.history[0]?.status === 'HEALTHY' || http.history[0]?.status === 'WARNING' ? `${http.history[0].responseTimeMs} ms` : 'no response time'}</div>
                <div className={muted}><Ago iso={http.lastCheck} staleAfterSec={http.intervalSec * 3} /></div>
              </>
            ) : <div className={muted}>{http ? 'Not checked yet' : 'No monitor'}</div>}
          </div>
          <div>
            <div className={muted}>Cloudflare pool</div>
            {pool?.found ? (
              <>
                <div className="font-bold">{pool.name}</div>
                <div>pool <span className={triColor(pool.healthy)}>{triText(pool.healthy, 'healthy', 'unhealthy')}</span> · origin <span className={triColor(oh)}>{triText(oh, 'healthy', 'unhealthy')}</span></div>
                <div>{origin?.address ?? '—'} · RTT {rtt === null ? 'no data' : `${rtt} ms`}</div>
                <div className={muted}><Ago iso={pool.healthFetchedAt ?? pool.listFetchedAt} staleAfterSec={300} /></div>
              </>
            ) : (
              <div className={loadBalancer?.status === 'PERMISSION_REQUIRED' ? 'text-amber-500' : muted}>
                {loadBalancer?.status === 'NOT_CONFIGURED' ? 'Not configured' : loadBalancer?.status === 'PERMISSION_REQUIRED' ? 'Cloudflare permission required' : loadBalancer?.status === 'ERROR' ? 'Check failed' : 'No data'}
              </div>
            )}
          </div>
          <div>
            <div className={muted}>VPS telemetry</div>
            {live && t ? (
              <>
                <div>CPU <b>{t.cpuPercent}%</b> · RAM <b>{t.ramPercent}%</b> · Disk <b>{t.diskPercent}%</b></div>
                <div className={muted}>load {t.loadAvg.map(l => l.toFixed(2)).join(' / ')}</div>
                <div className={muted}><Ago iso={t.observedAt} staleAfterSec={60} /></div>
              </>
            ) : (
              <div className={srv?.lastSeen ? 'text-amber-500' : muted}>
                {!srv ? 'No server' : srv.lastSeen ? <>Agent {srv.agentStatus} — last report <Ago iso={srv.lastSeen} /></> : 'Not connected (agent not installed)'}
              </div>
            )}
          </div>
        </div>

        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t text-[10px] ${isDark ? 'border-[#1A2332]' : 'border-slate-200'} ${muted}`}>
          <div>
            Application availability (24h, observed):{' '}
            {availErr ? <span className="text-rose-500">Check failed</span>
              : !stats ? 'loading…'
                : stats.application.availabilityPercent === null ? 'No data'
                  : <b className={isDark ? 'text-slate-200' : 'text-slate-800'}>{stats.application.availabilityPercent}% of {stats.application.total} checks</b>}
          </div>
          <div>
            Cloudflare origin health (24h):{' '}
            {!stats ? '—' : !stats.cloudflareOrigin || stats.cloudflareOrigin.availabilityPercent === null ? 'No data'
              : <b className={isDark ? 'text-slate-200' : 'text-slate-800'}>{stats.cloudflareOrigin.availabilityPercent}% of {stats.cloudflareOrigin.total} samples</b>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-bold font-mono uppercase tracking-wider">{app.name} application — live</h2>
          <p className={`text-[11px] font-mono ${muted}`}>{app.loadBalancer!.hostname} · Cloudflare Load Balancer · {app.prdUrl ?? ''}</p>
        </div>
        <div className="text-right">
          <div className={`text-[10px] font-mono ${muted}`}>Is {app.name} healthy right now?</div>
          <div className={`text-sm font-bold font-mono ${prd.verdict.status === 'HEALTHY' && dr.verdict.status === 'HEALTHY' ? 'text-emerald-500' : prd.verdict.status === 'CRITICAL' ? 'text-rose-500' : 'text-amber-500'}`}>{answer}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {card('Production / Primary', prd)}
        {card('Disaster Recovery / Standby', dr)}
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] font-mono">
        <button onClick={() => navigate('/resilience')} className="text-blue-400 hover:underline cursor-pointer">DR readiness & failover pre-flight →</button>
        <button onClick={() => navigate('/cloudflare')} className="text-blue-400 hover:underline cursor-pointer">Cloudflare pools →</button>
        <button onClick={() => navigate('/infrastructure')} className="text-blue-400 hover:underline cursor-pointer">VPS telemetry →</button>
      </div>
    </div>
  );
};
