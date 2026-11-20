/**
 * Register links for one application record.
 * `GET /api/v1/applications/:id` and the application Dependencies tab both use this,
 * so the screen and the API stay the same record.
 * This is not `Application.dependencies`, which is the derived monitor list.
 */
import type {
  ApplicationFeatureUsage,
  ApplicationServiceDependencies,
  ApplicationServiceDependency,
  DependencyLink,
  DependencyMethod,
  OperationalStatus,
  RegistryComponent,
  RegistryLiveStatus,
} from '../types/index.ts';

type StatusRow = { id: string; status: OperationalStatus };

function toLive(status: OperationalStatus): RegistryLiveStatus {
  if (status === 'MAINTENANCE') return 'MAINTENANCE';
  if (status === 'CRITICAL') return 'CRITICAL';
  if (status === 'WARNING' || status === 'STALE') return 'WARNING';
  if (status === 'HEALTHY') return 'HEALTHY';
  return 'UNKNOWN';
}

/** Live colour of a register entry. A database, API, or provider with no monitor of its own is UNKNOWN. */
export function registryLiveStatus(
  component: RegistryComponent,
  applications: readonly StatusRow[],
  servers: readonly StatusRow[],
): RegistryLiveStatus {
  if (component.kind === 'APPLICATION' && component.applicationId) {
    const app = applications.find(a => a.id === component.applicationId);
    return app ? toLive(app.status) : 'UNKNOWN';
  }
  if (component.kind === 'SERVER' && component.serverId) {
    const srv = servers.find(s => s.id === component.serverId);
    return srv ? toLive(srv.status) : 'UNKNOWN';
  }
  if (component.applicationId) {
    const app = applications.find(a => a.id === component.applicationId);
    if (app) return toLive(app.status);
  }
  return 'UNKNOWN';
}

/**
 * A named feature may sit on a link only when it belongs to the consumer.
 * Both ends unbound is allowed. A feature of a different application is not.
 */
export function dependencyFeatureAllowed(
  feature: Pick<RegistryComponent, 'kind' | 'applicationId'>,
  consumer: Pick<RegistryComponent, 'applicationId'>,
): boolean {
  if (feature.kind !== 'BUSINESS_FEATURE') return false;
  if ((consumer.applicationId || feature.applicationId) && feature.applicationId !== consumer.applicationId) return false;
  return true;
}

export function projectServiceDependencies(
  applicationId: string,
  input: {
    applications: readonly StatusRow[];
    servers: readonly StatusRow[];
    registry: readonly RegistryComponent[];
    links: readonly DependencyLink[];
  },
): ApplicationServiceDependencies {
  const component = input.registry.find(c => c.kind === 'APPLICATION' && c.applicationId === applicationId) ?? null;
  const byId = new Map(input.registry.map(c => [c.id, c]));
  const applicationIds = new Set(input.applications.map(a => a.id));
  const row = (link: DependencyLink, direction: 'outgoing' | 'incoming'): ApplicationServiceDependency => {
    const other = byId.get(direction === 'outgoing' ? link.toId : link.fromId);
    const feature = link.featureId ? byId.get(link.featureId) : undefined;
    const boundApplicationId = other?.applicationId ?? null;
    return {
      id: link.id,
      direction,
      type: link.type,
      method: link.method,
      notes: link.notes,
      featureId: link.featureId,
      featureName: feature?.kind === 'BUSINESS_FEATURE' ? feature.name : null,
      otherId: other?.id ?? (direction === 'outgoing' ? link.toId : link.fromId),
      otherName: other?.name ?? 'Unknown',
      otherKind: other?.kind ?? null,
      otherApplicationId: boundApplicationId && applicationIds.has(boundApplicationId) ? boundApplicationId : null,
      otherEndpoint: other?.endpoint ?? '',
      criticality: link.criticality ?? null,
      healthCheck: link.healthCheck ?? '',
      failureBehaviour: link.failureBehaviour ?? '',
      owner: link.owner ?? '',
      recoveryExpectation: link.recoveryExpectation ?? '',
      status: other ? registryLiveStatus(other, input.applications, input.servers) : 'UNKNOWN',
    };
  };
  const features: ApplicationFeatureUsage[] = input.registry
    .filter(c => c.kind === 'BUSINESS_FEATURE' && c.applicationId === applicationId)
    .map(feature => {
      const seen = new Set<string>();
      const uses = input.links.filter(link => {
        const named = link.featureId === feature.id;
        const fromFeature = link.fromId === feature.id;
        if (!named && !fromFeature) return false;
        if (seen.has(link.id)) return false;
        seen.add(link.id);
        return true;
      }).map(link => row(link, 'outgoing'));
      return { id: feature.id, name: feature.name, owner: feature.owner, uses };
    });
  const view: ApplicationServiceDependencies = {
    applicationId,
    componentId: component?.id ?? null,
    applicationLevel: [],
    features,
    outgoing: component ? input.links.filter(l => l.fromId === component.id).map(l => row(l, 'outgoing')) : [],
    incoming: component ? input.links.filter(l => l.toId === component.id).map(l => row(l, 'incoming')) : [],
  };
  view.applicationLevel = wholeApplicationLinks(view);
  return view;
}

/**
 * Links that can change the application itself.
 * Hard stops it, including a Hard link that names a feature or starts from a feature.
 * Soft with no feature only degrades it.
 * Soft that names a feature, or a Soft link from a feature, stays on that feature.
 */
export function wholeApplicationLinks(view: ApplicationServiceDependencies): ApplicationServiceDependency[] {
  const seen = new Set<string>();
  const rows: ApplicationServiceDependency[] = [];
  const add = (link: ApplicationServiceDependency) => {
    if (seen.has(link.id)) return;
    seen.add(link.id);
    rows.push(link);
  };
  for (const link of view.outgoing) {
    if (link.type === 'SOFT' && link.featureId) continue;
    add(link);
  }
  for (const feature of view.features) {
    for (const link of feature.uses) {
      if (link.type === 'HARD') add(link);
    }
  }
  return rows;
}

export function dependencyMethodLabel(method: DependencyMethod | null): string {
  return method ?? 'method not recorded';
}

/**
 * The same consumer may depend on one provider twice when the feature differs.
 * A new feature is not a duplicate of the whole-project link.
 * `links` are the consumer's existing outgoing links.
 */
export function providerBlockedForFeature(
  links: readonly Pick<DependencyLink, 'toId' | 'featureId'>[],
  toId: string,
  featureId: string | null | 'new',
): boolean {
  if (featureId === 'new') return false;
  const feature = featureId || null;
  return links.some(link => link.toId === toId && (link.featureId ?? null) === feature);
}
