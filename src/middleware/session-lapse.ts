// =============================================================================
// FOUNDRY — A signed-in owner stays signed in while he is reading
//
// WHAT WAS HAPPENING. Clerk's session token (`__session`) lives sixty seconds
// and is renewed only by Clerk's browser SDK — which runs on the sign-in page
// and nowhere else, because the owner's surface deliberately loads no script
// from a CDN (security-headers.ts says why). So a minute after any page
// loaded, the next request failed verification and was sent to `/auth/login`,
// which, finding him still signed in at Clerk, sent him to `/foundry`. Every
// tap after a minute of reading landed on Home; every form that took longer
// than a minute to fill — pasting an Etsy keystring and shared secret from
// another app, say — was thrown away with no word said. The owner reported
// exactly that: he saved the key, the page "just reloads back to the Home
// Screen", and Etsy was not connected.
//
// WHAT THIS DOES INSTEAD. The last verified Clerk token is kept in an
// HttpOnly cookie of Foundry's own. When `__session` has lapsed, that token is
// still checked for Clerk's signature, and Clerk ITSELF is asked, with the
// secret key, whether the session it names is still active and still his. Only
// then is the request admitted. Authority keeps coming from the identity
// provider's live record:
//
//   · sign-out or a revoked session ends it at once — Clerk answers "ended";
//   · the kept copy is HttpOnly, so no script on any page can read it, which
//     `__session` cannot claim;
//   · a copy that lapsed more than twelve hours ago is not honoured at all —
//     he signs in again, the way he always did;
//   · API clients (a Bearer header) get none of this: sixty seconds, as before.
//
// AND WHERE IT STILL ENDS, IT ENDS WHERE HE WAS. A navigation that has to go
// through sign-in returns to the page it was for. A form post that could not
// be honoured returns to the page it came from, marked so the page can say
// plainly that nothing was saved — never silently to Home.
// =============================================================================

export const OWNER_SESSION_COOKIE = 'foundry_session';

/** How long after its expiry a kept token may still be exchanged for Clerk's word. */
export const LAPSE_GRACE_MS = 12 * 60 * 60 * 1000;

/** How long Clerk's "still active" is trusted before it is asked again. */
const LIVE_TRUST_MS = 30_000;

export interface SessionClaims { sub?: string; sid?: string; exp?: number }

export interface SessionDeps {
  /** Clerk's signature check. `lapseGraceMs` tolerates an expiry that recent. */
  verify(token: string, lapseGraceMs?: number): Promise<SessionClaims>;
  /** Clerk's live record of a session, or null when it cannot be read. */
  liveSession(sid: string): Promise<{ status: string; userId: string } | null>;
  now(): number;
}

export function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const p = part.trim();
    if (p.startsWith(`${name}=`)) return p.slice(name.length + 1) || null;
  }
  return null;
}

const trusted = new Map<string, number>();

/** For tests: forget what Clerk has already said. */
export function forgetLiveSessions(): void { trusted.clear(); }

async function stillHis(claims: SessionClaims, deps: SessionDeps): Promise<boolean> {
  if (!claims.sid || !claims.sub) return false;
  const until = trusted.get(claims.sid);
  if (until !== undefined && until > deps.now()) return true;
  const live = await deps.liveSession(claims.sid).catch(() => null);
  // ACTIVE, AND THE SAME PERSON THE TOKEN NAMES. Anything else — ended,
  // revoked, expired, abandoned, or Clerk not answering — is not a session.
  if (!live || live.status !== 'active' || live.userId !== claims.sub) {
    trusted.delete(claims.sid);
    return false;
  }
  trusted.set(claims.sid, deps.now() + LIVE_TRUST_MS);
  return true;
}

/**
 * The session a browser request carries, or null when it carries none that
 * can be honoured. `keep` is a freshly verified token to store as the kept
 * copy, when there is one.
 */
export async function resolveBrowserSession(
  cookieHeader: string | undefined, deps: SessionDeps,
): Promise<{ claims: SessionClaims; keep: string | null } | null> {
  const fresh = cookieValue(cookieHeader, '__session');
  const kept = cookieValue(cookieHeader, OWNER_SESSION_COOKIE);

  if (fresh) {
    try { return { claims: await deps.verify(fresh), keep: fresh }; } catch { /* lapsed or foreign */ }
  }
  if (!kept) return null;
  try { return { claims: await deps.verify(kept), keep: null }; } catch { /* lapsed */ }

  // LAPSED: Clerk's signature still, and Clerk's word that it is still live.
  let claims: SessionClaims;
  try { claims = await deps.verify(kept, LAPSE_GRACE_MS); } catch { return null; }
  return (await stillHis(claims, deps)) ? { claims, keep: null } : null;
}

export function keptSessionCookie(token: string, secure: boolean): string {
  return `${OWNER_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; `
    + `Max-Age=${String(LAPSE_GRACE_MS / 1000)}${secure ? '; Secure' : ''}`;
}

export const CLEAR_KEPT_SESSION = `${OWNER_SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`;

/**
 * A place on this host to return to, or Home. The same rule the sign-in page
 * applies before it follows one: a path, never `//host` (a browser leaves on
 * that), never a backslash, never the sign-in pages themselves (a loop).
 */
export function safeNext(p: string | null | undefined): string {
  if (typeof p !== 'string' || p.length > 2000) return '/foundry';
  if (!/^\/(?![/\\])[^\s\\]*$/.test(p)) return '/foundry';
  if (p === '/auth' || p.startsWith('/auth/')) return '/foundry';
  return p;
}

/** Where to send a browser request that has to sign in again. */
export function loginPathFor(method: string, url: string, referer: string | undefined): string {
  const here = new URL(url);
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD') {
    return `/auth/login?next=${encodeURIComponent(safeNext(here.pathname + here.search))}`;
  }
  // A POST's body cannot be carried through a sign-in, and must not be — it
  // may hold a secret. So he goes back to the page he submitted from, and that
  // page is told nothing was saved.
  let back = '/foundry';
  if (referer) {
    try {
      const r = new URL(referer);
      if (r.host === here.host) back = safeNext(r.pathname + r.search);
    } catch { /* unparseable: Home */ }
  }
  return `/auth/login?next=${encodeURIComponent(back)}&lapsed=1`;
}
