import React, { useState, useEffect, useCallback } from 'react';
import { useOps } from '../../context/OpsContext';
import { Shield, RefreshCw, Filter } from 'lucide-react';
import { AuditService, AuditLogEntry } from '../../services/audit';
import { SkeletonTable } from '../ui/Skeleton';
import { ErrorState } from '../ui/ErrorState';
import { EmptyState } from '../ui/EmptyState';
import { Pagination } from '../ui/Pagination';

const CATEGORIES = ['', 'AUTH', 'INCIDENT', 'FAILOVER', 'MAINTENANCE', 'MONITOR', 'CLOUDFLARE', 'INFRASTRUCTURE', 'RUNBOOK', 'USER', 'SYSTEM', 'NOTIFICATION'];

const CATEGORY_COLORS: Record<string, string> = {
  AUTH: 'text-blue-400', INCIDENT: 'text-rose-400', FAILOVER: 'text-amber-400',
  MAINTENANCE: 'text-purple-400', MONITOR: 'text-cyan-400', CLOUDFLARE: 'text-orange-400',
  INFRASTRUCTURE: 'text-emerald-400', RUNBOOK: 'text-yellow-400', USER: 'text-sky-400',
  SYSTEM: 'text-slate-400', NOTIFICATION: 'text-pink-400',
};

export const AuditLogsView: React.FC = () => {
  const { theme } = useOps();
  const isDark = theme === 'dark';

  const [logs,       setLogs]       = useState<AuditLogEntry[]>([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<unknown>(null);
  const [category,   setCategory]   = useState('');

  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await AuditService.list({ page, pageSize, category: category || undefined });
      setLogs(res.data);
      setTotal(res.pagination.total);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [page, category]);

  useEffect(() => { load(); }, [load]);

  // Reset to page 1 on filter change
  const handleCategory = (c: string) => { setCategory(c); setPage(1); };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">ADMINISTRATIVE AUDIT LOGS</h1>
          <p className={`text-xs font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Immutable record of all privileged operator commands, failovers, incident actions &amp; routing changes
          </p>
        </div>
        <button onClick={load} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border cursor-pointer ${isDark ? 'bg-[#162033] border-[#243552] text-slate-200 hover:bg-[#1C2942]' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 shadow-xs'}`}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : 'text-blue-400'}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className={`flex items-center gap-1.5 text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          <Filter className="w-3.5 h-3.5" />
          <span>Category:</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map(c => (
            <button key={c || 'ALL'} onClick={() => handleCategory(c)}
              className={`px-2.5 py-1 text-[10px] font-mono rounded border cursor-pointer transition-colors ${
                category === c
                  ? 'bg-blue-600 text-white border-blue-600'
                  : isDark ? 'border-[#243552] text-slate-300 hover:bg-[#1C2942]' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}>
              {c || 'ALL'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <SkeletonTable rows={10} cols={6} />
      ) : error ? (
        <ErrorState error={error} onRetry={load} />
      ) : logs.length === 0 ? (
        <EmptyState icon={Shield} title="No audit log entries" description="Operator actions will appear here as they are performed." />
      ) : (
        <div className={`rounded-lg border overflow-hidden ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className={`text-[10px] font-semibold uppercase border-b ${isDark ? 'bg-[#0B0F17] text-slate-500 border-[#1A2332]' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                <tr>
                  <th className="py-2.5 px-3.5">Timestamp</th>
                  <th className="py-2.5 px-3.5">Operator</th>
                  <th className="py-2.5 px-3.5">Category</th>
                  <th className="py-2.5 px-3.5">Action</th>
                  <th className="py-2.5 px-3.5">Target</th>
                  <th className="py-2.5 px-3.5">Details</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
                {logs.map(log => (
                  <tr key={log.id} className={`transition-colors ${isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}`}>
                    <td className={`py-2.5 px-3.5 whitespace-nowrap text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className={`py-2.5 px-3.5 font-sans font-semibold whitespace-nowrap ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                      {log.operator}
                    </td>
                    <td className="py-2.5 px-3.5">
                      <span className={`font-semibold text-[10px] ${CATEGORY_COLORS[log.category] ?? 'text-slate-400'}`}>
                        {log.category}
                      </span>
                    </td>
                    <td className="py-2.5 px-3.5 text-blue-400 font-semibold whitespace-nowrap">
                      {log.action}
                    </td>
                    <td className={`py-2.5 px-3.5 whitespace-nowrap text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {log.target_id ?? '—'}
                    </td>
                    <td className={`py-2.5 px-3.5 font-sans max-w-xs truncate ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                      {log.details ?? '—'}
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
