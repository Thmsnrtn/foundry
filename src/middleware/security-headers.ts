// =============================================================================
// FOUNDRY — Security Headers Middleware
// Sets standard HTTP security headers on all responses.
// =============================================================================

import { createMiddleware } from 'hono/factory';
import { OWNER_SURFACE_SCRIPT_HASH, isOwnerSurface } from '../lib/owner-surface-script.js';

export const securityHeaders = createMiddleware(async (c, next) => {
  await next();

  // Prevent clickjacking
  c.header('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  c.header('X-Content-Type-Options', 'nosniff');

  // Enable XSS filter (legacy browsers)
  c.header('X-XSS-Protection', '1; mode=block');

  // Control referrer information
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  // THE POLICY MUST NAME WHAT THE PAGES ACTUALLY LOAD.
  //
  // This `script-src` allowed `'self'` and Clerk's own domain — and every page
  // that loads Clerk gets it from somewhere else: `auth/clerk.ts` imports
  // `https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/+esm` on the sign-up,
  // sign-in and sign-out pages, and the landing page loads
  // `https://unpkg.com/@clerk/clerk-js/dist/clerk.browser.js`. An enforcing
  // browser blocks all four, which means authentication does not load: the
  // sign-in page falls into its own catch handler and says "failed to load
  // authentication".
  //
  // A SECOND COPY OF THIS POLICY LIVED IN `middleware/security.ts`, imported by
  // nobody, allowing unpkg but not jsdelivr and carrying two directives this
  // one lacked. Two policies, one enforced, disagreeing about both the origins
  // and the hardening — and the dead one was the one that looked more correct.
  // It is deleted; its `object-src` and `base-uri` are here.
  //
  // `'unsafe-inline'` now covers exactly the sign-in pages, and it took doing
  // the work rather than editing the directive. There were fourteen inline
  // script blocks and thirty-seven inline handlers when this comment was first
  // written; the cutover to the six doors removed most of them as a side
  // effect, and the remainder — a retired chat surface, a hand-rolled modal,
  // and fifteen on-attribute handlers across Controls, privacy, connections
  // and the Letter — were migrated into the one hashed script deliberately.
  //
  // What is left is three blocks on the Clerk pages, which load a vendor SDK
  // from a CDN and render nothing written by a stranger. They are the only
  // paths this branch still describes.
  //
  // THE OWNER'S SURFACE GETS A STRICTER ONE, AND IT IS NOT A COSMETIC CHANGE.
  //
  // That surface renders text written by strangers — a comment quoted verbatim
  // beneath an opportunity is the evidence discipline working as intended. One
  // such quote reached his first screen as live markup, and 'unsafe-inline'
  // meant the policy would have permitted exactly the inline handler an
  // injected tag uses. Escaping fixed that instance; this closes the class.
  //
  // It is affordable here and nowhere else: the whole owner product runs one
  // small static script, hashed from the same constant that renders it, and no
  // inline handlers. It loads nothing from a CDN, so no CDN is allowed to run
  // code on it.
  const strict = isOwnerSurface(new URL(c.req.url).pathname);
  c.header('Content-Security-Policy', [
    "default-src 'self'",
    strict
      ? `script-src 'self' ${OWNER_SURFACE_SCRIPT_HASH}`
      : "script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev https://cdn.jsdelivr.net https://unpkg.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' https://*.clerk.accounts.dev https://api.clerk.com",
    strict ? "frame-src 'none'" : 'frame-src https://*.clerk.accounts.dev',
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Nothing on the owner's surface posts anywhere but here, so nothing may.
    ...(strict ? ["form-action 'self'", "frame-ancestors 'none'"] : []),
  ].join('; '));

  // HSTS (only in production to avoid dev issues)
  if (process.env.NODE_ENV === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Permissions Policy
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});
