// =============================================================================
// FOUNDRY — SSRF guard (adapted from AcreOS server/middleware/fileUploadSecurity.ts)
//
// Foundry makes outbound HTTP to FOUNDER-SUPPLIED URLs: connected MCP servers
// (/connections) and custom_webhook standing orders. Without this, a founder
// (or an attacker who compromised one) could point Foundry at cloud metadata
// (169.254.169.254), loopback, or internal services — server-side request
// forgery. Every such call must pass assertUrlSafe FIRST.
//
// Two-layer defense, mirroring the AcreOS original:
//   1. hostname/literal-IP screen against private + metadata ranges
//   2. DNS resolution of the hostname, re-checking the resolved IP — defeats
//      DNS rebinding (a public name that resolves to a private address).
// Loopback http is allowed ONLY for localhost dev; everything else must https.
// =============================================================================

import { lookup } from 'node:dns/promises';
import net from 'node:net';

export class SSRFBlockedError extends Error {
  readonly code = 'SSRF_BLOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'SSRFBlockedError';
  }
}

const BLOCKED_EXACT = new Set([
  '169.254.169.254',   // AWS / GCP / DO / OpenStack IMDS
  'fd00:ec2::254',     // AWS IMDSv6
  '100.100.100.200',   // Alibaba Cloud metadata
]);

// Screened by NUMERIC RANGE, not by the spelling of the address. A pattern
// list over strings missed `::ffff:a9fe:a9fe` — the URL parser's own spelling
// of `::ffff:169.254.169.254` — so the metadata endpoint, written as a mapped
// IPv6 literal, passed (found 29 September 2026). Every address is parsed to
// numbers first; every IPv6 form that embeds an IPv4 address is unpacked and
// screened as that IPv4 address.

/** IPv4 ranges that are never a public webhook: [network, prefix length]. */
const PRIVATE_V4_CIDRS: Array<[string, number]> = [
  ['0.0.0.0', 8],        // "this" network
  ['10.0.0.0', 8],       // RFC 1918
  ['100.64.0.0', 10],    // carrier-grade NAT / Tailscale
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local, including cloud metadata
  ['172.16.0.0', 12],    // RFC 1918
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // documentation
  ['192.168.0.0', 16],   // RFC 1918
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // documentation
  ['203.0.113.0', 24],   // documentation
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved, including broadcast
];

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
}

const V4_RANGES = PRIVATE_V4_CIDRS.map(([net4, len]) => {
  const base = v4ToInt(net4)!;
  const size = 2 ** (32 - len);
  return [base, base + size - 1] as const;
});

function isPrivateV4(ip: string): boolean {
  if (BLOCKED_EXACT.has(ip)) return true;
  const n = v4ToInt(ip);
  if (n === null) return true; // not a dotted IPv4 address: unsafe, never guessed
  return V4_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

/** The eight 16-bit groups of an IPv6 address, or null if it is not one. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, ''); // drop a zone id
  // A trailing dotted IPv4 part becomes two groups.
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (dotted) {
    const n = v4ToInt(dotted[2]);
    if (n === null) return null;
    s = `${dotted[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const read = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = read(halves[0]); const tail = halves.length === 2 ? read(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...Array(fill).fill(0), ...tail];
}

const v4Of = (hi: number, lo: number): string => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');

function isPrivateV6(ip: string): boolean {
  const l = ip.toLowerCase();
  if (BLOCKED_EXACT.has(l)) return true;
  const g = v6Groups(l);
  if (!g) return true; // unparseable: unsafe
  const zeroTo = (k: number): boolean => g.slice(0, k).every((x) => x === 0);
  if (zeroTo(8)) return true;                                   // ::
  if (zeroTo(7) && g[7] === 1) return true;                     // ::1
  if (zeroTo(5) && g[5] === 0xffff) return isPrivateV4(v4Of(g[6], g[7]));   // ::ffff:a.b.c.d (mapped)
  if (zeroTo(4) && g[4] === 0xffff && g[5] === 0) return isPrivateV4(v4Of(g[6], g[7])); // ::ffff:0:a.b.c.d (translated)
  if (zeroTo(6)) return isPrivateV4(v4Of(g[6], g[7]));         // ::a.b.c.d (compatible)
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    // 64:ff9b::/96 translates an IPv4 address; anything else under 64:ff9b (the local-use /48) is refused.
    return g.slice(2, 6).every((x) => x === 0) ? isPrivateV4(v4Of(g[6], g[7])) : true;
  }
  if (g[0] === 0x2002) return isPrivateV4(v4Of(g[1], g[2]));    // 6to4 wraps an IPv4 address
  if (g[0] === 0x2001 && g[1] === 0) return true;               // Teredo hides its IPv4 address
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true;           // documentation
  if ((g[0] & 0xfe00) === 0xfc00) return true;                  // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true;                  // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return true;                  // site-local fec0::/10
  if ((g[0] & 0xff00) === 0xff00) return true;                  // multicast ff00::/8
  return false;
}

function isPrivateIp(ip: string): boolean {
  return net.isIPv4(ip) ? isPrivateV4(ip) : net.isIPv6(ip) ? isPrivateV6(ip) : true; // unknown → treat as unsafe
}

export interface SsrfOptions {
  /** Allow http://localhost and 127.0.0.1 (dev MCP servers). Default false. */
  allowLoopback?: boolean;
  /**
   * How to resolve a hostname. Production uses the system resolver; a test
   * supplies a stub.
   *
   * This exists because the rebinding defence was UNTESTABLE and therefore
   * untested. The resolution step was skipped outright when `process.env.VITEST`
   * was set — for a good reason, since hermetic tests must not depend on a live
   * resolver — and the one test that claimed to cover it looked up a real
   * domain and then asserted something about a literal IP, which takes the
   * `net.isIP` branch and never reaches the resolver loop. The comment saying
   * the defence "is exercised by the dedicated ssrf-guard suite" was false.
   *
   * Injecting the resolver keeps tests hermetic AND lets them drive the exact
   * case that matters: a perfectly public hostname that answers with a private
   * address.
   */
  resolver?: (host: string) => Promise<Array<{ address: string }>>;
}

/** Throw SSRFBlockedError unless the URL is a public http(s) endpoint. The
 *  hostname AND its resolved IP are both screened (rebinding defense). */
export async function assertUrlSafe(url: string, opts: SsrfOptions = {}): Promise<URL> {
  if (typeof url !== 'string' || url.trim().length === 0) throw new SSRFBlockedError('URL is required');

  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new SSRFBlockedError('Invalid URL'); }

  const loopbackHost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol === 'http:') {
    if (!(opts.allowLoopback && loopbackHost)) {
      throw new SSRFBlockedError('http is only permitted for localhost; use https');
    }
    return parsed; // trusted local dev target
  }
  if (parsed.protocol !== 'https:') throw new SSRFBlockedError(`scheme ${parsed.protocol} not allowed`);

  const host = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  // If the host is a literal IP, screen it directly.
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new SSRFBlockedError(`blocked private/metadata address ${host}`);
    return parsed;
  }

  // A test that supplies a resolver gets the real code path. A test that does
  // not stays hermetic — it must not depend on a live resolver — and production
  // always resolves.
  const resolve = opts.resolver
    ?? (process.env.VITEST ? null : (h: string) => lookup(h, { all: true }));
  if (!resolve) return parsed;

  // Resolve and re-check every answer (rebinding defense).
  let records: Array<{ address: string }>;
  try {
    records = await resolve(host);
  } catch {
    throw new SSRFBlockedError(`could not resolve ${host}`);
  }
  if (records.length === 0) throw new SSRFBlockedError(`no DNS records for ${host}`);
  for (const r of records) {
    if (isPrivateIp(r.address)) throw new SSRFBlockedError(`${host} resolves to private address ${r.address}`);
  }
  return parsed;
}

/**
 * Fetch a URL nobody at Foundry chose, revalidating every hop.
 *
 * THE GAP THIS CLOSES. `assertUrlSafe` screens the URL it is given, and then
 * the caller hands that URL to `fetch`, which follows redirects by default and
 * screens nothing. So a founder could register `https://harmless.example/x`,
 * pass every check, and be redirected to `http://169.254.169.254/` — the exact
 * destination the guard exists to refuse. Checking the first URL and then
 * following wherever it points is not a boundary; it is a formality.
 *
 * Redirects are taken manually and each Location is screened as a fresh
 * untrusted URL, because it is one: it was chosen by the server at the other
 * end, not by the founder and certainly not by us.
 *
 * Deliberately small. This is not a network security platform — it is the
 * existing boundary made total, which is the whole of what is needed.
 */
/**
 * The headers a different origin must never be given. Matched case-insensitively,
 * because a header name is case-insensitive and an attacker picks the casing.
 */
const CREDENTIAL_HEADERS = new Set([
  'authorization', 'cookie', 'proxy-authorization',
  'x-api-key', 'api-key', 'x-auth-token', 'x-access-token', 'stripe-account',
]);

function withoutCredentials(headers: RequestInit['headers']): RequestInit['headers'] {
  if (!headers) return headers;
  const kept: Record<string, string> = {};
  const put = (k: string, v: string): void => {
    if (!CREDENTIAL_HEADERS.has(k.toLowerCase())) kept[k] = v;
  };
  if (headers instanceof Headers) headers.forEach((v, k) => { put(k, v); });
  else if (Array.isArray(headers)) for (const [k, v] of headers) put(k, v);
  else for (const [k, v] of Object.entries(headers)) put(k, String(v));
  return kept;
}

export async function safeFetch(
  url: string,
  init: RequestInit = {},
  opts: SsrfOptions & { maxRedirects?: number } = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 3;
  let target = (await assertUrlSafe(url, opts)).toString();
  let origin = new URL(target).origin;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await fetch(target, { ...init, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get('location');
    if (!location) return response; // a redirect with nowhere to go is the answer
    // Relative locations resolve against the hop we are on.
    const next = new URL(location, target).toString();
    // Screened as a fresh untrusted URL, because the server at the other end
    // chose it. A redirect chain is exactly how a public host reaches a private
    // address without ever appearing to.
    target = (await assertUrlSafe(next, opts)).toString();

    // A CREDENTIAL DOES NOT FOLLOW A REDIRECT TO A DIFFERENT ORIGIN.
    //
    // The SSRF screen above asks "is this address private". It does not ask
    // "should this host be holding the owner's bearer token", and an
    // independent review found what that costs: callers pass `Authorization`
    // and provider API keys in `init.headers`, and `init` was carried onto
    // every hop unchanged. Any PUBLIC host named in a `Location` — a
    // misconfigured CDN, a hijacked name, a compromised provider edge — was
    // handed the credential, and on 307/308 the body with it.
    //
    // This is what every browser does and the reason it does it. Same origin,
    // the headers ride along; a different origin, they are dropped and the
    // request continues unauthenticated, which fails visibly at the far end
    // rather than succeeding at the wrong one.
    const nextOrigin = new URL(target).origin;
    if (nextOrigin !== origin) {
      init = { ...init, headers: withoutCredentials(init.headers) };
      origin = nextOrigin;
    }

    // 303 and a 302 on POST become GET, per the specification and per what
    // every real client does; carrying the body onward would be a different
    // request than the one the caller authorised.
    if (response.status === 303 || (response.status === 302 && init.method && init.method !== 'GET')) {
      init = { ...init, method: 'GET', body: undefined };
    }
  }
  throw new SSRFBlockedError(`too many redirects from ${url}`);
}

/**
 * A response body read up to `maxBytes` and no further. The far end of a
 * webhook is a server nobody at Foundry chose; it does not get to decide how
 * much memory Foundry spends reading its answer.
 */
export async function readTextCapped(response: Response, maxBytes = 1_000_000): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0; let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total)); total = maxBytes; truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value); total += value.byteLength;
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c)))), truncated };
}
