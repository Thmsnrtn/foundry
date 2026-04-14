// =============================================================================
// FOUNDRY — Rate Limiting Tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { rateLimit } from './rate-limit.js';

function createTestApp(max: number, windowMs: number) {
  const app = new Hono();
  app.use('*', rateLimit({
    max,
    windowMs,
    keyFn: () => `test-${Date.now()}-${Math.random()}`, // unique per test
  }));
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('rateLimit', () => {
  it('allows requests under the limit', async () => {
    const app = createTestApp(5, 60_000);
    // Use a unique key per test by generating fresh middleware
    const uniqueApp = new Hono();
    const key = `test-${Date.now()}`;
    uniqueApp.use('*', rateLimit({ max: 5, windowMs: 60_000, keyFn: () => key }));
    uniqueApp.get('/test', (c) => c.json({ ok: true }));

    const res = await uniqueApp.request('/test');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('4');
  });

  it('blocks requests over the limit', async () => {
    const key = `block-test-${Date.now()}`;
    const app = new Hono();
    app.use('*', rateLimit({ max: 2, windowMs: 60_000, keyFn: () => key }));
    app.get('/test', (c) => c.json({ ok: true }));

    // First 2 requests should succeed
    await app.request('/test');
    await app.request('/test');

    // Third request should be blocked
    const res = await app.request('/test');
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Too many requests');
  });

  it('sets Retry-After header when limited', async () => {
    const key = `retry-test-${Date.now()}`;
    const app = new Hono();
    app.use('*', rateLimit({ max: 1, windowMs: 60_000, keyFn: () => key }));
    app.get('/test', (c) => c.json({ ok: true }));

    await app.request('/test');
    const res = await app.request('/test');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeDefined();
  });
});
