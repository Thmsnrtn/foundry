// =============================================================================
// CONNECT IS ALLOWED TO REACH THE CONSENT SCREEN.
//
// The owner saved his Etsy key and was "stuck on step 2": the Connect button
// did nothing. The owner surface's policy said `form-action 'self'`, and a
// browser applies form-action to every hop of a form's redirect chain — so the
// one redirect Connect exists to make, to Etsy's consent screen, was refused
// by the browser with nothing on the page to say so. Chromium's own words, in
// the reproduction: "Refused to send form data … because it violates the
// following Content Security Policy directive: form-action 'self'".
//
// The policy now names the consent screens a form here may lead to, and
// nothing else — and this file holds that list to the providers' own code, so
// a provider added later cannot be silently unreachable the same way.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';

async function ownerPolicy(): Promise<string> {
  const { securityHeaders } = await import('../../src/middleware/security-headers.js');
  const app = new Hono();
  app.use('*', securityHeaders);
  app.get('/foundry/controls/connectors/etsy', (c) => c.html('<p>ok</p>'));
  const res = await app.request('/foundry/controls/connectors/etsy');
  return String(res.headers.get('content-security-policy'));
}

const formAction = (csp: string): string[] =>
  (/form-action ([^;]+)/.exec(csp)?.[1] ?? '').trim().split(/\s+/);

/** Every consent screen a provider adapter redirects to, read from its own source. */
function consentOrigins(): string[] {
  const dir = 'src/services/senses/providers';
  const out: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    const m = /const AUTHORIZE = '([^']+)'/.exec(readFileSync(`${dir}/${f}`, 'utf8'));
    if (m?.[1]) out.push(new URL(m[1]).origin);
  }
  return out;
}

describe('the Connect button can reach the provider', () => {
  it('lets a form on the owner surface arrive at Etsy\'s consent screen', async () => {
    expect(formAction(await ownerPolicy())).toContain('https://www.etsy.com');
  });

  it('covers every provider that has a consent screen, not only the one that failed', async () => {
    const allowed = formAction(await ownerPolicy());
    const origins = consentOrigins();
    expect(origins.length, 'no provider declares a consent screen').toBeGreaterThan(0);
    for (const o of origins) expect(allowed, `${o} is unreachable from Connect`).toContain(o);
  });

  it('still names nothing else: self and those consent screens, no wildcard, no scheme', async () => {
    const allowed = formAction(await ownerPolicy());
    const expected = new Set(["'self'", ...consentOrigins()]);
    for (const a of allowed) expect(expected.has(a), `${a} is not a consent screen`).toBe(true);
    expect(allowed.join(' ')).not.toMatch(/\*|https:(?!\/\/)/);
  });
});

describe('the callback address is the one Etsy will be told, and it is https', () => {
  // The owner's phone showed "http://foundry-intel.f…" under "add it to your
  // Etsy app's redirect URIs". Fly terminates TLS in front of the app, so the
  // request the app sees says http, and the address was built from it — on
  // the page he copies from and in the authorisation Etsy compares exactly.
  it('builds https behind the production proxy, from the host the request arrived on', async () => {
    const { senseCallbackUriFor } = await import('../../src/routes/dashboard/foundry-shell.js');
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(senseCallbackUriFor('http://foundry-intel.fly.dev/foundry/controls/connectors/etsy'))
        .toBe('https://foundry-intel.fly.dev/foundry/senses/callback');
    } finally { process.env.NODE_ENV = before; }
  });

  it('keeps the scheme it was given outside production, so local runs still round-trip', async () => {
    const { senseCallbackUriFor } = await import('../../src/routes/dashboard/foundry-shell.js');
    expect(senseCallbackUriFor('http://127.0.0.1:8080/x')).toBe('http://127.0.0.1:8080/foundry/senses/callback');
  });

  it('takes nothing but the host from the request: no path, no query, no user info', async () => {
    const { senseCallbackUriFor } = await import('../../src/routes/dashboard/foundry-shell.js');
    expect(senseCallbackUriFor('http://u:p@foundry.test/a?redirect=https://evil.test'))
      .toBe('http://foundry.test/foundry/senses/callback');
  });
});
