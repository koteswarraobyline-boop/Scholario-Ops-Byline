import React, { useEffect, useState } from 'react';
import { AlertTriangle, Mail } from 'lucide-react';
import { api } from '../../services/api';
import type { MockIncidentReport, MockIncidentStage, MockIncidentStatus, MockStageStatus } from '../../lib/mockIncident';

const tone: Record<MockStageStatus, string> = {
  PASS: 'text-emerald-500',
  FAIL: 'text-rose-500',
  NOT_VERIFIED: 'text-amber-500',
};

/**
 * Development-only control. Sends a simulated HTTP 503 through the real incident and email
 * pipeline. Hidden when the server says the feature is not available (production).
 */
export const MockIncidentPanel: React.FC<{ isDark: boolean; cardCls: string; muted: string }> = ({ isDark, cardCls, muted }) => {
  const [status, setStatus] = useState<MockIncidentStatus | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'run' | 'close' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<MockIncidentReport | null>(null);

  useEffect(() => {
    let gone = false;
    api.mockIncidentStatus().then(s => { if (!gone) setStatus(s); }).catch(() => { if (!gone) setStatus(null); });
    return () => { gone = true; };
  }, []);

  if (!status?.available) return null;

  const run = async () => {
    setBusy('run');
    setError(null);
    setConfirming(false);
    try {
      setReport(await api.runMockIncident());
      setStatus(await api.mockIncidentStatus());
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  const close = async () => {
    setBusy('close');
    setError(null);
    try {
      await api.closeMockIncident();
      setStatus(await api.mockIncidentStatus());
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <div className={`p-4 rounded border text-xs font-mono space-y-3 ${cardCls}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-bold text-sm font-sans flex items-center gap-2">
            <Mail className="w-4 h-4" /> Test Automatic Incident Alert
          </div>
          <p className={`mt-1 font-sans ${muted}`}>
            Simulates HTTP 503 on the dedicated monitor “{status.monitorName}”. That monitor stays disabled and is never checked against a real host.
            The failure goes through incident detection and the enabled Email channel. A confirmation is required because this sends a real email.
          </p>
        </div>
      </div>

      <div className={`font-sans ${muted}`}>
        Enabled Email channels: {status.enabledEmailChannels}. SMTP {status.smtpConfigured ? 'is configured' : 'is not configured'}.
        {status.openIncidentId ? ` Open TEST incident: ${status.openIncidentId}.` : ''}
      </div>

      {!confirming && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy !== null} onClick={() => setConfirming(true)}
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50 cursor-pointer">
            {busy === 'run' ? 'Running the incident pipeline…' : 'Test Automatic Incident Alert'}
          </button>
          <button type="button" disabled={busy !== null || !status.openIncidentId} onClick={close}
            className="px-3 py-1.5 rounded border border-slate-500 font-semibold disabled:opacity-50 cursor-pointer">
            {busy === 'close' ? 'Closing…' : 'Close test incident'}
          </button>
        </div>
      )}

      {confirming && (
        <div className={`p-3 rounded border font-sans ${isDark ? 'border-amber-800 bg-amber-950/40' : 'border-amber-300 bg-amber-50'}`}>
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
            <p>
              This sends a real email through the configured SMTP server to every enabled Email channel on the CRITICAL rule.
              It does not stop any service. Click again only after you close the TEST incident — a second click while it is open does not send another email.
            </p>
          </div>
          <div className="flex gap-2 mt-3">
            <button type="button" disabled={busy !== null} onClick={run}
              className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold disabled:opacity-50 cursor-pointer">
              Send the test email
            </button>
            <button type="button" disabled={busy !== null} onClick={() => setConfirming(false)}
              className="px-3 py-1.5 rounded border border-slate-500 font-semibold cursor-pointer">
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-rose-500 font-sans" role="alert">{error}</p>}

      {report && (
        <div className="space-y-2">
          <p className="font-sans">
            Incident {report.incidentId ?? '—'} on {report.monitorName}
            {report.duplicate ? ' (this click did not send another email).' : '.'}
          </p>
          <ul className="space-y-1">
            {report.stages.map(s => <StageRow key={s.id} stage={s} />)}
          </ul>
        </div>
      )}
    </div>
  );
};

const StageRow: React.FC<{ stage: MockIncidentStage }> = ({ stage }) => (
  <li className="font-sans">
    <span className={`font-bold ${tone[stage.status]}`}>{stage.status}</span>
    <span className="font-semibold"> {stage.label}.</span>
    <span className="text-slate-400"> {stage.detail}</span>
    {stage.at && <span className="text-slate-500"> {stage.at}</span>}
  </li>
);
