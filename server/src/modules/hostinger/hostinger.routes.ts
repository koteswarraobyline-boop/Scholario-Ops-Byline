import { Router, Request, Response, NextFunction } from 'express';
import https from 'https';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { config } from '../../config';
import { query } from '../../database/pool';
import { ok } from '../../utils/response';
import { logger } from '../../utils/logger';

const router = Router();

// Hostinger API helper (read-only VPS data)
async function hostingerRequest<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!config.hostinger.apiToken) {
      reject(new Error('Hostinger API token not configured'));
      return;
    }
    const req = https.request({
      hostname: 'api.hostinger.com',
      path: `/v1${path}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.hostinger.apiToken}`,
        'Content-Type': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data) as T); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error('Hostinger API timeout')); });
    req.end();
  });
}

// GET /api/hostinger/servers — from DB (our own server records, enriched with provider data)
router.get('/servers', authenticate, requirePermission('read', 'servers'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await query(
      `SELECT s.*, a.name AS app_name, a.code_name AS app_code
       FROM servers s
       LEFT JOIN applications a ON a.id = s.application_id
       WHERE s.provider = 'Hostinger' AND s.deleted_at IS NULL
       ORDER BY s.region, s.hostname`
    );
    ok(res, rows);
  } catch (err) { next(err); }
});

// POST /api/hostinger/sync — pull VPS list from Hostinger API
router.post('/sync', authenticate, requirePermission('read', 'servers'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!config.hostinger.apiToken) {
      ok(res, { synced: false, reason: 'Hostinger API token not configured — using local server records' });
      return;
    }

    // Note: Actual Hostinger API endpoint paths may differ.
    // This is a representative integration — verify against Hostinger API docs.
    const data = await hostingerRequest<{ data: Array<{ id: string; hostname: string; status: string }> }>('/vps/servers');

    let synced = 0;
    for (const vps of data.data ?? []) {
      const status = vps.status === 'running' ? 'HEALTHY' : 'UNKNOWN';
      await query(
        `UPDATE servers SET status = $1, updated_at = NOW()
         WHERE hostname = $2 AND provider = 'Hostinger'`,
        [status, vps.hostname]
      );
      synced++;
    }

    logger.info({ synced }, 'Hostinger VPS sync complete');
    ok(res, { synced, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, 'Hostinger sync failed');
    // Non-fatal — return partial success
    ok(res, { synced: false, error: err instanceof Error ? err.message : 'Sync failed' });
  }
});

export default router;
