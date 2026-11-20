/**
 * Outbound-request guard for notification destinations (Teams / generic webhooks): blocks
 * server-side request forgery to loopback, private, link-local (cloud metadata), CGNAT, multicast,
 * documentation and reserved addresses — IPv4 and IPv6, including IPv4-mapped / NAT64 / 6to4 /
 * Teredo forms and numeric host spellings (the WHATWG URL parser normalises 0x7f.1, 2130706433…).
 *
 * DNS rebinding: the address that is checked is the address that is connected to. guardedLookup()
 * is passed to http(s).request as `lookup`, so validation and connection use the same resolution.
 *
 * Internal destinations can be allowed explicitly (NOTIFY_ALLOWED_PRIVATE_TARGETS: hostnames, IPs
 * or CIDRs). Link-local / metadata addresses are never allowed.
 */
import dns from 'dns';
import net from 'net';
import type { LookupFunction } from 'net';

export type AddressClass =
  | 'public' | 'loopback' | 'private' | 'link-local' | 'cgnat' | 'unspecified' | 'multicast' | 'documentation' | 'reserved';

export class UnsafeTargetError extends Error {}

// ── IPv4 ─────────────────────────────────────────────────────────────────────
const v4ToInt = (ip: string) => ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
const inV4 = (ip: string, cidr: string) => {
  const [base, bits] = cidr.split('/');
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
};
function classifyV4(ip: string): AddressClass {
  if (inV4(ip, '0.0.0.0/8')) return 'unspecified';
  if (inV4(ip, '127.0.0.0/8')) return 'loopback';
  if (inV4(ip, '10.0.0.0/8') || inV4(ip, '172.16.0.0/12') || inV4(ip, '192.168.0.0/16')) return 'private';
  if (inV4(ip, '169.254.0.0/16')) return 'link-local';
  if (inV4(ip, '100.64.0.0/10')) return 'cgnat';
  if (inV4(ip, '224.0.0.0/4')) return 'multicast';
  if (inV4(ip, '192.0.2.0/24') || inV4(ip, '198.51.100.0/24') || inV4(ip, '203.0.113.0/24')) return 'documentation';
  if (inV4(ip, '240.0.0.0/4') || inV4(ip, '192.0.0.0/24') || inV4(ip, '198.18.0.0/15')) return 'reserved';
  return 'public';
}

// ── IPv6 ─────────────────────────────────────────────────────────────────────
/** Expands an IPv6 address to 8 hextets (embedded dotted IPv4 tails are converted) */
function v6Hextets(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    if (net.isIPv4(dotted[1]) === false) return null;
    const n = v4ToInt(dotted[1]);
    s = s.slice(0, -dotted[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const fill = s.includes('::') ? 8 - h.length - t.length : 0;
  const all = [...h, ...Array(fill).fill('0'), ...t];
  if (all.length !== 8) return null;
  const out = all.map(x => Number.parseInt(x || '0', 16));
  return out.some(x => Number.isNaN(x) || x < 0 || x > 0xffff) ? null : out;
}
const embeddedV4 = (h: number[], from: number) => `${h[from] >> 8}.${h[from] & 255}.${h[from + 1] >> 8}.${h[from + 1] & 255}`;
function classifyV6(ip: string): AddressClass {
  const h = v6Hextets(ip);
  if (!h) return 'reserved';
  const zeroUpTo = (n: number) => h.slice(0, n).every(x => x === 0);
  if (zeroUpTo(8)) return 'unspecified';
  if (zeroUpTo(7) && h[7] === 1) return 'loopback';
  if (zeroUpTo(5) && h[5] === 0xffff) return classifyV4(embeddedV4(h, 6));          // ::ffff:a.b.c.d
  if (zeroUpTo(6)) return classifyV4(embeddedV4(h, 6));                             // ::a.b.c.d (deprecated compat)
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every(x => x === 0)) return classifyV4(embeddedV4(h, 6)); // NAT64
  if (h[0] === 0x2002) return classifyV4(embeddedV4(h, 1));                          // 6to4
  if (h[0] === 0x2001 && h[1] === 0) return 'reserved';                              // Teredo (hides an IPv4 address)
  if ((h[0] & 0xfe00) === 0xfc00) return 'private';                                  // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return 'link-local';                               // fe80::/10
  if ((h[0] & 0xffc0) === 0xfec0) return 'private';                                  // fec0::/10 site-local (deprecated)
  if ((h[0] & 0xff00) === 0xff00) return 'multicast';
  if (h[0] === 0x2001 && h[1] === 0x0db8) return 'documentation';
  if (h[0] === 0x0100 && zeroUpTo(4) === false && h.slice(1, 4).every(x => x === 0)) return 'reserved'; // 100::/64 discard
  return 'public';
}

export function classifyIp(ip: string): AddressClass {
  const bare = ip.replace(/^\[|\]$/g, '');
  if (net.isIPv4(bare)) return classifyV4(bare);
  if (net.isIPv6(bare)) return classifyV6(bare);
  return 'reserved';
}

// ── Policy ───────────────────────────────────────────────────────────────────
export interface TargetPolicy {
  /** Hostnames, IPs or CIDRs that may resolve to private / loopback addresses (never link-local) */
  allowPrivate: string[];
}

const ipInCidr = (ip: string, cidr: string): boolean => {
  const [base, bitsRaw] = cidr.split('/');
  if (net.isIPv4(ip) && net.isIPv4(base)) return inV4(ip, `${base}/${bitsRaw ?? '32'}`);
  if (net.isIPv6(ip) && net.isIPv6(base)) {
    const a = v6Hextets(ip), b = v6Hextets(base);
    if (!a || !b) return false;
    let bits = Number(bitsRaw ?? 128);
    for (let i = 0; i < 8 && bits > 0; i++, bits -= 16) {
      const m = bits >= 16 ? 0xffff : (0xffff << (16 - bits)) & 0xffff;
      if ((a[i] & m) !== (b[i] & m)) return false;
    }
    return true;
  }
  return false;
};

/** Why an address may not be contacted, or null when it may */
export function addressRefusal(ip: string, hostname: string, policy: TargetPolicy): string | null {
  const cls = classifyIp(ip);
  if (cls === 'public') return null;
  if (cls === 'link-local') return `${ip} is a link-local / cloud-metadata address`;
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const allowed = policy.allowPrivate.some(e => {
    const entry = e.trim().toLowerCase();
    return entry && (entry === host || entry === ip || (entry.includes('/') && ipInCidr(ip, entry)));
  });
  if (allowed && (cls === 'private' || cls === 'loopback' || cls === 'cgnat')) return null;
  return `${ip} is a ${cls} address${cls === 'private' || cls === 'loopback' || cls === 'cgnat' ? ' (allow it explicitly with NOTIFY_ALLOWED_PRIVATE_TARGETS)' : ''}`;
}

/** Validates scheme, host spelling and every address the host resolves to (save-time check) */
export async function assertSafeTarget(rawUrl: string, policy: TargetPolicy, opts: { requireHttps?: boolean } = {}): Promise<void> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new UnsafeTargetError('Not a valid URL'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeTargetError('Only http(s) URLs are allowed');
  if (opts.requireHttps && url.protocol !== 'https:') throw new UnsafeTargetError('The URL must use https://');
  if (url.username || url.password) throw new UnsafeTargetError('Credentials in the URL are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new UnsafeTargetError('The URL has no host');
  if (/^(localhost|.*\.localhost|metadata(\.google\.internal)?|.*\.internal|.*\.local)$/i.test(host) && !policy.allowPrivate.some(e => e.trim().toLowerCase() === host.toLowerCase())) {
    throw new UnsafeTargetError(`${host} is an internal host name`);
  }
  const addresses = net.isIP(host) ? [host] : await dns.promises.lookup(host, { all: true, verbatim: true }).then(r => r.map(a => a.address)).catch(() => {
    throw new UnsafeTargetError(`${host} does not resolve`);
  });
  for (const ip of addresses) {
    const why = addressRefusal(ip, host, policy);
    if (why) throw new UnsafeTargetError(`Refused: ${host} → ${why}`);
  }
}

/**
 * dns.lookup replacement for http(s).request: resolves, refuses if ANY returned address is unsafe,
 * and hands the connection exactly the validated address (no second resolution → no rebinding).
 */
export function guardedLookup(policy: TargetPolicy): LookupFunction {
  return ((hostname: string, options: dns.LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) => {
    dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      const list = addresses as dns.LookupAddress[];
      for (const a of list) {
        const why = addressRefusal(a.address, hostname, policy);
        if (why) return callback(Object.assign(new UnsafeTargetError(`Refused: ${hostname} → ${why}`), { code: 'EUNSAFETARGET' }), '', 0);
      }
      if (options.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  }) as LookupFunction;
}

/** NOTIFY_ALLOWED_PRIVATE_TARGETS → policy */
export const policyFromEnv = (raw: string | undefined): TargetPolicy => ({ allowPrivate: (raw ?? '').split(/[,\s]+/).filter(Boolean) });
