// =============================================================================
// FOUNDRY — CSRF Protection Middleware
// Double-submit cookie pattern: generates a token, sets it as a cookie,
// and validates it on POST/PUT/DELETE requests.
// =============================================================================

import { createMiddleware } from 'hono/factory';
import { randomBytes, timingSafeEqual } from 'crypto';

const CSRF_COOKIE = '__csrf';
const CSRF_HEADER = 'X-CSRF-Token';
const CSRF_FORM_FIELD = '_csrf';
const TOKEN_BYTES = 32;

/**
 * Generate a cryptographically random CSRF token.
 */
function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * Timing-safe comparison of two strings.
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Extract CSRF cookie from the Cookie header.
 */
function getCsrfCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').find((c) => c.trim().startsWith(`${CSRF_COOKIE}=`));
  return match?.split('=')[1]?.trim() ?? null;
}

/**
 * CSRF protection middleware.
 *
 * On GET/HEAD/OPTIONS: ensures a CSRF cookie exists, sets one if not.
 * On POST/PUT/PATCH/DELETE: validates that the submitted token matches the cookie.
 *
 * The token can be submitted via:
 * - Hidden form field: <input type="hidden" name="_csrf" value="...">
 * - Request header: X-CSRF-Token
 */
export const csrfProtection = createMiddleware(async (c, next) => {
  const method = c.req.method.toUpperCase();

  // Safe methods — ensure cookie exists
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const existing = getCsrfCookie(c.req.header('Cookie'));
    if (!existing) {
      const token = generateToken();
      c.header('Set-Cookie', `${CSRF_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
      c.set('csrfToken' as never, token);
    } else {
      c.set('csrfToken' as never, existing);
    }
    await next();
    return;
  }

  // Unsafe methods — validate token
  const cookieToken = getCsrfCookie(c.req.header('Cookie'));
  if (!cookieToken) {
    return c.json({ error: 'CSRF token missing' }, 403);
  }

  // Check header first, then form body
  let submittedToken = c.req.header(CSRF_HEADER);

  if (!submittedToken) {
    // Try to extract from form body (only for form-encoded requests)
    const contentType = c.req.header('Content-Type') ?? '';
    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      try {
        const body = await c.req.parseBody() as Record<string, string>;
        submittedToken = body[CSRF_FORM_FIELD];
      } catch {
        // Body may have already been consumed — skip form check
      }
    }
  }

  // API requests with JSON content type are exempt (SameSite cookies + CORS prevent CSRF for JSON APIs)
  const contentType = c.req.header('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    c.set('csrfToken' as never, cookieToken);
    await next();
    return;
  }

  if (!submittedToken || !safeCompare(cookieToken, submittedToken)) {
    return c.json({ error: 'CSRF token invalid' }, 403);
  }

  c.set('csrfToken' as never, cookieToken);
  await next();
});

/**
 * Helper to generate the hidden CSRF input field for HTML forms.
 * Use in views: ${csrfField(c.get('csrfToken'))}
 */
export function csrfField(token: string): string {
  return `<input type="hidden" name="${CSRF_FORM_FIELD}" value="${token}" />`;
}
