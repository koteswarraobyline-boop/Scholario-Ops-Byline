/**
 * Sample-data checks for credential expiry, API credential failures, outage facts, and severity.
 * No database and no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { credentialFailureFromResponse } from '../src/lib/credentialFailure.ts';
import { daysUntil, expiryState } from '../src/lib/credentialExpiry.ts';
import { suggestSeverity, severityAtLeast } from '../src/lib/severity.ts';
import { buildOutageSnapshot, outageTitle } from '../src/lib/outageFlow.ts';

const NOW = Date.parse('2026-11-13T09:00:00.000Z');

test('API key, token and subscription expiry states follow the warn window', () => {
  assert.equal(expiryState('2026-11-01T00:00:00.000Z', 14, NOW), 'EXPIRED');
  assert.equal(daysUntil(new Date(NOW - 2 * 86_400_000).toISOString(), NOW), -2);
  assert.equal(expiryState('2026-11-20T00:00:00.000Z', 14, NOW), 'EXPIRING');
  assert.equal(expiryState('2026-12-20T00:00:00.000Z', 14, NOW), 'OK');
  assert.equal(expiryState('not-a-date', 14, NOW), 'INVALID');
});

test('an expired AI API key in the response is a credential failure; a normal page is not', () => {
  const expired = credentialFailureFromResponse(401, JSON.stringify({
    error: { code: 'invalid_api_key', message: 'Incorrect API key provided' },
  }));
  assert.ok(expired);
  assert.match(expired.detail, /Credential rejected/);
  assert.match(expired.detail, /invalid_api_key/);
  assert.equal(credentialFailureFromResponse(200, '{"ok":true}'), null);
  assert.equal(credentialFailureFromResponse(403, 'blocked by the firewall'), null);
  const token = credentialFailureFromResponse(403, '{"error":"token has expired"}');
  assert.ok(token);
  assert.match(token.detail, /token has expired/);
  const leaked = credentialFailureFromResponse(401, 'invalid_api_key sk-live-abcdefghijklmnopqrstuvwxyz0123456789');
  assert.ok(leaked);
  assert.equal(leaked.detail.includes('sk-live-'), false);
});

test('severity is suggested from tier and reach', () => {
  const emergency = suggestSeverity({ tier: 'TIER_1', environment: 'PRD', usersStopped: 1200, usersAffected: 1500, hardCount: 2, softCount: 0 });
  assert.equal(emergency.severity, 'EMERGENCY');
  assert.equal(emergency.confident, true);
  assert.match(emergency.reason, /TIER 1/);
  assert.match(emergency.reason, /1,200/);

  const critical = suggestSeverity({ tier: 'TIER_1', environment: 'PRD', usersStopped: 500, usersAffected: 500, hardCount: 1, softCount: 0 });
  assert.equal(critical.severity, 'CRITICAL');

  const high = suggestSeverity({ tier: 'TIER_2', environment: 'PRD', usersStopped: 40, usersAffected: 40, hardCount: 1, softCount: 1 });
  assert.equal(high.severity, 'HIGH');

  const warning = suggestSeverity({ tier: 'TIER_3', environment: 'DR', usersStopped: 0, usersAffected: 12, hardCount: 0, softCount: 1 });
  assert.equal(warning.severity, 'WARNING');

  const unknown = suggestSeverity({ tier: null, environment: 'PRD', usersStopped: null, usersAffected: null, hardCount: 0, softCount: 0 });
  assert.equal(unknown.confident, false);
  assert.equal(severityAtLeast(unknown.severity, 'HIGH'), 'HIGH');
});

test('outage snapshot records the 30s probe, confirmation, Cloudflare origin and DR readiness', () => {
  const down = buildOutageSnapshot({
    probeIntervalSec: 30,
    confirmedFailures: 3,
    confirmationThreshold: 3,
    cloudflareChecked: true,
    originHealthy: false,
    originDetail: 'Origin 198.51.100.10 unhealthy in pool app-production',
    drOverall: 'NOT_READY',
    drDetail: 'NOT READY — DR application: no successful check',
  });
  assert.equal(down.probeIntervalSec, 30);
  assert.equal(down.confirmedFailures, 3);
  assert.equal(down.cloudflareOrigin, 'UNHEALTHY');
  assert.equal(down.drReadiness, 'NOT_READY');
  assert.equal(down.notified, false);
  assert.equal(down.escalationReady, false);
  assert.equal(outageTitle('AI API', { credential: true, originUnhealthy: true }), 'AI API credential rejected — Cloudflare origin unhealthy');

  const quiet = buildOutageSnapshot({
    probeIntervalSec: 30,
    confirmedFailures: 2,
    confirmationThreshold: 2,
    cloudflareChecked: false,
    originHealthy: null,
    drOverall: 'UNKNOWN',
    drDetail: 'UNKNOWN (0/4 core checks passing)',
  });
  assert.equal(quiet.cloudflareOrigin, 'NOT_CHECKED');
  assert.match(quiet.cloudflareDetail, /not checked/i);
  assert.equal(quiet.drReadiness, 'UNKNOWN');

  const healthy = buildOutageSnapshot({
    probeIntervalSec: null,
    confirmedFailures: null,
    confirmationThreshold: null,
    cloudflareChecked: true,
    originHealthy: true,
    drOverall: null,
    drDetail: 'No application linked',
  });
  assert.equal(healthy.cloudflareOrigin, 'HEALTHY');
  assert.equal(healthy.drReadiness, 'NOT_APPLICABLE');
});
