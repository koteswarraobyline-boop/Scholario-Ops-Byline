import React, { useMemo, useState } from 'react';
import { Search, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, X } from 'lucide-react';

export type InventoryChip = { id: string; label: string; count?: number };

type Styles = {
  isDark: boolean;
  input: string;
  btn: string;
  ghost: string;
  muted: string;
  faint: string;
};

/** Search + chip filters + expand/collapse controls for multi-item inventories */
export const InventoryFilters: React.FC<{
  st: Styles;
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder?: string;
  chips: InventoryChip[];
  chip: string;
  onChip: (id: string) => void;
  shown: number;
  total: number;
  /** When set, show Expand all / Collapse all */
  expand?: { allOpen: boolean; onExpandAll: () => void; onCollapseAll: () => void };
  ariaLabel?: string;
}> = ({ st, search, onSearch, searchPlaceholder = 'Search…', chips, chip, onChip, shown, total, expand, ariaLabel }) => {
  const active = Boolean(search.trim()) || (chip && chip !== 'ALL');
  return (
    <div className="space-y-2" role="search" aria-label={ariaLabel ?? 'Filter list'}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem] max-w-md">
          <Search className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 ${st.faint}`} aria-hidden />
          <input
            className={`${st.input} !pl-8`}
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
          {search && (
            <button type="button" onClick={() => onSearch('')} className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded ${st.faint}`} aria-label="Clear search">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {expand && (
          <div className="flex gap-1.5">
            <button type="button" onClick={expand.onExpandAll} className={`${st.btn} ${st.ghost} !px-2`} title="Expand all" aria-label="Expand all">
              <ChevronsUpDown className="w-3.5 h-3.5" /> Expand
            </button>
            <button type="button" onClick={expand.onCollapseAll} className={`${st.btn} ${st.ghost} !px-2`} title="Collapse all" aria-label="Collapse all">
              <ChevronsDownUp className="w-3.5 h-3.5" /> Collapse
            </button>
          </div>
        )}
        <span className={`text-[11px] font-mono ${st.muted} ml-auto`}>
          {shown === total ? `${total}` : `${shown} of ${total}`}
          {active ? ' matching' : ''}
        </span>
      </div>
      <div className={`flex flex-wrap items-center gap-1 p-0.5 rounded border text-[11px] font-mono w-fit max-w-full ${
        st.isDark ? 'bg-[#0B0F17] border-[#1E293B]' : 'bg-slate-100 border-slate-300'
      }`}>
        {chips.map(c => (
          <button
            key={c.id}
            type="button"
            onClick={() => onChip(c.id)}
            className={`px-2.5 py-1 whitespace-nowrap rounded transition-colors cursor-pointer ${
              chip === c.id
                ? 'bg-blue-600 text-white font-medium shadow-xs'
                : st.isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {c.label}{typeof c.count === 'number' ? ` (${c.count})` : ''}
          </button>
        ))}
        {active && (
          <button
            type="button"
            onClick={() => { onSearch(''); onChip('ALL'); }}
            className={`px-2 py-1 ${st.isDark ? 'text-blue-400' : 'text-blue-600'} hover:underline cursor-pointer`}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
};

export const ExpandToggle: React.FC<{ open: boolean; onClick: () => void; label: string; className?: string }> = ({ open, onClick, label, className }) => (
  <button
    type="button"
    onClick={onClick}
    aria-expanded={open}
    aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
    className={`inline-flex items-center justify-center p-1 rounded cursor-pointer shrink-0 ${className ?? ''}`}
  >
    {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
  </button>
);

/** Match free-text search against several string fields */
export function matchesQuery(q: string, fields: Array<string | null | undefined>): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return fields.some(f => (f ?? '').toLowerCase().includes(needle));
}

/** Stable expand-set helpers for lists of ids */
export function useExpandSet(ids: string[], defaultOpen = false) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(defaultOpen ? ids : []));
  // Drop ids that no longer exist; keep user toggles for remaining
  const cleaned = useMemo(() => {
    const next = new Set<string>();
    for (const id of open) if (ids.includes(id)) next.add(id);
    return next;
  }, [open, ids]);
  const isOpen = (id: string) => cleaned.has(id);
  const toggle = (id: string) => setOpen(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const expandAll = () => setOpen(new Set(ids));
  const collapseAll = () => setOpen(new Set());
  const allOpen = ids.length > 0 && ids.every(id => cleaned.has(id));
  return { isOpen, toggle, expandAll, collapseAll, allOpen, openIds: cleaned };
}
