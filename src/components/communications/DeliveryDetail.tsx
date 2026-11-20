import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Send, ExternalLink, AlertTriangle } from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import { api } from '../../services/api';
import { UNREAD_CHANGED } from './notificationHooks';
import type { NotificationDeliveryDetail } from '../../types';

const fmt = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};
const ms = (n: number) => (n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);

/**
 * Side panel for one notification: what was sent, every attempt on this channel (original and
 * resends) with result / reason / duration, and the live incident context with links. Opening it
 * marks the notification read. Keyboard: focus moves into the panel, Tab stays inside, Esc closes
 * and returns focus to where it was.
 */
export const DeliveryDetail: React.FC<{ id: string; onClose: () => void; onChanged: () => void }> = ({ id, onClose, onChanged }) => {
  const { theme, notify, setSelectedIncidentId } = useOps();
  const navigate = useNavigate();
  const isDark = theme === 'dark';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const [data, setData] = useState<NotificationDeliveryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  // Latest callback without re-running the loader on every parent render
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const returnFocus = useRef<HTMLElement | null>(typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);

  const load = useCallback(async () => {
    try {
      const d = await api.getNotificationDetail(id);
      setData(d);
      setError(null);
      if (!d.delivery.read) {
        await api.markNotificationsRead([id], true).catch(() => {});
        window.dispatchEvent(new Event(UNREAD_CHANGED));
        changed.current();
      }
    } catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  // Focus management: into the panel on open, trapped while open, back on close
  useEffect(() => {
    panel.current?.focus();
    const restore = returnFocus.current;
    return () => { restore?.focus?.(); };
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>('button, a[href], input, select, [tabindex]:not([tabindex="-1"])')].filter(el => !el.hasAttribute('disabled'));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const resend = async () => {
    if (!data) return;
    setResending(true);
    try {
      await api.resendNotification(data.delivery.id);
      notify('success', `Resent to ${data.channel.name}`);
    } catch (e) { notify('error', (e as Error).message); }
    finally { setResending(false); void load(); changed.current(); }
  };

  const go = (path: string) => { onClose(); navigate(path); };
  const d = data?.delivery;
  const section = `rounded border p-3 space-y-1.5 ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`;
  const row = 'flex justify-between gap-3';
  const linkBtn = 'inline-flex items-center gap-1 text-blue-500 hover:underline cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onKeyDown={onKeyDown}>
      <button aria-label="Close notification details" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/40 cursor-default" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-detail-title"
        tabIndex={-1}
        className={`relative w-full max-w-xl h-full overflow-y-auto p-5 space-y-4 font-mono text-xs shadow-2xl focus:outline-none ${isDark ? 'bg-[#111726] text-slate-200' : 'bg-white text-slate-800'}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={`text-[10px] uppercase ${muted}`}>Notification</div>
            <h2 id="delivery-detail-title" className="text-sm font-bold font-sans break-words">{d?.title ?? 'Loading…'}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded cursor-pointer hover:bg-slate-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {error && <div role="alert" className="text-rose-500">Could not load this notification: {error}</div>}
        {!data && !error && <div className={`animate-pulse ${muted}`}>Loading…</div>}

        {data && d && (
          <>
            <div className={section}>
              <div className={row}><span className={muted}>Type</span><span className="font-bold">{d.kind}{d.resendOf ? ' (resend)' : ''}</span></div>
              <div className={row}><span className={muted}>Severity</span><span>{d.severity}</span></div>
              <div className={row}><span className={muted}>Channel</span>
                <span className="text-right">{data.channel.name} · {data.channel.type}{!data.channel.exists ? ' (deleted)' : !data.channel.enabled ? ' (disabled)' : ''}</span>
              </div>
              <div className={row}><span className={muted}>Sent</span><span>{fmt(d.t)}</span></div>
              <div className={row}><span className={muted}>Result</span>
                <span className={`font-bold ${d.result === 'DELIVERED' ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {d.result === 'DELIVERED' ? 'Accepted by the destination' : 'Failed'} · {d.attempts} attempt{d.attempts === 1 ? '' : 's'} · {ms(d.durationMs)}
                </span>
              </div>
              {d.error && <div className="text-rose-400 break-words font-sans pt-1">{d.error}</div>}
            </div>

            <div className="space-y-1.5">
              <div className={`text-[10px] uppercase font-bold ${muted}`}>Message sent</div>
              <div className={`${section} whitespace-pre-wrap break-words font-sans`}>{d.message.text || '—'}</div>
              {d.message.link && (
                <div className={`text-[11px] ${muted} break-all`}>Link in the message: {d.message.link}</div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className={`text-[10px] uppercase font-bold ${muted}`}>Attempts on this channel ({data.chain.length})</div>
              <ol className={`${section} space-y-2`}>
                {data.chain.map((c, i) => (
                  <li key={c.id} className={`flex flex-wrap items-baseline justify-between gap-2 ${c.id === d.id ? 'font-bold' : ''}`}>
                    <span>{i === 0 ? 'Original' : `Resend ${i}`} · {fmt(c.t)}</span>
                    <span className={c.result === 'DELIVERED' ? 'text-emerald-500' : 'text-rose-500'}>
                      {c.result} · {c.attempts}× · {ms(c.durationMs)}
                    </span>
                    {c.error && <span className="basis-full text-[10px] text-rose-400 break-words font-sans font-normal">{c.error}</span>}
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-1.5">
              <div className={`text-[10px] uppercase font-bold ${muted}`}>Incident</div>
              {data.incident ? (
                <div className={section}>
                  <div className="font-bold font-sans break-words">{data.incident.id} · {data.incident.title}</div>
                  <div className={row}><span className={muted}>Status</span><span>{data.incident.status}{data.incident.acknowledged ? ' · acknowledged' : ''}</span></div>
                  <div className={row}><span className={muted}>Severity / environment</span><span>{data.incident.severity} · {data.incident.environment}</span></div>
                  <div className={row}><span className={muted}>Owner</span><span>{data.incident.owner || 'Unassigned'}</span></div>
                  <div className={row}><span className={muted}>Started / resolved</span><span className="text-right">{fmt(data.incident.startedAt)} / {fmt(data.incident.resolvedAt)}</span></div>
                  <div className="flex flex-wrap gap-3 pt-1">
                    <button className={linkBtn} onClick={() => { setSelectedIncidentId(data.incident!.id); go(`/incidents?id=${encodeURIComponent(data.incident!.id)}`); }}>
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />Open incident
                    </button>
                    {data.application && <button className={linkBtn} onClick={() => go('/applications')}><ExternalLink className="w-3 h-3" aria-hidden="true" />{data.application.name}</button>}
                    {data.monitor && <button className={linkBtn} onClick={() => go('/monitors')}><ExternalLink className="w-3 h-3" aria-hidden="true" />Monitor: {data.monitor.name} ({data.monitor.status})</button>}
                  </div>
                </div>
              ) : data.incidentMissing ? (
                <div className={`${section} flex items-center gap-2 text-amber-500`}><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />{d.incidentId} no longer exists.</div>
              ) : (
                <div className={`${section} ${muted}`}>Not linked to an incident ({d.kind === 'TEST' ? 'test message' : 'general notification'}).</div>
              )}
            </div>

            <div className="flex gap-2">
              <button onClick={() => void resend()} disabled={resending || !data.channel.exists || !data.channel.enabled}
                title={!data.channel.exists ? 'The channel was deleted' : !data.channel.enabled ? 'Enable the channel first' : 'Send this notification again'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                <Send className="w-3.5 h-3.5" aria-hidden="true" />{resending ? 'Sending…' : 'Resend'}
              </button>
              <button onClick={onClose} className={`px-3 py-1.5 rounded border cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${isDark ? 'border-[#1E293B]' : 'border-slate-300'}`}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
