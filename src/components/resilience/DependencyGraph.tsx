import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../services/api';
import type { DemoVisual } from '../../mocks/dependencyDemoData';
import { demoVisualLabel } from '../../mocks/dependencyDemoData';
import type { Application, DependencyLink, OperationalStatus, RegistryComponent, RegistryPaths, VpsServer } from '../../types';
import { dependencyMethodLabel } from '../../lib/serviceDependencies';

const NODE_W = 168;
const NODE_H = 46;
const COL_STEP = 236;
const ROW_H = 56;
const PAD_X = 8;

const LANE_LABELS = ['Infrastructure', 'Providers', 'Consumer applications', 'Downstream'];

export function liveRegistryStatus(
  component: RegistryComponent,
  applications: Application[],
  servers: VpsServer[],
): OperationalStatus {
  if (component.kind === 'APPLICATION' && component.applicationId) {
    return applications.find(a => a.id === component.applicationId)?.status ?? 'UNKNOWN';
  }
  if (component.kind === 'SERVER' && component.serverId) {
    return servers.find(s => s.id === component.serverId)?.status ?? 'UNKNOWN';
  }
  return 'UNKNOWN';
}

/** The chosen component, the providers it depends on, and the consumers that depend on it. */
export function directNeighborhood(
  components: RegistryComponent[],
  links: DependencyLink[],
  focusId: string,
): { components: RegistryComponent[]; links: DependencyLink[] } {
  const focus = components.find(component => component.id === focusId);
  if (!focus) return { components: [], links: [] };
  const related = links.filter(link => link.fromId === focusId || link.toId === focusId);
  const ids = new Set<string>([focusId]);
  for (const link of related) {
    ids.add(link.fromId);
    ids.add(link.toId);
  }
  return {
    components: components.filter(component => ids.has(component.id)),
    links: related,
  };
}

/**
 * Four lanes for one application: infrastructure it uses, that application
 * (and any application it depends on), the applications that depend on it,
 * then the next hop.
 */
export function focusLanes(
  components: RegistryComponent[],
  links: DependencyLink[],
  focusId: string,
): Map<string, number> {
  const lane = new Map<string, number>();
  const providers = new Set(links.filter(link => link.fromId === focusId).map(link => link.toId));
  const consumers = new Set(links.filter(link => link.toId === focusId).map(link => link.fromId));
  const downstream = new Set<string>();
  for (const link of links) {
    if (!consumers.has(link.toId)) continue;
    if (link.fromId === focusId || providers.has(link.fromId) || consumers.has(link.fromId)) continue;
    downstream.add(link.fromId);
  }
  for (const component of components) {
    if (component.id !== focusId && providers.has(component.id) && component.kind !== 'APPLICATION') lane.set(component.id, 0);
    else if (component.id === focusId || providers.has(component.id)) lane.set(component.id, 1);
    else if (consumers.has(component.id)) lane.set(component.id, 2);
    else if (downstream.has(component.id)) lane.set(component.id, 3);
    else lane.set(component.id, component.kind === 'APPLICATION' ? 2 : 0);
  }
  return lane;
}

/** Provider column is left. A component sits one column to the right of the providers it depends on. */
export function graphColumns(components: RegistryComponent[], links: DependencyLink[]): Map<string, number> {
  const ids = new Set(components.map(c => c.id));
  const providersOf = new Map<string, string[]>();
  for (const link of links) {
    if (!ids.has(link.fromId) || !ids.has(link.toId)) continue;
    const list = providersOf.get(link.fromId) ?? [];
    list.push(link.toId);
    providersOf.set(link.fromId, list);
  }
  const column = new Map<string, number>();
  const visit = (id: string, stack: Set<string>): number => {
    const known = column.get(id);
    if (known !== undefined) return known;
    if (stack.has(id)) return 0;
    stack.add(id);
    const providers = providersOf.get(id) ?? [];
    const value = providers.length === 0 ? 0 : 1 + Math.max(...providers.map(provider => visit(provider, stack)));
    stack.delete(id);
    column.set(id, value);
    return value;
  };
  for (const component of components) visit(component.id, new Set());
  return column;
}

const statusInk = (status: OperationalStatus) =>
  status === 'HEALTHY' ? 'text-emerald-500'
    : status === 'WARNING' || status === 'STALE' ? 'text-amber-500'
      : status === 'CRITICAL' ? 'text-rose-500'
        : status === 'MAINTENANCE' ? 'text-blue-500'
          : 'text-slate-400';

interface Props {
  registry: RegistryComponent[];
  dependencyLinks: DependencyLink[];
  applications: Application[];
  servers: VpsServer[];
  isDark: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Local demo overlay. Never a stored status. */
  simulatedRootId?: string | null;
  simulatedAffectedIds?: ReadonlySet<string>;
  /** When set, node colour comes from the demo walk. UNKNOWN stays UNKNOWN. */
  visualStatus?: ReadonlyMap<string, DemoVisual>;
  /** Live register paths. Demo mode turns this off so no API call is made. */
  remotePaths?: boolean;
  /** Application the columns are built around. */
  anchorId?: string | null;
  /** Open incidents for the summary row. Omitted when the count is not meaningful. */
  incidentCount?: number;
}

export const DependencyGraph: React.FC<Props> = ({
  registry, dependencyLinks, applications, servers, isDark, selectedId, onSelect,
  simulatedRootId = null, simulatedAffectedIds, visualStatus, remotePaths = true,
  anchorId = null, incidentCount,
}) => {
  const [paths, setPaths] = useState<RegistryPaths | null>(null);
  const [pathError, setPathError] = useState('');
  const [pathsLoading, setPathsLoading] = useState(false);
  const [scale, setScale] = useState(1);
  const frameRef = useRef<HTMLDivElement>(null);
  const fittedRef = useRef(true);
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const ink = isDark ? 'text-slate-100' : 'text-slate-900';

  const placed = useMemo(() => {
    const laneOf = anchorId
      ? focusLanes(registry, dependencyLinks, anchorId)
      : graphColumns(registry, dependencyLinks);
    const byLane = new Map<number, RegistryComponent[]>();
    for (const component of registry) {
      const lane = laneOf.get(component.id) ?? 0;
      const list = byLane.get(lane) ?? [];
      list.push(component);
      byLane.set(lane, list);
    }
    const laneKeys = [...byLane.keys()].sort((a, b) => a - b);
    const indexOf = new Map<string, number>();
    const rebuild = () => {
      indexOf.clear();
      for (const list of byLane.values()) list.forEach((component, index) => indexOf.set(component.id, index));
    };
    const neighborRank = (id: string) => {
      const ranks: number[] = [];
      for (const link of dependencyLinks) {
        const other = link.fromId === id ? link.toId : link.toId === id ? link.fromId : null;
        if (!other) continue;
        const rank = indexOf.get(other);
        if (rank !== undefined) ranks.push(rank);
      }
      if (ranks.length === 0) return null;
      return ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length;
    };
    for (let sweep = 0; sweep < 4; sweep += 1) {
      rebuild();
      for (const lane of laneKeys) {
        byLane.get(lane)!.sort((a, b) => {
          const left = neighborRank(a.id);
          const right = neighborRank(b.id);
          if (left === null && right === null) return a.name.localeCompare(b.name);
          if (left === null) return 1;
          if (right === null) return -1;
          return left - right || a.name.localeCompare(b.name);
        });
      }
    }
    rebuild();
    const compact = new Map<number, number>();
    laneKeys.forEach((lane, index) => compact.set(lane, index));
    const positions = new Map<string, { x: number; y: number }>();
    const maxRows = Math.max(1, ...[...byLane.values()].map(list => list.length));
    const header = anchorId ? 22 : 0;
    for (const lane of laneKeys) {
      const list = byLane.get(lane)!;
      const col = compact.get(lane)!;
      const offset = ((maxRows - list.length) * ROW_H) / 2;
      list.forEach((component, row) => {
        positions.set(component.id, {
          x: PAD_X + col * COL_STEP,
          y: header + offset + row * ROW_H,
        });
      });
    }
    return {
      positions,
      labels: anchorId
        ? laneKeys.map(lane => ({
          key: lane,
          x: PAD_X + (compact.get(lane) ?? 0) * COL_STEP + NODE_W / 2,
          text: LANE_LABELS[lane] ?? '',
        }))
        : [],
      width: PAD_X * 2 + Math.max(laneKeys.length, 1) * COL_STEP - (COL_STEP - NODE_W),
      height: header + maxRows * ROW_H + 12,
    };
  }, [registry, dependencyLinks, anchorId]);

  const fitScale = () => {
    const frame = frameRef.current;
    const width = Math.max(280, frame?.clientWidth || (typeof window === 'undefined' ? placed.width : window.innerWidth - 80));
    const maxHeight = typeof window === 'undefined'
      ? placed.height
      : Math.max(220, Math.min(window.innerHeight * 0.5, 440));
    const next = Math.min(1, width / placed.width, maxHeight / placed.height);
    return Math.round(Math.max(0.45, next) * 100) / 100;
  };

  useEffect(() => {
    fittedRef.current = true;
    const apply = () => {
      if (fittedRef.current) setScale(fitScale());
    };
    apply();
    const observer = new ResizeObserver(apply);
    if (frameRef.current) observer.observe(frameRef.current);
    window.addEventListener('resize', apply);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, [placed.width, placed.height]);

  useEffect(() => {
    if (!remotePaths || !selectedId) {
      setPaths(null);
      setPathError('');
      setPathsLoading(false);
      return;
    }
    let cancel = false;
    setPaths(null);
    setPathError('');
    setPathsLoading(true);
    api.getRegistryPaths(selectedId).then(next => {
      if (!cancel) {
        setPaths(next);
        setPathError('');
      }
    }).catch(err => {
      if (!cancel) {
        setPaths(null);
        setPathError(err instanceof Error ? err.message : 'Could not load dependency paths');
      }
    }).finally(() => {
      if (!cancel) setPathsLoading(false);
    });
    return () => { cancel = true; };
  }, [selectedId, remotePaths]);

  const selected = registry.find(c => c.id === selectedId) ?? null;
  const nameOf = (id: string) => registry.find(c => c.id === id)?.name ?? 'Unknown';
  const palette = isDark
    ? {
      ink: '#E4EAF2', muted: '#93A0B2', line: '#2A3746', edge: '#435264', surface: '#17202B', accent: '#7EA0FF',
      ok: '#3CBA7E', warn: '#E59B32', bad: '#F06A5A', unk: '#9097AD',
      warnBg: '#35270F', badBg: '#3A1A17', unkBg: '#232A36', maint: '#7EA0FF', maintBg: '#1A2740',
    }
    : {
      ink: '#162030', muted: '#566275', line: '#CDD5DF', edge: '#A3AEBD', surface: '#F8FAFC', accent: '#2A57C9',
      ok: '#1C8657', warn: '#B26700', bad: '#C2372A', unk: '#69718A',
      warnBg: '#FBEEDB', badBg: '#FAE3E0', unkBg: '#E7E9F0', maint: '#2A57C9', maintBg: '#E7EEFB',
    };
  const cards = registry.map(component => {
    const visual = visualStatus?.get(component.id);
    const live = liveRegistryStatus(component, applications, servers);
    const simulated = !visual && (simulatedRootId === component.id || simulatedAffectedIds?.has(component.id));
    const titleStatus = visual ? demoVisualLabel(visual) : live;
    let tone: 'healthy' | 'degraded' | 'down' | 'potential' | 'unknown' | 'maintenance' | 'stale' = 'unknown';
    let label = 'Unknown';
    if (visual === 'SIMULATED_FAILURE' || visual === 'SIMULATED_CRITICAL') {
      tone = 'down';
      label = visual === 'SIMULATED_FAILURE' ? 'Simulated failure' : 'Simulated critical';
    } else if (visual === 'SIMULATED_WARNING') {
      tone = 'potential';
      label = 'Potential impact';
    } else if (!visual && live === 'HEALTHY') {
      tone = 'healthy';
      label = 'Healthy';
    } else if (!visual && live === 'WARNING') {
      tone = 'degraded';
      label = 'Degraded';
    } else if (!visual && live === 'CRITICAL') {
      tone = 'down';
      label = 'Down';
    } else if (!visual && live === 'STALE') {
      tone = 'stale';
      label = 'Stale';
    } else if (!visual && live === 'MAINTENANCE') {
      tone = 'maintenance';
      label = 'Maintenance';
    }
    if (simulated) label = `${label} · SIMULATED`;
    const fill = tone === 'degraded' || tone === 'stale' ? palette.warnBg
      : tone === 'down' ? palette.badBg
        : tone === 'maintenance' ? palette.maintBg
          : tone === 'unknown' || tone === 'potential' ? (tone === 'unknown' ? palette.unkBg : palette.surface)
            : palette.surface;
    const border = tone === 'healthy' ? palette.line
      : tone === 'degraded' || tone === 'stale' || tone === 'potential' ? palette.warn
        : tone === 'down' ? palette.bad
          : tone === 'maintenance' ? palette.maint
            : palette.unk;
    const strip = tone === 'healthy' ? palette.ok
      : tone === 'degraded' || tone === 'stale' || tone === 'potential' ? palette.warn
        : tone === 'down' ? palette.bad
          : tone === 'maintenance' ? palette.maint
            : palette.unk;
    return { component, tone, label, titleStatus, fill, border, strip, dashed: tone === 'unknown' || tone === 'potential' || tone === 'stale' };
  });
  const chipCount = (tone: (typeof cards)[number]['tone']) => cards.filter(card => card.tone === tone).length;
  const drawnLinks = dependencyLinks.filter(link => placed.positions.has(link.toId) && placed.positions.has(link.fromId));
  const outs = new Map<string, DependencyLink[]>();
  const ins = new Map<string, DependencyLink[]>();
  for (const link of drawnLinks) {
    const outList = outs.get(link.toId) ?? [];
    outList.push(link);
    outs.set(link.toId, outList);
    const inList = ins.get(link.fromId) ?? [];
    inList.push(link);
    ins.set(link.fromId, inList);
  }

  if (registry.length === 0) {
    return (
      <p className={`text-sm ${muted}`}>
        Nothing is in the dependency register yet. Relationships have not been documented. This does not mean the applications have no dependencies.
      </p>
    );
  }

  const chip = (color: string, count: number, name: string, dashed = false) => (
    <span className="inline-flex items-center">
      <i
        aria-hidden="true"
        className="inline-block rounded-full mr-1.5"
        style={{
          width: 9,
          height: 9,
          background: dashed ? 'transparent' : color,
          border: dashed ? `2px dashed ${color}` : undefined,
        }}
      />
      <b style={{ color: palette.ink, fontWeight: 620 }}>{count}</b>
      <span className="ml-1">{name}</span>
    </span>
  );

  return (
    <div className="space-y-3 font-sans">
      <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13.5px]" style={{ color: palette.muted }}>
        <span><b style={{ color: palette.ink, fontWeight: 620 }}>{cards.length}</b> components</span>
        {chip(palette.ok, chipCount('healthy'), 'healthy')}
        {chip(palette.warn, chipCount('degraded') + chipCount('stale'), 'degraded')}
        {chip(palette.bad, chipCount('down'), 'down')}
        {chip(palette.warn, chipCount('potential'), 'potential impact', true)}
        {chip(palette.unk, chipCount('unknown'), 'unknown')}
        {incidentCount != null && (
          <span><b style={{ color: palette.ink, fontWeight: 620 }}>{incidentCount}</b> active {incidentCount === 1 ? 'incident' : 'incidents'}</span>
        )}
      </div>
      <div ref={frameRef} className="w-full min-w-0 overflow-hidden" data-testid="dependency-graph">
        <div style={{ width: placed.width * scale, height: placed.height * scale }}>
        <div className="relative" style={{ width: placed.width, height: placed.height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          {placed.labels.map(label => (
            <div
              key={label.key}
              className="absolute text-[12px] font-medium"
              style={{ left: label.x, top: 0, transform: 'translateX(-50%)', color: palette.muted }}
            >
              {label.text}
            </div>
          ))}
          <svg className="absolute inset-0 pointer-events-none" width={placed.width} height={placed.height} aria-hidden="true">
            {drawnLinks.map(link => {
              const from = placed.positions.get(link.toId)!;
              const to = placed.positions.get(link.fromId)!;
              const outList = outs.get(link.toId) ?? [link];
              const inList = ins.get(link.fromId) ?? [link];
              const outIndex = outList.indexOf(link);
              const inIndex = inList.indexOf(link);
              const y1 = from.y + NODE_H / 2 + (outIndex - (outList.length - 1) / 2) * 7;
              const y2 = to.y + NODE_H / 2 + (inIndex - (inList.length - 1) / 2) * 9;
              const x1 = from.x + NODE_W;
              const x2 = to.x;
              const sameColumn = Math.abs(from.x - to.x) < 4;
              const dx = (x2 - x1) * 0.5;
              const path = sameColumn
                ? `M ${from.x + NODE_W / 2} ${from.y + NODE_H} C ${from.x + NODE_W / 2} ${from.y + NODE_H + 36}, ${to.x + NODE_W / 2} ${to.y + NODE_H + 36}, ${to.x + NODE_W / 2} ${to.y + NODE_H}`
                : `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
              const label = [link.type, dependencyMethodLabel(link.method)].join(' · ');
              return (
                <path
                  key={link.id}
                  d={path}
                  fill="none"
                  stroke={palette.edge}
                  strokeWidth={1.6}
                  strokeDasharray={link.type === 'SOFT' ? '6 5' : undefined}
                >
                  <title>{`${nameOf(link.toId)} → ${nameOf(link.fromId)} · ${label}`}</title>
                </path>
              );
            })}
          </svg>
          {cards.map(card => {
            const pos = placed.positions.get(card.component.id);
            if (!pos) return null;
            const selectedCard = selectedId === card.component.id;
            const statusColor = card.tone === 'healthy' || card.tone === 'unknown' ? palette.muted : card.strip;
            return (
              <button
                key={card.component.id}
                type="button"
                onClick={() => onSelect(card.component.id)}
                className="absolute text-left cursor-pointer overflow-hidden"
                style={{
                  left: pos.x,
                  top: pos.y,
                  width: NODE_W,
                  height: NODE_H,
                  background: card.fill,
                  border: `${selectedCard ? 2.6 : 1.3}px ${card.dashed && !selectedCard ? 'dashed' : 'solid'} ${selectedCard ? palette.accent : card.border}`,
                  borderRadius: 9,
                }}
                aria-pressed={selectedCard}
                title={`${card.component.name} · ${card.titleStatus}`}
              >
                <span aria-hidden="true" className="absolute left-0 top-0 bottom-0" style={{ width: 6, background: card.strip }} />
                <span className="block truncate pl-3.5 pr-2 pt-1.5 text-[13px] font-semibold leading-none" style={{ color: palette.ink }}>{card.component.name}</span>
                <span className="block truncate pl-3.5 pr-2 pt-1 text-[11px] leading-none" style={{ color: statusColor, fontWeight: card.tone === 'healthy' || card.tone === 'unknown' ? 400 : 600 }}>{card.label}</span>
              </button>
            );
          })}
        </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]" style={{ color: palette.muted }}>
        <span className="inline-flex items-center gap-1.5">
          <svg width="34" height="8" aria-hidden="true"><line x1="0" y1="4" x2="34" y2="4" stroke={palette.edge} strokeWidth="2" /></svg>
          Hard dependency
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="34" height="8" aria-hidden="true"><line x1="0" y1="4" x2="34" y2="4" stroke={palette.edge} strokeWidth="2" strokeDasharray="6 5" /></svg>
          Soft dependency
        </span>
        <span>Impact flows left to right, provider → consumer.</span>
        <button type="button" onClick={() => { fittedRef.current = false; setScale(value => Math.min(1.15, Math.round((value + 0.08) * 100) / 100)); }} className="cursor-pointer underline-offset-2 hover:underline">Zoom in</button>
        <button type="button" onClick={() => { fittedRef.current = false; setScale(value => Math.max(0.4, Math.round((value - 0.08) * 100) / 100)); }} className="cursor-pointer underline-offset-2 hover:underline">Zoom out</button>
        <button type="button" onClick={() => { fittedRef.current = true; setScale(fitScale()); }} className="cursor-pointer underline-offset-2 hover:underline">Fit to screen</button>
      </div>
      {dependencyLinks.length === 0 && (
        <p className={`text-xs ${muted}`}>
          No dependencies recorded yet.
        </p>
      )}
      {selected && (
        <div className={`rounded border p-3 text-xs space-y-2 ${isDark ? 'border-[#1E293B] bg-[#0B0F17]' : 'border-slate-200 bg-slate-50'}`}>
          <div className={`font-semibold ${ink}`}>{selected.name}</div>
          <div className={muted}>
            {[
              selected.kind.replaceAll('_', ' '),
              selected.owner,
              selected.tier,
              selected.userCount != null ? `${selected.userCount.toLocaleString()} users` : '',
              selected.endpoint,
            ].filter(Boolean).join(' · ')}
          </div>
          {(() => {
            const shown = visualStatus?.get(selected.id);
            const shownLabel = shown ? demoVisualLabel(shown) : liveRegistryStatus(selected, applications, servers);
            const shownTone = shown === 'SIMULATED_FAILURE' || shown === 'SIMULATED_CRITICAL'
              ? 'CRITICAL'
              : shown === 'SIMULATED_WARNING'
                ? 'WARNING'
                : shown
                  ? 'UNKNOWN'
                  : liveRegistryStatus(selected, applications, servers);
            const live = applications.find(app => app.name === selected.name);
            const prd = live ? servers.find(server => server.id === live.prdServerId) : undefined;
            const dr = live ? servers.find(server => server.id === live.drServerId) : undefined;
            return (
              <>
                <div className={statusInk(shownTone)}>Status: {shownLabel}</div>
                {live && (
                  <div className={muted}>
                    Runs on {prd?.hostname ?? 'no production server'} / {dr?.hostname ?? 'no recovery server'}.
                  </div>
                )}
              </>
            );
          })()}
          <div>
            <div className={`font-semibold ${muted}`}>Depends on</div>
            {dependencyLinks.filter(l => l.fromId === selected.id).length === 0
              ? <div className={muted}>Nothing recorded. This does not mean there are no dependencies.</div>
              : dependencyLinks.filter(l => l.fromId === selected.id).map(l => (
                <div key={l.id}>{selected.name} → {nameOf(l.toId)} · {[l.type, dependencyMethodLabel(l.method), l.featureId ? `feature ${nameOf(l.featureId)}` : '', l.criticality, l.failureBehaviour ? `users see ${l.failureBehaviour}` : '', l.notes || 'rationale not recorded'].filter(Boolean).join(' · ')}</div>
              ))}
          </div>
          <div>
            <div className={`font-semibold ${muted}`}>Used by</div>
            {dependencyLinks.filter(l => l.toId === selected.id).length === 0
              ? <div className={muted}>Nothing recorded. This does not mean nothing depends on it.</div>
              : dependencyLinks.filter(l => l.toId === selected.id).map(l => (
                <div key={l.id}>{nameOf(l.fromId)} → {selected.name} · {[l.type, dependencyMethodLabel(l.method), l.criticality, l.featureId ? `feature ${nameOf(l.featureId)}` : '', l.failureBehaviour ? `users see ${l.failureBehaviour}` : '', l.notes || 'rationale not recorded'].filter(Boolean).join(' · ')}</div>
              ))}
          </div>
          <div className={`space-y-1 break-words ${muted}`}>
            {pathsLoading && <div>Loading dependency paths…</div>}
            {pathError && <div className="text-rose-500">{pathError}</div>}
            {paths && (
              <>
                <div>Upstream: {paths.upstream.length === 0 ? 'none' : paths.upstream.map(n => `${n.name} (${n.status}, ${n.via})`).join(' · ')}</div>
                <div>Downstream: {paths.downstream.length === 0 ? 'none' : paths.downstream.map(n => `${n.name} (${n.status}, ${n.via})`).join(' · ')}</div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
