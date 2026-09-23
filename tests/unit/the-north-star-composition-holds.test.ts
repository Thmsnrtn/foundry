process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '4'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// THE NORTH STAR COMPOSITION HOLDS.
//
// The supplied UI handoff is the visual North Star: Home is six instruments and
// a cockpit row with the decision beside cash and activity; Decisions is ranked
// and counted; the live experiment is a hero with a bound, an exposure and a
// thesis; Controls puts the stop first; Ask is an exchange. Each of these is
// easy to regress one commit at a time — a tile dropped here, a section
// reordered there — and none of them is caught by a route returning 200.
//
// So the compositions are held as structure, read from the rendered page:
// which instruments exist and in what order, what sits inside the cockpit
// row, where the stop is. Words are pinned only where the word IS the state.
//
// And what the whole surface refuses: a second stylesheet, an inline <style>
// on an owner page, and navigation meaning encoded as DOM position.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const OWNER = 'ns_owner';
let app: Hono;

const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_ns', 'owner@example.com', 'Thomas Norton']);
  await query('INSERT INTO products (id,name,owner_id,status,scp_status) VALUES (?,?,?,?,?)',
    ['ns_p', 'Private Foundry', OWNER, 'active', 'active']);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', letterRoutes);
});

const read = async (path: string): Promise<string> => {
  const r = await app.request(path);
  expect(r.status, path).toBe(200);
  return r.text();
};
const labels = (html: string, re: RegExp): string[] => [...html.matchAll(re)].map((m) => m[1]!.trim());

describe('Home is the Founder Cockpit', () => {
  it('keeps all six readings, and every one of them a door', async () => {
    // SIX CAPABILITIES, NOT SIX EQUAL CARDS.
    //
    // This pinned six `.tile` elements with marks in a fixed order, which is
    // the composition the owner looked at on his phone and rejected: "The six
    // Brief capabilities must remain available, but they do not necessarily
    // need six equally prominent cards… do not preserve its existing UI
    // components or page composition merely because they already exist."
    //
    // So the requirement is restated as the thing that actually matters. Four
    // of the readings are figures he scans, in a strip; two are sentences that
    // were being truncated inside 86px tiles, and are rows now. What must not
    // change is that all six are on the first screen and all six are doors —
    // and that is what is asserted, against the rendered page, without
    // deciding for the designer which shape each one takes.
    const body = await read('/foundry');
    const head = body.slice(0, body.indexOf('class="cockpit"') + 1 || body.length);
    for (const [reading, where] of [
      ['needs you', '/foundry/decisions'],
      ['yours', '/foundry/money'],
      ['health', '/foundry/controls'],
      ['company', '/foundry/companies'],
      ['autonomy', '/foundry/charter'],
      ['experiment', '/foundry/experiments'],
    ] as Array<[string, string]>) {
      expect(head.toLowerCase(), `${reading} is not on the first screen`)
        .toContain(reading);
      expect(head, `${reading} has no door`).toContain(where.split('/')[2]!);
    }
    // Every reading is reachable, not merely printed: the strip cells and the
    // rows are links, and there are at least as many as there are readings.
    const doors = (head.match(/class="ev-cell" href=|class="ev-item" href=/g) ?? []).length;
    expect(doors, 'a reading he cannot open is a label, not an instrument')
      .toBeGreaterThanOrEqual(6);
  });

  it('puts the decision beside cash movement and live activity, in that order', async () => {
    const body = await read('/foundry');
    const cockpit = /<div class="cockpit">([\s\S]*?)(?:<dl class="nownext|<section class="know|<div class="know|<details class="fold"|<footer>)/.exec(body);
    expect(cockpit, 'the cockpit row exists').not.toBeNull();
    const row = cockpit![1] ?? '';
    const calm = row.indexOf('class="panel calm"');
    const one = row.indexOf('id="the-one-thing"');
    const trend = row.indexOf('class="panel trend"');
    const live = row.indexOf('class="panel live"');
    expect(Math.max(calm, one), 'a decision or the calm state leads the row').toBeGreaterThanOrEqual(0);
    expect(trend).toBeGreaterThan(Math.max(calm, one));
    expect(live).toBeGreaterThan(trend);
  });

  it('draws no chart over no data', async () => {
    const body = await read('/foundry');
    const trend = /<section class="panel trend"[\s\S]*?<\/section>/.exec(body)?.[0] ?? '';
    // The marks are SVGs too; the chart is the one inside `.chart`.
    expect(trend).not.toContain('class="chart"');
    expect(trend).toContain('nothing has moved yet');
  });

  it('says the quiet state as a state, not an empty slot', async () => {
    const body = await read('/foundry');
    expect(body).toContain('class="panel calm"');
    expect(body).toContain('Owner action');
    expect(body).not.toContain('id="the-one-thing"');
  });

  it('keeps the places without a door reachable on a phone, through the More sheet', async () => {
    const body = await read('/foundry');
    const sheet = /<section class="sheet-more" id="more"[\s\S]*?<\/section>/.exec(body)?.[0] ?? '';
    for (const href of ['/foundry/searching', '/foundry/public-workshop', '/foundry/roadmap', '/foundry/absence', '/foundry/charter', '/foundry/decisions', '/foundry/money', '/foundry/activity', '/foundry/controls', '/letter']) {
      expect(sheet).toContain(`href="${href}"`);
    }
  });
});

describe('Decisions is ranked and counted', () => {
  it('counts what needs him and what was handled, and ranks the sections', async () => {
    const body = await read('/foundry/decisions');
    expect(body).toMatch(/Needs you <b>\d+<\/b>/);
    expect(body).toMatch(/Decided <b>\d+<\/b>/);
    expect(body).toContain('id="decided"');
    expect(body).toContain('Already handled');
  });
});

describe('Controls is the owner envelope', () => {
  it('puts Stop everything before every card, and asks before it stops', async () => {
    const body = await read('/foundry/controls');
    const stop = body.indexOf('class="panel stop-all"');
    const grid = body.indexOf('class="ctl-grid"');
    expect(stop).toBeGreaterThan(0);
    expect(grid).toBeGreaterThan(stop);
    expect(body).toMatch(/action="\/autopilot\/panic"[^>]*data-confirm=/);
    for (const card of ['Health', 'What I may do on my own', 'Communication mode', 'Money', 'Owner exclusions']) {
      expect(body, card).toContain(`</i>${card}</h2>`);
    }
  });
});

describe('Ask is an exchange', () => {
  it('shows his words, then the answer from canonical state, then what else it can answer', async () => {
    const body = await read(`/foundry?q=${encodeURIComponent('What happened today?')}`);
    expect(body).toContain('<h1>Ask Foundry</h1>');
    const you = body.indexOf('class="turn you"');
    const foundry = body.indexOf('class="turn foundry"');
    const tries = body.indexOf('class="try-label"');
    expect(you).toBeGreaterThan(0);
    expect(foundry).toBeGreaterThan(you);
    expect(tries).toBeGreaterThan(foundry);
    expect(body).toContain('What happened today?');
  });
});

describe('what the surface refuses', () => {
  const FILES = [...walk(resolve(ROOT, 'src/routes/dashboard')), ...walk(resolve(ROOT, 'src/views'))]
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [f.slice(ROOT.length + 1), readFileSync(f, 'utf8')] as const);

  it('carries no inline <style> on any owner page', () => {
    // Every owner page, the Letter and the settings pages included: none of
    // them carries a <style> any more, so none is exempt.
    const offenders = FILES.filter(([, src]) => /<style>/.test(src)).map(([n]) => n);
    expect(offenders).toEqual([]);
  });

  it('serves one stylesheet and one hashed script', () => {
    const shell = readFileSync(resolve(ROOT, 'src/views/owner/shell.ts'), 'utf8');
    expect((shell.match(/rel="stylesheet"/g) ?? []).length).toBe(1);
    expect((shell.match(/<script>/g) ?? []).length).toBe(1);
    expect(shell).toContain('${raw(OWNER_SURFACE_SCRIPT)}');
  });

  it('links the stylesheet by what it contains, so a deploy is never behind a cache', async () => {
    // The old stylesheet under the new markup, for an hour after a deploy, is
    // the first thing the owner would meet on his phone. The address carries
    // the fingerprint of the bytes, computed from the file that is served.
    const { OWNER_STYLESHEET } = await import('../../src/lib/owner-stylesheet.js');
    const { createHash } = await import('node:crypto');
    const css = readFileSync(resolve(ROOT, 'src/public/owner.css'));
    const v = createHash('sha256').update(css).digest('hex').slice(0, 12);
    expect(OWNER_STYLESHEET).toBe(`/static/owner.css?v=${v}`);
    const body = await read('/foundry');
    expect(body).toContain(`href="/static/owner.css?v=${v}"`);
    // And nothing links it by the bare name, which would be a second address.
    const literal = walk(resolve(ROOT, 'src')).filter((f) => f.endsWith('.ts'))
      .filter((f) => /href="\/static\/owner\.css"/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ROOT.length + 1));
    expect(literal).toEqual([]);
  });

  it('encodes no navigation meaning as DOM position', () => {
    const css = readFileSync(resolve(ROOT, 'src/public/owner.css'), 'utf8');
    expect(css).not.toMatch(/nav\.places[^{]*:nth-(child|of-type)/);
  });
});
