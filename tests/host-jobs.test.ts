/**
 * Host backup jobs never take a path from the request, and this process does not
 * start the script unless the check says the host can run it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostJobAvailability } from '../server/hostJobs.ts';

test('backup actions are an allowlist and do not start on this process unless it is Linux', () => {
  const bad = hostJobAvailability('restore-live');
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.status, 400);

  const backup = hostJobAvailability('backup');
  const restore = hostJobAvailability('restore-test');
  if (process.platform !== 'linux') {
    assert.equal(backup.ok, false);
    assert.equal(restore.ok, false);
    if (!backup.ok) assert.equal(backup.status, 501);
  } else if (backup.ok) {
    assert.match(backup.script, /backup-db\.sh$/);
    assert.equal(restore.ok, true);
  }
});
