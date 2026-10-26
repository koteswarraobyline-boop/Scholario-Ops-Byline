import React, { useCallback, useEffect, useState } from 'react';
import { DatabaseBackup, ShieldCheck, ShieldAlert, RefreshCw } from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Ago } from '../ui/Freshness';
import type { OpsBackupHealth } from '../../types';

/** The status files only change when the nightly / weekly cron jobs run */
const POLL_MS = 5 * 60_000;

const statusTone = (s: OpsBackupHealth['status']) =>
  s === 'HEALTHY' ? 'text-emerald-500' : s === 'DEGRADED' ? 'text-amber-500' : s === 'NOT_CONFIGURED' ? 'text-slate-400' : 'text-rose-500';

const fmtBytes = (n: number | null) =>
  n === null ? '—' : n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;

/** Scholario Ops' own PostgreSQL backup: last run, encryption, off-server copy, restore test */
export const OpsBackupPanel: React.FC = () => {
  const { theme, notify } = useOps();
  const { hasRole } = useAuth();
  const canRun = hasRole('it_administrator');
  const isDark = theme === 'dark';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const [data, setData] = useState<OpsBackupHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.getOpsBackup()); setError(null); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);

  const run = async (action: 'backup' | 'restore-test') => {
    const question = action === 'backup'
      ? 'Start a backup of the Scholario Ops database on this server?'
      : 'Start a restore test? It uses a separate scratch database and does not replace the live database.';
    if (!window.confirm(question)) return;
    setLoading(true);
    try {
      await api.runOpsBackup(action);
      notify('success', action === 'backup' ? 'Backup started' : 'Restore test started');
      await load();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const b = data?.backup ?? null;
  const r = data?.restoreTest ?? null;
  const tableCount = b ? Object.keys(b.tables).length : 0;
  const rowCount = b ? Object.values(b.tables).reduce((a, n) => a + n, 0) : 0;
  const cell = `p-2.5 rounded border min-w-0 ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`;
  const label = `text-[10px] uppercase ${muted}`;

  return (
    <div className={`rounded-lg border p-4 space-y-3 font-mono text-xs ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <DatabaseBackup className="w-4 h-4 shrink-0 text-blue-500" />
          <span className="font-bold uppercase tracking-wider text-[11px]">Scholario Ops database backup</span>
          {data && <span className={`font-bold ${statusTone(data.status)}`}>{data.status.replace('_', ' ')}</span>}
        </div>
        {canRun && (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={loading} onClick={() => void run('backup')} className="px-2 py-1 rounded border border-blue-800 text-blue-400 cursor-pointer disabled:opacity-50">Run backup</button>
            <button type="button" disabled={loading} onClick={() => void run('restore-test')} className="px-2 py-1 rounded border border-blue-800 text-blue-400 cursor-pointer disabled:opacity-50">Run restore test</button>
          </div>
        )}
        <button onClick={() => void load()} disabled={loading} aria-label="Refresh Ops backup status"
          className={`p-1 rounded cursor-pointer disabled:opacity-50 ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error ? <div className="text-rose-500">Could not load the Ops backup status: {error}</div>
        : !data ? <div className={`${muted} animate-pulse`}>Loading…</div>
          : (
            <>
              {data.status !== 'NOT_CONFIGURED' && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
                  <div className={cell}>
                    <div className={label}>Last backup</div>
                    <div className={`font-semibold ${b?.status === 'FAILED' ? 'text-rose-500' : ''}`}><Ago iso={b?.completedAt ?? null} missing="never" /></div>
                    <div title={b?.file ?? ''} className={`text-[10px] truncate ${muted}`}>{b?.file ?? '—'} · {fmtBytes(b?.sizeBytes ?? null)}</div>
                  </div>
                  <div className={cell}>
                    <div className={label}>Contents</div>
                    <div className="font-semibold tabular-nums">{tableCount} tables · {rowCount.toLocaleString()} rows</div>
                    <div title={b?.sha256 ?? ''} className={`text-[10px] truncate ${muted}`}>sha256 {b?.sha256 ? `${b.sha256.slice(0, 12)}…` : '—'}</div>
                  </div>
                  <div className={cell}>
                    <div className={label}>Encryption</div>
                    <div className={`font-semibold flex items-center gap-1 ${b?.encryption === 'none' ? 'text-amber-500' : 'text-emerald-500'}`}>
                      {b?.encryption === 'none' ? <ShieldAlert className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                      {b?.encryption === 'none' ? 'Not encrypted' : (b?.encryption ?? '—').toUpperCase()}
                    </div>
                    <div className={`text-[10px] ${muted}`}>kept {b?.retentionDays ?? '—'} days</div>
                  </div>
                  <div className={cell}>
                    <div className={label}>Off-server copy</div>
                    <div className={`font-semibold ${!b?.offsite ? 'text-amber-500' : b.offsite.ok ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {!b?.offsite ? 'Not configured' : b.offsite.ok ? 'Verified' : 'Failed'}
                    </div>
                    <div title={b?.offsite?.target ?? ''} className={`text-[10px] truncate ${muted}`}>{b?.offsite?.target ?? 'this server only'}</div>
                  </div>
                  <div className={cell}>
                    <div className={label}>Restore test</div>
                    <div className={`font-semibold ${!r ? 'text-amber-500' : r.status === 'VERIFIED' ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {!r ? 'Never run' : r.status === 'VERIFIED' ? 'Verified' : 'Failed'}
                    </div>
                    <div className={`text-[10px] ${muted}`}>{r ? <><Ago iso={r.testedAt} missing="—" /> · {r.durationSec}s</> : 'deploy/verify-backup.sh'}</div>
                  </div>
                </div>
              )}
              {data.problems.length > 0 && (
                <ul className="space-y-1">
                  {data.problems.map(p => <li key={p} className="text-rose-500 break-words">• {p}</li>)}
                </ul>
              )}
              {data.advisories.length > 0 && (
                <ul className={`space-y-1 font-sans text-[11px] ${muted}`}>
                  {data.advisories.map(a => <li key={a} className="break-words">→ {a}</li>)}
                </ul>
              )}
            </>
          )}
    </div>
  );
};
