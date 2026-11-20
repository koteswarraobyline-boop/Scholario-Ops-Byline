import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { api, CertificateRow, CredentialInput, CredentialRow } from '../../services/api';
import { CredentialKind } from '../../types';
import { EmptyState } from '../ui/EmptyState';
import { Pagination, useClientPagination } from '../ui/Pagination';

const KINDS: CredentialKind[] = ['API_KEY', 'TOKEN', 'SUBSCRIPTION'];
const KIND_LABEL: Record<CredentialKind, string> = {
  API_KEY: 'API key',
  TOKEN: 'Token',
  SUBSCRIPTION: 'Subscription',
};

const stateClass = (state: string) =>
  state === 'EXPIRED' ? 'text-rose-500'
    : state === 'EXPIRING' ? 'text-amber-500'
      : state === 'OK' ? 'text-emerald-500'
        : 'text-slate-500';

const fmt = (iso?: string | null) => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '—' : new Date(t).toLocaleString();
};

export const CredentialsView: React.FC = () => {
  const { theme, applications } = useOps();
  const { hasRole } = useAuth();
  const isDark = theme === 'dark';
  const canEdit = hasRole('it_administrator');
  const [rows, setRows] = useState<CredentialRow[]>([]);
  const [certificates, setCertificates] = useState<CertificateRow[]>([]);
  const [warnDays, setWarnDays] = useState(14);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const credentialPaging = useClientPagination(rows, 10);
  const certificatePaging = useClientPagination(certificates, 10);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await api.getCredentials();
      setRows(data.credentials);
      setCertificates(data.certificates);
      setWarnDays(data.warnDays);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load credentials');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const panel = `rounded border p-4 space-y-3 ${isDark ? 'bg-[#101624] border-[#1E293B]' : 'bg-white border-slate-200'}`;
  const muted = isDark ? 'text-slate-400' : 'text-slate-600';
  const input = `w-full rounded border px-2 py-1.5 text-xs ${isDark ? 'bg-[#0A0F1A] border-[#1E293B] text-slate-100' : 'bg-white border-slate-300 text-slate-900'}`;

  const onCreate = async (data: CredentialInput) => {
    setBusy(true);
    setError('');
    try {
      await api.createCredential(data);
      setOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the credential');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (row: CredentialRow) => {
    if (!window.confirm(`Remove ${row.name}? The secret was never stored. Open expiry incidents for it will resolve.`)) return;
    setBusy(true);
    try {
      await api.deleteCredential(row.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the credential');
    } finally {
      setBusy(false);
    }
  };

  const onEvaluate = async () => {
    setBusy(true);
    try {
      await api.evaluateCredentials();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not evaluate expiry');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 font-mono text-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={`text-lg font-bold font-sans flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
            <KeyRound className="w-5 h-5" /> Credentials
          </h1>
          <p className={`mt-1 max-w-3xl font-sans ${muted}`}>
            Expiry dates only. The secret itself is not stored.
            Inside {warnDays} days they raise a warning. After the date, and when an API answers with an expired key, Ops opens one incident and notifies the owner through the existing channels.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void onEvaluate()} disabled={busy} className={`px-2.5 py-1.5 rounded border inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 ${isDark ? 'border-[#1E293B]' : 'border-slate-300'}`}>
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Check expiry
          </button>
          {canEdit && (
            <button type="button" onClick={() => setOpen(v => !v)} className="px-2.5 py-1.5 rounded bg-blue-600 text-white inline-flex items-center gap-1 cursor-pointer">
              <Plus className="w-3.5 h-3.5" /> Add expiry
            </button>
          )}
        </div>
      </div>
      {error && <div className="text-rose-500">{error}</div>}
      {open && canEdit && <CredentialForm applications={applications.map(a => ({ id: a.id, name: a.name }))} inputClass={input} busy={busy} onCancel={() => setOpen(false)} onSave={onCreate} isDark={isDark} />}

      <section className={panel}>
        <h2 className={`font-sans font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>API keys, tokens and subscriptions</h2>
        {rows.length === 0 ? (
          <EmptyState title="No expiry dates yet" description="Add an API key, token or subscription with the date it stops working. Do not paste the secret." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className={muted}>
                <tr>
                  <th className="py-1 pr-3 font-medium">Name</th>
                  <th className="py-1 pr-3 font-medium">Kind</th>
                  <th className="py-1 pr-3 font-medium">Provider</th>
                  <th className="py-1 pr-3 font-medium">Owner</th>
                  <th className="py-1 pr-3 font-medium">Expires</th>
                  <th className="py-1 pr-3 font-medium">State</th>
                  {canEdit && <th className="py-1 font-medium" />}
                </tr>
              </thead>
              <tbody>
                {credentialPaging.slice.map(row => (
                  <tr key={row.id} className={isDark ? 'border-t border-[#1E293B]' : 'border-t border-slate-200'}>
                    <td className="py-2 pr-3">{row.name}</td>
                    <td className="py-2 pr-3">{KIND_LABEL[row.kind]}</td>
                    <td className="py-2 pr-3">{row.provider}</td>
                    <td className="py-2 pr-3">{row.owner}</td>
                    <td className="py-2 pr-3">{fmt(row.expiresAt)}{row.daysLeft != null ? ` (${row.daysLeft}d)` : ''}</td>
                    <td className={`py-2 pr-3 font-semibold ${stateClass(row.state)}`}>{row.state}</td>
                    {canEdit && (
                      <td className="py-2 text-right">
                        <button type="button" onClick={() => void onDelete(row)} disabled={busy} className="text-rose-500 cursor-pointer disabled:opacity-50" title="Remove">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={credentialPaging.page} totalPages={credentialPaging.totalPages} total={credentialPaging.total} pageSize={credentialPaging.pageSize} onPage={credentialPaging.setPage} />
          </>
        )}
      </section>

      <section className={panel}>
        <h2 className={`font-sans font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>TLS certificates</h2>
        <p className={muted}>From the existing SSL monitors. An expired or untrusted certificate already opens a monitor incident. A certificate inside the SSL warning window opens an expiry alert.</p>
        {certificates.length === 0 ? (
          <EmptyState title="No TLS monitors" description="Turn on TLS certificate monitoring for an application URL, or add an SSL monitor." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className={muted}>
                <tr>
                  <th className="py-1 pr-3 font-medium">Monitor</th>
                  <th className="py-1 pr-3 font-medium">Host</th>
                  <th className="py-1 pr-3 font-medium">Valid until</th>
                  <th className="py-1 pr-3 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {certificatePaging.slice.map(row => (
                  <tr key={row.monitorId} className={isDark ? 'border-t border-[#1E293B]' : 'border-t border-slate-200'}>
                    <td className="py-2 pr-3">{row.name}</td>
                    <td className="py-2 pr-3">{row.target}</td>
                    <td className="py-2 pr-3">{fmt(row.validTo)}{row.daysLeft != null ? ` (${row.daysLeft}d)` : ''}</td>
                    <td className={`py-2 pr-3 font-semibold ${stateClass(row.state)}`}>{row.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={certificatePaging.page} totalPages={certificatePaging.totalPages} total={certificatePaging.total} pageSize={certificatePaging.pageSize} onPage={certificatePaging.setPage} />
          </>
        )}
      </section>
    </div>
  );
};

const CredentialForm: React.FC<{
  applications: Array<{ id: string; name: string }>;
  inputClass: string;
  busy: boolean;
  isDark: boolean;
  onCancel: () => void;
  onSave: (data: CredentialInput) => Promise<void>;
}> = ({ applications, inputClass, busy, isDark, onCancel, onSave }) => {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CredentialKind>('API_KEY');
  const [provider, setProvider] = useState('');
  const [owner, setOwner] = useState('');
  const [environment, setEnvironment] = useState<'PRD' | 'DR'>('PRD');
  const [expiresAt, setExpiresAt] = useState('');
  const [applicationId, setApplicationId] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <form
      className={`rounded border p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 ${isDark ? 'bg-[#101624] border-[#1E293B]' : 'bg-white border-slate-200'}`}
      onSubmit={e => {
        e.preventDefault();
        const expires = new Date(expiresAt);
        if (Number.isNaN(expires.getTime())) return;
        void onSave({
          name, kind, provider, owner, environment, notes,
          expiresAt: expires.toISOString(),
          applicationId: applicationId || null,
        });
      }}
    >
      <label className="space-y-1">Name<input className={inputClass} value={name} required maxLength={120} onChange={e => setName(e.target.value)} placeholder="OpenAI production key" /></label>
      <label className="space-y-1">Kind
        <select className={inputClass} value={kind} onChange={e => setKind(e.target.value as CredentialKind)}>
          {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </label>
      <label className="space-y-1">Provider<input className={inputClass} value={provider} required maxLength={80} onChange={e => setProvider(e.target.value)} placeholder="OpenAI" /></label>
      <label className="space-y-1">Owner<input className={inputClass} value={owner} required maxLength={120} onChange={e => setOwner(e.target.value)} placeholder="owner@example.com" /></label>
      <label className="space-y-1">Environment
        <select className={inputClass} value={environment} onChange={e => setEnvironment(e.target.value as 'PRD' | 'DR')}>
          <option value="PRD">PRD</option>
          <option value="DR">DR</option>
        </select>
      </label>
      <label className="space-y-1">Expiry
        <input className={inputClass} type="datetime-local" required value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
      </label>
      <label className="space-y-1 sm:col-span-2">Application
        <select className={inputClass} value={applicationId} onChange={e => setApplicationId(e.target.value)}>
          <option value="">Not linked</option>
          {applications.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label className="space-y-1 sm:col-span-2">Notes
        <input className={inputClass} value={notes} maxLength={500} onChange={e => setNotes(e.target.value)} placeholder="Where the secret lives. Do not paste it." />
      </label>
      <div className="sm:col-span-2 flex gap-2">
        <button type="submit" disabled={busy} className="px-3 py-1.5 rounded bg-blue-600 text-white cursor-pointer disabled:opacity-50">Save expiry</button>
        <button type="button" onClick={onCancel} className={`px-3 py-1.5 rounded border cursor-pointer ${isDark ? 'border-[#1E293B]' : 'border-slate-300'}`}>Cancel</button>
      </div>
    </form>
  );
};
