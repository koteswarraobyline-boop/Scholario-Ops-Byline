import net from 'net';
import tls from 'tls';
import dns from 'dns';
import { HttpProbeResult, TcpProbeResult } from '../src/types/index.ts';

const USER_AGENT = 'Scholario-Ops-Monitor/3.0';

export function normalizeUrl(target: string): string {
  const t = target.trim();
  return /^https?:\/\//i.test(t) ? t : `http://${t}`;
}

/** Splits "host:port" (IPv4, hostname or [IPv6]:port) */
export function parseHostPort(target: string, defaultPort?: number): { host: string; port: number } | null {
  const t = target.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  const v6 = t.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) {
    const port = v6[2] ? Number(v6[2]) : defaultPort;
    return port ? { host: v6[1], port } : null;
  }
  const idx = t.lastIndexOf(':');
  if (idx > 0 && t.indexOf(':') === idx) {
    const port = Number(t.slice(idx + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host: t.slice(0, idx), port };
  }
  return defaultPort ? { host: t, port: defaultPort } : null;
}

export interface HttpCheckOptions {
  timeoutMs: number;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

export async function httpProbe(target: string, opts: HttpCheckOptions): Promise<HttpProbeResult & { body: string }> {
  const url = normalizeUrl(target);
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  let resolvedIp: string | undefined;
  try {
    const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '');
    resolvedIp = net.isIP(hostname) ? hostname : (await dns.promises.lookup(hostname)).address;
  } catch {
    // resolution failure is reported by fetch below
  }
  try {
    const resp = await fetch(url, {
      method: opts.method || 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...(opts.headers || {}) },
      body: opts.body && opts.method && !['GET', 'HEAD'].includes(opts.method.toUpperCase()) ? opts.body : undefined,
    });
    // Read at most ~64KB of the body so huge responses cannot exhaust memory
    let body = '';
    if (resp.body) {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let received = 0;
      while (received < 65536) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        body += decoder.decode(value, { stream: true });
      }
      reader.cancel().catch(() => {});
    }
    const latencyMs = Date.now() - start;
    const headers: Record<string, string> = {};
    resp.headers.forEach((v, k) => { headers[k] = v; });
    return {
      target: url,
      reachable: true,
      statusCode: resp.status,
      latencyMs,
      resolvedIp,
      tlsInfo: url.startsWith('https://') ? 'TLS handshake verified' : undefined,
      headers,
      responseSnippet: body.slice(0, 500) || `HTTP ${resp.status} ${resp.statusText}`,
      testedAt: new Date().toISOString(),
      body,
    };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    const reason = e.name === 'AbortError'
      ? `Timed out after ${opts.timeoutMs}ms`
      : e.cause?.code ? `${e.cause.code}: ${e.cause.message ?? e.message}` : e.message;
    return {
      target: url,
      reachable: false,
      statusCode: null,
      latencyMs: Date.now() - start,
      resolvedIp,
      responseSnippet: `Error: ${reason}`,
      error: reason,
      testedAt: new Date().toISOString(),
      body: '',
    };
  } finally {
    clearTimeout(timer);
  }
}

export function tcpProbe(host: string, port: number, timeoutMs: number): Promise<TcpProbeResult> {
  return new Promise(resolve => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (open: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ host, port, open, latencyMs: Date.now() - start, error, testedAt: new Date().toISOString() });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false, `Timed out after ${timeoutMs}ms`));
    socket.once('error', err => finish(false, err.message));
    socket.connect(port, host);
  });
}

export async function dnsProbe(hostname: string, timeoutMs: number): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
  const start = Date.now();
  const resolver = new dns.promises.Resolver({ timeout: timeoutMs, tries: 1 });
  try {
    const name = hostname.trim().replace(/^[a-z]+:\/\//i, '').replace(/[/:].*$/, '');
    const [v4, v6] = await Promise.allSettled([resolver.resolve4(name), resolver.resolve6(name)]);
    const addrs = [
      ...(v4.status === 'fulfilled' ? v4.value : []),
      ...(v6.status === 'fulfilled' ? v6.value : []),
    ];
    if (addrs.length === 0) {
      const reason = v4.status === 'rejected' ? (v4.reason as Error).message : 'no A/AAAA records';
      return { ok: false, latencyMs: Date.now() - start, detail: `DNS resolution failed: ${reason}` };
    }
    return { ok: true, latencyMs: Date.now() - start, detail: `Resolved ${name} → ${addrs.join(', ')}` };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, detail: `DNS resolution failed: ${(err as Error).message}` };
  }
}

export interface SslInfo { ok: boolean; latencyMs: number; daysLeft: number | null; validTo: string | null; issuer: string | null; protocol: string | null; detail: string }

export function sslProbe(target: string, timeoutMs: number): Promise<SslInfo> {
  const hp = parseHostPort(target, 443);
  return new Promise(resolve => {
    const start = Date.now();
    if (!hp) {
      resolve({ ok: false, latencyMs: 0, daysLeft: null, validTo: null, issuer: null, protocol: null, detail: 'Invalid target' });
      return;
    }
    let settled = false;
    const finish = (r: SslInfo) => { if (!settled) { settled = true; socket.destroy(); resolve(r); } };
    const socket = tls.connect({ host: hp.host, port: hp.port, servername: net.isIP(hp.host) ? undefined : hp.host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      const latencyMs = Date.now() - start;
      if (!cert || !cert.valid_to) {
        finish({ ok: false, latencyMs, daysLeft: null, validTo: null, issuer: null, protocol: socket.getProtocol(), detail: 'No certificate presented' });
        return;
      }
      const validTo = new Date(cert.valid_to);
      const daysLeft = Math.floor((validTo.getTime() - Date.now()) / 86_400_000);
      const issuer = (cert.issuer?.O || cert.issuer?.CN || null) as string | null;
      const authorized = socket.authorized;
      const authError = socket.authorizationError ? String(socket.authorizationError) : null;
      finish({
        ok: authorized && daysLeft >= 0,
        latencyMs,
        daysLeft,
        validTo: validTo.toISOString(),
        issuer,
        protocol: socket.getProtocol(),
        detail: authorized
          ? `Certificate valid for ${daysLeft} days (issuer: ${issuer ?? 'unknown'}, ${socket.getProtocol()})`
          : `Certificate NOT trusted: ${authError}`,
      });
    });
    socket.once('timeout', () => finish({ ok: false, latencyMs: Date.now() - start, daysLeft: null, validTo: null, issuer: null, protocol: null, detail: `Timed out after ${timeoutMs}ms` }));
    socket.once('error', err => finish({ ok: false, latencyMs: Date.now() - start, daysLeft: null, validTo: null, issuer: null, protocol: null, detail: err.message }));
  });
}
