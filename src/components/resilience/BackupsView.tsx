import React from 'react';
import { useOps } from '../../context/OpsContext';
import { BackupRecord } from '../../types';
import { Archive } from 'lucide-react';

const validDate = (s?: string | null) => Boolean(s) && !Number.isNaN(Date.parse(s as string));
const fmtDateTime = (s?: string | null, fallback = '—') => (validDate(s) ? new Date(s as string).toLocaleString() : fallback);
const FRESH_MS = 26 * 3600 * 1000;

const statusColor = (s: BackupRecord['status']) =>
  s === 'SUCCESS' ? 'text-emerald-500' : s === 'FAILED' ? 'text-rose-500' : s === 'RUNNING' ? 'text-blue-500' : 'text-amber-500';

export const BackupsView: React.FC = () => {
  const { backups, applications, servers, theme, integrations } = useOps();
  const isDark = theme === 'dark';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const card = `p-3 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`;

  const baseUrl = integrations?.publicUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  const exampleApp = applications[0]?.codeName || '<codeName>';
  const curlExample = `# Run as root on the VPS (AGENT_TOKEN is in /etc/scholario-agent.conf, mode 0600)
AGENT_TOKEN=$(sed -n 's/^AGENT_TOKEN=//p' /etc/scholario-agent.conf)
curl -fsS -X POST "${baseUrl}/api/v1/backups/report" \\
  -H "Authorization: Bearer $AGENT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"MYSQL_DUMP","status":"SUCCESS","sizeGb":1.4,"destination":"s3://bucket/db/","application":"${exampleApp}","integrityHash":"'"$(sha256sum dump.sql.gz | cut -d' ' -f1)"'","encrypted":true,"retentionDays":30}'`;

  const now = Date.now();
  const succeeded = backups.filter(b => b.status === 'SUCCESS');
  const failed = backups.filter(b => b.status === 'FAILED');
  const fresh = succeeded.filter(b => validDate(b.completedAt) && now - Date.parse(b.completedAt) < FRESH_MS);
  const encrypted = backups.filter(b => b.encrypted).length;
  const withHash = backups.filter(b => b.integrityHash).length;
  const latest = [...backups].filter(b => validDate(b.completedAt)).sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))[0];
  const appsWithoutFresh = applications.filter(a => !fresh.some(b => b.applicationId === a.id));
  const pct = (n: number) => (backups.length ? `${Math.round((n / backups.length) * 100)}%` : '—');

  const instructions = (
    <div className={`rounded-lg border p-5 space-y-3 font-mono text-xs ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
      <div className="font-bold uppercase tracking-wider text-[11px]">How backups are reported</div>
      <p className={`font-sans text-[12px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
        Scholario Ops does not run backups itself. Your backup script on each VPS reports every run to{' '}
        <code className="font-mono">POST /api/v1/backups/report</code>, authenticated with that server's agent token
        (<code className="font-mono">Authorization: Bearer &lt;agent token&gt;</code>). The token is the <code className="font-mono">AGENT_TOKEN</code>{' '}
        value in <code className="font-mono">/etc/scholario-agent.conf</code>, written when the agent was installed from Setup.
      </p>
      <div className={`font-sans text-[11px] ${muted}`}>
        Body fields: <code className="font-mono">type</code> (DAILY_SNAPSHOT | MYSQL_DUMP | FILE_STORAGE), <code className="font-mono">status</code> (SUCCESS | FAILED),{' '}
        <code className="font-mono">sizeGb</code>, <code className="font-mono">destination</code>, <code className="font-mono">application</code> (the application's code name),
        and optionally <code className="font-mono">integrityHash</code>, <code className="font-mono">encrypted</code>, <code className="font-mono">retentionDays</code>.
      </div>
      <pre className={`p-3 rounded border overflow-x-auto text-[11px] leading-relaxed ${isDark ? 'bg-[#070A10] border-[#1E293B] text-slate-300' : 'bg-slate-900 border-slate-800 text-slate-100'}`}>
        {curlExample}
      </pre>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            BACKUPS
          </h1>
          <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Backup runs reported by the backup scripts on your servers
          </p>
        </div>
      </div>

      {backups.length === 0 ? (
        <>
          <div className={`flex flex-col items-center justify-center py-10 px-6 text-center rounded-lg border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'}`}>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${isDark ? 'bg-[#1A2436]' : 'bg-slate-100'}`}>
              <Archive className={`w-6 h-6 ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
            </div>
            <h3 className={`text-sm font-semibold font-mono ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>No backups reported yet</h3>
            <p className={`text-xs mt-1.5 max-w-md ${muted}`}>
              Backups appear here once a backup script on one of your servers reports a run. Add the call below to the end of your backup script.
            </p>
          </div>
          {instructions}
        </>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
            <div className={card}>
              <div className={`text-[10px] uppercase ${muted}`}>Fresh (&lt; 26h)</div>
              <div className="text-base font-bold tabular-nums">{fresh.length} successful</div>
              <div className={`text-[10px] font-sans mt-0.5 ${appsWithoutFresh.length ? 'text-amber-500' : 'text-emerald-500'}`}>
                {applications.length === 0 ? 'No applications registered'
                  : appsWithoutFresh.length ? `${appsWithoutFresh.length} app(s) without a recent backup` : 'Every application has a recent backup'}
              </div>
            </div>
            <div className={card}>
              <div className={`text-[10px] uppercase ${muted}`}>Failed Runs</div>
              <div className={`text-base font-bold tabular-nums ${failed.length ? 'text-rose-500' : ''}`}>{failed.length}</div>
              <div className={`text-[10px] font-sans mt-0.5 ${muted}`}>of {backups.length} reported</div>
            </div>
            <div className={card}>
              <div className={`text-[10px] uppercase ${muted}`}>Encrypted / Hashed</div>
              <div className="text-base font-bold tabular-nums">{pct(encrypted)} / {pct(withHash)}</div>
              <div className={`text-[10px] font-sans mt-0.5 ${muted}`}>as reported by the scripts</div>
            </div>
            <div className={card}>
              <div className={`text-[10px] uppercase ${muted}`}>Latest Report</div>
              <div className="text-base font-bold">{latest ? fmtDateTime(latest.completedAt) : '—'}</div>
              <div className={`text-[10px] font-sans mt-0.5 ${latest ? statusColor(latest.status) : muted}`}>{latest ? `${latest.type} · ${latest.status}` : ''}</div>
            </div>
          </div>

          {/* Backups Table */}
          <div className={`rounded-lg border overflow-hidden transition-colors ${
            isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'
          }`}>
            <div className="w-full min-w-0 overflow-x-auto">
              <table className="w-full text-left text-xs font-mono min-w-[860px]">
                <thead className={`font-medium border-b ${
                  isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}>
                  <tr>
                    <th className="py-2.5 px-3.5">Completed</th>
                    <th className="py-2.5 px-3.5">Application</th>
                    <th className="py-2.5 px-3.5">Server</th>
                    <th className="py-2.5 px-3.5">Type</th>
                    <th className="py-2.5 px-3.5">Size</th>
                    <th className="py-2.5 px-3.5">Destination</th>
                    <th className="py-2.5 px-3.5">Retention</th>
                    <th className="py-2.5 px-3.5">Encrypted</th>
                    <th className="py-2.5 px-3.5">Integrity Hash</th>
                    <th className="py-2.5 px-3.5">Restore Test</th>
                    <th className="py-2.5 px-3.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
                  {backups.map(b => {
                    const app = applications.find(a => a.id === b.applicationId);
                    const srv = servers.find(s => s.id === b.serverId);
                    return (
                      <tr key={b.id} className={`transition-colors ${isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}`}>
                        <td className={`py-2.5 px-3.5 whitespace-nowrap ${muted}`}>{fmtDateTime(b.completedAt)}</td>
                        <td className="py-2.5 px-3.5 font-sans font-bold">{app?.name ?? <span className={`font-normal ${muted}`}>Unassigned</span>}</td>
                        <td className={`py-2.5 px-3.5 ${muted}`}>{srv ? srv.hostname.split('.')[0] : '—'}</td>
                        <td className={`py-2.5 px-3.5 ${muted}`}>{b.type}</td>
                        <td className="py-2.5 px-3.5 tabular-nums">{b.sizeGb ? `${b.sizeGb} GB` : '—'}</td>
                        <td className={`py-2.5 px-3.5 max-w-[180px] truncate ${muted}`} title={b.destination}>{b.destination || '—'}</td>
                        <td className={`py-2.5 px-3.5 tabular-nums ${muted}`}>{b.retentionDays ? `${b.retentionDays}d` : '—'}</td>
                        <td className={`py-2.5 px-3.5 ${b.encrypted ? 'text-emerald-500' : muted}`}>{b.encrypted ? 'Yes' : 'No'}</td>
                        <td className={`py-2.5 px-3.5 max-w-[160px] truncate text-[10px] ${muted}`} title={b.integrityHash}>{b.integrityHash || 'not provided'}</td>
                        <td className="py-2.5 px-3.5 font-sans">
                          {validDate(b.restoreTestedAt) ? (
                            <>
                              <div className={`font-medium ${b.restoreStatus === 'VERIFIED' ? 'text-emerald-500' : b.restoreStatus === 'FAILED' ? 'text-rose-500' : 'text-amber-500'}`}>
                                {b.restoreStatus}{b.restoreDurationMin ? ` (${b.restoreDurationMin}m)` : ''}
                              </div>
                              <div className={`text-[10px] font-mono ${muted}`}>{new Date(b.restoreTestedAt).toLocaleDateString()}</div>
                            </>
                          ) : (
                            <span className={`text-[11px] ${muted}`}>Not tested</span>
                          )}
                        </td>
                        <td className={`py-2.5 px-3.5 text-right font-bold ${statusColor(b.status)}`}>{b.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <details className={`rounded-lg border ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
            <summary className={`px-4 py-2 text-xs font-mono cursor-pointer ${muted}`}>How to report backups from a server</summary>
            <div className="p-2">{instructions}</div>
          </details>
        </>
      )}
    </div>
  );
};
