import React, { useState, useEffect, useCallback } from 'react';
import { useOps } from '../../context/OpsContext';
import { Users, RefreshCw, Shield, CheckCircle2, XCircle, Wifi } from 'lucide-react';
import { UsersService } from '../../services/users';
import { SafeUser } from '../../services/api';
import { SkeletonTable } from '../ui/Skeleton';
import { ErrorState } from '../ui/ErrorState';
import { EmptyState } from '../ui/EmptyState';
import { Pagination } from '../ui/Pagination';
import { RbacGuard } from '../ui/RbacGuard';

const ROLE_COLORS: Record<string, string> = {
  super_admin:      'text-rose-400 bg-rose-950/50 border-rose-800/60',
  it_administrator: 'text-amber-400 bg-amber-950/50 border-amber-800/60',
  operator:         'text-blue-400 bg-blue-950/50 border-blue-800/60',
  viewer:           'text-slate-400 bg-slate-800/50 border-slate-700/60',
};

export const UsersView: React.FC = () => {
  const { theme } = useOps();
  const isDark = theme === 'dark';

  const [users,    setUsers]    = useState<SafeUser[]>([]);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<unknown>(null);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await UsersService.list({ page, pageSize });
      setUsers(res.data);
      setTotal(res.pagination.total);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">USER MANAGEMENT</h1>
          <p className={`text-xs font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Operator accounts, roles and access control — {total} users registered
          </p>
        </div>
        <button onClick={load} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border cursor-pointer ${isDark ? 'bg-[#162033] border-[#243552] text-slate-200 hover:bg-[#1C2942]' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 shadow-xs'}`}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : 'text-blue-400'}`} />
          Refresh
        </button>
      </div>

      {/* Role legend */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(ROLE_COLORS).map(([role, cls]) => (
          <span key={role} className={`text-[10px] font-mono font-semibold px-2.5 py-1 rounded border ${cls}`}>
            {role.replace('_', ' ').toUpperCase()}
          </span>
        ))}
      </div>

      {loading ? (
        <SkeletonTable rows={8} cols={5} />
      ) : error ? (
        <ErrorState error={error} onRetry={load} />
      ) : users.length === 0 ? (
        <EmptyState icon={Users} title="No users found" description="No operator accounts are registered." />
      ) : (
        <div className={`rounded-lg border overflow-hidden ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className={`text-[10px] font-semibold uppercase border-b ${isDark ? 'bg-[#0B0F17] text-slate-500 border-[#1A2332]' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                <tr>
                  <th className="py-2.5 px-3.5">Name</th>
                  <th className="py-2.5 px-3.5">Email</th>
                  <th className="py-2.5 px-3.5">Role</th>
                  <th className="py-2.5 px-3.5">Status</th>
                  <th className="py-2.5 px-3.5">On-Call</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
                {users.map(u => (
                  <tr key={u.id} className={`transition-colors ${isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}`}>
                    <td className={`py-2.5 px-3.5 font-sans font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                      {u.fullName}
                      {u.displayName && u.displayName !== u.fullName && (
                        <span className={`ml-1.5 text-[10px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                          ({u.displayName})
                        </span>
                      )}
                    </td>
                    <td className={`py-2.5 px-3.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{u.email}</td>
                    <td className="py-2.5 px-3.5">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${ROLE_COLORS[u.roleName] ?? 'text-slate-400'}`}>
                        {u.roleName.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-3.5">
                      <div className="flex items-center gap-1.5">
                        {u.isActive
                          ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /><span className="text-emerald-500">Active</span></>
                          : <><XCircle className="w-3.5 h-3.5 text-rose-500" /><span className="text-rose-500">Inactive</span></>
                        }
                      </div>
                    </td>
                    <td className="py-2.5 px-3.5">
                      {u.isOnCall
                        ? <span className="flex items-center gap-1 text-blue-400"><Wifi className="w-3 h-3" />On-Call</span>
                        : <span className={isDark ? 'text-slate-600' : 'text-slate-400'}>—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-3">
            <Pagination page={page} totalPages={Math.ceil(total / pageSize)} total={total} pageSize={pageSize} onPage={setPage} />
          </div>
        </div>
      )}
    </div>
  );
};
