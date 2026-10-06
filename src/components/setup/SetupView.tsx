import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Server, Globe, ShieldCheck, Mail, HeartPulse, Link2, CheckCircle2, Circle, Plus, Pencil, Trash2, Terminal,
  Copy, RefreshCw, KeyRound, Activity, Layers, Bell, Wrench, X, AlertTriangle,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import { useAuth } from '../../context/AuthContext';
import { api, AgentInstallInfo } from '../../services/api';
import { Application, VpsServer } from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Small shared UI helpers (match the rest of the dashboard's look)
// ─────────────────────────────────────────────────────────────────────────────
const useStyles = () => {
  const { theme } = useOps();
  const isDark = theme === 'dark';
  return {
    isDark,
    card: `rounded-lg border p-4 ${isDark ? 'bg-[#111726] border-[#1E293B]' : 'bg-white border-slate-200 shadow-xs'}`,
    muted: isDark ? 'text-slate-400' : 'text-slate-600',
    faint: isDark ? 'text-slate-500' : 'text-slate-400',
    input: `w-full px-2.5 py-1.5 rounded border text-xs font-mono outline-none focus:ring-1 focus:ring-blue-500 ${
      isDark ? 'bg-[#0B0F17] border-[#1E293B] text-slate-100 placeholder:text-slate-600' : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400'
    }`,
    btn: 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    ghost: isDark ? 'bg-[#162033] hover:bg-[#1D2B44] text-slate-200 border border-[#23334E]' : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300',
    danger: isDark ? 'bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-900' : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300',
    code: `px-1 rounded ${isDark ? 'bg-[#1A2436] text-emerald-300' : 'bg-slate-100 text-emerald-700'}`,
  };
};

const statusColor = (s: string) =>
  s === 'HEALTHY' || s === 'CONNECTED' ? 'text-emerald-500'
    : s === 'WARNING' || s === 'STALE' ? 'text-amber-500'
      : s === 'CRITICAL' || s === 'DISCONNECTED' ? 'text-rose-500' : 'text-slate-400';

const timeAgo = (iso: string | null | undefined) => {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'never';
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
};

const Label: React.FC<{ text: string; hint?: string; children: React.ReactNode }> = ({ text, hint, children }) => {
  const st = useStyles();
  return (
    <label className="block space-y-1">
      <span className={`text-[10px] uppercase tracking-wider font-mono ${st.muted}`}>{text}</span>
      {children}
      {hint && <span className={`block text-[10px] ${st.faint}`}>{hint}</span>}
    </label>
  );
};

const CopyBox: React.FC<{ value: string }> = ({ value }) => {
  const st = useStyles();
  const { notify } = useOps();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      notify('success', 'Copied to clipboard');
    } catch {
      notify('error', 'Clipboard not available — select the text and copy manually');
    }
  };
  return (
    <div className={`flex items-start gap-2 p-2 rounded border font-mono text-[11px] ${st.isDark ? 'bg-[#070A10] border-[#1E293B] text-emerald-300' : 'bg-slate-50 border-slate-300 text-emerald-800'}`}>
      <code className="flex-1 break-all select-all">{value}</code>
      <button onClick={copy} className={`${st.faint} hover:text-blue-500 cursor-pointer shrink-0`} title="Copy"><Copy className="w-3.5 h-3.5" /></button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Integrations
// ─────────────────────────────────────────────────────────────────────────────
const IntegrationsPanel: React.FC = () => {
  const st = useStyles();
  const { integrations, deadMan, syncCloudflare, syncHostinger } = useOps();
  const { canDo } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  if (!integrations) return null;

  const wrap = async (key: string, fn: () => Promise<boolean>) => {
    setBusy(key);
    try { await fn(); } finally { setBusy(null); }
  };

  const publicUrlMissing = integrations.publicUrl.includes('localhost') || integrations.publicUrl.includes('127.0.0.1');

  const items = [
    {
      key: 'cloudflare', icon: ShieldCheck, title: 'Cloudflare', ok: integrations.cloudflare.configured && !integrations.cloudflare.lastError,
      configured: integrations.cloudflare.configured,
      detail: !integrations.cloudflare.configured
        ? <>Set <code className={st.code}>CLOUDFLARE_API_TOKEN</code> (Zone:Read + DNS:Edit) in <code className={st.code}>.env</code> and restart.</>
        : integrations.cloudflare.lastError
          ? <span className="text-rose-500">{integrations.cloudflare.lastError}</span>
          : <>{integrations.cloudflare.zoneCount} zone(s) · synced {timeAgo(integrations.cloudflare.lastSyncAt)}</>,
      action: integrations.cloudflare.configured && canDo('sync_providers') ? () => wrap('cloudflare', syncCloudflare) : undefined,
    },
    {
      key: 'hostinger', icon: Server, title: 'Hostinger API', ok: integrations.hostinger.configured && !integrations.hostinger.lastError,
      configured: integrations.hostinger.configured,
      detail: !integrations.hostinger.configured
        ? <>Optional. Set <code className={st.code}>HOSTINGER_API_TOKEN</code> to import plan / CPU / RAM / state.</>
        : integrations.hostinger.lastError
          ? <span className="text-rose-500">{integrations.hostinger.lastError}</span>
          : <>{integrations.hostinger.vmCount} VM(s) · synced {timeAgo(integrations.hostinger.lastSyncAt)}</>,
      action: integrations.hostinger.configured && canDo('sync_providers') ? () => wrap('hostinger', syncHostinger) : undefined,
    },
    {
      key: 'smtp', icon: Mail, title: 'Email (SMTP)', ok: integrations.smtp.configured, configured: integrations.smtp.configured,
      detail: integrations.smtp.configured ? <>Email channels can deliver.</> : <>Optional. Set <code className={st.code}>SMTP_HOST</code>, <code className={st.code}>SMTP_FROM</code> (+ user/pass) for email alerts.</>,
    },
    {
      key: 'deadman', icon: HeartPulse, title: 'Dead-man heartbeat', ok: deadMan.status === 'HEALTHY', configured: integrations.deadMan.configured,
      detail: !integrations.deadMan.configured
        ? <>Recommended. Set <code className={st.code}>DEADMAN_HEARTBEAT_URL</code> (e.g. healthchecks.io ping URL) so you are alerted if this Ops server itself dies.</>
        : <>{deadMan.status} · last ping {timeAgo(deadMan.lastHeartbeatReceivedAt)}</>,
    },
    {
      key: 'url', icon: Link2, title: 'Public URL', ok: !publicUrlMissing, configured: !publicUrlMissing,
      detail: publicUrlMissing
        ? <>Agents use <code className={st.code}>{integrations.publicUrl}</code> — set <code className={st.code}>PUBLIC_URL</code> to the address your VPS can reach (e.g. https://ops.example.com).</>
        : <><code className={st.code}>{integrations.publicUrl}</code></>,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {items.map(it => {
        const Icon = it.icon;
        return (
          <div key={it.key} className={st.card}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold font-mono">
                <Icon className="w-4 h-4 text-blue-500" />
                {it.title}
              </div>
              <span className={`text-[10px] font-mono font-bold ${it.ok ? 'text-emerald-500' : it.configured ? 'text-rose-500' : 'text-amber-500'}`}>
                {it.ok ? 'CONNECTED' : it.configured ? 'ERROR' : 'NOT SET'}
              </span>
            </div>
            <p className={`text-[11px] mt-2 leading-relaxed ${st.muted}`}>{it.detail}</p>
            {it.action && (
              <button onClick={it.action} disabled={busy === it.key} className={`${st.btn} ${st.ghost} mt-3`}>
                <RefreshCw className={`w-3 h-3 ${busy === it.key ? 'animate-spin' : ''}`} /> Sync now
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Getting-started checklist (computed from real state)
// ─────────────────────────────────────────────────────────────────────────────
const Checklist: React.FC = () => {
  const st = useStyles();
  const navigate = useNavigate();
  const { servers, applications, monitors, communicationChannels, integrations } = useOps();
  const steps = [
    { done: servers.length > 0, label: 'Register your PRD and DR VPS servers', where: 'below' },
    { done: servers.some(s => s.lastSeen), label: 'Install the telemetry agent on each server', where: 'below' },
    { done: applications.length > 0, label: 'Create an application linking PRD + DR servers', where: 'below' },
    { done: Boolean(integrations?.cloudflare.configured) && applications.some(a => a.dnsRecordName), label: 'Connect Cloudflare and set the failover DNS record', where: 'below' },
    { done: monitors.length > 0, label: 'Add health monitors (HTTP / TCP / SSL)', where: '/monitors' },
    { done: communicationChannels.length > 0, label: 'Add a notification channel (Teams / Email / Webhook)', where: '/communications' },
  ];
  const doneCount = steps.filter(s => s.done).length;
  return (
    <div className={st.card}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold font-mono uppercase tracking-wider">Getting started</h2>
        <span className={`text-[11px] font-mono ${doneCount === steps.length ? 'text-emerald-500' : st.muted}`}>{doneCount}/{steps.length} complete</span>
      </div>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-xs">
            {s.done ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <Circle className={`w-4 h-4 shrink-0 ${st.faint}`} />}
            <span className={s.done ? `${st.muted} line-through` : ''}>{i + 1}. {s.label}</span>
            {!s.done && s.where !== 'below' && (
              <button onClick={() => navigate(s.where)} className="text-[11px] text-blue-500 hover:underline cursor-pointer">open</button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Servers
// ─────────────────────────────────────────────────────────────────────────────
type ServerForm = { hostname: string; ip: string; environment: 'PRD' | 'DR'; provider: string; region: string; plan: string; notes: string };
const EMPTY_SERVER: ServerForm = { hostname: '', ip: '', environment: 'PRD', provider: 'Hostinger', region: '', plan: '', notes: '' };

const ServerEditor: React.FC<{ initial?: VpsServer; onDone: () => void }> = ({ initial, onDone }) => {
  const st = useStyles();
  const { createServer, updateServer } = useOps();
  const [form, setForm] = useState<ServerForm>(initial
    ? { hostname: initial.hostname, ip: initial.ip, environment: initial.environment, provider: initial.provider, region: initial.region === 'Unknown' ? '' : initial.region, plan: initial.plan, notes: initial.notes ?? '' }
    : EMPTY_SERVER);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ServerForm>(k: K, v: ServerForm[K]) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = { ...form, hostname: form.hostname.trim(), ip: form.ip.trim() };
    const res = initial ? await updateServer(initial.id, payload) : await createServer(payload);
    setSaving(false);
    if (res) onDone();
  };

  return (
    <form onSubmit={submit} className={`${st.card} space-y-3`}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold font-mono uppercase">{initial ? `Edit ${initial.hostname}` : 'Register a VPS server'}</h3>
        <button type="button" onClick={onDone} className={`${st.faint} hover:text-rose-500 cursor-pointer`}><X className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Label text="Hostname *" hint="e.g. prd-1.example.com"><input className={st.input} value={form.hostname} onChange={e => set('hostname', e.target.value)} required /></Label>
        <Label text="Public IP *" hint="IPv4 or IPv6 of the VPS"><input className={st.input} value={form.ip} onChange={e => set('ip', e.target.value)} required /></Label>
        <Label text="Role *">
          <select className={st.input} value={form.environment} onChange={e => set('environment', e.target.value as 'PRD' | 'DR')}>
            <option value="PRD">PRD — primary / main</option>
            <option value="DR">DR — disaster recovery / standby</option>
          </select>
        </Label>
        <Label text="Provider"><input className={st.input} value={form.provider} onChange={e => set('provider', e.target.value)} /></Label>
        <Label text="Region / data center"><input className={st.input} value={form.region} onChange={e => set('region', e.target.value)} placeholder="e.g. Mumbai" /></Label>
        <Label text="Plan"><input className={st.input} value={form.plan} onChange={e => set('plan', e.target.value)} placeholder="e.g. KVM 4" /></Label>
      </div>
      <Label text="Notes"><textarea className={st.input} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></Label>
      <p className={`text-[10px] ${st.faint}`}>CPU, RAM, disk, OS and uptime are filled in automatically by the telemetry agent (and the Hostinger API if configured).</p>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className={`${st.btn} ${st.primary}`}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Register server'}</button>
        <button type="button" onClick={onDone} className={`${st.btn} ${st.ghost}`}>Cancel</button>
      </div>
    </form>
  );
};

const AgentPanel: React.FC<{ server: VpsServer; onClose: () => void }> = ({ server, onClose }) => {
  const st = useStyles();
  const { notify } = useOps();
  const [info, setInfo] = useState<AgentInstallInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const load = async () => {
    try {
      setInfo(await api.getAgentInstall(server.id));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  useEffect(() => { void load(); }, [server.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rotate = async () => {
    if (!window.confirm(`Rotate the agent token for ${server.hostname}? The currently installed agent will stop reporting until you re-run the install command.`)) return;
    setRotating(true);
    try {
      await api.rotateAgentToken(server.id);
      notify('success', 'Agent token rotated — re-run the install command on the server');
      await load();
    } catch (err) {
      notify('error', (err as Error).message);
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className={`${st.card} space-y-3`}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold font-mono uppercase flex items-center gap-2"><Terminal className="w-4 h-4 text-blue-500" /> Telemetry agent · {server.hostname}</h3>
        <button onClick={onClose} className={`${st.faint} hover:text-rose-500 cursor-pointer`}><X className="w-4 h-4" /></button>
      </div>
      {error && <div className="text-xs text-rose-500">{error}</div>}
      {info && (
        <>
          {!info.publicUrlConfigured && (
            <div className="flex items-start gap-2 text-[11px] text-amber-500">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              PUBLIC_URL is not set on the Ops server, so this command uses the address in your browser. Make sure the VPS can reach it, or set PUBLIC_URL in .env.
            </div>
          )}
          <p className={`text-[11px] ${st.muted}`}>1. SSH into <b>{server.ip}</b> as root (or a sudo user) and run:</p>
          <CopyBox value={info.installCommand} />
          <p className={`text-[11px] ${st.muted}`}>
            It installs a small Python 3 agent as the <code className={st.code}>scholario-agent</code> systemd service. It reports CPU, RAM, disk, load, network, top processes,
            service states (nginx, mysql, …) and warning/error logs every 10 seconds. Check it with <code className={st.code}>journalctl -u scholario-agent -f</code>.
          </p>
          <p className={`text-[11px] ${st.muted}`}>2. Status here switches to <b className="text-emerald-500">CONNECTED</b> within ~15 seconds. Current: <b className={statusColor(server.agentStatus)}>{server.agentStatus}</b> (last report {timeAgo(server.lastSeen)}).</p>
          <details className={`text-[11px] ${st.muted}`}>
            <summary className="cursor-pointer">Uninstall</summary>
            <div className="mt-2"><CopyBox value={info.uninstallCommand} /></div>
          </details>
          <button onClick={rotate} disabled={rotating} className={`${st.btn} ${st.danger}`}><KeyRound className="w-3 h-3" /> {rotating ? 'Rotating…' : 'Rotate agent token'}</button>
        </>
      )}
      {!info && !error && <div className={`text-xs ${st.muted} animate-pulse`}>Loading install command…</div>}
    </div>
  );
};

const PortCheck: React.FC<{ server: VpsServer }> = ({ server }) => {
  const st = useStyles();
  const [results, setResults] = useState<Record<number, { open: boolean; latencyMs: number; error?: string } | 'pending'>>({});
  const ports = [22, 80, 443];
  const check = async () => {
    setResults(Object.fromEntries(ports.map(p => [p, 'pending'])));
    await Promise.all(ports.map(async p => {
      try {
        const r = await api.tcpTest(server.ip, p);
        setResults(prev => ({ ...prev, [p]: r }));
      } catch (err) {
        setResults(prev => ({ ...prev, [p]: { open: false, latencyMs: 0, error: (err as Error).message } }));
      }
    }));
  };
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button onClick={check} className={`${st.btn} ${st.ghost} !px-2 !py-0.5 !text-[10px]`}>Check ports</button>
      {ports.map(p => {
        const r = results[p];
        if (!r) return null;
        return (
          <span key={p} className={`text-[10px] font-mono ${r === 'pending' ? st.faint : r.open ? 'text-emerald-500' : 'text-rose-500'}`} title={r !== 'pending' ? r.error : undefined}>
            :{p} {r === 'pending' ? '…' : r.open ? `open ${r.latencyMs}ms` : 'closed'}
          </span>
        );
      })}
    </div>
  );
};

const ServersSection: React.FC = () => {
  const st = useStyles();
  const { servers, applications, deleteServer } = useOps();
  const { canDo } = useAuth();
  const [editing, setEditing] = useState<VpsServer | 'new' | null>(null);
  const [agentFor, setAgentFor] = useState<string | null>(null);
  const isAdmin = canDo('create_server');

  const remove = async (s: VpsServer) => {
    const used = applications.filter(a => a.prdServerId === s.id || a.drServerId === s.id);
    if (used.length) {
      window.alert(`${s.hostname} is used by ${used.map(a => a.name).join(', ')}. Change those applications first.`);
      return;
    }
    if (!window.confirm(`Remove ${s.hostname} (${s.ip})? Its monitors and metrics history are deleted too.`)) return;
    await deleteServer(s.id);
  };

  const agentServer = servers.find(s => s.id === agentFor);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold font-mono flex items-center gap-2"><Server className="w-4 h-4 text-blue-500" /> VPS SERVERS ({servers.length})</h2>
        {isAdmin && editing === null && <button onClick={() => setEditing('new')} className={`${st.btn} ${st.primary}`}><Plus className="w-3.5 h-3.5" /> Add server</button>}
      </div>

      {editing && <ServerEditor key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      {agentServer && <AgentPanel server={agentServer} onClose={() => setAgentFor(null)} />}

      {servers.length === 0 ? (
        <div className={`${st.card} text-center text-xs ${st.muted} py-8`}>
          No servers registered yet. {isAdmin ? 'Click "Add server" and enter your Main (PRD) VPS, then your DR VPS.' : 'Ask an administrator to register the VPS servers.'}
        </div>
      ) : (
        <div className={`${st.card} !p-0 overflow-x-auto`}>
          <table className="w-full text-xs font-mono min-w-[860px]">
            <thead className={`text-left ${st.isDark ? 'bg-[#0B0F17] text-slate-400' : 'bg-slate-50 text-slate-600'}`}>
              <tr>
                <th className="py-2 px-3">Server</th>
                <th className="py-2 px-3">Role</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Agent</th>
                <th className="py-2 px-3">CPU / RAM / Disk</th>
                <th className="py-2 px-3">Connectivity</th>
                <th className="py-2 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${st.isDark ? 'divide-[#172030]' : 'divide-slate-100'}`}>
              {servers.map(s => (
                <tr key={s.id}>
                  <td className="py-2 px-3">
                    <div className="font-semibold">{s.hostname}</div>
                    <div className={st.faint}>{s.ip} · {s.provider}{s.region && s.region !== 'Unknown' ? ` · ${s.region}` : ''}</div>
                  </td>
                  <td className="py-2 px-3"><span className={s.environment === 'PRD' ? 'text-blue-400 font-bold' : 'text-purple-400 font-bold'}>{s.environment}</span></td>
                  <td className={`py-2 px-3 font-bold ${statusColor(s.status)}`}>{s.status}</td>
                  <td className="py-2 px-3">
                    <div className={`font-bold ${statusColor(s.agentStatus)}`}>{s.agentStatus}</div>
                    <div className={st.faint}>{s.lastSeen ? `${timeAgo(s.lastSeen)} · v${s.agentVersion || '?'}` : 'never reported'}</div>
                  </td>
                  <td className="py-2 px-3 tabular-nums">
                    {s.lastSeen ? `${s.telemetry.cpuPercent}% / ${s.telemetry.ramPercent}% / ${s.telemetry.diskPercent}%` : <span className={st.faint}>—</span>}
                  </td>
                  <td className="py-2 px-3">{canDo('run_probe') ? <PortCheck server={s} /> : <span className={st.faint}>—</span>}</td>
                  <td className="py-2 px-3">
                    <div className="flex justify-end gap-1.5">
                      {isAdmin && <button onClick={() => setAgentFor(s.id)} className={`${st.btn} ${st.ghost} !px-2`} title="Install agent"><Terminal className="w-3.5 h-3.5" /> Agent</button>}
                      {isAdmin && <button onClick={() => setEditing(s)} className={`${st.btn} ${st.ghost} !px-2`} title="Edit"><Pencil className="w-3.5 h-3.5" /></button>}
                      {isAdmin && <button onClick={() => remove(s)} className={`${st.btn} ${st.danger} !px-2`} title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Applications
// ─────────────────────────────────────────────────────────────────────────────
type AppForm = {
  name: string; codeName: string; description: string; tier: Application['tier'];
  rtoTargetMin: number; rpoTargetMin: number; prdServerId: string; drServerId: string;
  cloudflareZone: string; dnsRecordName: string; autoFailover: boolean;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const AppEditor: React.FC<{ initial?: Application; onDone: () => void }> = ({ initial, onDone }) => {
  const st = useStyles();
  const { servers, cloudflareZones, createApplication, updateApplication, addMonitor } = useOps();
  const [form, setForm] = useState<AppForm>(initial ? {
    name: initial.name, codeName: initial.codeName, description: initial.description, tier: initial.tier,
    rtoTargetMin: initial.rtoTargetMin, rpoTargetMin: initial.rpoTargetMin, prdServerId: initial.prdServerId, drServerId: initial.drServerId,
    cloudflareZone: initial.cloudflareZone, dnsRecordName: initial.dnsRecordName ?? '', autoFailover: Boolean(initial.autoFailover),
  } : {
    name: '', codeName: '', description: '', tier: 'TIER_1', rtoTargetMin: 30, rpoTargetMin: 15,
    prdServerId: servers.find(s => s.environment === 'PRD')?.id ?? '', drServerId: servers.find(s => s.environment === 'DR')?.id ?? '',
    cloudflareZone: '', dnsRecordName: '', autoFailover: false,
  });
  const [codeTouched, setCodeTouched] = useState(Boolean(initial));
  const [healthPath, setHealthPath] = useState('/health');
  const [mk, setMk] = useState({ prd: true, dr: true, pub: true, ssl: true });
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof AppForm>(k: K, v: AppForm[K]) => setForm(f => ({ ...f, [k]: v }));

  const prd = servers.find(s => s.id === form.prdServerId);
  const dr = servers.find(s => s.id === form.drServerId);
  const path = healthPath.startsWith('/') ? healthPath : `/${healthPath}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload: Partial<Application> = { ...form, codeName: form.codeName || slug(form.name), dnsRecordName: form.dnsRecordName.trim() || undefined };
    const app = initial ? await updateApplication(initial.id, payload) : await createApplication(payload);
    if (app && !initial) {
      // Optional starter monitors that probe each server directly and the public hostname
      const base = { applicationId: app.id, intervalSec: 30, timeoutSec: 10, retries: 2, failureConfirmationThreshold: 3, recoveryConfirmationThreshold: 2, warningThresholdMs: 1500, criticalThresholdMs: 8000 };
      if (mk.prd && prd) await addMonitor({ ...base, name: `${app.name} · PRD origin`, type: 'HTTP', target: `http://${prd.ip.includes(':') ? `[${prd.ip}]` : prd.ip}${path}`, environment: 'PRD', serverId: prd.id });
      if (mk.dr && dr) await addMonitor({ ...base, name: `${app.name} · DR origin`, type: 'HTTP', target: `http://${dr.ip.includes(':') ? `[${dr.ip}]` : dr.ip}${path}`, environment: 'DR', serverId: dr.id });
      if (mk.pub && app.dnsRecordName) await addMonitor({ ...base, name: `${app.name} · public ${app.dnsRecordName}`, type: 'HTTPS', target: `https://${app.dnsRecordName}${path}`, environment: 'PRD' });
      if (mk.ssl && app.dnsRecordName) await addMonitor({ ...base, name: `${app.name} · SSL certificate`, type: 'SSL', target: app.dnsRecordName, environment: 'PRD', intervalSec: 3600, timeoutSec: 15 });
    }
    setSaving(false);
    if (app) onDone();
  };

  return (
    <form onSubmit={submit} className={`${st.card} space-y-3`}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold font-mono uppercase">{initial ? `Edit ${initial.name}` : 'Create application'}</h3>
        <button type="button" onClick={onDone} className={`${st.faint} hover:text-rose-500 cursor-pointer`}><X className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Label text="Name *"><input className={st.input} value={form.name} required onChange={e => { set('name', e.target.value); if (!codeTouched) set('codeName', slug(e.target.value)); }} /></Label>
        <Label text="Code name *" hint="lower-case id used by CI / backup reports"><input className={st.input} value={form.codeName} required onChange={e => { setCodeTouched(true); set('codeName', e.target.value); }} /></Label>
        <Label text="Tier">
          <select className={st.input} value={form.tier} onChange={e => set('tier', e.target.value as Application['tier'])}>
            <option value="TIER_1">Tier 1 — critical</option><option value="TIER_2">Tier 2 — important</option><option value="TIER_3">Tier 3 — internal</option>
          </select>
        </Label>
        <Label text="PRD (main) server">
          <select className={st.input} value={form.prdServerId} onChange={e => set('prdServerId', e.target.value)}>
            <option value="">— none —</option>
            {servers.map(s => <option key={s.id} value={s.id}>{s.hostname} ({s.ip}) {s.environment}</option>)}
          </select>
        </Label>
        <Label text="DR (standby) server">
          <select className={st.input} value={form.drServerId} onChange={e => set('drServerId', e.target.value)}>
            <option value="">— none —</option>
            {servers.map(s => <option key={s.id} value={s.id}>{s.hostname} ({s.ip}) {s.environment}</option>)}
          </select>
        </Label>
        <div className="grid grid-cols-2 gap-2">
          <Label text="RTO (min)"><input type="number" min={1} className={st.input} value={form.rtoTargetMin} onChange={e => set('rtoTargetMin', Number(e.target.value))} /></Label>
          <Label text="RPO (min)"><input type="number" min={0} className={st.input} value={form.rpoTargetMin} onChange={e => set('rpoTargetMin', Number(e.target.value))} /></Label>
        </div>
        <Label text="Cloudflare zone (domain)" hint={cloudflareZones.length ? 'Zones found in your Cloudflare account are suggested' : 'e.g. example.com'}>
          <input className={st.input} list="cf-zones" value={form.cloudflareZone} onChange={e => set('cloudflareZone', e.target.value.trim().toLowerCase())} placeholder="example.com" />
          <datalist id="cf-zones">{cloudflareZones.map(z => <option key={z.id} value={z.domain} />)}</datalist>
        </Label>
        <Label text="Failover DNS record (A/AAAA)" hint="The record switched between PRD and DR IPs, e.g. app.example.com">
          <input className={st.input} value={form.dnsRecordName} onChange={e => set('dnsRecordName', e.target.value.trim().toLowerCase())} placeholder={form.cloudflareZone ? `app.${form.cloudflareZone}` : 'app.example.com'} />
        </Label>
        <label className="flex items-start gap-2 text-xs mt-5">
          <input type="checkbox" checked={form.autoFailover} onChange={e => set('autoFailover', e.target.checked)} className="mt-0.5" />
          <span>
            <b>Automatic failover</b>
            <span className={`block text-[10px] ${st.faint}`}>Switch DNS to DR when a PRD HTTP/TCP monitor is confirmed DOWN and all DR monitors are healthy (10 min cooldown). Failback is always manual.</span>
          </span>
        </label>
      </div>
      <Label text="Description"><textarea className={st.input} rows={2} value={form.description} onChange={e => set('description', e.target.value)} /></Label>

      {!initial && (
        <div className={`rounded border p-3 space-y-2 ${st.isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
          <div className="text-[10px] uppercase tracking-wider font-mono font-bold">Create starter monitors</div>
          <Label text="Health check path" hint="Must return HTTP 2xx on each server. Origin checks call the server IP directly, so your web server must answer that path for requests by IP.">
            <input className={st.input} value={healthPath} onChange={e => setHealthPath(e.target.value)} />
          </Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs font-mono">
            <label className="flex items-center gap-2"><input type="checkbox" checked={mk.prd} disabled={!prd} onChange={e => setMk(m => ({ ...m, prd: e.target.checked }))} /> PRD origin {prd ? `http://${prd.ip}${path}` : '(select PRD server)'}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={mk.dr} disabled={!dr} onChange={e => setMk(m => ({ ...m, dr: e.target.checked }))} /> DR origin {dr ? `http://${dr.ip}${path}` : '(select DR server)'}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={mk.pub} disabled={!form.dnsRecordName} onChange={e => setMk(m => ({ ...m, pub: e.target.checked }))} /> Public {form.dnsRecordName ? `https://${form.dnsRecordName}${path}` : '(set DNS record)'}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={mk.ssl} disabled={!form.dnsRecordName} onChange={e => setMk(m => ({ ...m, ssl: e.target.checked }))} /> SSL certificate expiry</label>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={saving} className={`${st.btn} ${st.primary}`}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Create application'}</button>
        <button type="button" onClick={onDone} className={`${st.btn} ${st.ghost}`}>Cancel</button>
      </div>
    </form>
  );
};

const ApplicationsSection: React.FC = () => {
  const st = useStyles();
  const navigate = useNavigate();
  const { applications, servers, monitors, cloudflareZones, deleteApplication } = useOps();
  const { canDo } = useAuth();
  const [editing, setEditing] = useState<Application | 'new' | null>(null);
  const isAdmin = canDo('create_application');

  const remove = async (a: Application) => {
    const n = monitors.filter(m => m.applicationId === a.id).length;
    if (!window.confirm(`Delete ${a.name}? Its ${n} monitor(s) are deleted too. DNS records in Cloudflare are not changed.`)) return;
    await deleteApplication(a.id);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold font-mono flex items-center gap-2"><Layers className="w-4 h-4 text-blue-500" /> APPLICATIONS ({applications.length})</h2>
        {isAdmin && editing === null && (
          <button onClick={() => setEditing('new')} disabled={servers.length === 0} className={`${st.btn} ${st.primary}`} title={servers.length === 0 ? 'Register servers first' : undefined}>
            <Plus className="w-3.5 h-3.5" /> Add application
          </button>
        )}
      </div>

      {editing && <AppEditor key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}

      {applications.length === 0 ? (
        <div className={`${st.card} text-center text-xs ${st.muted} py-8`}>
          No applications yet. An application ties a PRD server, a DR server and the Cloudflare DNS record that is switched on failover.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {applications.map(a => {
            const prd = servers.find(s => s.id === a.prdServerId);
            const dr = servers.find(s => s.id === a.drServerId);
            const zone = cloudflareZones.find(z => a.cloudflareZone && (a.cloudflareZone === z.domain || a.cloudflareZone.endsWith(`.${z.domain}`)));
            const record = zone?.dnsRecords.find(r => r.name === a.dnsRecordName && (r.type === 'A' || r.type === 'AAAA'));
            const appMonitors = monitors.filter(m => m.applicationId === a.id);
            return (
              <div key={a.id} className={`${st.card} space-y-2`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold">{a.name} <span className={`text-[10px] font-mono ${st.faint}`}>{a.codeName}</span></div>
                    <div className={`text-[11px] font-mono font-bold ${statusColor(a.status)}`}>{a.status} · {a.failoverState.replace('_', ' ')}</div>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1.5">
                      <button onClick={() => setEditing(a)} className={`${st.btn} ${st.ghost} !px-2`}><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => remove(a)} className={`${st.btn} ${st.danger} !px-2`}><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div><span className={st.faint}>PRD:</span> {prd ? `${prd.hostname} (${prd.ip})` : <span className="text-amber-500">not set</span>}</div>
                  <div><span className={st.faint}>DR:</span> {dr ? `${dr.hostname} (${dr.ip})` : <span className="text-amber-500">not set</span>}</div>
                  <div className="col-span-2">
                    <span className={st.faint}>DNS failover:</span>{' '}
                    {a.dnsRecordName
                      ? <>{a.dnsRecordName} → {record ? <b>{record.target}</b> : <span className={st.faint}>{zone ? 'record not found' : 'zone not synced'}</span>} {a.autoFailover ? <span className="text-emerald-500">(auto)</span> : <span className={st.faint}>(manual)</span>}</>
                      : <span className="text-amber-500">not configured</span>}
                  </div>
                  <div className="col-span-2"><span className={st.faint}>Monitors:</span> {appMonitors.length} ({appMonitors.filter(m => m.status === 'HEALTHY').length} healthy)
                    {' '}<button onClick={() => navigate('/monitors')} className="text-blue-500 hover:underline cursor-pointer">manage</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Live connection tools
// ─────────────────────────────────────────────────────────────────────────────
const ToolsSection: React.FC = () => {
  const st = useStyles();
  const [tool, setTool] = useState<'http' | 'tcp' | 'dns' | 'ssl'>('http');
  const [target, setTarget] = useState('');
  const [port, setPort] = useState('443');
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target.trim()) return;
    setBusy(true); setOutput(null); setOk(null);
    try {
      if (tool === 'http') {
        const r = await api.httpTest({ url: target.trim(), timeoutSec: 10 });
        setOk(r.expectedMatch);
        setOutput([
          r.reachable ? `HTTP ${r.statusCode} in ${r.latencyMs}ms` : `FAILED after ${r.latencyMs}ms: ${r.error}`,
          r.resolvedIp ? `Resolved IP: ${r.resolvedIp}` : '',
          r.headers?.server ? `Server: ${r.headers.server}` : '',
          r.headers?.['cf-ray'] ? `Served through Cloudflare (cf-ray ${r.headers['cf-ray']})` : '',
          '', r.responseSnippet,
        ].filter(x => x !== '').join('\n'));
      } else if (tool === 'tcp') {
        const r = await api.tcpTest(target.trim(), Number(port));
        setOk(r.open);
        setOutput(r.open ? `${r.host}:${r.port} is OPEN (${r.latencyMs}ms)` : `${r.host}:${r.port} is CLOSED/FILTERED — ${r.error}`);
      } else if (tool === 'dns') {
        const r = await api.dnsTest(target.trim());
        setOk(r.ok);
        setOutput(`${r.detail} (${r.latencyMs}ms)`);
      } else {
        const r = await api.sslTest(target.trim());
        setOk(r.ok && (r.daysLeft ?? 0) >= 14);
        setOutput([r.detail, r.validTo ? `Expires: ${new Date(r.validTo).toLocaleString()}` : '', r.protocol ? `Protocol: ${r.protocol}` : ''].filter(Boolean).join('\n'));
      }
    } catch (err) {
      setOk(false);
      setOutput((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const placeholder = tool === 'http' ? 'https://app.example.com/health or http://203.0.113.10/' : tool === 'tcp' ? '203.0.113.10' : 'app.example.com';

  return (
    <section className={`${st.card} space-y-3`}>
      <h2 className="text-sm font-bold font-mono flex items-center gap-2"><Wrench className="w-4 h-4 text-blue-500" /> LIVE CONNECTION TEST</h2>
      <p className={`text-[11px] ${st.muted}`}>Runs from the Ops server right now — nothing is saved. Use it to verify a VPS or URL before creating monitors.</p>
      <form onSubmit={run} className="flex flex-col sm:flex-row gap-2">
        <select className={`${st.input} sm:w-28`} value={tool} onChange={e => { setTool(e.target.value as typeof tool); setOutput(null); setOk(null); }}>
          <option value="http">HTTP(S)</option><option value="tcp">TCP port</option><option value="dns">DNS</option><option value="ssl">SSL cert</option>
        </select>
        <input className={st.input} value={target} onChange={e => setTarget(e.target.value)} placeholder={placeholder} />
        {tool === 'tcp' && <input className={`${st.input} sm:w-24`} value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ''))} placeholder="port" />}
        <button type="submit" disabled={busy || !target.trim()} className={`${st.btn} ${st.primary} justify-center`}><Activity className="w-3.5 h-3.5" /> {busy ? 'Testing…' : 'Run test'}</button>
      </form>
      {output !== null && (
        <pre className={`p-3 rounded border text-[11px] font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto ${
          ok ? (st.isDark ? 'border-emerald-900 bg-emerald-950/30 text-emerald-200' : 'border-emerald-300 bg-emerald-50 text-emerald-900')
            : (st.isDark ? 'border-rose-900 bg-rose-950/30 text-rose-200' : 'border-rose-300 bg-rose-50 text-rose-900')
        }`}>{output}</pre>
      )}
    </section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
export const SetupView: React.FC = () => {
  const st = useStyles();
  const navigate = useNavigate();
  const { canDo } = useAuth();
  const { communicationChannels } = useOps();
  const showChannelsHint = useMemo(() => communicationChannels.length === 0, [communicationChannels.length]);

  return (
    <div className="space-y-6">
      <div className={`pb-3 border-b ${st.isDark ? 'border-[#1E293B]' : 'border-slate-200'}`}>
        <h1 className="text-lg font-bold font-mono tracking-tight">SETUP &amp; CONNECTIONS</h1>
        <p className={`text-xs font-mono mt-0.5 ${st.muted}`}>
          Register your real VPS servers and applications, install the telemetry agent, connect Cloudflare DNS failover and verify connectivity.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2"><IntegrationsPanel /></div>
        <Checklist />
      </div>

      <ServersSection />
      <ApplicationsSection />
      {canDo('run_probe') && <ToolsSection />}

      {showChannelsHint && (
        <div className={`${st.card} flex items-center justify-between gap-3`}>
          <div className="flex items-center gap-2 text-xs"><Bell className="w-4 h-4 text-amber-500" /> No notification channels — incidents will only be visible in the dashboard.</div>
          <button onClick={() => navigate('/communications')} className={`${st.btn} ${st.ghost}`}><Globe className="w-3.5 h-3.5" /> Add channel</button>
        </div>
      )}
    </div>
  );
};
