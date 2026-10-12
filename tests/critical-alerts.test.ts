/** Rules for browser critical-incident alerts (src/lib/criticalAlerts.ts) — pure, no browser needed */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeNewCriticalAlerts, titleWithCriticalCount } from '../src/lib/criticalAlerts.ts';
import type { Incident } from '../src/types/index.ts';

const inc = (id: string, over: Partial<Incident> = {}) => ({ id, title: id, severity: 'CRITICAL', status: 'OPEN', acknowledged: false, ...over }) as Incident;

test('only new, open, unacknowledged CRITICAL / EMERGENCY incidents alert, once each; an escalation to CRITICAL alerts again', () => {
  const seen = new Set<string>();
  // Baseline at page load: nothing announced later for these
  takeNewCriticalAlerts([inc('A')], seen);
  assert.deepEqual(takeNewCriticalAlerts([inc('A')], seen), []);

  const fresh = takeNewCriticalAlerts([
    inc('A'), inc('B'), inc('C', { severity: 'EMERGENCY' }), inc('D', { severity: 'HIGH' }),
    inc('E', { acknowledged: true }), inc('F', { status: 'RESOLVED' }),
  ], seen);
  assert.deepEqual(fresh.map(i => i.id), ['B', 'C']);
  assert.deepEqual(takeNewCriticalAlerts([inc('B'), inc('C', { severity: 'EMERGENCY' })], seen), [], 'not twice');

  // D was HIGH (no alert); escalated to CRITICAL → alert now
  assert.deepEqual(takeNewCriticalAlerts([inc('D', { severity: 'CRITICAL' })], seen).map(i => i.id), ['D']);
});

test('tab title shows the count of open unacknowledged critical incidents', () => {
  assert.equal(titleWithCriticalCount('Ops', []), 'Ops');
  assert.equal(titleWithCriticalCount('Ops', [inc('A'), inc('B', { acknowledged: true }), inc('C', { severity: 'WARNING' }), inc('D', { severity: 'EMERGENCY' })]), '(2) CRITICAL · Ops');
});
