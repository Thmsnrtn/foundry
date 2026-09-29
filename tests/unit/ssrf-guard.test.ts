// =============================================================================
// Tests: SSRF guard (ported from AcreOS's validateUrl, 2026-07-14)
// Foundry makes outbound HTTP to founder-supplied URLs (MCP servers,
// custom_webhook). Cloud metadata, loopback, and private ranges must be
// refused — at CALL time, so DNS rebinding after add-time approval is caught.
// =============================================================================

import { afterEach, describe, it, expect } from 'vitest';
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

  it('refuses the ranges a hand-written list forgets, however the address is spelled', async () => {
    // FOUND BY THE EXECUTIVE REVIEW OF 29 SEPTEMBER 2026. The URL parser writes
    // `[::ffff:169.254.169.254]` as `[::ffff:a9fe:a9fe]`, and the guard then
    // tested `a9fe:a9fe` as if it were dotted IPv4 — so the metadata endpoint,
    // spelled as a mapped IPv6 literal, passed. Every spelling of an embedded
    // IPv4 address is now unpacked and screened as the IPv4 address it is.
    for (const u of [
      'https://[::ffff:169.254.169.254]/',     // v4-mapped, parser-normalised to hex
      'https://[::ffff:127.0.0.1]/',
      'https://[0:0:0:0:0:ffff:a00:5]/',       // v4-mapped, spelled out: 10.0.0.5
      'https://[::127.0.0.1]/',                // v4-compatible (deprecated, still routable on some stacks)
      'https://[64:ff9b::a9fe:a9fe]/',         // NAT64 of the metadata address
      'https://[64:ff9b:1::1]/',               // NAT64 local-use
      'https://[2002:a9fe:a9fe::1]/',          // 6to4 wrapping 169.254.169.254
      'https://[fec0::1]/',                    // site-local
      'https://[ff02::1]/',                    // multicast
      'https://[2001:db8::1]/',                // documentation
      'https://198.18.0.1/', 'https://198.19.255.254/',  // benchmarking 198.18/15
      'https://224.0.0.1/', 'https://239.255.255.250/',  // multicast
      'https://240.0.0.1/', 'https://255.255.255.255/',  // reserved and broadcast
      'https://192.0.0.8/', 'https://192.0.2.1/', 'https://198.51.100.7/', 'https://203.0.113.9/',
      'https://2852039166/',                   // 169.254.169.254 as one decimal number
      'https://0xa9.0xfe.0xa9.0xfe/',          // and in hex
    ]) {
      await expect(assertUrlSafe(u), u).rejects.toBeInstanceOf(SSRFBlockedError);
    }
    // A resolver may answer in any spelling too.
    for (const address of ['::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '64:ff9b::a00:1', '198.18.3.4', '::ffff:0:a00:1']) {
      await expect(assertUrlSafe('https://totally-legitimate.example/', { resolver: async () => [{ address }] }), address)
        .rejects.toBeInstanceOf(SSRFBlockedError);
    }
    // Public addresses in the same families still pass, or the test proves nothing.
    for (const u of ['https://198.20.0.1/', 'https://223.255.255.1/', 'https://[2606:4700:4700::1111]/', 'https://[::ffff:1.1.1.1]/']) {
      await expect(assertUrlSafe(u), u).resolves.toBeInstanceOf(URL);
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

// =============================================================================
// A CREDENTIAL DOES NOT FOLLOW A REDIRECT TO A DIFFERENT ORIGIN.
//
// `safeFetch` screened every hop for SSRF and carried `init` — headers included
// — onto each one unchanged. The screen asks "is this address private". It does
// not ask "should this host be holding the owner's bearer token".
//
// An independent review found what that costs the moment a sense credential
// goes through it: callers pass `Authorization` and provider API keys in
// headers, so any PUBLIC host named in a `Location` — a misconfigured CDN, a
// hijacked name, a compromised provider edge — was handed the credential, and
// on 307/308 the request body with it. The Etsy adapter's own header claimed
// the opposite: that it declined an exemption because `safeFetch` "re-screens
// every redirect hop, and an adapter that carries a bearer token should not
// follow a 302 to wherever a provider points". It did follow it.
//
// This is what every browser does, and for this reason.
// =============================================================================

describe('a redirect to another origin does not carry the credential', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  /** Records the headers each hop was actually given. */
  function hops(chain: Array<{ status: number; location?: string }>): Array<Record<string, string>> {
    const seen: Array<Record<string, string>> = [];
    let i = 0;
    globalThis.fetch = (async (_u: string, init?: RequestInit) => {
      const h: Record<string, string> = {};
      const given = init?.headers;
      if (given && !Array.isArray(given) && !(given instanceof Headers)) {
        for (const [k, v] of Object.entries(given)) h[k.toLowerCase()] = String(v);
      }
      seen.push(h);
      const step = chain[Math.min(i, chain.length - 1)];
      i += 1;
      return {
        status: step.status,
        headers: { get: (n: string) => (n === 'location' ? step.location ?? null : null) },
      } as unknown as Response;
    }) as typeof globalThis.fetch;
    return seen;
  }

  it('drops Authorization and the api key when the origin changes', async () => {
    const { safeFetch } = await import('../../src/services/outbound/ssrf.js');
    const seen = hops([
      { status: 302, location: 'https://attacker.example/collect' },
      { status: 200 },
    ]);
    await safeFetch('https://openapi.etsy.com/v3/application/users/me', {
      headers: { Authorization: 'Bearer secret-token', 'x-api-key': 'app-key', accept: 'application/json' },
    });
    expect(seen).toHaveLength(2);
    expect(seen[0].authorization, 'the host we chose gets the credential').toBe('Bearer secret-token');
    expect(seen[1].authorization, 'the host IT chose does not').toBeUndefined();
    expect(seen[1]['x-api-key']).toBeUndefined();
    // And the request still goes, unauthenticated — which fails visibly at the
    // far end rather than succeeding at the wrong one.
    expect(seen[1].accept).toBe('application/json');
  });

  it('keeps them across a redirect within the same origin', async () => {
    const { safeFetch } = await import('../../src/services/outbound/ssrf.js');
    const seen = hops([
      { status: 302, location: 'https://openapi.etsy.com/v3/application/users/me/' },
      { status: 200 },
    ]);
    await safeFetch('https://openapi.etsy.com/v3/application/users/me', {
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(seen[1].authorization).toBe('Bearer secret-token');
  });

  it('matches the header name however it is cased', async () => {
    const { safeFetch } = await import('../../src/services/outbound/ssrf.js');
    const seen = hops([
      { status: 307, location: 'https://elsewhere.example/x' },
      { status: 200 },
    ]);
    await safeFetch('https://openapi.etsy.com/v3/application/users/me', {
      headers: { AUTHORIZATION: 'Bearer t', 'X-Api-Key': 'k', Cookie: 'c' },
    });
    expect(Object.keys(seen[1])).toHaveLength(0);
  });
});
