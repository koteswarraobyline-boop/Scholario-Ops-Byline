import { query, queryOne } from '../../database/pool';
import { ApplicationsService } from '../applications/applications.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ForbiddenError, NotFoundError, AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';

export interface DrReadinessCheck {
  category: string;
  status: 'READY' | 'WARNING' | 'FAILED' | 'UNKNOWN';
  detail: string;
}

export const DrService = {
  async getReadiness(applicationId: string): Promise<{
    appId: string;
    appName: string;
    failoverState: string;
    checks: DrReadinessCheck[];
    overallReady: boolean;
  }> {
    const app = await ApplicationsService.getById(applicationId);

    const checks: DrReadinessCheck[] = [];

    // 1. Replication lag
    const replication = await queryOne<{ lag_sec: number; status: string }>(
      `SELECT lag_sec, status FROM replications WHERE application_id = $1 LIMIT 1`,
      [applicationId]
    );
    const lagSec = replication?.lag_sec ?? app.current_replication_lag_sec;
    const lagTarget = (app.rpo_target_min ?? 15) * 60;
    checks.push({
      category: 'Data Replication',
      status: lagSec === null ? 'UNKNOWN'
        : lagSec > lagTarget ? 'FAILED'
        : lagSec > lagTarget * 0.5 ? 'WARNING' : 'READY',
      detail: lagSec !== null
        ? `Replication lag: ${lagSec}s (target < ${lagTarget}s)`
        : 'Replication status unknown',
    });

    // 2. DR server health
    const drServer = await queryOne<{ status: string; agent_status: string; hostname: string }>(
      `SELECT status, agent_status, hostname FROM servers WHERE id = $1 AND deleted_at IS NULL`,
      [(app as unknown as Record<string, unknown>).dr_server_id as string]
    );
    checks.push({
      category: 'DR Standby Compute',
      status: !drServer ? 'UNKNOWN'
        : drServer.status === 'HEALTHY' ? 'READY'
        : drServer.status === 'WARNING' ? 'WARNING' : 'FAILED',
      detail: drServer
        ? `${drServer.hostname} is ${drServer.status} (agent: ${drServer.agent_status})`
        : 'DR server not found',
    });

    // 3. Recent backup
    const backup = await queryOne<{ completed_at: string; restore_status: string }>(
      `SELECT completed_at, restore_status FROM backups
       WHERE application_id = $1 AND status = 'SUCCESS'
       ORDER BY completed_at DESC LIMIT 1`,
      [applicationId]
    );
    const backupAgeSec = backup
      ? (Date.now() - new Date(backup.completed_at).getTime()) / 1000
      : null;
    checks.push({
      category: 'Snapshot Freshness',
      status: !backup ? 'FAILED'
        : (backupAgeSec ?? 9999) > 86400 * 2 ? 'WARNING' : 'READY',
      detail: backup
        ? `Latest backup: ${new Date(backup.completed_at).toLocaleDateString()} — restore: ${backup.restore_status}`
        : 'No successful backup found',
    });

    // 4. Restore drill
    checks.push({
      category: 'Restore Drill Verification',
      status: app.last_tested_recovery_date ? 'READY' : 'WARNING',
      detail: app.last_tested_recovery_date
        ? `Last drill: ${app.last_tested_recovery_date} (${app.last_tested_recovery_duration_min}m)`
        : 'No restore drill recorded',
    });

    // 5. Monitor health on DR side
    const failingDrMonitors = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM monitors
       WHERE application_id = $1 AND environment = 'DR'
         AND status = 'CRITICAL' AND enabled = TRUE AND deleted_at IS NULL`,
      [applicationId]
    );
    const failCount = parseInt(failingDrMonitors?.count ?? '0', 10);
    checks.push({
      category: 'DR Monitor Health',
      status: failCount > 0 ? 'FAILED' : 'READY',
      detail: failCount > 0
        ? `${failCount} monitor(s) failing on DR environment`
        : 'All DR monitors passing',
    });

    const overallReady = checks.every(c => c.status === 'READY' || c.status === 'WARNING')
      && !checks.some(c => c.status === 'FAILED');

    return {
      appId: applicationId,
      appName: app.name,
      failoverState: app.failover_state,
      checks,
      overallReady,
    };
  },

  async triggerFailover(
    applicationId: string,
    target: 'DR' | 'PRIMARY',
    operatorId: string,
    operatorName: string
  ): Promise<{ success: boolean; message: string; newState: string }> {
    const app = await ApplicationsService.getById(applicationId);

    // Validate transition is logical
    if (target === 'DR' && app.failover_state === 'DR_ACTIVE') {
      throw new AppError('Application is already in DR_ACTIVE state', 409);
    }
    if (target === 'PRIMARY' && app.failover_state === 'PRIMARY_ACTIVE') {
      throw new AppError('Application is already in PRIMARY_ACTIVE state', 409);
    }

    // For DR failover: check readiness
    if (target === 'DR') {
      const readiness = await this.getReadiness(applicationId);
      const failed = readiness.checks.filter(c => c.status === 'FAILED');
      if (failed.length > 0) {
        logger.warn({ failed, appId: applicationId }, 'Failover blocked — DR readiness checks failed');
        throw new AppError(
          `DR readiness checks failed: ${failed.map(c => c.category).join(', ')}`,
          422
        );
      }
    }

    const newState = target === 'DR' ? 'DR_ACTIVE' : 'PRIMARY_ACTIVE';

    // Set transitional state
    await ApplicationsService.updateFailoverState(applicationId, 'FAILING_OVER', operatorId);

    // In a real system: call Cloudflare API here to switch origins
    // For now: update DB and emit events
    await ApplicationsService.updateFailoverState(applicationId, newState, operatorId);

    const action = target === 'DR' ? 'FAILOVER' : 'FAILBACK';
    await AuditService.log({
      operatorId, operator: operatorName,
      action: `CLOUDFLARE_${action}`,
      category: 'FAILOVER',
      targetId: applicationId,
      details: `${action}: ${app.name} → ${newState} (${target})`,
    });

    // Notify channels
    await NotificationsService.dispatchIncidentAlert('', `failover.${target.toLowerCase()}`, {
      title: `${action}: ${app.name}`,
      text: `${app.name} has been ${action === 'FAILOVER' ? 'failed over to DR' : 'failed back to Primary'} by ${operatorName}.`,
      appName: app.name,
      newState,
      operator: operatorName,
    }).catch(err => logger.error({ err }, 'Failover notification dispatch failed'));

    return {
      success: true,
      message: `${app.name} ${target === 'DR' ? 'failed over to DR' : 'failed back to Primary'} successfully`,
      newState,
    };
  },
};
