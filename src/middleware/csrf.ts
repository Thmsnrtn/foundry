// =============================================================================
// FOUNDRY — CSRF Protection Middleware
// Origin verification first (the header browsers always attach to cross-site
// POSTs and that attackers cannot forge), with double-submit token as the
// compatible fallback. Origin-based checking is what actually protects this
// app: the server-rendered forms authenticate via session cookie, and a
// per-form token would have to be threaded through every one of them — a
// missed form fails CLOSED as a 403 for the legitimate user while adding no
// safety beyond the origin check. Token submission (header or _csrf field)
// is still honored for clients that send it.
// =============================================================================

import { createMiddleware } from 'hono/factory';
import { randomBytes } from 'node:crypto';

const CSRF_COOKIE = 'foundry_csrf';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_FIELD = '_csrf';

/** Hosts this deployment answers as — the request's own host plus APP_URL's. */
function allowedHosts(requestUrl: string): Set<string> {
  const hosts = new Set<string>();
  try { hosts.add(new URL(requestUrl).host); } catch { /* unparseable */ }
  if (process.env.APP_URL) {
    try { hosts.add(new URL(process.env.APP_URL).host); } catch { /* unparseable */ }
  }
  return hosts;
}

export const csrfMiddleware = createMiddleware(async (c, next) => {
  // Extract existing token from cookie (or mint one) so templates can embed it.
  const cookieHeader = c.req.header('Cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`${CSRF_COOKIE}=([^;]+)`));
  let token = match?.[1] ?? '';
  if (!token) token = randomBytes(32).toString('hex');
  c.set('csrfToken' as never, token as never);

  const setCookie = () =>
    c.header('Set-Cookie', `${CSRF_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`, { append: true });

  // Safe methods: no validation, just ensure the cookie is set.
  const method = c.req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    await next();
    setCookie();
    return;
  }

  // Bearer-authenticated requests carry no ambient cookie credential a
  // cross-site page could ride on — CSRF does not apply.
  if ((c.req.header('Authorization') ?? '').startsWith('Bearer ')) {
    await next();
    return;
  }

  // 1. Origin check. Browsers attach Origin to every cross-site POST and it
  // cannot be forged or suppressed by an attacking page. A present Origin
  // (or, failing that, Referer) from a foreign host is a definitive CSRF
  // signal → reject. A same-host value is definitive legitimacy → accept.
  const source = c.req.header('Origin') ?? c.req.header('Referer');
  if (source && source !== 'null') {
    let sourceHost = '';
    try { sourceHost = new URL(source).host; } catch { /* fall through to reject */ }
    if (!sourceHost || !allowedHosts(c.req.url).has(sourceHost)) {
      return c.json({ error: 'CSRF token mismatch' }, 403);
    }
    await next();
    setCookie();
    return;
  }

  // 2. No Origin/Referer (non-browser client, or a browser stripped by a
  // privacy extension): honor the double-submit token when one is submitted.
  let submittedToken = c.req.header(CSRF_HEADER);
  if (!submittedToken) {
    try {
      const ct = c.req.header('Content-Type') ?? '';
      if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
        const body = await c.req.parseBody();
        submittedToken = body[CSRF_FIELD] as string | undefined;
      }
    } catch { /* unparseable body — treat as no token */ }
  }
  if (submittedToken !== undefined && submittedToken !== token) {
    return c.json({ error: 'CSRF token mismatch' }, 403);
  }

  // No token submitted and no browser origin signal: this request cannot have
  // been launched by a cross-site page (forms and fetch always carry Origin),
  // so treat it as a direct client call.
  await next();
  setCookie();
});

/**
 * Generate a hidden input field for HTML forms.
 * Use in templates: ${csrfInput(c)}
 */
export function csrfInput(c: { get: (key: string) => unknown }): string {
  const token = c.get('csrfToken') as string ?? '';
  return `<input type="hidden" name="${CSRF_FIELD}" value="${token}" />`;
}
