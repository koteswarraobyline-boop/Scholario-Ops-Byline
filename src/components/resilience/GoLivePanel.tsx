import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../services/api';
import type { GoLivePreview } from '../../types';
import { Loader2, ShieldCheck } from 'lucide-react';

const tone = (status: string) =>
  status === 'PASS' || status === 'GREEN' ? 'text-emerald-500'
    : status === 'FAIL' || status === 'FAILED' ? 'text-rose-500'
      : 'text-slate-400';

export const GoLivePanel: React.FC<{ applicationId: string; isDark: boolean; canRecord: boolean }> = ({ applicationId, isDark, canRecord }) => {
  const [preview, setPreview] = useState<GoLivePreview | null>(null);
  const [defect, setDefect] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const muted = isDark ? 'text-slate-500' : 'text-slate-500';
  const box = isDark ? 'bg-[#0B0F17] border-[#1E293B] text-slate-200' : 'bg-white border-slate-300 text-slate-800';

  const load = useCallback(async () => {
    setError(null);
    try {
      setPreview(await api.getGoLive(applicationId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Go-live checks could not be loaded');
    }
  }, [applicationId]);

  useEffect(() => {
    setPreview(null);
    setDefect('');
    void load();
  }, [load]);

  const record = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await api.recordGoLive(applicationId, preview?.overall === 'FAILED' ? defect.trim() : undefined);
      setPreview(saved.preview);
      setDefect('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The go-live result was not recorded');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`pt-3 border-t space-y-2 text-[11px] ${isDark ? 'border-[#1A2332]' : 'border-slate-100'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" />
          Go-live checks
          {preview && <span className={`font-mono ${tone(preview.overall)}`}>{preview.overall}</span>}
        </div>
        <button type="button" onClick={() => void load()} className={`font-mono cursor-pointer ${muted}`}>Refresh</button>
      </div>
      {!preview && !error && <div className={`flex items-center gap-1.5 ${muted}`}><Loader2 className="w-3 h-3 animate-spin" /> Running checks</div>}
      {preview && (
        <ul className="space-y-1">
          {preview.checks.map(check => (
            <li key={check.key} className="flex gap-2">
              <span className={`w-28 shrink-0 font-mono font-semibold ${tone(check.status)}`}>{check.status === 'NOT_APPLICABLE' ? 'N/A' : check.status}</span>
              <span><span className="font-semibold">{check.label}.</span> <span className={muted}>{check.detail}</span></span>
            </li>
          ))}
        </ul>
      )}
      {preview?.latest && (
        <div className={muted}>
          Last recorded {preview.latest.overall} by {preview.latest.operator}
          {preview.latest.defect ? ` · defect: ${preview.latest.defect.summary}` : ''}
        </div>
      )}
      {error && <div className="text-rose-500">{error}</div>}
      {preview && canRecord && preview.overall === 'GREEN' && (
        <button type="button" disabled={busy} onClick={() => void record()} className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer disabled:opacity-60">
          {busy ? 'Recording…' : 'Record green go-live'}
        </button>
      )}
      {preview && canRecord && preview.overall === 'FAILED' && (
        <div className="space-y-1.5">
          <input
            value={defect}
            onChange={e => setDefect(e.target.value)}
            placeholder="Defect summary (required until the failing checks are fixed)"
            className={`w-full px-2 py-1 rounded border font-mono outline-none ${box}`}
          />
          <button type="button" disabled={busy || !defect.trim()} onClick={() => void record()} className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer disabled:opacity-60">
            {busy ? 'Recording…' : 'Record with defect'}
          </button>
        </div>
      )}
      {preview && !canRecord && <div className={muted}>An operator records the result after the checks are green, or logs a defect for each failure.</div>}
    </div>
  );
};
