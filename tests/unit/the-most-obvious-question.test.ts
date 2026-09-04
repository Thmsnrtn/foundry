process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// THE MOST OBVIOUS QUESTION ON THE SCREEN.
//
// The bar at the bottom of every page says "Ask Foundry anything". The first
// thing anybody types into a box like that is "how are things?" — and it
// answered "I don't know yet", because the phrase matched the rule for asking
// about ONE company, which then found no company named and gave up. The rule
// written for exactly this question sat three lines below and never ran.
// =============================================================================

const OWNER = 'obvious_owner';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_obvious', 'owner@example.com', 'Thomas Norton']);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', foundryShellRoutes);
  for (const name of ['Tidewater', 'Northgate']) {
    await app.request('/foundry/companies', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name }).toString() });
  }
});

describe('asking how things are', () => {
  for (const asked of ['How are things?', 'how are things', 'What do I own?',
    'How is everything doing?']) {
    it(`"${asked}" gets an answer about the portfolio`, async () => {
      const body = await (await app.request(
        `/foundry?q=${encodeURIComponent(asked)}`)).text();
      expect(body, 'it never says it does not know')
        .not.toContain("I don't know yet");
      // It answers about what he owns, by name.
      expect(body).toMatch(/Tidewater|Northgate|companies/);
    });
  }

  it('still answers about one company when he names one', async () => {
    const body = await (await app.request(
      '/foundry?q=How is Tidewater doing?')).text();
    expect(body).toContain('Tidewater');
  });
});

// =============================================================================
// AND TWO MORE THINGS THE SAME REVIEW FOUND, BOTH ABOUT SAYING THE SAME THING
// TWICE MEANING TWO DIFFERENT THINGS.
// =============================================================================

describe('naming the same company twice', () => {
  it('is one company, not two', async () => {
    // A phone on a slow connection double-submits, and a reload after a submit
    // does it again. This inserted unconditionally, so he ended up with two
    // identical companies each holding half of what Foundry later learned.
    const before = (await query(
      "SELECT COUNT(*) AS n FROM products WHERE owner_id = ? AND status = 'active'",
      [OWNER])).rows[0] as Record<string, unknown>;
    for (let i = 0; i < 3; i += 1) {
      await app.request('/foundry/companies', { method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ name: 'Tidewater' }).toString() });
    }
    const after = (await query(
      "SELECT COUNT(*) AS n FROM products WHERE owner_id = ? AND status = 'active'",
      [OWNER])).rows[0] as Record<string, unknown>;
    expect(Number(after.n)).toBe(Number(before.n));
  });

  it('still lands him on that company', async () => {
    const res = await app.request('/foundry/companies', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'Tidewater' }).toString() });
    expect(res.status).toBe(302);
    expect(String(res.headers.get('location'))).toContain('/foundry/companies/');
  });
});

describe('a company whose revenue cannot be seen', () => {
  it('is not filed as a small one', async () => {
    // Tributaries are described as "small, steady, and not asked to become
    // anchors". A company that has stopped reporting is none of those things —
    // it is a company Foundry cannot see, which is its own answer.
    const { layersFor } = await import('../../src/services/founder/portfolio.js');
    const { layers } = await layersFor(OWNER);
    const tributaries = layers.find((l) => l.name === 'tributaries');
    expect(tributaries?.companies ?? []).toHaveLength(0);
    const unseen = layers.find((l) => l.name === 'unseen');
    expect(unseen?.companies.length).toBeGreaterThan(0);
    expect(unseen?.what).toContain('cannot see');
  });
});
