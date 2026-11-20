/**
 * Root-cause category inference (pure, no database).
 *   npm run test:local -- tests/root-cause.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferRootCauseCategory, ROOT_CAUSE_CATEGORIES, ROOT_CAUSE_LABELS } from '../src/lib/rootCause.ts';

test('every category has a label', () => {
  for (const c of ROOT_CAUSE_CATEGORIES) {
    assert.ok(ROOT_CAUSE_LABELS[c], c);
  }
});

test('infers capacity, deployment, credential, provider, config, network, infra', () => {
  assert.equal(inferRootCauseCategory({ fingerprint: 'resource-limit:abc', detail: 'near capacity' }), 'CAPACITY');
  assert.equal(inferRootCauseCategory({ source: 'Capacity Forecast', detail: 'disk trending to full' }), 'CAPACITY');
  assert.equal(inferRootCauseCategory({ title: 'Deploy rolled back', detail: 'pipeline failed' }), 'DEPLOYMENT');
  assert.equal(inferRootCauseCategory({ detail: '401 unauthorized token expired' }), 'EXPIRED_CREDENTIAL');
  assert.equal(inferRootCauseCategory({ detail: 'Cloudflare origin unhealthy' }), 'PROVIDER_OUTAGE');
  assert.equal(inferRootCauseCategory({ detail: 'DNS misconfiguration in zone' }), 'CONFIGURATION');
  assert.equal(inferRootCauseCategory({ detail: 'connection refused ECONNREFUSED' }), 'NETWORK');
  assert.equal(inferRootCauseCategory({ fingerprint: 'heartbeat:srv1', detail: 'agent stale' }), 'INFRASTRUCTURE');
  assert.equal(inferRootCauseCategory({ fingerprint: 'monitor:m1', detail: 'HTTP 503 Service Unavailable' }), 'APPLICATION_BUG');
  assert.equal(inferRootCauseCategory({}), 'UNKNOWN');
});
