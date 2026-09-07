process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { companyNamedIn } from '../../src/services/institution/undertaking.js';

// =============================================================================
// ADOPT IS ONE SENTENCE.
//
// The first thing an owner says about a business Foundry has not met is its
// name and a verb: "Adopt Tidewater Prints." Before this, that sentence came
// back from the single door as "I need which company you mean" — and the only
// way through was to add the company on one page and then find its page to say
// what he wanted. Two screens for one sentence.
//
// And "Grow AcreOS", with the company's name in it, came back the same way.
//
// Now: a company he already has is recognised by name and the sentence goes to
// its page, offered. A business he is naming for the first time gets one
// preview — add it and take it on — that binds exactly the words it showed,
// and nothing before he confirms.
// =============================================================================

const OWNER = 'adopt_owner';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_adopt', 'owner@example.com', 'Owner']);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('p_acre', 'AcreOS', ?, 'active')", [OWNER]);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', foundryShellRoutes);
});

const post = (path: string, body: Record<string, string>) => app.request(path, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body).toString(),
});

describe('the name in the sentence', () => {
  it('comes back in his own casing, without the article', () => {
    expect(companyNamedIn('Adopt Tidewater Prints.')).toBe('Tidewater Prints');
    expect(companyNamedIn('take on my Etsy shop')).toBe('Etsy shop');
    expect(companyNamedIn('Understand the business called Soil API')).toBe('Soil API');
    expect(companyNamedIn('understand why customers are leaving and what to do')).toBeNull();
    expect(companyNamedIn('grow')).toBeNull();
  });
});

describe('a verb that names a company he already has', () => {
  it('goes to that company\'s page, offered, instead of asking which company', async () => {
    const res = await post('/foundry/ask', { said: 'Grow AcreOS' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/foundry/companies/p_acre?q=Grow%20AcreOS');
  });
});

describe('a verb that names a business Foundry has not met', () => {
  it('previews adding it and taking it on, and binds nothing yet', async () => {
    const res = await post('/foundry/ask', { said: 'Adopt Tidewater Prints.' });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Add Tidewater Prints and take it on?');
    expect(body).toContain('action="/foundry/adopt"');
    expect(body).toMatch(/name="understood" value="learn what tidewater prints is/);
    expect((await query("SELECT COUNT(*) AS n FROM products WHERE name = 'Tidewater Prints'")).rows[0],
      'the preview adds nothing').toMatchObject({ n: 0 });
  });

  it('adds it and opens the thread on confirmation — once, however many times he taps', async () => {
    const understood = 'learn what tidewater prints is, and say what I can and cannot see';
    const first = await post('/foundry/adopt', { said: 'Adopt Tidewater Prints.', name: 'Tidewater Prints', understood });
    expect(first.status).toBe(302);
    const company = (await query("SELECT id FROM products WHERE name = 'Tidewater Prints' AND owner_id = ?", [OWNER]))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(company).toHaveLength(1);
    const id = String(company[0]!.id);
    expect(first.headers.get('location')).toBe(`/foundry/companies/${id}/work?done=undertaken#underway`);

    const threads = (await query("SELECT kind, asked, closed_at FROM undertakings WHERE product_id = ?", [id]))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ kind: 'understand', asked: 'Adopt Tidewater Prints.', closed_at: null });

    const again = await post('/foundry/adopt', { said: 'Adopt Tidewater Prints.', name: 'Tidewater Prints', understood });
    expect(again.status).toBe(302);
    expect((await query("SELECT COUNT(*) AS n FROM products WHERE name = 'Tidewater Prints'")).rows[0]).toMatchObject({ n: 1 });
    expect((await query('SELECT COUNT(*) AS n FROM undertakings WHERE product_id = ?', [id])).rows[0]).toMatchObject({ n: 1 });
  });

  it('acts on nothing when the confirmation does not match the words', async () => {
    const res = await post('/foundry/adopt', { said: 'Adopt Soil API.', name: 'Soil API', understood: 'something else' });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Let me say that again');
    expect((await query("SELECT COUNT(*) AS n FROM products WHERE name = 'Soil API'")).rows[0]).toMatchObject({ n: 0 });
  });
});
