/**
 * Root-cause categories for incidents. Inference is a starting point from source /
 * fingerprint / detail; operators can override on the incident.
 */
import type { RootCauseCategory } from '../types/index.ts';

export const ROOT_CAUSE_CATEGORIES = [
  'EXPIRED_CREDENTIAL',
  'CAPACITY',
  'DEPLOYMENT',
  'PROVIDER_OUTAGE',
  'CONFIGURATION',
  'NETWORK',
  'APPLICATION_BUG',
  'INFRASTRUCTURE',
  'UNKNOWN',
] as const satisfies readonly RootCauseCategory[];

export const ROOT_CAUSE_LABELS: Record<RootCauseCategory, string> = {
  EXPIRED_CREDENTIAL: 'Expired credential',
  CAPACITY: 'Capacity',
  DEPLOYMENT: 'Deployment',
  PROVIDER_OUTAGE: 'Provider outage',
  CONFIGURATION: 'Configuration',
  NETWORK: 'Network',
  APPLICATION_BUG: 'Application bug',
  INFRASTRUCTURE: 'Infrastructure',
  UNKNOWN: 'Unknown',
};

/** Infer a category from alert source, fingerprint and detail text. Never invents a stronger claim than the evidence. */
export function inferRootCauseCategory(input: {
  source?: string;
  fingerprint?: string;
  detail?: string;
  title?: string;
}): RootCauseCategory {
  const blob = [input.source, input.fingerprint, input.detail, input.title].filter(Boolean).join(' ').toLowerCase();
  if (!blob.trim()) return 'UNKNOWN';

  if (/\b(capacity|disk|inode|storage|quota|seat|forecast|over capacity|near capacity|time to full)\b/.test(blob)
    || blob.includes('resource-limit:') || blob.includes('capacity-disk:') || blob.includes('capacity forecast')) {
    return 'CAPACITY';
  }
  if (/\b(deploy|deployment|rollback|release|ci\/cd|pipeline)\b/.test(blob) || blob.includes('deployment:')) {
    return 'DEPLOYMENT';
  }
  if (/\b(credential|token|api.?key|password|auth|401|403|unauthori[sz]ed|expired.?cert|certificate.?expir)\b/.test(blob)) {
    return 'EXPIRED_CREDENTIAL';
  }
  if (/\b(cloudflare|hostinger|provider|third.?party|openai|external.?api)\b/.test(blob)
    || blob.includes('provider') || blob.includes('origin unhealthy')) {
    return 'PROVIDER_OUTAGE';
  }
  if (/\b(config|misconfig|dns|ssl|tls|zone|routing|steering)\b/.test(blob)) {
    return 'CONFIGURATION';
  }
  if (/\b(timeout|connection.?refus|dns.?error|network|unreachable|econnrefused|etimedout)\b/.test(blob)) {
    return 'NETWORK';
  }
  if (/\b(http\s*[45]\d\d|application.?bug|exception|stack.?trace|500|502|503|504)\b/.test(blob)
    || blob.startsWith('monitor:')) {
    // Monitor HTTP failures are treated as application-level unless something more specific matched above
    if (/\b(http\s*[45]\d\d|503|502|500|504)\b/.test(blob)) return 'APPLICATION_BUG';
  }
  if (/\b(server|heartbeat|agent|systemd|pm2|cpu|memory|swap|infrastructure|vps|telemetry)\b/.test(blob)
    || blob.includes('heartbeat:') || blob.includes('server:')) {
    return 'INFRASTRUCTURE';
  }
  return 'UNKNOWN';
}
