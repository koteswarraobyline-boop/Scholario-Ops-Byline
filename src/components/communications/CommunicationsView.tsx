import React, { useEffect, useState } from 'react';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { CommunicationChannel, EscalationPolicy, IncidentSeverity } from '../../types';
import {
  Send,
  Bell,
  Activity,
  AlertTriangle,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  Power,
  Save,
  X,
  Radio,
} from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';

type ChannelType = CommunicationChannel['type'];

const SEVERITIES: IncidentSeverity[] = ['INFO', 'WARNING', 'HIGH', 'CRITICAL', 'EMERGENCY'];

const CHANNEL_TYPES: { value: ChannelType; label: string; targetLabel: string; placeholder: string; help: string }[] = [
  {
    value: 'TEAMS', label: 'Microsoft Teams', targetLabel: 'Incoming webhook URL',
    placeholder: 'https://…webhook.office.com/…',
    help: 'Create an Incoming Webhook (or Workflows webhook) on the Teams channel and paste its https URL.',
  },
  {
    value: 'WEBHOOK', label: 'Webhook / Slack', targetLabel: 'Webhook URL',
    placeholder: 'https://hooks.slack.com/services/…',
    help: 'Any https endpoint that accepts a JSON POST. Slack incoming webhooks are compatible.',
  },
  {
    value: 'EMAIL', label: 'Email', targetLabel: 'Recipient addresses',
    placeholder: 'oncall@yourdomain.com, admin@yourdomain.com',
    help: 'Comma separated addresses. Requires SMTP settings in the Ops server environment.',
  },
  {
    value: 'PAGERDUTY', label: 'PagerDuty', targetLabel: 'Events v2 routing key',
    placeholder: '32-character integration key',
    help: 'Add an "Events API v2" integration to the PagerDuty service and paste its integration (routing) key.',
  },
];

const typeMeta = (t: ChannelType) => CHANNEL_TYPES.find(c => c.value === t) ?? CHANNEL_TYPES[0];

const fmtDateTime = (iso?: string | null) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toLocaleString();
};

const fmtUptime = (sec?: number) => {
  if (sec === undefined || sec === null || !Number.isFinite(sec)) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};

interface ChannelDraft {
  name: string;
  type: ChannelType;
  targetEndpoint: string;
  enabled: boolean;
}

interface PolicyDraft {
  id?: string;
  channels: string[];
  repeatIntervalMin: number;
  base?: EscalationPolicy;
}

const policiesToDraft = (policies: EscalationPolicy[]): Record<IncidentSeverity, PolicyDraft> => {
  const out = {} as Record<IncidentSeverity, PolicyDraft>;
  for (const sev of SEVERITIES) {
    const p = policies.find(x => x.severity === sev);
    out[sev] = p
      ? { id: p.id, channels: [...p.channels], repeatIntervalMin: p.repeatIntervalMin ?? 0, base: p }
      : { channels: [], repeatIntervalMin: 0 };
  }
  return out;
};

export const CommunicationsView: React.FC = () => {
  const {
    communicationChannels,
    escalationPolicies,
    sendTestNotification,
    createChannel,
    updateChannel,
    deleteChannel,
    saveEscalationPolicies,
    integrations,
    apiHealth,
    triggerHealthCheck,
    theme
  } = useOps();
  const { hasRole } = useAuth();
  const isDark = theme === 'dark';
  const isAdmin = hasRole('it_administrator');
  const isOperator = hasRole('operator');

  const [busy, setBusy] = useState<string | null>(null);
  const [isProbingHealth, setIsProbingHealth] = useState(false);
  const [editor, setEditor] = useState<{ id: string | null; draft: ChannelDraft } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [policyDraft, setPolicyDraft] = useState(() => policiesToDraft(escalationPolicies));
  const [policyDirty, setPolicyDirty] = useState(false);
  const [savingPolicies, setSavingPolicies] = useState(false);

  // Follow server changes unless the admin is editing
  useEffect(() => {
    if (!policyDirty) setPolicyDraft(policiesToDraft(escalationPolicies));
  }, [escalationPolicies, policyDirty]);

  const withBusy = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); } finally { setBusy(null); }
  };

  const handleManualHealthProbe = async () => {
    setIsProbingHealth(true);
    try { await triggerHealthCheck(); } finally { setIsProbingHealth(false); }
  };

  const openCreate = () => setEditor({ id: null, draft: { name: '', type: 'TEAMS', targetEndpoint: '', enabled: true } });
  const openEdit = (ch: CommunicationChannel) =>
    setEditor({ id: ch.id, draft: { name: ch.name, type: ch.type, targetEndpoint: ch.targetEndpoint, enabled: ch.enabled } });

  const submitChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editor) return;
    const { id, draft } = editor;
    const payload: Partial<CommunicationChannel> = {
      name: draft.name.trim(),
      type: draft.type,
      targetEndpoint: draft.targetEndpoint.trim(),
      enabled: draft.enabled,
    };
    await withBusy('editor', async () => {
      const res = id ? await updateChannel(id, payload) : await createChannel(payload);
      if (res) setEditor(null);
    });
  };

  const togglePolicyChannel = (sev: IncidentSeverity, channelId: string) => {
    setPolicyDirty(true);
    setPolicyDraft(prev => {
      const cur = prev[sev];
      const channels = cur.channels.includes(channelId) ? cur.channels.filter(c => c !== channelId) : [...cur.channels, channelId];
      return { ...prev, [sev]: { ...cur, channels } };
    });
  };

  const setPolicyRepeat = (sev: IncidentSeverity, value: string) => {
    setPolicyDirty(true);
    const n = Math.max(0, Math.min(1440, Math.floor(Number(value) || 0)));
    setPolicyDraft(prev => ({ ...prev, [sev]: { ...prev[sev], repeatIntervalMin: n } }));
  };

  const savePolicies = async () => {
    const list: Partial<EscalationPolicy>[] = SEVERITIES
      .filter(sev => policyDraft[sev].channels.length > 0 || policyDraft[sev].repeatIntervalMin > 0)
      .map(sev => {
        const d = policyDraft[sev];
        return {
          ...(d.base ?? {}),
          ...(d.id ? { id: d.id } : {}),
          severity: sev,
          channels: d.channels.filter(id => communicationChannels.some(c => c.id === id)),
          repeatIntervalMin: d.repeatIntervalMin,
        };
      });
    setSavingPolicies(true);
    try {
      if (await saveEscalationPolicies(list)) setPolicyDirty(false);
    } finally {
      setSavingPolicies(false);
    }
  };

  const discardPolicies = () => {
    setPolicyDirty(false);
    setPolicyDraft(policiesToDraft(escalationPolicies));
  };

  const isOutage = !apiHealth.reachable || apiHealth.status === 'UNREACHABLE';
  const hasChecked = Boolean(apiHealth.lastChecked);
  const details = apiHealth.details;
  const smtpMissing = integrations !== null && !integrations.smtp.configured;
  const hasEmailChannel = communicationChannels.some(c => c.type === 'EMAIL');

  const cardCls = `rounded-lg border transition-colors ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`;
  const subCardCls = `p-2.5 rounded border ${isDark ? 'bg-[#0B0F17] border-slate-800' : 'bg-slate-50 border-slate-200'}`;
  const inputCls = `w-full p-2 border rounded text-xs font-mono focus:outline-none focus:border-blue-500 ${
    isDark ? 'bg-[#0A0F1A] border-[#1E293B] text-slate-100' : 'bg-white border-slate-300 text-slate-900'
  }`;
  const labelCls = `block text-[10px] uppercase font-semibold mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`;
  const secondaryBtn = `px-2 py-1 rounded text-[11px] font-semibold transition-colors flex items-center justify-center gap-1 border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
    isDark ? 'bg-[#1A2436] hover:bg-[#23324C] border-[#23334E] text-slate-200' : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'
  }`;
  const muted = isDark ? 'text-slate-400' : 'text-slate-600';

  const healthTone = !hasChecked ? 'text-slate-400' : isOutage ? 'text-rose-500' : apiHealth.status === 'DEGRADED' ? 'text-amber-500' : 'text-emerald-500';

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b ${
        isDark ? 'border-[#1E293B]' : 'border-slate-200'
      }`}>
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">
            COMMUNICATIONS &amp; ESCALATION
          </h1>
          <p className={`text-xs font-mono ${muted}`}>
            Notification channels for incident alerts and which channels each severity pages
          </p>
        </div>

        <div className={`flex items-center gap-2 px-2.5 py-1 rounded text-xs font-mono border ${
          isOutage
            ? 'bg-rose-950/80 border-rose-800 text-rose-300'
            : isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200'
        }`}>
          <span className={`w-2 h-2 rounded-full ${!hasChecked ? 'bg-slate-500' : isOutage ? 'bg-rose-500' : apiHealth.status === 'DEGRADED' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
          <span className={isOutage ? '' : healthTone}>
            OPS API: {hasChecked ? `${apiHealth.status} (${apiHealth.latencyMs}ms)` : 'CHECKING…'}
          </span>
        </div>
      </div>

      {isOutage && (
        <div className="p-4 rounded-lg border border-rose-600 bg-rose-950/90 text-rose-100 space-y-2 font-mono">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="font-bold text-sm text-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              <span>OPS API UNREACHABLE FROM THIS BROWSER</span>
            </div>
            <span className="text-[10px] text-rose-300">Last attempt: {fmtDateTime(apiHealth.lastChecked) ?? '—'}</span>
          </div>
          <p className="text-xs font-sans text-rose-200">
            <code>{apiHealth.endpoint}</code> did not respond. Data on this page may be stale until the connection recovers. The check repeats every 15 seconds.
          </p>
          <button
            onClick={handleManualHealthProbe}
            disabled={isProbingHealth}
            className="px-3 py-1 rounded text-xs font-bold bg-white text-rose-950 hover:bg-rose-100 disabled:opacity-60 transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isProbingHealth ? 'animate-spin' : ''}`} />
            <span>CHECK AGAIN</span>
          </button>
        </div>
      )}

      {/* API health panel */}
      <div className={`p-4 sm:p-5 space-y-4 ${cardCls}`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-inherit">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded ${
              isOutage ? 'bg-rose-950 text-rose-400 border border-rose-800'
                : isDark ? 'bg-blue-950/80 text-blue-400 border border-blue-900' : 'bg-blue-50 text-blue-700 border border-blue-200'
            }`}>
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm tracking-tight font-sans">Ops API health</div>
              <p className={`text-xs font-mono mt-0.5 ${muted}`}>
                This browser polls <code className="text-blue-400 font-bold">GET {apiHealth.endpoint}</code> every 15 seconds
              </p>
            </div>
          </div>
          <button
            onClick={handleManualHealthProbe}
            disabled={isProbingHealth}
            className={`px-3 py-1.5 rounded text-xs font-mono font-medium transition-colors border cursor-pointer flex items-center gap-1.5 disabled:opacity-60 ${
              isDark ? 'bg-[#162033] hover:bg-[#1D2B44] text-slate-200 border-[#23334E]' : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 text-blue-500 ${isProbingHealth ? 'animate-spin' : ''}`} />
            <span>CHECK NOW</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
          <div className={subCardCls}>
            <div className="text-[10px] uppercase text-slate-400">Status</div>
            <div className={`text-sm font-bold mt-0.5 ${healthTone}`}>{hasChecked ? apiHealth.status : '—'}</div>
            <div className="text-[9px] text-slate-400 mt-0.5">Round-trip: {hasChecked ? `${apiHealth.latencyMs}ms` : '—'}</div>
          </div>
          <div className={subCardCls}>
            <div className="text-[10px] uppercase text-slate-400">Last checked</div>
            <div className={`text-xs font-bold mt-0.5 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{fmtDateTime(apiHealth.lastChecked) ?? '—'}</div>
          </div>
          <div className={subCardCls}>
            <div className="text-[10px] uppercase text-slate-400">Server version</div>
            <div className={`text-xs font-bold mt-0.5 truncate ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{details?.version || '—'}</div>
            <div className="text-[9px] text-slate-400 mt-0.5 truncate">{details?.environment || '—'}</div>
          </div>
          <div className={subCardCls}>
            <div className="text-[10px] uppercase text-slate-400">Server uptime</div>
            <div className={`text-xs font-bold mt-0.5 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{fmtUptime(details?.uptimeSeconds)}</div>
          </div>
        </div>

        {details?.checks && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 font-mono text-[11px]">
            {Object.entries(details.checks).map(([k, v]) => (
              <div key={k} className={`flex justify-between gap-2 px-2.5 py-1.5 rounded border ${isDark ? 'bg-[#0B0F17] border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                <span className="text-slate-400">{k}</span>
                <span className={`font-semibold truncate ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{String(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SMTP warning */}
      {smtpMissing && (hasEmailChannel || editor?.draft.type === 'EMAIL') && (
        <div className={`p-3 rounded border text-xs font-mono flex items-start gap-2 ${
          isDark ? 'bg-amber-950/40 border-amber-800 text-amber-200' : 'bg-amber-50 border-amber-300 text-amber-800'
        }`}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            SMTP is not configured on the Ops server, so EMAIL channels cannot deliver. Set the SMTP environment variables on the server and restart it.
          </span>
        </div>
      )}

      {/* Channels */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className={`text-xs font-bold uppercase tracking-wider font-mono ${muted}`}>
            Notification Channels ({communicationChannels.length})
          </h2>
          {isAdmin && !editor && (
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add channel</span>
            </button>
          )}
        </div>

        {editor && (
          <form onSubmit={submitChannel} className={`p-4 space-y-3 font-mono text-xs ${cardCls}`}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm">{editor.id ? 'Edit channel' : 'New channel'}</span>
              <button type="button" onClick={() => setEditor(null)} className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Name *</label>
                <input
                  className={inputCls}
                  required
                  maxLength={120}
                  value={editor.draft.name}
                  placeholder="e.g. Ops on-call Teams"
                  onChange={e => setEditor({ ...editor, draft: { ...editor.draft, name: e.target.value } })}
                />
              </div>
              <div>
                <label className={labelCls}>Type</label>
                <select
                  className={inputCls}
                  value={editor.draft.type}
                  onChange={e => setEditor({ ...editor, draft: { ...editor.draft, type: e.target.value as ChannelType } })}
                >
                  {CHANNEL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>{typeMeta(editor.draft.type).targetLabel} *</label>
              <input
                className={inputCls}
                required
                maxLength={2000}
                value={editor.draft.targetEndpoint}
                placeholder={typeMeta(editor.draft.type).placeholder}
                onChange={e => setEditor({ ...editor, draft: { ...editor.draft, targetEndpoint: e.target.value } })}
              />
              <p className={`mt-1 text-[11px] font-sans ${muted}`}>{typeMeta(editor.draft.type).help}</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editor.draft.enabled}
                onChange={e => setEditor({ ...editor, draft: { ...editor.draft, enabled: e.target.checked } })}
              />
              <span>Enabled</span>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditor(null)} className={secondaryBtn}>Cancel</button>
              <button
                type="submit"
                disabled={busy === 'editor' || !editor.draft.name.trim() || !editor.draft.targetEndpoint.trim()}
                className="px-3 py-1 rounded text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer"
              >
                {busy === 'editor' ? 'Saving…' : editor.id ? 'Save changes' : 'Create channel'}
              </button>
            </div>
          </form>
        )}

        {communicationChannels.length === 0 ? (
          <EmptyState
            icon={Radio}
            title="No notification channels"
            description={isAdmin
              ? 'Add a Teams, webhook/Slack, email or PagerDuty channel so incidents reach your team.'
              : 'An IT administrator has not configured any channels yet, so incident alerts are not delivered anywhere.'}
            action={isAdmin && !editor ? { label: 'Add channel', onClick: openCreate } : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 font-mono text-xs">
            {communicationChannels.map(ch => {
              const lastDelivery = fmtDateTime(ch.lastDeliveryAt);
              const statusColor = ch.lastDeliveryStatus === 'DELIVERED' ? 'text-emerald-500' : ch.lastDeliveryStatus === 'FAILED' ? 'text-rose-500' : 'text-slate-400';
              const confirming = confirmDeleteId === ch.id;

              return (
                <div key={ch.id} className={`p-4 space-y-3 flex flex-col justify-between ${cardCls} ${ch.enabled ? '' : 'opacity-70'}`}>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold font-sans text-sm truncate">{ch.name}</span>
                      <span className="text-[10px] text-blue-500 font-semibold uppercase shrink-0">{typeMeta(ch.type).label}</span>
                    </div>

                    <div className={`mt-2.5 text-[11px] break-all p-2 rounded border ${
                      isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2436]' : 'bg-slate-50 text-slate-600 border-slate-200'
                    }`}>
                      {typeMeta(ch.type).targetLabel}: {ch.targetEndpoint || '—'}
                    </div>

                    <div className={`mt-2.5 text-[11px] space-y-1 ${muted}`}>
                      <div className="flex justify-between">
                        <span>Status:</span>
                        <strong className={ch.enabled ? 'text-emerald-500' : 'text-slate-500'}>{ch.enabled ? 'ENABLED' : 'DISABLED'}</strong>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span>Last delivery:</span>
                        <span className={`text-right ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                          {lastDelivery ? <>{lastDelivery} <span className={statusColor}>({ch.lastDeliveryStatus})</span></> : 'Never'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Failures:</span>
                        <span className={ch.failureCount > 0 ? 'text-rose-500 font-semibold' : ''}>{ch.failureCount ?? 0}</span>
                      </div>
                    </div>
                    {ch.type === 'EMAIL' && smtpMissing && (
                      <div className="mt-2 text-[10px] text-amber-500">SMTP not configured — this channel cannot deliver.</div>
                    )}
                  </div>

                  <div className="space-y-2 mt-2">
                    {isOperator && (
                      <button
                        onClick={() => withBusy(`test:${ch.id}`, () => sendTestNotification(ch.id))}
                        disabled={busy !== null || !ch.enabled}
                        title={ch.enabled ? 'Send a test notification' : 'Enable the channel to test it'}
                        className={`w-full py-1.5 ${secondaryBtn}`}
                      >
                        <Send className={`w-3 h-3 ${busy === `test:${ch.id}` ? 'animate-pulse text-blue-500' : ''}`} />
                        <span>{busy === `test:${ch.id}` ? 'SENDING…' : 'SEND TEST'}</span>
                      </button>
                    )}
                    {isAdmin && (
                      confirming ? (
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-rose-500 flex-1">Delete this channel?</span>
                          <button
                            onClick={() => withBusy(`del:${ch.id}`, async () => { if (await deleteChannel(ch.id)) setConfirmDeleteId(null); })}
                            disabled={busy !== null}
                            className="px-2 py-1 rounded text-[11px] font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white cursor-pointer"
                          >
                            {busy === `del:${ch.id}` ? 'Deleting…' : 'Delete'}
                          </button>
                          <button onClick={() => setConfirmDeleteId(null)} className={secondaryBtn}>Cancel</button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            onClick={() => withBusy(`toggle:${ch.id}`, () => updateChannel(ch.id, { enabled: !ch.enabled }))}
                            disabled={busy !== null}
                            className={secondaryBtn}
                          >
                            <Power className="w-3 h-3" />
                            <span>{busy === `toggle:${ch.id}` ? '…' : ch.enabled ? 'Disable' : 'Enable'}</span>
                          </button>
                          <button onClick={() => openEdit(ch)} disabled={busy !== null} className={secondaryBtn}>
                            <Pencil className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                          <button onClick={() => setConfirmDeleteId(ch.id)} disabled={busy !== null} className={`${secondaryBtn} text-rose-500`}>
                            <Trash2 className="w-3 h-3" />
                            <span>Delete</span>
                          </button>
                        </div>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Escalation policies */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className={`text-xs font-bold uppercase tracking-wider font-mono ${muted}`}>Escalation Policies</h2>
          {isAdmin && (
            <div className="flex items-center gap-2">
              {policyDirty && (
                <button onClick={discardPolicies} disabled={savingPolicies} className={secondaryBtn}>Discard</button>
              )}
              <button
                onClick={savePolicies}
                disabled={!policyDirty || savingPolicies}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingPolicies ? 'Saving…' : 'Save policies'}</span>
              </button>
            </div>
          )}
        </div>

        <div className={`p-3 rounded border text-xs font-mono flex items-start gap-2.5 ${
          isDark ? 'bg-[#0E1524] border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
        }`}>
          <Bell className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <div className="leading-relaxed font-sans">
            When an incident opens or resolves, the channels selected for its severity are notified. <strong>If no channels are selected for a severity, ALL enabled channels are notified.</strong>{' '}
            The repeat interval re-sends the alert every N minutes while the incident stays unacknowledged (0 = no repeats).
          </div>
        </div>

        <div className={`overflow-hidden ${cardCls}`}>
          <div className="w-full min-w-0 overflow-x-auto">
            <table className="w-full text-left text-xs font-mono min-w-[600px]">
              <thead className={`font-medium border-b ${
                isDark ? 'bg-[#0B0F17] text-slate-400 border-[#1A2332]' : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}>
                <tr>
                  <th className="py-2.5 px-3.5">Severity</th>
                  <th className="py-2.5 px-3.5">Channels notified</th>
                  <th className="py-2.5 px-3.5 w-48">Repeat while unacknowledged</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
                {SEVERITIES.map(sev => {
                  const d = policyDraft[sev];
                  const selected = d.channels.filter(id => communicationChannels.some(c => c.id === id));
                  return (
                    <tr key={sev} className={isDark ? 'hover:bg-[#151D2E]' : 'hover:bg-slate-50'}>
                      <td className="py-2.5 px-3.5 font-bold align-top">
                        <span className={
                          sev === 'CRITICAL' || sev === 'EMERGENCY' ? 'text-rose-500'
                            : sev === 'HIGH' ? 'text-orange-500'
                              : sev === 'WARNING' ? 'text-amber-500' : 'text-blue-500'
                        }>
                          {sev}
                        </span>
                      </td>
                      <td className={`py-2.5 px-3.5 align-top ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                        {communicationChannels.length === 0 ? (
                          <span className="text-slate-500">No channels configured</span>
                        ) : isAdmin ? (
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            {communicationChannels.map(ch => (
                              <label key={ch.id} className={`flex items-center gap-1.5 cursor-pointer ${ch.enabled ? '' : 'opacity-60'}`}>
                                <input
                                  type="checkbox"
                                  checked={d.channels.includes(ch.id)}
                                  onChange={() => togglePolicyChannel(sev, ch.id)}
                                  disabled={savingPolicies}
                                />
                                <span>{ch.name}{ch.enabled ? '' : ' (disabled)'}</span>
                              </label>
                            ))}
                            {selected.length === 0 && <span className="text-slate-500 italic">→ all enabled channels</span>}
                          </div>
                        ) : selected.length === 0 ? (
                          <span className="text-slate-500 italic">All enabled channels</span>
                        ) : (
                          selected.map(id => communicationChannels.find(c => c.id === id)?.name ?? id).join(', ')
                        )}
                      </td>
                      <td className={`py-2.5 px-3.5 align-top ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        {isAdmin ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={0}
                              max={1440}
                              value={d.repeatIntervalMin}
                              onChange={e => setPolicyRepeat(sev, e.target.value)}
                              disabled={savingPolicies}
                              className={`${inputCls} w-20 py-1`}
                            />
                            <span>min</span>
                          </div>
                        ) : d.repeatIntervalMin > 0 ? `Every ${d.repeatIntervalMin} min` : 'No repeats'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>
  );
};
