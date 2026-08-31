// =============================================================================
// FOUNDRY — Security Headers Middleware
// Sets security headers on all responses: CSP, X-Frame-Options, etc.
// =============================================================================

import { createMiddleware } from 'hono/factory';
import { nanoid } from 'nanoid';
import { withTrace, newTraceId } from '../lib/trace.js';

/**
 * Request ID + trace context middleware. Assigns a unique trace ID to every
 * request, returns it in X-Request-ID, and installs an AsyncLocalStorage
 * trace context so downstream services (logger, AI client, DB) auto-tag
 * their output with the trace ID without explicit threading.
 */
export const requestIdMiddleware = createMiddleware(async (c, next) => {
  const incoming = c.req.header('X-Request-ID');
  const traceId = incoming ?? newTraceId();
  // Per-request tag: stable across the full lifecycle even if downstream
  // generates additional internal IDs.
  c.set('requestId', traceId);
  c.header('X-Request-ID', traceId);
  // Wrap the rest of the request inside the trace scope. Anything async
  // run from `next()` sees this context via currentTrace().
  await withTrace({ traceId }, () => next());
});

// THE SECOND CONTENT-SECURITY-POLICY LIVED HERE, AND NOTHING IMPORTED IT.
//
// `index.ts` mounts `securityHeaders` from `middleware/security-headers.ts`;
// this file exported a function of the same name, with a different policy —
// allowing unpkg but not jsdelivr, and carrying `object-src 'none'` and
// `base-uri 'self'` that the live one did not. Two policies for one question,
// one of them enforced, and the dead one was the stricter-looking of the two.
//
// A reader comparing them could not tell which governed the product. The
// directives worth keeping moved to the live file; this one is gone rather than
// left as a second answer.

