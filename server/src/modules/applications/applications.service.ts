import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, withTransaction } from '../../database/pool';
import { cacheGet, cacheSet, cacheDel } from '../../database/redis';
import { NotFoundError, ConflictError } from '../../utils/errors';
import { parsePagination } from '../../utils/response';

const CACHE_TTL = 30; // seconds

export interface Application {
  id: string;
  name: string;
  code_name: string;
  description: string | null;
  tier: string;
  status: string;
  uptime_24h: number | null;
  uptime_7d: number | null;
  uptime_30d: number | null;
  rto_target_min: number;
  rpo_target_min: number;
  prd_server_id: string | null;
  dr_server_id: string | null;
  failover_state: string;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  error_rate_percent: number | null;
  cloudflare_zone: string | null;
  recent_deployment_version: string | null;
  last_tested_recovery_date: string | null;
  last_tested_recovery_duration_min: number | null;
  current_replication_lag_sec: number | null;
  last_checked: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppWithDetail extends Application {
  prd_server?: Record<string, unknown> | null;
  dr_server?: Record<string, unknown> | null;
  dependencies?: AppDependency[];
  active_incident_count?: number;
  open_monitor_failures?: number;
}

export interface AppDependency {
  id: string;
  application_id: string;
  name: string;
  type: string;
  status: string;
  latency_ms: number | null;
  target: string | null;
  last_checked: string | null;
}

export const ApplicationsService = {
  async list(params: {
    page?: number;
    pageSize?: number;
    status?: string;
    tier?: string;
    search?: string;
  }) {
    const { page, pageSize, offset } = parsePagination({
      page: params.page,
      pageSize: params.pageSize,
    });

    const conditions: string[] = ['a.deleted_at IS NULL'];
    const values: unknown[] = [];
    let idx = 1;

    if (params.status) {
      conditions.push(`a.status = $${idx++}`);
      values.push(params.status);
    }
    if (params.tier) {
      conditions.push(`a.tier = $${idx++}`);
      values.push(params.tier);
    }
    if (params.search) {
      conditions.push(`(a.name ILIKE $${idx} OR a.code_name ILIKE $${idx})`);
      values.push(`%${params.search}%`);
      idx++;
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [countRow] = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM applications a ${where}`,
      values
    );
    const total = parseInt(countRow?.count ?? '0', 10);

    const rows = await query<Application>(
      `SELECT a.*,
         ps.hostname AS prd_hostname, ps.ip AS prd_ip, ps.status AS prd_status,
         ds.hostname AS dr_hostname,  ds.ip AS dr_ip,  ds.status AS dr_status
       FROM applications a
       LEFT JOIN servers ps ON ps.id = a.prd_server_id
       LEFT JOIN servers ds ON ds.id = a.dr_server_id
       ${where}
       ORDER BY a.tier ASC, a.name ASC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, pageSize, offset]
    );

    return { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  },

  async getById(id: string): Promise<AppWithDetail> {
    const cacheKey = `app:${id}`;
    const cached = await cacheGet<AppWithDetail>(cacheKey);
    if (cached) return cached;

    const app = await queryOne<Application>(
      `SELECT a.*,
         row_to_json(ps.*) AS prd_server,
         row_to_json(ds.*) AS dr_server
       FROM applications a
       LEFT JOIN servers ps ON ps.id = a.prd_server_id
       LEFT JOIN servers ds ON ds.id = a.dr_server_id
       WHERE a.id = $1 AND a.deleted_at IS NULL`,
      [id]
    );
    if (!app) throw new NotFoundError('Application');

    const dependencies = await query<AppDependency>(
      `SELECT * FROM app_dependencies WHERE application_id = $1 ORDER BY name`,
      [id]
    );

    const [incRow] = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM incidents
       WHERE application_id = $1 AND status NOT IN ('RESOLVED','CLOSED')`,
      [id]
    );

    const [monRow] = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM monitors
       WHERE application_id = $1 AND status = 'CRITICAL' AND enabled = TRUE AND deleted_at IS NULL`,
      [id]
    );

    const result: AppWithDetail = {
      ...(app as AppWithDetail),
      dependencies,
      active_incident_count: parseInt(incRow?.count ?? '0', 10),
      open_monitor_failures: parseInt(monRow?.count ?? '0', 10),
    };

    await cacheSet(cacheKey, result, CACHE_TTL);
    return result;
  },

  async getByCodeName(codeName: string): Promise<AppWithDetail> {
    const app = await queryOne<{ id: string }>(
      `SELECT id FROM applications WHERE code_name = $1 AND deleted_at IS NULL`,
      [codeName]
    );
    if (!app) throw new NotFoundError('Application');
    return this.getById(app.id);
  },

  async create(data: {
    name: string;
    codeName: string;
    description?: string;
    tier: string;
    rtoTargetMin?: number;
    rpoTargetMin?: number;
    cloudflareZone?: string;
  }): Promise<Application> {
    const existing = await queryOne(
      `SELECT id FROM applications WHERE code_name = $1`,
      [data.codeName]
    );
    if (existing) throw new ConflictError(`Application '${data.codeName}' already exists`);

    const [app] = await query<Application>(
      `INSERT INTO applications
         (id, name, code_name, description, tier, status,
          rto_target_min, rpo_target_min, cloudflare_zone)
       VALUES ($1,$2,$3,$4,$5,'UNKNOWN',$6,$7,$8)
       RETURNING *`,
      [
        uuidv4(),
        data.name,
        data.codeName,
        data.description ?? null,
        data.tier ?? 'TIER_2',
        data.rtoTargetMin ?? 30,
        data.rpoTargetMin ?? 15,
        data.cloudflareZone ?? null,
      ]
    );
    return app;
  },

  async update(id: string, data: Partial<{
    name: string;
    description: string;
    tier: string;
    status: string;
    rtoTargetMin: number;
    rpoTargetMin: number;
    cloudflareZone: string;
    prdServerId: string;
    drServerId: string;
    recentDeploymentVersion: string;
  }>): Promise<Application> {
    const app = await queryOne<Application>(
      `SELECT id FROM applications WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!app) throw new NotFoundError('Application');

    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let idx = 1;

    const fieldMap: Record<string, string> = {
      name: 'name',
      description: 'description',
      tier: 'tier',
      status: 'status',
      rtoTargetMin: 'rto_target_min',
      rpoTargetMin: 'rpo_target_min',
      cloudflareZone: 'cloudflare_zone',
      prdServerId: 'prd_server_id',
      drServerId: 'dr_server_id',
      recentDeploymentVersion: 'recent_deployment_version',
    };

    for (const [key, col] of Object.entries(fieldMap)) {
      if (data[key as keyof typeof data] !== undefined) {
        setClauses.push(`${col} = $${idx++}`);
        values.push(data[key as keyof typeof data]);
      }
    }

    values.push(id);
    const [updated] = await query<Application>(
      `UPDATE applications SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    await cacheDel(`app:${id}`);
    return updated;
  },

  async updateFailoverState(id: string, state: string, initiatedBy?: string): Promise<void> {
    await query(
      `UPDATE applications
       SET failover_state = $1, failover_initiated_at = NOW(), failover_initiated_by = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [state, initiatedBy ?? null, id]
    );
    await cacheDel(`app:${id}`);
  },

  async softDelete(id: string): Promise<void> {
    await query(
      `UPDATE applications SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id]
    );
    await cacheDel(`app:${id}`);
  },

  async upsertDependency(
    applicationId: string,
    dep: Omit<AppDependency, 'id' | 'application_id'>
  ): Promise<AppDependency> {
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM app_dependencies WHERE application_id = $1 AND name = $2`,
      [applicationId, dep.name]
    );

    if (existing) {
      const [updated] = await query<AppDependency>(
        `UPDATE app_dependencies
         SET status = $1, latency_ms = $2, target = $3, last_checked = NOW(), updated_at = NOW()
         WHERE id = $4 RETURNING *`,
        [dep.status, dep.latency_ms ?? null, dep.target ?? null, existing.id]
      );
      return updated;
    }

    const [created] = await query<AppDependency>(
      `INSERT INTO app_dependencies (id, application_id, name, type, status, latency_ms, target, last_checked)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
      [uuidv4(), applicationId, dep.name, dep.type, dep.status, dep.latency_ms ?? null, dep.target ?? null]
    );
    return created;
  },
};
