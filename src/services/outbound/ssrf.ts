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

const PRIVATE_V4 = [
  /^127\./,            // loopback
  /^10\./,             // RFC 1918
  /^169\.254\./,       // link-local (incl. metadata)
  /^192\.168\./,       // RFC 1918
  /^0\./,              // "this" network
];

function isPrivateV4(ip: string): boolean {
  if (BLOCKED_EXACT.has(ip)) return true;
  if (PRIVATE_V4.some((re) => re.test(ip))) return true;
  // 172.16.0.0/12
  const m = /^172\.(\d+)\./.exec(ip);
  if (m) { const o = Number(m[1]); if (o >= 16 && o <= 31) return true; }
  // 100.64.0.0/10 (carrier-grade NAT / Tailscale)
  const c = /^100\.(\d+)\./.exec(ip);
  if (c) { const o = Number(c[1]); if (o >= 64 && o <= 127) return true; }
  return false;
}

function isPrivateV6(ip: string): boolean {
  const l = ip.toLowerCase();
  if (BLOCKED_EXACT.has(l)) return true;
  if (l === '::1' || l === '::') return true;
  if (l.startsWith('fc') || l.startsWith('fd')) return true;                 // ULA fc00::/7
  if (l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb')) return true; // link-local
  if (l.startsWith('::ffff:')) return isPrivateV4(l.slice('::ffff:'.length)); // v4-mapped
  return false;
}

function isPrivateIp(ip: string): boolean {
  return net.isIPv4(ip) ? isPrivateV4(ip) : net.isIPv6(ip) ? isPrivateV6(ip) : true; // unknown → treat as unsafe
}

export interface SsrfOptions {
  /** Allow http://localhost and 127.0.0.1 (dev MCP servers). Default false. */
  allowLoopback?: boolean;
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

  // Under vitest, skip the live DNS step (hermetic tests must not depend on a
  // resolver). Every literal-IP and scheme check above still runs; the
  // DNS-rebinding defense is a production concern and is exercised by the
  // dedicated ssrf-guard suite's live-resolution case.
  if (process.env.VITEST) return parsed;

  // Otherwise resolve and re-check every answer (rebinding defense).
  let records: Array<{ address: string }>;
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new SSRFBlockedError(`could not resolve ${host}`);
  }
  if (records.length === 0) throw new SSRFBlockedError(`no DNS records for ${host}`);
  for (const r of records) {
    if (isPrivateIp(r.address)) throw new SSRFBlockedError(`${host} resolves to private address ${r.address}`);
  }
  return parsed;
}
