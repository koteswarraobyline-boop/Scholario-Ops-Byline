import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusCause } from '../src/lib/statusCause.ts';
import type { AppDependency } from '../src/types/index.ts';

const dep = (name: string, status: AppDependency['status']): AppDependency => ({
  id: name, name, type: 'EXTERNAL_API', status, latencyMs: 0, lastChecked: '', target: '',
});

test('a bad application status cites the monitor or the register link that caused it', () => {
  assert.equal(statusCause('CRITICAL', [dep('API [PRD]', 'HEALTHY'), dep('Billing DB (HARD)', 'CRITICAL')]), 'Billing DB (HARD)');
  assert.equal(statusCause('WARNING', [dep('API [PRD]', 'HEALTHY'), dep('Cache (SOFT)', 'WARNING')]), 'Cache (SOFT)');
  assert.equal(statusCause('UNKNOWN', []), 'no monitors');
  assert.equal(statusCause('HEALTHY', [dep('API [PRD]', 'HEALTHY')]), null);
  assert.equal(statusCause('UNKNOWN', [dep('API [PRD]', 'UNKNOWN')]), null);
});
