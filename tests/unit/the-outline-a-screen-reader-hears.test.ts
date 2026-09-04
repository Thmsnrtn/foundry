process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// THE OUTLINE A SCREEN READER HEARS.
//
// Somebody navigating by headings hears the shape of a page before they hear
// any of it. On three of the five places the shape was wrong: the first screen
// went from its h1 straight to h3, skipping a level, so every section sounded
// like a sub-part of something that was not there.
//
// It costs nothing to be right about — the headings are the same size either
// way, because this is for the screen reader rather than the eye — and nothing
// catches it except a check like this one.
// =============================================================================

const OWNER = 'outline_owner';
let app: Hono;

function outline(html: string): number[] {
  return [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_outline', 'owner@example.com', 'Thomas Norton']);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', foundryShellRoutes);
  await app.request('/foundry/companies', { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'Tidewater' }).toString() });
  await app.request('/foundry/reference/search', { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' });
});

describe('every place the owner can be', () => {
  const places = ['/foundry', '/foundry/companies', '/foundry/controls'];
  for (const path of places) {
    it(`${path} descends one level at a time`, async () => {
      const levels = outline(await (await app.request(path)).text());
      expect(levels.length, 'a page has headings').toBeGreaterThan(0);
      expect(levels[0], 'it starts at h1').toBe(1);
      let deepest = levels[0] ?? 1;
      for (const level of levels) {
        expect(level, `jumped past h${String(deepest + 1)} on ${path}`)
          .toBeLessThanOrEqual(deepest + 1);
        deepest = Math.max(deepest, level);
      }
    });

    it(`${path} has exactly one h1`, async () => {
      const levels = outline(await (await app.request(path)).text());
      expect(levels.filter((l) => l === 1)).toHaveLength(1);
    });
  }

  it('a company page descends too', async () => {
    const id = String(((await query(
      'SELECT id FROM products WHERE owner_id = ?', [OWNER])).rows[0] as
      Record<string, unknown>).id);
    const levels = outline(await (await app.request(`/foundry/companies/${id}`)).text());
    expect(levels[0]).toBe(1);
    let deepest = levels[0] ?? 1;
    for (const level of levels) {
      expect(level).toBeLessThanOrEqual(deepest + 1);
      deepest = Math.max(deepest, level);
    }
  });
});

describe('what a screen reader is told about each field', () => {
  it('leaves no control without a name', async () => {
    for (const path of ['/foundry', '/foundry/companies', '/foundry/controls']) {
      const body = await (await app.request(path)).text();
      const controls = [...body.matchAll(/<(input|select|textarea)\b[^>]*>/g)]
        .map((m) => m[0])
        .filter((tag) => !/type="(hidden|submit)"/.test(tag));
      for (const tag of controls) {
        const named = /aria-label="/.test(tag) || /\bid="([^"]+)"/.test(tag);
        expect(named, `unnamed control on ${path}: ${tag.slice(0, 90)}`).toBe(true);
      }
    }
  });
});
