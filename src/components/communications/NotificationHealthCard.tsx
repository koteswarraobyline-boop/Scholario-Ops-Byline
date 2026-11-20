import React, { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, AlertTriangle } from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import { api } from '../../services/api';
import { deliverySignature } from './notificationHooks';
import type { NotificationHealth } from '../../types';

const POLL_MS = 30_000;
const tone = (s: NotificationHealth['status']) => (s === 'HEALTHY' ? 'text-emerald-500' : s === 'DEGRADED' ? 'text-amber-500' : 'text-slate-400');
const ms = (n: number | null) => (n === null ? '—' : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);

/**
 * Delivery health for operators: status, 24 h success rate / retries / latency, what is waiting
 * (sending, retry backoff, grouped, quiet hours, first-page delay) and channels that keep failing.
 */
export const NotificationHealthCard: React.FC = () => {
  const { theme, communicationChannels } = useOps();
  const isDark = theme === 'dark';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const [h, setH] = useState<NotificationHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sig = deliverySignature(communicationChannels);

  const load = useCallback(async () => {
    setLoading(true);
    try { setH(await api.getNotificationHealth()); setError(null); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load, sig]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const cell = `p-2.5 rounded border min-w-0 ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`;
  const label = `text-[10px] uppercase ${muted}`;
  const value = 'font-bold tabular-nums';

  return (
    <section aria-label="Notification delivery health" className={`rounded-lg border p-4 space-y-3 font-mono text-xs ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-500" aria-hidden="true" />
          <span className="font-bold uppercase tracking-wider text-[11px]">Delivery health</span>
          {h && <span className={`font-bold ${tone(h.status)}`}>{h.status.replace('_', ' ')}</span>}
        </div>
        <button onClick={() => void load()} disabled={loading} aria-label="Refresh delivery health"
          className={`p-1 rounded cursor-pointer disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>

      {error ? <div role="alert" className="text-rose-500">Could not load delivery health: {error}</div>
        : !h ? <div className={`${muted} animate-pulse`}>Loading…</div>
          : (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
                <div className={cell}><div className={label}>Last 24 h</div><div className={value}>{h.last24h.total} sent</div>
                  <div className={`text-[10px] ${muted}`}>{h.last24h.delivered} accepted · {h.last24h.failed} failed</div></div>
                <div className={cell}><div className={label}>Success rate</div>
                  <div className={`${value} ${h.last24h.successRate === null ? '' : h.last24h.successRate >= 99 ? 'text-emerald-500' : h.last24h.successRate >= 90 ? 'text-amber-500' : 'text-rose-500'}`}>{h.last24h.successRate === null ? '—' : `${h.last24h.successRate}%`}</div>
                  <div className={`text-[10px] ${muted}`}>{h.last24h.retries} retr{h.last24h.retries === 1 ? 'y' : 'ies'}</div></div>
                <div className={cell}><div className={label}>Delivery time</div><div className={value}>p95 {ms(h.last24h.p95Ms)}</div>
                  <div className={`text-[10px] ${muted}`}>p50 {ms(h.last24h.p50Ms)}</div></div>
                <div className={cell}><div className={label}>Waiting now</div>
                  <div className={value}>{h.pending.inFlight + h.pending.grouped + h.pending.heldQuietHours + h.pending.heldInitialDelay}</div>
                  <div className={`text-[10px] ${muted}`} title="sending · in retry backoff · grouped · quiet hours · first-page delay">
                    {h.pending.inFlight} sending{h.pending.waitingRetry ? ` (${h.pending.waitingRetry} retrying)` : ''} · {h.pending.grouped} grouped · {h.pending.heldQuietHours} quiet · {h.pending.heldInitialDelay} delayed
                  </div></div>
                <div className={cell}><div className={label}>Sender</div>
                  <div className={`${value} ${h.worker === 'follower' ? 'text-amber-500' : ''}`}>{h.worker === 'leader' ? 'This server' : h.worker === 'follower' ? 'Another process' : 'This server'}</div>
                  <div className={`text-[10px] ${muted}`}>{h.enabledChannels} channel{h.enabledChannels === 1 ? '' : 's'} enabled</div></div>
              </div>
              {h.worker === 'follower' && (
                <p className="text-amber-500 font-sans">Another Scholario Ops process holds the escalation lock: this one does not send escalations or reminders.</p>
              )}
              {h.secretsKey && h.secretsKey !== 'OK' && (
                <p role="alert" className="flex items-start gap-1.5 text-rose-500 font-sans break-words">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  <span><strong>Secrets key problem:</strong> {h.secretsKey}</span>
                </p>
              )}
              {h.failingChannels.length > 0 && (
                <ul className="space-y-1" aria-label="Failing channels">
                  {h.failingChannels.map(c => {
                    const ch = communicationChannels.find(x => x.id === c.channelId);
                    const teamsLink = ch?.type === 'TEAMS' && /^https:\/\/teams\.(microsoft\.com|cloud\.microsoft|live\.com)\//i.test(ch.targetEndpoint);
                    const why = teamsLink
                      ? 'This is a Teams channel link, not a webhook — it cannot receive messages. Edit the channel and paste a Workflows webhook URL.'
                      : c.lastError;
                    return (
                      <li key={c.channelId} className="flex items-start gap-1.5 text-rose-500 font-sans">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                        <span className="break-words"><strong>{c.name}</strong> ({c.type}) — {c.consecutiveFailures} failures in a row{why ? `: ${why}` : ''}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
    </section>
  );
};
