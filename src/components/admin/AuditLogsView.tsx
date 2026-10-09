import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useOps } from '../../context/OpsContext';
import { Shield, RefreshCw, Filter, Search, X } from 'lucide-react';
import { api } from '../../services/api';
import { AuditLog } from '../../types';
import { SkeletonTable } from '../ui/Skeleton';
import { ErrorState } from '../ui/ErrorState';
import { EmptyState } from '../ui/EmptyState';
import { Pagination } from '../ui/Pagination';

const CATEGORIES: Array<AuditLog['category'] | ''> = [
  '', 'INCIDENT', 'FAILOVER', 'MAINTENANCE', 'MONITOR', 'CLOUDFLARE', 'INFRASTRUCTURE', 'RUNBOOK',
  'APPLICATION', 'AUTH', 'USER', 'NOTIFICATION', 'DEPLOYMENT', 'BACKUP',
];

const CATEGORY_COLORS: Record<string, string> = {
  AUTH: 'text-blue-400', INCIDENT: 'text-rose-400', FAILOVER: 'text-amber-400',
  MAINTENANCE: 'text-purple-400', MONITOR: 'text-cyan-400', CLOUDFLARE: 'text-orange-400',
  INFRASTRUCTURE: 'text-emerald-400', RUNBOOK: 'text-yellow-400', USER: 'text-sky-400',
  NOTIFICATION: 'text-pink-400', APPLICATION: 'text-indigo-400', DEPLOYMENT: 'text-teal-400',
  BACKUP: 'text-lime-400',
};

const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return iso && !Number.isNaN(d.getTime()) ? d.toLocaleString() : '—';
};

export const AuditLogsView: React.FC = () => {
  const { theme } = useOps();
  const isDark = theme === 'dark';

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [category, setCategory] = useState<string>('');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');

  const pageSize = 25;

  // Debounce the search box so we don't query on every keystroke
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Typing or paging fast fires several requests: only the latest one may update the list
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAuditLogs({ page, pageSize, category: category || undefined, q: q || undefined });
      if (id !== requestId.current) return;
      setLogs(res.data ?? []);
      setTotal(res.pagination?.total ?? 0);
      setTotalPages(Math.max(1, res.pagination?.totalPages ?? 1));
    } catch (e) {
      if (id === requestId.current) setError(e);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [page, category, q]);

  useEffect(() => { void load(); }, [load]);

  const handleCategory = (c: string) => { setCategory(c); setPage(1); };
  const filtersActive = Boolean(category || q);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">AUDIT LOGS</h1>
          <p className={`text-xs font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Record of operator actions: incidents, failovers, monitors, configuration and account changes
            {!loading && !error && <> · {total} entr{total === 1 ? 'y' : 'ies'}{filtersActive ? ' matching' : ''}</>}
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${isDark ? 'bg-[#162033] border-[#243552] text-slate-200 hover:bg-[#1C2942]' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 shadow-xs'}`}
        >
          <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Search */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded border max-w-md ${isDark ? 'bg-[#0B0F17] border-[#1E293B]' : 'bg-white border-slate-300'}`}>
        <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <input
          type="text"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Search operator, action, target or details…"
          className={`w-full bg-transparent text-xs font-mono focus:outline-none placeholder:text-slate-500 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}
        />
        {searchInput && (
          <button onClick={() => setSearchInput('')} className="text-slate-400 hover:text-slate-200 cursor-pointer" title="Clear search">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
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
      {loading && logs.length === 0 ? (
        <SkeletonTable rows={10} cols={6} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void load()} />
      ) : logs.length === 0 ? (
        filtersActive ? (
          <EmptyState
            icon={Search}
            title="No matching audit entries"
            description="No entries match the current category or search."
            action={{ label: 'Clear filters', onClick: () => { setCategory(''); setSearchInput(''); setQ(''); setPage(1); } }}
          />
        ) : (
          <EmptyState icon={Shield} title="No audit log entries yet" description="Operator actions will appear here as they are performed." />
        )
      ) : (
        <div className={`rounded-lg border overflow-hidden ${loading ? 'opacity-70' : ''} ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
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
                      {fmtDateTime(log.timestamp)}
                    </td>
                    <td className={`py-2.5 px-3.5 font-sans font-semibold whitespace-nowrap ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                      {log.operator || '—'}
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
                      {log.targetId || '—'}
                    </td>
                    <td className={`py-2.5 px-3.5 font-sans max-w-md truncate ${isDark ? 'text-slate-300' : 'text-slate-700'}`} title={log.details || undefined}>
                      {log.details || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-3">
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPage={setPage} />
          </div>
        </div>
      )}
    </div>
  );
};
