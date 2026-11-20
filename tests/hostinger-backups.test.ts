/**
 * Hostinger backup and snapshot bodies. No database and no token.
 *   npm run test:local -- tests/hostinger-backups.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesToGb, recoveryPointFromSnapshot, recoveryPointsFromBackupList } from '../src/lib/hostingerBackups.ts';

test('a documented backup row becomes one recovery point and a VM object does not', () => {
  const points = recoveryPointsFromBackupList(1268054, 'srv.example', {
    data: [
      { id: 325, size: 15240192, restore_time: 3600, location: 'nl-srv-nodebackups', created_at: '2025-02-27T11:54:22Z' },
      { id: 1001, hostname: 'srv-prd', state: 'running', cpus: 8 },
    ],
  });
  assert.equal(points.length, 1);
  assert.equal(points[0].key, 'hostinger-backup:1268054:325');
  assert.equal(points[0].sizeGb, bytesToGb(15240192));
  assert.equal(points[0].destination, 'Hostinger backup · nl-srv-nodebackups · srv.example');
  assert.equal(points[0].completedAt, '2025-02-27T11:54:22.000Z');
  assert.equal(points[0].retentionDays, 0);
});

test('a snapshot is kept and an empty list is not a snapshot', () => {
  const snap = recoveryPointFromSnapshot(9, 'ict', { id: 325, restore_time: 1800, created_at: '2025-02-27T11:54:22Z', expires_at: '2025-03-19T11:54:22Z' });
  assert.equal(snap?.key, 'hostinger-snapshot:9:325');
  assert.equal(snap?.sizeGb, 0);
  assert.equal(snap?.retentionDays, 20);
  assert.equal(recoveryPointFromSnapshot(9, 'ict', [{ id: 1, created_at: '2025-02-27T11:54:22Z' }]), null);
  assert.equal(recoveryPointFromSnapshot(9, 'ict', null), null);
  assert.equal(recoveryPointFromSnapshot(9, 'ict', { id: 0, created_at: '2026-10-22T06:14:54Z', expires_at: '2026-10-22T06:14:54Z' }), null);
});

test('negative or missing sizes are not turned into a capacity', () => {
  assert.equal(bytesToGb(undefined), 0);
  assert.equal(bytesToGb(-1), 0);
  const points = recoveryPointsFromBackupList(1, '', { data: [{ id: 2, created_at: 'not-a-date', size: 10 }] });
  assert.equal(points.length, 0);
});
