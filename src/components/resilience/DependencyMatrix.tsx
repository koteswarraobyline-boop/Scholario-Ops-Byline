import React from 'react';
import type { Application, DependencyLink, RegistryComponent } from '../../types';

/**
 * Recorded applications down the side, the things they depend on across the top.
 * H is a hard link. S is a soft link. An empty cell has no recorded dependency.
 */
export const DependencyMatrix: React.FC<{
  applications: readonly Application[];
  registry: readonly RegistryComponent[];
  links: readonly DependencyLink[];
  isDark: boolean;
}> = ({ applications, registry, links, isDark }) => {
  const byId = new Map(registry.map(c => [c.id, c]));
  const rows = applications.map(app => {
    const component = registry.find(c => c.kind === 'APPLICATION' && c.applicationId === app.id) ?? null;
    const featureIds = new Set(registry.filter(c => c.kind === 'BUSINESS_FEATURE' && c.applicationId === app.id).map(c => c.id));
    return { app, component, featureIds };
  });
  const fromThese = new Set(rows.flatMap(row => [row.component?.id, ...row.featureIds].filter((id): id is string => Boolean(id))));
  const appLinks = links.filter(link => {
    if (fromThese.has(link.fromId)) return true;
    return link.featureId != null && rows.some(row => row.featureIds.has(link.featureId!));
  });
  const providerIds = [...new Set(appLinks.map(link => link.toId))];
  const providers = providerIds
    .map(id => byId.get(id))
    .filter((c): c is RegistryComponent => Boolean(c))
    .sort((a, b) => a.name.localeCompare(b.name));
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const border = isDark ? 'border-[#1E293B]' : 'border-slate-200';
  const head = isDark ? 'bg-[#0B0F17] text-slate-300' : 'bg-slate-50 text-slate-600';

  const marks = (appId: string, providerId: string) => {
    const row = rows.find(r => r.app.id === appId);
    if (!row) return [];
    return appLinks.filter(link => {
      if (link.toId !== providerId) return false;
      if (row.component && link.fromId === row.component.id) return true;
      if (link.featureId && row.featureIds.has(link.featureId)) return true;
      if (row.featureIds.has(link.fromId)) return true;
      return false;
    });
  };

  return (
    <section id="dependency-matrix" className={`rounded-lg border p-4 space-y-3 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'}`} aria-label="Dependency matrix">
      <div>
        <h2 className="text-xl font-semibold font-sans tracking-tight">Dependency matrix</h2>
        <p className={`text-sm font-sans mt-1 ${muted}`}>
          Recorded relationships only. H means the project stops. S means the project is degraded. F means only that feature stops.
        </p>
      </div>
      {appLinks.length === 0 || providers.length === 0 ? (
        <p className={`text-xs font-mono ${muted}`}>Nothing recorded. An empty matrix does not mean these projects have no dependencies.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono min-w-[640px]">
            <thead>
              <tr className={head}>
                <th className={`px-3 py-2 text-left font-semibold border-b ${border}`}>Project</th>
                {providers.map(provider => (
                  <th key={provider.id} className={`px-3 py-2 text-left font-semibold border-b ${border}`}>{provider.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.app.id} className={`border-b last:border-b-0 ${border}`}>
                  <th className="px-3 py-2 text-left font-semibold">{row.app.name}</th>
                  {providers.map(provider => {
                    const hits = marks(row.app.id, provider.id);
                    const hard = hits.some(link => link.type === 'HARD');
                    const soft = hits.some(link => link.type === 'SOFT' && !link.featureId);
                    const featureOnly = hits.some(link => link.type === 'SOFT' && link.featureId);
                    const label = [hard ? 'H' : '', soft ? 'S' : '', featureOnly ? 'F' : ''].filter(Boolean).join('+');
                    const title = hits.map(link => {
                      const feature = link.featureId ? byId.get(link.featureId)?.name : null;
                      return [link.type, feature, link.method, link.criticality, link.failureBehaviour].filter(Boolean).join(' · ');
                    }).join(', ');
                    return (
                      <td key={provider.id} title={title || 'Nothing recorded'} className={`px-3 py-2 font-bold ${hard ? 'text-rose-500' : soft || featureOnly ? 'text-amber-500' : muted}`}>
                        {label || '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
