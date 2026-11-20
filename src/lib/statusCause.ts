import type { AppDependency, OperationalStatus } from '../types/index.ts';

const LINK = /\((HARD|SOFT)\)$/;

/** The check or register link that explains a bad status. Null when the status has no cited cause. */
export function statusCause(status: OperationalStatus, dependencies: AppDependency[]): string | null {
  if (status === 'CRITICAL' || status === 'WARNING' || status === 'STALE') {
    const hit = dependencies.find(d => d.status === status)
      ?? dependencies.find(d => d.status === 'CRITICAL' || d.status === 'WARNING' || d.status === 'STALE');
    return hit?.name ?? null;
  }
  if (status === 'UNKNOWN' && dependencies.every(d => LINK.test(d.name))) return 'no monitors';
  return null;
}

export function registerLinks(dependencies: AppDependency[]): AppDependency[] {
  return dependencies.filter(d => LINK.test(d.name));
}
