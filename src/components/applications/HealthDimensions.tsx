import React from 'react';
import { Application, CloudflareZone, LoadBalancerState, Monitor, VpsServer, WorkerMonitorState } from '../../types';
import { explainApplication, explainRouting, explainVps, ROUTING_METHOD_LABELS } from '../../lib/trafficHealth';

const tone = (status: string) =>
    status === 'HEALTHY' || status === 'PRD' ? 'text-emerald-500'
    : status === 'WARNING' ? 'text-amber-500'
      : status === 'CRITICAL' ? 'text-rose-500'
        : 'text-slate-400';

const Cell: React.FC<{ title: string; status: string; detail: string; at: string | null; source: string; isDark: boolean }> = ({ title, status, detail, at, source, isDark }) => (
  <div className={`p-3 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'}`}>
    <div className={`text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{title}</div>
    <div className={`font-bold mt-0.5 ${tone(status)}`}>{status.replace(/_/g, ' ')}</div>
    <p className={`mt-1 text-[11px] font-sans leading-snug ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{detail}</p>
    <p className={`mt-1 text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
      {source}{at ? ` · ${new Date(at).toLocaleString()}` : ' · no successful check yet'}
    </p>
  </div>
);

export const HealthDimensions: React.FC<{
  application: Application;
  servers: VpsServer[];
  monitors: Monitor[];
  zones: CloudflareZone[];
  loadBalancer: LoadBalancerState | null;
  cloudflareConfigured: boolean;
  workerMonitor: WorkerMonitorState | null;
  isDark: boolean;
}> = ({ application, servers, monitors, zones, loadBalancer, cloudflareConfigured, workerMonitor, isDark }) => {
  const prd = servers.find(s => s.id === application.prdServerId);
  const dr = servers.find(s => s.id === application.drServerId);
  const worker = workerMonitor?.apps.find(a => a.applicationId === application.id) ?? null;
  const routing = explainRouting({
    app: application,
    servers,
    cloudflareConfigured,
    zones,
    lb: loadBalancer,
    worker,
    events: (workerMonitor?.events ?? []).filter(e => e.applicationId === application.id),
    eventsConnected: workerMonitor?.eventsConnected ?? false,
  });
  const vpsPrd = explainVps(prd);
  const vpsDr = explainVps(dr);
  const appPrd = explainApplication(application, 'PRD', monitors);
  const appDr = explainApplication(application, 'DR', monitors);
  return (
    <div className="space-y-3">
      <div className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Health dimensions</div>
      <p className={`text-[11px] font-sans ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
        VPS health is the agent on the machine. Application health is the URL and TLS checks. Routing health follows {ROUTING_METHOD_LABELS[routing.method]}. One of these being unknown does not change the others.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Cell title="PRD application" status={appPrd.status} detail={appPrd.detail} at={appPrd.observedAt} source={appPrd.source} isDark={isDark} />
        <Cell title="DR application" status={appDr.status} detail={appDr.detail} at={appDr.observedAt} source={appDr.source} isDark={isDark} />
        <Cell title="PRD VPS" status={vpsPrd.status} detail={vpsPrd.detail} at={vpsPrd.observedAt} source={vpsPrd.source} isDark={isDark} />
        <Cell title="DR VPS" status={vpsDr.status} detail={vpsDr.detail} at={vpsDr.observedAt} source={vpsDr.source} isDark={isDark} />
        <Cell title="Traffic routing" status={routing.status} detail={routing.detail} at={routing.observedAt} source={routing.source} isDark={isDark} />
        <Cell
          title="Current origin"
          status={routing.currentOriginKnown ? routing.currentOrigin : 'UNKNOWN'}
          detail={routing.currentOriginKnown ? `Serving ${routing.currentOrigin}.` : `Origin selection is ${routing.currentOrigin}.`}
          at={routing.observedAt}
          source={routing.source}
          isDark={isDark}
        />
      </div>
      <div className={`text-[11px] font-sans ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
        Method: <b>{routing.methodLabel}</b>
        {' · '}Failback: {routing.failback} ({routing.failbackSource})
        {' · '}Last failover: {application.lastFailoverAt ? new Date(application.lastFailoverAt).toLocaleString() : 'none recorded'}
        {' · '}PRD routing health: {routing.prdHealth.status}
        {' · '}DR routing health: {routing.drHealth.status}
      </div>
      {routing.warnings.length > 0 && (
        <ul className="text-[11px] text-amber-500 font-sans list-disc pl-4">
          {routing.warnings.map(w => <li key={w}>{w}</li>)}
        </ul>
      )}
      {routing.recentEvents.length > 0 && (
        <div>
          <div className={`text-[10px] uppercase mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Routing events</div>
          <ul className="space-y-1">
            {routing.recentEvents.slice(0, 5).map(e => (
              <li key={`${e.at}-${e.kind}-${e.detail}`} className={`text-[11px] font-sans ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                {new Date(e.at).toLocaleString()} · {e.kind} · {e.detail} · {e.source}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
