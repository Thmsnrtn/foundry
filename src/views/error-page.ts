// =============================================================================
// FOUNDRY — Branded error pages
// Rendered for browser requests (Accept: text/html). API paths still get JSON.
//
// SELF-CONTAINED, BECAUSE THE LAYOUT IT BORROWED IS GONE.
//
// This called `publicLayout` from `views/layout.ts` — the other visual system's
// entry point, which carried Commercial Foundry's stylesheet, its manifest and
// its twenty-five item navigation. Every page that rendered through it has
// moved to the owner shell, so the module was deleted and this page stopped
// being able to borrow.
//
// It does NOT use the shell's `page()` either, and that is deliberate. The
// shell renders a rail of six doors, a breadcrumb trail and an Ask box — the
// furniture of a place you are inside. A 404 is not a place: half the time the
// person seeing it is not signed in, and offering them the estate's navigation
// would be offering doors that will refuse them. So this is a document of its
// own, on the same stylesheet, with the two links that are actually useful.
//
// `/help` was one of them and no longer exists; it went with the commercial
// pages. A "Get help" button leading to another 404 is the specific unkindness
// this file exists to avoid, so the second link is the one door that always
// answers.
// =============================================================================

import { html } from 'hono/html';
import { OWNER_STYLESHEET } from '../lib/owner-stylesheet.js';
import type { HtmlEscapedString } from 'hono/utils/html';

export type HtmlContent = HtmlEscapedString | Promise<HtmlEscapedString>;

export function errorPage(
  status: number,
  heading: string,
  message: string,
): HtmlContent {
  return html`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${String(status)} — ${heading}</title>
<meta name="theme-color" content="#0B100E" media="(prefers-color-scheme: dark)" />
<meta name="theme-color" content="#F3F4F1" media="(prefers-color-scheme: light)" />
<link rel="stylesheet" href="${OWNER_STYLESHEET}" />
</head>
<body>
<main class="wrap">
  <div style="max-width:34rem;margin:12vh auto 0;text-align:center">
    <div style="font-family:var(--serif);font-size:4rem;line-height:1;color:var(--ink-3)">${String(status)}</div>
    <h1 style="margin:var(--s2) 0 var(--s2);font-size:1.5rem">${heading}</h1>
    <p style="color:var(--ink-2);margin-bottom:var(--s4)">${message}</p>
    <div style="display:flex;gap:var(--s2);justify-content:center;flex-wrap:wrap">
      <a class="btn go" href="/foundry" style="width:auto;text-decoration:none">Go to Foundry</a>
      <a class="btn" href="/auth/login" style="width:auto;text-decoration:none">Sign in</a>
    </div>
  </div>
</main>
</body>
</html>`;
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
