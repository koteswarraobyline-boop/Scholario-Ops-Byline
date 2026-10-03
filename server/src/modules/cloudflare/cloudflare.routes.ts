import { Router, Request, Response, NextFunction } from 'express';
import https from 'https';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { query, queryOne } from '../../database/pool';
import { config } from '../../config';
import { ok, paginated, parsePagination } from '../../utils/response';
import { NotFoundError } from '../../utils/errors';
import { logger } from '../../utils/logger';

const router = Router();

// Helper: Cloudflare API call (read-only)
async function cfRequest<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!config.cloudflare.apiToken) {
      reject(new Error('Cloudflare API token not configured'));
      return;
    }
    const req = https.request({
      hostname: 'api.cloudflare.com',
      path: `/client/v4${path}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.cloudflare.apiToken}`,
        'Content-Type': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed.success) reject(new Error(parsed.errors?.[0]?.message ?? 'Cloudflare API error'));
          else resolve(parsed.result as T);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('Cloudflare API timeout')); });
    req.end();
  });
}

// GET /api/cloudflare/zones — from DB (cached from last sync)
router.get('/zones', authenticate, requirePermission('read', 'cloudflare'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>);
    const [cnt] = await query<{ count: string }>(`SELECT COUNT(*) as count FROM cloudflare_zones`);
    const total = parseInt(cnt?.count ?? '0', 10);
    const rows = await query(
      `SELECT z.*,
         (SELECT json_agg(d ORDER BY d.name) FROM cloudflare_dns_records d WHERE d.zone_id = z.id) AS dns_records,
         row_to_json(lb.*) AS load_balancer
       FROM cloudflare_zones z
       LEFT JOIN cloudflare_load_balancers lb ON lb.zone_id = z.id
       ORDER BY z.domain
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    paginated(res, { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

router.get('/zones/:id', authenticate, requirePermission('read', 'cloudflare'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const zone = await queryOne(
      `SELECT z.*, row_to_json(lb.*) AS load_balancer FROM cloudflare_zones z
       LEFT JOIN cloudflare_load_balancers lb ON lb.zone_id = z.id
       WHERE z.id = $1`,
      [req.params.id]
    );
    if (!zone) throw new NotFoundError('Cloudflare zone');
    const dns = await query(`SELECT * FROM cloudflare_dns_records WHERE zone_id = $1 ORDER BY name`, [req.params.id]);
    ok(res, { ...zone, dns_records: dns });
  } catch (err) { next(err); }
});

// GET /api/cloudflare/sync — pull live data from Cloudflare API and update DB
router.post('/sync', authenticate, requirePermission('read', 'cloudflare'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!config.cloudflare.apiToken) {
      ok(res, { synced: false, reason: 'Cloudflare API token not configured' });
      return;
    }

    const zones = await cfRequest<Array<{ id: string; name: string; status: string }>>('/zones');
    let synced = 0;

    for (const zone of zones) {
      await query(
        `INSERT INTO cloudflare_zones (id, cloudflare_id, domain, status, last_checked)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW())
         ON CONFLICT (domain) DO UPDATE SET status = $3, last_checked = NOW(), updated_at = NOW()`,
        [zone.id, zone.name, zone.status === 'active' ? 'ACTIVE' : 'DEGRADED']
      );
      synced++;
    }

    logger.info({ synced }, 'Cloudflare zones synced');
    ok(res, { synced, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, 'Cloudflare sync failed');
    next(err);
  }
});

export default router;
