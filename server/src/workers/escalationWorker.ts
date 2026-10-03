/**
 * Escalation Worker — processes active escalation policies.
 * Runs every minute via cron.
 */
import cron from 'node-cron';
import { query } from '../database/pool';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { logger } from '../utils/logger';

export function startEscalationWorker(): void {
  logger.info('Escalation worker starting...');

  cron.schedule('* * * * *', async () => {
    try {
      await processEscalations();
    } catch (err) {
      logger.error({ err }, 'Escalation worker error');
    }
  });

  logger.info('Escalation worker running');
}

async function processEscalations(): Promise<void> {
  // Find incidents that are still open and past their escalation time
  const due = await query<{
    id: string;
    incident_id: string;
    policy_id: string;
    current_step: number;
    next_escalate_at: string;
    ticket_number: string;
    title: string;
    severity: string;
    status: string;
  }>(
    `SELECT ae.id, ae.incident_id, ae.policy_id, ae.current_step, ae.next_escalate_at,
            i.ticket_number, i.title, i.severity, i.status
     FROM active_escalations ae
     JOIN incidents i ON i.id = ae.incident_id
     WHERE ae.next_escalate_at <= NOW()
       AND i.status NOT IN ('RESOLVED','CLOSED')`
  );

  for (const esc of due) {
    try {
      // Get the next escalation step channels
      const steps = await query<{
        step_order: number;
        channel_id: string;
        delay_min: number;
      }>(
        `SELECT step_order, channel_id, delay_min
         FROM escalation_steps
         WHERE policy_id = $1 AND step_order >= $2
         ORDER BY step_order
         LIMIT 1`,
        [esc.policy_id, esc.current_step]
      );

      if (steps.length === 0) {
        // No more steps — remove escalation tracking
        await query(`DELETE FROM active_escalations WHERE id = $1`, [esc.id]);
        continue;
      }

      const step = steps[0];

      // Dispatch notification for this step
      await NotificationsService.send({
        channelId: step.channel_id,
        eventType: 'incident.escalated',
        incidentId: esc.incident_id,
        payload: {
          title: `⚠️ ESCALATED [Step ${step.step_order}]: ${esc.ticket_number}`,
          text: `Incident ${esc.ticket_number} has not been resolved.\n${esc.severity}: ${esc.title}\nThis is escalation step ${step.step_order}.`,
          summary: `Escalated: ${esc.title}`,
          color: 'FF8C00',
        },
      });

      logger.info({
        incidentId: esc.incident_id,
        step: step.step_order,
        channelId: step.channel_id,
      }, 'Escalation notification dispatched');

      // Get next step for future escalation
      const nextSteps = await query<{ step_order: number; delay_min: number }>(
        `SELECT step_order, delay_min FROM escalation_steps
         WHERE policy_id = $1 AND step_order > $2
         ORDER BY step_order LIMIT 1`,
        [esc.policy_id, step.step_order]
      );

      if (nextSteps.length > 0) {
        const nextDelayMs = nextSteps[0].delay_min * 60_000;
        await query(
          `UPDATE active_escalations
           SET current_step = $1, next_escalate_at = NOW() + INTERVAL '${nextSteps[0].delay_min} minutes',
               updated_at = NOW()
           WHERE id = $2`,
          [nextSteps[0].step_order, esc.id]
        );
      } else {
        // All steps exhausted
        await query(`DELETE FROM active_escalations WHERE id = $1`, [esc.id]);
        logger.warn({ incidentId: esc.incident_id }, 'All escalation steps exhausted');
      }

    } catch (err) {
      logger.error({ err, escalationId: esc.id }, 'Failed to process escalation step');
    }
  }
}
