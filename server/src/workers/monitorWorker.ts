/**
 * Monitor Worker — polls enabled monitors on their configured intervals.
 * Runs as a background loop started from server.ts.
 * Uses a simple in-process scheduler backed by node-cron for the dispatch loop,
 * with per-monitor interval tracking in Redis.
 */
import cron from 'node-cron';
import { query } from '../database/pool';
import { getRedis } from '../database/redis';
import { MonitorsService } from '../modules/monitors/monitors.service';
import { IncidentsService, buildFingerprint } from '../modules/incidents/incidents.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { broadcast } from '../realtime/websocket';
import { config } from '../config';
import { logger } from '../utils/logger';

const DISPATCH_INTERVAL_SEC = 10; // How often we look for due monitors
let running = false;

export function startMonitorWorker(): void {
  if (running) return;
  running = true;

  logger.info('Monitor worker starting...');

  // Run every DISPATCH_INTERVAL_SEC seconds
  cron.schedule(`*/${DISPATCH_INTERVAL_SEC} * * * * *`, async () => {
    try {
      await dispatchDueMonitors();
    } catch (err) {
      logger.error({ err }, 'Monitor dispatch cycle error');
    }
  });

  // Stale agent detector — runs every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    try {
      await markStaleAgents();
    } catch (err) {
      logger.error({ err }, 'Stale agent check error');
    }
  });

  // Maintenance window expiry — runs every minute
  cron.schedule('* * * * *', async () => {
    try {
      await expireMaintenanceWindows();
    } catch (err) {
      logger.error({ err }, 'Maintenance window expiry error');
    }
  });

  logger.info('Monitor worker running');
}

async function dispatchDueMonitors(): Promise<void> {
  const redis = getRedis();

  // Get all enabled, non-maintenance monitors
  const monitors = await query<{
    id: string; name: string; type: string; target: string;
    interval_sec: number; application_id: string | null;
    server_id: string | null; environment: string;
    failure_confirmation_threshold: number;
    consecutive_failures: number; status: string;
    runbook_id: string | null;
  }>(
    `SELECT id, name, type, target, interval_sec, application_id, server_id,
            environment, failure_confirmation_threshold, consecutive_failures,
            status, runbook_id
     FROM monitors
     WHERE enabled = TRUE AND active_maintenance = FALSE AND deleted_at IS NULL`
  );

  const now = Date.now();
  const concurrency = config.monitoring.workerConcurrency;
  const batch: Promise<void>[] = [];

  for (const mon of monitors) {
    const key = `monitor:last_run:${mon.id}`;
    const lastRunStr = await redis.get(key);
    const lastRun = lastRunStr ? parseInt(lastRunStr, 10) : 0;
    const intervalMs = mon.interval_sec * 1000;

    if (now - lastRun >= intervalMs) {
      batch.push(runMonitor(mon));
      await redis.set(key, String(now), 'EX', mon.interval_sec * 10);

      if (batch.length >= concurrency) {
        await Promise.allSettled(batch.splice(0, concurrency));
      }
    }
  }

  if (batch.length > 0) {
    await Promise.allSettled(batch);
  }
}

async function runMonitor(mon: {
  id: string; name: string; type: string; target: string;
  application_id: string | null; server_id: string | null;
  environment: string; failure_confirmation_threshold: number;
  consecutive_failures: number; status: string; runbook_id: string | null;
}): Promise<void> {
  try {
    const prevStatus = mon.status;
    const result = await MonitorsService.runProbe(mon.id);

    // Broadcast status change if it changed
    if (result.status !== prevStatus) {
      broadcast('monitor.status.changed', {
        monitorId: mon.id,
        monitorName: mon.name,
        previousStatus: prevStatus,
        newStatus: result.status,
        responseTimeMs: result.responseTimeMs,
        detail: result.detail,
        applicationId: mon.application_id,
      });

      logger.info({
        monitorId: mon.id,
        from: prevStatus, to: result.status,
        ms: result.responseTimeMs,
      }, 'Monitor status changed');
    }

    // After running, re-fetch to get updated consecutive counts
    const updated = await query<{ consecutive_failures: number; status: string }>(
      `SELECT consecutive_failures, status FROM monitors WHERE id = $1`, [mon.id]
    );
    const updatedMon = updated[0];

    // Create incident if failure threshold reached
    if (
      updatedMon &&
      updatedMon.status === 'CRITICAL' &&
      updatedMon.consecutive_failures >= mon.failure_confirmation_threshold
    ) {
      const fingerprint = buildFingerprint({
        applicationId: mon.application_id ?? undefined,
        monitorId: mon.id,
        serverId: mon.server_id ?? undefined,
        failureType: mon.type.toLowerCase(),
        environment: mon.environment,
      });

      const incident = await IncidentsService.createOrUpdate({
        title: `${mon.name} is failing: ${result.detail}`,
        severity: 'CRITICAL',
        applicationId: mon.application_id ?? undefined,
        serverId: mon.server_id ?? undefined,
        monitorId: mon.id,
        environment: mon.environment as 'PRD' | 'DR',
        fingerprint,
        rootCause: `Monitor ${mon.type} check failed: ${result.detail}`,
        affectedMonitors: [mon.id],
        runbookId: mon.runbook_id ?? undefined,
      });

      // Broadcast incident event
      broadcast('incident.created', {
        incidentId: incident.id,
        ticketNumber: incident.ticket_number,
        title: incident.title,
        severity: incident.severity,
        applicationId: mon.application_id,
      });

      // Dispatch notifications
      await NotificationsService.dispatchIncidentAlert(incident.id, 'incident.created', {
        title: `🔴 CRITICAL: ${incident.ticket_number} — ${incident.title}`,
        text: `Failure confirmed after ${mon.failure_confirmation_threshold} consecutive checks.\nMonitor: ${mon.name}\nTarget: ${mon.target}\nDetail: ${result.detail}`,
        summary: incident.title,
        color: 'E81123',
      }).catch(err => logger.error({ err }, 'Failed to dispatch incident notification'));
    }

  } catch (err) {
    logger.error({ err, monitorId: mon.id }, 'Monitor probe execution failed');
  }
}

async function markStaleAgents(): Promise<void> {
  const staleThreshold = config.monitoring.telemetryStaleThresholdSec;

  const result = await query<{ id: string; hostname: string }>(
    `UPDATE servers
     SET status = 'STALE', agent_status = 'STALE', updated_at = NOW()
     WHERE last_seen < NOW() - INTERVAL '${staleThreshold} seconds'
       AND status != 'STALE'
       AND deleted_at IS NULL
     RETURNING id, hostname`
  );

  for (const srv of result) {
    logger.warn({ serverId: srv.id, hostname: srv.hostname }, 'Server marked STALE — no telemetry received');
    broadcast('server.health.changed', {
      serverId: srv.id,
      hostname: srv.hostname,
      newStatus: 'STALE',
      reason: `No telemetry for ${staleThreshold}s`,
    });
  }
}

async function expireMaintenanceWindows(): Promise<void> {
  const expired = await query<{ id: string; suppress_monitors: string[] }>(
    `UPDATE maintenance_windows
     SET status = 'EXPIRED', updated_at = NOW()
     WHERE end_time < NOW() AND status IN ('SCHEDULED','IN_PROGRESS')
     RETURNING id, suppress_monitors`
  );

  for (const mw of expired) {
    if (mw.suppress_monitors?.length) {
      await query(
        `UPDATE monitors SET active_maintenance = FALSE WHERE id = ANY($1::uuid[])`,
        [mw.suppress_monitors]
      );
    }
    logger.info({ maintenanceWindowId: mw.id }, 'Maintenance window expired');
  }
}

export function stopMonitorWorker(): void {
  running = false;
  logger.info('Monitor worker stopped');
}
