import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../../database/pool';
import { NotFoundError } from '../../utils/errors';
import { parsePagination } from '../../utils/response';
import { logger } from '../../utils/logger';

export interface Incident {
  id: string;
  ticket_number: string;
  title: string;
  severity: string;
  status: string;
  application_id: string | null;
  server_id: string | null;
  monitor_id: string | null;
  environment: string;
  fingerprint: string;
  root_cause: string | null;
  started_at: string;
  resolved_at: string | null;
  duration_minutes: number | null;
  owner_id: string | null;
  owner_name: string | null;
  acknowledged: boolean;
  acknowledged_at: string | null;
  acknowledged_by_name: string | null;
  affected_services: string[];
  affected_monitors: string[];
  recovery_status: string | null;
  runbook_id: string | null;
  mitigation_action: string | null;
  triggered_by_deployment_id: string | null;
}

export interface IncidentEvent {
  id: string;
  incident_id: string;
  source: string;
  level: string;
  message: string;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

export interface CreateIncidentInput {
  title: string;
  severity: string;
  applicationId?: string;
  serverId?: string;
  monitorId?: string;
  environment?: string;
  fingerprint: string;
  rootCause?: string;
  affectedServices?: string[];
  affectedMonitors?: string[];
  runbookId?: string;
  triggeredByDeploymentId?: string;
}

// Build a deterministic fingerprint from failure context
export function buildFingerprint(params: {
  applicationId?: string;
  monitorId?: string;
  serverId?: string;
  failureType: string;
  environment: string;
}): string {
  const parts = [
    params.applicationId ?? 'global',
    params.environment,
    params.monitorId ?? params.serverId ?? 'system',
    params.failureType,
  ];
  return parts.join(':').toLowerCase().replace(/[^a-z0-9:_-]/g, '_');
}

export const IncidentsService = {
  async list(params: {
    page?: number; pageSize?: number;
    status?: string; severity?: string;
    applicationId?: string; environment?: string;
    open?: boolean;
  }) {
    const { page, pageSize, offset } = parsePagination(params as Record<string, unknown>);
    const conds: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    if (params.status)        { conds.push(`i.status = $${i++}`);          vals.push(params.status); }
    if (params.severity)      { conds.push(`i.severity = $${i++}`);        vals.push(params.severity); }
    if (params.applicationId) { conds.push(`i.application_id = $${i++}`);  vals.push(params.applicationId); }
    if (params.environment)   { conds.push(`i.environment = $${i++}`);     vals.push(params.environment); }
    if (params.open === true)  { conds.push(`i.status NOT IN ('RESOLVED','CLOSED')`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [cnt] = await query<{ count: string }>(`SELECT COUNT(*) as count FROM incidents i ${where}`, vals);
    const total = parseInt(cnt?.count ?? '0', 10);

    const rows = await query<Incident>(
      `SELECT i.*, a.name AS app_name
       FROM incidents i
       LEFT JOIN applications a ON a.id = i.application_id
       ${where} ORDER BY i.started_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      [...vals, pageSize, offset]
    );

    return { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  },

  async getById(id: string) {
    const inc = await queryOne<Incident>(
      `SELECT i.*, a.name AS app_name, a.code_name AS app_code
       FROM incidents i
       LEFT JOIN applications a ON a.id = i.application_id
       WHERE i.id = $1 OR i.ticket_number = $1`,
      [id]
    );
    if (!inc) throw new NotFoundError('Incident');

    const events = await query<IncidentEvent>(
      `SELECT * FROM incident_events WHERE incident_id = $1 ORDER BY occurred_at ASC`,
      [inc.id]
    );

    const notes = await query(
      `SELECT * FROM incident_notes WHERE incident_id = $1 ORDER BY created_at ASC`,
      [inc.id]
    );

    return { ...inc, timeline: events, notes };
  },

  // Core deduplication: find open incident by fingerprint
  async findOpenByFingerprint(fingerprint: string): Promise<Incident | null> {
    return queryOne<Incident>(
      `SELECT * FROM incidents
       WHERE fingerprint = $1 AND status NOT IN ('RESOLVED','CLOSED')
       ORDER BY started_at DESC LIMIT 1`,
      [fingerprint]
    );
  },

  // Create or update based on fingerprint — prevents duplicate incidents
  async createOrUpdate(input: CreateIncidentInput, source = 'monitoring-engine'): Promise<Incident> {
    const existing = await this.findOpenByFingerprint(input.fingerprint);

    if (existing) {
      // Update last-seen and add a timeline event
      await this._addEvent(existing.id, source, 'WARN',
        `Repeated failure detected (fingerprint: ${input.fingerprint})`);
      logger.debug({ incidentId: existing.id }, 'Deduplicated incident — updating existing');
      return existing;
    }

    // Generate ticket number
    const [seqRow] = await query<{ nextval: string }>(
      `SELECT nextval('incident_ticket_seq')::text`
    );
    const ticketNumber = `INC-${seqRow.nextval}`;

    const [inc] = await query<Incident>(
      `INSERT INTO incidents
         (id,ticket_number,title,severity,status,application_id,server_id,monitor_id,
          environment,fingerprint,root_cause,affected_services,affected_monitors,
          runbook_id,triggered_by_deployment_id)
       VALUES ($1,$2,$3,$4,'OPEN',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        uuidv4(), ticketNumber, input.title, input.severity,
        input.applicationId ?? null, input.serverId ?? null, input.monitorId ?? null,
        input.environment ?? 'PRD', input.fingerprint, input.rootCause ?? null,
        input.affectedServices ?? [], input.affectedMonitors ?? [],
        input.runbookId ?? null, input.triggeredByDeploymentId ?? null,
      ]
    );

    await this._addEvent(inc.id, source, 'CRITICAL',
      `Incident created: ${input.title}. Fingerprint: ${input.fingerprint}`);

    logger.info({ incidentId: inc.id, ticket: ticketNumber }, 'New incident created');
    return inc;
  },

  async acknowledge(id: string, operatorId: string, operatorName: string): Promise<Incident> {
    const inc = await queryOne<Incident>(`SELECT * FROM incidents WHERE id = $1`, [id]);
    if (!inc) throw new NotFoundError('Incident');

    const [updated] = await query<Incident>(
      `UPDATE incidents SET
         acknowledged = TRUE,
         acknowledged_at = NOW(),
         acknowledged_by_id = $1,
         acknowledged_by_name = $2,
         status = CASE WHEN status = 'OPEN' THEN 'ACKNOWLEDGED' ELSE status END,
         updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [operatorId, operatorName, id]
    );

    await this._addEvent(id, operatorName, 'INFO', `Incident acknowledged by ${operatorName}`);
    return updated;
  },

  async changeStatus(id: string, status: string, operator: string, operatorId: string): Promise<Incident> {
    const [updated] = await query<Incident>(
      `UPDATE incidents SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );
    if (!updated) throw new NotFoundError('Incident');
    await this._addEvent(id, operator, 'INFO', `Status changed to ${status}`);
    return updated;
  },

  async changeSeverity(id: string, severity: string, operator: string): Promise<Incident> {
    const [updated] = await query<Incident>(
      `UPDATE incidents SET severity = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [severity, id]
    );
    if (!updated) throw new NotFoundError('Incident');
    await this._addEvent(id, operator, 'WARN', `Severity changed to ${severity}`);
    return updated;
  },

  async assignOwner(id: string, ownerName: string, ownerId: string, operator: string): Promise<Incident> {
    const [updated] = await query<Incident>(
      `UPDATE incidents SET owner_id = $1, owner_name = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [ownerId, ownerName, id]
    );
    if (!updated) throw new NotFoundError('Incident');
    await this._addEvent(id, operator, 'INFO', `Ownership assigned to ${ownerName}`);
    return updated;
  },

  async addNote(id: string, content: string, authorId: string, authorName: string, authorRole?: string): Promise<void> {
    if (!content.trim()) return;
    await query(
      `INSERT INTO incident_notes (id,incident_id,author_id,author_name,author_role,content)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [uuidv4(), id, authorId, authorName, authorRole ?? null, content.trim()]
    );
    await this._addEvent(id, authorName, 'INFO',
      `Investigation note added: "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}"`);
  },

  async resolve(id: string, resolution: string, operator: string, operatorId: string): Promise<Incident> {
    const inc = await queryOne<Incident>(`SELECT started_at FROM incidents WHERE id = $1`, [id]);
    if (!inc) throw new NotFoundError('Incident');

    const durationMin = Math.round(
      (Date.now() - new Date(inc.started_at).getTime()) / 60_000
    );

    const [updated] = await query<Incident>(
      `UPDATE incidents SET
         status = 'RESOLVED', resolved_at = NOW(),
         duration_minutes = $1, recovery_status = $2,
         updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [durationMin, resolution, id]
    );

    await this._addEvent(id, operator, 'SUCCESS',
      `Incident resolved by ${operator}. ${resolution}`);
    return updated;
  },

  async _addEvent(
    incidentId: string, source: string, level: string, message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await query(
      `INSERT INTO incident_events (id,incident_id,source,level,message,metadata)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [uuidv4(), incidentId, source, level, message, JSON.stringify(metadata ?? {})]
    );
  },
};
