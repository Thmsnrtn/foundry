process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// THE FIRST SCREEN NOTICED NOTHING.
//
// The owner said the application still felt primitive next to the institution
// underneath it. Surveying every screen showed something more specific than
// that: the company page is substantial — eight measures with directions, what
// is known, what can be seen, what cannot be done, and where every number came
// from — and the first screen, the one that is supposed to be sacred, said
//
//     "I am set up, and I have not learned anything about you yet."
//
// with two companies live in the portfolio. It asked about routines and never
// about companies. He could spend an afternoon exploring and come back to a
// home screen that had not noticed he had been there.
// =============================================================================

const OWNER = 'notice_owner';
let app: Hono;

async function firstScreen(): Promise<string> {
  return (await app.request('/foundry')).text();
}

async function spawnInvented(): Promise<void> {
  const list = await (await app.request('/foundry/companies')).text();
  const key = /name="scenario" value="([^"]+)"/.exec(list)?.[1];
  await app.request('/foundry/reference', { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ scenario: String(key) }).toString() });
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_notice', 'owner@example.com', 'Thomas Norton']);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', foundryShellRoutes);
});

describe('what the first screen says it knows', () => {
  it('admits knowing nothing when it knows nothing', async () => {
    expect(await firstScreen()).toContain('have not learned anything about you yet');
  });

  it('stops saying that the moment it is watching something', async () => {
    await spawnInvented();
    const body = await firstScreen();
    expect(body).not.toContain('have not learned anything about you yet');
    expect(body).toContain('Everything is fine');
  });

  it('says an invented company is invented, every time', async () => {
    // The entire reason these exist is that they are not his. A home screen
    // that counted them as his companies would undo the one thing the
    // reference world is for.
    const body = await firstScreen();
    expect(body).toContain('I made up');
    expect(body).toContain('none of yours yet');
  });

  it('never folds invented companies into the real count', async () => {
    await spawnInvented();
    const body = await firstScreen();
    expect(body).toContain('2 companies I made up');
    expect(body).not.toMatch(/looking after \d+ compan/);
  });
});
