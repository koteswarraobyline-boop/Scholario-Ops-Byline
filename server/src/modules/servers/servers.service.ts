import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../../database/pool';
import { cacheGet, cacheSet, cacheDel } from '../../database/redis';
import { NotFoundError, ConflictError } from '../../utils/errors';
import { parsePagination } from '../../utils/response';

const CACHE_TTL = 15;

export interface Server {
  id: string;
  hostname: string;
  ip: string;
  application_id: string | null;
  environment: string;
  provider: string;
  region: string;
  plan: string | null;
  cpu_cores: number | null;
  ram_gb: number | null;
  disk_gb: number | null;
  os: string | null;
  status: string;
  agent_version: string | null;
  agent_status: string;
  uptime_days: number | null;
  last_seen: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServerMetric {
  id: string;
  server_id: string;
  cpu_percent: number;
  ram_percent: number;
  disk_percent: number;
  load_avg_1m: number;
  load_avg_5m: number;
  load_avg_15m: number;
  network_in_kbps: number;
  network_out_kbps: number;
  observed_at: string;
  received_at: string;
}

export interface TelemetryPayload {
  serverId: string;
  agentId?: string;
  agentVersion?: string;
  cpuPercent: number;
  ramPercent: number;
  diskPercent: number;
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
  networkInKbps: number;
  networkOutKbps: number;
  observedAt: string;
  services?: Array<{
    name: string; status: string; version?: string;
    pid?: number; memoryMb?: number; cpuPercent?: number; lastRestart?: string;
  }>;
  processes?: Array<{
    pid: number; name: string; user?: string;
    cpuPercent?: number; memMb?: number; status?: string;
  }>;
  logs?: Array<{ level: string; service?: string; message: string; loggedAt?: string }>;
}

export const ServersService = {
  async list(params: {
    page?: number; pageSize?: number;
    applicationId?: string; environment?: string;
    region?: string; status?: string;
  }) {
    const { page, pageSize, offset } = parsePagination(params as Record<string, unknown>);
    const conds: string[] = ['s.deleted_at IS NULL'];
    const vals: unknown[] = [];
    let i = 1;

    if (params.applicationId) { conds.push(`s.application_id = $${i++}`); vals.push(params.applicationId); }
    if (params.environment)   { conds.push(`s.environment = $${i++}`);    vals.push(params.environment); }
    if (params.region)        { conds.push(`s.region = $${i++}`);         vals.push(params.region); }
    if (params.status)        { conds.push(`s.status = $${i++}`);         vals.push(params.status); }

    const where = `WHERE ${conds.join(' AND ')}`;

    const [cnt] = await query<{ count: string }>(`SELECT COUNT(*) as count FROM servers s ${where}`, vals);
    const total = parseInt(cnt?.count ?? '0', 10);

    const rows = await query<Server & { app_name?: string }>(
      `SELECT s.*, a.name AS app_name
       FROM servers s
       LEFT JOIN applications a ON a.id = s.application_id
       ${where}
       ORDER BY s.region ASC, s.hostname ASC
       LIMIT $${i} OFFSET $${i + 1}`,
      [...vals, pageSize, offset]
    );

    return { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  },

  async getById(id: string) {
    const cacheKey = `server:${id}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    const server = await queryOne<Server>(
      `SELECT s.*, a.name AS app_name, a.code_name AS app_code
       FROM servers s
       LEFT JOIN applications a ON a.id = s.application_id
       WHERE s.id = $1 AND s.deleted_at IS NULL`,
      [id]
    );
    if (!server) throw new NotFoundError('Server');

    const latestMetric = await queryOne<ServerMetric>(
      `SELECT * FROM server_metrics WHERE server_id = $1 ORDER BY observed_at DESC LIMIT 1`,
      [id]
    );

    const services = await query(
      `SELECT DISTINCT ON (name) * FROM server_services
       WHERE server_id = $1 ORDER BY name, recorded_at DESC`,
      [id]
    );

    const processes = await query(
      `SELECT * FROM server_processes
       WHERE server_id = $1 AND recorded_at = (
         SELECT MAX(recorded_at) FROM server_processes WHERE server_id = $1
       ) ORDER BY cpu_percent DESC LIMIT 20`,
      [id]
    );

    const logs = await query(
      `SELECT * FROM server_logs WHERE server_id = $1 ORDER BY logged_at DESC LIMIT 50`,
      [id]
    );

    const result = { ...server, telemetry: latestMetric, services, processes, logs };
    await cacheSet(cacheKey, result, CACHE_TTL);
    return result;
  },

  async create(data: {
    hostname: string; ip: string; applicationId?: string;
    environment: string; region: string; plan?: string;
    cpuCores?: number; ramGb?: number; diskGb?: number; os?: string;
  }) {
    const existing = await queryOne(`SELECT id FROM servers WHERE hostname = $1`, [data.hostname]);
    if (existing) throw new ConflictError(`Server '${data.hostname}' already exists`);

    const [srv] = await query<Server>(
      `INSERT INTO servers
         (id,hostname,ip,application_id,environment,region,plan,cpu_cores,ram_gb,disk_gb,os)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [uuidv4(), data.hostname, data.ip, data.applicationId ?? null,
       data.environment, data.region, data.plan ?? null,
       data.cpuCores ?? null, data.ramGb ?? null, data.diskGb ?? null, data.os ?? null]
    );
    return srv;
  },

  async update(id: string, data: Partial<{
    status: string; agentVersion: string; agentStatus: string;
    uptimeDays: number; lastSeen: string; os: string; plan: string;
  }>) {
    const server = await queryOne(`SELECT id FROM servers WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!server) throw new NotFoundError('Server');

    const setClauses: string[] = ['updated_at = NOW()'];
    const vals: unknown[] = [];
    let i = 1;

    const fieldMap: Record<string, string> = {
      status: 'status', agentVersion: 'agent_version',
      agentStatus: 'agent_status', uptimeDays: 'uptime_days',
      lastSeen: 'last_seen', os: 'os', plan: 'plan',
    };

    for (const [k, col] of Object.entries(fieldMap)) {
      if ((data as Record<string, unknown>)[k] !== undefined) {
        setClauses.push(`${col} = $${i++}`);
        vals.push((data as Record<string, unknown>)[k]);
      }
    }

    vals.push(id);
    const [updated] = await query<Server>(
      `UPDATE servers SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`, vals
    );
    await cacheDel(`server:${id}`);
    return updated;
  },

  async ingestTelemetry(payload: TelemetryPayload): Promise<void> {
    const server = await queryOne<{ id: string }>(
      `SELECT id FROM servers WHERE id = $1 AND deleted_at IS NULL`,
      [payload.serverId]
    );
    if (!server) throw new NotFoundError('Server');

    // Determine health status from telemetry
    let status = 'HEALTHY';
    if (payload.cpuPercent > 90 || payload.ramPercent > 90) status = 'CRITICAL';
    else if (payload.cpuPercent > 75 || payload.ramPercent > 80) status = 'WARNING';

    await query(
      `UPDATE servers SET status = $1, agent_status = 'CONNECTED',
        agent_version = COALESCE($2, agent_version),
        last_seen = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [status, payload.agentVersion ?? null, payload.serverId]
    );

    await query(
      `INSERT INTO server_metrics
         (id,server_id,cpu_percent,ram_percent,disk_percent,
          load_avg_1m,load_avg_5m,load_avg_15m,
          network_in_kbps,network_out_kbps,observed_at,received_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
      [
        uuidv4(), payload.serverId,
        payload.cpuPercent, payload.ramPercent, payload.diskPercent,
        payload.loadAvg1m, payload.loadAvg5m, payload.loadAvg15m,
        payload.networkInKbps, payload.networkOutKbps,
        payload.observedAt,
      ]
    );

    if (payload.services?.length) {
      await query(`DELETE FROM server_services WHERE server_id = $1`, [payload.serverId]);
      for (const svc of payload.services) {
        await query(
          `INSERT INTO server_services
             (id,server_id,name,status,version,pid,memory_mb,cpu_percent,last_restart)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [uuidv4(), payload.serverId, svc.name, svc.status,
           svc.version ?? null, svc.pid ?? null,
           svc.memoryMb ?? null, svc.cpuPercent ?? null, svc.lastRestart ?? null]
        );
      }
    }

    if (payload.processes?.length) {
      await query(`DELETE FROM server_processes WHERE server_id = $1`, [payload.serverId]);
      for (const proc of payload.processes) {
        await query(
          `INSERT INTO server_processes (id,server_id,pid,name,"user",cpu_percent,mem_mb,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [uuidv4(), payload.serverId, proc.pid, proc.name,
           proc.user ?? null, proc.cpuPercent ?? null,
           proc.memMb ?? null, proc.status ?? null]
        );
      }
    }

    if (payload.logs?.length) {
      for (const log of payload.logs) {
        await query(
          `INSERT INTO server_logs (id,server_id,level,service,message,logged_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [uuidv4(), payload.serverId, log.level, log.service ?? null,
           log.message, log.loggedAt ?? new Date().toISOString()]
        );
      }
    }

    await cacheDel(`server:${payload.serverId}`);
  },

  async getMetricsHistory(serverId: string, hoursBack = 1): Promise<ServerMetric[]> {
    return query<ServerMetric>(
      `SELECT * FROM server_metrics
       WHERE server_id = $1 AND observed_at >= NOW() - INTERVAL '${hoursBack} hours'
       ORDER BY observed_at ASC`,
      [serverId]
    );
  },

  async softDelete(id: string): Promise<void> {
    await query(`UPDATE servers SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [id]);
    await cacheDel(`server:${id}`);
  },
};
