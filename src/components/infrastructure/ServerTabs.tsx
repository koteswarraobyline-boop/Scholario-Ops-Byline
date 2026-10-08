/**
 * Tabs of the server details drawer (Infrastructure → Inspect). Every tab renders only what the
 * agent reported: missing data is shown as "Not reported" / "—", never as 0 or healthy.
 * Read-only by design: there are no restart / stop / kill actions anywhere in this UI.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import {
  VpsServer, AuditLog, PM2ProcessTelemetry, ApplicationHealthTelemetry, TelemetryLevel, FilesystemTelemetry, NetworkInterfaceTelemetry,
} from '../../types';
import { api } from '../../services/api';
import { THRESHOLDS, levelOf, worstLevel } from '../../lib/thresholds';
import { Ago } from '../ui/Freshness';
import {
  Banner, KV, LevelBadge, attentionText, NotReported, SectionTitle, UsageBar, fmtAgo, fmtBitRate, fmtBytesRate, fmtCount, fmtDateTime, fmtDuration,
  fmtKbps, fmtMb, fmtNum, fmtTime, levelText, ui, validDate,
} from './telemetryUi';
import { ServerMetricsPanel } from './ServerMetrics';

interface TabProps { server: VpsServer; isDark: boolean }

const reported = (s: VpsServer) => Boolean(s.lastSeen);
const needsAgent33 = 'Not reported — needs agent 3.3 (reinstall the agent from Setup).';
const agentLevel = (s: VpsServer): TelemetryLevel =>
  !s.lastSeen ? 'UNKNOWN' : s.agentStatus === 'CONNECTED' ? (s.agent?.outdated ? 'WARNING' : 'HEALTHY') : s.agentStatus === 'STALE' ? 'WARNING' : 'CRITICAL';
const agentLabel = (s: VpsServer) => (!s.lastSeen ? 'Never reported' : s.agentStatus === 'CONNECTED' ? 'Connected' : s.agentStatus === 'STALE' ? 'Stale' : 'Disconnected');

const pm2Level = (p: PM2ProcessTelemetry): TelemetryLevel => {
  if (p.status === 'errored') return 'CRITICAL';
  const r = levelOf(p.recentRestarts, THRESHOLDS.pm2Restarts);
  if (p.status !== 'online') return worstLevel(['WARNING', r === 'UNKNOWN' ? 'WARNING' : r]);
  return r === 'UNKNOWN' ? 'HEALTHY' : r;
};
const checkLevel = (c: ApplicationHealthTelemetry): TelemetryLevel =>
  c.status === 'DOWN' ? (c.consecutiveFailures >= THRESHOLDS.localHealthFailuresForAlert ? 'CRITICAL' : 'WARNING')
    : c.status === 'HEALTHY' ? (levelOf(c.latencyMs, THRESHOLDS.localHealthLatencyMs) === 'HEALTHY' ? 'HEALTHY' : 'WARNING') : 'UNKNOWN';

/** Banners shared by Overview and Agent */
const AgentBanners: React.FC<{ server: VpsServer }> = ({ server }) => {
  const a = server.agent;
  const timeWarnings = (server.warnings ?? []).filter(w => w.category === 'time');
  return (
    <>
      {server.lastSeen && server.agentStatus === 'DISCONNECTED' && <Banner level="CRITICAL" title="Agent disconnected">No report since {fmtDateTime(server.lastSeen)} — values below are the last known, not live.</Banner>}
      {server.agentStatus === 'STALE' && <Banner level="WARNING" title="Agent stale">Last report {fmtAgo(server.lastSeen)} — values below may be out of date.</Banner>}
      {a?.outdated && <Banner level="WARNING" title="Outdated agent">This server runs agent v{a.version}; the current version is v{a.expectedVersion}. Reinstall the agent from Setup to collect all telemetry.</Banner>}
      {timeWarnings.length > 0 && (
        <Banner level={timeWarnings.some(w => w.level === 'CRITICAL') ? 'CRITICAL' : 'WARNING'} title="Clock synchronization issue">
          {timeWarnings.map(w => w.message).join(' · ')}
        </Banner>
      )}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Overview
// ─────────────────────────────────────────────────────────────────────────────
export const OverviewTab: React.FC<TabProps & { onNavigateTab?: (tab: string) => void }> = ({ server, isDark, onNavigateTab }) => {
  const c = ui(isDark);
  const sys = server.system;
  const t = server.telemetry;
  const warnings = [...(server.warnings ?? [])].sort((a, b) => (a.level === b.level ? 0 : a.level === 'CRITICAL' ? -1 : 1));
  const CAT_TAB: Record<string, string> = { agent: 'agent', time: 'agent', cpu: 'resources', memory: 'resources', swap: 'resources', disk: 'storage', diskio: 'storage', network: 'network', systemd: 'services', pm2: 'applications', apps: 'applications', database: 'database' };
  return (
    <div className="space-y-4">
      <AgentBanners server={server} />
      <div className={c.card}>
        <SectionTitle isDark={isDark}>Server status</SectionTitle>
        <KV isDark={isDark} rows={[
          ['Agent', <LevelBadge level={agentLevel(server)} label={agentLabel(server)} />],
          ['Last seen', server.lastSeen ? <Ago iso={server.lastSeen} staleAfterSec={60} /> : 'Never'],
          ['Agent version', <>{server.agentVersion || '—'}{server.agent?.outdated && <span className="ml-2 px-1.5 rounded text-[10px] font-bold border border-amber-500/60 text-amber-500">OUTDATED</span>}</>],
          ['Server status', server.status],
          ['Hostname', <>{server.hostname}{server.reportedHostname && server.reportedHostname !== server.hostname ? <span className={c.muted}> (reports as {server.reportedHostname})</span> : null}</>],
          ['IP', server.ip || '—'],
          ['OS', server.os || '—'],
          ['Kernel', sys?.kernelVersion ?? (reported(server) ? 'Not reported' : '—')],
          ['Architecture', sys?.architecture ?? '—'],
          ['Uptime', t.uptimeSec != null ? fmtDuration(t.uptimeSec) : server.uptimeDays ? `${server.uptimeDays} days` : '—'],
          ['Boot time', sys?.bootTime ? fmtDateTime(sys.bootTime) : '—'],
          ['Timezone', sys?.timezone ?? '—'],
        ]} />
      </div>

      <div>
        <SectionTitle isDark={isDark}>Health summary</SectionTitle>
        {!server.health ? (
          <NotReported isDark={isDark}>Health summary not available from this server version.</NotReported>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {server.health.map(h => (
              <button
                key={h.key}
                type="button"
                onClick={() => onNavigateTab?.(CAT_TAB[h.key] ?? 'overview')}
                className={`${c.card} text-left cursor-pointer transition-colors ${isDark ? 'hover:border-[#2A3A57]' : 'hover:border-slate-300'}`}
                title={h.detail}
              >
                <div className={`text-[10px] uppercase ${c.muted}`}>{h.label}</div>
                <LevelBadge level={h.level} className="text-xs" />
                <div className={`text-[10px] mt-0.5 ${c.muted} line-clamp-2`}>{h.detail}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={c.card}>
        <SectionTitle isDark={isDark} right={<span className={`text-[10px] ${c.muted}`}>{warnings.length} active</span>}>Warnings</SectionTitle>
        {warnings.length === 0 ? (
          <div className={`text-[11px] ${c.muted}`}>{reported(server) ? 'No warnings in the latest telemetry.' : 'No telemetry yet.'}</div>
        ) : (
          <ul className="space-y-1 text-[11px]">
            {warnings.map(w => (
              <li key={w.key} className="flex items-start gap-2">
                <LevelBadge level={w.level} className="shrink-0 w-20" />
                <span className="break-words">{w.message}{w.alert && <span className={`ml-1 ${c.muted}`}>(raises an incident)</span>}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={c.card}>
        <SectionTitle isDark={isDark}>Hosting provider (Hostinger API)</SectionTitle>
        {!server.hostinger ? (
          <div className={`text-[11px] ${c.muted}`}>Not available — HOSTINGER_API_TOKEN not set, the sync failed, or no Hostinger VM has this IP.</div>
        ) : (
          <KV isDark={isDark} rows={[
            ['Status', <span className={levelText(server.hostinger.status === 'HEALTHY' ? 'HEALTHY' : server.hostinger.status === 'UNKNOWN' ? 'UNKNOWN' : 'WARNING')}>{server.hostinger.status}{server.hostinger.state ? ` (${server.hostinger.state})` : ''}</span>],
            ['Plan', server.hostinger.plan ?? '—'],
            ['CPU / RAM / Disk', `${server.hostinger.cpus ?? '?'} CPU · ${server.hostinger.ramGb ?? '?'} GB · ${server.hostinger.diskGb ?? '?'} GB`],
            ['OS', server.hostinger.os ?? '—'],
            ['Region', server.hostinger.region ?? '—'],
            ['Read', <Ago iso={server.hostinger.fetchedAt} staleAfterSec={1800} />],
          ]} />
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Resources
// ─────────────────────────────────────────────────────────────────────────────
const Stat: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; level?: TelemetryLevel; isDark: boolean }> = ({ label, value, sub, level, isDark }) => {
  const c = ui(isDark);
  return (
    <div>
      <div className={`text-[10px] uppercase ${c.muted}`}>{label}</div>
      <div className={`text-sm font-bold tabular-nums ${level && level !== 'HEALTHY' && level !== 'UNKNOWN' ? levelText(level) : c.strong}`}>{value}</div>
      {sub && <div className={`text-[10px] ${c.muted}`}>{sub}</div>}
    </div>
  );
};

export const FilesystemTable: React.FC<TabProps & { bars?: boolean }> = ({ server, isDark, bars = false }) => {
  const c = ui(isDark);
  const fss: FilesystemTelemetry[] | undefined = server.filesystems;
  if (!fss) {
    const t = server.telemetry;
    return <NotReported isDark={isDark}>Only the root filesystem is reported by this agent ({fmtNum(t.diskPercent)}% used). {needsAgent33}</NotReported>;
  }
  if (fss.length === 0) return <NotReported isDark={isDark}>The agent found no local filesystems to report.</NotReported>;
  return (
    <div className={c.tableWrap}>
      <table className="w-full text-left text-xs min-w-[640px]">
        <thead className={c.thead}>
          <tr>
            <th className="py-2 px-3">Mount</th><th className="py-2 px-3">Filesystem</th>
            <th className="py-2 px-3 text-right">Used</th><th className="py-2 px-3 text-right">Free</th><th className="py-2 px-3 text-right">Total</th>
            <th className="py-2 px-3">Usage</th><th className="py-2 px-3">Inodes</th>
          </tr>
        </thead>
        <tbody className={c.tbody}>
          {fss.map(f => (
            <tr key={f.mountPoint} className={c.row}>
              <td className={`py-2 px-3 font-semibold ${c.strong}`}>{f.mountPoint}</td>
              <td className={`py-2 px-3 ${c.muted}`}>{f.filesystem}{f.device ? <span className="block text-[10px]">{f.device}</span> : null}</td>
              <td className="py-2 px-3 text-right tabular-nums">{fmtNum(f.usedGb)} GB</td>
              <td className="py-2 px-3 text-right tabular-nums">{fmtNum(f.freeGb)} GB</td>
              <td className="py-2 px-3 text-right tabular-nums">{fmtNum(f.totalGb)} GB</td>
              <td className="py-2 px-3"><UsageBar value={f.usedPercent} band={THRESHOLDS.diskPercent} isDark={isDark} width={bars ? 'w-40' : 'w-16'} label={`${f.mountPoint} used`} /></td>
              <td className="py-2 px-3">
                {f.inodePercent === null ? <span className={c.muted} title="This filesystem has no fixed inode table">n/a</span>
                  : <><UsageBar value={f.inodePercent} band={THRESHOLDS.inodePercent} isDark={isDark} width={bars ? 'w-24' : 'w-12'} label={`${f.mountPoint} inodes used`} />
                    <span className={`block text-[10px] ${c.muted}`}>{fmtCount(f.inodeUsed)} / {fmtCount(f.inodeTotal)}</span></>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const InterfaceTable: React.FC<TabProps> = ({ server, isDark }) => {
  const c = ui(isDark);
  const ifs: NetworkInterfaceTelemetry[] | undefined = server.networkInterfaces;
  if (!ifs) return <NotReported isDark={isDark}>Per-interface data: {needsAgent33}</NotReported>;
  if (ifs.length === 0) return <NotReported isDark={isDark}>No network interfaces reported (loopback is not shown).</NotReported>;
  return (
    <div className={c.tableWrap}>
      <table className="w-full text-left text-xs min-w-[720px]">
        <thead className={c.thead}>
          <tr>
            <th className="py-2 px-3">Interface</th><th className="py-2 px-3">State</th>
            <th className="py-2 px-3 text-right">RX</th><th className="py-2 px-3 text-right">TX</th>
            <th className="py-2 px-3 text-right">Packets in / out</th>
            <th className="py-2 px-3 text-right">Errors</th><th className="py-2 px-3 text-right">Drops</th>
          </tr>
        </thead>
        <tbody className={c.tbody}>
          {ifs.map(i => {
            const newBad = (i.newErrors ?? 0) + (i.newDrops ?? 0) > 0;
            return (
              <tr key={i.name} className={c.row}>
                <td className={`py-2 px-3 font-semibold ${c.strong}`}>{i.name}{i.virtual ? <span className={`ml-1 text-[10px] font-normal ${c.muted}`}>virtual</span> : null}</td>
                <td className="py-2 px-3">
                  {i.operationalState === 'up' ? <LevelBadge level="HEALTHY" label="up" />
                    : i.operationalState === 'down' ? <LevelBadge level={i.virtual ? 'UNKNOWN' : 'WARNING'} label="down" />
                      : <span className={c.muted}>{i.operationalState ?? '—'}</span>}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">{fmtBitRate(i.rxBytesPerSec)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{fmtBitRate(i.txBytesPerSec)}</td>
                <td className={`py-2 px-3 text-right tabular-nums ${c.muted}`}>{fmtNum(i.rxPacketsPerSec, 0)} / {fmtNum(i.txPacketsPerSec, 0)} /s</td>
                <td className={`py-2 px-3 text-right tabular-nums ${newBad && i.newErrors ? 'text-amber-500 font-semibold' : ''}`} title="since boot (new since the previous report)">
                  {fmtCount((i.rxErrors ?? 0) + (i.txErrors ?? 0))}{i.newErrors ? <span className="block text-[10px]">+{i.newErrors} new</span> : null}
                </td>
                <td className={`py-2 px-3 text-right tabular-nums ${newBad && i.newDrops ? 'text-amber-500 font-semibold' : ''}`} title="since boot (new since the previous report)">
                  {fmtCount((i.rxDrops ?? 0) + (i.txDrops ?? 0))}{i.newDrops ? <span className="block text-[10px]">+{i.newDrops} new</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export const ResourcesTab: React.FC<TabProps> = ({ server, isDark }) => {
  const c = ui(isDark);
  if (!reported(server)) return <NotReported isDark={isDark}>No telemetry yet — the agent has never reported from this server.</NotReported>;
  const t = server.telemetry;
  const cores = server.cpuCores || null;
  return (
    <div className="space-y-4">
      {server.agentStatus !== 'CONNECTED' && <Banner level="WARNING" title={`Agent ${server.agentStatus}`}>Values are from the last report (<Ago iso={server.lastSeen} />), not live.</Banner>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={c.card}>
          <SectionTitle isDark={isDark}>CPU</SectionTitle>
          <div className="grid grid-cols-3 gap-3">
            <Stat isDark={isDark} label="Usage" value={`${fmtNum(t.cpuPercent)}%`} level={levelOf(t.cpuPercent, THRESHOLDS.cpuPercent)} sub={cores ? `${cores} cores` : '—'} />
            <Stat isDark={isDark} label="I/O wait" value={t.cpuIowaitPercent == null ? '—' : `${fmtNum(t.cpuIowaitPercent)}%`} level={levelOf(t.cpuIowaitPercent, THRESHOLDS.cpuIowaitPercent)} />
            <Stat isDark={isDark} label="Steal" value={t.cpuStealPercent == null ? '—' : `${fmtNum(t.cpuStealPercent)}%`} level={levelOf(t.cpuStealPercent, THRESHOLDS.cpuStealPercent)} />
            <Stat isDark={isDark} label="Load 1m / 5m / 15m" value={t.loadAvg.map(l => fmtNum(l, 2)).join(' / ')} />
            <Stat isDark={isDark} label="Load per core" value={fmtNum(t.loadPerCore ?? (cores ? t.loadAvg[0] / cores : null), 2)} level={levelOf(t.loadPerCore, THRESHOLDS.loadPerCore)} />
            <Stat isDark={isDark} label="CPU pressure" value={t.pressure?.cpu != null ? `${t.pressure.cpu}%` : '—'} sub="PSI avg 60 s" />
          </div>
        </div>
        <div className={c.card}>
          <SectionTitle isDark={isDark}>Memory</SectionTitle>
          <div className="grid grid-cols-3 gap-3">
            <Stat isDark={isDark} label="Used" value={`${fmtNum(t.ramPercent)}%`} level={levelOf(t.ramPercent, THRESHOLDS.memoryPercent)} sub={t.memUsedMb != null ? fmtMb(t.memUsedMb) : undefined} />
            <Stat isDark={isDark} label="Available" value={fmtMb(t.memAvailableMb)} />
            <Stat isDark={isDark} label="Total" value={t.memTotalMb != null ? fmtMb(t.memTotalMb) : server.ramGb ? `${server.ramGb} GB` : '—'} />
            <Stat isDark={isDark} label="Swap used"
              value={t.swapTotalMb == null ? '—' : t.swapTotalMb === 0 ? 'none' : `${fmtNum(t.swapPercent)}%`}
              level={levelOf(t.swapPercent, THRESHOLDS.swapPercent)}
              sub={t.swapTotalMb == null ? 'needs agent 3.3' : t.swapTotalMb === 0 ? 'no swap configured' : `${fmtMb(t.swapUsedMb)} of ${fmtMb(t.swapTotalMb)} · ${fmtMb(t.swapFreeMb)} free`} />
            <Stat isDark={isDark} label="Memory pressure" value={t.pressure?.memory != null ? `${t.pressure.memory}%` : '—'} level={levelOf(t.pressure?.memory, THRESHOLDS.memoryPressurePercent)} sub="PSI avg 60 s" />
            <Stat isDark={isDark} label="I/O pressure" value={t.pressure?.io != null ? `${t.pressure.io}%` : '—'} sub="PSI avg 60 s" />
          </div>
        </div>
        <div className={c.card}>
          <SectionTitle isDark={isDark}>Root disk (/)</SectionTitle>
          <div className="grid grid-cols-3 gap-3">
            <Stat isDark={isDark} label="Used" value={`${fmtNum(t.diskPercent)}%`} level={levelOf(t.diskPercent, THRESHOLDS.diskPercent)} sub={t.diskUsedGb != null ? `${t.diskUsedGb} GB` : undefined} />
            <Stat isDark={isDark} label="Free" value={t.diskFreeGb != null ? `${t.diskFreeGb} GB` : '—'} />
            <Stat isDark={isDark} label="Total" value={t.diskTotalGb != null ? `${t.diskTotalGb} GB` : server.diskGb ? `${server.diskGb} GB` : '—'} />
          </div>
        </div>
        <div className={c.card}>
          <SectionTitle isDark={isDark}>Disk I/O</SectionTitle>
          {!server.diskIo ? <div className={`text-[11px] ${c.muted}`}>{needsAgent33}</div> : (
            <div className="grid grid-cols-3 gap-3">
              <Stat isDark={isDark} label="Read" value={fmtBytesRate(t.diskReadBytesPerSec)} sub={`${fmtNum(t.diskReadOpsPerSec, 0)} IOPS`} />
              <Stat isDark={isDark} label="Write" value={fmtBytesRate(t.diskWriteBytesPerSec)} sub={`${fmtNum(t.diskWriteOpsPerSec, 0)} IOPS`} />
              <Stat isDark={isDark} label="Utilisation" value={t.diskUtilPercent == null ? '—' : `${fmtNum(t.diskUtilPercent)}%`} level={levelOf(t.diskUtilPercent, THRESHOLDS.diskIoUtilPercent)} sub="busiest disk" />
            </div>
          )}
        </div>
      </div>
      {server.diskIo && server.diskIo.length > 0 && (
        <div className={c.tableWrap}>
          <table className="w-full text-left text-xs min-w-[640px]">
            <thead className={c.thead}>
              <tr><th className="py-2 px-3">Device</th><th className="py-2 px-3 text-right">Read</th><th className="py-2 px-3 text-right">Write</th><th className="py-2 px-3 text-right">IOPS r / w</th><th className="py-2 px-3">Utilisation</th><th className="py-2 px-3 text-right">Latency r / w</th></tr>
            </thead>
            <tbody className={c.tbody}>
              {server.diskIo.map(d => (
                <tr key={d.device} className={c.row}>
                  <td className={`py-2 px-3 font-semibold ${c.strong}`}>{d.device}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtBytesRate(d.readBytesPerSec)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtBytesRate(d.writeBytesPerSec)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtNum(d.readOpsPerSec, 0)} / {fmtNum(d.writeOpsPerSec, 0)}</td>
                  <td className="py-2 px-3"><UsageBar value={d.ioUtilizationPercent} band={THRESHOLDS.diskIoUtilPercent} isDark={isDark} width="w-16" label={`${d.device} utilisation`} /></td>
                  <td className="py-2 px-3 text-right tabular-nums">{d.readLatencyMs == null ? '—' : `${fmtNum(d.readLatencyMs, 1)} ms`} / {d.writeLatencyMs == null ? '—' : `${fmtNum(d.writeLatencyMs, 1)} ms`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <SectionTitle isDark={isDark}>All filesystems</SectionTitle>
        <FilesystemTable server={server} isDark={isDark} />
      </div>
      <div>
        <SectionTitle isDark={isDark} right={<span className={`text-[10px] ${c.muted}`}>total {fmtKbps(t.networkInKbps)} in · {fmtKbps(t.networkOutKbps)} out</span>}>Network</SectionTitle>
        <InterfaceTable server={server} isDark={isDark} />
      </div>
      <ServerMetricsPanel serverId={server.id} isDark={isDark} charts={['cpu', 'memory', 'load']} title="CPU, memory and load history" />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Applications (PM2 + local health checks)
// ─────────────────────────────────────────────────────────────────────────────
type SortKey = 'name' | 'status' | 'cpu' | 'mem' | 'uptime' | 'restarts';

export const ApplicationsTab: React.FC<TabProps> = ({ server, isDark }) => {
  const c = ui(isDark);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const checks = server.appHealth ?? [];
  const apps = server.pm2;
  const checkFor = (p: PM2ProcessTelemetry) => checks.find(ch => p.ports.includes(ch.port));
  const rows = useMemo(() => {
    const list = [...(apps ?? [])];
    const val = (p: PM2ProcessTelemetry): number | string => {
      switch (sort.key) {
        case 'status': return p.status;
        case 'cpu': return p.cpuPercent ?? -1;
        case 'mem': return p.memoryMb ?? -1;
        case 'uptime': return p.uptimeSec ?? -1;
        case 'restarts': return p.restartCount ?? -1;
        default: return p.name.toLowerCase();
      }
    };
    return list.sort((a, b) => (val(a) < val(b) ? -sort.dir : val(a) > val(b) ? sort.dir : 0));
  }, [apps, sort]);
  const unmatched = checks.filter(ch => !(apps ?? []).some(p => p.ports.includes(ch.port)));
  const sel = rows.find(p => `${p.owner}|${p.id}|${p.name}` === selected) ?? null;

  const th = (key: SortKey, label: string, right = false) => (
    <th className={`py-2 px-3 ${right ? 'text-right' : ''}`}>
      <button type="button" onClick={() => setSort(s => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' || key === 'status' ? 1 : -1 }))}
        className="inline-flex items-center gap-1 cursor-pointer hover:underline" aria-label={`Sort by ${label}`}>
        {label}<ArrowUpDown className={`w-3 h-3 ${sort.key === key ? '' : 'opacity-40'}`} aria-hidden="true" />
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      {checks.some(ch => ch.status === 'DOWN') && (
        <Banner level={checks.some(ch => checkLevel(ch) === 'CRITICAL') ? 'CRITICAL' : 'WARNING'} title="Application health check failed">
          {checks.filter(ch => ch.status === 'DOWN').map(ch => `${ch.name || 'Application'} on port ${ch.port}: ${ch.error ?? 'error'}`).join(' · ')}.
          {' '}This is the application's local check — the server itself {server.agentStatus === 'CONNECTED' ? 'is reporting normally' : `is ${server.agentStatus.toLowerCase()}`}.
        </Banner>
      )}
      <div>
        <SectionTitle isDark={isDark} right={server.pm2ObservedAt ? <span className={`text-[10px] ${c.muted}`}>PM2 read <Ago iso={server.pm2ObservedAt} staleAfterSec={120} /></span> : undefined}>
          PM2 applications{apps ? ` (${apps.filter(p => p.status === 'online').length}/${apps.length} online)` : ''}
        </SectionTitle>
        {apps === undefined ? <NotReported isDark={isDark}>{reported(server) ? `PM2 data: ${needsAgent33}` : 'No telemetry yet — the agent has never reported from this server.'}</NotReported>
          : apps === null ? <NotReported isDark={isDark}>PM2 is not running on this server.</NotReported>
            : apps.length === 0 ? <NotReported isDark={isDark}>PM2 is running but manages no applications.</NotReported> : (
              <div className={c.tableWrap}>
                <table className="w-full text-left text-xs min-w-[980px]">
                  <thead className={c.thead}>
                    <tr>
                      {th('name', 'Application')}{th('status', 'Status')}<th className="py-2 px-3">PID</th>{th('cpu', 'CPU', true)}{th('mem', 'Memory', true)}
                      {th('uptime', 'Uptime', true)}{th('restarts', 'Restarts', true)}<th className="py-2 px-3">Port</th><th className="py-2 px-3">Local health</th>
                      <th className="py-2 px-3 text-right">Latency</th><th className="py-2 px-3">Node</th><th className="py-2 px-3">Version</th>
                    </tr>
                  </thead>
                  <tbody className={c.tbody}>
                    {rows.map(p => {
                      const key = `${p.owner}|${p.id}|${p.name}`;
                      const ch = checkFor(p);
                      const lvl = pm2Level(p);
                      return (
                        <tr key={key} onClick={() => setSelected(selected === key ? null : key)} aria-selected={selected === key}
                          className={`cursor-pointer ${c.row} ${selected === key ? (isDark ? 'bg-[#151D2E]' : 'bg-blue-50') : ''} ${lvl === 'CRITICAL' ? (isDark ? 'bg-[#180E13]' : 'bg-rose-50/70') : ''}`}>
                          <td className={`py-2 px-3 font-semibold ${c.strong}`}>{p.name}{p.owner && p.owner !== 'root' ? <span className={`block text-[10px] font-normal ${c.muted}`}>{p.owner}</span> : null}</td>
                          <td className="py-2 px-3"><LevelBadge level={lvl} label={p.status.toUpperCase()} /></td>
                          <td className="py-2 px-3">{p.pid ?? '—'}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{p.cpuPercent == null ? '—' : `${fmtNum(p.cpuPercent)}%`}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{fmtMb(p.memoryMb)}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{fmtDuration(p.uptimeSec)}</td>
                          <td className={`py-2 px-3 text-right tabular-nums ${attentionText(levelOf(p.recentRestarts, THRESHOLDS.pm2Restarts))}`}>
                            {p.restartCount ?? '—'}{p.recentRestarts ? <span className="block text-[10px]">+{p.recentRestarts} / {THRESHOLDS.pm2Restarts.restartWindowMinutes}m</span> : null}
                          </td>
                          <td className="py-2 px-3">{p.ports.length ? p.ports.join(', ') : '—'}</td>
                          <td className="py-2 px-3">{ch ? <LevelBadge level={checkLevel(ch)} label={ch.status} /> : <span className={c.muted}>—</span>}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{ch?.latencyMs != null ? `${fmtNum(ch.latencyMs, 0)} ms` : '—'}</td>
                          <td className="py-2 px-3">{p.nodeVersion ?? '—'}</td>
                          <td className={`py-2 px-3 ${c.muted}`}>{p.release ?? p.version ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
      </div>

      {sel && <ApplicationDetail app={sel} check={checkFor(sel)} isDark={isDark} />}

      <div>
        <SectionTitle isDark={isDark}>Local application health checks</SectionTitle>
        {checks.length === 0 ? (
          <NotReported isDark={isDark}>
            {server.appHealth === undefined && reported(server) ? `Local checks: ${needsAgent33} ` : ''}
            Checks run on the server against 127.0.0.1:&lt;app port&gt;&lt;health path&gt; for each application that has an app port set for this environment (Setup → application → environment details).
          </NotReported>
        ) : (
          <div className={c.tableWrap}>
            <table className="w-full text-left text-xs min-w-[720px]">
              <thead className={c.thead}>
                <tr><th className="py-2 px-3">Application</th><th className="py-2 px-3">Target</th><th className="py-2 px-3">Listening</th><th className="py-2 px-3">Health</th><th className="py-2 px-3 text-right">HTTP</th><th className="py-2 px-3 text-right">Latency</th><th className="py-2 px-3">Checked</th></tr>
              </thead>
              <tbody className={c.tbody}>
                {checks.map(ch => (
                  <tr key={`${ch.applicationId}-${ch.port}`} className={c.row}>
                    <td className={`py-2 px-3 font-semibold ${c.strong}`}>{ch.name || '—'}{ch.environment ? <span className={`ml-1 text-[10px] ${c.muted}`}>{ch.environment}</span> : null}
                      {unmatched.includes(ch) && apps ? <span className={`block text-[10px] font-normal ${c.muted}`}>not a PM2 process</span> : null}</td>
                    <td className="py-2 px-3">127.0.0.1:{ch.port}{ch.path}</td>
                    <td className="py-2 px-3">{ch.listening === null ? '—' : <LevelBadge level={ch.listening ? 'HEALTHY' : 'CRITICAL'} label={ch.listening ? 'yes' : 'no'} />}</td>
                    <td className="py-2 px-3"><LevelBadge level={checkLevel(ch)} label={ch.status} />{ch.error ? <span className="block text-[10px] text-rose-500 break-all">{ch.error}</span> : null}</td>
                    <td className="py-2 px-3 text-right">{ch.statusCode ?? '—'}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{ch.latencyMs != null ? `${fmtNum(ch.latencyMs, 0)} ms` : '—'}</td>
                    <td className="py-2 px-3"><Ago iso={ch.checkedAt} staleAfterSec={120} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {server.system && (server.system.nodeVersion || server.system.npmVersion) && (
        <div className={`text-[11px] ${c.muted}`}>Host runtime: Node.js {server.system.nodeVersion ?? '—'} · npm {server.system.npmVersion ?? '—'}</div>
      )}
    </div>
  );
};

const ApplicationDetail: React.FC<{ app: PM2ProcessTelemetry; check: ApplicationHealthTelemetry | undefined; isDark: boolean }> = ({ app, check, isDark }) => {
  const c = ui(isDark);
  return (
    <div className={`${c.card} space-y-2`}>
      <SectionTitle isDark={isDark}>{app.name}</SectionTitle>
      {check?.status === 'DOWN' && (
        <Banner level={checkLevel(check) === 'CRITICAL' ? 'CRITICAL' : 'WARNING'} title="Application health check failed">
          127.0.0.1:{check.port}{check.path} — {check.error ?? 'error'} ({check.consecutiveFailures} consecutive). The VPS itself is not marked down by this.
        </Banner>
      )}
      <KV isDark={isDark} rows={[
        ['Status', <LevelBadge level={pm2Level(app)} label={app.status.toUpperCase()} />],
        ['PID', app.pid ?? '—'],
        ['CPU', app.cpuPercent == null ? '—' : `${fmtNum(app.cpuPercent)}%`],
        ['Memory', fmtMb(app.memoryMb)],
        ['Uptime', `${fmtDuration(app.uptimeSec)}${app.startedAt ? ` (since ${fmtDateTime(app.startedAt)})` : ''}`],
        ['Restarts', `${app.restartCount ?? '—'} total · ${app.recentRestarts ?? '—'} in ${THRESHOLDS.pm2Restarts.restartWindowMinutes} min · ${app.unstableRestarts ?? '—'} unstable`],
        ['Node version', app.nodeVersion ?? '—'],
        ['Interpreter / mode', `${app.interpreter ?? '—'} · ${app.execMode ?? '—'}${app.instances != null ? ` · ${app.instances} instance(s)` : ''}`],
        ['Port', app.ports.length ? app.ports.join(', ') : 'none detected'],
        ['Listening', check ? (check.listening ? 'yes' : check.listening === false ? 'NO' : '—') : '—'],
        ['Local health', check ? <LevelBadge level={checkLevel(check)} label={`${check.status}${check.statusCode ? ` · HTTP ${check.statusCode}` : ''}`} /> : 'No check configured for this port'],
        ['Latency', check?.latencyMs != null ? `${fmtNum(check.latencyMs, 0)} ms` : '—'],
        ['Deployed release', app.release ?? '—'],
        ['Package version', app.version ?? '—'],
        ['Git revision', app.gitRevision ?? '—'],
        ['PM2 owner', app.owner ?? '—'],
      ]} />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Services (systemd)
// ─────────────────────────────────────────────────────────────────────────────
export const ServicesTab: React.FC<TabProps> = ({ server, isDark }) => {
  const c = ui(isDark);
  const failed = server.services.filter(s => s.status === 'failed');
  const fu = server.failedUnits;
  const svcLevel = (s: VpsServer['services'][number]): TelemetryLevel => (s.status === 'failed' ? 'CRITICAL' : s.status === 'active' ? 'HEALTHY' : s.status === 'restarting' ? 'WARNING' : 'UNKNOWN');
  return (
    <div className="space-y-4">
      <div className={`${c.card} flex flex-wrap gap-x-6 gap-y-1 items-center text-[11px]`}>
        <span>Failed services: <LevelBadge level={failed.length ? 'CRITICAL' : server.services.length ? 'HEALTHY' : 'UNKNOWN'} label={String(failed.length)} /></span>
        <span>Failed units on host: {fu ? <LevelBadge level={fu.count ? 'WARNING' : 'HEALTHY'} label={String(fu.count)} /> : <span className={c.muted}>{reported(server) ? 'not reported' : '—'}</span>}</span>
        <span className={c.muted}>Read-only: Scholario Ops never starts, stops or restarts services.</span>
      </div>
      {server.services.length === 0 ? (
        <NotReported isDark={isDark}>
          {reported(server) ? 'The agent reports no watched services. List them in SERVICES= in /etc/scholario-agent.conf on the server.' : 'No telemetry yet — the agent has never reported from this server.'}
        </NotReported>
      ) : (
        <div className={c.tableWrap}>
          <table className="w-full text-left text-xs min-w-[760px]">
            <thead className={c.thead}>
              <tr><th className="py-2 px-3">Service</th><th className="py-2 px-3">Status</th><th className="py-2 px-3">PID</th><th className="py-2 px-3 text-right">Memory</th><th className="py-2 px-3">Since</th><th className="py-2 px-3 text-right">Restart count</th><th className="py-2 px-3">Health</th></tr>
            </thead>
            <tbody className={c.tbody}>
              {server.services.map(s => (
                <tr key={s.name} className={`${c.row} ${s.status === 'failed' ? (isDark ? 'bg-[#180E13]' : 'bg-rose-50/70') : ''}`}>
                  <td className={`py-2 px-3 font-semibold ${c.strong}`}>{s.name}</td>
                  <td className="py-2 px-3">{s.activeState ?? s.status}{s.subState ? <span className={c.muted}> ({s.subState})</span> : null}{s.result && s.result !== 'success' ? <span className="block text-[10px] text-rose-500">result: {s.result}</span> : null}</td>
                  <td className="py-2 px-3">{s.pid || '—'}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{s.memoryMb ? fmtMb(s.memoryMb) : '—'}</td>
                  <td className={`py-2 px-3 ${c.muted}`}>{validDate(s.lastRestart) ? fmtDateTime(s.lastRestart) : (s.lastRestart || '—')}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{s.restartCount ?? '—'}</td>
                  <td className="py-2 px-3"><LevelBadge level={svcLevel(s)} label={s.status === 'failed' ? 'FAILED' : undefined} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {fu && fu.count > 0 && (
        <div className={c.card}>
          <SectionTitle isDark={isDark}>Failed systemd units on this host</SectionTitle>
          <div className="text-[11px] break-words">{fu.units.join(', ')}{fu.count > fu.units.length ? ` … and ${fu.count - fu.units.length} more` : ''}</div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Network
// ─────────────────────────────────────────────────────────────────────────────
export const NetworkTab: React.FC<TabProps> = ({ server, isDark }) => {
  const c = ui(isDark);
  const t = server.telemetry;
  const ports = server.listeningPorts;
  return (
    <div className="space-y-4">
      <div className={`${c.card} grid grid-cols-2 sm:grid-cols-4 gap-3`}>
        <Stat isDark={isDark} label="Total in" value={reported(server) ? fmtKbps(t.networkInKbps) : '—'} />
        <Stat isDark={isDark} label="Total out" value={reported(server) ? fmtKbps(t.networkOutKbps) : '—'} />
        <Stat isDark={isDark} label="Interfaces" value={server.networkInterfaces ? server.networkInterfaces.length : '—'} />
        <Stat isDark={isDark} label="Sample" value={reported(server) ? fmtTime(t.observedAt) : '—'} />
      </div>
      <InterfaceTable server={server} isDark={isDark} />
      <div>
        <SectionTitle isDark={isDark}>Listening TCP ports</SectionTitle>
        {ports === undefined ? <NotReported isDark={isDark}>{reported(server) ? needsAgent33 : 'No telemetry yet.'}</NotReported>
          : ports === null ? <NotReported isDark={isDark}>The agent could not list listening ports (the ss command is not available).</NotReported> : (
            <div className={c.tableWrap}>
              <table className="w-full text-left text-xs min-w-[560px]">
                <thead className={c.thead}><tr><th className="py-2 px-3">Address</th><th className="py-2 px-3 text-right">Port</th><th className="py-2 px-3">Process</th><th className="py-2 px-3">Exposure</th></tr></thead>
                <tbody className={c.tbody}>
                  {[...ports].sort((a, b) => a.port - b.port).map(p => (
                    <tr key={`${p.address}:${p.port}`} className={c.row}>
                      <td className="py-2 px-3">{p.address}</td>
                      <td className={`py-2 px-3 text-right font-semibold ${c.strong}`}>{p.port}</td>
                      <td className={`py-2 px-3 ${c.muted}`}>{p.process ?? '—'}{p.pids.length ? ` (pid ${p.pids.join(', ')})` : ''}</td>
                      <td className="py-2 px-3">{p.scope === 'loopback' ? <span className="text-emerald-500">local only</span> : p.scope === 'all' ? <span className="text-amber-500 font-semibold">all interfaces</span> : <span>{p.address} only</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
      <ServerMetricsPanel serverId={server.id} isDark={isDark} charts={['network']} title="Network history (all interfaces)" />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────────────────────────
export const StorageTab: React.FC<TabProps> = ({ server, isDark }) => {
  const c = ui(isDark);
  const fss = server.filesystems ?? [];
  return (
    <div className="space-y-4">
      {fss.length > 0 && (
        <div className={`${c.card} space-y-1.5`}>
          <SectionTitle isDark={isDark} right={<span className={`text-[10px] ${c.muted}`}>warning ≥ {THRESHOLDS.diskPercent.warning}% · critical ≥ {THRESHOLDS.diskPercent.critical}%</span>}>Usage</SectionTitle>
          {fss.map(f => (
            <div key={f.mountPoint} className="flex items-center gap-3 text-[11px]">
              <span className={`w-32 truncate font-semibold ${c.strong}`} title={f.mountPoint}>{f.mountPoint}</span>
              <UsageBar value={f.usedPercent} band={THRESHOLDS.diskPercent} isDark={isDark} width="w-40 sm:w-64" label={`${f.mountPoint} used`} />
              <span className={c.muted}>{fmtNum(f.freeGb)} GB free</span>
            </div>
          ))}
        </div>
      )}
      <FilesystemTable server={server} isDark={isDark} bars />
      <ServerMetricsPanel serverId={server.id} isDark={isDark} charts={['disk', 'diskio', 'diskutil']} title="Disk history" />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────────────────────────────────────
export const DatabaseTab: React.FC<TabProps> = ({ server, isDark }) => {
  const c = ui(isDark);
  if (!server.databases?.length) {
    return <NotReported isDark={isDark}>{server.lastSeen
      ? 'The agent reports no database probe. Set DB_ENGINE (and DB_CNF / DB_PGPASSFILE for credentials) in /etc/scholario-agent.conf on the server.'
      : 'UNKNOWN — agent not connected.'}</NotReported>;
  }
  return (
    <div className="space-y-3">
      {server.databases.map((d, i) => {
        const usage = d.connectionUsagePercent ?? (d.connections != null && d.maxConnections ? Math.round((d.connections / d.maxConnections) * 1000) / 10 : null);
        const repl = d.replication;
        const level: TelemetryLevel = !d.available ? 'CRITICAL'
          : worstLevel(([levelOf(usage, THRESHOLDS.dbConnectionUsagePercent), d.longRunningQueries ? 'WARNING' : 'HEALTHY', repl?.role === 'replica' && repl.state !== 'running' ? 'WARNING' : 'HEALTHY'] as TelemetryLevel[]).filter(l => l !== 'UNKNOWN'), 'HEALTHY');
        return (
          <div key={i} className={c.card}>
            <SectionTitle isDark={isDark} right={<span className={`text-[10px] ${c.muted}`}>probed <Ago iso={d.observedAt} staleAfterSec={180} /></span>}>
              {d.name ?? '(server)'} · {d.engine} — <LevelBadge level={level} label={d.available ? (level === 'HEALTHY' ? 'AVAILABLE' : 'DEGRADED') : 'UNAVAILABLE'} />
            </SectionTitle>
            <KV isDark={isDark} rows={[
              ['Version', d.version ?? '—'],
              ['Latency', d.latencyMs != null ? `${d.latencyMs} ms` : '—'],
              ['Size', d.sizeBytes != null ? `${(d.sizeBytes / 1073741824).toFixed(2)} GB` : '—'],
              ['Connections', d.connections != null ? String(d.connections) : '—'],
              ['Max connections', d.maxConnections != null ? String(d.maxConnections) : '—'],
              ['Connection usage', <UsageBar value={usage} band={THRESHOLDS.dbConnectionUsagePercent} isDark={isDark} label="Connection usage" />],
              ['Queries > 60 s', d.longRunningQueries != null ? <span className={d.longRunningQueries ? 'text-amber-500 font-semibold' : ''}>{d.longRunningQueries}</span> : '—'],
              ['Replication', repl ? <LevelBadge level={repl.role !== 'replica' ? 'HEALTHY' : repl.state === 'running' ? 'HEALTHY' : repl.state === 'error' ? 'CRITICAL' : 'WARNING'} label={`${repl.role} · ${repl.state}`} /> : 'not detected'],
              ['Replication lag', repl?.lagSec != null ? `${repl.lagSec} s` : '—'],
              ['Last replayed', repl?.lastSuccessAt ? fmtDateTime(repl.lastSuccessAt) : '—'],
            ]} />
            {(d.error || repl?.error) && <div className="mt-2 text-[11px] text-rose-500 break-words">{d.error ?? repl?.error}</div>}
          </div>
        );
      })}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Agent
// ─────────────────────────────────────────────────────────────────────────────
export const AgentTab: React.FC<TabProps> = ({ server, isDark }) => {
  const c = ui(isDark);
  const a = server.agent;
  const ntp = server.ntp;
  const [events, setEvents] = useState<AuditLog[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.getAgentEvents(server.id)
      .then(e => { if (alive) { setEvents(e); setEventsError(null); } })
      .catch(err => { if (alive) setEventsError(err instanceof Error ? err.message : 'Could not load events'); });
    return () => { alive = false; };
  }, [server.id]);
  const ms = (v: number | null | undefined) => (v == null ? '—' : `${v} ms`);
  return (
    <div className="space-y-4">
      <AgentBanners server={server} />
      <div className={c.card}>
        <SectionTitle isDark={isDark}>Telemetry agent — <LevelBadge level={agentLevel(server)} label={agentLabel(server)} /></SectionTitle>
        <KV isDark={isDark} rows={[
          ['Agent version', server.agentVersion || '—'],
          ['Expected version', a?.expectedVersion ?? '—'],
          ['Update state', a?.outdated == null ? '—' : a.outdated ? <LevelBadge level="WARNING" label="OUTDATED — reinstall from Setup" /> : <LevelBadge level="HEALTHY" label="Up to date" />],
          ['Started', server.agentStartedAt ? fmtDateTime(server.agentStartedAt) : '—'],
          ['Restarts seen', server.lastSeen ? String(server.agentRestartCount ?? 0) : '—'],
          ['Last seen', server.lastSeen ? <Ago iso={server.lastSeen} staleAfterSec={60} /> : 'Never'],
          ['Observed at', a?.observedAt ? fmtDateTime(a.observedAt) : '—'],
          ['Received at', a?.receivedAt ? fmtDateTime(a.receivedAt) : '—'],
          ['Transport delay', <span className={attentionText(levelOf(a?.transportDelayMs, THRESHOLDS.transportDelayMs))}>{ms(a?.transportDelayMs)}</span>],
          ['Clock skew', <span className={attentionText(levelOf(a?.clockSkewMs == null ? null : Math.abs(a.clockSkewMs), THRESHOLDS.clockSkewMs))}>{ms(a?.clockSkewMs)}</span>],
          ['NTP synchronized', ntp == null ? '—' : ntp.synchronized === null ? 'unknown' : <LevelBadge level={ntp.synchronized ? 'HEALTHY' : 'WARNING'} label={ntp.synchronized ? 'yes' : 'NO'} />],
          ['Time service', ntp?.service ?? (ntp ? 'none active' : '—')],
          ['NTP offset', ntp?.clockOffsetMs != null ? `${ntp.clockOffsetMs} ms` : '—'],
          ['Clock drift', ntp?.clockDriftPpm != null ? `${ntp.clockDriftPpm} ppm` : '—'],
          ['Reported hostname', server.reportedHostname || '—'],
          ['Reports from IP', server.agentSourceIp ? <>{server.agentSourceIp}{server.agentSourceIp !== server.ip ? <span className="text-amber-500"> (configured IP is {server.ip})</span> : null}</> : '—'],
        ]} />
        {(server.agentErrors?.length ?? 0) > 0 && (
          <div className="mt-2 text-[11px] text-amber-500"><LevelBadge level="WARNING" label="Collector errors" />: {server.agentErrors!.join(' · ')}</div>
        )}
      </div>
      <div className={c.card}>
        <SectionTitle isDark={isDark}>Recent agent events</SectionTitle>
        {eventsError ? <div className="text-[11px] text-rose-500">Could not load events: {eventsError}</div>
          : events === null ? <div className={`text-[11px] animate-pulse ${c.muted}`}>Loading…</div>
            : events.length === 0 ? <div className={`text-[11px] ${c.muted}`}>No agent events recorded for this server.</div> : (
              <ul className="space-y-1 text-[11px]">
                {events.map(e => (
                  <li key={e.id} className="flex gap-2"><span className={`shrink-0 w-40 ${c.muted}`}>{fmtDateTime(e.timestamp)}</span><span className="font-semibold shrink-0">{e.action}</span><span className="break-words">{e.details}</span></li>
                ))}
              </ul>
            )}
      </div>
    </div>
  );
};
