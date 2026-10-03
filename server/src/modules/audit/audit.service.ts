import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../../database/pool';
import { parsePagination } from '../../utils/response';
import { logger } from '../../utils/logger';

type AuditCategory =
  | 'AUTH' | 'INCIDENT' | 'FAILOVER' | 'MAINTENANCE' | 'MONITOR'
  | 'CLOUDFLARE' | 'INFRASTRUCTURE' | 'RUNBOOK' | 'USER' | 'SYSTEM' | 'NOTIFICATION';

interface AuditEntry {
  operatorId?: string;
  operator: string;
  action: string;
  category: AuditCategory;
  targetId?: string;
  targetType?: string;
  details?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string | number;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  operator_id: string | null;
  operator: string;
  action: string;
  category: string;
  target_id: string | null;
  target_type: string | null;
  details: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  request_id: string | null;
}

export const AuditService = {
  async log(entry: AuditEntry): Promise<void> {
    try {
      await query(
        `INSERT INTO audit_logs
           (id, operator_id, operator, action, category, target_id, target_type,
            details, metadata, ip_address, user_agent, request_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          uuidv4(),
          entry.operatorId ?? null,
          entry.operator,
          entry.action,
          entry.category,
          entry.targetId ?? null,
          entry.targetType ?? null,
          entry.details ?? null,
          JSON.stringify(entry.metadata ?? {}),
          entry.ipAddress ?? null,
          entry.userAgent ?? null,
          entry.requestId ?? null,
        ]
      );
    } catch (err) {
      // Audit logging must never crash the main request
      logger.error({ err, entry }, 'Failed to write audit log');
    }
  },

  async list(params: {
    page?: number;
    pageSize?: number;
    category?: string;
    operatorId?: string;
    targetId?: string;
    from?: string;
    to?: string;
  }) {
    const { page, pageSize, offset } = parsePagination({
      page: params.page,
      pageSize: params.pageSize,
    });

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (params.category) {
      conditions.push(`category = $${idx++}`);
      values.push(params.category);
    }
    if (params.operatorId) {
      conditions.push(`operator_id = $${idx++}`);
      values.push(params.operatorId);
    }
    if (params.targetId) {
      conditions.push(`target_id = $${idx++}`);
      values.push(params.targetId);
    }
    if (params.from) {
      conditions.push(`timestamp >= $${idx++}`);
      values.push(params.from);
    }
    if (params.to) {
      conditions.push(`timestamp <= $${idx++}`);
      values.push(params.to);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRow] = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_logs ${where}`,
      values
    );
    const total = parseInt(countRow?.count ?? '0', 10);

    const rows = await query<AuditLog>(
      `SELECT * FROM audit_logs ${where}
       ORDER BY timestamp DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, pageSize, offset]
    );

    return {
      data: rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  },
};
