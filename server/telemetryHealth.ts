/**
 * Server health from agent telemetry: agent state (incl. OUTDATED and clock problems), a per-category
 * health summary and the list of warnings. Computed on demand from the latest report and the
 * 1-minute rollups — never stored. Used by the API (every server response), the fleet summary,
 * DR capacity checks and the alert engine (warnings with `alert: true` open incidents).
 *
 * Rules: no data → UNKNOWN (never HEALTHY); CPU / memory / swap / disk I/O warnings need the
 * condition in every 1-minute rollup of THRESHOLDS.*.sustainedMinutes; thresholds live in
 * src/lib/thresholds.ts.
 */
import { AgentHealthTelemetry, HealthCategory, HealthCategoryKey, ServerMetricPoint, ServerWarning, TelemetryLevel } from '../src/types/index.ts';
import { THRESHOLDS, levelOf, worstLevel, Band } from '../src/lib/thresholds.ts';
import { AGENT_VERSION } from './agent.ts';
import { agentState } from './health.ts';
import { minuteMetrics, ServerRecord } from './store.ts';

/** Numeric dotted-version compare: <0 when a < b. Non-numeric parts compare as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.+-]/).map(x => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.+-]/).map(x => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** true / false, or null when the agent never reported a version */
export const agentOutdated = (version: string | null | undefined): boolean | null =>
  version ? compareVersions(version, AGENT_VERSION) < 0 : null;

export function agentHealth(srv: ServerRecord): AgentHealthTelemetry {
  const t = srv.telemetry;
  return {
    state: agentState(srv),
    version: srv.agentVersion || null,
    expectedVersion: AGENT_VERSION,
    outdated: agentOutdated(srv.agentVersion),
    startedAt: srv.agentStartedAt ?? null,
    restartCount: srv.agentRestartCount ?? 0,
    lastSeen: srv.lastSeen || null,
    observedAt: t?.observedAt || null,
    receivedAt: t?.receivedAt || null,
    sentAt: srv.agentTiming?.sentAt ?? null,
    transportDelayMs: srv.agentTiming?.transportDelayMs ?? null,
    clockSkewMs: srv.agentTiming?.clockSkewMs ?? null,
    sourceIp: srv.agentSourceIp ?? null,
    errors: srv.agentErrors ?? [],
  };
}

/**
 * true when every 1-minute rollup of the last `minutes` minutes has `key` >= threshold
 * (and there is a rollup for each of those minutes).
 */
export function sustained(serverId: string, key: keyof ServerMetricPoint, threshold: number, minutes: number): boolean {
  const series = minuteMetrics[serverId] ?? [];
  const since = Date.now() - (minutes + 1.5) * 60_000;
  const recent = series.filter(p => Date.parse(p.t) >= since).slice(-minutes);
  if (recent.length < minutes) return false;
  return recent.every(p => typeof p[key] === 'number' && (p[key] as number) >= threshold);
}

const fmt = (v: number | null | undefined, unit = '%', d = 1) => (v === null || v === undefined ? '?' : `${v.toFixed(d)}${unit}`);

export function serverHealth(srv: ServerRecord): { health: HealthCategory[]; warnings: ServerWarning[] } {
  const warnings: ServerWarning[] = [];
  const health: HealthCategory[] = [];
  const warn = (key: string, category: HealthCategoryKey, level: TelemetryLevel, message: string, alert = false) => {
    if (level === 'WARNING' || level === 'CRITICAL') warnings.push({ key, category, level, message, alert });
  };
  const cat = (key: HealthCategoryKey, label: string, level: TelemetryLevel, detail: string) => health.push({ key, label, level, detail });

  // ── Agent ──
  const a = agentHealth(srv);
  if (a.state === 'NOT_CONNECTED') cat('agent', 'Agent', 'UNKNOWN', 'Never reported — install the agent from Setup');
  else if (a.state === 'OFFLINE') { cat('agent', 'Agent', 'CRITICAL', `Disconnected — last report ${a.lastSeen}`); warn('agent-offline', 'agent', 'CRITICAL', `Agent disconnected (last report ${a.lastSeen})`); }
  else if (a.state === 'STALE') { cat('agent', 'Agent', 'WARNING', `Stale — last report ${a.lastSeen}`); warn('agent-stale', 'agent', 'WARNING', `Agent stale (last report ${a.lastSeen})`); }
  else {
    const issues: string[] = [];
    if (a.outdated) { issues.push(`outdated (v${a.version}, current v${a.expectedVersion})`); warn('agent-outdated', 'agent', 'WARNING', `Outdated agent v${a.version} — current is v${a.expectedVersion}; reinstall from Setup`); }
    if (a.errors.length) { issues.push(`${a.errors.length} collector error(s)`); warn('agent-errors', 'agent', 'WARNING', `Agent collector errors: ${a.errors.join(' · ')}`); }
    cat('agent', 'Agent', issues.length ? 'WARNING' : 'HEALTHY', issues.length ? `Connected · ${issues.join(' · ')}` : `Connected · v${a.version ?? '?'}`);
  }
  if (a.state !== 'ONLINE') {
    const why = a.state === 'NOT_CONNECTED' ? 'No telemetry (agent never reported)' : `No live telemetry (agent ${a.state.toLowerCase()})`;
    for (const [k, l] of [['time', 'Time sync'], ['cpu', 'CPU'], ['memory', 'Memory'], ['swap', 'Swap'], ['disk', 'Disk'], ['diskio', 'Disk I/O'], ['network', 'Network'], ['systemd', 'Systemd'], ['pm2', 'PM2'], ['apps', 'App health'], ['database', 'Database']] as const) cat(k, l, 'UNKNOWN', why);
    return { health, warnings };
  }
  const t = srv.telemetry;

  // ── Time ──
  {
    const levels: TelemetryLevel[] = [];
    const parts: string[] = [];
    const ntp = srv.ntp;
    if (ntp?.synchronized === false) { levels.push('WARNING'); parts.push('NTP not synchronized'); warn('ntp-unsynchronized', 'time', 'WARNING', `Clock not synchronized by NTP${ntp.service ? ` (${ntp.service})` : ' — no time service active'}`, true); }
    else if (ntp?.synchronized) { levels.push('HEALTHY'); parts.push(`NTP synchronized${ntp.service ? ` (${ntp.service})` : ''}`); }
    if (ntp?.clockOffsetMs != null) {
      const l = levelOf(Math.abs(ntp.clockOffsetMs), THRESHOLDS.ntpOffsetMs); levels.push(l); parts.push(`offset ${ntp.clockOffsetMs} ms`);
      warn('ntp-offset', 'time', l, `NTP offset ${ntp.clockOffsetMs} ms`);
    }
    const skew = a.clockSkewMs;
    if (skew !== null) {
      const l = levelOf(Math.abs(skew), THRESHOLDS.clockSkewMs); levels.push(l); parts.push(`skew ${skew} ms`);
      warn('clock-skew', 'time', l, `Clock skew ${skew} ms between the server and Scholario Ops`, l === 'CRITICAL');
    }
    if (a.transportDelayMs !== null) {
      const l = levelOf(a.transportDelayMs, THRESHOLDS.transportDelayMs); levels.push(l === 'CRITICAL' ? 'WARNING' : l); parts.push(`delivery ${a.transportDelayMs} ms`);
      warn('transport-delay', 'time', l === 'CRITICAL' ? 'WARNING' : l, `Slow report delivery (${a.transportDelayMs} ms)`);
    }
    cat('time', 'Time sync', levels.length ? worstLevel(levels) : 'UNKNOWN', parts.join(' · ') || 'Not reported (agent < 3.3)');
  }

  // ── CPU ──
  {
    const cpuL = levelOf(t.cpuPercent, THRESHOLDS.cpuPercent);
    const ioL = levelOf(t.cpuIowaitPercent, THRESHOLDS.cpuIowaitPercent);
    const stL = levelOf(t.cpuStealPercent, THRESHOLDS.cpuStealPercent);
    const lpL = levelOf(t.loadPerCore, THRESHOLDS.loadPerCore);
    cat('cpu', 'CPU', worstLevel([cpuL, ioL, stL, lpL].filter(l => l !== 'UNKNOWN'), cpuL),
      `${fmt(t.cpuPercent)} busy · iowait ${fmt(t.cpuIowaitPercent)} · steal ${fmt(t.cpuStealPercent)} · load/core ${fmt(t.loadPerCore, '', 2)}`);
    const c = THRESHOLDS.cpuPercent;
    if (sustained(srv.id, 'cpu', c.critical, c.sustainedMinutes)) warn('cpu-high', 'cpu', 'CRITICAL', `CPU ≥ ${c.critical}% for ${c.sustainedMinutes} min (now ${fmt(t.cpuPercent)})`, true);
    else if (sustained(srv.id, 'cpu', c.warning, c.sustainedMinutes)) warn('cpu-high', 'cpu', 'WARNING', `CPU ≥ ${c.warning}% for ${c.sustainedMinutes} min (now ${fmt(t.cpuPercent)})`);
    warn('cpu-iowait', 'cpu', ioL === 'CRITICAL' ? 'WARNING' : ioL, `High I/O wait ${fmt(t.cpuIowaitPercent)} — processes are waiting on disk`);
    warn('cpu-steal', 'cpu', stL === 'CRITICAL' ? 'WARNING' : stL, `High CPU steal ${fmt(t.cpuStealPercent)} — the hypervisor is taking CPU time`);
    warn('load-per-core', 'cpu', lpL === 'CRITICAL' ? 'WARNING' : lpL, `Load ${fmt(t.loadPerCore, '', 2)} per core`);
  }

  // ── Memory / swap ──
  {
    const memL = levelOf(t.ramPercent, THRESHOLDS.memoryPercent);
    const psiL = levelOf(t.pressure?.memory, THRESHOLDS.memoryPressurePercent);
    cat('memory', 'Memory', worstLevel([memL, psiL].filter(l => l !== 'UNKNOWN'), memL),
      `${fmt(t.ramPercent)} used${t.memAvailableMb != null ? ` · ${(t.memAvailableMb / 1024).toFixed(1)} GB available` : ''}${t.pressure?.memory != null ? ` · pressure ${t.pressure.memory}%` : ''}`);
    const m = THRESHOLDS.memoryPercent;
    if (sustained(srv.id, 'ram', m.critical, m.sustainedMinutes)) warn('memory-high', 'memory', 'CRITICAL', `Memory ≥ ${m.critical}% for ${m.sustainedMinutes} min (now ${fmt(t.ramPercent)})`, true);
    else if (sustained(srv.id, 'ram', m.warning, m.sustainedMinutes)) warn('memory-high', 'memory', 'WARNING', `Memory ≥ ${m.warning}% for ${m.sustainedMinutes} min (now ${fmt(t.ramPercent)})`);
    warn('memory-pressure', 'memory', psiL, `Memory pressure ${fmt(t.pressure?.memory)} — tasks are stalling for memory`);

    if (t.swapTotalMb === undefined || t.swapTotalMb === null) cat('swap', 'Swap', 'UNKNOWN', 'Not reported (agent < 3.3)');
    else if (t.swapTotalMb === 0 || t.swapPercent === null || t.swapPercent === undefined) cat('swap', 'Swap', 'HEALTHY', 'No swap configured');
    else {
      cat('swap', 'Swap', levelOf(t.swapPercent, THRESHOLDS.swapPercent), `${fmt(t.swapPercent)} of ${(t.swapTotalMb / 1024).toFixed(1)} GB used`);
      const s = THRESHOLDS.swapPercent;
      if (sustained(srv.id, 'swap', s.critical, s.sustainedMinutes)) warn('swap-high', 'swap', 'CRITICAL', `Swap ≥ ${s.critical}% for ${s.sustainedMinutes} min`, true);
      else if (sustained(srv.id, 'swap', s.warning, s.sustainedMinutes)) warn('swap-high', 'swap', 'WARNING', `Swap ≥ ${s.warning}% for ${s.sustainedMinutes} min`);
    }
  }

  // ── Disk / inodes ──
  {
    const fss = srv.filesystems?.length ? srv.filesystems : [{ mountPoint: '/', usedPercent: t.diskPercent, inodePercent: null as number | null }];
    const levels: TelemetryLevel[] = [];
    let worst = fss[0];
    for (const f of fss) {
      const du = levelOf(f.usedPercent, THRESHOLDS.diskPercent);
      const iu = levelOf(f.inodePercent, THRESHOLDS.inodePercent);
      levels.push(du); if (iu !== 'UNKNOWN') levels.push(iu);
      if ((f.usedPercent ?? 0) > (worst.usedPercent ?? 0)) worst = f;
      warn(`disk:${f.mountPoint}`, 'disk', du, `Filesystem ${f.mountPoint} ${fmt(f.usedPercent)} full`, du === 'CRITICAL');
      warn(`inode:${f.mountPoint}`, 'disk', iu, `Filesystem ${f.mountPoint} inodes ${fmt(f.inodePercent)} used`, iu === 'CRITICAL');
    }
    cat('disk', 'Disk', worstLevel(levels), `${fss.length} filesystem(s) · fullest ${worst.mountPoint} ${fmt(worst.usedPercent)}`);
  }

  // ── Disk I/O ──
  if (!srv.diskIo) cat('diskio', 'Disk I/O', 'UNKNOWN', 'Not reported (agent < 3.3)');
  else {
    const utilL = levelOf(t.diskUtilPercent, THRESHOLDS.diskIoUtilPercent);
    const lat = Math.max(0, ...srv.diskIo.flatMap(d => [d.readLatencyMs ?? 0, d.writeLatencyMs ?? 0]));
    const latL = srv.diskIo.length ? levelOf(lat, THRESHOLDS.diskLatencyMs) : 'UNKNOWN';
    cat('diskio', 'Disk I/O', srv.diskIo.length ? worstLevel([utilL, latL].filter(l => l !== 'UNKNOWN'), 'HEALTHY') : 'UNKNOWN',
      srv.diskIo.length ? `util ${fmt(t.diskUtilPercent)} · latency up to ${lat.toFixed(1)} ms` : 'No physical disk counters');
    const u = THRESHOLDS.diskIoUtilPercent;
    if (sustained(srv.id, 'diskUtil', u.critical, u.sustainedMinutes)) warn('diskio-util', 'diskio', 'CRITICAL', `Disk busy ≥ ${u.critical}% for ${u.sustainedMinutes} min`);
    else if (sustained(srv.id, 'diskUtil', u.warning, u.sustainedMinutes)) warn('diskio-util', 'diskio', 'WARNING', `Disk busy ≥ ${u.warning}% for ${u.sustainedMinutes} min`);
    warn('diskio-latency', 'diskio', latL === 'CRITICAL' ? 'WARNING' : latL, `Slow disk I/O (${lat.toFixed(1)} ms per request)`);
  }

  // ── Network ──
  if (!srv.networkInterfaces) cat('network', 'Network', 'UNKNOWN', `${(t.networkInKbps / 1000).toFixed(1)} / ${(t.networkOutKbps / 1000).toFixed(1)} Mbps · per-interface data needs agent 3.3`);
  else {
    const levels: TelemetryLevel[] = ['HEALTHY'];
    for (const i of srv.networkInterfaces) {
      const bad = (i.newErrors ?? 0) + (i.newDrops ?? 0);
      const l = levelOf(bad, THRESHOLDS.networkErrorsPerReport);
      const lw = l === 'CRITICAL' ? 'WARNING' : l;
      levels.push(lw);
      warn(`net-errors:${i.name}`, 'network', lw, `${i.name}: ${i.newErrors ?? 0} new error(s), ${i.newDrops ?? 0} new drop(s) since the last report`);
      if (i.virtual === false && i.operationalState === 'down') { levels.push('WARNING'); warn(`net-down:${i.name}`, 'network', 'WARNING', `Interface ${i.name} is down`); }
    }
    cat('network', 'Network', worstLevel(levels), `${srv.networkInterfaces.length} interface(s) · ${(t.networkInKbps / 1000).toFixed(1)} / ${(t.networkOutKbps / 1000).toFixed(1)} Mbps`);
  }

  // ── systemd ──
  {
    const failed = srv.services.filter(s => s.status === 'failed');
    const restarting = srv.services.filter(s => s.status === 'restarting');
    for (const s of failed) warn(`systemd:${s.name}`, 'systemd', 'CRITICAL', `Service ${s.name} FAILED`, true);
    for (const s of restarting) warn(`systemd:${s.name}`, 'systemd', 'WARNING', `Service ${s.name} is ${s.activeState ?? 'restarting'}`);
    const watched = new Set(srv.services.map(s => s.name.replace(/\.service$/, '')));
    const others = (srv.failedUnits?.units ?? []).filter(u => !watched.has(u.replace(/\.service$/, '')));
    if (others.length) warn('systemd-failed-units', 'systemd', 'WARNING', `${others.length} other failed unit(s): ${others.join(', ')}`);
    const level: TelemetryLevel = failed.length ? 'CRITICAL' : restarting.length || others.length ? 'WARNING'
      : srv.services.length || srv.failedUnits ? 'HEALTHY' : 'UNKNOWN';
    cat('systemd', 'Systemd', level, srv.services.length || srv.failedUnits
      ? `${srv.services.length} watched · ${failed.length} failed${srv.failedUnits ? ` · ${srv.failedUnits.count} failed unit(s) on host` : ''}`
      : 'No services reported — set SERVICES in /etc/scholario-agent.conf');
  }

  // ── PM2 ──
  if (srv.pm2 === undefined) cat('pm2', 'PM2', 'UNKNOWN', 'Not reported (agent < 3.3)');
  else if (srv.pm2 === null) cat('pm2', 'PM2', 'UNKNOWN', 'PM2 not running on this server');
  else {
    const levels: TelemetryLevel[] = ['HEALTHY'];
    const r = THRESHOLDS.pm2Restarts;
    for (const p of srv.pm2) {
      if (p.status === 'errored') { levels.push('CRITICAL'); warn(`pm2-errored:${p.name}`, 'pm2', 'CRITICAL', `PM2 app ${p.name} ERRORED`, true); }
      else if (p.status === 'stopped') { levels.push('WARNING'); warn(`pm2-stopped:${p.name}`, 'pm2', 'WARNING', `PM2 app ${p.name} is stopped`); }
      else if (p.status !== 'online') { levels.push('WARNING'); warn(`pm2-state:${p.name}`, 'pm2', 'WARNING', `PM2 app ${p.name} is ${p.status}`); }
      const rl = levelOf(p.recentRestarts, r);
      if (rl === 'WARNING' || rl === 'CRITICAL') levels.push(rl);
      warn(`pm2-restarts:${p.name}`, 'pm2', rl, `PM2 app ${p.name} restarted ${p.recentRestarts} time(s) in ${r.restartWindowMinutes} min`, rl === 'CRITICAL');
    }
    const online = srv.pm2.filter(p => p.status === 'online').length;
    cat('pm2', 'PM2', worstLevel(levels), `${online}/${srv.pm2.length} online`);
  }

  // ── Local application health ──
  if (!srv.appHealth?.length) cat('apps', 'App health', 'UNKNOWN', 'No local check — set the app port for this environment in Setup');
  else {
    const levels: TelemetryLevel[] = [];
    for (const c of srv.appHealth) {
      if (c.status === 'DOWN') {
        const crit = c.consecutiveFailures >= THRESHOLDS.localHealthFailuresForAlert;
        levels.push(crit ? 'CRITICAL' : 'WARNING');
        warn(`app-health:${c.applicationId}:${c.port}`, 'apps', crit ? 'CRITICAL' : 'WARNING',
          `${c.name || 'Application'} local health check FAILED on port ${c.port}${c.listening === false ? ' (port not listening)' : ''}: ${c.error ?? 'error'}`, crit);
      } else if (c.status === 'HEALTHY') {
        const l = levelOf(c.latencyMs, THRESHOLDS.localHealthLatencyMs);
        levels.push(l === 'UNKNOWN' ? 'HEALTHY' : l);
        warn(`app-latency:${c.applicationId}:${c.port}`, 'apps', l === 'CRITICAL' ? 'WARNING' : l, `${c.name} responds slowly locally (${c.latencyMs} ms)`);
      } else levels.push('UNKNOWN');
    }
    const up = srv.appHealth.filter(c => c.status === 'HEALTHY').length;
    cat('apps', 'App health', worstLevel(levels), `${up}/${srv.appHealth.length} local check(s) healthy`);
  }

  // ── Database (the existing db-down / replication alerts cover incidents) ──
  if (!srv.databases?.length) cat('database', 'Database', 'UNKNOWN', 'No database probe (set DB_ENGINE in /etc/scholario-agent.conf)');
  else {
    const levels: TelemetryLevel[] = [];
    for (const d of srv.databases) {
      const label = `${d.engine}${d.name ? ` ${d.name}` : ''}`;
      if (!d.available) { levels.push('CRITICAL'); warn(`db-down:${label}`, 'database', 'CRITICAL', `Database ${label} unavailable: ${d.error ?? 'no error text'}`); continue; }
      const cl = levelOf(d.connectionUsagePercent, THRESHOLDS.dbConnectionUsagePercent as Band);
      levels.push(cl === 'UNKNOWN' ? 'HEALTHY' : cl);
      warn(`db-connections:${label}`, 'database', cl, `Database ${label} connections at ${fmt(d.connectionUsagePercent)} of max`);
      if (d.longRunningQueries) { levels.push('WARNING'); warn(`db-long-queries:${label}`, 'database', 'WARNING', `${d.longRunningQueries} query(ies) running > 60 s on ${label}`); }
      if (d.replication?.role === 'replica' && d.replication.state !== 'running') { levels.push('WARNING'); warn(`db-replication:${label}`, 'database', 'WARNING', `Replication ${d.replication.state}${d.replication.error ? `: ${d.replication.error}` : ''}`); }
    }
    cat('database', 'Database', worstLevel(levels), srv.databases.map(d => `${d.engine} ${d.available ? 'up' : 'DOWN'}${d.latencyMs != null ? ` ${d.latencyMs} ms` : ''}`).join(' · '));
  }
  return { health, warnings };
}
