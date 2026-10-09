import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Application, FailoverPreflight } from '../../types';
import { Ago, verdictColor } from '../ui/Freshness';

/**
 * Failover console for applications routed by a Cloudflare Load Balancer.
 * Runs real pre-flight checks on the backend and lets a super admin record an
 * APPROVED / REJECTED decision. It never changes Cloudflare — the switch is made
 * in Cloudflare by an operator, following the plan shown here.
 */
export const LbFailoverConsole: React.FC<{ app: Application }> = ({ app }) => {
  const { theme, notify } = useOps();
  const { hasRole } = useAuth();
  const isDark = theme === 'dark';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const [target, setTarget] = useState<'DR' | 'PRIMARY'>('DR');
  const [pf, setPf] = useState<FailoverPreflight | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [open, setOpen] = useState(false);

  // Only the latest request may update the screen; the previous app's / direction's result is cleared
  // at once so a decision can never be made against checks for something else
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setPf(null);
    try {
      const result = await api.getFailoverPreflight(app.id, target);
      if (id === requestId.current) { setPf(result); setError(null); }
    } catch (err) {
      if (id === requestId.current) setError(err instanceof Error ? err.message : 'Pre-flight failed');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [app.id, target]);
  const pfCurrent = Boolean(pf && pf.appId === app.id && pf.target === target && !loading);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const decide = async (decision: 'APPROVED' | 'REJECTED') => {
    if (!pfCurrent) { notify('error', 'Wait for the pre-flight checks of this application and direction to finish'); return; }
    if (!reason.trim()) { notify('error', 'Enter a reason — it is recorded in the audit log'); return; }
    setDeciding(true);
    try {
      await api.recordFailoverDecision(app.id, target, decision, reason.trim());
      notify('success', `Failover ${decision.toLowerCase()} — recorded in the audit log${decision === 'APPROVED' ? '. Perform the switch in Cloudflare.' : ''}`);
      setReason('');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Could not record decision');
    } finally {
      setDeciding(false);
    }
  };

  if (!hasRole('operator')) return <div className={`text-xs font-sans ${muted}`}>Operators can view failover pre-flight checks.</div>;

  if (!open) {
    return (
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
        <div className={`font-sans ${muted}`}>
          Traffic for <strong className={isDark ? 'text-slate-200' : 'text-slate-900'}>{app.loadBalancer?.hostname}</strong> is routed by the Cloudflare Load Balancer.
          Scholario Ops runs pre-flight checks and records decisions; it does not change Cloudflare.
        </div>
        <button onClick={() => setOpen(true)} className="px-3 py-1.5 rounded font-semibold text-xs text-white bg-amber-600 hover:bg-amber-700 cursor-pointer shrink-0">
          OPEN FAILOVER PRE-FLIGHT
        </button>
      </div>
    );
  }

  return (
    <div className={`p-3 rounded border space-y-3 text-xs ${isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-bold">
          <ShieldAlert className="w-4 h-4 text-amber-500" />
          <span>Failover pre-flight</span>
          <select value={target} onChange={e => setTarget(e.target.value as 'DR' | 'PRIMARY')}
            className={`px-2 py-0.5 rounded border outline-none cursor-pointer font-mono ${isDark ? 'bg-[#0B0F17] border-[#1E293B] text-slate-200' : 'bg-white border-slate-300'}`}>
            <option value="DR">Production → DR</option>
            <option value="PRIMARY">DR → Production (fail back)</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          {pf && <span className={`text-[10px] ${muted}`}>evaluated <Ago iso={pf.generatedAt} /></span>}
          <button onClick={() => void load()} disabled={loading} title="Re-run checks"
            className={`p-1 rounded border cursor-pointer disabled:opacity-60 ${isDark ? 'border-[#1E293B] text-slate-300' : 'border-slate-300 text-slate-600'}`}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setOpen(false)} className={`px-2 py-0.5 rounded cursor-pointer ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'}`}>Close</button>
        </div>
      </div>

      {error && <div className="text-rose-500">{error}</div>}
      {!pf && !error && <div className={`${muted} animate-pulse`}>Running pre-flight checks…</div>}
      {pf && (
        <>
          <div className={`grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-mono`}>
            <div><span className={muted}>Current primary pool</span><div className="font-semibold">{pf.currentPrimary}</div></div>
            <div><span className={muted}>Current DR pool</span><div className="font-semibold">{pf.currentDr}</div></div>
            <div><span className={muted}>{pf.target === 'DR' ? 'DR' : 'Production'} readiness</span><div className={`font-bold ${verdictColor(pf.drOverall)}`}>{pf.drOverall.replace('_', ' ')}</div></div>
          </div>
          <div className="space-y-1">
            {pf.checks.map(c => (
              <div key={c.key} className={`grid grid-cols-[1fr_auto] gap-2 py-1 border-b ${isDark ? 'border-[#1A2332]' : 'border-slate-200'}`}>
                <div className="min-w-0">
                  <div className="font-semibold">{c.label}</div>
                  <div className={`text-[11px] font-sans break-words ${muted}`}>{c.detail}{c.observedAt ? <> · <Ago iso={c.observedAt} /></> : null}</div>
                </div>
                <span className={`font-bold font-mono ${verdictColor(c.status)}`}>{c.status}</span>
              </div>
            ))}
          </div>
          <div className={`p-2 rounded border ${pf.preflightPassed ? (isDark ? 'border-emerald-900 text-emerald-300' : 'border-emerald-300 text-emerald-800') : 'border-rose-500/50 text-rose-500'}`}>
            {pf.preflightPassed ? 'No pre-flight check is failing. Review WARNING / UNKNOWN items before proceeding.' : 'One or more pre-flight checks FAIL — failing over now is not recommended.'}
          </div>
          <div>
            <div className="font-bold mb-1">Prepared operation (manual, in Cloudflare)</div>
            <ol className={`list-decimal ml-5 space-y-0.5 font-sans ${muted}`}>
              {pf.plan.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
          </div>
          {hasRole('super_admin') ? (
            <div className={`p-2 rounded border space-y-2 ${isDark ? 'bg-[#1F1710] border-amber-900' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-center gap-1.5 font-bold text-amber-500"><AlertTriangle className="w-4 h-4" /> Record decision</div>
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (required, recorded in the audit log)"
                className={`w-full px-2 py-1 rounded border font-mono outline-none ${isDark ? 'bg-[#0B0F17] border-[#1E293B] text-slate-200' : 'bg-white border-slate-300'}`} />
              <div className="flex gap-2">
                <button disabled={deciding || !pfCurrent} onClick={() => void decide('APPROVED')}
                  className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer disabled:opacity-60 flex items-center gap-1">
                  {deciding && <Loader2 className="w-3 h-3 animate-spin" />} Approve (switch in Cloudflare)
                </button>
                <button disabled={deciding || !pfCurrent} onClick={() => void decide('REJECTED')}
                  className={`px-2.5 py-1 rounded font-semibold cursor-pointer disabled:opacity-60 ${isDark ? 'bg-slate-800 text-slate-200' : 'bg-slate-200 text-slate-800'}`}>
                  Reject
                </button>
              </div>
              <div className={`text-[10px] font-sans ${muted}`}>Recording a decision does not change DNS, pools, origins, weights or firewalls.</div>
            </div>
          ) : (
            <div className={`font-sans ${muted}`}>Only super administrators can record failover decisions.</div>
          )}
        </>
      )}
    </div>
  );
};
