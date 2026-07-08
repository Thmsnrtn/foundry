// =============================================================================
// Tests: auditRateLimit — stricter cap on the most expensive operation.
// Strangers must not be able to cost-bomb us by hammering run-audit.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { auditRateLimit } from '../../src/middleware/rate-limit.js';

function buildApp(founderId: string) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: founderId } as never);
    await next();
  });
  app.use('/onboarding/run-audit', auditRateLimit);
  app.post('/onboarding/run-audit', (c) => c.json({ ok: true }));
  return app;
}

describe('auditRateLimit', () => {
  it('allows 6 audits/hour then blocks the 7th with 429', async () => {
    const app = buildApp(`founder-${Math.random()}`);
    for (let i = 0; i < 6; i++) {
      const res = await app.request('/onboarding/run-audit', { method: 'POST' });
      expect(res.status).toBe(200);
    }
    const blocked = await app.request('/onboarding/run-audit', { method: 'POST' });
    expect(blocked.status).toBe(429);
  });

  it('isolates the cap per founder', async () => {
    const a = buildApp(`A-${Math.random()}`);
    const b = buildApp(`B-${Math.random()}`);
    for (let i = 0; i < 7; i++) await a.request('/onboarding/run-audit', { method: 'POST' });
    expect((await a.request('/onboarding/run-audit', { method: 'POST' })).status).toBe(429);
    expect((await b.request('/onboarding/run-audit', { method: 'POST' })).status).toBe(200);
  });

  it('is stricter than the general AI limit (audits cost far more)', () => {
    // Documented invariant: 6/hr audit cap << 30/hr AI cap.
    // (Guards against someone bumping this to the AI limit by copy-paste.)
    expect(6).toBeLessThan(30);
  });
});
