/**
 * Dead-Man Watchdog Worker
 *
 * Rules:
 * 1. If last_heartbeat_received_at is NULL — no heartbeat ever received,
 *    do NOT mark as silent (system may be starting up).
 * 2. Only escalate to CRITICAL_SILENCE after consecutive_misses >= 3
 *    (prevents false alerts from a single missed check).
 * 3. Only alert via notifications once per 15 minutes.
 */
import cron from 'node-cron';
import { query } from '../database/pool';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { broadcast } from '../realtime/websocket';
import { logger } from '../utils/logger';

const MISS_THRESHOLD = 3; // consecutive misses before CRITICAL_SILENCE

export function startDeadManWorker(): void {
  logger.info('Dead-man watchdog worker starting...');

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
    // Rule 1: No heartbeat ever received — stay HEALTHY, don't alert
    if (!ctrl.last_heartbeat_received_at) {
      continue;
    }

    const ageSec = (Date.now() - new Date(ctrl.last_heartbeat_received_at).getTime()) / 1000;
    const isMissed = ageSec > ctrl.tolerance_sec;

    if (!isMissed) {
      // Heartbeat is current — ensure HEALTHY
      if (ctrl.status !== 'HEALTHY' || ctrl.consecutive_misses > 0) {
        await query(
          `UPDATE dead_man_controls
           SET status = 'HEALTHY', consecutive_misses = 0, updated_at = NOW()
           WHERE id = $1`,
          [ctrl.id]
        );
        if (ctrl.status === 'CRITICAL_SILENCE') {
          broadcast('deadman.status.changed', {
            controlId: ctrl.id, name: ctrl.name,
            previousStatus: 'CRITICAL_SILENCE', newStatus: 'HEALTHY',
            ageSec: Math.round(ageSec),
          });
          logger.info({ controlId: ctrl.id }, 'Dead-man watchdog recovered');
        }
      }
      continue;
    }

    // Rule 2: Increment misses — only go CRITICAL after threshold
    const newMisses = ctrl.consecutive_misses + 1;
    const newStatus = newMisses >= MISS_THRESHOLD ? 'CRITICAL_SILENCE' : ctrl.status;

    await query(
      `UPDATE dead_man_controls
       SET consecutive_misses = $1, status = $2, updated_at = NOW()
       WHERE id = $3`,
      [newMisses, newStatus, ctrl.id]
    );

    if (newStatus === 'CRITICAL_SILENCE' && ctrl.status !== 'CRITICAL_SILENCE') {
      broadcast('deadman.status.changed', {
        controlId: ctrl.id, name: ctrl.name,
        previousStatus: ctrl.status, newStatus: 'CRITICAL_SILENCE',
        ageSec: Math.round(ageSec), consecutiveMisses: newMisses,
      });

      logger.error({ controlId: ctrl.id, ageSec: Math.round(ageSec), misses: newMisses },
        '🚨 DEAD-MAN SILENCE DETECTED');

      // Rule 3: Only alert once per 15 minutes
      const lastAlertSec = ctrl.last_alert_sent_at
        ? (Date.now() - new Date(ctrl.last_alert_sent_at).getTime()) / 1000
        : Infinity;

      if (lastAlertSec > 900) {
        await NotificationsService.dispatchIncidentAlert('', 'deadman.silence', {
          title: `🚨 DEAD-MAN SILENCE: ${ctrl.name}`,
          text: `Watchdog has not received a heartbeat for ${Math.round(ageSec)}s (tolerance: ${ctrl.tolerance_sec}s, misses: ${newMisses}).`,
          summary: `Dead-man silence: ${ctrl.name}`,
          color: 'FF0000',
        }).catch(err => logger.error({ err }, 'Dead-man notification dispatch failed'));

        await query(`UPDATE dead_man_controls SET last_alert_sent_at = NOW() WHERE id = $1`, [ctrl.id]);
      }
    }
  }
}

export async function recordHeartbeat(targetControlPlane: string): Promise<void> {
  await query(
    `UPDATE dead_man_controls
     SET last_heartbeat_received_at = NOW(), consecutive_misses = 0,
         status = 'HEALTHY', updated_at = NOW()
     WHERE target_control_plane = $1`,
    [targetControlPlane]
  );
  logger.debug({ targetControlPlane }, 'Dead-man heartbeat received');
}
