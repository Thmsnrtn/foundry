// =============================================================================
// FOUNDRY — Provider URL path segments
//
// The SSRF boundary answers "which HOST may we reach". This answers the other
// half: which ENDPOINT on a host we already trust.
//
// Two gateway handlers built their URL by interpolating a value out of
// `req.params` — the request payload an agent fills in — straight into the
// path:
//
//   fetch(`${STRIPE_API}/subscriptions/${params.subscription_id}`, …)
//   fetch(`${GITHUB_API}/repos/${params.repo}/pulls`, …)
//
// The host is a constant, so this is not SSRF and the outbound guard was right
// to be quiet. It is the §4 defect instead: the payload chose the authority
// being exercised. `fetch` resolves the URL with WHATWG rules, so a
// subscription id of `sub_1/../../v1/accounts` is a POST to a completely
// different Stripe endpoint — carrying the platform's live secret key. The
// GitHub one carries the founder's installation token.
//
// A path segment is one segment. Anything that could end it — a slash, a dot
// pair, a query, a fragment, an encoded form of any of those — is not a
// segment, and the honest response is to refuse rather than to sanitise, since
// a caller passing `../` is not making a typo this module should guess at.
// =============================================================================

/** Provider object ids: Stripe (`sub_…`, `ch_…`), APNs device tokens, GitHub
 * names. Deliberately narrow — no dots, so `..` cannot be assembled. */
const SEGMENT = /^[A-Za-z0-9_-]{1,255}$/;

/** GitHub repo names allow a dot (`my.app`), so the slug form permits it while
 * still refusing a bare or trailing `..`. */
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

export class UnsafePathSegmentError extends Error {
  constructor(kind: string) {
    // The value is not echoed. It may be a customer identifier, and an error
    // string is one of the places this campaign keeps finding data it should
    // not be carrying.
    super(`${kind} is not a valid URL path segment`);
    this.name = 'UnsafePathSegmentError';
  }
}

/** One path segment, or a refusal. Returns the value so it reads as the thing
 * being interpolated: `${pathSegment(id, 'subscription_id')}`. */
export function pathSegment(value: unknown, kind: string): string {
  const s = typeof value === 'string' ? value : '';
  if (!SEGMENT.test(s)) throw new UnsafePathSegmentError(kind);
  return s;
}

/** An `owner/name` GitHub slug, encoded as two segments rather than trusted as
 * one. `..` in either half is refused, not escaped. */
export function repoSlug(value: unknown, kind = 'repo'): string {
  const s = typeof value === 'string' ? value : '';
  const parts = s.split('/');
  if (parts.length !== 2) throw new UnsafePathSegmentError(kind);
  for (const part of parts) {
    if (!NAME.test(part) || part === '.' || part === '..') throw new UnsafePathSegmentError(kind);
  }
  return `${parts[0]}/${parts[1]}`;
}
