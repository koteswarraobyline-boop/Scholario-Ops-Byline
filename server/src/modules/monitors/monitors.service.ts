import { v4 as uuidv4 } from 'uuid';
import https from 'https';
import http from 'http';
import net from 'net';
import dns from 'dns';
import tls from 'tls';
import { query, queryOne } from '../../database/pool';
import { cacheDel } from '../../database/redis';
import { NotFoundError } from '../../utils/errors';
import { parsePagination } from '../../utils/response';
import { logger } from '../../utils/logger';

export interface Monitor {
  id: string;
  name: string;
  type: string;
  target: string;
  application_id: string | null;
  server_id: string | null;
  environment: string;
  interval_sec: number;
  timeout_sec: number;
  retries: number;
  warning_threshold_ms: number;
  critical_threshold_ms: number;
  failure_confirmation_threshold: number;
  recovery_confirmation_threshold: number;
  consecutive_failures: number;
  consecutive_recoveries: number;
  status: string;
  last_check: string | null;
  last_success: string | null;
  last_failure: string | null;
  response_time_ms: number | null;
  uptime_percent: number | null;
  enabled: boolean;
  active_maintenance: boolean;
}

export interface CheckResult {
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';
  responseTimeMs: number;
  statusCode?: number;
  detail: string;
  error?: string;
}

export const MonitorsService = {
  async list(params: {
    page?: number; pageSize?: number;
    applicationId?: string; status?: string;
    type?: string; environment?: string; enabled?: boolean;
  }) {
    const { page, pageSize, offset } = parsePagination(params as Record<string, unknown>);
    const conds: string[] = ['m.deleted_at IS NULL'];
    const vals: unknown[] = [];
    let i = 1;

    if (params.applicationId) { conds.push(`m.application_id = $${i++}`); vals.push(params.applicationId); }
    if (params.status)        { conds.push(`m.status = $${i++}`);         vals.push(params.status); }
    if (params.type)          { conds.push(`m.type = $${i++}`);           vals.push(params.type); }
    if (params.environment)   { conds.push(`m.environment = $${i++}`);    vals.push(params.environment); }
    if (params.enabled !== undefined) { conds.push(`m.enabled = $${i++}`); vals.push(params.enabled); }

    const where = `WHERE ${conds.join(' AND ')}`;
    const [cnt] = await query<{ count: string }>(`SELECT COUNT(*) as count FROM monitors m ${where}`, vals);
    const total = parseInt(cnt?.count ?? '0', 10);

    const rows = await query<Monitor>(
      `SELECT m.*, a.name AS app_name
       FROM monitors m
       LEFT JOIN applications a ON a.id = m.application_id
       ${where} ORDER BY m.name ASC
       LIMIT $${i} OFFSET $${i + 1}`,
      [...vals, pageSize, offset]
    );

    return { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  },

  async getById(id: string): Promise<Monitor & { recent_results?: unknown[] }> {
    const mon = await queryOne<Monitor>(
      `SELECT m.*, a.name AS app_name
       FROM monitors m
       LEFT JOIN applications a ON a.id = m.application_id
       WHERE m.id = $1 AND m.deleted_at IS NULL`,
      [id]
    );
    if (!mon) throw new NotFoundError('Monitor');

    const recent_results = await query(
      `SELECT * FROM monitor_results WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 20`,
      [id]
    );

    return { ...mon, recent_results };
  },

  async create(data: {
    name: string; type: string; target: string;
    applicationId?: string; serverId?: string;
    environment?: string; intervalSec?: number;
    timeoutSec?: number; retries?: number;
    warningThresholdMs?: number; criticalThresholdMs?: number;
    failureConfirmationThreshold?: number;
    recoveryConfirmationThreshold?: number;
    runbookId?: string;
  }): Promise<Monitor> {
    const [mon] = await query<Monitor>(
      `INSERT INTO monitors
         (id,name,type,target,application_id,server_id,environment,
          interval_sec,timeout_sec,retries,
          warning_threshold_ms,critical_threshold_ms,
          failure_confirmation_threshold,recovery_confirmation_threshold,
          runbook_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        uuidv4(), data.name, data.type, data.target,
        data.applicationId ?? null, data.serverId ?? null,
        data.environment ?? 'PRD',
        data.intervalSec ?? 30, data.timeoutSec ?? 10, data.retries ?? 2,
        data.warningThresholdMs ?? 500, data.criticalThresholdMs ?? 2000,
        data.failureConfirmationThreshold ?? 3,
        data.recoveryConfirmationThreshold ?? 3,
        data.runbookId ?? null,
      ]
    );
    return mon;
  },

  async update(id: string, data: Partial<{
    name: string; target: string; enabled: boolean;
    intervalSec: number; timeoutSec: number; retries: number;
    warningThresholdMs: number; criticalThresholdMs: number;
    failureConfirmationThreshold: number;
    recoveryConfirmationThreshold: number;
  }>): Promise<Monitor> {
    const existing = await queryOne(`SELECT id FROM monitors WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!existing) throw new NotFoundError('Monitor');

    const setClauses = ['updated_at = NOW()'];
    const vals: unknown[] = [];
    let i = 1;

    const map: Record<string, string> = {
      name: 'name', target: 'target', enabled: 'enabled',
      intervalSec: 'interval_sec', timeoutSec: 'timeout_sec', retries: 'retries',
      warningThresholdMs: 'warning_threshold_ms', criticalThresholdMs: 'critical_threshold_ms',
      failureConfirmationThreshold: 'failure_confirmation_threshold',
      recoveryConfirmationThreshold: 'recovery_confirmation_threshold',
    };

    for (const [k, col] of Object.entries(map)) {
      if ((data as Record<string, unknown>)[k] !== undefined) {
        setClauses.push(`${col} = $${i++}`);
        vals.push((data as Record<string, unknown>)[k]);
      }
    }

    vals.push(id);
    const [updated] = await query<Monitor>(
      `UPDATE monitors SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`, vals
    );
    return updated;
  },

  async softDelete(id: string): Promise<void> {
    await query(`UPDATE monitors SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [id]);
  },

  // ── Core probe execution ────────────────────────────────────────────────────

  async runProbe(monitorId: string): Promise<CheckResult> {
    const mon = await queryOne<Monitor>(
      `SELECT * FROM monitors WHERE id = $1 AND deleted_at IS NULL`,
      [monitorId]
    );
    if (!mon) throw new NotFoundError('Monitor');

    if (!mon.enabled || mon.active_maintenance) {
      return { status: 'UNKNOWN', responseTimeMs: 0, detail: 'Monitor disabled or in maintenance' };
    }

    let result: CheckResult;
    try {
      result = await this._executeCheck(mon);
    } catch (err) {
      result = {
        status: 'CRITICAL', responseTimeMs: mon.timeout_sec * 1000,
        detail: 'Check threw an exception',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    await this._recordResult(mon, result);
    return result;
  },

  async _executeCheck(mon: Monitor): Promise<CheckResult> {
    const start = Date.now();

    switch (mon.type) {
      case 'HTTP':
      case 'HTTPS':
      case 'APP_HEALTH':
      case 'APP_READINESS':
      case 'API_BUSINESS':
        return this._httpCheck(mon, start);

      case 'TCP':
        return this._tcpCheck(mon, start);

      case 'DNS':
        return this._dnsCheck(mon, start);

      case 'SSL':
        return this._sslCheck(mon, start);

      case 'DEAD_MAN':
        return this._deadManCheck(mon, start);

      default:
        return { status: 'UNKNOWN', responseTimeMs: 0, detail: `Unsupported monitor type: ${mon.type}` };
    }
  },

  async _httpCheck(mon: Monitor, start: number): Promise<CheckResult> {
    return new Promise((resolve) => {
      const url = new URL(mon.target);
      const lib = url.protocol === 'https:' ? https : http;
      const timeout = mon.timeout_sec * 1000;

      const req = lib.request(
        { hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search, method: 'GET',
          timeout, headers: { 'User-Agent': 'Scholario-Monitor/2.0' } },
        (res) => {
          res.on('data', () => {}); // drain
          res.on('end', () => {
            const ms = Date.now() - start;
            const code = res.statusCode ?? 0;
            const ok = code >= 200 && code < 400;
            const status = !ok ? 'CRITICAL'
              : ms > mon.critical_threshold_ms ? 'CRITICAL'
              : ms > mon.warning_threshold_ms ? 'WARNING'
              : 'HEALTHY';
            resolve({ status, responseTimeMs: ms, statusCode: code,
              detail: ok ? `HTTP ${code} in ${ms}ms` : `HTTP ${code} (expected 2xx/3xx)` });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 'CRITICAL', responseTimeMs: timeout,
          detail: `Request timed out after ${mon.timeout_sec}s`, error: 'TIMEOUT' });
      });

      req.on('error', (err) => {
        resolve({ status: 'CRITICAL', responseTimeMs: Date.now() - start,
          detail: `Connection error: ${err.message}`, error: err.message });
      });

      req.end();
    });
  },

  async _tcpCheck(mon: Monitor, start: number): Promise<CheckResult> {
    return new Promise((resolve) => {
      const [host, portStr] = mon.target.split(':');
      const port = parseInt(portStr, 10);
      const timeout = mon.timeout_sec * 1000;
      const socket = new net.Socket();

      socket.setTimeout(timeout);
      socket.connect(port, host, () => {
        const ms = Date.now() - start;
        socket.destroy();
        const status = ms > mon.critical_threshold_ms ? 'CRITICAL'
          : ms > mon.warning_threshold_ms ? 'WARNING' : 'HEALTHY';
        resolve({ status, responseTimeMs: ms, detail: `TCP connected in ${ms}ms` });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({ status: 'CRITICAL', responseTimeMs: timeout,
          detail: `TCP timeout after ${mon.timeout_sec}s`, error: 'TIMEOUT' });
      });

      socket.on('error', (err) => {
        resolve({ status: 'CRITICAL', responseTimeMs: Date.now() - start,
          detail: `TCP error: ${err.message}`, error: err.message });
      });
    });
  },

  async _dnsCheck(mon: Monitor, start: number): Promise<CheckResult> {
    return new Promise((resolve) => {
      dns.resolve(mon.target, (err) => {
        const ms = Date.now() - start;
        if (err) {
          resolve({ status: 'CRITICAL', responseTimeMs: ms,
            detail: `DNS resolution failed: ${err.message}`, error: err.message });
        } else {
          const status = ms > mon.critical_threshold_ms ? 'CRITICAL'
            : ms > mon.warning_threshold_ms ? 'WARNING' : 'HEALTHY';
          resolve({ status, responseTimeMs: ms, detail: `DNS resolved in ${ms}ms` });
        }
      });
    });
  },

  async _sslCheck(mon: Monitor, start: number): Promise<CheckResult> {
    return new Promise((resolve) => {
      const [host, portStr] = mon.target.includes(':')
        ? mon.target.split(':') : [mon.target, '443'];
      const port = parseInt(portStr, 10);
      const socket = tls.connect(port, host, { servername: host }, () => {
        const ms = Date.now() - start;
        const cert = socket.getPeerCertificate();
        socket.destroy();

        if (!cert.valid_to) {
          resolve({ status: 'CRITICAL', responseTimeMs: ms, detail: 'Could not read certificate expiry' });
          return;
        }

        const expiresAt = new Date(cert.valid_to);
        const daysLeft = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000);
        const status = daysLeft < 7 ? 'CRITICAL' : daysLeft < 30 ? 'WARNING' : 'HEALTHY';
        resolve({ status, responseTimeMs: ms,
          detail: `SSL valid, expires ${cert.valid_to} (${daysLeft} days)` });
      });

      socket.on('error', (err) => {
        resolve({ status: 'CRITICAL', responseTimeMs: Date.now() - start,
          detail: `SSL error: ${err.message}`, error: err.message });
      });

      socket.setTimeout(mon.timeout_sec * 1000, () => {
        socket.destroy();
        resolve({ status: 'CRITICAL', responseTimeMs: mon.timeout_sec * 1000,
          detail: `SSL check timed out`, error: 'TIMEOUT' });
      });
    });
  },

  async _deadManCheck(mon: Monitor, _start: number): Promise<CheckResult> {
    // Dead-man monitors are driven by the external watchdog sending heartbeats.
    // Here we check if the last known heartbeat is within tolerance.
    const dmRow = await queryOne<{ last_heartbeat_received_at: string; tolerance_sec: number }>(
      `SELECT last_heartbeat_received_at, tolerance_sec
       FROM dead_man_controls WHERE target_control_plane = $1 LIMIT 1`,
      [mon.target]
    );

    if (!dmRow?.last_heartbeat_received_at) {
      return { status: 'CRITICAL', responseTimeMs: 0, detail: 'No heartbeat received yet' };
    }

    const ageSec = (Date.now() - new Date(dmRow.last_heartbeat_received_at).getTime()) / 1000;
    const tolerance = dmRow.tolerance_sec;
    const status = ageSec > tolerance * 2 ? 'CRITICAL'
      : ageSec > tolerance ? 'WARNING' : 'HEALTHY';
    return { status, responseTimeMs: Math.round(ageSec * 1000),
      detail: `Last heartbeat ${Math.round(ageSec)}s ago (tolerance: ${tolerance}s)` };
  },

  async _recordResult(mon: Monitor, result: CheckResult): Promise<void> {
    const isFailure = result.status === 'CRITICAL' || result.status === 'WARNING';
    const newFails = isFailure ? mon.consecutive_failures + 1 : 0;
    const newRecoveries = !isFailure ? mon.consecutive_recoveries + 1 : 0;

    // Determine confirmed status based on thresholds
    let confirmedStatus = mon.status;
    if (newFails >= mon.failure_confirmation_threshold) {
      confirmedStatus = result.status;
    } else if (newRecoveries >= mon.recovery_confirmation_threshold) {
      confirmedStatus = 'HEALTHY';
    }

    await query(
      `UPDATE monitors SET
         status = $1,
         consecutive_failures = $2,
         consecutive_recoveries = $3,
         last_check = NOW(),
         last_success = CASE WHEN $4 THEN NOW() ELSE last_success END,
         last_failure = CASE WHEN $5 THEN NOW() ELSE last_failure END,
         response_time_ms = $6,
         updated_at = NOW()
       WHERE id = $7`,
      [
        confirmedStatus, newFails, newRecoveries,
        !isFailure, isFailure,
        result.responseTimeMs, mon.id,
      ]
    );

    await query(
      `INSERT INTO monitor_results (id,monitor_id,status,response_time_ms,status_code,detail,error,checked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [uuidv4(), mon.id, result.status, result.responseTimeMs,
       result.statusCode ?? null, result.detail, result.error ?? null]
    );
  },
};
