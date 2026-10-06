import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { AlertTriangle, Globe, RefreshCw, KeyRound, ArrowRightLeft } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { LoadBalancerPanel } from './LoadBalancerPanel';

const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
};
const NOT_AVAILABLE = 'Not available (plan/token)';

export const CloudflareView: React.FC = () => {
  const { cloudflareZones, theme, integrations, syncCloudflare } = useOps();
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const isDark = theme === 'dark';
  const canSync = hasRole('operator');
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const cf = integrations?.cloudflare;
  const configured = cf?.configured ?? false;
  const selectedZone = cloudflareZones.find(z => z.id === selectedZoneId) ?? cloudflareZones[0];

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncCloudflare();
    } finally {
      setSyncing(false);
    }
  };

  const card = `p-3 rounded border ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`;
  const label = `text-[10px] uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`;
  const sub = `text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`;
  const strong = isDark ? 'text-slate-100' : 'text-slate-900';

  const header = (
    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
      <div>
        <h1 className="text-lg font-bold font-mono tracking-tight">CLOUDFLARE LOAD BALANCING, DNS &amp; FAILOVER</h1>
        <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          Load Balancer pools / origin health, zones, DNS records and SSL from the Cloudflare API · zone sync {fmtDateTime(cf?.lastSyncAt)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {configured && (
          <span className={`text-[11px] font-mono px-2 py-0.5 rounded flex items-center gap-1.5 border ${
            cf?.lastError
              ? isDark ? 'text-amber-400 bg-amber-950/60 border-amber-900/80' : 'text-amber-700 bg-amber-50 border-amber-200'
              : isDark ? 'text-emerald-400 bg-emerald-950/60 border-emerald-900/80' : 'text-emerald-700 bg-emerald-50 border-emerald-200'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cf?.lastError ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            <span>{cf?.lastError ? 'Cloudflare API: last sync failed' : cf?.lastSyncAt ? 'Cloudflare API: synced' : 'Cloudflare API: not synced yet'}</span>
          </span>
        )}
        {configured && canSync && (
          <button
            onClick={() => void handleSync()}
            disabled={syncing}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${isDark ? 'bg-[#162033] border-[#243552] text-slate-200 hover:bg-[#1C2942]' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 shadow-xs'}`}
          >
            <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        )}
      </div>
    </div>
  );

  // Integration status not loaded yet
  if (!integrations) {
    return (
      <div className="space-y-6">
        {header}
        <div className={`rounded-lg border p-8 text-center text-xs font-mono ${isDark ? 'bg-[#111726] border-[#1E293B] text-slate-500' : 'bg-white border-slate-200 text-slate-400'}`}>
          Loading Cloudflare status…
        </div>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="space-y-6">
        {header}
        <LoadBalancerPanel />
        <div className={`p-5 rounded-lg border font-mono text-xs space-y-3 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
          <div className="flex items-center gap-2 font-bold text-sm">
            <KeyRound className="w-4 h-4 text-amber-500" />
            <span>Cloudflare not configured</span>
          </div>
          <p className={isDark ? 'text-slate-300' : 'text-slate-700'}>
            Scholario Ops reads Load Balancer pools, pool health, zones and DNS records. It needs a Cloudflare API token (kept on the server only).
          </p>
          <ol className={`list-decimal pl-5 space-y-1.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            <li>Open <span className="font-semibold">dash.cloudflare.com → My Profile → API Tokens</span> and create a custom token.</li>
            <li>
              Read-only monitoring: <span className="font-semibold">Account : Load Balancing: Monitors and Pools : Read</span>, <span className="font-semibold">Zone : Load Balancers : Read</span> and <span className="font-semibold">Zone : Zone : Read</span>.
              Only DNS-record failover for other applications needs <span className="font-semibold">Zone : DNS : Edit</span>.
              Optional: <span className="font-semibold">Zone : SSL and Certificates : Read</span> (SSL mode / certificate expiry) and <span className="font-semibold">Zone : Analytics : Read</span> (firewall events).
            </li>
            <li>Add it to the server <span className="font-semibold">.env</span> file as <code className={`px-1 rounded ${isDark ? 'bg-[#0B0F17]' : 'bg-slate-100'}`}>CLOUDFLARE_API_TOKEN=&lt;token&gt;</code>.</li>
            <li>Restart the Scholario Ops server.</li>
          </ol>
          {cf?.lastError && <p className="text-rose-500">Last error: {cf.lastError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <LoadBalancerPanel />

      {cf?.lastError && (
        <div className={`p-3.5 rounded border text-xs font-mono flex items-start gap-2 ${isDark ? 'bg-[#1F1710] border-amber-900/80 text-amber-300' : 'bg-amber-50 border-amber-300 text-amber-800'}`}>
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>Last Cloudflare sync failed: {cf.lastError}. Data below is from the last successful sync, if any.</span>
        </div>
      )}

      {!selectedZone ? (
        <EmptyState
          icon={Globe}
          title={cf?.lastSyncAt ? 'No zones found' : 'Not synced yet'}
          description={cf?.lastSyncAt
            ? 'The Cloudflare token does not have access to any zones. Check the token’s zone resources.'
            : 'Run a sync to load zones and DNS records from Cloudflare.'}
          action={canSync ? { label: syncing ? 'Syncing…' : 'Sync now', onClick: () => { if (!syncing) void handleSync(); } } : undefined}
        />
      ) : (
        <>
          {/* Zone Selector */}
          {cloudflareZones.length > 1 && (
            <div className="flex items-center gap-2 font-mono text-xs flex-wrap">
              <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>Zone:</span>
              <div className="flex items-center gap-1 flex-wrap">
                {cloudflareZones.map(z => (
                  <button
                    key={z.id}
                    onClick={() => setSelectedZoneId(z.id)}
                    className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                      selectedZone.id === z.id
                        ? 'bg-blue-600 text-white font-medium shadow-xs'
                        : isDark ? 'bg-[#111726] border border-[#1E293B] text-slate-400 hover:text-slate-200' : 'bg-slate-100 border border-slate-300 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {z.domain}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* DNS drift warning */}
          {selectedZone.driftDetected && (
            <div className={`p-3.5 rounded border text-xs space-y-1 font-mono ${isDark ? 'bg-[#1F1710] border-amber-900/80' : 'bg-amber-50 border-amber-300'}`}>
              <div className="font-bold text-amber-500 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span>DNS mismatch on {selectedZone.domain}</span>
              </div>
              <p className={`font-sans ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                {selectedZone.driftDetails || 'The failover DNS record does not match the expected origin for the application’s failover state.'}
              </p>
            </div>
          )}

          {/* Zone Detail Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs font-mono">
            <div className={card}>
              <div className={label}>Zone Status</div>
              <div className={`text-base font-bold mt-0.5 ${selectedZone.status === 'ACTIVE' ? 'text-emerald-500' : 'text-amber-500'}`}>
                {selectedZone.status}
              </div>
              <div className={sub}>
                {selectedZone.status === 'PENDING' ? 'Nameservers not yet pointed to Cloudflare' : `Plan: ${selectedZone.plan || '—'}`}
              </div>
            </div>

            <div className={card}>
              <div className={label}>SSL / TLS</div>
              <div className={`text-base font-bold mt-0.5 ${strong}`}>{selectedZone.sslMode ? selectedZone.sslMode.toUpperCase() : '—'}</div>
              <div className={sub}>{selectedZone.tlsVersion || '—'} · status {selectedZone.sslStatus}</div>
              <div className={`text-[10px] mt-0.5 ${selectedZone.sslStatus === 'ACTIVE' ? 'text-emerald-500' : selectedZone.sslStatus === 'EXPIRING_SOON' || selectedZone.sslStatus === 'ERROR' ? 'text-amber-500' : isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                {fmtDate(selectedZone.sslExpiresAt) ? `Edge certificate valid until ${fmtDate(selectedZone.sslExpiresAt)}` : `Certificate expiry: ${NOT_AVAILABLE}`}
              </div>
            </div>

            <div className={card}>
              <div className={label}>Nameservers</div>
              {selectedZone.nameServers && selectedZone.nameServers.length > 0 ? (
                <div className={`mt-0.5 space-y-0.5 text-[11px] ${strong}`}>
                  {selectedZone.nameServers.map(ns => <div key={ns} className="truncate">{ns}</div>)}
                </div>
              ) : (
                <div className={`text-base font-bold mt-0.5 ${strong}`}>—</div>
              )}
            </div>

            <div className={card}>
              <div className={label}>Firewall events (24h)</div>
              {selectedZone.wafEvents24h === null ? (
                <div className={`text-[11px] mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{NOT_AVAILABLE}</div>
              ) : (
                <div className={`text-base font-bold tabular-nums mt-0.5 ${strong}`}>{selectedZone.wafEvents24h.toLocaleString()}</div>
              )}
            </div>
          </div>

          {/* DNS failover */}
          <div className={`rounded-lg border p-4 font-mono text-xs space-y-3 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
            <div className={`flex items-center justify-between border-b pb-2 ${isDark ? 'border-[#1A2332]' : 'border-slate-100'}`}>
              <h2 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <ArrowRightLeft className="w-3.5 h-3.5 text-blue-500" /> DNS Failover
              </h2>
              <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>{selectedZone.loadBalancer.poolName || '—'}</span>
            </div>
            {selectedZone.loadBalancer.primaryOrigin === '—' && selectedZone.loadBalancer.drOrigin === '—' ? (
              <p className={isDark ? 'text-slate-400' : 'text-slate-500'}>
                No application uses a DNS record in this zone for failover.{' '}
                <button onClick={() => navigate('/setup')} className="text-blue-500 hover:underline cursor-pointer">Configure it in Setup</button>{' '}
                by setting the application’s Cloudflare zone and DNS record.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div>
                  <div className={label}>Active origin</div>
                  <div className={`font-bold mt-0.5 break-all ${strong}`}>{selectedZone.loadBalancer.activeOrigin || '—'}</div>
                  <div className={`text-[10px] mt-0.5 ${selectedZone.loadBalancer.healthCheckStatus === 'HEALTHY' ? 'text-emerald-500' : selectedZone.loadBalancer.healthCheckStatus === 'UNKNOWN' ? 'text-slate-400' : 'text-rose-500'}`}>
                    {selectedZone.loadBalancer.healthCheckStatus === 'HEALTHY' ? 'Active server healthy' : selectedZone.loadBalancer.healthCheckStatus === 'UNKNOWN' ? 'No data' : 'Active server unhealthy'}
                  </div>
                </div>
                <div>
                  <div className={label}>PRD origin</div>
                  <div className={`mt-0.5 break-all ${strong}`}>{selectedZone.loadBalancer.primaryOrigin || '—'}</div>
                </div>
                <div>
                  <div className={label}>DR origin</div>
                  <div className={`mt-0.5 break-all ${strong}`}>{selectedZone.loadBalancer.drOrigin || '—'}</div>
                </div>
                <div>
                  <div className={label}>Policy</div>
                  <div className={`mt-0.5 ${strong}`}>
                    {selectedZone.loadBalancer.failoverPolicy === 'AUTOMATIC_WITH_CONFIRMATION' ? 'Automatic (after confirmed PRD failure)' : 'Manual'}
                  </div>
                </div>
                <div>
                  <div className={label}>Last switched</div>
                  <div className={`mt-0.5 ${strong}`}>{selectedZone.loadBalancer.lastReroutedAt ? fmtDateTime(selectedZone.loadBalancer.lastReroutedAt) : 'Never'}</div>
                </div>
              </div>
            )}
          </div>

          {/* DNS Records Table */}
          <div className={`rounded-lg border overflow-hidden space-y-3 p-4 font-mono text-xs transition-colors ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`}>
            <div className={`flex items-center justify-between border-b pb-2 ${isDark ? 'border-[#1A2332]' : 'border-slate-100'}`}>
              <h2 className="text-xs font-bold uppercase tracking-wider font-mono">
                DNS Records ({selectedZone.domain}) · {selectedZone.dnsRecords.length}
              </h2>
              <span className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Last checked {fmtDateTime(selectedZone.lastChecked)}
              </span>
            </div>

            {selectedZone.dnsRecords.length === 0 ? (
              <div className={`py-6 text-center ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>This zone has no DNS records.</div>
            ) : (
              <div className="w-full min-w-0 overflow-x-auto">
                <table className="w-full text-left text-xs font-mono min-w-[640px]">
                  <thead className={`border-b ${isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                    <tr>
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3">Name</th>
                      <th className="py-2 px-3">Content</th>
                      <th className="py-2 px-3">Proxy</th>
                      <th className="py-2 px-3">TTL</th>
                      <th className="py-2 px-3 text-right">Modified</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
                    {selectedZone.dnsRecords.map(rec => (
                      <tr key={rec.id} className={isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}>
                        <td className={`py-2 px-3 font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{rec.type}</td>
                        <td className={`py-2 px-3 font-semibold ${strong}`}>{rec.name}</td>
                        <td className={`py-2 px-3 break-all ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{rec.target}</td>
                        <td className="py-2 px-3">
                          <span className={rec.proxied ? 'text-amber-500 font-semibold' : (isDark ? 'text-slate-400' : 'text-slate-500')}>
                            {rec.proxied ? 'Proxied' : 'DNS Only'}
                          </span>
                        </td>
                        <td className={`py-2 px-3 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{rec.ttl === 1 ? 'Auto' : `${rec.ttl}s`}</td>
                        <td className={`py-2 px-3 text-right ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{rec.lastModified || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
