/**
 * Suggest an incident cause by correlating four kinds of evidence:
 * a recent deployment, a capacity alert, an expiry date, and Cloudflare origin health.
 * Keyword text is used only when none of those correlate.
 */
import type { CauseConfidence, CauseEvidence, CauseSignalSource, LikelyCause, RootCauseCategory } from '../types/index.ts';
import { inferRootCauseCategory, ROOT_CAUSE_LABELS } from './rootCause.ts';

const WINDOW_MS = 2 * 60 * 60 * 1000;
const SKEW_MS = 5 * 60 * 1000;
const EXPIRY_SOON_MS = 7 * 86_400_000;

export interface LikelyCauseInput {
  startedAt: string;
  applicationId?: string;
  serverIds?: string[];
  environment?: 'PRD' | 'DR';
  title?: string;
  detail?: string;
  fingerprint?: string;
  source?: string;
  deployments: Array<{
    applicationId: string;
    environment: string;
    status: string;
    version: string;
    startedAt: string;
    completedAt?: string;
  }>;
  capacity: Array<{
    applicationId: string | null;
    serverId: string | null;
    name: string;
    alertState: string;
  }>;
  credentials: Array<{
    applicationId?: string;
    environment?: string;
    name: string;
    expiresAt: string;
  }>;
  certificates: Array<{
    applicationId?: string;
    environment?: string;
    name: string;
    daysLeft: number | null;
    validTo: string | null;
  }>;
  cloudflare: { healthy: boolean | null; detail: string; checkedAt: string | null } | null;
  now?: number;
}

function inWindow(iso: string | undefined, startedMs: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t <= startedMs + SKEW_MS && t >= startedMs - WINDOW_MS;
}

function sameEnvironment(recordEnv: string | undefined, incidentEnv: string | undefined): boolean {
  if (!recordEnv || !incidentEnv) return true;
  return recordEnv === incidentEnv;
}

/** A record with no application applies everywhere. A scoped record applies only to that application. */
function sameApplication(recordApp: string | null | undefined, incidentApp: string | undefined): boolean {
  if (!incidentApp) return !recordApp;
  if (!recordApp) return true;
  return recordApp === incidentApp;
}

function confidenceOf(score: number): CauseConfidence {
  if (score >= 80) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  if (score > 0) return 'LOW';
  return 'NONE';
}

function categoryFor(source: CauseSignalSource, detail: string): RootCauseCategory {
  if (source === 'DEPLOYMENT') return 'DEPLOYMENT';
  if (source === 'CAPACITY') return 'CAPACITY';
  if (source === 'CLOUDFLARE') return 'PROVIDER_OUTAGE';
  return detail.toLowerCase().startsWith('certificate') ? 'CONFIGURATION' : 'EXPIRED_CREDENTIAL';
}

function best(rows: CauseEvidence[]): CauseEvidence | null {
  return rows.reduce<CauseEvidence | null>((top, row) => (!top || row.score > top.score ? row : top), null);
}

/** Rank the four signals. The highest score is the suggested cause; the others stay as evidence. */
export function suggestLikelyCause(input: LikelyCauseInput): LikelyCause {
  const now = input.now ?? Date.now();
  const startedMs = Date.parse(input.startedAt);
  const at = Number.isNaN(startedMs) ? now : startedMs;
  const correlatedAt = new Date(now).toISOString();
  const evidence: CauseEvidence[] = [];

  const deployments = input.deployments.filter(d =>
    sameApplication(d.applicationId, input.applicationId)
    && sameEnvironment(d.environment, input.environment)
    && (inWindow(d.startedAt, at) || inWindow(d.completedAt, at)),
  );
  const deployment = best(deployments.map(d => {
    const failed = d.status === 'FAILED' || d.status === 'ROLLED_BACK';
    return {
      source: 'DEPLOYMENT' as const,
      detail: `deployment ${d.version} ${d.status} on ${d.environment}`,
      at: d.completedAt || d.startedAt,
      score: failed ? 92 : 55,
    };
  }));
  if (deployment) evidence.push(deployment);

  const capacity = best(input.capacity.filter(row => {
    if (!['WARNING', 'CRITICAL', 'EXCEEDED'].includes(row.alertState)) return false;
    if (input.applicationId && row.applicationId === input.applicationId) return true;
    if (row.serverId && input.serverIds?.includes(row.serverId)) return true;
    return false;
  }).map(row => ({
    source: 'CAPACITY' as const,
    detail: `capacity alert ${row.name} is ${row.alertState}`,
    at: null,
    score: row.alertState === 'EXCEEDED' ? 88 : row.alertState === 'CRITICAL' ? 80 : 42,
  })));
  if (capacity) evidence.push(capacity);

  const expiries: CauseEvidence[] = [];
  for (const cred of input.credentials) {
    if (!sameApplication(cred.applicationId, input.applicationId)) continue;
    if (!sameEnvironment(cred.environment, input.environment)) continue;
    const exp = Date.parse(cred.expiresAt);
    if (Number.isNaN(exp)) continue;
    if (exp <= at) {
      expiries.push({ source: 'EXPIRY', detail: `credential ${cred.name} expired ${cred.expiresAt}`, at: cred.expiresAt, score: 86 });
    } else if (exp - at <= EXPIRY_SOON_MS) {
      expiries.push({ source: 'EXPIRY', detail: `credential ${cred.name} expires ${cred.expiresAt}`, at: cred.expiresAt, score: 36 });
    }
  }
  for (const cert of input.certificates) {
    if (!sameApplication(cert.applicationId, input.applicationId)) continue;
    if (!sameEnvironment(cert.environment, input.environment)) continue;
    const validTo = cert.validTo ? Date.parse(cert.validTo) : NaN;
    const expired = (cert.daysLeft != null && cert.daysLeft < 0) || (!Number.isNaN(validTo) && validTo <= at);
    const soon = cert.daysLeft != null && cert.daysLeft >= 0 && cert.daysLeft < 21;
    if (expired) {
      expiries.push({ source: 'EXPIRY', detail: `certificate ${cert.name} is expired`, at: cert.validTo, score: 70 });
    } else if (soon) {
      expiries.push({ source: 'EXPIRY', detail: `certificate ${cert.name} expires within the warning window (${cert.daysLeft} days left)`, at: cert.validTo, score: 34 });
    }
  }
  const expiry = best(expiries);
  if (expiry) evidence.push(expiry);

  if (input.cloudflare && input.cloudflare.healthy === false) {
    evidence.push({
      source: 'CLOUDFLARE',
      detail: `Cloudflare origin unhealthy: ${input.cloudflare.detail}`,
      at: input.cloudflare.checkedAt,
      score: 82,
    });
  }

  evidence.sort((a, b) => b.score - a.score);
  if (!evidence.length) {
    const fallback = inferRootCauseCategory({
      source: input.source, fingerprint: input.fingerprint, detail: input.detail, title: input.title,
    });
    const named = fallback === 'UNKNOWN' ? '' : ` The incident text points to ${ROOT_CAUSE_LABELS[fallback]}.`;
    return {
      category: fallback,
      summary: `No correlated deployment, capacity alert, expiry date or Cloudflare origin problem.${named}`,
      confidence: 'NONE',
      evidence: [],
      correlatedAt,
    };
  }

  const [top, ...rest] = evidence;
  const also = rest.length ? ` Also correlated: ${rest.map(e => e.detail).join('; ')}.` : '';
  return {
    category: categoryFor(top.source, top.detail),
    summary: `Likely cause: ${top.detail}.${also}`,
    confidence: confidenceOf(top.score),
    evidence,
    correlatedAt,
  };
}
