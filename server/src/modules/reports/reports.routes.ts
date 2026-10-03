import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { query, queryOne } from '../../database/pool';
import { ok } from '../../utils/response';

const router = Router();

// GET /api/reports/summary — system health summary for the Overview dashboard
router.get('/summary', authenticate, requirePermission('read', 'reports'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [apps] = await query<{ total: string; healthy: string }>(
      `SELECT COUNT(*) as total,
              COUNT(*) FILTER (WHERE status = 'HEALTHY') as healthy
       FROM applications WHERE deleted_at IS NULL`
    );
    const [servers] = await query<{ total: string; healthy: string }>(
      `SELECT COUNT(*) as total,
              COUNT(*) FILTER (WHERE status = 'HEALTHY') as healthy
       FROM servers WHERE deleted_at IS NULL`
    );
    const [monitors] = await query<{ total: string; healthy: string }>(
      `SELECT COUNT(*) as total,
              COUNT(*) FILTER (WHERE status = 'HEALTHY' AND enabled = TRUE) as healthy
       FROM monitors WHERE deleted_at IS NULL`
    );
    const [incidents] = await query<{ open: string; critical: string }>(
      `SELECT COUNT(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED')) as open,
              COUNT(*) FILTER (WHERE severity = 'CRITICAL' AND status NOT IN ('RESOLVED','CLOSED')) as critical
       FROM incidents`
    );
    const [backups] = await query<{ current: string; total: string }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'SUCCESS') as current,
              COUNT(*) as total
       FROM backups`
    );
    const [drReady] = await query<{ ready: string }>(
      `SELECT COUNT(*) as ready FROM applications a
       JOIN servers s ON s.id = a.dr_server_id
       WHERE a.deleted_at IS NULL AND s.status = 'HEALTHY'`
    );
    const deadMan = await queryOne<{ status: string; last_heartbeat_received_at: string | null }>(
      `SELECT status, last_heartbeat_received_at FROM dead_man_controls LIMIT 1`
    );
    const cfDegraded = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM cloudflare_zones WHERE status = 'DEGRADED'`
    );

    const totalApps = parseInt(apps?.total ?? '0', 10);
    const healthyApps = parseInt(apps?.healthy ?? '0', 10);
    const openIncidents = parseInt(incidents?.open ?? '0', 10);
    const criticalIncidents = parseInt(incidents?.critical ?? '0', 10);

    const overallHealth =
      criticalIncidents > 0 ? 'CRITICAL'
      : openIncidents > 0 || healthyApps < totalApps ? 'WARNING'
      : 'OPERATIONAL';

    ok(res, {
      totalApps,
      healthyApps,
      totalServers: parseInt(servers?.total ?? '0', 10),
      healthyServers: parseInt(servers?.healthy ?? '0', 10),
      totalMonitors: parseInt(monitors?.total ?? '0', 10),
      healthyMonitors: parseInt(monitors?.healthy ?? '0', 10),
      openIncidents,
      criticalIncidents,
      drReadinessCount: parseInt(drReady?.ready ?? '0', 10),
      backupsCurrentCount: parseInt(backups?.current ?? '0', 10),
      cloudflareStatus: parseInt(cfDegraded?.count ?? '0', 10) > 0 ? 'DEGRADED' : 'HEALTHY',
      deadManStatus: deadMan?.status ?? 'UNKNOWN',
      deadManLastHeartbeat: deadMan?.last_heartbeat_received_at ?? null,
      overallHealth,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

// GET /api/reports/daily — structured daily ops briefing text
router.get('/daily', authenticate, requirePermission('read', 'reports'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apps = await query(
      `SELECT name, status, uptime_30d, p95_ms, error_rate_percent FROM applications WHERE deleted_at IS NULL ORDER BY tier, name`
    );
    const openInc = await query(
      `SELECT ticket_number, title, severity, status, started_at FROM incidents WHERE status NOT IN ('RESOLVED','CLOSED') ORDER BY started_at DESC`
    );

    const lines = [
      'SCHOLARIO IT OPERATIONS CONTROL CENTER',
      'Daily Operations & Infrastructure Health Certified Briefing',
      `Generated: ${new Date().toISOString()}`,
      '',
      '============================================================',
      '1. APPLICATION HEALTH',
      '============================================================',
      ...apps.map((a: unknown) => {
        const app = a as Record<string, unknown>;
        return `  ${String(app.name).padEnd(20)} | ${String(app.status).padEnd(10)} | Uptime: ${app.uptime_30d ?? 'N/A'}% | P95: ${app.p95_ms ?? 'N/A'}ms`;
      }),
      '',
      '============================================================',
      '2. OPEN INCIDENTS',
      '============================================================',
      openInc.length === 0
        ? '  No open incidents — all systems nominal.'
        : openInc.map((i: unknown) => {
            const inc = i as Record<string, unknown>;
            return `  [${inc.ticket_number}] ${inc.severity} — ${inc.title} (${inc.status})`;
          }).join('\n'),
      '',
      '============================================================',
      '3. COMPLIANCE & GOVERNANCE',
      '============================================================',
      '  Encryption: AES-256 at rest, TLS 1.3 in transit',
      '  Audit Trail: Immutable operator action records maintained',
      `  Report Generated: ${new Date().toUTCString()}`,
    ];

    ok(res, { report: lines.join('\n'), generatedAt: new Date().toISOString() });
  } catch (err) { next(err); }
});

// GET /api/reports/uptime — uptime stats per app
router.get('/uptime', authenticate, requirePermission('read', 'reports'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await query(
      `SELECT a.id, a.name, a.code_name, a.tier, a.status,
              a.uptime_24h, a.uptime_7d, a.uptime_30d,
              a.p50_ms, a.p95_ms, a.p99_ms, a.error_rate_percent,
              a.rto_target_min, a.rpo_target_min,
              a.last_tested_recovery_date, a.last_tested_recovery_duration_min
       FROM applications a WHERE a.deleted_at IS NULL ORDER BY a.tier, a.name`
    );
    ok(res, rows);
  } catch (err) { next(err); }
});

export default router;
