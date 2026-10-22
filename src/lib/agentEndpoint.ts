/**
 * The base URL written into a VPS agent as SERVER_URL.
 * An empty PUBLIC_URL falls back to the browser address. Loopback and non-HTTPS
 * addresses are refused: a VPS cannot reach this computer, and the agent token
 * must not travel over cleartext HTTP. The refused reason never includes the
 * input URL, so a mistaken value cannot leak into Setup or the install script.
 */

export type AgentBase =
  | { ok: true; base: string }
  | { ok: false; reason: string };

const FIX = 'Set PUBLIC_URL to the https address the VPS can reach (for example https://ops.example.com) and restart Ops.';

function fail(why: string): AgentBase {
  return { ok: false, reason: `${why} ${FIX}` };
}

/** 127.0.0.0/8, localhost, and the unspecified addresses. Not RFC1918 — a private Ops host can be reachable over a VPN. */
export function isLoopbackHost(hostname: string): boolean {
  let h = hostname.toLowerCase().replace(/\.$/, '');
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.startsWith('::ffff:')) h = h.slice('::ffff:'.length);
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0' || h === '::') return true;
  if (h.includes(':')) return false;
  const parts = h.split('.');
  if (parts.length < 2 || parts.length > 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return false;
  const full = parts.slice();
  while (full.length < 4) full.splice(1, 0, '0');
  return full[0] === '127';
}

/**
 * @param configured PUBLIC_URL after trimming. Empty means "not set".
 * @param requestBase protocol + host of the current request, used only when PUBLIC_URL is empty.
 */
export function resolveAgentBaseUrl(configured: string, requestBase: string): AgentBase {
  const explicit = configured.trim();
  const raw = explicit || requestBase.trim();
  const source = explicit ? 'PUBLIC_URL' : 'The address in the browser';
  let url: URL;
  try { url = new URL(raw); } catch { return fail(`${source} is not a valid URL.`); }
  if (url.username || url.password) return fail('PUBLIC_URL must not contain a username or password.');
  if (url.search) return fail('PUBLIC_URL must not contain a query string.');
  if (url.protocol !== 'https:') return fail(`${source} is not https.`);
  if (isLoopbackHost(url.hostname)) return fail(`${source} points at this computer. A VPS cannot reach it.`);
  const path = url.pathname.replace(/\/+$/, '');
  const base = `${url.origin}${path && path !== '/' ? path : ''}`;
  if (!/^https:\/\/[^\s'"`$\\]+$/.test(base)) return fail(`${source} contains characters the agent installer cannot use.`);
  return { ok: true, base };
}

/** Shell script returned instead of an installer. Contains the reason only — never a token or a URL. */
export function refusedInstallScript(reason: string): string {
  const safe = reason.replace(/[\r\n]/g, ' ').replace(/'/g, `'\\''`);
  return `echo '${safe}' >&2\nexit 1\n`;
}

export interface AgentInstallPayload {
  installCommand: string;
  uninstallCommand: string;
  ingestUrl: string;
  agentVersion: string;
  publicUrlConfigured: boolean;
  problem?: string;
}

export function agentInstallInfo(
  base: AgentBase,
  server: { id: string; agentToken: string },
  opts: { agentVersion: string; publicUrlConfigured: boolean },
): AgentInstallPayload {
  if (!base.ok) {
    return {
      installCommand: '',
      uninstallCommand: '',
      ingestUrl: '',
      agentVersion: opts.agentVersion,
      publicUrlConfigured: opts.publicUrlConfigured,
      problem: base.reason,
    };
  }
  const url = `${base.base}/api/v1/agent/install/${server.id}?key=${server.agentToken}`;
  return {
    installCommand: `curl -fsSL '${url}' | sudo bash`,
    uninstallCommand: `curl -fsSL '${base.base}/api/v1/agent/uninstall' | sudo bash`,
    ingestUrl: `${base.base}/api/v1/agent/ingest`,
    agentVersion: opts.agentVersion,
    publicUrlConfigured: opts.publicUrlConfigured,
  };
}
