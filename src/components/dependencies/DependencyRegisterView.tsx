import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronDown, Network, RefreshCw } from 'lucide-react';
import { DependencyLinkForm } from './DependencyLinkForm';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { DependencyLink, RegistryComponent } from '../../types';
import {
  DependencyPartyView,
  DependencyRegisterRow,
  DependencySortDirection,
  DependencySortKey,
  DependencyTypeFilter,
  dependencyRegisterRows,
  dependencyTypeFilter,
  FEATURE_NOT_LIMITED,
  featureLabel,
  filterDependencyRegister,
  partyHeading,
  registerLiveKey,
  sortDependencyRegister,
} from '../../lib/dependencyRegister';
import { dependencyMethodLabel } from '../../lib/serviceDependencies';
import { InventoryFilters } from '../ui/InventoryFilters';
import { Pagination, useClientPagination } from '../ui/Pagination';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { SkeletonTable } from '../ui/Skeleton';

type Snapshot = { links: DependencyLink[]; components: RegistryComponent[] };

const fmtUpdated = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t).toLocaleString();
};

export const DependencyRegisterView: React.FC = () => {
  const { theme, applications, registry, dependencyLinks, isLoading, loadError, setSelectedAppId, notify } = useOps();
  const { canDo } = useAuth();
  const canRecord = canDo('create_application');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isDark = theme === 'dark';
  const query = params.get('q') ?? '';
  const type = dependencyTypeFilter(params.get('type'));
  const applicationId = params.get('application') ?? '';
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<DependencySortKey>('consumer');
  const [sortDir, setSortDir] = useState<DependencySortDirection>('asc');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [formMode, setFormMode] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const gen = useRef(0);
  const contextSig = useMemo(() => registerLiveKey(dependencyLinks, registry), [dependencyLinks, registry]);
  const contextSigRef = useRef(contextSig);
  contextSigRef.current = contextSig;
  const appliedContext = useRef('');
  const registryRef = useRef(registry);
  registryRef.current = registry;

  const writeParams = useCallback((patch: { q?: string; type?: DependencyTypeFilter; application?: string }) => {
    setParams(prev => {
      const nextQuery = patch.q !== undefined ? patch.q : (prev.get('q') ?? '');
      const nextType = patch.type !== undefined ? patch.type : dependencyTypeFilter(prev.get('type'));
      const nextApplication = patch.application !== undefined ? patch.application : (prev.get('application') ?? '');
      const next = new URLSearchParams(prev);
      if (nextQuery.trim()) next.set('q', nextQuery); else next.delete('q');
      if (nextType !== 'ALL') next.set('type', nextType); else next.delete('type');
      if (nextApplication) next.set('application', nextApplication); else next.delete('application');
      return next;
    }, { replace: true });
  }, [setParams]);

  const load = useCallback(async () => {
    const id = ++gen.current;
    const sigAtStart = contextSigRef.current;
    setLoading(true);
    setError(null);
    try {
      const [listed, reg] = await Promise.all([
        api.getDependencyLinks(),
        api.getRegistry().catch(() => null),
      ]);
      if (id !== gen.current || contextSigRef.current !== sigAtStart) return;
      setSnapshot({ links: listed, components: reg?.components ?? registryRef.current });
    } catch (err) {
      if (id !== gen.current) return;
      setError(err);
    } finally {
      if (id === gen.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The dashboard already keeps the register current (bootstrap and registry_changed).
  // Follow that copy so a save elsewhere shows up here. A listing response is kept
  // only when nothing newer arrived while it was in flight.
  useEffect(() => {
    if (appliedContext.current === contextSig) return;
    const contextReady = (!isLoading && !loadError) || dependencyLinks.length > 0 || registry.length > 0;
    if (!contextReady) return;
    appliedContext.current = contextSig;
    setSnapshot({ links: dependencyLinks, components: registry });
    setError(null);
    setLoading(false);
  }, [contextSig, dependencyLinks, isLoading, loadError, registry]);

  useEffect(() => {
    if (!applicationId || isLoading || applications.length === 0) return;
    if (!applications.some(app => app.id === applicationId)) writeParams({ application: '' });
  }, [applicationId, applications, isLoading, writeParams]);

  const st = {
    isDark,
    input: `w-full px-2.5 py-1.5 rounded border text-xs font-mono outline-none focus:ring-1 focus:ring-blue-500 ${
      isDark ? 'bg-[#0B0F17] border-[#1E293B] text-slate-100 placeholder:text-slate-600' : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400'
    }`,
    btn: 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
    ghost: isDark ? 'bg-[#162033] hover:bg-[#1D2B44] text-slate-200 border border-[#23334E]' : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300',
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    muted: isDark ? 'text-slate-400' : 'text-slate-600',
    faint: isDark ? 'text-slate-500' : 'text-slate-400',
  };
  const rowBorder = isDark ? 'border-[#1E293B]' : 'border-slate-200';
  const links = snapshot?.links ?? null;
  const addRequested = params.get('add') === '1';
  const editRequested = params.get('edit') ?? '';
  useEffect(() => {
    if (!addRequested && !editRequested) return;
    if (links === null) return;
    if (canRecord && editRequested && links.some(link => link.id === editRequested)) setFormMode(editRequested);
    else if (canRecord && addRequested) setFormMode('add');
    setParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('add');
      next.delete('edit');
      return next;
    }, { replace: true });
  }, [addRequested, canRecord, editRequested, links, setParams]);
  const components = snapshot?.components ?? registry;
  const rows = useMemo(
    () => dependencyRegisterRows(links ?? [], components, applications),
    [links, components, applications],
  );
  const searched = useMemo(
    () => filterDependencyRegister(rows, { query, type: 'ALL', applicationId }),
    [rows, query, applicationId],
  );
  const visible = useMemo(
    () => sortDependencyRegister(
      filterDependencyRegister(rows, { query, type, applicationId }),
      sortKey,
      sortDir,
    ),
    [rows, query, type, applicationId, sortKey, sortDir],
  );
  const paging = useClientPagination(visible, 10, `${query}|${type}|${applicationId}|${sortKey}|${sortDir}`);
  const appOptions = useMemo(
    () => [...applications].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [applications],
  );
  const trustEmpty = !isLoading && !loadError;
  const hardError = Boolean(error) && links === null && !trustEmpty;

  const openApplication = (id: string | null) => {
    if (!id || !applications.some(app => app.id === id)) return;
    setSelectedAppId(id);
    navigate('/applications');
  };

  const openAdd = () => {
    setConfirmDeleteId(null);
    setDeleteError(null);
    if (formMode === 'add') {
      document.getElementById('dependency-form')?.scrollIntoView({ block: 'start' });
      return;
    }
    setFormMode('add');
  };

  const openEdit = (id: string) => {
    setConfirmDeleteId(null);
    setDeleteError(null);
    setFormMode(id);
  };

  const removeLink = async (id: string) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteDependencyLink(id);
      notify('success', 'Dependency removed');
      setConfirmDeleteId(null);
      if (formMode === id) setFormMode(null);
      void load();
    } catch (err) {
      setDeleteError(err instanceof Error && err.message.trim() ? err.message : 'Could not remove this dependency.');
    } finally {
      setDeleting(false);
    }
  };

  const editingLink = formMode && formMode !== 'add' ? links?.find(link => link.id === formMode) ?? null : null;
  const editingOnPage = Boolean(editingLink && paging.slice.some(row => row.id === editingLink.id));

  useEffect(() => {
    if (!formMode || formMode === 'add' || !links) return;
    if (!links.some(link => link.id === formMode)) setFormMode(null);
  }, [formMode, links]);

  return (
    <div className="space-y-5">
      <div className={`flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-3 border-b ${rowBorder}`}>
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <Network className="w-5 h-5 text-blue-500" /> Dependency register
          </h1>
          <p className={`text-xs mt-0.5 max-w-3xl ${st.muted}`}>
            The consumer depends on the provider. <b>Hard</b> means the consumer stops. <b>Soft</b> with a feature means that feature stops. <b>Soft</b> on its own means the consumer keeps running, but worse.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {canRecord && (
            <button type="button" onClick={openAdd} className={`${st.btn} ${st.primary}`}>
              Add a dependency
            </button>
          )}
          <button type="button" onClick={() => void load()} disabled={loading} className={`${st.btn} ${st.ghost}`}>
            <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {hardError ? (
        <ErrorState error={error} onRetry={() => void load()} />
      ) : links === null ? (
        <SkeletonTable rows={6} cols={5} />
      ) : (
        <>
          {error != null && <ErrorState error={error} onRetry={() => void load()} compact />}
          {canRecord && formMode === 'add' && (
            <DependencyLinkForm
              key="add"
              link={null}
              presetConsumerApplicationId={applicationId}
              registry={components}
              links={links}
              onCancel={() => setFormMode(null)}
              onSaved={() => { setFormMode(null); void load(); }}
              onRefresh={() => void load()}
            />
          )}
          {canRecord && editingLink && !editingOnPage && (
            <DependencyLinkForm
              key={editingLink.id}
              link={editingLink}
              registry={components}
              links={links}
              onCancel={() => setFormMode(null)}
              onSaved={() => { setFormMode(null); void load(); }}
              onRefresh={() => void load()}
            />
          )}
          {links.length === 0 ? (
            <EmptyState
              icon={Network}
              title="No dependencies yet"
              description="Nothing is written down yet. An empty list is not proof that the applications have no dependencies."
              action={canRecord && formMode !== 'add' ? { label: 'Add a dependency', onClick: openAdd } : undefined}
            />
          ) : (
            <>
              <InventoryFilters
                st={st}
                search={query}
                onSearch={value => writeParams({ q: value })}
                searchPlaceholder="Search by name, feature, or owner"
                ariaLabel="Search the dependency register"
                chips={[
                  { id: 'ALL', label: 'All', count: searched.length },
                  { id: 'HARD', label: 'Hard · stops', count: searched.filter(row => row.type === 'HARD').length },
                  { id: 'SOFT', label: 'Soft', count: searched.filter(row => row.type === 'SOFT').length },
                ]}
                chip={type}
                onChip={id => writeParams({ type: dependencyTypeFilter(id) })}
                shown={visible.length}
                total={rows.length}
                onClear={() => writeParams({ q: '', type: 'ALL', application: '' })}
                extraActive={Boolean(applicationId)}
              />
              <div className="flex flex-wrap items-end gap-3">
                <label className={`block text-[11px] font-sans min-w-[12rem] flex-1 max-w-xs ${st.muted}`}>
                  Application
                  <span className={`block font-normal normal-case tracking-normal ${st.faint}`}>Consumer or provider</span>
                  <select
                    aria-label="Filter by application"
                    value={applications.some(app => app.id === applicationId) ? applicationId : ''}
                    onChange={event => writeParams({ application: event.target.value })}
                    className={`${st.input} mt-1 font-sans`}
                  >
                    <option value="">All applications</option>
                    {appOptions.map(app => (
                      <option key={app.id} value={app.id}>{app.name}</option>
                    ))}
                  </select>
                </label>
                <label className={`block text-[11px] font-sans min-w-[10rem] ${st.muted}`}>
                  Sort by
                  <select
                    aria-label="Sort dependencies"
                    value={sortKey}
                    onChange={event => setSortKey(event.target.value as DependencySortKey)}
                    className={`${st.input} mt-1 font-sans`}
                  >
                    <option value="consumer">Consumer</option>
                    <option value="provider">Provider</option>
                    <option value="type">Hard or Soft</option>
                    <option value="feature">Feature</option>
                    <option value="method">Method</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'))}
                  className={`${st.btn} ${st.ghost}`}
                  aria-label={sortDir === 'asc' ? 'Sorted ascending. Switch to descending' : 'Sorted descending. Switch to ascending'}
                >
                  {sortKey === 'type'
                    ? (sortDir === 'asc' ? 'Hard first' : 'Soft first')
                    : (sortDir === 'asc' ? 'A to Z' : 'Z to A')}
                </button>
              </div>

              {visible.length === 0 ? (
                <EmptyState
                  title="Nothing matches"
                  description="Try a different application, Hard or Soft, or search."
                  action={{ label: 'Clear filters', onClick: () => writeParams({ q: '', type: 'ALL', application: '' }) }}
                />
              ) : (
                <>
                  <ul className="space-y-2" aria-label="Dependency register">
                    {paging.slice.map(row => (
                      <DependencyCard
                        key={row.id}
                        row={row}
                        open={openIds.has(row.id)}
                        onToggle={() => setOpenIds(prev => {
                          const next = new Set(prev);
                          if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
                          return next;
                        })}
                        isDark={isDark}
                        faint={st.faint}
                        muted={st.muted}
                        rowBorder={rowBorder}
                        onOpen={openApplication}
                        editing={formMode === row.id}
                        editor={canRecord && formMode === row.id && editingLink ? (
                          <DependencyLinkForm
                            key={row.id}
                            link={editingLink}
                            registry={components}
                            links={links}
                            embedded
                            onCancel={() => setFormMode(null)}
                            onSaved={() => { setFormMode(null); void load(); }}
                            onRefresh={() => void load()}
                          />
                        ) : null}
                        manage={canRecord && formMode !== row.id ? {
                          onEdit: () => openEdit(row.id),
                          confirmingDelete: confirmDeleteId === row.id,
                          deleteError: confirmDeleteId === row.id ? deleteError : null,
                          deleting,
                          onAskDelete: () => { if (!deleting) { setConfirmDeleteId(row.id); setDeleteError(null); } },
                          onCancelDelete: () => { setConfirmDeleteId(null); setDeleteError(null); },
                          onConfirmDelete: () => void removeLink(row.id),
                        } : undefined}
                      />
                    ))}
                  </ul>
                  <Pagination page={paging.page} totalPages={paging.totalPages} total={paging.total} pageSize={paging.pageSize} onPage={paging.setPage} />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

const tierText = (tier: string | null) => (tier ? tier.replace('TIER_', 'Tier ') : '');

const statusPill = (status: string) =>
  status === 'HEALTHY' ? 'bg-emerald-500/15 text-emerald-500'
    : status === 'WARNING' || status === 'STALE' ? 'bg-amber-500/15 text-amber-500'
      : status === 'CRITICAL' ? 'bg-rose-500/15 text-rose-500'
        : status === 'MAINTENANCE' ? 'bg-blue-500/15 text-blue-500'
          : 'bg-slate-500/15 text-slate-400';

const statusDot = (status: string) =>
  status === 'HEALTHY' ? 'bg-emerald-500'
    : status === 'WARNING' || status === 'STALE' ? 'bg-amber-500'
      : status === 'CRITICAL' ? 'bg-rose-500'
        : status === 'MAINTENANCE' ? 'bg-blue-500'
          : 'bg-slate-400';

function partySubtitle(party: DependencyPartyView): string {
  if (party.missing) return 'Not in the register';
  if (party.applicationId) {
    const bits = [party.codeName, tierText(party.tier)];
    if (party.kind && party.kind !== 'APPLICATION') bits.push(`${party.kindLabel} · ${party.componentName}`);
    return bits.filter(Boolean).join(' · ');
  }
  return [party.kindLabel, party.owner, party.endpoint].filter(Boolean).join(' · ');
}

const PartySummary: React.FC<{
  party: DependencyPartyView;
  role: 'Consumer' | 'Provider';
  faint: string;
  onOpen: (id: string | null) => void;
}> = ({ party, role, faint, onOpen }) => {
  const heading = partyHeading(party);
  const subtitle = partySubtitle(party);
  return (
    <div className="min-w-0 flex-1">
      <div className={`text-[10px] font-semibold uppercase tracking-wide ${faint}`}>{role}</div>
      {party.applicationId ? (
        <button
          type="button"
          onClick={() => onOpen(party.applicationId)}
          className="font-sans text-sm font-semibold text-left hover:text-blue-500 cursor-pointer break-words"
        >
          {heading}
        </button>
      ) : (
        <div className="font-sans text-sm font-semibold break-words">{heading}</div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {party.status && (
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusPill(party.status)}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusDot(party.status)}`} aria-hidden />
            {party.status}
          </span>
        )}
        {subtitle && <span className={`text-[11px] font-sans break-words ${faint}`}>{subtitle}</span>}
      </div>
    </div>
  );
};

const DependencyCard: React.FC<{
  row: DependencyRegisterRow;
  open: boolean;
  onToggle: () => void;
  isDark: boolean;
  faint: string;
  muted: string;
  rowBorder: string;
  onOpen: (id: string | null) => void;
  editing?: boolean;
  editor?: React.ReactNode;
  manage?: {
    onEdit: () => void;
    confirmingDelete: boolean;
    deleteError: string | null;
    deleting: boolean;
    onAskDelete: () => void;
    onCancelDelete: () => void;
    onConfirmDelete: () => void;
  };
}> = ({ row, open, onToggle, isDark, faint, muted, rowBorder, onOpen, editing = false, editor, manage }) => {
  const featureText = featureLabel(row);
  const limited = featureText !== FEATURE_NOT_LIMITED;
  const onFeature = row.consumer.kind === 'BUSINESS_FEATURE' && !row.featureId;
  const feature = limited ? featureText : 'Entire consumer';
  const typeLabel = row.type === 'HARD'
    ? 'Hard · stops'
    : limited ? 'Soft · feature stops' : 'Soft · keeps running';
  const updated = fmtUpdated(row.updatedAt);
  const details: Array<{ label: string; value: string }> = [];
  if (onFeature && !row.featureId) details.push({ label: 'Feature', value: `${row.consumer.componentName}. Recorded on this feature.` });
  else if (!row.featureId) details.push({ label: 'Feature', value: 'Not limited to one feature' });
  if (row.owner) details.push({ label: 'Owner', value: row.owner });
  if (row.consumer.endpoint) details.push({ label: 'Consumer address', value: row.consumer.endpoint });
  if (row.provider.endpoint) details.push({ label: 'Provider address', value: row.provider.endpoint });
  if (row.healthCheck) details.push({ label: 'How to check', value: row.healthCheck });
  if (row.failureBehaviour) details.push({ label: 'Failure behaviour', value: row.failureBehaviour });
  if (row.recoveryExpectation) details.push({ label: 'Recovery', value: row.recoveryExpectation });
  if (row.notes) details.push({ label: 'Rationale', value: row.notes });
  if (updated) details.push({ label: 'Last saved', value: updated });
  const summary = `${partyHeading(row.consumer)} depends on ${partyHeading(row.provider)}`;
  const preview = row.failureBehaviour || row.notes;
  const previewLabel = row.failureBehaviour ? 'Failure behaviour' : 'Rationale';
  return (
    <li aria-label={summary} className={`rounded-lg border p-3 sm:p-4 ${editing ? 'ring-1 ring-blue-500' : ''} ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <PartySummary party={row.consumer} role="Consumer" faint={faint} onOpen={onOpen} />
        <ArrowRight className={`w-4 h-4 shrink-0 self-center rotate-90 sm:rotate-0 ${faint}`} aria-hidden />
        <PartySummary party={row.provider} role="Provider" faint={faint} onOpen={onOpen} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label={summary}>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${row.type === 'HARD' ? 'bg-rose-500/15 text-rose-500' : 'bg-amber-500/15 text-amber-500'}`}>
          {typeLabel}
        </span>
        {row.criticality && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${isDark ? 'bg-[#1E293B] text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
            {row.criticality}
          </span>
        )}
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-sans ${isDark ? 'bg-[#1E293B] text-slate-300' : 'bg-slate-100 text-slate-700'}`} title={limited ? 'This feature stops if the provider fails' : 'Not limited to one feature'}>
          {feature}
        </span>
        <span className={`text-[11px] font-sans ${muted}`}>{dependencyMethodLabel(row.method)}</span>
        <span className="ml-auto inline-flex flex-wrap items-center gap-2">
          {details.length > 0 && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              className={`inline-flex items-center gap-1 text-[11px] font-sans cursor-pointer hover:text-blue-500 ${muted}`}
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
              {open ? 'Hide details' : 'Details'}
            </button>
          )}
          {manage && !manage.confirmingDelete && (
            <>
              <button type="button" onClick={manage.onEdit} className="text-[11px] font-sans font-semibold cursor-pointer hover:text-blue-500">
                Edit
              </button>
              <button type="button" onClick={manage.onAskDelete} className="text-[11px] font-sans font-semibold cursor-pointer text-rose-500 hover:text-rose-400">
                Delete
              </button>
            </>
          )}
        </span>
      </div>
      {preview && !open && (
        <p className={`mt-2 text-[12px] font-sans line-clamp-2 break-words ${muted}`} title={preview}>
          <span className={`font-semibold ${faint}`}>{previewLabel}. </span>{preview}
        </p>
      )}
      {open && (
        <dl className={`mt-3 pt-3 border-t grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[12px] font-sans ${rowBorder}`}>
          {details.map(item => (
            <div key={item.label} className="min-w-0">
              <dt className={`text-[10px] uppercase tracking-wide ${faint}`}>{item.label}</dt>
              <dd className="break-words">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {manage?.confirmingDelete && (
        <div role="alert" className={`mt-3 pt-3 border-t space-y-2 ${rowBorder}`}>
          <p className="text-[12px] font-sans">
            Remove {partyHeading(row.consumer)} → {partyHeading(row.provider)}? The applications stay. Only this relationship is removed.
          </p>
          {manage.deleteError && <p className="text-[12px] font-sans text-rose-500">{manage.deleteError}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={manage.onConfirmDelete}
              disabled={manage.deleting}
              className="inline-flex items-center px-3 py-1.5 rounded text-xs font-mono font-semibold cursor-pointer disabled:opacity-50 bg-rose-600 hover:bg-rose-700 text-white"
            >
              {manage.deleting ? 'Removing…' : 'Remove'}
            </button>
            <button
              type="button"
              onClick={manage.onCancelDelete}
              disabled={manage.deleting}
              className={`inline-flex items-center px-3 py-1.5 rounded text-xs font-mono font-semibold cursor-pointer disabled:opacity-50 ${isDark ? 'bg-[#162033] text-slate-200 border border-[#23334E]' : 'bg-slate-100 text-slate-800 border border-slate-300'}`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {editor}
    </li>
  );
};
