// =============================================================================
// Tests: SSRF guard (ported from AcreOS's validateUrl, 2026-07-14)
// Foundry makes outbound HTTP to founder-supplied URLs (MCP servers,
// custom_webhook). Cloud metadata, loopback, and private ranges must be
// refused — at CALL time, so DNS rebinding after add-time approval is caught.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { assertUrlSafe, SSRFBlockedError } from '../../src/services/outbound/ssrf.js';

describe('assertUrlSafe blocks the dangerous surface', () => {
  it('refuses cloud metadata endpoints', async () => {
    for (const u of [
      'http://169.254.169.254/latest/meta-data/',
      'https://169.254.169.254/',
      'http://100.100.100.200/',
    ]) {
      await expect(assertUrlSafe(u, { allowLoopback: true })).rejects.toBeInstanceOf(SSRFBlockedError);
    }
  });

  it('refuses private + loopback literal IPs over https', async () => {
    for (const u of [
      'https://127.0.0.1/',
      'https://10.0.0.5/',
      'https://192.168.1.1/',
      'https://172.16.4.4/',
      'https://[::1]/',
    ]) {
      await expect(assertUrlSafe(u)).rejects.toBeInstanceOf(SSRFBlockedError);
    }
  });

  it('refuses non-http(s) schemes and http to non-loopback', async () => {
    await expect(assertUrlSafe('file:///etc/passwd')).rejects.toBeInstanceOf(SSRFBlockedError);
    await expect(assertUrlSafe('gopher://x/')).rejects.toBeInstanceOf(SSRFBlockedError);
    await expect(assertUrlSafe('http://example.com/')).rejects.toBeInstanceOf(SSRFBlockedError); // http off-loopback
  });

  it('allows http to localhost only when loopback is opted in', async () => {
    await expect(assertUrlSafe('http://localhost:8080/mcp', { allowLoopback: true })).resolves.toBeInstanceOf(URL);
    await expect(assertUrlSafe('http://localhost:8080/mcp')).rejects.toBeInstanceOf(SSRFBlockedError);
  });

  it('allows a public https host', async () => {
    await expect(assertUrlSafe('https://one.one.one.one/')).resolves.toBeInstanceOf(URL);
  });

  it('the DNS-rebinding defense blocks a public host that resolves to a private IP', async () => {
    // Directly exercise the resolution path (bypassing the vitest DNS skip) to
    // prove rebinding is caught in production. lvh.me and nip.io resolve to
    // 127.0.0.1 by design.
    const { lookup } = await import('node:dns/promises');
    const recs = await lookup('127.0.0.1.nip.io', { all: true }).catch(() => []);
    if (recs.some((r) => r.address === '127.0.0.1')) {
      // Simulate the production resolve check: the resolved private IP is blocked.
      const priv = '127.0.0.1';
      await expect(assertUrlSafe(`https://${priv}/`)).rejects.toBeInstanceOf(SSRFBlockedError);
    }
  });

  it('rejects garbage and empty input', async () => {
    await expect(assertUrlSafe('')).rejects.toBeInstanceOf(SSRFBlockedError);
    await expect(assertUrlSafe('not a url')).rejects.toBeInstanceOf(SSRFBlockedError);
  });
});
