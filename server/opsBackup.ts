/**
 * Health of Scholario Ops' OWN database backup, read from the status files written by
 * deploy/backup-db.sh (last-backup.json) and deploy/verify-backup.sh (last-restore-test.json)
 * in OPS_BACKUP_DIR (default ./backups, i.e. /var/www/scholario-ops/backups in production).
 *
 * No status file → NOT_CONFIGURED (shown, never alerted: development machines have no backups).
 * Nothing is executed and nothing leaves the server: the app only reads two small JSON files.
 */
import fs from 'fs';
import path from 'path';
import { config } from './config.ts';
import type { OpsBackupHealth, OpsBackupRun, OpsRestoreTest } from '../src/types/index.ts';

/** A restore test older than this is overdue (weekly cron + one day of slack) */
export const RESTORE_TEST_MAX_AGE_DAYS = 8;

function readJson<T>(file: string): { value: T | null; error: string | null } {
  try {
    if (!fs.existsSync(file)) return { value: null, error: null };
    return { value: JSON.parse(fs.readFileSync(file, 'utf8')) as T, error: null };
  } catch (err) {
    return { value: null, error: `${path.basename(file)} is unreadable: ${(err as Error).message.slice(0, 120)}` };
  }
}

const validTime = (s: unknown): number | null => (typeof s === 'string' && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null);

export function opsBackupHealth(now = Date.now(), dir = config.opsBackupDir): OpsBackupHealth {
  const b = readJson<OpsBackupRun>(path.join(dir, 'last-backup.json'));
  const r = readJson<OpsRestoreTest>(path.join(dir, 'last-restore-test.json'));
  const backup = b.value, restoreTest = r.value;
  const problems: string[] = [];
  const advisories: string[] = [];

  if (b.error) problems.push(b.error);
  if (!backup && !b.error) {
    return { status: 'NOT_CONFIGURED', backup: null, restoreTest, ageHours: null, problems, advisories: ['No backup has run on this server yet: install the deploy/backup-db.sh cron job'] };
  }

  const completed = validTime(backup?.completedAt);
  const ageHours = completed === null ? null : Math.round(((now - completed) / 3_600_000) * 10) / 10;
  let status: OpsBackupHealth['status'] = 'HEALTHY';

  if (backup?.status === 'FAILED') {
    status = 'FAILED';
    problems.push(`Last backup failed: ${backup.error ?? 'unknown error'}`);
  } else if (ageHours === null || ageHours > config.backupMaxAgeHours) {
    status = 'STALE';
    problems.push(ageHours === null ? 'Last backup time is unknown' : `Last backup is ${Math.round(ageHours)} h old (limit ${config.backupMaxAgeHours} h)`);
  }
  if (backup?.offsite && !backup.offsite.ok) {
    if (status === 'HEALTHY') status = 'DEGRADED';
    problems.push(`Off-server copy to ${backup.offsite.target} failed: ${backup.offsite.error ?? 'unknown error'}`);
  }

  const tested = validTime(restoreTest?.testedAt);
  if (r.error) problems.push(r.error);
  if (restoreTest?.status === 'FAILED') {
    if (status === 'HEALTHY') status = 'DEGRADED';
    problems.push(`Last restore test failed: ${restoreTest.error ?? 'unknown error'}`);
  } else if (!restoreTest) {
    advisories.push('Never restore-tested: schedule deploy/verify-backup.sh weekly');
  } else if (tested === null || now - tested > RESTORE_TEST_MAX_AGE_DAYS * 86_400_000) {
    advisories.push(`Restore test overdue (last ${tested === null ? 'unknown' : `${Math.floor((now - tested) / 86_400_000)} days ago`})`);
  }
  if (backup && backup.encryption === 'none') advisories.push('Backups are not encrypted: set BACKUP_AGE_RECIPIENT or BACKUP_GPG_RECIPIENT');
  if (backup && !backup.offsite) advisories.push('Backups stay on this server only: set BACKUP_REMOTE (e.g. the DR node)');

  return { status, backup, restoreTest, ageHours, problems, advisories };
}
