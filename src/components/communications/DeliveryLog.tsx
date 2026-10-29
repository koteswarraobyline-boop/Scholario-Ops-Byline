import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Send, History, CheckCheck, Mail, MailOpen, Search } from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import { api } from '../../services/api';
import { Pagination } from '../ui/Pagination';
import { EmptyState } from '../ui/EmptyState';
import type { NotificationDelivery } from '../../types';
import { deliverySignature, UNREAD_CHANGED } from './notificationHooks';
import { DeliveryDetail } from './DeliveryDetail';

export { useDeliveryStats, useUnreadNotifications } from './notificationHooks';

const PAGE_SIZE = 25;
const KINDS = ['FIRING', 'RESOLVED', 'ESCALATED', 'INFO', 'TEST'] as const;

const kindTone = (k: NotificationDelivery['kind']) =>
  k === 'FIRING' ? 'text-rose-500' : k === 'ESCALATED' ? 'text-orange-500' : k === 'RESOLVED' ? 'text-emerald-500' : 'text-blue-500';

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

/**
 * Every notification sent to every channel: when, what (FIRING / RESOLVED / ESCALATED / TEST), for
 * which incident, delivered or failed (with the reason and attempts). Per-user read state, search,
 * filters, sorting, bulk mark read / unread / resend.
 */
export const DeliveryLog: React.FC = () => {
  const { communicationChannels, theme, notify, setSelectedIncidentId } = useOps();
  const navigate = useNavigate();
  const isDark = theme === 'dark';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const [rows, setRows] = useState<NotificationDelivery[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [channelId, setChannelId] = useState('');
  const [result, setResult] = useState('');
  const [kind, setKind] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  // The element that opened the detail panel gets focus back when it closes (keyboard users keep their place)
  const detailOpener = useRef<HTMLElement | null>(null);
  const closeDetail = useCallback(() => {
    setDetailId(null);
    requestAnimationFrame(() => detailOpener.current?.focus());
  }, []);
  const request = useRef(0);

  // Search waits until typing pauses
  useEffect(() => {
    const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const r = await api.getNotificationDeliveries({ page, pageSize: PAGE_SIZE, channelId, result, kind, q, unread: unreadOnly || undefined, sort });
      if (id !== request.current) return; // a newer request is on its way
      setRows(r.data);
      setTotal(r.pagination?.total ?? r.data.length);
      setTotalPages(r.pagination?.totalPages ?? 1);
      setSelected(prev => new Set([...prev].filter(x => r.data.some(d => d.id === x))));
      setError(null);
    } catch (e) {
      if (id === request.current) setError((e as Error).message);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [page, channelId, result, kind, q, unreadOnly, sort]);

  useEffect(() => { void load(); }, [load]);
  // Live: a channel delivered (or failed) → new rows; only the first page changes, later pages stay put
  const sig = deliverySignature(communicationChannels);
  const firstSig = useRef(sig);
  useEffect(() => {
    if (sig === firstSig.current) return;
    firstSig.current = sig;
    if (page === 1) void load();
  }, [sig, page, load]);

  const setFilter = (fn: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => { fn(e.target.value); setPage(1); };
  const readChanged = () => window.dispatchEvent(new Event(UNREAD_CHANGED));

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); } catch (e) { notify('error', (e as Error).message); } finally { setBusy(null); void load(); }
  };
  const markRead = (ids: string[], read: boolean) => run(read ? 'read' : 'unread', async () => {
    await api.markNotificationsRead(ids, read);
    setSelected(new Set());
    readChanged();
  });
  const markAll = () => run('all', async () => {
    await api.markAllNotificationsRead();
    readChanged();
    notify('success', 'All notifications marked as read');
  });
  const resend = (ids: string[]) => run('resend', async () => {
    if (ids.length === 1) {
      const row = rows?.find(r => r.id === ids[0]);
      await api.resendNotification(ids[0]);
      notify('success', `Resent to ${row?.channelName ?? 'the channel'}`);
    } else {
      const r = await api.resendNotifications(ids);
      notify(r.failed ? 'error' : 'success', `Resent ${r.delivered} of ${ids.length}${r.failed ? ` — ${r.failed} failed (see the log)` : ''}`);
    }
    setSelected(new Set());
  });

  const channelOptions = useMemo(() => {
    const names = new Map(communicationChannels.map(c => [c.id, c.name]));
    for (const r of rows ?? []) if (!names.has(r.channelId)) names.set(r.channelId, `${r.channelName} (removed)`);
    return [...names.entries()];
  }, [communicationChannels, rows]);

  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pageIds = rows?.map(r => r.id) ?? [];
  const allOnPage = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const selIds = [...selected];

  const selectCls = `px-2 py-1 rounded border text-xs font-mono cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${isDark ? 'bg-[#0B0F17] border-[#1E293B] text-slate-300' : 'bg-white border-slate-300 text-slate-700'}`;
  const btn = `inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-mono cursor-pointer disabled:opacity-50 whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${isDark ? 'border-[#1E293B] text-slate-300 hover:bg-slate-800' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`;
  const filtered = Boolean(channelId || result || kind || q || unreadOnly);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={`text-xs font-bold uppercase tracking-wider font-mono ${muted}`}>
          Delivery log{rows ? ` (${total})` : ''}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className={`flex items-center gap-1 px-2 py-1 rounded border ${isDark ? 'bg-[#0B0F17] border-[#1E293B]' : 'bg-white border-slate-300'}`}>
            <Search className={`w-3 h-3 ${muted}`} aria-hidden="true" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, channel, incident"
              aria-label="Search the delivery log" className="bg-transparent text-xs font-mono w-48 focus:outline-none" />
          </label>
          <select aria-label="Filter by channel" value={channelId} onChange={setFilter(setChannelId)} className={selectCls}>
            <option value="">All channels</option>
            {channelOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select aria-label="Filter by result" value={result} onChange={setFilter(setResult)} className={selectCls}>
            <option value="">Delivered + failed</option>
            <option value="DELIVERED">Delivered</option>
            <option value="FAILED">Failed</option>
          </select>
          <select aria-label="Filter by notification type" value={kind} onChange={setFilter(setKind)} className={selectCls}>
            <option value="">All types</option>
            {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <select aria-label="Sort order" value={sort} onChange={e => { setSort(e.target.value as 'newest' | 'oldest'); setPage(1); }} className={selectCls}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          <label className={`flex items-center gap-1 text-xs font-mono cursor-pointer ${muted}`}>
            <input type="checkbox" checked={unreadOnly} onChange={e => { setUnreadOnly(e.target.checked); setPage(1); }} aria-label="Show unread only" />
            Unread only
          </label>
          <button onClick={() => void markAll()} disabled={busy !== null} className={btn} title="Mark every notification as read">
            <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />Mark all read
          </button>
          <button onClick={() => void load()} disabled={loading} aria-label="Refresh delivery log" className={btn}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {selIds.length > 0 && (
        <div role="toolbar" aria-label="Bulk actions" className={`flex flex-wrap items-center gap-2 px-3 py-2 rounded border text-xs font-mono ${isDark ? 'bg-blue-950/30 border-blue-900/60' : 'bg-blue-50 border-blue-200'}`}>
          <span className="font-semibold">{selIds.length} selected</span>
          <button onClick={() => void markRead(selIds, true)} disabled={busy !== null} className={btn}><MailOpen className="w-3.5 h-3.5" aria-hidden="true" />Mark read</button>
          <button onClick={() => void markRead(selIds, false)} disabled={busy !== null} className={btn}><Mail className="w-3.5 h-3.5" aria-hidden="true" />Mark unread</button>
          <button onClick={() => void resend(selIds)} disabled={busy !== null || selIds.length > 25} className={btn} title={selIds.length > 25 ? 'Resend at most 25 at a time' : 'Send these notifications again'}>
            <Send className="w-3.5 h-3.5" aria-hidden="true" />Resend{selIds.length > 25 ? ' (max 25)' : ''}
          </button>
          <button onClick={() => setSelected(new Set())} className={btn}>Clear selection</button>
        </div>
      )}

      {error ? (
        <div className="text-xs font-mono text-rose-500" role="alert">Could not load the delivery log: {error}</div>
      ) : !rows ? (
        <div className={`text-xs font-mono animate-pulse ${muted}`}>Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={History} title={filtered ? 'No deliveries match these filters' : 'Nothing sent yet'}
          description={filtered ? 'Change or clear the filters.' : 'Every notification sent to a channel — incident alerts, recoveries, escalations and tests — appears here with its result.'} />
      ) : (
        <div className={`rounded border overflow-hidden ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
          <div className="w-full min-w-0 overflow-x-auto">
            <table aria-label="Notification delivery log" className="w-full text-left text-xs font-mono min-w-[960px]">
              <thead className={`border-b ${isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                <tr>
                  <th className="py-2 px-3 w-8">
                    <input type="checkbox" checked={allOnPage} onChange={() => setSelected(allOnPage ? new Set() : new Set(pageIds))} aria-label="Select all on this page" />
                  </th>
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Channel</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Notification</th>
                  <th className="py-2 px-3">Result</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
                {rows.map(r => (
                  <tr key={r.id} data-unread={r.read ? undefined : 'true'}
                    className={`${isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'} ${r.read ? '' : isDark ? 'bg-blue-950/20' : 'bg-blue-50/50'}`}>
                    <td className="py-2 px-3 align-top">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.title}`} />
                    </td>
                    <td className={`py-2 px-3 whitespace-nowrap align-top ${muted}`}>
                      {!r.read && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 mr-1.5 align-middle" aria-label="Unread" />}
                      {fmtTime(r.t)}
                    </td>
                    <td className="py-2 px-3 align-top">
                      <div title={r.channelName} className={`truncate max-w-[12rem] ${r.read ? '' : 'font-bold'}`}>{r.channelName}</div>
                      <div className={`text-[10px] ${muted}`}>{r.channelType}</div>
                    </td>
                    <td className={`py-2 px-3 align-top font-bold ${kindTone(r.kind)}`}>
                      {r.kind}
                      {r.resendOf && <div className={`text-[10px] font-normal ${muted}`}>resend</div>}
                    </td>
                    <td className="py-2 px-3 align-top min-w-0">
                      <button onClick={e => { detailOpener.current = e.currentTarget; setDetailId(r.id); }} title={`Details: ${r.title}`}
                        className={`block text-left break-words line-clamp-2 font-sans cursor-pointer hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded ${r.read ? '' : 'font-semibold'}`}>
                        {r.title}
                      </button>
                      {r.incidentId && (
                        <button
                          onClick={() => { setSelectedIncidentId(r.incidentId!); navigate(`/incidents?id=${encodeURIComponent(r.incidentId!)}`); }}
                          className="text-[10px] text-blue-500 hover:underline cursor-pointer"
                        >
                          Open {r.incidentId}
                        </button>
                      )}
                    </td>
                    <td className="py-2 px-3 align-top">
                      <span className={`font-bold ${r.result === 'DELIVERED' ? 'text-emerald-500' : 'text-rose-500'}`}>{r.result}</span>
                      <div className={`text-[10px] ${muted}`}>
                        {r.attempts > 1 ? `${r.attempts} attempts · ` : ''}{r.durationMs < 1000 ? `${r.durationMs} ms` : `${(r.durationMs / 1000).toFixed(1)} s`}
                      </div>
                      {r.error && <div title={r.error} className="text-[10px] text-rose-400 break-words line-clamp-2 max-w-[18rem] font-sans">{r.error}</div>}
                    </td>
                    <td className="py-2 px-3 align-top text-right whitespace-nowrap space-x-1">
                      <button onClick={() => void markRead([r.id], !r.read)} disabled={busy !== null} className={btn}
                        aria-label={r.read ? `Mark ${r.title} unread` : `Mark ${r.title} read`} title={r.read ? 'Mark unread' : 'Mark read'}>
                        {r.read ? <Mail className="w-3 h-3" aria-hidden="true" /> : <MailOpen className="w-3 h-3" aria-hidden="true" />}
                      </button>
                      <button
                        onClick={() => void resend([r.id])}
                        disabled={busy !== null}
                        title={`Send this ${r.kind} notification to ${r.channelName} again`}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] cursor-pointer disabled:opacity-50 whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                          r.result === 'FAILED'
                            ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700'
                            : isDark ? 'border-[#1E293B] text-slate-300 hover:bg-slate-800' : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <Send className="w-3 h-3" aria-hidden="true" />Resend
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-2">
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
          </div>
        </div>
      )}
      {detailId && <DeliveryDetail id={detailId} onClose={closeDetail} onChanged={() => void load()} />}
    </div>
  );
};
