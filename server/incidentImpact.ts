/**
 * Incident Impact Analysis + dependency paths + "what will break" preview.
 * Pure against the in-memory store; never mutates unless attachImpactToIncident is called.
 */
import crypto from 'crypto';
import type {
  Environment, Incident, IncidentFixStep, IncidentImpactSnapshot,
  ApplicationServiceDependencies, ImpactPreview, LikelyCause, RegistryComponent, RegistryImpact, RegistryLiveStatus, RegistryPathNode, RegistryPaths,
  RootCauseCategory,
} from '../src/types/index.ts';
import { inferRootCauseCategory } from '../src/lib/rootCause.ts';
import { featureAction } from '../src/lib/featureAction.ts';
import { suggestSeverity } from '../src/lib/severity.ts';
import { projectServiceDependencies, registryLiveStatus } from '../src/lib/serviceDependencies.ts';
import { db } from './store.ts';
import { registryImpact } from './registry.ts';
import { likelyCauseForIncident } from './likelyCause.ts';

export { inferRootCauseCategory, ROOT_CAUSE_CATEGORIES, ROOT_CAUSE_LABELS } from '../src/lib/rootCause.ts';

/** Affected business features, each with the action the dependency implies. */
export function featuresWithActions(component: RegistryComponent, impact: RegistryImpact | null) {
  const rows = (impact?.affected ?? [])
    .filter(a => a.kind === 'BUSINESS_FEATURE')
    .map(a => ({ id: a.id, name: a.name, via: a.via, action: featureAction(a.name, a.via, component.name) }));
  if (component.kind === 'BUSINESS_FEATURE' && !rows.some(f => f.id === component.id)) {
    rows.unshift({
      id: component.id, name: component.name, via: 'HARD' as const,
      action: featureAction(component.name, 'HARD', component.name),
    });
  }
  return rows;
}

/** Prefer the APPLICATION register entry for an app; fall back to its PRD/DR server entry. */
export function registryComponentForScope(scope: {
  applicationId?: string;
  serverId?: string;
  registryId?: string;
  environment?: Environment;
}): RegistryComponent | null {
  if (scope.registryId) {
    return db.registry.find(c => c.id === scope.registryId) ?? null;
  }
  if (scope.applicationId) {
    const appComp = db.registry.find(c => c.kind === 'APPLICATION' && c.applicationId === scope.applicationId);
    if (appComp) return appComp;
    const app = db.applications.find(a => a.id === scope.applicationId);
    if (app) {
      const env = scope.environment ?? 'PRD';
      const sid = env === 'DR' ? app.drServerId : app.prdServerId;
      if (sid) {
        const srvComp = db.registry.find(c => c.kind === 'SERVER' && c.serverId === sid);
        if (srvComp) return srvComp;
      }
    }
  }
  if (scope.serverId) {
    return db.registry.find(c => c.kind === 'SERVER' && c.serverId === scope.serverId) ?? null;
  }
  return null;
}

/** Application record id when the register entry is bound; otherwise the register id. */
function applicationRecordId(component: RegistryComponent): string {
  return component.applicationId && db.applications.some(a => a.id === component.applicationId)
    ? component.applicationId
    : component.id;
}

export function snapshotFromImpact(impact: RegistryImpact, component: RegistryComponent): IncidentImpactSnapshot {
  const applications = impact.affected
    .filter(a => a.kind === 'APPLICATION')
    .map(a => {
      const entry = db.registry.find(c => c.id === a.id);
      return { id: entry ? applicationRecordId(entry) : a.id, name: a.name, via: a.via };
    });
  // Include the failed component itself when it is an application
  if (component.kind === 'APPLICATION') {
    const id = applicationRecordId(component);
    if (!applications.some(a => a.id === id)) applications.unshift({ id, name: component.name, via: 'HARD' });
  }
  const features = featuresWithActions(component, impact);
  return {
    componentId: component.id,
    componentName: component.name,
    applications,
    features,
    usersStopped: impact.largestUserCountStopped,
    usersAffected: impact.largestUserCountAffected,
    served: impact.served,
    hardCount: impact.affected.filter(a => a.via === 'HARD').length + (component.kind === 'APPLICATION' || component.kind === 'BUSINESS_FEATURE' ? 1 : 0),
    softCount: impact.affected.filter(a => a.via === 'SOFT').length,
    capturedAt: new Date().toISOString(),
  };
}

/** Build (or empty) Impact Analysis for an application / server scope. */
export function buildImpactSnapshot(scope: {
  applicationId?: string;
  serverId?: string;
  registryId?: string;
  environment?: Environment;
}): IncidentImpactSnapshot {
  const component = registryComponentForScope(scope);
  if (!component) {
    return {
      componentId: null, componentName: null, applications: [], features: [],
      usersStopped: null, usersAffected: null, served: [], hardCount: 0, softCount: 0,
      capturedAt: new Date().toISOString(),
    };
  }
  const impact = registryImpact(component.id);
  if (!impact) {
    return {
      componentId: component.id, componentName: component.name, applications: [], features: [],
      usersStopped: component.userCount, usersAffected: component.userCount, served: component.served,
      hardCount: 0, softCount: 0, capturedAt: new Date().toISOString(),
    };
  }
  return snapshotFromImpact(impact, component);
}

/** Owners of the failed component and of every affected application and feature. */
export function ownersForIncident(incident: Incident): string[] {
  const names = new Set<string>();
  const add = (value?: string | null) => {
    const owner = value?.trim();
    if (owner && owner !== 'Unassigned' && owner !== '—') names.add(owner);
  };
  const snap = incident.impactAnalysis;
  const ids = new Set<string>();
  if (snap?.componentId) ids.add(snap.componentId);
  for (const row of snap?.applications ?? []) ids.add(row.id);
  for (const row of snap?.features ?? []) ids.add(row.id);
  for (const id of ids) add(db.registry.find(c => c.id === id)?.owner);
  if (incident.applicationId) {
    for (const c of db.registry) {
      if (c.applicationId === incident.applicationId && (c.kind === 'APPLICATION' || c.kind === 'BUSINESS_FEATURE')) add(c.owner);
    }
  }
  const credId = incident.fingerprint?.startsWith('credential-expired:') || incident.fingerprint?.startsWith('credential-expiry:')
    ? incident.fingerprint.split(':')[1]
    : '';
  if (credId) add(db.credentials.find(c => c.id === credId)?.owner);
  return [...names];
}

function sameCause(a: LikelyCause | undefined, b: LikelyCause): boolean {
  if (!a) return false;
  if (a.summary !== b.summary || a.confidence !== b.confidence || a.category !== b.category) return false;
  if (a.evidence.length !== b.evidence.length) return false;
  return a.evidence.every((item, i) => item.source === b.evidence[i].source && item.detail === b.evidence[i].detail && item.score === b.evidence[i].score);
}

/**
 * Keep an open incident's suggested cause current, and fill a missing feature action
 * on incidents that were stored before that field existed. Does not replace a category
 * an operator (or an earlier inference) already set, unless it is still UNKNOWN.
 */
export function refreshIncidentAdvice(incident: Incident, options: { refreshCause: boolean }): boolean {
  let changed = false;
  if (options.refreshCause) {
    const next = likelyCauseForIncident(incident);
    if (!sameCause(incident.likelyCause, next)) {
      incident.likelyCause = next;
      changed = true;
      if ((!incident.rootCauseCategory || incident.rootCauseCategory === 'UNKNOWN') && (next.confidence === 'HIGH' || next.confidence === 'MEDIUM')) {
        incident.rootCauseCategory = next.category;
      }
    }
  }
  const snap = incident.impactAnalysis;
  if (snap) {
    const cause = snap.componentName || 'the failed component';
    for (const feature of snap.features) {
      if (!feature.action) {
        feature.action = featureAction(feature.name, feature.via, cause);
        changed = true;
      }
    }
  }
  return changed;
}

/** Attach category (if missing), Impact Analysis, suggested severity, and owners onto a newly opened incident. */
export function enrichNewIncident(incident: Incident, hint?: { source?: string; applySuggestion?: boolean }): Incident {
  const categoryChosen = Boolean(incident.rootCauseCategory);
  if (!incident.rootCauseCategory) {
    incident.rootCauseCategory = inferRootCauseCategory({
      source: hint?.source,
      fingerprint: incident.fingerprint,
      detail: incident.rootCause,
      title: incident.title,
    });
  }
  incident.likelyCause = likelyCauseForIncident(incident);
  if (!categoryChosen && (incident.likelyCause.confidence === 'HIGH' || incident.likelyCause.confidence === 'MEDIUM')) {
    incident.rootCauseCategory = incident.likelyCause.category;
  }
  incident.impactAnalysis = buildImpactSnapshot({
    applicationId: incident.applicationId || undefined,
    environment: incident.environment,
  });
  // Fill affectedServices from Impact Analysis when empty
  if (!incident.affectedServices.length && incident.impactAnalysis) {
    const names = [
      ...incident.impactAnalysis.applications.map(a => a.name),
      ...incident.impactAnalysis.features.map(f => f.name),
    ];
    if (names.length) incident.affectedServices = [...new Set(names)];
  }
  const app = incident.applicationId ? db.applications.find(a => a.id === incident.applicationId) : undefined;
  const snap = incident.impactAnalysis;
  const suggestion = suggestSeverity({
    tier: app?.tier ?? null,
    environment: incident.environment,
    usersStopped: snap?.usersStopped ?? null,
    usersAffected: snap?.usersAffected ?? null,
    hardCount: snap?.hardCount ?? 0,
    softCount: snap?.softCount ?? 0,
  });
  if (suggestion.confident) {
    incident.suggestedSeverity = suggestion.severity;
    incident.severityReason = suggestion.reason;
    if (hint?.applySuggestion) incident.severity = suggestion.severity;
  } else {
    incident.suggestedSeverity = incident.severity;
    incident.severityReason = suggestion.reason;
  }
  incident.notifiedOwners = ownersForIncident(incident);
  if (!incident.fixSteps) incident.fixSteps = [];
  return incident;
}

export function liveStatusForComponent(c: RegistryComponent): RegistryLiveStatus {
  return registryLiveStatus(c, db.applications, db.servers);
}

/**
 * Register links for an application record. Outgoing: this application depends on the other end.
 * Incoming: the other end depends on this application. Empty lists are valid.
 * This is not `Application.dependencies`, which is the derived monitor list.
 */
export function serviceDependenciesForApplication(applicationId: string): ApplicationServiceDependencies {
  return projectServiceDependencies(applicationId, {
    applications: db.applications,
    servers: db.servers,
    registry: db.registry,
    links: db.dependencyLinks,
  });
}

/** Direct upstream dependencies (what this component depends on) + downstream blast radius. */
export function registryPaths(id: string): RegistryPaths | null {
  const root = db.registry.find(c => c.id === id);
  if (!root) return null;
  const byId = new Map(db.registry.map(c => [c.id, c]));

  const upstream: RegistryPathNode[] = [];
  for (const l of db.dependencyLinks) {
    if (l.fromId !== id) continue;
    const dep = byId.get(l.toId);
    if (!dep) continue;
    upstream.push({
      id: dep.id, name: dep.name, kind: dep.kind, tier: dep.tier, via: l.type,
      status: liveStatusForComponent(dep),
      applicationId: dep.applicationId, serverId: dep.serverId, userCount: dep.userCount,
    });
  }

  const impact = registryImpact(id);
  const downstream: RegistryPathNode[] = (impact?.affected ?? []).map(a => {
    const c = byId.get(a.id)!;
    return {
      id: a.id, name: a.name, kind: a.kind, tier: a.tier, via: a.via,
      status: liveStatusForComponent(c),
      applicationId: c.applicationId, serverId: c.serverId, userCount: a.userCount,
    };
  });

  return {
    componentId: id,
    componentName: root.name,
    status: liveStatusForComponent(root),
    upstream,
    downstream,
  };
}

/** Preview blast radius before planned work (maintenance / failover). */
export function previewImpact(scope: {
  applicationId?: string;
  serverId?: string;
  registryId?: string;
  environment?: Environment;
}): ImpactPreview {
  const component = registryComponentForScope(scope);
  const generatedAt = new Date().toISOString();
  if (!component) {
    const app = scope.applicationId ? db.applications.find(a => a.id === scope.applicationId) : undefined;
    const srv = scope.serverId ? db.servers.find(s => s.id === scope.serverId) : undefined;
    const label = app?.name || srv?.hostname || 'this target';
    return {
      scope, componentId: null, componentName: null,
      summary: `${label} is not in the dependency register — add it in Setup → Dependencies to preview blast radius.`,
      impact: null, hardStops: [], softDegrades: [], features: [], usersStopped: null, usersAffected: null, served: [],
      generatedAt,
    };
  }
  const impact = registryImpact(component.id);
  const hardStops = (impact?.affected ?? []).filter(a => a.via === 'HARD').map(a => ({ id: a.id, name: a.name, kind: a.kind }));
  const softDegrades = (impact?.affected ?? []).filter(a => a.via === 'SOFT').map(a => ({ id: a.id, name: a.name, kind: a.kind }));
  const features = featuresWithActions(component, impact);
  const usersStopped = impact?.largestUserCountStopped ?? component.userCount;
  const usersAffected = impact?.largestUserCountAffected ?? component.userCount;
  const served = impact?.served ?? component.served;
  const parts: string[] = [];
  if (hardStops.length) parts.push(`${hardStops.length} hard stop(s)`);
  if (softDegrades.length) parts.push(`${softDegrades.length} soft degrade(s)`);
  if (usersStopped != null) parts.push(`≥${usersStopped.toLocaleString()} users lose service`);
  else if (usersAffected != null) parts.push(`≥${usersAffected.toLocaleString()} users affected`);
  const summary = parts.length
    ? `If ${component.name} goes down: ${parts.join(', ')}.`
    : `If ${component.name} goes down: nothing else is linked as a hard or soft dependent in the register.`;
  return {
    scope, componentId: component.id, componentName: component.name, summary, impact,
    hardStops, softDegrades, features, usersStopped, usersAffected, served, generatedAt,
  };
}

export function newFixStep(text: string): IncidentFixStep {
  return { id: crypto.randomUUID(), text: text.trim(), completed: false };
}

export function setIncidentCategory(incident: Incident, category: RootCauseCategory, description?: string): void {
  incident.rootCauseCategory = category;
  if (description !== undefined) incident.rootCause = description;
}
