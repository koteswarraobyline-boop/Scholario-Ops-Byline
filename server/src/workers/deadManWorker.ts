/**
 * Dead-Man Watchdog Worker
 * Receives heartbeats from external control plane nodes.
 * If a heartbeat is missing past tolerance, fires alert.
 */
import cron from 'node-cron';
import { query, queryOne } from '../database/pool';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { broadcast } from '../realtime/websocket';
import { logger } from '../utils/logger';

export function startDeadManWorker(): void {
  logger.info('Dead-man watchdog worker starting...');

  // Check every 15 seconds
  cron.schedule('*/15 * * * * *', async () => {
    try {
      await checkDeadManStatus();
    } catch (err) {
      logger.error({ err }, 'Dead-man worker check error');
    }
  });

  logger.info('Dead-man watchdog worker running');
}

async function checkDeadManStatus(): Promise<void> {
  const controls = await query<{
    id: string;
    name: string;
    tolerance_sec: number;
    status: string;
    consecutive_misses: number;
    last_heartbeat_received_at: string | null;
    last_alert_sent_at: string | null;
  }>(`SELECT * FROM dead_man_controls`);

  for (const ctrl of controls) {
    if (!ctrl.last_heartbeat_received_at) continue;

    const ageSec = (Date.now() - new Date(ctrl.last_heartbeat_received_at).getTime()) / 1000;
    const isSilent = ageSec > ctrl.tolerance_sec;
    const newMisses = isSilent ? ctrl.consecutive_misses + 1 : 0;
    const newStatus = isSilent ? 'CRITICAL_SILENCE' : 'HEALTHY';

    if (newStatus !== ctrl.status) {
      await query(
        `UPDATE dead_man_controls
         SET status = $1, consecutive_misses = $2, updated_at = NOW()
         WHERE id = $3`,
        [newStatus, newMisses, ctrl.id]
      );

      broadcast('deadman.status.changed', {
        controlId: ctrl.id,
        name: ctrl.name,
        previousStatus: ctrl.status,
        newStatus,
        ageSec: Math.round(ageSec),
        consecutiveMisses: newMisses,
      });

      if (newStatus === 'CRITICAL_SILENCE') {
        logger.error({
          controlId: ctrl.id,
          ageSec: Math.round(ageSec),
          misses: newMisses,
        }, '🚨 DEAD-MAN SILENCE DETECTED — monitoring system may be compromised');

        // Only alert once per 15 minutes
        const lastAlert = ctrl.last_alert_sent_at
          ? (Date.now() - new Date(ctrl.last_alert_sent_at).getTime()) / 1000
          : Infinity;

        if (lastAlert > 900) {
          await NotificationsService.dispatchIncidentAlert('', 'deadman.silence', {
            title: `🚨 DEAD-MAN SILENCE: ${ctrl.name}`,
            text: `The external monitoring watchdog has not received a heartbeat for ${Math.round(ageSec)}s (tolerance: ${ctrl.tolerance_sec}s). The monitoring system may be offline.`,
            summary: `Dead-man silence: ${ctrl.name}`,
            color: 'FF0000',
          }).catch(err => logger.error({ err }, 'Dead-man notification failed'));

          await query(
            `UPDATE dead_man_controls SET last_alert_sent_at = NOW() WHERE id = $1`,
            [ctrl.id]
          );
        }
      }
    } else if (!isSilent && ctrl.consecutive_misses > 0) {
      await query(
        `UPDATE dead_man_controls SET consecutive_misses = 0, updated_at = NOW() WHERE id = $1`,
        [ctrl.id]
      );
    }
  }
}

// Called by the telemetry endpoint when a heartbeat arrives from the external watchdog
export async function recordHeartbeat(targetControlPlane: string): Promise<void> {
  await query(
    `UPDATE dead_man_controls
     SET last_heartbeat_received_at = NOW(),
         consecutive_misses = 0,
         status = 'HEALTHY',
         updated_at = NOW()
     WHERE target_control_plane = $1`,
    [targetControlPlane]
  );
}
