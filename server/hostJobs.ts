/**
 * Starts the existing host scripts. The restore test uses a scratch database and
 * refuses to restore into the live database. The web request never chooses the
 * file path or the database.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const SCRIPTS = { backup: 'backup-db.sh', 'restore-test': 'verify-backup.sh' } as const;
export type HostJob = keyof typeof SCRIPTS;
const running = new Set<string>();

export function hostJobAvailability(action: string): { ok: true; script: string } | { ok: false; status: number; message: string } {
  if (action !== 'backup' && action !== 'restore-test') return { ok: false, status: 400, message: 'Action must be backup or restore-test' };
  if (process.platform !== 'linux') {
    return { ok: false, status: 501, message: 'Backup and the restore test run on the Linux host. This computer does not start them.' };
  }
  const script = path.resolve(process.cwd(), 'deploy', SCRIPTS[action]);
  const deployDir = path.resolve(process.cwd(), 'deploy');
  if (path.dirname(script) !== deployDir || !fs.existsSync(script)) {
    return { ok: false, status: 501, message: 'The backup script is not installed on this host.' };
  }
  if (running.has(action)) return { ok: false, status: 409, message: 'That job is already running.' };
  return { ok: true, script };
}

export function startHostJob(action: HostJob): void {
  const check = hostJobAvailability(action);
  if (!check.ok) {
    const err = new Error(check.message) as Error & { status: number };
    err.status = check.status;
    throw err;
  }
  running.add(action);
  const child = spawn('bash', [check.script], { cwd: process.cwd(), shell: false, detached: true, stdio: 'ignore' });
  const done = () => running.delete(action);
  child.once('error', done);
  child.once('exit', done);
  child.unref();
}
