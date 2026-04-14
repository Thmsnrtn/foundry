// =============================================================================
// FOUNDRY — Security Headers Tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requestIdMiddleware, securityHeaders } from './security.js';

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
