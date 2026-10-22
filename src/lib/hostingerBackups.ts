/**
 * Hostinger recovery points, read from the documented backup and snapshot responses.
 * A missing field is left out. A virtual-machine object is not treated as a backup.
 */

export interface ProviderRecoveryPoint {
  /** Stable id: hostinger-backup:{vmId}:{id} or hostinger-snapshot:{vmId}:{id} */
  key: string;
  sizeGb: number;
  destination: string;
  completedAt: string;
  retentionDays: number;
}

const iso = (value: unknown): string | null => {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
};

/** Hostinger documents backup size as a byte count. Unknown or negative sizes stay 0. */
export function bytesToGb(size: unknown): number {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return 0;
  return Math.round((size / 1e9) * 1000) / 1000;
}

function retentionDays(createdAt: string, expiresAt: unknown): number {
  const expires = iso(expiresAt);
  if (!expires) return 0;
  const days = Math.round((Date.parse(expires) - Date.parse(createdAt)) / 86_400_000);
  return days > 0 && days <= 3650 ? days : 0;
}

function point(vmId: number, kind: 'backup' | 'snapshot', id: unknown, createdAt: unknown, size: unknown, destination: string, expiresAt?: unknown): ProviderRecoveryPoint | null {
  const when = iso(createdAt);
  // id 0 is the placeholder Hostinger returns when the VPS has no snapshot.
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || !when) return null;
  return {
    key: `hostinger-${kind}:${vmId}:${id}`,
    sizeGb: bytesToGb(size),
    destination,
    completedAt: when,
    retentionDays: retentionDays(when, expiresAt),
  };
}

/** Page body from GET /virtual-machines/{id}/backups. Objects without created_at are ignored. */
export function recoveryPointsFromBackupList(vmId: number, hostname: string, body: unknown): ProviderRecoveryPoint[] {
  const rows = Array.isArray(body) ? body : ((body as { data?: unknown[] } | null)?.data ?? []);
  const host = hostname || `vm ${vmId}`;
  const points: ProviderRecoveryPoint[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as { id?: unknown; size?: unknown; location?: unknown; created_at?: unknown };
    const location = typeof item.location === 'string' && item.location.trim() ? item.location.trim() : '';
    const destination = location ? `Hostinger backup · ${location} · ${host}` : `Hostinger backup · ${host}`;
    const parsed = point(vmId, 'backup', item.id, item.created_at, item.size, destination);
    if (parsed) points.push(parsed);
  }
  return points;
}

/** Body from GET /virtual-machines/{id}/snapshot. An empty or list body means there is no snapshot. */
export function recoveryPointFromSnapshot(vmId: number, hostname: string, body: unknown): ProviderRecoveryPoint | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const item = body as { id?: unknown; created_at?: unknown; expires_at?: unknown };
  const host = hostname || `vm ${vmId}`;
  return point(vmId, 'snapshot', item.id, item.created_at, null, `Hostinger snapshot · ${host}`, item.expires_at);
}
