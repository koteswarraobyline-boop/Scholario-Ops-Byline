/**
 * Capacity rules with no database: units, boundaries, hysteresis, precedence, stale data.
 *   npx tsx --test tests/resources.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertUnit, evaluateCapacity, monitorBand, thresholdProblem, type CapacityInput } from '../src/lib/resources.ts';

const base = (over: Partial<CapacityInput> = {}): CapacityInput => ({
  kind: 'STORAGE',
  usage: null,
  capacity: 100,
  unlimited: false,
  thresholdMode: 'percent',
  warningValue: 85,
  criticalValue: 95,
  hardLimit: null,
  recoveryMargin: 2,
  previous: 'UNKNOWN',
  measuredAt: new Date(1_000_000).toISOString(),
  syncError: '',
  now: 1_000_000,
  staleMs: 900_000,
  monitorWarning: null,
  monitorCritical: null,
  ...over,
});

test('GB and GiB are different, and cores convert to millicores', () => {
  assert.equal(convertUnit(1, 'GB', 'bytes'), 1e9);
  assert.equal(convertUnit(1, 'GiB', 'bytes'), 1024 ** 3);
  assert.notEqual(convertUnit(1, 'GB', 'bytes'), convertUnit(1, 'GiB', 'bytes'));
  assert.equal(convertUnit(1.5, 'cores', 'millicores'), 1500);
  assert.equal(convertUnit(1500, 'millicores', 'cores'), 1.5);
  assert.throws(() => convertUnit(1, 'seats', 'users'), /Cannot convert seats to users/);
});

test('storage boundaries: 80 normal, 85 and 90 warning, 95 critical, 100 critical, 101 exceeded', () => {
  const at = (usage: number) => evaluateCapacity(base({ usage })).state;
  assert.equal(at(80), 'NORMAL');
  assert.equal(at(85), 'WARNING');
  assert.equal(at(90), 'WARNING');
  assert.equal(at(95), 'CRITICAL');
  assert.equal(at(100), 'CRITICAL');
  assert.equal(at(101), 'EXCEEDED');
  assert.equal(evaluateCapacity(base({ usage: 90 })).utilizationPercent, 90);
});

test('recovery holds the previous state until usage drops by the margin', () => {
  assert.equal(evaluateCapacity(base({ usage: 84, previous: 'WARNING' })).state, 'WARNING');
  assert.equal(evaluateCapacity(base({ usage: 82, previous: 'WARNING' })).state, 'NORMAL');
  assert.equal(evaluateCapacity(base({ usage: 94, previous: 'CRITICAL' })).state, 'CRITICAL');
  assert.equal(evaluateCapacity(base({ usage: 90, previous: 'CRITICAL' })).state, 'WARNING');
  assert.equal(evaluateCapacity(base({ usage: 101, previous: 'NORMAL' })).state, 'EXCEEDED');
  assert.equal(evaluateCapacity(base({ usage: 100, previous: 'EXCEEDED' })).state, 'CRITICAL');
});

test('90 of 100 seats warns at 90 percent; a headcount with no limit is not a breach', () => {
  const seats = evaluateCapacity(base({
    kind: 'SEATS', usage: 90, capacity: 100, warningValue: 90, criticalValue: 100,
  }));
  assert.equal(seats.state, 'WARNING');
  const people = evaluateCapacity(base({
    kind: 'ACTIVE_USERS', usage: 80, capacity: null, warningValue: null, criticalValue: null, previous: 'UNKNOWN',
  }));
  assert.equal(people.state, 'NORMAL');
  assert.equal(people.utilizationPercent, null);
  assert.equal(people.thresholdFrom, 'none');
});

test('an API quota is judged inside its own numbers and is not a percent of a different window', () => {
  const hour = evaluateCapacity(base({
    kind: 'API_QUOTA', usage: 8000, capacity: 10000, warningValue: 80, criticalValue: 100,
  }));
  assert.equal(hour.state, 'WARNING');
  assert.equal(evaluateCapacity(base({
    kind: 'API_QUOTA', usage: 10000, capacity: 10000, warningValue: 80, criticalValue: 100,
  })).state, 'CRITICAL');
  assert.equal(evaluateCapacity(base({
    kind: 'API_QUOTA', usage: 10001, capacity: 10000, warningValue: 80, criticalValue: 100,
  })).state, 'EXCEEDED');
});

test('missing usage is not zero, stale data is not healthy, and unknown capacity stays unknown', () => {
  const missing = evaluateCapacity(base({ usage: null, previous: 'CRITICAL' }));
  assert.equal(missing.state, 'UNKNOWN');
  assert.equal(missing.freshness, 'MISSING');
  const stale = evaluateCapacity(base({ usage: 10, now: 1_000_000 + 901_000 }));
  assert.equal(stale.state, 'STALE');
  assert.equal(stale.freshness, 'STALE');
  const unknownCap = evaluateCapacity(base({ kind: 'DATABASE_SIZE', usage: 10, capacity: null, warningValue: null, criticalValue: null }));
  assert.equal(unknownCap.state, 'UNKNOWN');
  const error = evaluateCapacity(base({ usage: null, syncError: 'database probe failed' }));
  assert.equal(error.freshness, 'ERROR');
});

test('resource thresholds win over a monitor override, which wins over the global default', () => {
  const own = evaluateCapacity(base({
    kind: 'CPU', usage: 90, capacity: 100, warningValue: 91, criticalValue: 99, monitorWarning: 50, monitorCritical: 60,
  }));
  assert.equal(own.thresholdFrom, 'resource');
  assert.equal(own.state, 'NORMAL');
  const monitor = evaluateCapacity(base({
    kind: 'CPU', usage: 90, capacity: 100, warningValue: null, criticalValue: null, monitorWarning: 95, monitorCritical: 99,
  }));
  assert.equal(monitor.thresholdFrom, 'monitor');
  assert.equal(monitor.state, 'NORMAL');
  const fallback = evaluateCapacity(base({
    kind: 'CPU', usage: 90, capacity: 100, warningValue: null, criticalValue: null,
  }));
  assert.equal(fallback.thresholdFrom, 'default');
  assert.equal(fallback.warning, 85);
  assert.equal(fallback.state, 'WARNING');
});

test('a zero monitor threshold uses the global default; an inverted pair is ignored', () => {
  assert.deepEqual(monitorBand('CPU', { warningThresholdMs: 0, criticalThresholdMs: 0 }), { warning: 85, critical: 95 });
  assert.deepEqual(monitorBand('CPU', { warningThresholdMs: 70, criticalThresholdMs: 90 }), { warning: 70, critical: 90 });
  assert.deepEqual(monitorBand('CPU', { warningThresholdMs: 90, criticalThresholdMs: 80 }), { warning: 85, critical: 95 });
  assert.deepEqual(monitorBand('SEATS', { warningThresholdMs: 10, criticalThresholdMs: 20 }), { warning: null, critical: null });
});

test('invalid threshold pairs are rejected and unlimited is not a percent of a missing capacity', () => {
  assert.match(thresholdProblem({ mode: 'percent', warning: 90, critical: 90, margin: 2, unlimited: false }) ?? '', /higher/);
  assert.match(thresholdProblem({ mode: 'percent', warning: 10, critical: 20, margin: 10, unlimited: false }) ?? '', /margin/);
  assert.match(thresholdProblem({ mode: 'percent', warning: 80, critical: 90, margin: 2, unlimited: true }) ?? '', /unlimited/);
  assert.equal(thresholdProblem({ mode: 'percent', warning: null, critical: null, margin: 2, unlimited: false }), null);
  const open = evaluateCapacity(base({
    kind: 'API_QUOTA', unlimited: true, capacity: null, usage: 5000, thresholdMode: 'absolute', warningValue: 1000, criticalValue: 9000,
  }));
  assert.equal(open.state, 'WARNING');
});
