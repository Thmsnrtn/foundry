// =============================================================================
// Tests: what a rate limiter counts, and who gets to choose it
//
// Two defects in one store, both about the KEY rather than the limit.
//
// 1. THE CLIENT PICKED ITS OWN BUCKET. The default key was
//    `x-forwarded-for ?? cf-connecting-ip ?? 'unknown'` — the client's own
//    header first, verbatim, whole. On Fly, which is where this runs, the
//    platform sets `Fly-Client-IP` and APPENDS the real address to
//    X-Forwarded-For; anything already in that header came from the caller. So
//    a caller sending a random XFF per request got a fresh bucket every time
//    and was never limited at all — and, incidentally, filled a store with a
//    10,000-entry emergency eviction, which resets the counters of everyone
//    else in it.
//
// 2. FOUR LIMITERS SHARED ONE COUNTER. `publicRateLimit` (60/min),
//    `apiRateLimit` (120/min), `webhookRateLimit` (300/min) and
//    `authRateLimit` (10/min) all used the default key with no prefix, so one
//    address had ONE counter across all of them. Browsing the public site ten
//    times locked the same visitor out of logging in, and the 120/min API
//    allowance was really "120 minus whatever else you did".
//
// The fix is one `clientIp` reader and one namespace per limiter. Neither
// changes a single published limit.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import {
  publicRateLimit, authRateLimit, apiRateLimit, clientIp,
} from '../../src/middleware/rate-limit.js';

/** A distinct address per test, so tests do not share the module-level store. */
function ip(): string {
  return `198.51.100.${Math.floor(Math.random() * 250) + 1}.${Math.random().toString(36).slice(2)}`;
}

function app(...mw: Array<Parameters<Hono['use']>[1]>) {
  const a = new Hono();
  for (const m of mw) a.use('*', m);
  a.get('/x', (c) => c.json({ ok: true }));
  return a;
}

describe('the caller does not choose its own bucket', () => {
  it('prefers the platform header over anything the client sent', () => {
    const c = {
      req: {
        header: (n: string) => ({
          'fly-client-ip': '203.0.113.9',
          'x-forwarded-for': '10.0.0.1, 203.0.113.9',
          'cf-connecting-ip': '198.51.100.7',
        }[n.toLowerCase()]),
      },
    };
    expect(clientIp(c as never)).toBe('203.0.113.9');
  });

  it('takes the LAST hop of x-forwarded-for, which is the one a proxy appended', () => {
    // The client controls the front of this list. The back is what the last
    // trusted hop wrote.
    const c = {
      req: { header: (n: string) => (n.toLowerCase() === 'x-forwarded-for'
        ? 'evil-1, evil-2, 203.0.113.9' : undefined) },
    };
    expect(clientIp(c as never)).toBe('203.0.113.9');
  });

  it('cannot be varied into unlimited quota by rewriting the header', async () => {
    const real = ip();
    const a = app(publicRateLimit);
    let blocked = 0;
    for (let i = 0; i < 70; i++) {
      const res = await a.request('/x', {
        headers: {
          // Same real client, a different forged chain every time.
          'fly-client-ip': real,
          'x-forwarded-for': `${Math.random()}, ${real}`,
        },
      });
      if (res.status === 429) blocked++;
    }
    expect(blocked, 'a client rotating X-Forwarded-For must still be limited')
      .toBeGreaterThan(0);
  });

  it('still limits a caller with no platform header at all', async () => {
    const a = app(publicRateLimit);
    let blocked = 0;
    const forged = ip();
    for (let i = 0; i < 70; i++) {
      const res = await a.request('/x', { headers: { 'x-forwarded-for': forged } });
      if (res.status === 429) blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
  });
});

describe('each limiter counts its own traffic', () => {
  it('does not spend the login allowance on ordinary browsing', async () => {
    const addr = ip();
    const headers = { 'fly-client-ip': addr };
    const publicApp = app(publicRateLimit);
    const authApp = app(authRateLimit);

    // Fifty page views — well inside the 60/min public allowance.
    for (let i = 0; i < 50; i++) {
      expect((await publicApp.request('/x', { headers })).status).toBe(200);
    }
    // The same visitor now tries to log in. Ten attempts are allowed.
    const res = await authApp.request('/x', { headers });
    expect(res.status, 'browsing must not consume the auth budget').toBe(200);
  });

  it('reports the limit belonging to the route, not to whoever created the entry', async () => {
    const addr = ip();
    const headers = { 'fly-client-ip': addr };
    await app(publicRateLimit).request('/x', { headers });
    const res = await app(apiRateLimit).request('/x', { headers });
    expect(res.headers.get('X-RateLimit-Limit')).toBe('120');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('119');
  });

  it('still limits within one namespace', async () => {
    const addr = ip();
    const headers = { 'fly-client-ip': addr };
    const a = app(authRateLimit);
    for (let i = 0; i < 10; i++) {
      expect((await a.request('/x', { headers })).status).toBe(200);
    }
    expect((await a.request('/x', { headers })).status).toBe(429);
  });
});

describe('nothing else reads the raw header', () => {
  it('records consent against an address the consenting browser could not write', async () => {
    // The IP on a consent receipt is EVIDENCE. Taking it from a header the
    // client controls makes the receipt say whatever the browser claimed.
    const { readFileSync, readdirSync, statSync } = await import('fs');
    const { join, resolve } = await import('path');
    const walk = (d: string): string[] => readdirSync(d).flatMap((e) => {
      const p = join(d, e);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
    const offenders = walk(resolve(__dirname, '../../src'))
      .filter((f) => !f.endsWith('/middleware/rate-limit.ts'))
      .filter((f) => /header\(\s*['"]x-forwarded-for['"]/i.test(readFileSync(f, 'utf8')))
      .map((f) => f.split('/src/')[1]);
    expect(offenders, 'use clientIp(): the raw header is written by the caller')
      .toEqual([]);
  });
});
