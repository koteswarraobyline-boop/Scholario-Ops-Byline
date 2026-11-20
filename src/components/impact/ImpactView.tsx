import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Waypoints } from 'lucide-react';
import { api } from '../../services/api';
import type { ImpactPreview, RegistryPaths } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useOps } from '../../context/OpsContext';
import { EmptyState } from '../ui/EmptyState';
import { ImpactPreviewCard } from '../ui/ImpactPreviewCard';

type Target = {
  key: string;
  label: string;
  live: string;
  query: { applicationId?: string; serverId?: string; registryId?: string };
};

export const ImpactView: React.FC = () => {
  const { theme, applications, servers, registry, dependencyLinks, isLoading } = useOps();
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const isDark = theme === 'dark';
  const canEditRegister = hasRole('it_administrator');
  const [selectedKey, setSelectedKey] = useState('');
  const [preview, setPreview] = useState<ImpactPreview | null>(null);
  const [paths, setPaths] = useState<RegistryPaths | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const targets = useMemo<Target[]>(() => {
    const list: Target[] = [];
    for (const app of applications) {
      list.push({
        key: `app:${app.id}`,
        label: `${app.name} · application`,
        live: app.status,
        query: { applicationId: app.id },
      });
    }
    for (const srv of servers) {
      list.push({
        key: `srv:${srv.id}`,
        label: `${srv.hostname} · ${srv.environment} server`,
        live: srv.status,
        query: { serverId: srv.id },
      });
    }
    for (const component of registry) {
      const coveredApp = component.kind === 'APPLICATION' && component.applicationId && applications.some(a => a.id === component.applicationId);
      const coveredServer = component.kind === 'SERVER' && component.serverId && servers.some(s => s.id === component.serverId);
      if (coveredApp || coveredServer) continue;
      list.push({
        key: `reg:${component.id}`,
        label: `${component.name} · ${component.kind.replace(/_/g, ' ').toLowerCase()}`,
        live: 'REGISTER',
        query: { registryId: component.id },
      });
    }
    return list;
  }, [applications, servers, registry]);

  const selected = targets.find(t => t.key === selectedKey) ?? targets[0];

  useEffect(() => {
    if (!selected) return;
    let cancel = false;
    const run = async (first: boolean) => {
      if (first) setLoading(true);
      try {
        const next = await api.getImpactPreview(selected.query);
        let nextPaths: RegistryPaths | null = null;
        if (next.componentId) {
          try { nextPaths = await api.getRegistryPaths(next.componentId); } catch { nextPaths = null; }
        }
        if (!cancel) {
          setPreview(next);
          setPaths(nextPaths);
          setError('');
        }
      } catch (err) {
        if (!cancel) {
          setPreview(null);
          setPaths(null);
          setError(err instanceof Error ? err.message : 'Could not load impact');
        }
      } finally {
        if (!cancel && first) setLoading(false);
      }
    };
    void run(true);
    const timer = setInterval(() => { if (!document.hidden) void run(false); }, 30_000);
    return () => { cancel = true; clearInterval(timer); };
  }, [selected?.key, selected?.live]);

  const card = isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200';
  const input = `w-full rounded border px-2 py-1 text-xs font-mono ${isDark ? 'bg-[#0B0F17] border-[#1E293B]' : 'bg-white border-slate-300'}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Impact</h1>
          <p className={`text-xs mt-0.5 max-w-xl ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            What stops or slows down if this part fails.
          </p>
        </div>
        {canEditRegister ? (
          <button type="button" onClick={() => navigate('/dependencies')} className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded cursor-pointer">
            Edit dependencies
          </button>
        ) : (
          <p className={`text-[11px] max-w-xs ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
            Only an IT administrator can change dependencies.
          </p>
        )}
      </div>

      {isLoading && targets.length === 0 && <div className="text-xs font-mono text-slate-500 animate-pulse">Loading impact…</div>}
      {!isLoading && targets.length === 0 && (
        <EmptyState icon={Waypoints} title="Nothing to analyse" description="Add an application, a server, or a dependency-register entry. Impact is computed from those records." />
      )}

      {selected && (
        <div className="space-y-3">
          <label className="block text-[10px] font-mono max-w-lg">
            Component
            <select aria-label="Impact target" className={input} value={selected.key} onChange={e => setSelectedKey(e.target.value)}>
              {targets.map(t => <option key={t.key} value={t.key}>{t.label} · {t.live}</option>)}
            </select>
          </label>
          <div className={`rounded border p-3 ${card}`}>
            <ImpactPreviewCard
              preview={preview}
              loading={loading}
              error={error}
              isDark={isDark}
              title="What will break if this fails"
            />
            {!loading && !error && preview?.componentId && (
              <div className={`mt-3 space-y-3 text-xs font-mono break-words ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                {(() => {
                  const compId = preview.componentId!;
                  const live = selected.live;
                  const confirmed = live === 'CRITICAL';
                  const affected = preview.impact?.affected ?? [];
                  const affectedIds = new Set(affected.map(a => a.id));
                  const incoming = dependencyLinks.filter(l => l.toId === compId);
                  const directIds = new Set<string>();
                  const methodFor = new Map<string, string | null>();
                  for (const l of incoming) {
                    if (affectedIds.has(l.fromId)) {
                      directIds.add(l.fromId);
                      if (!methodFor.has(l.fromId)) methodFor.set(l.fromId, l.method);
                    }
                    if (l.featureId && affectedIds.has(l.featureId)) directIds.add(l.featureId);
                  }
                  const comp = registry.find(c => c.id === compId);
                  if (comp?.kind === 'APPLICATION' && comp.applicationId) {
                    for (const f of registry) {
                      if (f.kind === 'BUSINESS_FEATURE' && f.applicationId === comp.applicationId && affectedIds.has(f.id)) directIds.add(f.id);
                    }
                  }
                  const nameOf = (id: string) => registry.find(c => c.id === id)?.name ?? id;
                  const direct = affected.filter(a => directIds.has(a.id));
                  const indirect = affected.filter(a => !directIds.has(a.id));
                  const directApps = direct.filter(a => a.kind === 'APPLICATION');
                  const indirectApps = indirect.filter(a => a.kind === 'APPLICATION');
                  const missingMethods = incoming.filter(l => !l.method);
                  return (
                    <>
                      <p>
                        {confirmed
                          ? `${preview.componentName} is down. These are the parts that depend on it.`
                          : `${preview.componentName} is ${live === 'REGISTER' ? 'not monitored' : live}. This is what would be affected if it failed.`}
                      </p>
                      <div>
                        <div className="font-bold text-[10px] uppercase text-rose-500">Direct ({direct.length}) · applications {directApps.length}</div>
                        {direct.length === 0
                          ? <div className="text-slate-500">None directly connected.</div>
                          : direct.map(a => {
                            const link = dependencyLinks.find(l => l.toId === compId && (l.fromId === a.id || l.featureId === a.id));
                            const method = methodFor.get(a.id);
                            const extra = [
                              a.userCount != null ? `${a.userCount.toLocaleString()} users` : '',
                              method ?? '',
                              link?.criticality ?? '',
                              link?.failureBehaviour ? `users see ${link.failureBehaviour}` : '',
                            ].filter(Boolean).join(' · ');
                            return <div key={a.id}>{nameOf(compId)} → {a.name} · {a.via} · {a.tier}{extra ? ` · ${extra}` : ''}</div>;
                          })}
                      </div>
                      <div>
                        <div className="font-bold text-[10px] uppercase text-amber-500">Indirect ({indirect.length}) · applications {indirectApps.length}</div>
                        {indirect.length === 0
                          ? <div className="text-slate-500">Nothing further along.</div>
                          : indirect.map(a => (
                            <div key={a.id}>{nameOf(compId)} → {a.name} · {a.via} · {a.tier}{a.userCount != null ? ` · ${a.userCount.toLocaleString()} users` : ''}</div>
                          ))}
                      </div>
                      <div>
                        <div className="font-bold text-[10px] uppercase">Business features ({preview.features.length})</div>
                        {preview.features.length === 0
                          ? <div className="text-slate-500">No features listed.</div>
                          : preview.features.map(f => <div key={f.id}>{f.name} · {f.via} · {f.action}</div>)}
                      </div>
                      <div>
                        <div className="font-bold text-[10px] uppercase">Dependency paths</div>
                        {!paths
                          ? <div className="text-slate-500">Path details are not available for this result.</div>
                          : (
                            <>
                              <div>Downstream: {paths.downstream.length === 0 ? 'none' : paths.downstream.map(n => `${n.name} (${n.status}, ${n.via})`).join(' → ')}</div>
                              <div>Upstream: {paths.upstream.length === 0 ? 'none' : paths.upstream.map(n => `${n.name} (${n.status}, ${n.via})`).join(' → ')}</div>
                            </>
                          )}
                      </div>
                      {(dependencyLinks.length === 0 || missingMethods.length > 0) && (
                        <div>
                          <div className="font-bold text-[10px] uppercase">Missing</div>
                          {dependencyLinks.length === 0 && <div>No dependencies recorded yet.</div>}
                          {missingMethods.length > 0 && <div>{missingMethods.length} link{missingMethods.length === 1 ? '' : 's'} with no method.</div>}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
            {!loading && !error && preview && !preview.componentId && (
              <p className={`text-[11px] font-mono mt-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                No register match yet, so this is not a pass. Link the component on Dependencies.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
