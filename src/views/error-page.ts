// =============================================================================
// FOUNDRY — Branded error pages
// Rendered for browser requests (Accept: text/html). API paths still get JSON.
// =============================================================================

import { html } from 'hono/html';
import { publicLayout, type HtmlContent } from './layout.js';

export function errorPage(
  status: number,
  heading: string,
  message: string,
): HtmlContent {
  return publicLayout(`${status} — ${heading}`, html`
    <div style="max-width:560px;margin:12vh auto 0;text-align:center;">
      <div style="font-size:5rem;font-weight:800;line-height:1;color:var(--color-accent,#6366f1);">${status}</div>
      <h1 style="margin:0.5rem 0 1rem;font-size:1.6rem;">${heading}</h1>
      <p style="color:var(--color-text-muted,#9ca3af);margin-bottom:2rem;">${message}</p>
      <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;">
        <a href="/" class="btn btn-primary" style="text-decoration:none;">Back to home</a>
        <a href="/dashboard" class="btn btn-secondary" style="text-decoration:none;">Dashboard</a>
      </div>
    </div>
  `);
}

/**
 * True when the request should get an HTML error page rather than JSON:
 * a browser navigation (Accept: text/html) that isn't hitting an API path.
 */
export function wantsHtml(accept: string | undefined, path: string): boolean {
  const isApiPath = path === '/api' || path.startsWith('/api/');
  if (isApiPath) return false;
  return (accept ?? '').includes('text/html');
}
