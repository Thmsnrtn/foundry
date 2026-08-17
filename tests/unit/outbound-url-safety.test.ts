import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// =============================================================================
// Three senders post to a URL somebody else chose. Two checked it.
//
//   src/lib/webhooks.ts                       assertUrlSafe at call time
//   src/services/scp/actions/executor.ts      assertUrlSafe at call time
//   src/services/distribution/outbound-webhooks.ts   nothing
//
// The third was not exploitable, and only by accident: nothing can currently
// register a target, because `addWebhookConfig` has no caller. `dispatchEvent`
// is live and called from five places, so the day anything wires registration
// up, that sender starts POSTing to founder-supplied URLs with no check at all.
// "Unreachable today" is not a safety property — it is a coincidence with a
// deadline.
//
// The check belongs at CALL time, not only at registration: a hostname that
// resolved publicly when it was saved can resolve to a private address later,
// which is what DNS rebinding is.
// =============================================================================

const ROOT = resolve(__dirname, '../..');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = resolve(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Comments stripped, and only where they open a line. */
function executable(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
    .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
}

/** A fetch whose destination is not a literal compiled into the source.
 *
 * Two forms, and the second was invisible to this gate until it was checked
 * against itself. The bare-variable pattern excludes anything starting with a
 * quote — and a BACKTICK is a quote, so `fetch(`${host}/v1/thing`)` was skipped
 * entirely no matter where `host` came from. Nothing exploited it: all four
 * template-literal senders build on an operator-set constant. But a gate that
 * cannot see a whole syntax is not total, and the next one to appear would have
 * been just as invisible. "Nothing exploits it today" is the property this file
 * already refuses to accept anywhere else.
 */
const DYNAMIC_FETCH = [
  // fetch(config.url, …) / fetch(endpoint, …) / fetch(p.server_url, …)
  //
  // No leading \b: `_` is a word character, so `\burl\b` does not match inside
  // `server_url` — and the MCP client, which posts to a URL a founder
  // configured, was invisible to this gate for exactly that reason.
  /fetch\(\s*(?!['"`])[\w.]*(url|endpoint|target)\b/i,
  // fetch(`${anything}/path`, …) — interpolation in the host position
  /fetch\(\s*`\s*\$\{/,
];

/** Modules that fetch a URL held in a variable — i.e. one somebody else chose,
 * rather than a provider endpoint compiled into the source. */
function dynamicUrlSenders(): string[] {
  return walk(resolve(ROOT, 'src'))
    .filter((f) => {
      const source = executable(f);
      return DYNAMIC_FETCH.some((re) => re.test(source));
    })
    .map((f) => f.slice(ROOT.length + 1))
    .sort();
}

/** Modules whose `fetch(url…)` is a URL FOUNDRY chose — built from a constant
 * provider host — with the reason each is exempt. A module is on this list
 * because its destination is not influenced by a founder, never because
 * checking it was inconvenient. */
const FOUNDRY_CHOSEN: Record<string, string> = {
  'src/services/audit/github.ts': 'builds api.github.com paths from a repo owner/name; the host is a constant',
  'src/services/integrations/intercom.ts': 'builds api.intercom.io paths; the host is a constant',
  // Template-literal senders, visible to this gate only since it learned to see
  // that syntax. Each host is operator-configured or compiled in — none is
  // founder-influenced. Where a founder-supplied value reaches the PATH, it is
  // checked by `pathSegment`/`repoSlug`, which is a different defect with its
  // own tests in provider-path-injection.test.ts: the host boundary was never
  // the thing at risk here.
  'src/services/ai/client.ts': 'OPENROUTER_BASE_URL, an operator env var, with a constant path',
  'src/services/scp/briefing/voice-reply.ts': 'the same operator-set transcription base URL',
  'src/services/integration/github-gateway.ts': 'GITHUB_API constant; the repo slug in the path is checked by repoSlug',
  'src/services/integration/stripe-gateway.ts': 'STRIPE_API constant; the object id in the path is checked by pathSegment',
  'src/services/notifications/push.ts': 'the APNs host is chosen by NODE_ENV; the device token in the path is checked by pathSegment',
  // Newly visible for the same reason the MCP client was: `fullUrl` and
  // `baseUrl` contain the keyword but not as a whole word. Every caller passes
  // a compiled-in https://api.stripe.com/v1/... base; the only dynamic part is
  // a query string built from a fixed parameter map.
  'src/services/integrations/stripe.ts': 'paginates a compiled-in api.stripe.com URL; only the query string varies',
};

describe('posting to a URL somebody else chose', () => {
  it('is done by exactly the modules we think, and every one checks the URL', () => {
    const senders = dynamicUrlSenders();
    // Every dynamic-URL sender is either guarded or explicitly recorded as
    // fetching a host Foundry itself chose.
    const unguarded = senders
      .filter((rel) => !(rel in FOUNDRY_CHOSEN))
      // Either form counts: `safeFetch` IS the guard, and it does strictly
      // more than `assertUrlSafe` — it re-screens every redirect hop too.
      .filter((rel) => !/(assertUrlSafe|safeFetch)\s*\(/.test(executable(resolve(ROOT, rel))));
    expect(unguarded,
      'This module fetches a URL it did not choose and never checks it. Call '
      + 'assertUrlSafe first, or record here why the destination is not '
      + 'founder-influenced:\n' + unguarded.join('\n')).toEqual([]);

    // And the exemption list may not name a module that no longer qualifies.
    const stale = Object.keys(FOUNDRY_CHOSEN).filter((rel) => !senders.includes(rel));
    expect(stale, `Exemptions for modules that no longer fetch a dynamic URL:\n${stale.join('\n')}`)
      .toEqual([]);
  });

  it('guards every sender that takes its destination from a founder', () => {
    // Named, so adding a sender is a visible edit rather than an inherited
    // consequence of copying an existing file.
    const guarded = dynamicUrlSenders().filter((rel) => !(rel in FOUNDRY_CHOSEN)).sort();
    expect(guarded).toEqual([
      'src/lib/webhooks.ts',
      'src/services/audit/intake-web.ts',
      'src/services/chat/coo.ts',
      'src/services/distribution/outbound-webhooks.ts',
      'src/services/integration/mcp-client.ts',
      'src/services/integration/posthog.ts',
      'src/services/integrations/posthog.ts',
      'src/services/outbound/ssrf.ts',
      'src/services/scp/actions/executor.ts',
    ]);
  });

  it('routes what it can through the one guarded path, not around it', () => {
    // §8's totality: untrusted URL → canonical guarded fetch → network.
    //
    // Every sender used to call `assertUrlSafe` and then `fetch` separately,
    // which screens the URL and then follows wherever it points. None of them
    // revalidated a redirect, so a host that passed every check could hand back
    // a 302 to a cloud metadata endpoint. `safeFetch` does both, and the ones
    // that can use it now do.
    //
    // Two remain on the split form for real reasons rather than convenience,
    // and each is recorded here so the exception has to be argued rather than
    // inherited.
    const SPLIT_FORM: Record<string, string> = {
      'src/lib/webhooks.ts':
        'records a per-attempt delivery receipt around the call and needs the raw response object',
      'src/services/distribution/outbound-webhooks.ts':
        'wraps the call in its own retry/timeout policy and crosses the outbound gateway',
      'src/services/scp/actions/executor.ts':
        'records an effect receipt with provider certainty around the call',
    };
    for (const rel of dynamicUrlSenders()) {
      if (rel in FOUNDRY_CHOSEN || rel === 'src/services/outbound/ssrf.ts') continue;
      const source = executable(resolve(ROOT, rel));
      if (/safeFetch\(/.test(source)) continue;
      expect(SPLIT_FORM[rel],
        `${rel} calls assertUrlSafe and fetch separately, so it does not revalidate `
        + 'redirects. Use safeFetch, or record why it cannot.').toBeTruthy();
    }
  });

  it('checks at call time, not only when the URL was saved', () => {
    // Registration-time validation alone is defeated by a hostname that
    // re-resolves. Each of these must assert inside the function that fetches.
    for (const rel of dynamicUrlSenders().filter((r) => !(r in FOUNDRY_CHOSEN))) {
      const source = executable(resolve(ROOT, rel));
      // `safeFetch` guards and fetches in one call, so ordering is structural
      // rather than textual for those; only the split form needs the check.
      if (/safeFetch\s*\(/.test(source)) continue;
      const guardAt = source.indexOf('assertUrlSafe(');
      const fetchAt = source.search(/fetch\(\s*(?!['"`])[\w.]*\b(url|endpoint|webhook_url|target)\b/i);
      expect(guardAt, `${rel} must assert URL safety`).toBeGreaterThan(-1);
      expect(guardAt, `${rel} asserts only after it has already fetched`).toBeLessThan(fetchAt);
    }
  });

  it('refuses at registration too, so a founder is told rather than ignored', () => {
    const source = executable(resolve(ROOT, 'src/services/distribution/outbound-webhooks.ts'));
    // Two call sites: one in the register path, one in the dispatch path.
    expect([...source.matchAll(/assertUrlSafe\s*\(/g)]).toHaveLength(2);
  });

  it('signs what it sends, so the receiver can tell it came from Foundry', () => {
    // Adjacent property, checked while we are here: an unsigned webhook body is
    // indistinguishable from anything else that can reach the endpoint.
    for (const rel of ['src/lib/webhooks.ts', 'src/services/distribution/outbound-webhooks.ts']) {
      expect(executable(resolve(ROOT, rel)), `${rel} must sign its payload`)
        .toMatch(/createHmac\(\s*'sha256'/);
    }
  });
});
