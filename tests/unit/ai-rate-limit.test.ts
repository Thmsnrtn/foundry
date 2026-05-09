// =============================================================================
// Tests: aiRateLimit middleware (per-founder, 30/hour)
// Verifies the in-memory sliding window blocks a runaway loop without
// breaking ordinary human pacing.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

import { aiRateLimit } from '../../src/middleware/rate-limit.js';

function buildApp(founderId: string | null) {
  const app = new Hono();
  // Stub auth: set the founder context the rate limiter expects.
  app.use('*', async (c, next) => {
    if (founderId) c.set('founder' as never, { id: founderId } as never);
    await next();
  });
  app.use('/api/ask/*', aiRateLimit);
  app.get('/api/ask/test', (c) => c.json({ ok: true }));
  return app;
}

describe('aiRateLimit', () => {
  it('allows up to 30 requests in an hour for one founder', async () => {
    const app = buildApp(`founder-${Math.random()}`); // unique key per test
    for (let i = 0; i < 30; i++) {
      const res = await app.request('/api/ask/test');
      expect(res.status).toBe(200);
    }
  });

  it('blocks the 31st request with 429', async () => {
    const app = buildApp(`founder-${Math.random()}`);
    for (let i = 0; i < 30; i++) await app.request('/api/ask/test');
    const blocked = await app.request('/api/ask/test');
    expect(blocked.status).toBe(429);
  });

  it('isolates rate limits per founder', async () => {
    const a = buildApp(`founder-A-${Math.random()}`);
    const b = buildApp(`founder-B-${Math.random()}`);
    for (let i = 0; i < 30; i++) await a.request('/api/ask/test');
    // A is now blocked
    const aBlocked = await a.request('/api/ask/test');
    expect(aBlocked.status).toBe(429);
    // B starts fresh
    const bOk = await b.request('/api/ask/test');
    expect(bOk.status).toBe(200);
  });

  it('falls back to IP-keying when no founder is on the context', async () => {
    const app = buildApp(null);
    const req = (ip: string) =>
      app.request('/api/ask/test', {
        headers: { 'x-forwarded-for': ip },
      });
    for (let i = 0; i < 30; i++) {
      const res = await req(`10.0.0.${(i % 200) + 50}-${Math.random()}`); // mostly unique IPs
      expect(res.status).toBe(200);
    }
  });

  it('exposes X-RateLimit-Remaining header so clients can self-pace', async () => {
    const app = buildApp(`founder-${Math.random()}`);
    const res1 = await app.request('/api/ask/test');
    const remaining1 = Number(res1.headers.get('X-RateLimit-Remaining'));
    const res2 = await app.request('/api/ask/test');
    const remaining2 = Number(res2.headers.get('X-RateLimit-Remaining'));
    expect(remaining1).toBeGreaterThan(remaining2);
  });
});
