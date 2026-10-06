import React, { useState, useEffect, useCallback } from 'react';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import {
  Users, RefreshCw, CheckCircle2, XCircle, Wifi, UserPlus, KeyRound, Trash2, Lock, Loader2, X,
} from 'lucide-react';
import { api, ApiError, PaginatedApiResponse, ApiResponse, SafeUser } from '../../services/api';
import { AuthService } from '../../services/auth';
import { SkeletonTable } from '../ui/Skeleton';
import { ErrorState } from '../ui/ErrorState';
import { EmptyState } from '../ui/EmptyState';

type RoleName = SafeUser['roleName'];
const ROLES: RoleName[] = ['viewer', 'operator', 'it_administrator', 'super_admin'];

const ROLE_COLORS: Record<string, string> = {
  super_admin:      'text-rose-400 bg-rose-950/50 border-rose-800/60',
  it_administrator: 'text-amber-400 bg-amber-950/50 border-amber-800/60',
  operator:         'text-blue-400 bg-blue-950/50 border-blue-800/60',
  viewer:           'text-slate-400 bg-slate-800/50 border-slate-700/60',
};

const roleLabel = (r: string) => r.replace(/_/g, ' ').toUpperCase();

/** Mirrors the server rule: ≥10 chars with upper, lower and a number. Returns an error message or null. */
const passwordProblem = (pw: string): string | null => {
  if (pw.length < 10) return 'Password must be at least 10 characters';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain upper-case, lower-case letters and a number';
  return null;
};

const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const errMsg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Unexpected error');

const EMPTY_NEW_USER = { email: '', fullName: '', displayName: '', roleName: 'viewer' as RoleName, password: '' };

export const UsersView: React.FC = () => {
  const { theme, notify } = useOps();
  const { user: me, hasRole } = useAuth();
  const isDark = theme === 'dark';
  const isAdmin = hasRole('it_administrator');
  const isSuper = hasRole('super_admin');

  const [users, setUsers] = useState<SafeUser[]>([]);
  const [loading, setLoading] = useState(isAdmin);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState(EMPTY_NEW_USER);
  const [createError, setCreateError] = useState<string | null>(null);

  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<string | null>(null);

  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<PaginatedApiResponse<SafeUser>>('/api/v1/users?pageSize=500');
      setUsers(res.data ?? []);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { void load(); }, [load]);

  const replaceUser = (u: SafeUser) => setUsers(prev => prev.map(x => (x.id === u.id ? u : x)));

  const patchUser = async (u: SafeUser, key: string, data: Partial<SafeUser> & { password?: string }, success: string) => {
    setBusy(`${u.id}:${key}`);
    try {
      const res = await api.patch<ApiResponse<SafeUser>>(`/api/v1/users/${encodeURIComponent(u.id)}`, data);
      replaceUser(res.data);
      notify('success', success);
      return true;
    } catch (e) {
      notify('error', errMsg(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    if (!newUser.email.trim() || !newUser.fullName.trim()) return setCreateError('Email and full name are required');
    const p = passwordProblem(newUser.password);
    if (p) return setCreateError(p);
    setBusy('create');
    try {
      const res = await api.post<ApiResponse<SafeUser>>('/api/v1/users', {
        email: newUser.email.trim(),
        fullName: newUser.fullName.trim(),
        displayName: newUser.displayName.trim() || undefined,
        roleName: newUser.roleName,
        password: newUser.password,
      });
      setUsers(prev => [...prev, res.data]);
      notify('success', `User ${res.data.email} created`);
      setNewUser(EMPTY_NEW_USER);
      setShowCreate(false);
    } catch (err) {
      setCreateError(errMsg(err));
    } finally {
      setBusy(null);
    }
  };

  const handleReset = async (u: SafeUser) => {
    setResetError(null);
    const p = passwordProblem(resetPw);
    if (p) return setResetError(p);
    const ok = await patchUser(u, 'reset', { password: resetPw }, `Password reset for ${u.email} (their sessions were signed out)`);
    if (ok) { setResetFor(null); setResetPw(''); }
  };

  const handleDelete = async (u: SafeUser) => {
    setBusy(`${u.id}:delete`);
    try {
      await api.delete(`/api/v1/users/${encodeURIComponent(u.id)}`);
      setUsers(prev => prev.filter(x => x.id !== u.id));
      notify('success', `User ${u.email} deleted`);
      setDeleteFor(null);
    } catch (e) {
      notify('error', errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const handleChangeMyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (!pwForm.current) return setPwError('Enter your current password');
    const p = passwordProblem(pwForm.next);
    if (p) return setPwError(p);
    if (pwForm.next !== pwForm.confirm) return setPwError('New passwords do not match');
    if (pwForm.next === pwForm.current) return setPwError('New password must be different from the current one');
    setPwBusy(true);
    try {
      await AuthService.changePassword(pwForm.current, pwForm.next);
      setPwForm({ current: '', next: '', confirm: '' });
      notify('success', 'Password changed. Other sessions were signed out.');
    } catch (err) {
      setPwError(errMsg(err));
    } finally {
      setPwBusy(false);
    }
  };

  const panel = `rounded-lg border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`;
  const input = `w-full px-2.5 py-1.5 rounded border text-xs font-mono focus:outline-none focus:border-blue-500 disabled:opacity-50 ${
    isDark ? 'bg-[#0B0F17] border-[#1E293B] text-slate-100 placeholder:text-slate-600' : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400'
  }`;
  const labelCls = `block text-[10px] uppercase mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`;
  const smallBtn = `inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
    isDark ? 'border-[#243552] text-slate-300 hover:bg-[#1C2942]' : 'border-slate-300 text-slate-700 hover:bg-slate-50'
  }`;
  const primaryBtn = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold rounded bg-blue-600 text-white hover:bg-blue-700 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed';
  const isBusy = (id: string, key: string) => busy === `${id}:${key}`;

  const changePasswordCard = (
    <div className={`${panel} p-4 space-y-3`}>
      <div className="flex items-center gap-2">
        <Lock className="w-4 h-4 text-blue-500" />
        <h2 className="text-xs font-bold uppercase tracking-wider font-mono">Change my password</h2>
        {me && <span className={`text-[10px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{me.email}</span>}
      </div>
      <form onSubmit={handleChangeMyPassword} className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-end">
        <div>
          <label className={labelCls}>Current password</label>
          <input type="password" autoComplete="current-password" className={input} disabled={pwBusy}
            value={pwForm.current} onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>New password</label>
          <input type="password" autoComplete="new-password" className={input} disabled={pwBusy}
            value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>Confirm new password</label>
          <input type="password" autoComplete="new-password" className={input} disabled={pwBusy}
            value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} />
        </div>
        <button type="submit" className={primaryBtn} disabled={pwBusy}>
          {pwBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
          Change password
        </button>
      </form>
      <p className={`text-[10px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
        At least 10 characters with upper-case, lower-case and a number. Changing it signs out your other sessions.
      </p>
      {pwError && <p className="text-[11px] font-mono text-rose-500">{pwError}</p>}
    </div>
  );

  if (!isAdmin) {
    return (
      <div className="space-y-5">
        <div className={`pb-3 border-b ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
          <h1 className="text-lg font-bold font-mono tracking-tight">MY ACCOUNT</h1>
          <p className={`text-xs font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {me ? <>{me.fullName} · {roleLabel(me.roleName)}</> : 'Signed in'} · user management requires the IT administrator role
          </p>
        </div>
        {changePasswordCard}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">USER MANAGEMENT</h1>
          <p className={`text-xs font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Operator accounts, roles and access control{!loading && !error && <> — {users.length} user{users.length === 1 ? '' : 's'}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setShowCreate(v => !v); setCreateError(null); }} className={primaryBtn}>
            {showCreate ? <X className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
            {showCreate ? 'Cancel' : 'Add user'}
          </button>
          <button onClick={() => void load()} disabled={loading}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border cursor-pointer disabled:opacity-60 ${isDark ? 'bg-[#162033] border-[#243552] text-slate-200 hover:bg-[#1C2942]' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 shadow-xs'}`}>
            <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Create user */}
      {showCreate && (
        <form onSubmit={handleCreate} className={`${panel} p-4 space-y-3`}>
          <h2 className="text-xs font-bold uppercase tracking-wider font-mono">New user</h2>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
            <div>
              <label className={labelCls}>Email *</label>
              <input type="email" className={input} value={newUser.email} disabled={busy === 'create'}
                onChange={e => setNewUser(u => ({ ...u, email: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Full name *</label>
              <input className={input} value={newUser.fullName} disabled={busy === 'create'}
                onChange={e => setNewUser(u => ({ ...u, fullName: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Display name</label>
              <input className={input} value={newUser.displayName} disabled={busy === 'create'} placeholder="Defaults to full name"
                onChange={e => setNewUser(u => ({ ...u, displayName: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Role</label>
              <select className={input} value={newUser.roleName} disabled={busy === 'create'}
                onChange={e => setNewUser(u => ({ ...u, roleName: e.target.value as RoleName }))}>
                {ROLES.filter(r => r !== 'super_admin' || isSuper).map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Initial password *</label>
              <input type="password" autoComplete="new-password" className={input} value={newUser.password} disabled={busy === 'create'}
                onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className={`text-[10px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
              Password: at least 10 characters with upper-case, lower-case and a number. Share it with the user securely.
            </p>
            <button type="submit" className={primaryBtn} disabled={busy === 'create'}>
              {busy === 'create' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              Create user
            </button>
          </div>
          {createError && <p className="text-[11px] font-mono text-rose-500">{createError}</p>}
        </form>
      )}

      {loading && users.length === 0 ? (
        <SkeletonTable rows={6} cols={7} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void load()} />
      ) : users.length === 0 ? (
        <EmptyState icon={Users} title="No users found" description="Use “Add user” to create operator accounts." />
      ) : (
        <div className={`${panel} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono min-w-[960px]">
              <thead className={`text-[10px] font-semibold uppercase border-b ${isDark ? 'bg-[#0B0F17] text-slate-500 border-[#1A2332]' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                <tr>
                  <th className="py-2.5 px-3.5">Name</th>
                  <th className="py-2.5 px-3.5">Email</th>
                  <th className="py-2.5 px-3.5">Role</th>
                  <th className="py-2.5 px-3.5">Status</th>
                  <th className="py-2.5 px-3.5">On-Call</th>
                  <th className="py-2.5 px-3.5">Last login</th>
                  <th className="py-2.5 px-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
                {users.map(u => {
                  const isSelf = me?.id === u.id;
                  // Only super admins may change super admin roles or grant super admin
                  const canEditRole = !isSelf && (isSuper || u.roleName !== 'super_admin');
                  return (
                    <React.Fragment key={u.id}>
                      <tr className={`transition-colors ${isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}`}>
                        <td className={`py-2.5 px-3.5 font-sans font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                          {u.fullName}
                          {u.displayName && u.displayName !== u.fullName && (
                            <span className={`ml-1.5 text-[10px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>({u.displayName})</span>
                          )}
                          {isSelf && <span className="ml-1.5 text-[10px] font-mono text-blue-400">(you)</span>}
                        </td>
                        <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{u.email}</td>
                        <td className="py-2.5 px-3.5">
                          {canEditRole ? (
                            <select
                              value={u.roleName}
                              disabled={isBusy(u.id, 'role')}
                              onChange={e => void patchUser(u, 'role', { roleName: e.target.value as RoleName }, `${u.email} is now ${roleLabel(e.target.value)}`)}
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-pointer disabled:opacity-50 ${ROLE_COLORS[u.roleName] ?? ''} ${isDark ? '' : 'bg-white'}`}
                            >
                              {ROLES.filter(r => r !== 'super_admin' || isSuper).map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                            </select>
                          ) : (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${ROLE_COLORS[u.roleName] ?? 'text-slate-400'}`}>
                              {roleLabel(u.roleName)}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3.5">
                          <div className="flex items-center gap-1.5">
                            {u.isActive
                              ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /><span className="text-emerald-500">Active</span></>
                              : <><XCircle className="w-3.5 h-3.5 text-rose-500" /><span className="text-rose-500">Inactive</span></>}
                          </div>
                        </td>
                        <td className="py-2.5 px-3.5">
                          <button
                            onClick={() => void patchUser(u, 'oncall', { isOnCall: !u.isOnCall }, `${u.email} ${u.isOnCall ? 'removed from' : 'added to'} on-call`)}
                            disabled={isBusy(u.id, 'oncall')}
                            title={u.isOnCall ? 'Remove from on-call' : 'Put on-call'}
                            className={`inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 ${u.isOnCall ? 'text-blue-400' : isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-700'}`}
                          >
                            {isBusy(u.id, 'oncall') ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wifi className="w-3 h-3" />}
                            {u.isOnCall ? 'On-Call' : 'Off'}
                          </button>
                        </td>
                        <td className={`py-2.5 px-3.5 whitespace-nowrap text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                          {fmtDateTime(u.lastLoginAt)}
                        </td>
                        <td className="py-2.5 px-3.5">
                          <div className="flex items-center justify-end gap-1.5">
                            {!isSelf && (isSuper || u.roleName !== 'super_admin') && (
                              <button
                                className={smallBtn}
                                disabled={isBusy(u.id, 'active')}
                                onClick={() => {
                                  if (u.isActive && !window.confirm(`Deactivate ${u.email}? They will be signed out and unable to log in.`)) return;
                                  void patchUser(u, 'active', { isActive: !u.isActive }, `${u.email} ${u.isActive ? 'deactivated' : 'activated'}`);
                                }}
                              >
                                {isBusy(u.id, 'active') && <Loader2 className="w-3 h-3 animate-spin" />}
                                {u.isActive ? 'Deactivate' : 'Activate'}
                              </button>
                            )}
                            {(isSuper || u.roleName !== 'super_admin') && (
                              <button
                                className={smallBtn}
                                onClick={() => { setResetFor(resetFor === u.id ? null : u.id); setResetPw(''); setResetError(null); setDeleteFor(null); }}
                              >
                                <KeyRound className="w-3 h-3" /> Reset password
                              </button>
                            )}
                            {isSuper && !isSelf && (
                              <button
                                className={`${smallBtn} text-rose-500`}
                                onClick={() => { setDeleteFor(deleteFor === u.id ? null : u.id); setResetFor(null); }}
                              >
                                <Trash2 className="w-3 h-3" /> Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {resetFor === u.id && (
                        <tr className={isDark ? 'bg-[#0D1320]' : 'bg-slate-50'}>
                          <td colSpan={7} className="py-2.5 px-3.5">
                            <form onSubmit={e => { e.preventDefault(); void handleReset(u); }} className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[11px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>New password for {u.email}:</span>
                              <input type="password" autoComplete="new-password" autoFocus className={`${input} max-w-xs`} value={resetPw}
                                disabled={isBusy(u.id, 'reset')} onChange={e => setResetPw(e.target.value)} />
                              <button type="submit" className={primaryBtn} disabled={isBusy(u.id, 'reset')}>
                                {isBusy(u.id, 'reset') && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Set password
                              </button>
                              <button type="button" className={smallBtn} onClick={() => setResetFor(null)}>Cancel</button>
                              <span className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Signs the user out of all sessions.</span>
                              {resetError && <span className="text-[11px] text-rose-500 w-full">{resetError}</span>}
                            </form>
                          </td>
                        </tr>
                      )}

                      {deleteFor === u.id && (
                        <tr className={isDark ? 'bg-rose-950/20' : 'bg-rose-50'}>
                          <td colSpan={7} className="py-2.5 px-3.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[11px] text-rose-500 font-semibold">Permanently delete {u.email}? This cannot be undone.</span>
                              <button
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold rounded bg-rose-600 text-white hover:bg-rose-700 cursor-pointer disabled:opacity-60"
                                disabled={isBusy(u.id, 'delete')}
                                onClick={() => void handleDelete(u)}
                              >
                                {isBusy(u.id, 'delete') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Delete user
                              </button>
                              <button className={smallBtn} onClick={() => setDeleteFor(null)}>Cancel</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {changePasswordCard}
    </div>
  );
};
