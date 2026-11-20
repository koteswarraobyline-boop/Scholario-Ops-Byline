/**
 * Facts recorded on an incident for the outage path:
 * probe cadence, confirmation, Cloudflare origin health, and DR readiness.
 */
import type { DrOverall, IncidentOutage } from '../types/index.ts';

export function outageTitle(monitorName: string, opts: { credential: boolean; originUnhealthy: boolean }): string {
  if (opts.credential && opts.originUnhealthy) return `${monitorName} credential rejected — Cloudflare origin unhealthy`;
  if (opts.credential) return `${monitorName} credential rejected`;
  if (opts.originUnhealthy) return `${monitorName} is DOWN — Cloudflare origin unhealthy`;
  return `${monitorName} is DOWN`;
}

export function buildOutageSnapshot(input: {
  probeIntervalSec: number | null;
  confirmedFailures: number | null;
  confirmationThreshold: number | null;
  /** False when this incident has no Cloudflare pool to consult. */
  cloudflareChecked: boolean;
  originHealthy: boolean | null;
  originDetail?: string;
  drOverall: DrOverall | null;
  drDetail: string;
}): IncidentOutage {
  const cloudflareOrigin = !input.cloudflareChecked
    ? 'NOT_CHECKED'
    : input.originHealthy === false
      ? 'UNHEALTHY'
      : input.originHealthy === true
        ? 'HEALTHY'
        : 'UNKNOWN';
  const cloudflareDetail = !input.cloudflareChecked
    ? 'Cloudflare origin health was not checked (no load balancer mapping or no pool data).'
    : input.originDetail?.trim()
      || (cloudflareOrigin === 'UNHEALTHY'
        ? 'Cloudflare reports the origin unhealthy.'
        : cloudflareOrigin === 'HEALTHY'
          ? 'Cloudflare reports the origin healthy.'
          : 'Cloudflare origin health is unknown.');
  return {
    probeIntervalSec: input.probeIntervalSec,
    confirmedFailures: input.confirmedFailures,
    confirmationThreshold: input.confirmationThreshold,
    cloudflareOrigin,
    cloudflareDetail,
    drReadiness: input.drOverall ?? 'NOT_APPLICABLE',
    drDetail: input.drDetail,
    notified: false,
    escalationReady: false,
  };
}
