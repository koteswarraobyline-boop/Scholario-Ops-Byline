import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import { Application, Monitor, VpsServer } from '../../types';
import { ArrowDown, Network } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';

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
  const { theme, applications, servers, monitors, isLoading } = useOps();
  const navigate = useNavigate();
  const isDark = theme === 'dark';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const [selected, setSelected] = useState<NodeRef>(null);

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

  if (applications.length === 0 && servers.length === 0) {
    return (
      <div className="space-y-6">
        <div className={`pb-3 border-b ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
          <h1 className="text-lg font-bold font-mono tracking-tight">DEPENDENCY MAP</h1>
        </div>
        {isLoading ? (
          <div className={`text-xs font-mono animate-pulse ${muted}`}>Loading…</div>
        ) : (
          <EmptyState
            icon={Network}
            title="Nothing to map yet"
            description="Register your servers and applications in Setup; the map is built from applications, their PRD/DR servers and their monitors."
            action={{ label: 'Open Setup', onClick: () => navigate('/setup') }}
          />
        )}
      </div>
    );
  }

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
        <div className={`font-bold text-xs mt-1 truncate ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{srv.hostname}</div>
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
            <span className={`truncate flex-1 text-[11px] ${isDark ? 'text-slate-200' : 'text-slate-800'} ${!m.enabled ? 'opacity-50' : ''}`}>{m.name}</span>
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
          <span className="min-w-0 truncate">{it.label}</span>
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
              <span className={`text-xs ${muted}`}>{app.failoverState === 'DR_ACTIVE' ? 'Serving from DR' : app.failoverState === 'FAILING_OVER' ? 'Switching' : 'Serving from PRD'}</span>
            </div>
          </div>
          <div className="space-y-4 text-xs">
            <div>
              {sectionLabel('Depends on (servers):')}
              {listBox(
                [prd && { key: prd.id, label: <>PRD · {prd.hostname} <span className={statusText(prd.status)}>{prd.status}</span></>, onClick: () => setSelected({ kind: 'server', id: prd.id }) },
                 dr && { key: dr.id, label: <>DR · {dr.hostname} <span className={statusText(dr.status)}>{dr.status}</span></>, onClick: () => setSelected({ kind: 'server', id: dr.id }) }]
                  .filter(Boolean) as { key: string; label: React.ReactNode; onClick: () => void }[],
                'No servers linked', '←', 'text-blue-500',
              )}
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
                  const live = (role === 'PRD' && a.failoverState !== 'DR_ACTIVE') || (role === 'DR' && a.failoverState === 'DR_ACTIVE');
                  return { key: a.id, label: <>{a.name} · {role}{live ? ' · serving traffic' : ' · standby'}</>, onClick: () => setSelected({ kind: 'app', id: a.id }) };
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
            DEPENDENCY MAP &amp; BLAST RADIUS
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Applications → their PRD / DR servers → the monitors that check them (live status)
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 font-mono text-xs">

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
                    <span className={`font-bold text-sm truncate font-sans ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{app.name}</span>
                    <span className={`text-[10px] truncate ${muted}`}>{app.dnsRecordName || app.codeName}</span>
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

      </div>
    </div>
  );
};
