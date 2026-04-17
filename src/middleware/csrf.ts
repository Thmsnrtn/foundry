// =============================================================================
// FOUNDRY — CSRF Protection Middleware
// Double-submit cookie pattern. Generates a per-session token, embeds it in
// a cookie, and validates it on state-mutating requests (POST/PUT/PATCH/DELETE).
// =============================================================================

import { createMiddleware } from 'hono/factory';
import { randomBytes } from 'node:crypto';

const CSRF_COOKIE = 'foundry_csrf';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_FIELD = '_csrf';

/**
 * Extract or generate a CSRF token for this session.
 * Sets the token in a cookie if not already present.
 */
export const csrfMiddleware = createMiddleware(async (c, next) => {
  // Extract existing token from cookie
  const cookieHeader = c.req.header('Cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`${CSRF_COOKIE}=([^;]+)`));
  let token = match?.[1] ?? '';

  // Generate new token if missing
  if (!token) {
    token = randomBytes(32).toString('hex');
  }

  // Make token available to templates
  c.set('csrfToken' as never, token as never);

  // Safe methods: skip validation, just ensure cookie is set
  const method = c.req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    await next();
    // Set/refresh the CSRF cookie on response
    c.header('Set-Cookie', `${CSRF_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`, { append: true });
    return;
  }

  // State-mutating methods: validate token
  // Check header first (for HTMX/fetch requests)
  let submittedToken = c.req.header(CSRF_HEADER);

  // Check form body if header not present
  if (!submittedToken) {
    try {
      const ct = c.req.header('Content-Type') ?? '';
      if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
        const body = await c.req.parseBody();
        submittedToken = body[CSRF_FIELD] as string;
      } else if (ct.includes('application/json')) {
        // For JSON APIs, the header is required (cookie is sufficient via SameSite)
        // Skip CSRF for JSON API routes — they use Bearer auth, not cookies
        await next();
        return;
      }
    } catch {
      // Body parsing failed — reject
    }
  }

  // Validate: submitted token must match cookie token
  if (!submittedToken || submittedToken !== token) {
    return c.json({ error: 'CSRF token mismatch' }, 403);
  }

  await next();
  // Refresh cookie
  c.header('Set-Cookie', `${CSRF_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`, { append: true });
});

/**
 * Generate a hidden input field for HTML forms.
 * Use in templates: ${csrfInput(c)}
 */
export function csrfInput(c: { get: (key: string) => unknown }): string {
  const token = c.get('csrfToken') as string ?? '';
  return `<input type="hidden" name="${CSRF_FIELD}" value="${token}" />`;
}
