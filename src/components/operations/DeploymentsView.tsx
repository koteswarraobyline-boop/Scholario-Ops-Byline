import React from 'react';
import { useOps } from '../../context/OpsContext';
import { Deployment } from '../../types';
import { GitBranch, CheckCircle2, XCircle, Loader2, Circle, RotateCcw } from 'lucide-react';

const STAGES: { key: Deployment['status']; label: string }[] = [
  { key: 'BUILDING', label: 'Build' },
  { key: 'DEPLOYING', label: 'Deploy' },
  { key: 'HEALTH_CHECK', label: 'Health check' },
  { key: 'SMOKE_TEST', label: 'Smoke test' },
];
const STAGE_ORDER = STAGES.map(s => s.key);

const fmtDateTime = (iso?: string) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toLocaleString();
};

const fmtDuration = (sec: number) => {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
};

const statusColor = (s: Deployment['status']) =>
  s === 'SUCCESS' ? 'text-emerald-500' : s === 'FAILED' ? 'text-rose-500' : s === 'ROLLED_BACK' ? 'text-amber-500' : 'text-blue-500';

const CURL_EXAMPLE = `curl -X POST "$OPS_URL/api/v1/deployments/report" \\
  -H "Authorization: Bearer $DEPLOY_REPORT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "application": "<codeName>",
    "version": "<version>",
    "status": "DEPLOYING",
    "environment": "PRD",
    "commitHash": "'"$GIT_SHA"'",
    "commitMessage": "Release notes or last commit subject",
    "author": "ci",
    "id": "'"$CI_PIPELINE_ID"'"
  }'`;

export const DeploymentsView: React.FC = () => {
  const { deployments, applications, theme } = useOps();
  const isDark = theme === 'dark';
  const muted = isDark ? 'text-slate-400' : 'text-slate-600';

  const reportingHelp = (
    <div className={`rounded-lg border p-4 sm:p-5 space-y-3 font-mono text-xs ${
      isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
    }`}>
      <div className="font-bold text-sm">How deployments get here</div>
      <p className={`font-sans ${muted}`}>
        Scholario Ops does not deploy code. Your CI/CD pipeline reports each stage by calling{' '}
        <code className="text-blue-500">POST /api/v1/deployments/report</code> with the header{' '}
        <code className="text-blue-500">Authorization: Bearer $DEPLOY_REPORT_TOKEN</code> — the token is the{' '}
        <code>DEPLOY_REPORT_TOKEN</code> environment variable set on the Ops server.
      </p>
      <ul className={`font-sans list-disc pl-5 space-y-1 ${muted}`}>
        <li><code>application</code> — the application's code name as registered in Setup{applications.length > 0 && <> (yours: {applications.map(a => a.codeName).join(', ')})</>}.</li>
        <li><code>version</code> — required release label.</li>
        <li><code>status</code> — one of BUILDING, DEPLOYING, HEALTH_CHECK, SMOKE_TEST, SUCCESS, FAILED, ROLLED_BACK.</li>
        <li><code>environment</code> — PRD or DR (defaults to PRD).</li>
        <li><code>commitHash</code>, <code>commitMessage</code>, <code>author</code> — optional.</li>
        <li><code>id</code> — optional; send the same id on every call of one pipeline run to update that deployment's status instead of creating a new one.</li>
      </ul>
      <div className="w-full min-w-0 overflow-x-auto">
        <pre className={`p-3 rounded border text-[11px] leading-relaxed ${
          isDark ? 'bg-[#05080E] text-slate-200 border-[#182338]' : 'bg-slate-900 text-slate-100 border-slate-800'
        }`}>{CURL_EXAMPLE}</pre>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            DEPLOYMENTS
          </h1>
          <p className={`text-xs font-mono ${muted}`}>
            Releases reported by your CI/CD pipeline: Build → Deploy → Health check → Smoke test → Result
          </p>
        </div>
      </div>

      {deployments.length === 0 ? (
        <div className="space-y-4">
          <div className={`flex flex-col items-center justify-center py-10 px-6 text-center rounded-lg border ${
            isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'
          }`}>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${isDark ? 'bg-[#1A2436]' : 'bg-slate-100'}`}>
              <GitBranch className={`w-6 h-6 ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
            </div>
            <h3 className={`text-sm font-semibold font-mono ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>No deployments reported yet</h3>
            <p className="text-xs mt-1.5 max-w-md text-slate-500">
              Deployments appear here once your CI pipeline reports them. See the instructions below.
            </p>
          </div>
          {reportingHelp}
        </div>
      ) : (
        <>
          <div className="space-y-3 font-mono text-xs">
            {deployments.map(dep => {
              const app = applications.find(a => a.id === dep.applicationId);
              const finished = dep.status === 'SUCCESS' || dep.status === 'FAILED' || dep.status === 'ROLLED_BACK';
              const currentIdx = STAGE_ORDER.indexOf(dep.status);
              const started = fmtDateTime(dep.startedAt);
              const completed = fmtDateTime(dep.completedAt);

              return (
                <div key={dep.id} className={`p-4 rounded-lg border space-y-3 transition-colors min-w-0 ${
                  isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
                }`}>
                  <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3 min-w-0 ${
                    isDark ? 'border-[#1A2332]' : 'border-slate-100'
                  }`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${
                        isDark ? 'bg-[#162033] text-blue-400' : 'bg-blue-50 text-blue-600 border border-blue-200'
                      }`}>
                        <GitBranch className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-sm font-sans">{app?.name ?? 'Unknown application'}</span>
                          <span className="text-xs text-blue-500 font-semibold">{dep.version}</span>
                          <span className={`text-[10px] px-1.5 rounded border ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-300 text-slate-500'}`}>{dep.environment}</span>
                          {dep.commitHash && <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>({dep.commitHash.slice(0, 12)})</span>}
                        </div>
                        {dep.commitMessage && (
                          <p className={`text-xs font-sans mt-0.5 truncate ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{dep.commitMessage}</p>
                        )}
                      </div>
                    </div>

                    <span className={`font-bold text-[10px] uppercase ${statusColor(dep.status)}`}>
                      {dep.status.replace('_', ' ')}
                    </span>
                  </div>

                  {/* Pipeline stages derived from the reported status */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {STAGES.map((stage, idx) => {
                      let icon: React.ReactNode;
                      if (dep.status === 'SUCCESS') icon = <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
                      else if (finished) icon = <Circle className="w-3.5 h-3.5 text-slate-500" />;
                      else if (idx < currentIdx) icon = <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
                      else if (idx === currentIdx) icon = <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
                      else icon = <Circle className="w-3.5 h-3.5 text-slate-500" />;
                      return (
                        <div key={stage.key} className={`p-2 rounded border flex items-center justify-between ${
                          isDark ? 'bg-[#0B0F17] border-[#1A2436]' : 'bg-slate-50 border-slate-200'
                        }`}>
                          <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>{idx + 1}. {stage.label}</span>
                          {icon}
                        </div>
                      );
                    })}
                  </div>
                  {dep.status === 'FAILED' && (
                    <div className="flex items-center gap-1.5 text-rose-500 text-[11px]"><XCircle className="w-3.5 h-3.5" /> Pipeline reported FAILED</div>
                  )}
                  {dep.status === 'ROLLED_BACK' && (
                    <div className="flex items-center gap-1.5 text-amber-500 text-[11px]"><RotateCcw className="w-3.5 h-3.5" /> Pipeline reported this release as rolled back</div>
                  )}

                  <div className={`flex flex-wrap justify-between gap-1 sm:gap-2 text-[11px] pt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    <span>Author: {dep.author || '—'} · Duration: {fmtDuration(dep.durationSec)}</span>
                    <span>
                      Started: {started ?? '—'}
                      {completed && <> · Completed: {completed}</>}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <details className="font-mono text-xs">
            <summary className={`cursor-pointer select-none ${muted}`}>How to report deployments from CI</summary>
            <div className="mt-3">{reportingHelp}</div>
          </details>
        </>
      )}
    </div>
  );
};
