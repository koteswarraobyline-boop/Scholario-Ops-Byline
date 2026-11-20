import React from 'react';
import type { ImpactPreview } from '../../types';

/** Compact "what will break" panel for maintenance windows and failover. */
export const ImpactPreviewCard: React.FC<{
  preview: ImpactPreview | null;
  loading?: boolean;
  error?: string | null;
  isDark: boolean;
  title?: string;
}> = ({ preview, loading, error, isDark, title = 'What will break if this goes down' }) => {
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const panel = `p-3 rounded border space-y-2 text-xs font-mono ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`;

  if (loading) return <div className={panel}><span className={muted}>Computing blast radius…</span></div>;
  if (error) return <div className={panel}><span className="text-rose-500">{error}</span></div>;
  if (!preview) return null;

  return (
    <div className={panel} role="region" aria-label={title}>
      <div className={`text-[10px] uppercase font-bold tracking-wider ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>{title}</div>
      <p className={isDark ? 'text-slate-200' : 'text-slate-800'}>{preview.summary}</p>
      {(preview.hardStops.length > 0 || preview.softDegrades.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <div className="font-bold text-rose-500 text-[10px] uppercase">Hard stops ({preview.hardStops.length})</div>
            {preview.hardStops.length === 0
              ? <div className={muted}>None</div>
              : <ul className="list-disc ml-4">{preview.hardStops.map(a => <li key={a.id}>{a.name}</li>)}</ul>}
          </div>
          <div>
            <div className="font-bold text-amber-500 text-[10px] uppercase">Soft degrades ({preview.softDegrades.length})</div>
            {preview.softDegrades.length === 0
              ? <div className={muted}>None</div>
              : <ul className="list-disc ml-4">{preview.softDegrades.map(a => <li key={a.id}>{a.name}</li>)}</ul>}
          </div>
        </div>
      )}
      <div>
        <div className="font-bold text-[10px] uppercase">Features and the action needed ({preview.features?.length ?? 0})</div>
        {(preview.features?.length ?? 0) === 0
          ? <div className={muted}>No business feature depends on this component.</div>
          : (
            <ul className="space-y-1 mt-1">
              {preview.features.map(f => (
                <li key={f.id}>
                  <span className="font-semibold">{f.name}</span>
                  {' '}
                  <span className={f.via === 'HARD' ? 'text-rose-500' : 'text-amber-500'}>{f.via}</span>
                  <div className={muted}>{f.action}</div>
                </li>
              ))}
            </ul>
          )}
      </div>
      <div className={muted}>
        Users stopped: {preview.usersStopped != null ? `≥${preview.usersStopped.toLocaleString()}` : '—'}
        {preview.usersAffected != null && preview.usersAffected !== preview.usersStopped
          ? ` · affected (incl. soft): ≥${preview.usersAffected.toLocaleString()}` : ''}
        {preview.served.length ? ` · teams: ${preview.served.join(', ')}` : ''}
      </div>
    </div>
  );
};
