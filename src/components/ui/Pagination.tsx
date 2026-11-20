import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useOps } from '../../context/OpsContext';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}

/** Client-side paging for filtered Setup / inventory lists. Resets to page 1 when the list identity changes. */
export function useClientPagination<T>(items: T[], pageSize = 10, resetKey = '') {
  const [page, setPage] = useState(1);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  useEffect(() => { setPage(1); }, [resetKey, pageSize]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const slice = useMemo(() => {
    const safe = Math.min(Math.max(1, page), totalPages);
    const start = (safe - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize, totalPages]);
  return { page, setPage, pageSize, total, totalPages, slice };
}

export const Pagination: React.FC<PaginationProps> = ({
  page, totalPages, total, pageSize, onPage
}) => {
  const { theme } = useOps();
  const isDark = theme === 'dark';
  if (totalPages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, total);

  const btnClass = (disabled: boolean) =>
    `flex items-center justify-center w-7 h-7 rounded text-xs font-mono transition-colors cursor-pointer ${
      disabled
        ? 'opacity-30 cursor-not-allowed'
        : isDark
          ? 'text-slate-300 hover:bg-[#1D2B44] hover:text-white'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    }`;

  const pages: (number | '…')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('…');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push('…');
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-between px-1 pt-3">
      <span className={`text-[10px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-0.5">
        <button
          className={btnClass(page <= 1)}
          onClick={() => page > 1 && onPage(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`ellipsis-${i}`} className={`w-7 h-7 flex items-center justify-center text-xs font-mono ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p as number)}
              className={`w-7 h-7 rounded text-xs font-mono transition-colors cursor-pointer ${
                p === page
                  ? 'bg-blue-600 text-white font-semibold'
                  : isDark
                    ? 'text-slate-400 hover:bg-[#1D2B44] hover:text-white'
                    : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {p}
            </button>
          )
        )}

        <button
          className={btnClass(page >= totalPages)}
          onClick={() => page < totalPages && onPage(page + 1)}
          disabled={page >= totalPages}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
