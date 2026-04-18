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

  // Prevent embedding in iframes (modern)
  c.header('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://unpkg.com https://*.clerk.accounts.dev",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' https://*.clerk.accounts.dev https://api.clerk.com",
    "frame-src https://*.clerk.accounts.dev",
    "font-src 'self'",
  ].join('; '));

  // HSTS (only in production to avoid dev issues)
  if (process.env.NODE_ENV === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Permissions Policy
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});
