import { v4 as uuidv4 } from 'uuid';
import https from 'https';
import nodemailer from 'nodemailer';
import { query, queryOne } from '../../database/pool';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { parsePagination } from '../../utils/response';

interface Channel {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  target_endpoint: string;
  config: Record<string, unknown>;
}

interface DeliveryPayload {
  channelId: string;
  eventType: string;
  incidentId?: string;
  payload: Record<string, unknown>;
}

let mailer: nodemailer.Transporter | null = null;

function getMailer(): nodemailer.Transporter {
  if (!mailer) {
    mailer = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return mailer;
}

export const NotificationsService = {
  async listChannels() {
    return query<Channel>(
      `SELECT id, name, type, enabled, target_endpoint,
              last_delivery_at, last_delivery_status, failure_count
       FROM notification_channels
       WHERE deleted_at IS NULL ORDER BY name`
    );
  },

  async getChannel(id: string): Promise<Channel> {
    const ch = await queryOne<Channel>(
      `SELECT * FROM notification_channels WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!ch) throw new Error(`Channel ${id} not found`);
    return ch;
  },

  async send(input: DeliveryPayload): Promise<boolean> {
    const channel = await this.getChannel(input.channelId);
    if (!channel.enabled) {
      logger.info({ channelId: channel.id }, 'Channel disabled — skipping notification');
      return false;
    }

    const deliveryId = uuidv4();
    await query(
      `INSERT INTO notification_deliveries
         (id,channel_id,incident_id,event_type,status,payload,attempt_count,sent_at)
       VALUES ($1,$2,$3,$4,'PENDING',$5,1,NOW())`,
      [deliveryId, channel.id, input.incidentId ?? null,
       input.eventType, JSON.stringify(input.payload)]
    );

    let success = false;
    let responseCode: number | undefined;
    let responseBody: string | undefined;
    let errorMsg: string | undefined;

    try {
      switch (channel.type) {
        case 'TEAMS':
          ({ responseCode, responseBody } = await this._sendTeams(
            channel.target_endpoint, input.payload
          ));
          success = (responseCode ?? 0) < 300;
          break;

        case 'EMAIL':
          await this._sendEmail(channel.target_endpoint, input.payload);
          success = true;
          break;

        case 'WEBHOOK':
        case 'PAGERDUTY':
          ({ responseCode, responseBody } = await this._sendWebhook(
            channel.target_endpoint, input.payload
          ));
          success = (responseCode ?? 0) < 300;
          break;

        default:
          logger.warn({ type: channel.type }, 'Unknown channel type');
          break;
      }
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err, channelId: channel.id }, 'Notification delivery failed');
    }

    const status = success ? 'DELIVERED' : 'FAILED';

    await query(
      `UPDATE notification_deliveries
       SET status = $1, response_code = $2, response_body = $3, error = $4,
           delivered_at = CASE WHEN $5 THEN NOW() ELSE NULL END
       WHERE id = $6`,
      [status, responseCode ?? null, responseBody ?? null, errorMsg ?? null, success, deliveryId]
    );

    await query(
      `UPDATE notification_channels
       SET last_delivery_at = NOW(), last_delivery_status = $1,
           failure_count = CASE WHEN $2 THEN 0 ELSE failure_count + 1 END,
           updated_at = NOW()
       WHERE id = $3`,
      [status, success, channel.id]
    );

    return success;
  },

  async sendTest(channelId: string): Promise<boolean> {
    return this.send({
      channelId,
      eventType: 'test',
      payload: {
        text: '✅ Scholario Ops test notification — channel is working.',
        timestamp: new Date().toISOString(),
      },
    });
  },

  // Dispatch to all channels for an incident at a given severity
  async dispatchIncidentAlert(
    incidentId: string, eventType: string,
    incidentData: Record<string, unknown>
  ): Promise<void> {
    const channels = await query<Channel>(
      `SELECT nc.* FROM notification_channels nc
       WHERE nc.enabled = TRUE AND nc.deleted_at IS NULL`
    );

    for (const channel of channels) {
      try {
        await this.send({ channelId: channel.id, eventType, incidentId, payload: incidentData });
      } catch (err) {
        logger.error({ err, channelId: channel.id }, 'Failed to dispatch incident alert');
      }
    }
  },

  async _sendTeams(webhookUrl: string, payload: Record<string, unknown>): Promise<{ responseCode?: number; responseBody?: string }> {
    const body = JSON.stringify({
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: String(payload.summary ?? 'Scholario Ops Alert'),
      themeColor: String(payload.color ?? 'E81123'),
      title: String(payload.title ?? 'Alert'),
      text: String(payload.text ?? JSON.stringify(payload)),
    });

    return new Promise((resolve) => {
      const url = new URL(webhookUrl);
      const req = https.request({
        hostname: url.hostname, path: url.pathname + url.search,
        method: 'POST', port: 443,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ responseCode: res.statusCode, responseBody: data }));
      });
      req.on('error', (err) => resolve({ responseBody: err.message }));
      req.setTimeout(10_000, () => { req.destroy(); resolve({ responseBody: 'TIMEOUT' }); });
      req.write(body);
      req.end();
    });
  },

  async _sendEmail(to: string, payload: Record<string, unknown>): Promise<void> {
    if (!config.smtp.host) {
      logger.warn('SMTP not configured — skipping email notification');
      return;
    }
    const subject = String(payload.title ?? 'Scholario Ops Alert');
    const text = String(payload.text ?? JSON.stringify(payload, null, 2));

    await getMailer().sendMail({ from: config.smtp.from, to, subject, text });
    logger.info({ to }, 'Email notification sent');
  },

  async _sendWebhook(url: string, payload: Record<string, unknown>): Promise<{ responseCode?: number; responseBody?: string }> {
    const body = JSON.stringify(payload);
    return new Promise((resolve) => {
      const parsedUrl = new URL(url);
      const lib = parsedUrl.protocol === 'https:' ? https : require('http');
      const req = lib.request({
        hostname: parsedUrl.hostname, path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST', port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res: { statusCode?: number; on: Function }) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => resolve({ responseCode: res.statusCode, responseBody: data }));
      });
      req.on('error', (err: Error) => resolve({ responseBody: err.message }));
      req.setTimeout(10_000, () => { req.destroy(); resolve({ responseBody: 'TIMEOUT' }); });
      req.write(body);
      req.end();
    });
  },

  async listDeliveries(params: { channelId?: string; incidentId?: string; page?: number; pageSize?: number }) {
    const { page, pageSize, offset } = parsePagination(params as Record<string, unknown>);
    const conds: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    if (params.channelId) { conds.push(`channel_id = $${i++}`); vals.push(params.channelId); }
    if (params.incidentId) { conds.push(`incident_id = $${i++}`); vals.push(params.incidentId); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [cnt] = await query<{ count: string }>(`SELECT COUNT(*) as count FROM notification_deliveries ${where}`, vals);
    const total = parseInt(cnt?.count ?? '0', 10);

    const rows = await query(
      `SELECT * FROM notification_deliveries ${where}
       ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...vals, pageSize, offset]
    );

    return { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  },
};
