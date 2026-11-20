/**
 * Client checks for the Dependency Register add and edit forms.
 * The API still decides. These messages match the register rules so a bad
 * form fails before it is sent. fromId and toId are register entries.
 * An application id is not an end.
 */
import type { DependencyLink, DependencyMethod, RegistryComponent } from '../types/index.ts';
import { dependencyFeatureAllowed } from './serviceDependencies.ts';

export const DEPENDENCY_METHODS: readonly DependencyMethod[] = ['HTTP', 'API', 'DATABASE', 'EMBED', 'LINK', 'OTHER'];

export interface DependencyFormValues {
  /** `app:<application id>` or, when the stored end is not an application, `cmp:<register id>`. */
  consumerKey: string;
  providerKey: string;
  type: 'HARD' | 'SOFT' | '';
  method: DependencyMethod | '';
  /** Empty means the whole consumer. `new` asks for a feature name. Otherwise a feature register id. */
  featureChoice: string;
  featureName: string;
  failureBehaviour: string;
  rationale: string;
}

export type DependencyFormField =
  | 'consumerKey'
  | 'providerKey'
  | 'type'
  | 'method'
  | 'featureChoice'
  | 'featureName'
  | 'failureBehaviour'
  | 'rationale';

export type DependencyFormErrors = Partial<Record<DependencyFormField, string>>;

export interface DependencyFormContext {
  applications: readonly { id: string; name: string; prdServerId?: string | null; drServerId?: string | null }[];
  registry: readonly Pick<RegistryComponent, 'id' | 'kind' | 'name' | 'applicationId' | 'serverId'>[];
  links: readonly Pick<DependencyLink, 'id' | 'fromId' | 'toId' | 'featureId'>[];
  editingId: string | null;
  /** When set, an unchanged consumer, provider, and feature keep these ends. */
  storedLink?: Pick<DependencyLink, 'fromId' | 'toId' | 'type' | 'method' | 'featureId' | 'failureBehaviour' | 'notes'> | null;
}

export const blankDependencyForm = (consumerApplicationId = ''): DependencyFormValues => ({
  consumerKey: consumerApplicationId ? `app:${consumerApplicationId}` : '',
  providerKey: '',
  type: 'HARD',
  method: '',
  featureChoice: '',
  featureName: '',
  failureBehaviour: '',
  rationale: '',
});

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A new name that already belongs to this consumer is reused. A name owned elsewhere is not. */
export function featureIdForNewName(
  registry: DependencyFormContext['registry'],
  applicationId: string | null,
  name: string,
): string | null {
  const existing = registry.find(item => item.kind === 'BUSINESS_FEATURE' && sameName(item.name, name));
  if (!existing) return null;
  const allowed = applicationId
    ? dependencyFeatureAllowed(existing, { applicationId })
    : existing.applicationId == null;
  return allowed ? existing.id : null;
}

export function containsSecret(value: string): boolean {
  return /(password|passwd|secret|api[_-]?key|token)\s*[:=]/i.test(value) || /:\/\/[^/\s]+:[^/\s]+@/.test(value);
}

function textError(value: string, label: string, max: number): string | null {
  if (value.trim().length > max) return `${label} must be at most ${max} characters`;
  if (containsSecret(value)) return `${label} must not include a password or token. Record the host, URL, or bucket only.`;
  return null;
}

type EndKey = { kind: 'app' | 'cmp'; id: string };

export function parseEndKey(key: string): EndKey | null {
  const trimmed = key.trim();
  if (trimmed.startsWith('app:') && trimmed.length > 4) return { kind: 'app', id: trimmed.slice(4) };
  if (trimmed.startsWith('cmp:') && trimmed.length > 4) return { kind: 'cmp', id: trimmed.slice(4) };
  return null;
}

function applicationIdOf(end: EndKey, registry: DependencyFormContext['registry']): string | null {
  if (end.kind === 'app') return end.id;
  const component = registry.find(item => item.id === end.id);
  if (!component) return null;
  if (component.kind === 'APPLICATION' || component.kind === 'BUSINESS_FEATURE') return component.applicationId;
  return null;
}

function registerIdForApplication(applicationId: string, registry: DependencyFormContext['registry']): string | null {
  return registry.find(item => item.kind === 'APPLICATION' && item.applicationId === applicationId)?.id ?? null;
}

function componentIdOf(end: EndKey, registry: DependencyFormContext['registry']): string | null {
  if (end.kind === 'cmp') return registry.some(item => item.id === end.id) ? end.id : null;
  return registerIdForApplication(end.id, registry);
}

function sameEnd(consumer: EndKey, provider: EndKey, registry: DependencyFormContext['registry']): boolean {
  if (consumer.kind === provider.kind && consumer.id === provider.id) return true;
  const consumerComponent = componentIdOf(consumer, registry);
  const providerComponent = componentIdOf(provider, registry);
  if (consumerComponent && providerComponent && consumerComponent === providerComponent) return true;
  const consumerApp = applicationIdOf(consumer, registry);
  const providerApp = applicationIdOf(provider, registry);
  const providerIsApplication = provider.kind === 'app' || registry.find(item => item.id === provider.id)?.kind === 'APPLICATION';
  return Boolean(consumerApp && providerApp && consumerApp === providerApp && providerIsApplication);
}

/** The register row this form will write, when that row already exists. */
export function resolvedEnds(
  values: Pick<DependencyFormValues, 'consumerKey' | 'providerKey'>,
  registry: DependencyFormContext['registry'],
): { fromId: string | null; toId: string | null } {
  const consumer = parseEndKey(values.consumerKey);
  const provider = parseEndKey(values.providerKey);
  return {
    fromId: consumer ? componentIdOf(consumer, registry) : null,
    toId: provider ? componentIdOf(provider, registry) : null,
  };
}

export function dependencyFormFromLink(
  link: Pick<DependencyLink, 'fromId' | 'toId' | 'type' | 'method' | 'featureId' | 'failureBehaviour' | 'notes'>,
  registry: readonly Pick<RegistryComponent, 'id' | 'kind' | 'applicationId'>[],
): DependencyFormValues {
  const from = registry.find(item => item.id === link.fromId);
  const to = registry.find(item => item.id === link.toId);
  const consumerKey = (from?.kind === 'APPLICATION' || from?.kind === 'BUSINESS_FEATURE') && from.applicationId
    ? `app:${from.applicationId}`
    : from
      ? `cmp:${from.id}`
      : '';
  const providerKey = to?.kind === 'APPLICATION' && to.applicationId
    ? `app:${to.applicationId}`
    : to
      ? `cmp:${to.id}`
      : '';
  return {
    consumerKey,
    providerKey,
    type: link.type,
    method: link.method ?? '',
    featureChoice: link.featureId || (from?.kind === 'BUSINESS_FEATURE' ? from.id : ''),
    featureName: '',
    failureBehaviour: link.failureBehaviour ?? '',
    rationale: link.notes ?? '',
  };
}

/** True when the user has not changed which ends or feature this dependency uses. */
export function formKeepsStoredEnds(
  values: DependencyFormValues,
  link: Parameters<typeof dependencyFormFromLink>[0],
  registry: Parameters<typeof dependencyFormFromLink>[1],
): boolean {
  if (!registry.some(item => item.id === link.fromId) || !registry.some(item => item.id === link.toId)) return false;
  if (link.featureId && !registry.some(item => item.id === link.featureId)) return false;
  const initial = dependencyFormFromLink(link, registry);
  return values.consumerKey === initial.consumerKey
    && values.providerKey === initial.providerKey
    && values.featureChoice === initial.featureChoice
    && values.featureName.trim() === initial.featureName.trim();
}

export function validateDependencyForm(values: DependencyFormValues, ctx: DependencyFormContext): DependencyFormErrors {
  const errors: DependencyFormErrors = {};
  const consumer = parseEndKey(values.consumerKey);
  const provider = parseEndKey(values.providerKey);
  const consumerAppId = consumer ? applicationIdOf(consumer, ctx.registry) : null;
  const consumerApp = consumerAppId ? ctx.applications.find(app => app.id === consumerAppId) : undefined;

  if (!consumer) errors.consumerKey = 'Choose the consumer application.';
  else if (consumer.kind === 'app' && !ctx.applications.some(app => app.id === consumer.id)) errors.consumerKey = 'Choose the consumer application.';
  else if (consumer.kind === 'cmp' && !ctx.registry.some(item => item.id === consumer.id)) errors.consumerKey = 'The consumer is no longer in the register.';

  if (!provider) errors.providerKey = 'Choose the provider.';
  else if (provider.kind === 'app' && !ctx.applications.some(app => app.id === provider.id)) errors.providerKey = 'Choose the provider.';
  else if (provider.kind === 'cmp' && !ctx.registry.some(item => item.id === provider.id)) errors.providerKey = 'The provider is no longer in the register.';
  else if (consumer && !errors.consumerKey && !errors.providerKey && sameEnd(consumer, provider, ctx.registry)) {
    const sameApplication = consumer.kind === 'app' && provider.kind === 'app' && consumer.id === provider.id;
    errors.providerKey = sameApplication
      ? 'An application cannot depend on itself.'
      : 'A component cannot depend on itself';
  }

  if (values.type !== 'HARD' && values.type !== 'SOFT') errors.type = 'Type must be Hard or Soft.';
  if (values.method && !DEPENDENCY_METHODS.includes(values.method)) {
    errors.method = `Method must be one of: ${DEPENDENCY_METHODS.join(', ')}, or empty`;
  }

  const failure = textError(values.failureBehaviour, 'Failure behaviour', 500);
  if (failure) errors.failureBehaviour = failure;
  const rationale = textError(values.rationale, 'Rationale', 500);
  if (rationale) errors.rationale = rationale;
  if (ctx.storedLink && formKeepsStoredEnds(values, ctx.storedLink, ctx.registry)) return errors;

  let featureId: string | null = null;
  if (values.featureChoice === 'new') {
    const name = values.featureName.trim();
    if (!name) errors.featureName = 'Feature name is required';
    else {
      const named = textError(name, 'Feature name', 200);
      if (named) errors.featureName = named;
      else {
        const existing = ctx.registry.find(item => item.kind === 'BUSINESS_FEATURE' && sameName(item.name, name));
        if (existing) {
          const allowed = consumerAppId
            ? dependencyFeatureAllowed(existing, { applicationId: consumerAppId })
            : existing.applicationId == null;
          if (!allowed) errors.featureName = 'The feature must belong to the consumer application';
          else featureId = existing.id;
        }
      }
    }
  } else if (values.featureChoice) {
    const feature = ctx.registry.find(item => item.id === values.featureChoice);
    const consumerRecord = consumer?.kind === 'cmp'
      ? ctx.registry.find(item => item.id === consumer.id)
      : consumerAppId
        ? { applicationId: consumerAppId }
        : null;
    if (!feature || feature.kind !== 'BUSINESS_FEATURE' || !consumerRecord || !dependencyFeatureAllowed(feature, consumerRecord)) {
      errors.featureChoice = 'The feature must belong to the consumer application';
    } else if (consumer && componentIdOf(consumer, ctx.registry) === feature.id) {
      errors.featureChoice = 'The feature that needs it cannot be the consumer itself; set the type to Hard instead';
    } else if (provider && componentIdOf(provider, ctx.registry) === feature.id) {
      errors.featureChoice = 'The feature that needs it cannot be the provider itself';
    } else {
      featureId = feature.id;
    }
  }

  if (!errors.providerKey && provider?.kind === 'cmp' && consumerApp) {
    const target = ctx.registry.find(item => item.id === provider.id);
    if (target?.kind === 'SERVER' && target.serverId && (target.serverId === consumerApp.prdServerId || target.serverId === consumerApp.drServerId)) {
      const which = target.serverId === consumerApp.prdServerId ? 'production' : 'recovery';
      errors.providerKey = `Hosting is recorded on the application. ${consumerApp.name} already runs on this ${which} server, so it is not a dependency.`;
    }
  }

  const fromId = consumer && !errors.consumerKey ? componentIdOf(consumer, ctx.registry) : null;
  const toId = provider && !errors.providerKey ? componentIdOf(provider, ctx.registry) : null;
  const featureReady = values.featureChoice !== 'new' || Boolean(featureId);
  if (!errors.featureChoice && !errors.featureName && fromId && toId && featureReady) {
    const clash = ctx.links.some(link =>
      link.id !== ctx.editingId
      && link.fromId === fromId
      && link.toId === toId
      && (link.featureId ?? null) === featureId,
    );
    if (clash) {
      const fromName = ctx.registry.find(item => item.id === fromId)?.name ?? 'This consumer';
      const toName = ctx.registry.find(item => item.id === toId)?.name ?? 'that provider';
      errors.providerKey = `"${fromName}" already depends on "${toName}"${featureId ? ' for that feature' : ''}`;
    }
  }

  return errors;
}
