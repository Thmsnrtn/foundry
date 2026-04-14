// =============================================================================
// FOUNDRY — Security Headers Middleware
// Sets security headers on all responses: CSP, X-Frame-Options, etc.
// =============================================================================

import { createMiddleware } from 'hono/factory';
import { nanoid } from 'nanoid';

/**
 * Request ID middleware. Assigns a unique ID to every request for log correlation.
 */
export const requestIdMiddleware = createMiddleware(async (c, next) => {
  const requestId = c.req.header('X-Request-ID') ?? nanoid(12);
  c.set('requestId', requestId);
  c.header('X-Request-ID', requestId);
  await next();
});

/**
 * Security headers middleware. Sets protective headers on all responses.
 */
export const securityHeaders = createMiddleware(async (c, next) => {
  await next();

  // Prevent clickjacking
  c.header('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  c.header('X-Content-Type-Options', 'nosniff');

  // Referrer policy — send origin only for cross-origin
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  // XSS protection (legacy but still useful for older browsers)
  c.header('X-XSS-Protection', '1; mode=block');

  // Content Security Policy
  c.header(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://unpkg.com https://*.clerk.accounts.dev",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.clerk.accounts.dev https://api.clerk.com",
      "frame-src https://*.clerk.accounts.dev",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; ')
  );

  // Strict Transport Security (only in production behind TLS)
  if (process.env.NODE_ENV === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Permissions Policy — disable unused browser features
  c.header(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(self)'
  );
});
