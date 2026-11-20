import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import { api } from '../../services/api';
import {
  blankDependencyForm,
  DEPENDENCY_METHODS,
  dependencyFormFromLink,
  DependencyFormErrors,
  DependencyFormValues,
  featureIdForNewName,
  formKeepsStoredEnds,
  parseEndKey,
  validateDependencyForm,
} from '../../lib/dependencyForm';
import { REGISTER_KIND_LABEL } from '../../lib/dependencyRegister';
import { dependencyFeatureAllowed } from '../../lib/serviceDependencies';
import { Application, DependencyLink, DependencyMethod, RegistryComponent } from '../../types';

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return 'Could not save this dependency.';
}

export const DependencyLinkForm: React.FC<{
  link: DependencyLink | null;
  presetConsumerApplicationId?: string;
  registry: RegistryComponent[];
  links: DependencyLink[];
  onCancel: () => void;
  onSaved: () => void;
  onRefresh: () => void;
  embedded?: boolean;
}> = ({ link, presetConsumerApplicationId = '', registry, links, onCancel, onSaved, onRefresh, embedded = false }) => {
  const { theme, applications, notify } = useOps();
  const isDark = theme === 'dark';
  const editing = Boolean(link);
  const [values, setValues] = useState<DependencyFormValues>(() => (
    link ? dependencyFormFromLink(link, registry) : blankDependencyForm(
      applications.some(app => app.id === presetConsumerApplicationId) ? presetConsumerApplicationId : '',
    )
  ));
  const [errors, setErrors] = useState<DependencyFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.getElementById('dependency-form')?.scrollIntoView({ block: 'nearest' });
  }, []);

  const inputBase = `w-full px-2.5 py-1.5 rounded border text-xs font-sans outline-none focus:ring-1 focus:ring-blue-500 ${
    isDark ? 'bg-[#0B0F17] text-slate-100' : 'bg-white text-slate-900'
  }`;
  const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
  const ghost = isDark ? 'bg-[#162033] hover:bg-[#1D2B44] text-slate-200 border border-[#23334E]' : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300';
  const faint = isDark ? 'text-slate-500' : 'text-slate-400';
  const card = embedded
    ? `space-y-3 pt-3 mt-3 border-t ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`
    : `rounded-lg border p-4 space-y-3 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`;
  const appLabel = (app: { name: string; codeName?: string }) => app.codeName ? `${app.name} · ${app.codeName}` : app.name;

  const consumerAppId = values.consumerKey.startsWith('app:') ? values.consumerKey.slice(4) : '';
  const consumerApp = applications.find(app => app.id === consumerAppId);
  const hosts = useMemo(
    () => new Set([consumerApp?.prdServerId, consumerApp?.drServerId].filter((id): id is string => Boolean(id))),
    [consumerApp],
  );
  const appOptions = useMemo(
    () => [...applications].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [applications],
  );
  const features = useMemo(() => {
    const consumer = parseEndKey(values.consumerKey);
    if (!consumer) return [];
    const record = consumer.kind === 'app'
      ? { applicationId: consumer.id }
      : registry.find(item => item.id === consumer.id);
    if (!record) return [];
    const consumerComponentId = consumer.kind === 'cmp' ? consumer.id : null;
    return registry
      .filter(item => dependencyFeatureAllowed(item, record) && item.id !== consumerComponentId)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [registry, values.consumerKey]);
  const otherProviders = useMemo(() => {
    const ownHost = (item: RegistryComponent) => {
      if (item.kind !== 'SERVER' || !item.serverId) return false;
      return hosts.has(item.serverId);
    };
    const rows = registry.filter(item => item.kind !== 'APPLICATION' && item.kind !== 'BUSINESS_FEATURE' && !ownHost(item));
    const current = values.providerKey.startsWith('cmp:')
      ? registry.find(item => item.id === values.providerKey.slice(4) && item.kind !== 'APPLICATION')
      : undefined;
    const merged = current && !rows.some(item => item.id === current.id) ? [...rows, current] : rows;
    return merged.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [hosts, registry, values.providerKey]);

  const patch = (next: Partial<DependencyFormValues>) => {
    setValues(prev => ({ ...prev, ...next }));
    setFormError(null);
  };

  const changeConsumer = (consumerKey: string) => {
    setValues(prev => {
      const next = { ...prev, consumerKey };
      if (next.providerKey && next.providerKey === consumerKey) next.providerKey = '';
      if (next.featureChoice && next.featureChoice !== 'new') {
        const feature = registry.find(item => item.id === next.featureChoice);
        const owner = consumerKey.startsWith('app:')
          ? { applicationId: consumerKey.slice(4) }
          : registry.find(item => `cmp:${item.id}` === consumerKey);
        const allowed = Boolean(feature && owner && dependencyFeatureAllowed(feature, owner));
        if (!allowed) {
          next.featureChoice = '';
          next.featureName = '';
        }
      }
      return next;
    });
    setErrors({});
    setFormError(null);
  };

  const typeHint = values.type === 'HARD'
    ? 'The consumer stops when the provider fails.'
    : values.featureChoice
      ? 'That feature stops. The rest of the consumer keeps running.'
      : 'The consumer keeps running, but worse.';

  const persistComponent = async (id: string | null, data: Partial<RegistryComponent>): Promise<RegistryComponent | null> => {
    try {
      const saved = id ? await api.updateRegistryComponent(id, data) : await api.createRegistryComponent(data);
      onRefresh();
      return saved;
    } catch (err) {
      setFormError(errorMessage(err));
      return null;
    }
  };

  const ensureApplication = async (
    app: Application,
    registryNow: RegistryComponent[],
    remember: (saved: RegistryComponent) => void,
  ): Promise<string | null> => {
    const linked = registryNow.find(item => item.kind === 'APPLICATION' && item.applicationId === app.id);
    if (linked) return linked.id;
    const named = registryNow.find(item => item.kind === 'APPLICATION' && sameName(item.name, app.name));
    if (named?.applicationId && named.applicationId !== app.id) {
      setFormError(`An application named "${app.name}" is already in the register.`);
      return null;
    }
    if (named && !named.applicationId) {
      const saved = await persistComponent(named.id, { applicationId: app.id, tier: app.tier });
      if (!saved) return null;
      remember(saved);
      return saved.id;
    }
    if (named) return named.id;
    const saved = await persistComponent(null, {
      kind: 'APPLICATION',
      name: app.name,
      owner: 'Unassigned',
      tier: app.tier,
      description: app.description || '',
      applicationId: app.id,
    });
    if (!saved) return null;
    remember(saved);
    return saved.id;
  };

  const ensureEnd = async (
    key: string,
    registryNow: RegistryComponent[],
    remember: (saved: RegistryComponent) => void,
  ): Promise<string | null> => {
    const end = parseEndKey(key);
    if (!end) return null;
    if (end.kind === 'cmp') {
      if (!registryNow.some(item => item.id === end.id)) {
        setFormError('That register entry is no longer available.');
        return null;
      }
      return end.id;
    }
    const app = applications.find(item => item.id === end.id);
    if (!app) {
      setFormError('Choose an application that is still registered.');
      return null;
    }
    return ensureApplication(app, registryNow, remember);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors = validateDependencyForm(values, {
      applications,
      registry,
      links,
      editingId: link?.id ?? null,
      storedLink: link,
    });
    setErrors(nextErrors);
    const firstInvalid = (['consumerKey', 'providerKey', 'type', 'method', 'featureChoice', 'featureName', 'failureBehaviour', 'rationale'] as const)
      .find(name => nextErrors[name]);
    if (firstInvalid) {
      setFormError('Fix the highlighted fields before saving.');
      document.getElementById(`dependency-${firstInvalid}`)?.focus();
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      let registryNow = registry;
      const remember = (saved: RegistryComponent) => {
        registryNow = registryNow.some(item => item.id === saved.id)
          ? registryNow.map(item => item.id === saved.id ? { ...item, ...saved } : item)
          : [...registryNow, saved];
      };
      const keepEnds = Boolean(link && formKeepsStoredEnds(values, link, registryNow));
      let fromId = keepEnds && link ? link.fromId : await ensureEnd(values.consumerKey, registryNow, remember);
      if (!fromId) {
        setFormError(prev => prev ?? 'The consumer could not be saved.');
        return;
      }
      let toId = keepEnds && link ? link.toId : await ensureEnd(values.providerKey, registryNow, remember);
      if (!toId) {
        setFormError(prev => prev ?? 'The provider could not be saved.');
        return;
      }
      if (fromId === toId) {
        setFormError('An application cannot depend on itself.');
        return;
      }
      let featureId: string | null = keepEnds && link ? link.featureId : null;
      if (!keepEnds && values.featureChoice === 'new') {
        const appId = values.consumerKey.startsWith('app:') ? values.consumerKey.slice(4) : null;
        const existingId = featureIdForNewName(registryNow, appId, values.featureName);
        if (existingId) featureId = existingId;
        else {
          const app = appId ? applications.find(item => item.id === appId) : undefined;
          const created = await persistComponent(null, {
            kind: 'BUSINESS_FEATURE',
            name: values.featureName.trim(),
            owner: 'Unassigned',
            tier: app?.tier ?? 'TIER_2',
            description: '',
            applicationId: appId,
          });
          if (!created) return;
          remember(created);
          featureId = created.id;
        }
      } else if (!keepEnds && values.featureChoice) {
        featureId = values.featureChoice;
      }
      const payload: Partial<DependencyLink> = {
        fromId,
        toId,
        type: values.type === 'SOFT' ? 'SOFT' : 'HARD',
        featureId,
        method: values.method ? values.method : null,
        failureBehaviour: values.failureBehaviour.trim(),
        notes: values.rationale.trim(),
      };
      if (link) await api.updateDependencyLink(link.id, payload);
      else await api.createDependencyLink(payload);
      notify('success', link ? 'Dependency updated' : 'Dependency added');
      onSaved();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const fieldClass = (name: keyof DependencyFormErrors) => `${inputBase} ${errors[name] ? 'border-rose-500' : isDark ? 'border-[#1E293B]' : 'border-slate-300'}`;
  const providerApps = appOptions.filter(app => `app:${app.id}` !== values.consumerKey);
  const storedFrom = link ? registry.find(item => item.id === link.fromId) : undefined;
  const widening = storedFrom?.kind === 'BUSINESS_FEATURE' && !link?.featureId && values.featureChoice === '';
  const featureHint = widening
    ? 'This dependency is recorded on that feature. Clearing the feature makes it apply to the whole application.'
    : features.length || values.featureChoice === 'new'
      ? 'Optional. A named feature stops when the provider fails, even on a Soft dependency.'
      : 'Optional. Choose the consumer, or type a new feature name.';

  return (
    <form id="dependency-form" onSubmit={submit} noValidate className={card} aria-label={editing ? 'Edit dependency' : 'Add dependency'} aria-busy={busy}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold tracking-tight">{editing ? 'Edit dependency' : 'Add dependency'}</h2>
          <p className={`text-[11px] font-sans mt-0.5 ${faint}`}>The consumer depends on the provider. A named feature stops when the provider fails.</p>
        </div>
        <button type="button" onClick={onCancel} disabled={busy} aria-label="Close dependency form" className={`${btn} ${ghost} !px-2`}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {formError && (
        <p role="alert" className={`text-[12px] font-sans rounded border px-2.5 py-2 ${isDark ? 'border-rose-900 bg-rose-950/40 text-rose-300' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
          {formError}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field text="Consumer application" hint="The application that depends on the provider." error={errors.consumerKey}>
          <select
            id="dependency-consumerKey"
            aria-label="Consumer application"
            aria-invalid={Boolean(errors.consumerKey)}
            value={values.consumerKey}
            onChange={event => changeConsumer(event.target.value)}
            className={fieldClass('consumerKey')}
          >
            <option value="">Choose the consumer</option>
            {appOptions.map(app => <option key={app.id} value={`app:${app.id}`}>{appLabel(app)}</option>)}
            {values.consumerKey.startsWith('cmp:') && (
              <option value={values.consumerKey}>
                {registry.find(item => item.id === values.consumerKey.slice(4))?.name ?? 'Current consumer'}
              </option>
            )}
          </select>
        </Field>
        <Field text="Provider" hint={hosts.size ? 'Production and recovery servers stay on the application.' : 'The application, database, or service it needs.'} error={errors.providerKey}>
          <select
            id="dependency-providerKey"
            aria-label="Provider application"
            aria-invalid={Boolean(errors.providerKey)}
            value={values.providerKey}
            onChange={event => { patch({ providerKey: event.target.value }); setErrors(prev => ({ ...prev, providerKey: undefined })); }}
            className={fieldClass('providerKey')}
          >
            <option value="">Choose the provider</option>
            {providerApps.length > 0 && (
              <optgroup label="Applications">
                {providerApps.map(app => (
                  <option key={app.id} value={`app:${app.id}`}>{appLabel(app)}</option>
                ))}
              </optgroup>
            )}
            {otherProviders.length > 0 && (
              <optgroup label="Databases, storage, and services">
                {otherProviders.map(item => (
                  <option key={item.id} value={`cmp:${item.id}`}>
                    {item.name} · {REGISTER_KIND_LABEL[item.kind]}{isOwnHost(item, hosts) ? ' · hosting' : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
        <Field text="Hard or Soft" hint={typeHint} error={errors.type}>
          <select
            id="dependency-type"
            aria-label="Hard or Soft"
            aria-invalid={Boolean(errors.type)}
            value={values.type}
            onChange={event => { patch({ type: event.target.value as DependencyFormValues['type'] }); setErrors(prev => ({ ...prev, type: undefined })); }}
            className={fieldClass('type')}
          >
            <option value="HARD">Hard · the consumer stops</option>
            <option value="SOFT">Soft</option>
          </select>
        </Field>
        <Field text="Dependency method" hint="How the consumer reaches the provider." error={errors.method}>
          <select
            id="dependency-method"
            aria-label="Dependency method"
            aria-invalid={Boolean(errors.method)}
            value={values.method}
            onChange={event => { patch({ method: event.target.value as DependencyMethod | '' }); setErrors(prev => ({ ...prev, method: undefined })); }}
            className={fieldClass('method')}
          >
            <option value="">Not recorded</option>
            {DEPENDENCY_METHODS.map(method => <option key={method} value={method}>{method}</option>)}
          </select>
        </Field>
        <Field
          text="Feature name"
          hint={featureHint}
          error={errors.featureChoice}
          className="sm:col-span-2"
        >
          <select
            id="dependency-featureChoice"
            aria-label="Feature name"
            aria-invalid={Boolean(errors.featureChoice)}
            value={values.featureChoice}
            onChange={event => {
              patch({ featureChoice: event.target.value, featureName: event.target.value === 'new' ? values.featureName : '' });
              setErrors(prev => ({ ...prev, featureChoice: undefined, featureName: undefined }));
            }}
            className={fieldClass('featureChoice')}
          >
            <option value="">Not limited to one feature</option>
            {features.map(feature => <option key={feature.id} value={feature.id}>{feature.name}</option>)}
            {values.featureChoice && values.featureChoice !== 'new' && !features.some(feature => feature.id === values.featureChoice) && (
              <option value={values.featureChoice}>Unknown feature</option>
            )}
            <option value="new">New feature name</option>
          </select>
        </Field>
        {values.featureChoice === 'new' && (
          <Field text="New feature name" hint="Saved as a feature of the consumer." error={errors.featureName} className="sm:col-span-2">
            <input
              id="dependency-featureName"
              aria-label="New feature name"
              aria-invalid={Boolean(errors.featureName)}
              value={values.featureName}
              maxLength={200}
              placeholder="e.g. Sign-in"
              onChange={event => { patch({ featureName: event.target.value }); setErrors(prev => ({ ...prev, featureName: undefined })); }}
              className={fieldClass('featureName')}
            />
          </Field>
        )}
        <Field text="Failure behaviour" hint="What users see or can no longer do. No password." error={errors.failureBehaviour} className="sm:col-span-2">
          <textarea
            id="dependency-failureBehaviour"
            aria-label="Failure behaviour"
            aria-invalid={Boolean(errors.failureBehaviour)}
            value={values.failureBehaviour}
            maxLength={500}
            rows={2}
            placeholder="Sign-in shows an error and stops"
            onChange={event => { patch({ failureBehaviour: event.target.value }); setErrors(prev => ({ ...prev, failureBehaviour: undefined })); }}
            className={fieldClass('failureBehaviour')}
          />
        </Field>
        <Field text="Rationale" hint="Why this dependency exists. No password or token." error={errors.rationale} className="sm:col-span-2">
          <textarea
            id="dependency-rationale"
            aria-label="Rationale"
            aria-invalid={Boolean(errors.rationale)}
            value={values.rationale}
            maxLength={500}
            rows={2}
            placeholder="Exams reads the learner record before it can start"
            onChange={event => { patch({ rationale: event.target.value }); setErrors(prev => ({ ...prev, rationale: undefined })); }}
            className={fieldClass('rationale')}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={`${btn} bg-blue-600 hover:bg-blue-700 text-white`}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Add dependency'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={`${btn} ${ghost}`}>Cancel</button>
      </div>
    </form>
  );
};

function isOwnHost(component: RegistryComponent, hosts: Set<string>): boolean {
  return component.kind === 'SERVER' && component.serverId != null && hosts.has(component.serverId);
}

const Field: React.FC<{ text: string; hint?: string; error?: string; className?: string; children: React.ReactNode }> = ({ text, hint, error, className, children }) => (
  <label className={`block space-y-1 min-w-0 ${className ?? ''}`}>
    <span className="text-[11px] font-sans font-semibold">{text}</span>
    {children}
    {error
      ? <span className="block text-[11px] font-sans text-rose-500">{error}</span>
      : hint && <span className="block text-[10px] font-sans text-slate-500">{hint}</span>}
  </label>
);
