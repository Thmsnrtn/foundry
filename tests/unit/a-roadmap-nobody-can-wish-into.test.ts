process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// A ROADMAP NOBODY CAN WISH INTO.
//
// Every product has a roadmap page and almost all of them are the same lie: a
// list somebody typed once, never closed, true only on the day it was written.
// This one has no table of its own. It reads `undertakings` — what the
// institution actually took on, the owner's words kept verbatim where he said
// them, and the steps recorded against each — so nothing can appear on it
// because somebody intended it.
//
// THREE CLAIMS:
//   1. It has no writer. No route under it opens an undertaking; taking
//      something on binds what a sentence was understood as, and that belongs
//      where he says it, with the understanding shown before it holds.
//   2. It shows an empty estate as empty, in words, rather than as a blank.
//   3. An invented company's work never appears in what the institution is
//      doing for him.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const SOURCE = readFileSync(resolve(ROOT, 'src/routes/dashboard/roadmap-place.ts'), 'utf8');

const OWNER = 'road_owner';
let app: Hono;

async function company(name: string, reality: 'real' | 'reference'): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO products (id, name, owner_id, status, reality) VALUES (?,?,?,'active',?)`,
    [id, name, OWNER, reality]);
  return id;
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [OWNER, 'clerk_road', 'road@example.com']);
  const { roadmapRoutes } = await import('../../src/routes/dashboard/roadmap-place.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: OWNER, email: 'road@example.com' } as never);
    await next();
  });
  app.route('/', roadmapRoutes);
});

describe('the roadmap is a record, not a plan', () => {
  it('offers no way to add to itself', () => {
    // A roadmap you can type into is a wish list. The only POST it offers is
    // the one that STOPS something — taking load off, never putting it on.
    const posts = [...SOURCE.matchAll(/roadmapRoutes\.post\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(posts).toEqual([]);
    const forms = [...SOURCE.matchAll(/action="([^"$]*)"/g)].map((m) => m[1]);
    for (const f of forms) expect(f).toMatch(/\/stop$/);
  });

  it('never opens an undertaking of its own', () => {
    expect(SOURCE).not.toMatch(/openUndertaking\(/);
    expect(SOURCE).not.toMatch(/INSERT INTO undertakings/i);
  });

  it('says an empty estate is empty, in words', async () => {
    const body = await (await app.request('/foundry/roadmap')).text();
    expect(body).toContain('I am not carrying anything for you');
    for (const rx of [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /Invalid Date/]) {
      expect(body).not.toMatch(rx);
    }
  });

  it('carries what was taken on, with the owner\'s words kept', async () => {
    const p = await company('A real one', 'real');
    const u = nanoid();
    await query(
      `INSERT INTO undertakings
         (id, founder_id, product_id, kind, asked, understood_as, opened_by, opened_from_kind, evidence_mode)
       VALUES (?,?,?,'investigate',?,?,?,'owner','real')`,
      [u, OWNER, p, 'find out why the dependency check keeps failing',
        'Look into why the dependency check keeps failing.', `founder:${OWNER}`]);
    const body = await (await app.request('/foundry/roadmap')).text();
    expect(body).toContain('A real one');
    expect(body).toContain('find out why the dependency check keeps failing');
    expect(body).toContain('nothing spent');
  });

  it('leaves an invented company\'s work out of what it is doing for him', async () => {
    const p = await company('An invented one', 'reference');
    await query(
      `INSERT INTO undertakings
         (id, founder_id, product_id, kind, understood_as, opened_by, opened_from_kind, evidence_mode)
       VALUES (?,?,?,'investigate',?,?,'situation','reference')`,
      [nanoid(), OWNER, p, 'Look into the rehearsal.', 'institution:rehearsal']);
    const body = await (await app.request('/foundry/roadmap')).text();
    expect(body).not.toContain('An invented one');
  });
});

describe('it is one of the places, drawn by the one shell', () => {
  it('renders through page() and owner.css, like everything else', async () => {
    const body = await (await app.request('/foundry/roadmap')).text();
    expect(body).toContain('/static/owner.css');
    expect(body).toContain('data-place="foundry"');
    expect(body).toContain('Foundry</a><i>›</i>');
  });

  it('is reachable from the rail, so it is not a page only a link knows about', () => {
    const shell = readFileSync(resolve(ROOT, 'src/views/owner/shell.ts'), 'utf8');
    expect(shell).toContain('href="/foundry/roadmap"');
  });

  it('adds no seventh door', () => {
    // Nine tabs at 375px is forty pixels a tab, which is not a door. Money and
    // the Roadmap sit in "Also here" with Discover and the Workshop.
    const shell = readFileSync(resolve(ROOT, 'src/views/owner/shell.ts'), 'utf8');
    const doors = [...shell.matchAll(/\$\{door\('([^']+)'/g)].map((m) => m[1]);
    expect(doors).toEqual([
      '/foundry', '/foundry/decisions', '/foundry/experiments',
      '/foundry/inbox', '/foundry/controls', '/foundry/companies',
    ]);
  });
});
