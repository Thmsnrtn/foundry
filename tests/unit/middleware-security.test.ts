// =============================================================================
// FOUNDRY — Security Headers Tests
//
// THIS FILE TESTED THE POLICY THAT WAS NOT ENFORCED. `securityHeaders` was
// exported from BOTH `middleware/security.ts` and `middleware/security-headers.ts`;
// `index.ts` mounts the second, and this imported the first. The two disagreed
// about which script origins are allowed and about two hardening directives, so
// five green assertions here described headers no response ever carried — while
// the live policy forbade the origins the product's own auth pages load Clerk
// from. The dead copy is deleted and this now asks the middleware the app
// actually mounts.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requestIdMiddleware } from '../../src/middleware/security.js';
import { securityHeaders } from '../../src/middleware/security-headers.js';

describe('securityHeaders', () => {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.use('*', securityHeaders);
  app.get('/test', (c) => c.json({ ok: true }));

  it('sets X-Frame-Options', async () => {
    const res = await app.request('/test');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('sets X-Content-Type-Options', async () => {
    const res = await app.request('/test');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sets Referrer-Policy', async () => {
    const res = await app.request('/test');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sets Content-Security-Policy', async () => {
    const res = await app.request('/test');
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    // The origins the auth and landing pages actually load Clerk from. The
    // enforced policy named neither, which means an enforcing browser blocked
    // authentication; `a-policy-that-forbade-the-product` derives this list
    // from the source rather than repeating it.
    expect(csp).toContain('https://cdn.jsdelivr.net');
    expect(csp).toContain('https://unpkg.com');
  });

  it('sets Permissions-Policy', async () => {
    const res = await app.request('/test');
    const pp = res.headers.get('Permissions-Policy');
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
  });
});

describe('requestIdMiddleware', () => {
  const app = new Hono<{ Variables: { requestId: string } }>();
  app.use('*', requestIdMiddleware);
  app.get('/test', (c) => c.json({ requestId: c.get('requestId') }));

  it('generates a request ID if none provided', async () => {
    const res = await app.request('/test');
    const id = res.headers.get('X-Request-ID');
    expect(id).toBeDefined();
    expect(id!.length).toBeGreaterThan(0);
  });

  it('preserves client-provided request ID', async () => {
    const res = await app.request('/test', {
      headers: { 'X-Request-ID': 'my-custom-id' },
    });
    expect(res.headers.get('X-Request-ID')).toBe('my-custom-id');
    const body = await res.json() as { requestId: string };
    expect(body.requestId).toBe('my-custom-id');
  });
});
