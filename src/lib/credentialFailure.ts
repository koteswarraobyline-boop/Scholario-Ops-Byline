/**
 * Detects a credential failure in an API response. The secret is never copied into the detail:
 * long tokens are redacted before the snippet is kept.
 */

const STRONG = /invalid[_\s-]?api[_\s-]?key|incorrect api key|api key (?:has )?expired|expired api key|token has expired|expired token|invalid credentials|authentication failed|auth(?:entication)? failed/i;
const ERROR_PAYLOAD = /"error"|"code"|error code/i;

function redact(text: string): string {
  return text
    .replace(/\b(?:sk|pk|rk|key|token|bearer)[-_][A-Za-z0-9_\-]{8,}\b/gi, '[redacted]')
    .replace(/\b[A-Za-z0-9_\-]{32,}\b/g, '[redacted]');
}

/** A rejected key, token, or subscription. Null when the response is not a credential failure. */
export function credentialFailureFromResponse(statusCode: number | null | undefined, body: string): { detail: string } | null {
  const text = redact((body ?? '').slice(0, 800));
  const strong = STRONG.test(text);
  const code = statusCode ?? null;
  const errorPayload = ERROR_PAYLOAD.test(text);
  const unauthorized = code === 401;
  const forbiddenCredential = code === 403 && /token|api[_\s-]?key|credential|unauthori[sz]ed|expired/i.test(text);
  const strongEnough = strong && (code === null || code >= 400 || errorPayload);
  if (!strongEnough && !unauthorized && !forbiddenCredential) return null;
  const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 180);
  const why = strongEnough
    ? 'response names an invalid or expired key, token, or credential'
    : unauthorized
      ? 'HTTP 401 from the API'
      : 'HTTP 403 names a credential failure';
  return {
    detail: `Credential rejected: ${why}${code ? ` (HTTP ${code})` : ''}${snippet ? ` — ${snippet}` : ''}`,
  };
}
