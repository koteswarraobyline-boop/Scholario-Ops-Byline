/**
 * Escalation policies end to end (in-process, throw-away PostgreSQL schema, a local HTTP server as
 * the webhook channels): initial delay (blips page nobody, restart-safe flag), acknowledged within the
 * delay, delayed page sent once, auto-escalation once to the chosen channels with the team name,
 * on-call users, no escalation after acknowledgement, no reminders before the first page.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
process.env.DB_SCHEMA = `ops_escalation_${process.pid}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-escalation-'));
process.env.HOSTINGER_API_TOKEN = '';
process.env.CLOUDFLARE_API_TOKEN = '';
for (const k of ['SMTP_SERVICE', 'SMTP_URL', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']) process.env[k] = '';
process.env.ALERT_COOLDOWN_MIN = '15';
process.env.NOTIFY_WEBHOOK_SECRET = 'test-signing-secret';
// The local test receivers run on 127.0.0.1: allowed explicitly, like an internal webhook would be
process.env.NOTIFY_ALLOWED_PRIVATE_TARGETS = '127.0.0.1';
// Grouping window short enough for tests (alerts without an application are never grouped)
process.env.NOTIFY_GROUP_WINDOW_SEC = '1';

const { initStore, db } = await import('../server/store.ts');
const { query, closePool, SCHEMA } = await import('../server/db.ts');
const { updateIncidentDurations } = await import('../server/engine.ts');
const { openAlert, resolveAlert } = await import('../server/alerts.ts');
const notify = await import('../server/notify.ts');
const crypto = await import('node:crypto');
type Incident = import('../src/types/index.ts').Incident;

/** Posts received per channel path */
const received: Record<string, Array<{ status: string; text: string; title: string }>> = { '/a': [], '/b': [] };
/** Scripted responses per path (consumed in order; then 200) and every raw request */
const script: Record<string, number[]> = {};
const raw: Array<{ url: string; body: string; headers: http.IncomingHttpHeaders }> = [];
const hook = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    raw.push({ url: req.url ?? '', body, headers: req.headers });
    const scripted = script[req.url ?? '']?.shift();
    if (scripted === 429) { res.writeHead(429, { 'Retry-After': '1' }); res.end('slow down'); return; }
    if (scripted === 302) { res.writeHead(302, { Location: `${base}/redirected` }); res.end(); return; }
    if (scripted && scripted !== 200) { res.writeHead(scripted); res.end('nope'); return; }
    const j = JSON.parse(body);
    (received[req.url ?? ''] ??= []).push({ status: j.status, text: j.details ?? j.text, title: j.title });
    res.writeHead(200); res.end('ok');
  });
});
let base = '';
const posts = (p: '/a' | '/b') => received[p];
const clear = () => { received['/a'] = []; received['/b'] = []; };
const settle = () => new Promise(r => setTimeout(r, 300));
const minutesAgo = (inc: Incident, m: number) => { inc.startedAt = new Date(Date.now() - m * 60_000).toISOString(); };
let n = 0;
const alert = (severity: 'WARNING' | 'HIGH') => openAlert({ fingerprint: `esc-test:${++n}`, title: `Test ${n}`, severity, detail: 'something broke', source: 'Test' }).incident;

before(async () => {
  await new Promise<void>(r => hook.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(hook.address() as AddressInfo).port}`;
  await initStore();
  db.channels.push(
    { id: 'ch-a', name: 'Ops webhook', type: 'WEBHOOK', targetEndpoint: `${base}/a`, enabled: true, failureCount: 0 } as never,
    { id: 'ch-b', name: 'DBA webhook', type: 'WEBHOOK', targetEndpoint: `${base}/b`, enabled: true, failureCount: 0 } as never,
  );
  db.escalationPolicies = [
    { id: 'p-warn', severity: 'WARNING', channels: ['ch-a'], initialDelayMin: 5, repeatIntervalMin: 1, autoEscalateAfterMin: 0, escalateToTeam: '' },
    { id: 'p-high', severity: 'HIGH', channels: ['ch-a'], initialDelayMin: 0, repeatIntervalMin: 0, autoEscalateAfterMin: 10, escalateToTeam: 'DBA team', escalationChannels: ['ch-b'] },
  ];
});
after(async () => {
  hook.close();
  await query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  await closePool();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 100).unref();
});

test('initial delay: a blip that recovers within the delay pages nobody (no FIRING, no RESOLVED)', async () => {
  clear();
  const inc = alert('WARNING');
  await settle();
  assert.equal(posts('/a').length, 0, 'held back');
  assert.equal(inc.notificationDeferred, true);
  updateIncidentDurations(); await settle();
  assert.equal(posts('/a').length, 0, 'still within the delay: no reminder either');
  resolveAlert(inc.fingerprint!, 'Test', 'recovered');
  await settle();
  assert.equal(posts('/a').length, 0, 'no RESOLVED for an alert nobody received');
  assert.equal(inc.notificationDeferred, false);
  assert.ok(inc.timeline.some(e => /nobody was paged/.test(e.message)));
});

test('initial delay: still open after the delay → exactly one page; its recovery is sent too', async () => {
  clear();
  const inc = alert('WARNING');
  minutesAgo(inc, 6);
  updateIncidentDurations(); await settle();
  assert.equal(posts('/a').length, 1);
  assert.equal(posts('/a')[0].status, 'FIRING');
  assert.equal(inc.notificationDeferred, false);
  updateIncidentDurations(); await settle();
  assert.equal(posts('/a').length, 1, 'sent once; the first reminder waits a full repeat interval');
  resolveAlert(inc.fingerprint!, 'Test', 'recovered');
  await settle();
  assert.deepEqual(posts('/a').map(p => p.status), ['FIRING', 'RESOLVED']);
});

test('initial delay: acknowledged within the delay → nobody is paged', async () => {
  clear();
  const inc = alert('WARNING');
  inc.acknowledged = true;
  minutesAgo(inc, 6);
  updateIncidentDurations(); await settle();
  assert.equal(posts('/a').length, 0);
  assert.equal(inc.notificationDeferred, false);
  assert.ok(inc.timeline.some(e => /Acknowledged within the notification delay/.test(e.message)));
});

test('auto-escalation: unacknowledged after N min → one ESCALATED message to the escalation channels with the team; on-call users noted', async () => {
  clear();
  db.users.push({ id: 'u-oncall', email: 'oncall@example.invalid', fullName: 'On Call', roleName: 'operator', isActive: true, isOnCall: true, passwordHash: 'x', tokenVersion: 0, createdAt: new Date().toISOString() } as never);
  const inc = alert('HIGH');
  await settle();
  assert.deepEqual(posts('/a').map(p => p.status), ['FIRING'], 'no delay for HIGH: paged immediately');
  assert.equal(posts('/b').length, 0);

  minutesAgo(inc, 5);
  updateIncidentDurations(); await settle();
  assert.equal(posts('/b').length, 0, 'not yet');

  minutesAgo(inc, 11);
  updateIncidentDurations(); await settle();
  assert.equal(posts('/b').length, 1, 'escalated to the DBA channel');
  assert.equal(posts('/b')[0].status, 'ESCALATED');
  assert.match(posts('/b')[0].text, /escalated to DBA team/);
  assert.equal(posts('/a').length, 1, 'escalation goes only to the escalation channels');
  assert.ok(inc.escalatedAt);
  const note = inc.timeline.find(e => /Escalated to DBA team/.test(e.message));
  assert.ok(note, 'timeline entry');
  assert.match(note!.message, /1 on-call user\(s\) not emailed \(SMTP not configured\)/);
  assert.ok(db.auditLogs.some(a => a.action === 'INCIDENT_ESCALATED' && a.targetId === inc.id));

  updateIncidentDurations(); await settle();
  assert.equal(posts('/b').length, 1, 'escalates once');
});

test('auto-escalation: an acknowledged incident is never escalated', async () => {
  clear();
  const inc = alert('HIGH');
  inc.acknowledged = true;
  minutesAgo(inc, 30);
  updateIncidentDurations(); await settle();
  assert.equal(posts('/b').length, 0);
  assert.equal(inc.escalatedAt, undefined);
});

test('the deferred flag survives a restart: it is stored on the incident, and the engine sends the page later', async () => {
  clear();
  const inc = alert('WARNING');
  const stored = db.incidents.find(i => i.id === inc.id)!;
  assert.equal(stored.notificationDeferred, true);
  // Simulate the process restarting: in-memory notification state is gone, the incident flag remains
  minutesAgo(stored, 7);
  updateIncidentDurations(); await settle();
  assert.equal(posts('/a').length, 1);
});

test('notifications: a temporary failure (503) is retried and delivered; a rejected request (400) is not retried', async () => {
  notify.RETRY_DELAYS_MS.splice(0, notify.RETRY_DELAYS_MS.length, 50, 50);
  const ch = (path: string) => ({ id: `ch${path}`, name: path, type: 'WEBHOOK', targetEndpoint: `${base}${path}`, enabled: true, failureCount: 0 }) as never;
  const msg = { title: 'T', text: 'body', severity: 'HIGH', status: 'FIRING' as const };

  script['/flaky'] = [503, 503];
  const ok = await notify.sendToChannel(ch('/flaky'), msg);
  assert.equal(ok.ok, true, 'delivered on the third attempt');
  assert.equal(raw.filter(r => r.url === '/flaky').length, 3);

  script['/bad'] = [400];
  const bad = await notify.sendToChannel(ch('/bad'), msg);
  assert.equal(bad.ok, false);
  assert.equal(raw.filter(r => r.url === '/bad').length, 1, '400 is not retried');

  script['/down'] = [500, 500, 500, 500];
  const down = await notify.sendToChannel(ch('/down'), msg);
  assert.equal(down.ok, false);
  assert.equal(raw.filter(r => r.url === '/down').length, 3, 'gives up after 3 attempts');
});

test('webhook notifications are signed (HMAC-SHA256 over timestamp + body) when NOTIFY_WEBHOOK_SECRET is set', async () => {
  const before = raw.length;
  await notify.sendToChannel({ id: 'ch-sig', name: 'sig', type: 'WEBHOOK', targetEndpoint: `${base}/signed`, enabled: true, failureCount: 0 } as never,
    { title: 'Signed', text: 'x', severity: 'INFO', status: 'INFO' });
  const req = raw.slice(before).find(r => r.url === '/signed')!;
  const ts = String(req.headers['x-scholario-timestamp']);
  const expected = 'sha256=' + crypto.createHmac('sha256', 'test-signing-secret').update(`${ts}.${req.body}`).digest('hex');
  assert.equal(req.headers['x-scholario-signature'], expected);
  assert.ok(Math.abs(Date.now() / 1000 - Number(ts)) < 60);
});

test('delivery log: every send is recorded (result, attempts, error, incident), filterable, with 24 h stats; a resend links to its original', async () => {
  const deliveries = await import('../server/deliveries.ts');
  const ch = { id: 'ch-log', name: 'Log test', type: 'WEBHOOK', targetEndpoint: `${base}/log`, enabled: true, failureCount: 0 } as never;
  const msg = { title: 'INC-9001 Disk full', text: 'details', severity: 'HIGH', status: 'FIRING' as const, incidentId: 'INC-9001', link: 'https://ops.example.com/incidents?id=INC-9001' };

  script['/log'] = [503, 200];
  const ok = await notify.sendToChannel(ch, msg);
  script['/log'] = [400];
  const bad = await notify.sendToChannel(ch, { ...msg, status: 'RESOLVED' });
  assert.equal(ok.ok, true); assert.equal(bad.ok, false);

  const all = await deliveries.listDeliveries({ channelId: 'ch-log', page: 1, pageSize: 10 });
  assert.equal(all.pagination.total, 2);
  // Both sends can share a millisecond, so identify them by type (FIRING was sent first, RESOLVED second)
  const first = all.data.find(r => r.kind === 'FIRING')!;
  const latest = all.data.find(r => r.kind === 'RESOLVED')!;
  assert.equal(first.result, 'DELIVERED'); assert.equal(first.attempts, 2, 'the retry is counted');
  assert.equal(first.kind, 'FIRING'); assert.equal(first.incidentId, 'INC-9001'); assert.equal(first.channelName, 'Log test');
  assert.equal(latest.result, 'FAILED'); assert.equal(latest.attempts, 1); assert.match(latest.error!, /HTTP 400/);
  assert.equal(JSON.stringify(latest).includes(base), false, 'the channel target is never stored in the log');

  assert.equal((await deliveries.listDeliveries({ channelId: 'ch-log', result: 'FAILED', page: 1, pageSize: 10 })).pagination.total, 1);
  assert.equal((await deliveries.listDeliveries({ channelId: 'ch-log', kind: 'FIRING', page: 1, pageSize: 10 })).data[0].id, first.id);
  assert.equal((await deliveries.listDeliveries({ incidentId: 'INC-9001', page: 1, pageSize: 10 })).pagination.total, 2);

  const stats = await deliveries.deliveryStats(24);
  assert.deepEqual({ d: stats.channels['ch-log'].delivered, f: stats.channels['ch-log'].failed }, { d: 1, f: 1 });
  assert.match(stats.channels['ch-log'].lastError!, /HTTP 400/);

  // Resend the failed one: same message, linked to the original
  const original = (await deliveries.getDelivery(latest.id))!;
  const again = await notify.sendToChannel(ch, original.message, original.id);
  assert.equal(again.ok, true);
  const resent = (await deliveries.getDelivery(again.deliveryId!))!;
  assert.equal(resent.resendOf, original.id);
  assert.equal(resent.kind, 'RESOLVED');
  assert.equal(resent.title, original.title);
});

test('Teams: Workflows webhook URLs get an Adaptive Card, connector URLs a MessageCard; a 405 explains itself', async () => {
  const msg = { title: 'INC-7 API down', text: 'Severity: CRITICAL\nDetail: HTTP 503', severity: 'CRITICAL', status: 'FIRING' as const, link: 'https://ops.example.com/incidents?id=INC-7' };
  const wf = notify.teamsPayload('https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=x', msg) as any;
  assert.equal(wf.type, 'message');
  const card = wf.attachments[0];
  assert.equal(card.contentType, 'application/vnd.microsoft.card.adaptive');
  assert.equal(card.content.type, 'AdaptiveCard');
  assert.match(card.content.body[0].text, /\[FIRING\] INC-7 API down/);
  assert.equal(card.content.body.length, 3, 'title + one block per text line');
  assert.equal(card.content.actions[0].url, msg.link);
  assert.equal(notify.isTeamsWorkflowUrl('https://default123.4e.environment.api.powerplatform.com/powerautomate/automations/x'), true);

  const legacy = notify.teamsPayload('https://contoso.webhook.office.com/webhookb2/abc', msg) as any;
  assert.equal(legacy['@type'], 'MessageCard');

  // A destination that only serves web pages: 405 with a plain-language reason, not retried
  script['/page'] = [405];
  const r = await notify.sendToChannel({ id: 'ch-page', name: 'page', type: 'WEBHOOK', targetEndpoint: `${base}/page`, enabled: true, failureCount: 0 } as never,
    { title: 'T', text: 'x', severity: 'INFO', status: 'TEST' });
  assert.equal(r.ok, false);
  assert.match(r.error!, /HTTP 405 — this URL does not accept POST requests/);
  assert.equal(raw.filter(x => x.url === '/page').length, 1, '405 is not retried');

  // A pasted "Get link to channel" URL is refused before any request
  const before = raw.length;
  const link = await notify.sendToChannel(
    { id: 'ch-link', name: 'new', type: 'TEAMS', targetEndpoint: 'https://teams.cloud.microsoft/l/chat/19:abc/conversations', enabled: true, failureCount: 0 } as never,
    { title: 'T', text: 'x', severity: 'INFO', status: 'TEST' },
  );
  assert.equal(link.ok, false);
  assert.match(link.error!, /link to a Teams channel, not a webhook/);
  assert.equal(raw.length, before, 'a channel link is not POSTed');

  // Valid targets: Workflows (logic.azure.com / powerplatform.com) with sig=, and legacy connector URLs
  assert.equal(notify.teamsTargetProblem('https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01&sig=x'), null);
  assert.equal(notify.teamsTargetProblem('https://default1.4e.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke?api-version=1&sig=x'), null);
  assert.equal(notify.teamsTargetProblem('https://contoso.webhook.office.com/webhookb2/abc/IncomingWebhook/def/ghi'), null);
  // Invalid ones, with the fix in the message
  assert.match(notify.teamsTargetProblem('https://teams.live.com/l/message/x')!, /link to a Teams channel/);
  assert.match(notify.teamsTargetProblem('https://flow.microsoft.com/manage/flows/x')!, /Power Automate editor page/);
  assert.match(notify.teamsTargetProblem('https://login.microsoftonline.com/common/oauth2')!, /Microsoft web page/);
  assert.match(notify.teamsTargetProblem('https://x.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/a/triggers/manual/paths/invoke')!, /"sig=" parameter is missing/);
  assert.match(notify.teamsTargetProblem('not a url')!, /not a valid URL/);
  // The Workflows payload is an Adaptive Card inside a "message" (what the Teams workflow trigger expects)
  const wf2 = notify.teamsPayload('https://prod-1.westeurope.logic.azure.com/workflows/a?sig=x', { title: 'T', text: 'a\nb', severity: 'INFO', status: 'TEST' }) as any;
  assert.equal(wf2.attachments.length, 1);
  assert.equal(wf2.attachments[0].content.version, '1.4');
  assert.deepEqual(wf2.attachments[0].content.actions, [], 'no link → no action');
});

test('PagerDuty: FIRING triggers and RESOLVED resolves the same incident; severity is mapped', () => {
  const key = 'R01234567890123456789012345678901';
  const firing = notify.pagerdutyPayload(key, { title: 'INC-9 API down', text: 'detail', severity: 'CRITICAL', status: 'FIRING', incidentId: 'INC-9', link: 'https://ops.example/incidents?id=INC-9' });
  assert.equal(firing.routing_key, key);
  assert.equal(firing.event_action, 'trigger');
  assert.equal(firing.dedup_key, 'INC-9');
  assert.equal((firing.payload as { severity: string }).severity, 'critical');
  assert.deepEqual(firing.links, [{ href: 'https://ops.example/incidents?id=INC-9', text: 'Scholario Ops' }]);

  const resolved = notify.pagerdutyPayload(key, { title: 'INC-9 API down', text: 'ok', severity: 'WARNING', status: 'RESOLVED', incidentId: 'INC-9' });
  assert.equal(resolved.event_action, 'resolve');
  assert.equal(resolved.dedup_key, 'INC-9', 'resolve uses the same dedup key as the trigger');
  assert.equal((resolved.payload as { severity: string }).severity, 'warning');
  assert.equal(resolved.links, undefined);

  const high = notify.pagerdutyPayload(key, { title: 't', text: 'x', severity: 'HIGH', status: 'ESCALATED', incidentId: 'INC-1' });
  assert.equal(high.event_action, 'trigger');
  assert.equal((high.payload as { severity: string }).severity, 'error');
  const info = notify.pagerdutyPayload(key, { title: 't', text: 'x', severity: 'INFO', status: 'INFO', incidentId: 'INC-2' });
  assert.equal((info.payload as { severity: string }).severity, 'info');
  const emergency = notify.pagerdutyPayload(key, { title: 't', text: 'x', severity: 'EMERGENCY', status: 'FIRING', incidentId: 'INC-3' });
  assert.equal((emergency.payload as { severity: string }).severity, 'critical');
});

test('read state: per user; unread filter and counts; mark read / unread; mark-all-read then unread again; search + sort; removed with the delivery', async () => {
  const deliveries = await import('../server/deliveries.ts');
  const { query: q, T: t } = await import('../server/db.ts');
  const ch = { id: 'ch-read', name: 'Read test', type: 'WEBHOOK', targetEndpoint: `${base}/read`, enabled: true, failureCount: 0 } as never;
  for (const title of ['Alpha disk full', 'Beta API down', 'Gamma recovered']) {
    await notify.sendToChannel(ch, { title, text: 'x', severity: 'HIGH', status: 'FIRING', incidentId: title === 'Beta API down' ? 'INC-4242' : undefined });
  }
  script['/read'] = [400];
  await notify.sendToChannel(ch, { title: 'Delta failing', text: 'x', severity: 'HIGH', status: 'FIRING' });

  const list = async (user: string, extra: Partial<Parameters<typeof deliveries.listDeliveries>[0]> = {}) =>
    (await deliveries.listDeliveries({ channelId: 'ch-read', page: 1, pageSize: 50, ...extra }, user)).data;
  const alice = 'user-alice', bob = 'user-bob';
  const all = await list(alice);
  assert.equal(all.length, 4);
  assert.ok(all.every(r => r.read === false), 'new deliveries start unread');
  const before = await deliveries.unreadCounts(alice);
  assert.ok(before.unread >= 4 && before.unreadFailed >= 1);

  // Alice reads two; Bob is unaffected
  const [d1, d2] = all;
  assert.equal(await deliveries.setRead(alice, [d1.id, d2.id, 'not-a-uuid', '00000000-0000-0000-0000-000000000000'], true), 2, 'unknown ids are ignored');
  assert.equal((await list(alice, { unread: true })).length, 2);
  assert.equal((await list(bob, { unread: true })).length, 4, 'read state is per user');
  assert.equal((await deliveries.unreadCounts(alice)).unread, before.unread - 2);

  // Mark all read, then one explicitly unread again
  await deliveries.markAllRead(alice);
  assert.equal((await deliveries.unreadCounts(alice)).unread, 0);
  await deliveries.setRead(alice, [d1.id], false);
  const unread = await list(alice, { unread: true });
  assert.deepEqual(unread.map(r => r.id), [d1.id], 'an explicit unread mark wins over mark-all-read');

  // Search (title / incident id) and sort
  assert.deepEqual((await list(alice, { q: 'api DOWN' })).map(r => r.title), ['Beta API down']);
  assert.deepEqual((await list(alice, { q: 'INC-4242' })).map(r => r.title), ['Beta API down']);
  assert.equal((await list(alice, { q: '%' })).length, 0, 'LIKE wildcards are escaped');
  assert.deepEqual((await list(alice, { sort: 'oldest' })).map(r => r.title), [...all].reverse().map(r => r.title));

  // Read marks go with their delivery (retention pruning)
  await q(`DELETE FROM ${t('notification_deliveries')} WHERE id = $1`, [d1.id]);
  assert.equal(Number((await q(`SELECT count(*)::int n FROM ${t('notification_reads')} WHERE delivery_id = $1`, [d1.id])).rows[0].n), 0);
});

test('detail: the attempt chain of one notification (original → resend → resend of resend) and the per-user read flag', async () => {
  const deliveries = await import('../server/deliveries.ts');
  const ch = { id: 'ch-chain', name: 'Chain test', type: 'WEBHOOK', targetEndpoint: `${base}/chain`, enabled: true, failureCount: 0 } as never;
  const msg = { title: 'INC-5150 Queue stuck', text: 'details', severity: 'HIGH', status: 'FIRING' as const, incidentId: 'INC-5150' };
  script['/chain'] = [400];
  const first = await notify.sendToChannel(ch, msg);                         // failed
  const second = await notify.sendToChannel(ch, msg, first.deliveryId);      // resend: delivered
  const third = await notify.sendToChannel(ch, msg, second.deliveryId);      // resend of the resend
  await notify.sendToChannel(ch, { ...msg, title: 'Unrelated' });           // another message, not in the chain

  for (const start of [first.deliveryId!, second.deliveryId!, third.deliveryId!]) {
    const chain = await deliveries.deliveryChain(start);
    assert.deepEqual(chain.map(c => c.id), [first.deliveryId, second.deliveryId, third.deliveryId], `chain from ${start}`);
  }
  const chain = await deliveries.deliveryChain(first.deliveryId!);
  assert.deepEqual(chain.map(c => c.result), ['FAILED', 'DELIVERED', 'DELIVERED']);
  assert.equal(chain[1].resendOf, first.deliveryId);
  assert.deepEqual(await deliveries.deliveryChain('not-a-uuid'), []);

  const u = 'user-detail';
  assert.equal((await deliveries.getDeliveryForUser(first.deliveryId!, u))!.read, false);
  await deliveries.setRead(u, [first.deliveryId!], true);
  assert.equal((await deliveries.getDeliveryForUser(first.deliveryId!, u))!.read, true);
  assert.equal(await deliveries.getDeliveryForUser('00000000-0000-0000-0000-000000000000', u), null);
});

test('SSRF guard at delivery: private / metadata / plain-http targets refused before connecting (not retried); redirects are not followed', async () => {
  const send = (targetEndpoint: string) => notify.sendToChannel({ id: `ch-ssrf-${targetEndpoint.length}`, name: 'ssrf', type: 'WEBHOOK', targetEndpoint, enabled: true, failureCount: 0 } as never,
    { title: 'T', text: 'x', severity: 'INFO', status: 'TEST' });

  const priv = await send('https://10.255.255.1/hook');
  assert.equal(priv.ok, false);
  assert.match(priv.error!, /10\.255\.255\.1 is a private address/);
  const metadata = await send('https://169.254.169.254/latest/meta-data/');
  assert.match(metadata.error!, /link-local \/ cloud-metadata/);
  const loopback6 = await send('https://[::1]:9/hook');
  assert.match(loopback6.error!, /::1 is a loopback address/);
  const plain = await send('http://8.8.8.8/hook');
  assert.match(plain.error!, /Only https:\/\//);

  const deliveries = await import('../server/deliveries.ts');
  const logged = (await deliveries.getDelivery(priv.deliveryId!))!;
  assert.equal(logged.attempts, 1, 'a refused destination is not retried');

  // Redirect: the 302 is reported, its target is never contacted
  script['/moved'] = [302];
  const before = raw.filter(r => r.url === '/redirected').length;
  const moved = await send(`${base}/moved`);
  assert.equal(moved.ok, false);
  assert.match(moved.error!, /HTTP 302 — the destination redirects; redirects are not followed/);
  assert.equal(raw.filter(r => r.url === '/redirected').length, before, 'redirect target never contacted');
});

test('multi-step escalation: ordered steps each run once at their time, to their own channels; durable across a restart; acknowledge / resolve stop it', async () => {
  const policy = db.escalationPolicies.find(p => p.severity === 'HIGH')!;
  const saved = { ...policy };
  policy.steps = [
    { afterMin: 5, channels: ['ch-a'], notifyOnCall: false, label: 'Level 1 ops' },
    { afterMin: 15, channels: ['ch-b'], notifyOnCall: true, label: 'Level 2 DBA' },
  ];
  try {
    clear();
    const inc = alert('HIGH');
    await settle();
    clear(); // ignore the FIRING page
    minutesAgo(inc, 6);
    updateIncidentDurations(); await settle();
    assert.equal(posts('/a').filter(p => p.status === 'ESCALATED').length, 1, 'step 1 → channel A');
    assert.match(posts('/a')[0].text, /escalated to Level 1 ops \(step 1 of 2\)/);
    assert.equal(posts('/b').length, 0, 'step 2 not yet');
    assert.equal(inc.escalation!.stepsDone, 1);
    assert.equal(inc.escalation!.nextAt, new Date(Date.parse(inc.startedAt) + 15 * 60000).toISOString(), 'next step time is stored');
    updateIncidentDurations(); await settle();
    assert.equal(posts('/a').filter(p => p.status === 'ESCALATED').length, 1, 'a step runs once');

    // Restart: in-memory state is gone, the step counter is stored with the incident
    const { forgetNotificationMemoryForTests } = notify;
    forgetNotificationMemoryForTests();
    minutesAgo(inc, 16);
    updateIncidentDurations(); await settle();
    assert.equal(posts('/b').filter(p => p.status === 'ESCALATED').length, 1, 'step 2 → channel B');
    assert.match(posts('/b')[0].text, /Level 2 DBA \(step 2 of 2\)/);
    assert.equal(inc.escalation!.stepsDone, 2);
    assert.equal(inc.escalation!.nextAt, null, 'no further step');
    assert.equal(inc.escalation!.history.length, 2);
    updateIncidentDurations(); await settle();
    assert.equal(posts('/b').filter(p => p.status === 'ESCALATED').length, 1, 'nothing repeats after the last step');

    // Acknowledged after step 1: escalation stops and says so
    clear();
    const ack = alert('HIGH'); await settle(); clear();
    minutesAgo(ack, 6); updateIncidentDurations(); await settle();
    ack.acknowledged = true;
    updateIncidentDurations();
    assert.equal(ack.escalation!.stoppedReason, 'acknowledged');
    assert.equal(ack.escalation!.nextAt, null);
    assert.ok(ack.timeline.some(e => /Escalation stopped: incident acknowledged \(after step 1\)/.test(e.message)));
    minutesAgo(ack, 20); updateIncidentDurations(); await settle();
    assert.equal(posts('/b').length, 0, 'no step 2 after acknowledgement');

    // Resolved after step 1: stopped as resolved
    const res = alert('HIGH'); await settle(); clear();
    minutesAgo(res, 6); updateIncidentDurations(); await settle();
    resolveAlert(res.fingerprint!, 'Test', 'recovered'); await settle();
    updateIncidentDurations();
    assert.equal(res.escalation!.stoppedReason, 'resolved');
  } finally {
    Object.assign(policy, saved); delete policy.steps;
  }
});

test('one worker: while another process holds the escalation lock nothing is escalated here; when it is released this process takes over', async () => {
  const leader = await import('../server/leader.ts');
  const pg = (await import('pg')).default;
  const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await other.connect();
  try {
    assert.equal((await other.query('SELECT pg_try_advisory_lock($1::bigint) AS ok', [leader.LOCK_KEY.toString()])).rows[0].ok, true, 'the "other process" takes the lock');
    assert.equal(await leader.tryAcquire(), false);
    assert.equal(leader.isNotificationWorker(), false);
    clear();
    const inc = alert('HIGH'); await settle(); clear();
    minutesAgo(inc, 30);
    updateIncidentDurations(); await settle();
    assert.equal(posts('/a').length + posts('/b').length, 0, 'a follower sends no escalation');
    assert.equal(inc.escalatedAt, undefined);

    await other.query('SELECT pg_advisory_unlock($1::bigint)', [leader.LOCK_KEY.toString()]);
    assert.equal(await leader.tryAcquire(), true, 'lock free → this process becomes the worker');
    assert.equal(leader.workerState(), 'leader');
    updateIncidentDurations(); await settle();
    assert.equal(posts('/b').filter(p => p.status === 'ESCALATED').length, 1, 'the new worker escalates (once)');
    updateIncidentDurations(); await settle();
    assert.equal(posts('/b').filter(p => p.status === 'ESCALATED').length, 1);
  } finally {
    await leader.releaseLeadership();
    await other.end();
  }
});

test('duplicate protection survives a restart: the cooldown and "FIRING was sent" are rebuilt from the delivery log', async () => {
  clear();
  const fp = `esc-test:dedup-${Date.now()}`;
  const inc = openAlert({ fingerprint: fp, title: 'Dedup test', severity: 'HIGH', detail: 'x', source: 'Test' }).incident;
  await settle();
  assert.equal(posts('/a').filter(p => p.status === 'FIRING').length, 1);
  const { flushDeliveries } = await import('../server/deliveries.ts');
  await flushDeliveries();

  notify.forgetNotificationMemoryForTests();     // restart
  assert.ok(await notify.restoreNotificationMemory() >= 1);
  assert.equal(notify.notifyIncident(inc, 'FIRING'), false, 'within the cooldown: not sent again after the restart');
  await settle();
  assert.equal(posts('/a').filter(p => p.status === 'FIRING').length, 1);
  resolveAlert(fp, 'Test', 'ok'); await settle();
  assert.equal(posts('/a').filter(p => p.status === 'RESOLVED').length, 1, 'its recovery is still sent (FIRING was delivered before the restart)');
});

test('quiet hours: non-critical pages are held and sent when quiet hours end; open+recover inside them pages nobody; CRITICAL is never held; steps wait', async () => {
  const m = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  const hhmm = (x: number) => { const v = ((x % 1440) + 1440) % 1440; return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };
  const quietNow = { enabled: true, start: hhmm(m - 60), end: hhmm(m + 60), timezone: 'UTC' };
  const notQuietNow = { enabled: true, start: hhmm(m + 120), end: hhmm(m + 180), timezone: 'UTC' };
  const info = { id: 'p-info', severity: 'INFO' as const, channels: ['ch-a'], initialDelayMin: 0, repeatIntervalMin: 0, autoEscalateAfterMin: 0, escalateToTeam: '', quietHours: quietNow };
  const crit = { id: 'p-crit', severity: 'CRITICAL' as const, channels: ['ch-a'], initialDelayMin: 0, repeatIntervalMin: 0, autoEscalateAfterMin: 0, escalateToTeam: '', quietHours: quietNow };
  db.escalationPolicies.push(info as never, crit as never);
  const open = (sev: 'INFO' | 'CRITICAL', tag: string) => openAlert({ fingerprint: `quiet:${tag}:${Date.now()}`, title: `Quiet ${tag}`, severity: sev, detail: 'x', source: 'Test' }).incident;
  try {
    // 1. Opened and recovered inside quiet hours: nobody paged
    clear();
    const blip = open('INFO', 'blip'); await settle();
    assert.equal(posts('/a').length, 0, 'held');
    assert.equal(blip.quietHeld?.status, 'FIRING');
    assert.ok(blip.timeline.some(e => /held: quiet hours until \d\d:\d\d UTC/.test(e.message)));
    resolveAlert(blip.fingerprint!, 'Test', 'ok'); await settle();
    assert.equal(posts('/a').length, 0, 'no RESOLVED either');
    assert.equal(blip.quietHeld, undefined);
    assert.ok(blip.timeline.some(e => /Opened and recovered during quiet hours — nobody was paged/.test(e.message)));

    // 2. Still open when quiet hours end: the held page goes out once, marked as held
    const held = open('INFO', 'held'); await settle();
    assert.equal(posts('/a').length, 0);
    updateIncidentDurations(); await settle();
    assert.equal(posts('/a').length, 0, 'still quiet: still held');
    info.quietHours = notQuietNow;
    updateIncidentDurations(); await settle();
    assert.equal(posts('/a').filter(p => p.status === 'FIRING').length, 1, 'sent when quiet hours are over');
    assert.match(posts('/a')[0].text, /Held during quiet hours \(since \d\d:\d\d UTC\)/);
    assert.equal(held.quietHeld, undefined);
    updateIncidentDurations(); await settle();
    assert.equal(posts('/a').length, 1, 'sent once');

    // 3. CRITICAL is never held, even if a policy somehow carries quiet hours
    clear();
    open('CRITICAL', 'crit'); await settle();
    assert.equal(posts('/a').filter(p => p.status === 'FIRING').length, 1, 'critical delivered immediately');

    // 4. Escalation steps wait during quiet hours, run after them
    clear();
    info.quietHours = quietNow;
    (info as { steps?: unknown[] }).steps = [{ afterMin: 1, channels: ['ch-b'], notifyOnCall: false, label: 'Night shift' }];
    info.channels = ['ch-a'];
    const esc = open('INFO', 'esc'); await settle();
    minutesAgo(esc, 10);
    updateIncidentDurations(); await settle();
    assert.equal(posts('/b').length, 0, 'no escalation during quiet hours');
    info.quietHours = notQuietNow;
    updateIncidentDurations(); await settle();
    assert.equal(posts('/b').filter(p => p.status === 'ESCALATED').length, 1, 'escalated after quiet hours');
  } finally {
    db.escalationPolicies = db.escalationPolicies.filter(p => p.id !== 'p-info' && p.id !== 'p-crit');
  }
});

test('grouping: a burst of non-critical alerts for one application → first now, the rest in one summary; recovered-before-summary dropped; CRITICAL never grouped', async () => {
  const appId = crypto.randomUUID();
  db.applications.push({ id: appId, name: 'Group App', codeName: 'grp', tier: 'TIER_1' } as never);
  const mk = (n: number, severity: 'HIGH' | 'WARNING' | 'CRITICAL') =>
    openAlert({ fingerprint: `group:${appId}:${n}:${Date.now()}`, title: `Group alert ${n}`, severity, detail: 'x', applicationId: appId, source: 'Test' }).incident;
  const firing = () => posts('/a').filter(p => p.status === 'FIRING');
  try {
    clear();
    const a1 = mk(1, 'HIGH');
    await settle();
    assert.equal(firing().length, 1, 'the first alert goes out immediately');
    assert.match(firing()[0].title, /Group alert 1/);
    const a2 = mk(2, 'HIGH'), a3 = mk(3, 'HIGH'), a4 = mk(4, 'HIGH'); // (WARNING has a first-page delay in this file's policies)
    await settle();
    assert.equal(firing().length, 1, 'the others wait for the summary');
    assert.ok(a2.timeline.some(e => /Included in a grouped notification/.test(e.message)));
    assert.equal(typeof a2.notifyGroupPending, 'string', 'the buffered alert is flagged so a restart can still send it');
    assert.equal(notify.pendingGroupedAlerts() >= 2, true, 'health counts the alerts waiting for the summary');
    // a3 recovers before the summary: dropped, and no RESOLVED (nobody was paged for it)
    resolveAlert(a3.fingerprint!, 'Test', 'ok');
    await settle();
    assert.equal(posts('/a').filter(p => p.status === 'RESOLVED').length, 0);
    assert.ok(a3.timeline.some(e => /Recovered before the grouped notification was sent/.test(e.message)));

    // CRITICAL in the same burst: never grouped, delivered at once
    const c1 = mk(5, 'CRITICAL');
    await settle();
    assert.equal(firing().filter(p => p.title.includes('Group alert 5')).length, 1, 'critical delivered immediately');

    await new Promise(r => setTimeout(r, 1400)); // window closes
    await settle();
    const summary = firing().filter(p => /more alerts for Group App/.test(p.title));
    assert.equal(summary.length, 1, 'one summary');
    assert.match(summary[0].title, /^2 more alerts for Group App$/);
    assert.ok(summary[0].text.includes(`${a2.id} [HIGH] Group alert 2`), summary[0].text);
    assert.ok(summary[0].text.includes(`${a4.id} [HIGH] Group alert 4`), summary[0].text);
    assert.equal(summary[0].text.includes(a3.id), false, 'the recovered one is not in it');
    assert.equal(a2.notifyGroupPending, undefined, 'flag cleared once the summary is sent');
    assert.equal(a4.notifyGroupPending, undefined);

    // Grouped incidents now count as notified: their recovery is sent
    resolveAlert(a2.fingerprint!, 'Test', 'ok');
    await settle();
    assert.equal(posts('/a').filter(p => p.status === 'RESOLVED' && p.title.includes('Group alert 2')).length, 1);
    void a1; void c1;
  } finally {
    db.applications = db.applications.filter(a => a.id !== appId);
  }
});

test('grouping survives a restart: a summary still pending is sent once, and one already in the log is not repeated', async () => {
  const appId = crypto.randomUUID();
  db.applications.push({ id: appId, name: 'Restart Group', codeName: 'rgrp', tier: 'TIER_1' } as never);
  const mk = (n: number) =>
    openAlert({ fingerprint: `group-restart:${appId}:${n}:${Date.now()}`, title: `Restart alert ${n}`, severity: 'HIGH', detail: 'x', applicationId: appId, source: 'Test' }).incident;
  const summaries = () => posts('/a').filter(p => /more alerts for Restart Group/.test(p.title));
  try {
    clear();
    mk(1);
    await settle();
    const a2 = mk(2);
    const a3 = mk(3);
    const a4 = mk(4);
    await settle();
    assert.equal(typeof a2.notifyGroupPending, 'string');
    assert.equal(summaries().length, 0, 'the window has not closed');
    // Process died inside the window: the timer is gone, the flags are still stored
    notify.dropOpenGroupsForTests();
    assert.equal(notify.pendingGroupedAlerts(), 3, 'the waiting alerts are still visible from the stored flags');
    a3.status = 'RESOLVED'; // recovered before the replay — dropped, same as a live window
    const n = await notify.replayPendingGroupSummaries();
    assert.equal(n, 1);
    await settle();
    assert.equal(summaries().length, 1, 'one summary after restart');
    assert.match(summaries()[0].title, /^2 more alerts for Restart Group$/);
    assert.ok(summaries()[0].text.includes(a2.id));
    assert.ok(summaries()[0].text.includes(a4.id));
    assert.equal(summaries()[0].text.includes(a3.id), false, 'the recovered alert is not in the summary');
    assert.equal(a2.notifyGroupPending, undefined);
    assert.equal(a3.notifyGroupPending, undefined);
    assert.equal(a4.notifyGroupPending, undefined);
    assert.equal(notify.pendingGroupedAlerts(), 0);

    // Crash after the summary was delivered but before the flag was cleared
    a2.notifyGroupPending = new Date().toISOString();
    const n2 = await notify.replayPendingGroupSummaries();
    assert.equal(n2, 0, 'the delivery log shows this summary already went out');
    await settle();
    assert.equal(summaries().length, 1, 'not sent a second time');
    assert.equal(a2.notifyGroupPending, undefined);
  } finally {
    notify.dropOpenGroupsForTests();
    db.applications = db.applications.filter(a => a.id !== appId);
  }
});

test('retries honour Retry-After (429); delivery health adds up; a channel failing 3× in a row raises an alert that resolves on success', async () => {
  // Retry-After: 1 s, although the base backoff in this file is 50 ms
  const deliveries = await import('../server/deliveries.ts');
  const ch = { id: 'ch-ra', name: 'Retry-After test', type: 'WEBHOOK', targetEndpoint: `${base}/ra`, enabled: true, failureCount: 0 } as never;
  script['/ra'] = [429];
  const r = await notify.sendToChannel(ch, { title: 'RA', text: 'x', severity: 'INFO', status: 'TEST' });
  assert.equal(r.ok, true, 'delivered on the retry');
  const hits = raw.filter(x => x.url === '/ra');
  assert.equal(hits.length, 2);
  const logged = (await deliveries.getDelivery(r.deliveryId!))!;
  assert.equal(logged.attempts, 2);
  assert.ok(logged.durationMs >= 900, `waited for Retry-After (took ${logged.durationMs} ms)`);

  // Health numbers over the log
  const h = await deliveries.deliveryHealth(24);
  assert.ok(h.total >= 1 && h.delivered >= 1 && h.retries >= 1);
  assert.ok(h.successRate !== null && h.successRate > 0 && h.successRate <= 100);
  assert.ok(h.p95Ms !== null && h.p50Ms !== null && h.p95Ms >= h.p50Ms);
  assert.ok(h.channels.some(c => c.channelId === 'ch-ra' && c.delivered === 1));
  assert.equal(notify.deliveryRuntime().inFlight, 0, 'nothing in flight afterwards');

  // A channel failing 3× in a row → WARNING alert; back to success → resolved
  const { evaluateAlerts } = await import('../server/alerts.ts');
  const failing = { id: 'ch-flaky', name: 'Flaky hook', type: 'WEBHOOK', targetEndpoint: `${base}/flaky`, enabled: true, failureCount: 0, lastDeliveryAt: '', lastDeliveryStatus: 'PENDING' };
  db.channels.push(failing as never);
  try {
    script['/flaky'] = [400, 400, 400];
    for (let i = 0; i < 3; i++) await notify.sendToChannel(failing as never, { title: 'F', text: 'x', severity: 'INFO', status: 'TEST' });
    assert.equal(failing.failureCount, 3);
    evaluateAlerts();
    const inc = db.incidents.find(i => i.fingerprint === 'channel-failing:ch-flaky' && i.status !== 'RESOLVED');
    assert.ok(inc, 'channel-failing alert opened');
    assert.equal(inc!.severity, 'WARNING');
    assert.equal(JSON.stringify(inc).includes(base), false, 'the destination is not written into the incident');
    await notify.sendToChannel(failing as never, { title: 'F', text: 'x', severity: 'INFO', status: 'TEST' });
    assert.equal(failing.failureCount, 0);
    evaluateAlerts();
    assert.equal(db.incidents.find(i => i.fingerprint === 'channel-failing:ch-flaky')!.status, 'RESOLVED');
  } finally {
    db.channels = db.channels.filter(c => c.id !== 'ch-flaky');
  }
});
