/**
 * Likely-cause correlation on sample records. No database.
 *   npm run test:local -- tests/likely-cause.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestLikelyCause } from '../src/lib/likelyCause.ts';

const startedAt = '2026-11-13T10:00:00.000Z';
const now = Date.parse('2026-11-13T10:05:00.000Z');
const base = {
  startedAt,
  applicationId: 'app-1',
  serverIds: ['srv-prd'],
  environment: 'PRD' as const,
  title: 'App down',
  detail: 'HTTP 503',
  fingerprint: 'monitor:m1',
  deployments: [],
  capacity: [],
  credentials: [],
  certificates: [],
  cloudflare: null,
  now,
};

test('a failed deployment in the last two hours outranks an expired credential, and both are listed', () => {
  const cause = suggestLikelyCause({
    ...base,
    deployments: [{
      applicationId: 'app-1', environment: 'PRD', status: 'FAILED', version: '1.4.2',
      startedAt: '2026-11-13T09:10:00.000Z', completedAt: '2026-11-13T09:12:00.000Z',
    }],
    credentials: [{ applicationId: 'app-1', environment: 'PRD', name: 'OpenAI key', expiresAt: '2026-11-12T00:00:00.000Z' }],
    capacity: [{ applicationId: 'app-1', serverId: 'srv-prd', name: 'PRD disk', alertState: 'EXCEEDED' }],
    cloudflare: { healthy: false, detail: 'origin 192.0.2.10 is unhealthy', checkedAt: '2026-11-13T09:55:00.000Z' },
  });
  assert.equal(cause.category, 'DEPLOYMENT');
  assert.equal(cause.confidence, 'HIGH');
  assert.match(cause.summary, /Likely cause: deployment 1\.4\.2 FAILED on PRD/);
  assert.match(cause.summary, /OpenAI key expired/);
  assert.match(cause.summary, /capacity alert PRD disk is EXCEEDED/);
  assert.match(cause.summary, /Cloudflare origin unhealthy/);
  assert.deepEqual(cause.evidence.map(e => e.source), ['DEPLOYMENT', 'CAPACITY', 'EXPIRY', 'CLOUDFLARE']);
});

test('capacity, expiry and an unhealthy Cloudflare origin each win when they are the only signal', () => {
  const capacity = suggestLikelyCause({
    ...base,
    capacity: [{ applicationId: null, serverId: 'srv-prd', name: 'PRD disk', alertState: 'CRITICAL' }],
  });
  assert.equal(capacity.category, 'CAPACITY');
  assert.equal(capacity.confidence, 'HIGH');

  const expiry = suggestLikelyCause({
    ...base,
    credentials: [{ name: 'Billing subscription', expiresAt: '2026-11-01T00:00:00.000Z' }],
  });
  assert.equal(expiry.category, 'EXPIRED_CREDENTIAL');
  assert.match(expiry.summary, /Billing subscription expired/);

  const certificate = suggestLikelyCause({
    ...base,
    certificates: [{ applicationId: 'app-1', environment: 'PRD', name: 'PRD TLS', daysLeft: -2, validTo: '2026-11-11T00:00:00.000Z' }],
  });
  assert.equal(certificate.category, 'CONFIGURATION');
  assert.match(certificate.summary, /certificate PRD TLS is expired/);

  const origin = suggestLikelyCause({
    ...base,
    cloudflare: { healthy: false, detail: 'origin 192.0.2.10 is unhealthy', checkedAt: startedAt },
  });
  assert.equal(origin.category, 'PROVIDER_OUTAGE');
  assert.equal(origin.confidence, 'HIGH');
});

test('a healthy origin, an old deployment and a future expiry are not a cause', () => {
  const cause = suggestLikelyCause({
    ...base,
    deployments: [{
      applicationId: 'app-1', environment: 'PRD', status: 'FAILED', version: '0.9.0',
      startedAt: '2026-11-13T07:00:00.000Z',
    }],
    credentials: [{ applicationId: 'app-1', environment: 'PRD', name: 'Still valid', expiresAt: '2027-01-01T00:00:00.000Z' }],
    capacity: [{ applicationId: 'app-1', serverId: null, name: 'Seats', alertState: 'NORMAL' }],
    cloudflare: { healthy: true, detail: 'origin is healthy', checkedAt: startedAt },
  });
  assert.equal(cause.confidence, 'NONE');
  assert.equal(cause.evidence.length, 0);
  assert.match(cause.summary, /No correlated deployment, capacity alert, expiry date or Cloudflare origin problem/);
  assert.equal(cause.category, 'APPLICATION_BUG');
});

test('a deployment for another application or environment is ignored', () => {
  const cause = suggestLikelyCause({
    ...base,
    deployments: [
      { applicationId: 'other', environment: 'PRD', status: 'FAILED', version: '9.9.9', startedAt: '2026-11-13T09:40:00.000Z' },
      { applicationId: 'app-1', environment: 'DR', status: 'FAILED', version: '9.9.8', startedAt: '2026-11-13T09:40:00.000Z' },
    ],
  });
  assert.equal(cause.confidence, 'NONE');
});
