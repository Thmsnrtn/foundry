// =============================================================================
// FOUNDRY — Security Headers Middleware
// Sets standard HTTP security headers on all responses.
// =============================================================================

import { createMiddleware } from 'hono/factory';

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
  // `'unsafe-inline'` stays for now and is not a shrug: RT02-14 asks for
  // nonces, and there are 14 inline `<script>` blocks plus 37 inline event
  // handlers, which a nonce does not cover. That is a whole piece of work with
  // its own verification, not a directive edit.
  c.header('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev https://cdn.jsdelivr.net https://unpkg.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' https://*.clerk.accounts.dev https://api.clerk.com",
    "frame-src https://*.clerk.accounts.dev",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; '));

  // HSTS (only in production to avoid dev issues)
  if (process.env.NODE_ENV === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Permissions Policy
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});
