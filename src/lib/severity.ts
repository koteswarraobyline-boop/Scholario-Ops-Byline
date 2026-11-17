/**
 * Suggests an incident severity from the application tier and how far the failure reaches.
 * confident is false when the register has no tier: callers keep the severity the check already chose.
 */
import type { IncidentSeverity } from '../types/index.ts';

export interface SeverityInput {
  tier?: 'TIER_1' | 'TIER_2' | 'TIER_3' | null;
  environment?: 'PRD' | 'DR';
  usersStopped: number | null;
  usersAffected: number | null;
  hardCount: number;
  softCount: number;
}

export interface SeveritySuggestion {
  severity: IncidentSeverity;
  reason: string;
  confident: boolean;
}

const REACH = (n: number) => (n > 0 ? `${n.toLocaleString()} users` : 'no user count');

export function suggestSeverity(input: SeverityInput): SeveritySuggestion {
  const tier = input.tier ?? null;
  const env = input.environment ?? 'PRD';
  const stopped = input.usersStopped ?? 0;
  const affected = input.usersAffected ?? stopped;
  const hard = input.hardCount > 0 || stopped > 0;
  const reach = stopped > 0 ? stopped : affected;
  const where = env === 'PRD' ? 'production' : 'DR';

  if (!tier) {
    return {
      severity: env === 'PRD' ? 'HIGH' : 'WARNING',
      confident: false,
      reason: 'No application tier on the register; severity stays with the check that opened the incident.',
    };
  }

  const reachText = `${tier.replace('_', ' ')} ${where}, ${hard ? 'hard' : 'soft'} reach, ${REACH(reach)}`;

  if (tier === 'TIER_1' && env === 'PRD' && hard && reach >= 1000) {
    return { severity: 'EMERGENCY', confident: true, reason: `${reachText} — tier 1 production with a wide hard stop.` };
  }
  if (tier === 'TIER_1' && env === 'PRD' && hard) {
    return { severity: 'CRITICAL', confident: true, reason: `${reachText} — tier 1 production stops here.` };
  }
  if (tier === 'TIER_1' && env === 'PRD') {
    return { severity: 'HIGH', confident: true, reason: `${reachText} — tier 1, soft reach only.` };
  }
  if (tier === 'TIER_1' && hard) {
    return { severity: 'HIGH', confident: true, reason: `${reachText} — tier 1 on DR.` };
  }
  if (tier === 'TIER_2' && env === 'PRD' && hard) {
    return { severity: 'HIGH', confident: true, reason: `${reachText}.` };
  }
  if (tier === 'TIER_3' && env === 'PRD' && hard && reach >= 1000) {
    return { severity: 'HIGH', confident: true, reason: `${reachText} — tier 3 but the hard reach is wide.` };
  }
  return { severity: 'WARNING', confident: true, reason: `${reachText}.` };
}

const RANK: Record<IncidentSeverity, number> = { INFO: 0, WARNING: 1, HIGH: 2, CRITICAL: 3, EMERGENCY: 4 };

/** Raises a suggestion up to a floor. Used when an expired credential must be at least HIGH. */
export function severityAtLeast(severity: IncidentSeverity, floor: IncidentSeverity): IncidentSeverity {
  return RANK[severity] < RANK[floor] ? floor : severity;
}
