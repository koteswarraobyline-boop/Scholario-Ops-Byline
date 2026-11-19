/**
 * Rows for the Dependency Register page.
 * Links come from GET /api/v1/dependency-links. Application names come from the
 * register component at each end and the application that component is bound to.
 * fromId is the consumer. toId is the provider.
 */
import type { Application, DependencyCriticality, DependencyLink, DependencyMethod, RegistryComponent, RegistryKind } from '../types/index.ts';
import { dependencyMethodLabel } from './serviceDependencies.ts';

export const REGISTER_KIND_LABEL: Record<RegistryKind, string> = {
  APPLICATION: 'Application',
  BUSINESS_FEATURE: 'Business feature',
  SERVER: 'Server',
  DATABASE: 'Database',
  STORAGE: 'Storage',
  THIRD_PARTY_API: 'Third-party API',
  PROVIDER: 'Provider',
};

export const FEATURE_NOT_LIMITED = 'Not limited to one feature';

export interface DependencyPartyView {
  componentId: string;
  componentName: string;
  kind: RegistryKind | null;
  kindLabel: string;
  owner: string;
  endpoint: string;
  applicationId: string | null;
  applicationName: string | null;
  codeName: string | null;
  tier: string | null;
  status: string | null;
  missing: boolean;
}

export interface DependencyRegisterRow {
  id: string;
  type: 'HARD' | 'SOFT';
  featureId: string | null;
  featureName: string | null;
  method: DependencyMethod | null;
  criticality: DependencyCriticality | null;
  /** Person or team accountable for this dependency. Empty means not recorded. */
  owner: string;
  healthCheck: string;
  failureBehaviour: string;
  recoveryExpectation: string;
  notes: string;
  updatedAt: string;
  consumer: DependencyPartyView;
  provider: DependencyPartyView;
}

type AppBrief = Pick<Application, 'id' | 'name' | 'codeName' | 'tier' | 'status'>;

export type DependencyTypeFilter = 'ALL' | 'HARD' | 'SOFT';
export type DependencySortKey = 'consumer' | 'provider' | 'type' | 'feature' | 'method';
export type DependencySortDirection = 'asc' | 'desc';

const tierLabel = (tier: string) => tier.replace('TIER_', 'Tier ');

function partyOf(
  id: string,
  byId: ReadonlyMap<string, RegistryComponent>,
  applications: ReadonlyMap<string, AppBrief>,
): DependencyPartyView {
  const component = byId.get(id);
  const app = component?.applicationId ? applications.get(component.applicationId) : undefined;
  return {
    componentId: id,
    componentName: component?.name ?? 'Unknown',
    kind: component?.kind ?? null,
    kindLabel: component ? REGISTER_KIND_LABEL[component.kind] : '',
    owner: component?.owner ?? '',
    endpoint: component?.endpoint ?? '',
    applicationId: app?.id ?? null,
    applicationName: app?.name ?? null,
    codeName: app?.codeName ?? null,
    tier: app?.tier ?? null,
    status: app?.status ?? null,
    missing: !component,
  };
}

/** Application name when the end is bound to one, otherwise the register entry name. */
export function partyHeading(party: DependencyPartyView): string {
  return party.applicationName || party.componentName;
}

/** Secondary lines: application code, tier, and status, or the register kind when there is no application. */
export function partyMeta(party: DependencyPartyView): string[] {
  if (party.missing) return ['Not in the register'];
  if (party.applicationId) {
    const lines: string[] = [];
    const identity = [party.codeName, party.tier ? tierLabel(party.tier) : '', party.status].filter(Boolean);
    if (identity.length) lines.push(identity.join(' · '));
    if (party.kind && party.kind !== 'APPLICATION') lines.push(`${party.kindLabel} · ${party.componentName}`);
    return lines;
  }
  const kind = [party.kindLabel, party.owner].filter(Boolean).join(' · ');
  return [kind, party.endpoint, 'No application record'].filter(Boolean);
}

export function featureLabel(row: Pick<DependencyRegisterRow, 'featureId' | 'featureName'> & { consumer?: Pick<DependencyPartyView, 'kind' | 'componentName'> }): string {
  if (row.featureId) return row.featureName ?? 'Unknown feature';
  if (row.consumer?.kind === 'BUSINESS_FEATURE' && row.consumer.componentName && row.consumer.componentName !== 'Unknown') {
    return row.consumer.componentName;
  }
  return FEATURE_NOT_LIMITED;
}

function impactWords(row: DependencyRegisterRow): string {
  if (row.type === 'HARD') return 'hard stops';
  return featureLabel(row) === FEATURE_NOT_LIMITED ? 'soft keeps running' : 'soft feature stops';
}

export function dependencyRegisterRows(
  links: readonly DependencyLink[],
  registry: readonly RegistryComponent[],
  applications: readonly AppBrief[],
): DependencyRegisterRow[] {
  const byId = new Map(registry.map(component => [component.id, component]));
  const apps = new Map(applications.map(app => [app.id, app]));
  return links.map(link => {
    const feature = link.featureId ? byId.get(link.featureId) : undefined;
    return {
      id: link.id,
      type: link.type,
      featureId: link.featureId,
      featureName: feature?.kind === 'BUSINESS_FEATURE' ? feature.name : null,
      method: link.method,
      criticality: link.criticality ?? null,
      owner: link.owner ?? '',
      healthCheck: link.healthCheck ?? '',
      failureBehaviour: link.failureBehaviour ?? '',
      recoveryExpectation: link.recoveryExpectation ?? '',
      notes: link.notes,
      updatedAt: link.updatedAt,
      consumer: partyOf(link.fromId, byId, apps),
      provider: partyOf(link.toId, byId, apps),
    };
  });
}

function haystack(row: DependencyRegisterRow): string {
  const partyBits = (party: DependencyPartyView) => [
    partyHeading(party),
    ...partyMeta(party),
    party.componentName,
    party.kindLabel,
    party.owner,
    party.endpoint,
    party.codeName,
    party.status,
    party.applicationName,
  ];
  return [
    ...partyBits(row.consumer),
    ...partyBits(row.provider),
    featureLabel(row),
    impactWords(row),
    row.type,
    row.criticality ?? '',
    row.owner,
    row.healthCheck,
    row.failureBehaviour,
    row.recoveryExpectation,
    row.method ?? '',
    dependencyMethodLabel(row.method),
    row.notes,
  ].join(' ').toLowerCase();
}

export function filterDependencyRegister(
  rows: readonly DependencyRegisterRow[],
  options: { query: string; type: DependencyTypeFilter; applicationId: string },
): DependencyRegisterRow[] {
  const needle = options.query.trim().toLowerCase();
  return rows.filter(row => {
    if (options.type !== 'ALL' && row.type !== options.type) return false;
    if (options.applicationId && row.consumer.applicationId !== options.applicationId && row.provider.applicationId !== options.applicationId) return false;
    if (needle && !haystack(row).includes(needle)) return false;
    return true;
  });
}

function sortValue(row: DependencyRegisterRow, key: DependencySortKey): string {
  if (key === 'consumer') return partyHeading(row.consumer);
  if (key === 'provider') return partyHeading(row.provider);
  if (key === 'type') return row.type;
  if (key === 'method') return dependencyMethodLabel(row.method);
  return featureLabel(row);
}

/** Same key for the same links and register entries, whatever order they arrived in. */
export function registerLiveKey(
  links: readonly Pick<DependencyLink, 'id' | 'updatedAt' | 'fromId' | 'toId' | 'type' | 'featureId' | 'method' | 'criticality' | 'owner' | 'notes'>[],
  components: readonly Pick<RegistryComponent, 'id' | 'updatedAt' | 'name' | 'applicationId' | 'kind'>[],
): string {
  const linkKey = links
    .map(link => [link.id, link.updatedAt, link.fromId, link.toId, link.type, link.featureId ?? '', link.method ?? '', link.criticality ?? '', link.owner, link.notes].join('\u001f'))
    .sort()
    .join('\u001e');
  const componentKey = components
    .map(component => [component.id, component.updatedAt, component.name, component.applicationId ?? '', component.kind].join('\u001f'))
    .sort()
    .join('\u001e');
  return `${linkKey}#${componentKey}`;
}

export function dependencyTypeFilter(value: string | null | undefined): DependencyTypeFilter {
  return value === 'HARD' || value === 'SOFT' ? value : 'ALL';
}

const textOrder = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

export function sortDependencyRegister(
  rows: readonly DependencyRegisterRow[],
  key: DependencySortKey,
  direction: DependencySortDirection,
): DependencyRegisterRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = textOrder(sortValue(a, key), sortValue(b, key));
    if (primary !== 0) return primary * sign;
    const consumer = textOrder(partyHeading(a.consumer), partyHeading(b.consumer));
    if (consumer !== 0) return consumer;
    const provider = textOrder(partyHeading(a.provider), partyHeading(b.provider));
    if (provider !== 0) return provider;
    return textOrder(a.id, b.id);
  });
}
