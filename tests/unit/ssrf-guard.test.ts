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
    // THIS TEST USED TO PROVE NOTHING, twice over.
    //
    // It looked up a real domain and, if that succeeded, asserted that
    // `https://127.0.0.1/` is refused — which takes the literal-IP branch and
    // never reaches the resolver loop at all. And when DNS was slow or blocked
    // the `.catch(() => [])` skipped the assertion entirely and the test passed
    // green having tested nothing. Meanwhile the guard itself returned early
    // under `process.env.VITEST`, so no test anywhere exercised the resolution
    // path.
    //
    // The resolver is now injectable, so this drives the exact case that
    // matters — a perfectly public hostname that answers with a private
    // address — hermetically and every time.
    const rebinding = async () => [{ address: '169.254.169.254' }];
    await expect(assertUrlSafe('https://totally-legitimate.example/', { resolver: rebinding }))
      .rejects.toBeInstanceOf(SSRFBlockedError);

    // Every answer is checked, not just the first: a resolver returning one
    // public and one private address must still be refused.
    const mixed = async () => [{ address: '93.184.216.34' }, { address: '10.0.0.5' }];
    await expect(assertUrlSafe('https://totally-legitimate.example/', { resolver: mixed }))
      .rejects.toBeInstanceOf(SSRFBlockedError);

    // A genuinely public answer passes, or the guard would be refusing
    // everything and this test would pass for the wrong reason.
    const publicOnly = async () => [{ address: '93.184.216.34' }];
    await expect(assertUrlSafe('https://totally-legitimate.example/', { resolver: publicOnly }))
      .resolves.toBeInstanceOf(URL);

    // An empty answer is not a pass.
    await expect(assertUrlSafe('https://totally-legitimate.example/', { resolver: async () => [] }))
      .rejects.toBeInstanceOf(SSRFBlockedError);
  });

  it('re-screens every redirect hop, because the far end chose it', async () => {
    // `assertUrlSafe` screened the URL and then the caller handed it to `fetch`,
    // which follows redirects and screens nothing. A founder could register a
    // harmless host that redirects to a cloud metadata endpoint and pass every
    // check on the way there.
    const { safeFetch } = await import('../../src/services/outbound/ssrf.js');
    const publicOnly = async () => [{ address: '93.184.216.34' }];

    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const target = String(input);
      calls.push(target);
      if (target.startsWith('https://harmless.example/')) {
        return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
      }
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    try {
      await expect(safeFetch('https://harmless.example/x', {}, { resolver: publicOnly }))
        .rejects.toBeInstanceOf(SSRFBlockedError);
      // It stopped AT the redirect: the metadata endpoint was never requested.
      expect(calls).toEqual(['https://harmless.example/x']);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('follows a redirect that stays inside the boundary', async () => {
    // The guard must not simply refuse all redirects — that would be a
    // different product, and a test that only proves refusal would be satisfied
    // by one.
    const { safeFetch } = await import('../../src/services/outbound/ssrf.js');
    const publicOnly = async () => [{ address: '93.184.216.34' }];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target === 'https://harmless.example/x') {
        return new Response(null, { status: 302, headers: { location: 'https://harmless.example/y' } });
      }
      return new Response('arrived', { status: 200 });
    }) as typeof fetch;

    try {
      const res = await safeFetch('https://harmless.example/x', {}, { resolver: publicOnly });
      expect(await res.text()).toBe('arrived');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('refuses an endless redirect chain rather than following it', async () => {
    const { safeFetch } = await import('../../src/services/outbound/ssrf.js');
    const publicOnly = async () => [{ address: '93.184.216.34' }];
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, { status: 302, headers: { location: 'https://harmless.example/loop' } })
    ) as typeof fetch;
    try {
      await expect(safeFetch('https://harmless.example/loop', {}, { resolver: publicOnly }))
        .rejects.toBeInstanceOf(SSRFBlockedError);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('rejects garbage and empty input', async () => {
    await expect(assertUrlSafe('')).rejects.toBeInstanceOf(SSRFBlockedError);
    await expect(assertUrlSafe('not a url')).rejects.toBeInstanceOf(SSRFBlockedError);
  });
});
