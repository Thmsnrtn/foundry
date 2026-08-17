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

/** Modules that fetch a URL held in a variable — i.e. one somebody else chose,
 * rather than a provider endpoint compiled into the source. */
function dynamicUrlSenders(): string[] {
  return walk(resolve(ROOT, 'src'))
    .filter((f) => {
      const source = executable(f);
      // `fetch(config.url, …)`, `fetch(url, …)`, `fetch(webhook.url, …)` —
      // never `fetch('https://api.stripe.com/…')`.
      return /fetch\(\s*(?!['"`])[\w.]*\b(url|endpoint|webhook_url|target)\b/i.test(source);
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
};

describe('posting to a URL somebody else chose', () => {
  it('is done by exactly the modules we think, and every one checks the URL', () => {
    const senders = dynamicUrlSenders();
    // Every dynamic-URL sender is either guarded or explicitly recorded as
    // fetching a host Foundry itself chose.
    const unguarded = senders
      .filter((rel) => !(rel in FOUNDRY_CHOSEN))
      .filter((rel) => !/assertUrlSafe\s*\(/.test(executable(resolve(ROOT, rel))));
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
      'src/services/integration/posthog.ts',
      'src/services/integrations/posthog.ts',
      'src/services/scp/actions/executor.ts',
    ]);
  });

  it('checks at call time, not only when the URL was saved', () => {
    // Registration-time validation alone is defeated by a hostname that
    // re-resolves. Each of these must assert inside the function that fetches.
    for (const rel of dynamicUrlSenders().filter((r) => !(r in FOUNDRY_CHOSEN))) {
      const source = executable(resolve(ROOT, rel));
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
