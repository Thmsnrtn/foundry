// =============================================================================
// Tests: the payload chose the endpoint
//
// The SSRF work made the HOST boundary total. This is the other half of a URL.
// Two gateway handlers built their path by interpolating a value straight out
// of `req.params`:
//
//   fetch(`${STRIPE_API}/subscriptions/${params.subscription_id}`, …)
//   fetch(`${GITHUB_API}/repos/${params.repo}/pulls`, …)
//
// `fetch` resolves a URL with WHATWG rules, so `..` segments are collapsed
// before the request goes out. A subscription id of `sub_1/../../v1/accounts`
// is a POST to a different Stripe endpoint carrying the platform's live secret
// key; a repo slug of `o/r/../../orgs/x` is a different GitHub endpoint
// carrying the founder's installation token. The host never changed, which is
// exactly why the outbound URL guard was silent about it.
//
// This is §4 again in a different costume: authentication established which
// credential, and then the request payload chose what authority to exercise
// with it.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { pathSegment, repoSlug, UnsafePathSegmentError } from '../../src/services/outbound/path-segment.js';

describe('a path segment is one segment', () => {
  it('accepts real provider ids', () => {
    expect(pathSegment('sub_1P2q3R4s5T6u', 'subscription_id')).toBe('sub_1P2q3R4s5T6u');
    expect(pathSegment('ch_3ABCdef', 'charge_id')).toBe('ch_3ABCdef');
  });

  for (const attack of [
    'sub_1/../../v1/accounts',      // traversal to another endpoint
    'sub_1/cancel',                 // a different action on the same object
    '../../../v1/charges',
    'sub_1?expand[]=customer',      // query smuggled into the path
    'sub_1#fragment',
    'sub_1%2F..%2Faccounts',        // encoded slash
    'sub_1\\..\\accounts',
    '..',
    '',
    'sub 1',
  ]) {
    it(`refuses ${JSON.stringify(attack)}`, () => {
      expect(() => pathSegment(attack, 'subscription_id')).toThrow(UnsafePathSegmentError);
    });
  }

  it('refuses a non-string without coercing it into one', () => {
    expect(() => pathSegment({ toString: () => 'sub_1' }, 'subscription_id')).toThrow();
    expect(() => pathSegment(null, 'subscription_id')).toThrow();
  });

  it('does not echo the value into the error', () => {
    // Provider ids and device tokens are customer facts; an error string is one
    // of the places this campaign keeps finding data that should not be there.
    try {
      pathSegment('cus_SECRET123/../x', 'subscription_id');
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain('SECRET123');
      expect(String(err)).toContain('subscription_id');
    }
  });
});

describe('a repo slug is exactly two segments', () => {
  it('accepts owner/name, dots included', () => {
    expect(repoSlug('acme/my.app')).toBe('acme/my.app');
    expect(repoSlug('a-b_c/d-e_f')).toBe('a-b_c/d-e_f');
  });

  for (const attack of [
    'acme/repo/../../orgs/other',
    'acme/../../../user/repos',
    'acme/./repo',
    'acme',                          // one segment
    'acme/repo/extra',               // three
    '../..',
    'acme/repo?x=1',
    '/acme/repo',
    'acme//repo',
  ]) {
    it(`refuses ${JSON.stringify(attack)}`, () => {
      expect(() => repoSlug(attack)).toThrow(UnsafePathSegmentError);
    });
  }
});

describe('the handlers use it', () => {
  // Behaviour is asserted above; this asserts the guard is actually in the
  // path that runs, because a validator nothing calls is a comment.
  const cases: Array<[string, RegExp[]]> = [
    ['src/services/integration/stripe-gateway.ts', [/\$\{STRIPE_API\}\/subscriptions\/\$\{pathSegment\(/]],
    ['src/services/integration/github-gateway.ts', [
      /\$\{GITHUB_API\}\/repos\/\$\{repoSlug\(/,
      /issues\/\$\{pathSegment\(/,
    ]],
    ['src/services/notifications/push.ts', [/\/3\/device\/\$\{pathSegment\(/]],
  ];

  for (const [rel, patterns] of cases) {
    it(`${rel} interpolates a checked segment, not a raw param`, () => {
      const source = readFileSync(resolve(__dirname, '../..', rel), 'utf8');
      for (const p of patterns) expect(source).toMatch(p);
      // And no unchecked interpolation is left in a fetch target.
      const rawInterp = source.match(/fetch\(\s*`[^`]*\$\{(?!pathSegment|repoSlug|[A-Z_]+\}|apnsHost|baseUrl)[^}]*\}[^`]*`/g);
      expect(rawInterp ?? [], `unchecked value in a URL:\n${(rawInterp ?? []).join('\n')}`).toEqual([]);
    });
  }
});
