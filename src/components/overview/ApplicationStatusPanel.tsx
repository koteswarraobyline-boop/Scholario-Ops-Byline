import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import { api, ApplicationAvailability, DatabaseHealthRow, DrReadiness } from '../../services/api';
import { Application, Monitor, OperationalStatus, VpsServer, LbPool } from '../../types';
import { Ago, triText, triColor, verdictColor } from '../ui/Freshness';
import { originHealthy, originRtt } from '../providers/LoadBalancerPanel';
import { effectiveRoutingMethod, ROUTING_METHOD_LABELS } from '../../lib/trafficHealth';
import { ExpandToggle, InventoryFilters, matchesQuery, useExpandSet } from '../ui/InventoryFilters';

type Env = 'PRD' | 'DR';

/**
 * Live per-application health (Production, and DR only when configured).
 * Every application is listed — not a single ICT pair. Missing data stays missing.
 */
export const ApplicationStatusPanel: React.FC = () => {
  const { applications, servers, theme } = useOps();
  const isDark = theme === 'dark';
  const [search, setSearch] = useState('');
  const [chip, setChip] = useState('ALL');
  const st = useMemo(() => ({
    isDark,
    input: `w-full px-2.5 py-1.5 rounded border text-xs font-mono outline-none focus:ring-1 focus:ring-blue-500 ${
      isDark ? 'bg-[#0B0F17] border-[#1E293B] text-slate-100 placeholder:text-slate-600' : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400'
    }`,
    btn: 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-semibold transition-colors cursor-pointer',
    ghost: isDark ? 'bg-[#162033] hover:bg-[#1D2B44] text-slate-200 border border-[#23334E]' : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300',
    muted: isDark ? 'text-slate-400' : 'text-slate-600',
    faint: isDark ? 'text-slate-500' : 'text-slate-400',
  }), [isDark]);

  const chips = useMemo(() => {
    const n = (pred: (a: Application) => boolean) => applications.filter(pred).length;
    return [
      { id: 'ALL', label: 'All', count: applications.length },
      { id: 'HEALTHY', label: 'Healthy', count: n(a => a.status === 'HEALTHY') },
      { id: 'PROBLEM', label: 'Warning / critical', count: n(a => a.status === 'WARNING' || a.status === 'CRITICAL') },
      { id: 'HAS_DR', label: 'With DR', count: n(a => Boolean(a.drServerId || a.drUrl)) },
      { id: 'NO_DR', label: 'PRD-only', count: n(a => !a.drServerId && !a.drUrl) },
    ];
  }, [applications]);

  const filtered = useMemo(() => applications.filter(a => {
    if (chip === 'HEALTHY' && a.status !== 'HEALTHY') return false;
    if (chip === 'PROBLEM' && a.status !== 'WARNING' && a.status !== 'CRITICAL') return false;
    if (chip === 'HAS_DR' && !(a.drServerId || a.drUrl)) return false;
    if (chip === 'NO_DR' && (a.drServerId || a.drUrl)) return false;
    const prd = servers.find(s => s.id === a.prdServerId);
    const dr = servers.find(s => s.id === a.drServerId);
    return matchesQuery(search, [a.name, a.codeName, a.prdUrl, a.drUrl, prd?.hostname, prd?.ip, dr?.hostname, dr?.ip]);
  }).sort((a, b) => a.name.localeCompare(b.name)), [applications, servers, chip, search]);

  const ids = useMemo(() => filtered.map(a => a.id), [filtered]);
  // With many apps, start collapsed so overview stays scannable
  const expand = useExpandSet(ids, false);

  if (applications.length === 0) return null;
  return (
    <section className="space-y-3 min-w-0" aria-label="Application health">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-bold font-mono uppercase tracking-wider">Applications — live</h2>
        <p className={`text-[11px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
          {applications.length} registered · DR shown only when configured · expand a row for detail
        </p>
      </div>
      <InventoryFilters
        st={st}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search application, URL, server…"
        chips={chips}
        chip={chip}
        onChip={setChip}
        shown={filtered.length}
        total={applications.length}
        expand={{ allOpen: expand.allOpen, onExpandAll: expand.expandAll, onCollapseAll: expand.collapseAll }}
        ariaLabel="Filter live applications"
      />
      {filtered.length === 0 ? (
        <div className={`text-xs font-mono ${st.muted}`}>No applications match these filters.</div>
      ) : filtered.map(app => (
        <AppPanel key={app.id} app={app} open={expand.isOpen(app.id)} onToggle={() => expand.toggle(app.id)} />
      ))}
    </section>
  );
};

const drConfigured = (app: Application) => Boolean(app.drServerId || app.drUrl || app.loadBalancer?.drPoolId);

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

const AppPanel: React.FC<{ app: Application; open: boolean; onToggle: () => void }> = ({ app, open, onToggle }) => {
  const { servers, monitors, loadBalancer, theme } = useOps();
  const navigate = useNavigate();
  const isDark = theme === 'dark';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const [avail, setAvail] = useState<ApplicationAvailability | null>(null);
  const [availErr, setAvailErr] = useState<string | null>(null);
  const [dbRows, setDbRows] = useState<DatabaseHealthRow[] | null>(null);
  const [ready, setReady] = useState<DrReadiness | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () => {
      api.getAvailability(app.id, '24h')
        .then(a => { if (alive) { setAvail(a); setAvailErr(null); } })
        .catch(e => { if (alive) setAvailErr(e instanceof Error ? e.message : 'Check failed'); });
      // Database + readiness are evaluated by the server; a failure leaves the row "unknown", never green
      api.getDatabaseHealth().then(r => { if (alive) setDbRows(r.filter(x => x.applicationId === app.id)); }).catch(() => { if (alive) setDbRows(null); });
      api.getDrReadiness(app.id).then(r => { if (alive) setReady(r); }).catch(() => { if (alive) setReady(null); });
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [app.id, open]);

  const env = (e: Env) => {
    const srv = servers.find(s => s.id === (e === 'PRD' ? app.prdServerId : app.drServerId));
    const http = monitors.find(m => m.enabled && m.applicationId === app.id && m.environment === e && ['HTTP', 'HTTPS', 'APP_HEALTH'].includes(m.type));
    const poolId = !app.loadBalancer ? '' : e === 'PRD' ? app.loadBalancer.prdPoolId : app.loadBalancer.drPoolId;
    const pool = poolId ? loadBalancer?.pools.find(p => p.id === poolId && p.applicationId === app.id) : undefined;
    return { srv, http, pool, verdict: envVerdict(http, pool, srv), stats: avail?.environments.find(x => x.environment === e) };
  };
  const prd = env('PRD');
  const dr = env('DR');
  const hasDr = drConfigured(app);
  const answer = prd.verdict.status === 'CRITICAL' ? 'No — Production is DOWN'
    : !hasDr
      ? (prd.verdict.status === 'HEALTHY' ? 'Yes — Production is up' : prd.verdict.status === 'UNKNOWN' ? 'Not enough live data to say' : 'Degraded')
      : prd.verdict.status === 'HEALTHY' && dr.verdict.status === 'HEALTHY' ? 'Yes — Production and DR are up'
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
      <div className={`p-3 rounded-lg border space-y-2 text-[11px] font-mono min-w-0 ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`}>
        <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
          <div className="min-w-0 break-words">
            <div className="text-xs font-bold">{label}</div>
            <div className={muted}>{srv ? srv.ip : 'No server linked'}{srv?.provider ? ` · ${srv.provider}` : ''}{srv?.region ? ` · ${srv.region}` : ''}</div>
            <div className={muted}>{plan ? `${plan.name} · ${plan.cpuCores} Core · ${plan.ramGb} GB RAM · ${plan.diskGb} GB disk` : 'Plan not available'}</div>
          </div>
          <div className="text-right min-w-0 max-w-full sm:max-w-[16rem]">
            <div className={`text-sm font-bold ${verdictColor(verdict.status)}`}>{verdict.status}</div>
            <div className={`text-[10px] break-words ${muted}`}>{verdict.why}</div>
          </div>
        </div>

        <div className={`grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-3 gap-y-2 pt-2 border-t [&>*]:min-w-0 [&>*]:break-words ${isDark ? 'border-[#1A2332]' : 'border-slate-200'}`}>
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

        <EnvStatusLines label={label.startsWith('Production') ? 'PRD' : 'DR'} srv={srv} http={http} db={dbRows?.find(r => r.environment === (label.startsWith('Production') ? 'PRD' : 'DR'))} ready={ready} isDark={isDark} />

        <div className={`grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-2 pt-2 border-t text-[10px] [&>*]:min-w-0 [&>*]:break-words ${isDark ? 'border-[#1A2332]' : 'border-slate-200'} ${muted}`}>
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

  const summaryCls = prd.verdict.status === 'HEALTHY' && (!hasDr || dr.verdict.status === 'HEALTHY') ? 'text-emerald-500' : prd.verdict.status === 'CRITICAL' ? 'text-rose-500' : 'text-amber-500';

  return (
    <div className={`rounded-xl border min-w-0 overflow-hidden ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
      <div className={`flex items-center gap-2 px-4 py-3 ${isDark ? 'hover:bg-[#0B0F17]' : 'hover:bg-slate-50'}`}>
        <ExpandToggle open={open} onClick={onToggle} label={app.name} className={muted} />
        <button type="button" onClick={onToggle} className="flex-1 min-w-0 text-left cursor-pointer">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-xs font-bold font-mono uppercase tracking-wider break-words">{app.name}</h2>
              <p className={`text-[11px] font-mono truncate ${muted}`}>
                <span className={`font-bold ${verdictColor(app.status)}`}>{app.status}</span>
                {' · '}{ROUTING_METHOD_LABELS[effectiveRoutingMethod(app)]}
                {prd.srv ? ` · PRD ${prd.srv.hostname}` : ''}
                {hasDr && dr.srv ? ` · DR ${dr.srv.hostname}` : ' · PRD-only'}
              </p>
            </div>
            <div className={`text-sm font-bold font-mono shrink-0 ${summaryCls}`}>{answer}</div>
          </div>
        </button>
      </div>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className={`grid grid-cols-1 ${hasDr ? 'xl:grid-cols-2' : ''} gap-3 [&>*]:min-w-0`}>
            {card('Production / Primary', prd)}
            {hasDr && card('Disaster Recovery / Standby', dr)}
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] font-mono">
            <button onClick={() => navigate('/resilience')} className="text-blue-400 hover:underline cursor-pointer">PRD / DR Readiness & failover pre-flight →</button>
            <button onClick={() => navigate('/cloudflare')} className="text-blue-400 hover:underline cursor-pointer">Cloudflare pools →</button>
            <button onClick={() => navigate('/infrastructure')} className="text-blue-400 hover:underline cursor-pointer">VPS telemetry →</button>
          </div>
        </div>
      )}
    </div>
  );
};

/** Agent · App · DB · Services · Readiness for one environment. Every value comes from the server. */
const EnvStatusLines: React.FC<{ label: Env; srv: VpsServer | undefined; http: Monitor | undefined; db: DatabaseHealthRow | undefined; ready: DrReadiness | null; isDark: boolean }> = ({ label, srv, http, db, ready, isDark }) => {
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const agent = !srv ? 'No server' : !srv.lastSeen ? 'NOT CONNECTED' : srv.agent?.outdated && srv.agentStatus === 'CONNECTED' ? 'CONNECTED (outdated)' : srv.agentStatus;
  const agentCls = !srv || !srv.lastSeen ? 'text-slate-400' : srv.agentStatus === 'CONNECTED' ? (srv.agent?.outdated ? 'text-amber-500' : 'text-emerald-500') : srv.agentStatus === 'STALE' ? 'text-amber-500' : 'text-rose-500';
  const appStatus = !http ? 'NOT CONFIGURED' : !http.lastCheck ? 'UNKNOWN' : http.status === 'HEALTHY' ? 'HEALTHY' : http.status === 'CRITICAL' ? 'DOWN' : http.status;
  const local = srv?.appHealth?.find(c => c.environment === label) ?? srv?.appHealth?.[0];
  const failed = srv?.services.filter(s => s.status === 'failed').length ?? 0;
  const svcText = !srv?.lastSeen ? 'UNKNOWN' : srv.services.length || srv.failedUnits ? `${failed} failed` : 'none watched';
  const svcCls = !srv?.lastSeen || (!srv.services.length && !srv.failedUnits) ? 'text-slate-400' : failed ? 'text-rose-500' : 'text-emerald-500';
  // PRD: its 3 core checks; DR: the overall DR readiness (13 core checks)
  const prdChecks = ready?.checks.filter(c => c.group !== 'capacity' && c.key.startsWith('prd_')) ?? [];
  const readyText = !ready ? 'UNKNOWN' : label === 'DR' ? `${ready.overall} (${ready.passed}/${ready.total})`
    : prdChecks.some(c => c.status === 'FAIL') ? `FAIL (${prdChecks.filter(c => c.status === 'PASS').length}/${prdChecks.length} checks)`
      : `${prdChecks.every(c => c.status === 'PASS') ? 'PASS' : 'PARTIAL'} (${prdChecks.filter(c => c.status === 'PASS').length}/${prdChecks.length} checks)`;
  const readyCls = verdictColor(!ready ? 'UNKNOWN' : label === 'DR' ? ready.overall : prdChecks.some(c => c.status === 'FAIL') ? 'FAIL' : prdChecks.every(c => c.status === 'PASS') ? 'PASS' : 'WARNING');
  // Label above value: cells never share a line, so a long value can only wrap inside its own cell
  const row = (k: string, v: React.ReactNode, cls: string, sub?: React.ReactNode) => (
    <div className="min-w-0">
      <div className={`text-[10px] uppercase tracking-wider ${muted}`}>{k}</div>
      <div className={`font-semibold break-words ${cls}`}>{v}</div>
      {sub && <div className={`text-[10px] break-words ${muted}`}>{sub}</div>}
    </div>
  );
  return (
    <div className={`grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-x-3 gap-y-2 pt-2 border-t text-[11px] ${isDark ? 'border-[#1A2332]' : 'border-slate-200'}`}>
      {row('Agent', agent, agentCls)}
      {row('App', appStatus, verdictColor(appStatus), local ? <>local {local.status}{local.latencyMs != null ? ` · ${local.latencyMs} ms` : ''}</> : undefined)}
      {row('DB', db ? db.status.replace('_', ' ') : 'UNKNOWN', verdictColor(db?.status ?? 'UNKNOWN'))}
      {row('Services', svcText, svcCls)}
      {row('Readiness', readyText, readyCls)}
    </div>
  );
};
