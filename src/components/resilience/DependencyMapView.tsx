import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import { api } from '../../services/api';
import { Application, ImpactPreview, Monitor, VpsServer } from '../../types';
import { ArrowDown, RefreshCw } from 'lucide-react';
import { DependencyRegisterSection } from '../setup/DependencyRegister';
import { DependencyGraph, directNeighborhood } from './DependencyGraph';
import { DemoBanner, DemoScenarios, DemoToggle } from './DemoModeControls';
import { dnsPointsAt, routeState, servingLabel } from '../ui/routing';
import { useDependencyDemo } from '../../context/DependencyDemoContext';
import { demoComponents, demoDependencyLinks, simulateDemoFailure } from '../../mocks/dependencyDemoData';

type NodeRef = { kind: 'app' | 'server' | 'monitor'; id: string } | null;

const validDate = (s?: string | null) => Boolean(s) && !Number.isNaN(Date.parse(s as string));
const fmtDateTime = (s?: string | null, fallback = '—') => (validDate(s) ? new Date(s as string).toLocaleString() : fallback);

const statusText = (s: string) =>
  s === 'HEALTHY' ? 'text-emerald-500'
    : s === 'WARNING' || s === 'STALE' ? 'text-amber-500'
      : s === 'CRITICAL' ? 'text-rose-500'
        : s === 'MAINTENANCE' ? 'text-blue-500'
          : 'text-slate-400';
const statusDot = (s: string) =>
  s === 'HEALTHY' ? 'bg-emerald-500'
    : s === 'WARNING' || s === 'STALE' ? 'bg-amber-500'
      : s === 'CRITICAL' ? 'bg-rose-500 animate-pulse'
        : s === 'MAINTENANCE' ? 'bg-blue-500'
          : 'bg-slate-500';

export const DependencyMapView: React.FC = () => {
  const { theme, applications, servers, monitors, cloudflareZones, loadBalancer, registry, dependencyLinks, incidents, isLoading, refreshAll, systemSummary } = useOps();
  const navigate = useNavigate();
  const demo = useDependencyDemo();
  const isDark = theme === 'dark';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const [selected, setSelected] = useState<NodeRef>(null);
  const [graphId, setGraphId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [simId, setSimId] = useState('');
  const [simPreview, setSimPreview] = useState<ImpactPreview | null>(null);
  const [simError, setSimError] = useState('');
  const [simLoading, setSimLoading] = useState(false);

  /** The server a monitor checks: its explicit serverId, otherwise the app's server for that environment. */
  const serverOfMonitor = (m: Monitor): VpsServer | undefined => {
    if (m.serverId) return servers.find(s => s.id === m.serverId);
    const app = applications.find(a => a.id === m.applicationId);
    if (!app) return undefined;
    return servers.find(s => s.id === (m.environment === 'DR' ? app.drServerId : app.prdServerId));
  };
  const monitorsFor = (app: Application, env: 'PRD' | 'DR') => monitors.filter(m => m.applicationId === app.id && m.environment === env);
  const appsUsingServer = (srv: VpsServer) => applications.filter(a => a.prdServerId === srv.id || a.drServerId === srv.id || a.id === srv.applicationId);
  const monitorsOnServer = (srv: VpsServer) => monitors.filter(m => serverOfMonitor(m)?.id === srv.id);

  const orphanServers = servers.filter(s => !applications.some(a => a.prdServerId === s.id || a.drServerId === s.id));

  useEffect(() => {
    if (demo.enabled || !simId) {
      setSimPreview(null);
      setSimError('');
      setSimLoading(false);
      return;
    }
    let cancel = false;
    setSimLoading(true);
    setSimError('');
    api.getImpactPreview({ registryId: simId }).then(preview => {
      if (!cancel) {
        setSimPreview(preview);
        setSimError('');
      }
    }).catch(err => {
      if (!cancel) {
        setSimPreview(null);
        setSimError(err instanceof Error ? err.message : 'Simulation preview failed');
      }
    }).finally(() => {
      if (!cancel) setSimLoading(false);
    });
    return () => { cancel = true; };
  }, [simId, demo.enabled]);

  const demoPicture = demo.enabled ? demoComponents() : null;
  const demoLinks = demo.enabled ? demoDependencyLinks() : null;
  const demoSim = demo.enabled && demo.scenario ? simulateDemoFailure(demo.scenario.rootName) : null;
  const graphRegistry = demoPicture ?? registry;
  const graphLinks = demoLinks ?? dependencyLinks;
  const applicationChoices = graphRegistry
    .filter(component => component.kind === 'APPLICATION')
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const preferredId = (() => {
    if (applicationChoices.length === 0) return '';
    const score = (id: string) => graphLinks.filter(link => link.fromId === id || link.toId === id).length;
    return [...applicationChoices].sort((a, b) => score(b.id) - score(a.id) || a.name.localeCompare(b.name))[0].id;
  })();
  const activeFocusId = applicationChoices.some(component => component.id === focusId) ? focusId : preferredId;
  const focused = applicationChoices.find(component => component.id === activeFocusId) ?? null;
  const neighborhood = focused ? directNeighborhood(graphRegistry, graphLinks, focused.id) : null;
  const openIncidents = demo.enabled
    ? (demo.scenario ? 1 : 0)
    : incidents.filter(incident => incident.status !== 'RESOLVED' && incident.status !== 'CLOSED').length;
  const refreshedLabel = systemSummary.generatedAt && !Number.isNaN(Date.parse(systemSummary.generatedAt))
    ? new Date(systemSummary.generatedAt).toLocaleString()
    : 'not loaded yet';

  const nodeClass = (isSelected: boolean, status: string) =>
    `p-2.5 rounded border text-left transition-all cursor-pointer min-w-0 w-full ${
      isSelected
        ? 'border-blue-500 bg-blue-500/10 shadow-xs ring-1 ring-blue-500'
        : status === 'CRITICAL'
          ? (isDark ? 'bg-[#180E13] border-rose-900/80' : 'bg-rose-50 border-rose-300')
          : (isDark ? 'bg-[#0B0F17] border-[#1A2436] hover:border-slate-700' : 'bg-slate-50 border-slate-200 hover:border-slate-300')
    }`;

  const isSel = (kind: 'app' | 'server' | 'monitor', id: string) => selected?.kind === kind && selected.id === id;

  const serverNode = (srv: VpsServer | undefined, env: 'PRD' | 'DR') =>
    srv ? (
      <button onClick={() => setSelected({ kind: 'server', id: srv.id })} className={nodeClass(isSel('server', srv.id), srv.status)}>
        <div className="flex items-center justify-between gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(srv.status)}`} />
          <span className={`text-[9px] uppercase ${env === 'PRD' ? 'text-blue-500' : muted}`}>{env} server</span>
        </div>
        <div title={srv.hostname} className={`font-bold text-xs mt-1 truncate ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{srv.hostname}</div>
        <div className={`text-[10px] truncate ${muted}`}>{srv.ip || 'No IP'} · agent {srv.agentStatus}</div>
        <div className={`text-[10px] font-semibold ${statusText(srv.status)}`}>{srv.status}</div>
      </button>
    ) : (
      <div className={`p-2.5 rounded border border-dashed text-[11px] italic ${isDark ? 'border-[#1E293B] text-slate-500' : 'border-slate-300 text-slate-400'}`}>
        No {env} server linked
      </div>
    );

  const monitorList = (list: Monitor[]) =>
    list.length === 0 ? (
      <div className={`text-[10px] italic px-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>No monitors</div>
    ) : (
      <div className="space-y-1">
        {list.map(m => (
          <button key={m.id} onClick={() => setSelected({ kind: 'monitor', id: m.id })} className={`${nodeClass(isSel('monitor', m.id), m.status)} !p-1.5 flex items-center gap-2`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(m.status)}`} />
            <span title={m.name} className={`truncate flex-1 text-[11px] ${isDark ? 'text-slate-200' : 'text-slate-800'} ${!m.enabled ? 'opacity-50' : ''}`}>{m.name}</span>
            <span className={`text-[9px] shrink-0 ${muted}`}>{m.type}</span>
            <span className={`text-[9px] font-bold shrink-0 ${statusText(m.status)}`}>{m.status}</span>
          </button>
        ))}
      </div>
    );

  // ── Inspector content ──────────────────────────────────────────────────────
  const listBox = (items: { key: string; label: React.ReactNode; onClick?: () => void }[], empty: string, arrow: string, arrowColor: string) => (
    <div className="space-y-1.5">
      {items.length > 0 ? items.map(it => (
        <button
          key={it.key}
          onClick={it.onClick}
          className={`w-full text-left p-2 rounded border flex items-center gap-1.5 ${it.onClick ? 'cursor-pointer' : 'cursor-default'} ${
            isDark ? 'bg-[#0B0F17] border-[#1A2436] text-slate-300 hover:border-slate-700' : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300'
          }`}
        >
          <span className={`${arrowColor} font-bold`}>{arrow}</span>
          <span title={typeof it.label === 'string' ? it.label : undefined} className="min-w-0 truncate">{it.label}</span>
        </button>
      )) : <div className={`italic ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{empty}</div>}
    </div>
  );

  const sectionLabel = (t: string) => (
    <span className={`text-[10px] uppercase block font-semibold mb-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{t}</span>
  );

  let inspector: React.ReactNode = (
    <div className={`text-xs italic ${muted}`}>Select an application, server or monitor in the map to inspect its dependencies and blast radius.</div>
  );

  if (selected?.kind === 'app') {
    const app = applications.find(a => a.id === selected.id);
    if (app) {
      const prd = servers.find(s => s.id === app.prdServerId);
      const dr = servers.find(s => s.id === app.drServerId);
      const appMons = monitors.filter(m => m.applicationId === app.id);
      inspector = (
        <>
          <div className={`border-b pb-3 ${isDark ? 'border-[#1A2332]' : 'border-slate-100'}`}>
            <span className={`text-[9px] uppercase tracking-wider font-semibold ${muted}`}>Application</span>
            <h2 className="text-base font-bold font-sans mt-0.5">{app.name}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`text-xs ${muted}`}>{app.dnsRecordName || app.codeName}</span>
              <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
              <span className={`text-xs font-bold ${statusText(app.status)}`}>{app.status}</span>
              <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
              <span className={`text-xs ${muted}`}>{servingLabel(routeState(app, loadBalancer, dnsPointsAt(app, servers, cloudflareZones))) === 'Unknown' ? 'Origin unknown' : `Serving from ${servingLabel(routeState(app, loadBalancer, dnsPointsAt(app, servers, cloudflareZones)))}`}</span>
            </div>
          </div>
          <div className="space-y-4 text-xs">
            <div>
              {sectionLabel('Runs on (hosting, not a service dependency):')}
              {listBox(
                [prd && { key: prd.id, label: <>PRD · {prd.hostname} <span className={statusText(prd.status)}>{prd.status}</span></>, onClick: () => setSelected({ kind: 'server', id: prd.id }) },
                 dr && { key: dr.id, label: <>DR · {dr.hostname} <span className={statusText(dr.status)}>{dr.status}</span></>, onClick: () => setSelected({ kind: 'server', id: dr.id }) }]
                  .filter(Boolean) as { key: string; label: React.ReactNode; onClick: () => void }[],
                'No servers linked', '←', 'text-blue-500',
              )}
            </div>
            <div>
              {sectionLabel('Service dependencies · consumer → provider')}
              {(() => {
                const comp = registry.find(c => c.kind === 'APPLICATION' && c.applicationId === app.id);
                const outgoing = comp ? dependencyLinks.filter(l => l.fromId === comp.id) : [];
                const incoming = comp ? dependencyLinks.filter(l => l.toId === comp.id) : [];
                const regName = (id: string) => registry.find(c => c.id === id)?.name ?? 'Unknown';
                const line = (l: typeof dependencyLinks[number], consumer: string, provider: string) => (
                  <div key={l.id} className={`p-2 rounded border ${isDark ? 'border-[#1A2436]' : 'border-slate-200'}`}>
                    <span className="font-semibold">{consumer}</span>
                    <span className={muted}> → </span>
                    <span className="font-semibold">{provider}</span>
                    <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${l.type === 'HARD' ? 'bg-rose-500/15 text-rose-500' : 'bg-amber-500/15 text-amber-500'}`}>{l.type}</span>
                    <span className={muted}> · {l.method ?? 'method not recorded'}</span>
                    {l.notes ? <div className={muted}>{l.notes}</div> : null}
                  </div>
                );
                if (!comp || (outgoing.length === 0 && incoming.length === 0)) {
                  return <div className={`italic ${muted}`}>Nothing recorded. This does not mean the application has no dependencies.</div>;
                }
                return (
                  <div className="space-y-1.5">
                    {outgoing.map(l => line(l, app.name, regName(l.toId)))}
                    {incoming.map(l => line(l, regName(l.fromId), app.name))}
                  </div>
                );
              })()}
            </div>
            <div>
              {sectionLabel(`Checked by (${appMons.length} monitors):`)}
              {listBox(
                appMons.map(m => ({ key: m.id, label: <>{m.name} [{m.environment}] <span className={statusText(m.status)}>{m.status}</span></>, onClick: () => setSelected({ kind: 'monitor', id: m.id }) })),
                'No monitors attached', '•', 'text-slate-500',
              )}
            </div>
          </div>
        </>
      );
    }
  } else if (selected?.kind === 'server') {
    const srv = servers.find(s => s.id === selected.id);
    if (srv) {
      const apps = appsUsingServer(srv);
      const mons = monitorsOnServer(srv);
      inspector = (
        <>
          <div className={`border-b pb-3 ${isDark ? 'border-[#1A2332]' : 'border-slate-100'}`}>
            <span className={`text-[9px] uppercase tracking-wider font-semibold ${muted}`}>{srv.environment} Server</span>
            <h2 className="text-base font-bold font-sans mt-0.5 break-all">{srv.hostname}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`text-xs ${muted}`}>{srv.ip || 'No IP'}</span>
              <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
              <span className={`text-xs font-bold ${statusText(srv.status)}`}>{srv.status}</span>
              <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>·</span>
              <span className={`text-xs ${muted}`}>agent {srv.agentStatus}, last seen {fmtDateTime(srv.lastSeen, 'never')}</span>
            </div>
          </div>
          <div className="space-y-4 text-xs">
            <div>
              {sectionLabel('Monitors checking this server:')}
              {listBox(
                mons.map(m => ({ key: m.id, label: <>{m.name} <span className={statusText(m.status)}>{m.status}</span></>, onClick: () => setSelected({ kind: 'monitor', id: m.id }) })),
                'No monitors target this server', '←', 'text-blue-500',
              )}
            </div>
            <div>
              {sectionLabel('Blast radius (applications on this server):')}
              {listBox(
                apps.map(a => {
                  const role = a.prdServerId === srv.id ? 'PRD' : a.drServerId === srv.id ? 'DR' : srv.environment;
                  const route = routeState(a, loadBalancer, dnsPointsAt(a, servers, cloudflareZones));
                  const live = route === 'SPLIT' || (role === 'PRD' && route === 'PRD') || (role === 'DR' && route === 'DR');
                  const place = route === 'UNKNOWN' || route === 'MOVING' ? 'routing unknown' : live ? 'serving traffic' : 'standby';
                  return { key: a.id, label: <>{a.name} · {role} · {place}</>, onClick: () => setSelected({ kind: 'app', id: a.id }) };
                }),
                'No applications use this server', '→', 'text-amber-500',
              )}
            </div>
          </div>
        </>
      );
    }
  } else if (selected?.kind === 'monitor') {
    const m = monitors.find(x => x.id === selected.id);
    if (m) {
      const app = applications.find(a => a.id === m.applicationId);
      const srv = serverOfMonitor(m);
      inspector = (
        <>
          <div className={`border-b pb-3 ${isDark ? 'border-[#1A2332]' : 'border-slate-100'}`}>
            <span className={`text-[9px] uppercase tracking-wider font-semibold ${muted}`}>Monitor · {m.type} · {m.environment}</span>
            <h2 className="text-base font-bold font-sans mt-0.5">{m.name}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`text-xs font-bold ${statusText(m.status)}`}>{m.status}</span>
              {!m.enabled && <span className={`text-xs ${muted}`}>(paused)</span>}
            </div>
          </div>
          <div className="space-y-2 text-xs">
            <div className="break-all"><span className={muted}>Target: </span>{m.target || '—'}</div>
            <div><span className={muted}>Last check: </span>{fmtDateTime(m.lastCheck, 'not checked yet')}</div>
            <div><span className={muted}>Last success: </span>{fmtDateTime(m.lastSuccess, 'never')}</div>
            {m.lastCheck && <div><span className={muted}>Response time: </span>{m.responseTimeMs}ms</div>}
            {m.history[0]?.detail && <div className="break-words"><span className={muted}>Last result: </span>{m.history[0].detail}</div>}
          </div>
          <div className="space-y-4 text-xs">
            <div>
              {sectionLabel('Checks:')}
              {listBox(
                srv ? [{ key: srv.id, label: <>{srv.environment} · {srv.hostname} <span className={statusText(srv.status)}>{srv.status}</span></>, onClick: () => setSelected({ kind: 'server', id: srv.id }) }] : [],
                'Not linked to a registered server', '←', 'text-blue-500',
              )}
            </div>
            <div>
              {sectionLabel('Affects application:')}
              {listBox(
                app ? [{ key: app.id, label: <>{app.name} <span className={statusText(app.status)}>{app.status}</span></>, onClick: () => setSelected({ kind: 'app', id: app.id }) }] : [],
                'Not attached to an application', '→', 'text-amber-500',
              )}
            </div>
          </div>
        </>
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            Dependency Impact Center
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Service dependencies from the register. Failure propagation is provider → consumer. A stored link still means the consumer depends on the provider. Hosting is a separate map below.
          </p>
          <p className={`text-[11px] font-mono mt-1 ${muted}`}>Last refreshed {refreshedLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DemoToggle isDark={isDark} />
          <button
            type="button"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              void refreshAll().finally(() => setRefreshing(false));
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border cursor-pointer disabled:opacity-50 ${isDark ? 'border-[#1E293B] text-slate-200' : 'border-slate-300 text-slate-700'}`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {demo.enabled && <DemoBanner />}

      <div className={`rounded-lg border p-4 space-y-3 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'}`}>
        <div>
          <h2 className="text-xl font-semibold font-sans tracking-tight">Dependency graph</h2>
          <p className={`text-sm font-sans mt-1 ${muted}`}>
            Every application, service and its dependencies. Impact flows left to right. Select a box to see its register entry.
            {demo.enabled ? ' Illustrative picture. Not verified dependencies.' : ''}
          </p>
        </div>
        <label className={`block text-sm font-sans max-w-md ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
          Application
          <select
            aria-label="Application"
            value={activeFocusId}
            onChange={event => {
              setFocusId(event.target.value);
              setGraphId(event.target.value || null);
            }}
            className={`mt-1 w-full rounded-md border px-2 py-1.5 text-sm font-sans ${isDark ? 'bg-[#0B0F17] border-[#2A3746] text-slate-100' : 'bg-white border-[#CDD5DF] text-[#162030]'}`}
          >
            {applicationChoices.length === 0 && <option value="">No application recorded</option>}
            {applicationChoices.map(component => (
              <option key={component.id} value={component.id}>{component.name}</option>
            ))}
          </select>
        </label>
        {isLoading && !demo.enabled && registry.length === 0 ? (
          <p className={`text-xs font-mono animate-pulse ${muted}`}>Loading the register…</p>
        ) : !focused || !neighborhood ? (
          <p className={`text-xs font-mono ${muted}`}>
            {applicationChoices.length === 0
              ? 'No application is in this picture yet.'
              : 'Select an application above. The other applications stay off this graph.'}
          </p>
        ) : (
          <DependencyGraph
            registry={neighborhood.components}
            dependencyLinks={neighborhood.links}
            applications={applications}
            servers={servers}
            isDark={isDark}
            selectedId={graphId}
            onSelect={setGraphId}
            simulatedRootId={demo.enabled ? null : (simId || null)}
            simulatedAffectedIds={demo.enabled ? undefined : new Set((simPreview?.impact?.affected ?? []).map(row => row.id))}
            visualStatus={demoSim?.visual}
            remotePaths={!demo.enabled}
            anchorId={focused.id}
            incidentCount={openIncidents}
          />
        )}
        {demoSim && (
          <p className={`text-[11px] font-mono ${muted}`}>
            Hypothetical only. {demoSim.affectedApplications} demo application{demoSim.affectedApplications === 1 ? '' : 's'} affected.
            Direct {demoSim.direct.length}. Indirect {demoSim.indirect.length}. An all-HARD path is SIMULATED CRITICAL. A path that includes SOFT is SIMULATED WARNING. Unaffected nodes stay UNKNOWN.
          </p>
        )}
      </div>

      <div className={`rounded-lg p-3 space-y-2 ${isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-900 text-slate-100'}`}>
        {demo.enabled ? <DemoScenarios /> : (
          <>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold">DEMO / SIMULATION</h2>
            <p className="text-[11px] text-slate-300 max-w-3xl">
              Paints a local picture of the existing impact preview. It does not change monitor status, open an incident, send an alert, or write to the database.
            </p>
          </div>
          <button type="button" onClick={() => setSimId('')} className="px-3 py-1.5 text-xs font-semibold rounded bg-white text-slate-900 cursor-pointer">
            Restore simulated view
          </button>
        </div>
        <label className="block text-[11px] max-w-md w-full">
          Provider to pretend has failed
          <select
            aria-label="Simulated failed provider"
            disabled={registry.length === 0}
            className="mt-1 w-full rounded border border-slate-500 bg-slate-800 px-2 py-1 text-slate-100 disabled:opacity-50"
            value={simId}
            onChange={e => setSimId(e.target.value)}
          >
            <option value="">No simulation</option>
            {registry.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {registry.length === 0 && <p className="text-[11px] text-slate-300">Nothing to simulate. The register has no components, so no relationship is invented.</p>}
        {simLoading && <p className="text-[11px] text-slate-300">Loading the existing impact preview…</p>}
        {simError && <p className="text-[11px] text-rose-300">{simError}</p>}
        {simId && simPreview && (
          <p className="text-[11px] text-violet-200">
            Simulated only. Existing calculation would reach {simPreview.impact?.affected.length ?? 0} component{(simPreview.impact?.affected.length ?? 0) === 1 ? '' : 's'}.
            Real statuses on the graph are unchanged. Nodes in the picture are marked SIMULATED.
          </p>
        )}
          </>
        )}
      </div>

      {demo.enabled ? (
        <p className={`text-xs font-mono ${muted}`}>
          The dependency register editor is hidden while DEMO mode is on, so these illustrative rows cannot be saved. Turn DEMO off to edit the live register. Hosting below stays the live application record and is not a service dependency.
        </p>
      ) : <DependencyRegisterSection />}

      {(applications.length > 0 || servers.length > 0) && <div className={`pb-1 border-b ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
        <h2 className="text-sm font-bold font-mono tracking-tight">WHERE EACH PROJECT RUNS</h2>
        <p className={`text-xs font-mono ${muted}`}>
          The production server, the recovery server, and the monitors that check them. This is live status, not the dependency list above.
        </p>
      </div>}

      {(applications.length > 0 || servers.length > 0) && <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 font-mono text-xs">

        {/* Map */}
        <div className={`lg:col-span-2 rounded-lg border p-5 space-y-5 transition-colors ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          {applications.length === 0 && (
            <div className={`text-[11px] font-sans ${muted}`}>
              No applications registered yet.{' '}
              <button onClick={() => navigate('/setup')} className="text-blue-500 hover:underline cursor-pointer">Register them in Setup</button>.
            </div>
          )}

          {applications.map(app => (
            <div key={app.id} className="space-y-2">
              <button onClick={() => setSelected({ kind: 'app', id: app.id })} className={nodeClass(isSel('app', app.id), app.status)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(app.status)}`} />
                    <span title={app.name} className={`font-bold text-sm truncate font-sans ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{app.name}</span>
                    <span title={app.dnsRecordName || app.codeName} className={`text-[10px] truncate ${muted}`}>{app.dnsRecordName || app.codeName}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] ${muted}`}>{app.failoverState === 'DR_ACTIVE' ? 'DR active' : app.failoverState === 'FAILING_OVER' ? 'switching' : 'PRD active'}</span>
                    <span className={`text-[10px] font-bold ${statusText(app.status)}`}>{app.status}</span>
                  </div>
                </div>
              </button>
              <div className="flex justify-center">
                <ArrowDown className={`w-3.5 h-3.5 ${isDark ? 'text-slate-600' : 'text-slate-400'}`} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(['PRD', 'DR'] as const).map(env => {
                  const srv = servers.find(s => s.id === (env === 'PRD' ? app.prdServerId : app.drServerId));
                  return (
                    <div key={env} className="space-y-1.5">
                      {serverNode(srv, env)}
                      <div className={`pl-3 border-l ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
                        {monitorList(monitorsFor(app, env))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className={`h-px ${isDark ? 'bg-[#1A2332]' : 'bg-slate-200'}`} />
            </div>
          ))}

          {orphanServers.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${muted}`}>Servers not linked to an application</span>
                <div className={`flex-1 h-px ${isDark ? 'bg-[#1A2332]' : 'bg-slate-200'}`} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {orphanServers.map(s => <div key={s.id}>{serverNode(s, s.environment)}</div>)}
              </div>
            </div>
          )}
        </div>

        {/* Inspector */}
        <div className={`rounded-lg border p-5 space-y-4 transition-colors self-start ${
          isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          {inspector}
        </div>

      </div>}
      {isLoading && applications.length === 0 && servers.length === 0 && (
        <div className={`text-xs font-mono animate-pulse ${muted}`}>Loading…</div>
      )}
    </div>
  );
};
