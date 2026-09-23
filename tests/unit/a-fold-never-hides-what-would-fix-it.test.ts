process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '4'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// A FOLD NEVER HIDES WHAT WOULD FIX IT.
//
// "If you stepped away" was 7,392px — nine phone screens — because all three
// horizons kept all five property readings permanently open, whether or not
// they had anything to report. The question the owner arrives with, how long
// can I be gone before something breaks, was answered fifteen readings deep.
//
// So the answer is a strip of three cells now, and inside each horizon what
// HOLDS is folded. What does not hold is not, and that asymmetry is the whole
// design rather than a detail of it: a failing property carries `wouldFixIt`,
// which is to say an action, and an action he cannot see is an action he does
// not have. Three separate compressions earlier in this campaign kept a
// reading and dropped the sentence that bounded it; this is the gate that
// stops the fourth.
//
// It reads the rendered page, because the thing at risk is where an element
// sits in the document and no other kind of assertion can see that.
// =============================================================================

const OWNER = 'ab_owner';
let body = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_ab', 'owner@example.com', 'Thomas Norton']);
  await query('INSERT INTO products (id,name,owner_id,status,scp_status) VALUES (?,?,?,?,?)',
    ['ab_p', 'Apex Micro', OWNER, 'active', 'active']);
  const { absenceRoutes } = await import('../../src/routes/dashboard/absence-place.js');
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', absenceRoutes);
  const res = await app.request('/foundry/absence');
  expect(res.status).toBe(200);
  body = await res.text();
});

/**
 * The spans of every `<details class="fold">`, counting nested `<details>`
 * properly — each property carries its own evidence disclosure inside, and a
 * naive search for the next closing tag would stop at the wrong one.
 */
function folded(html: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const open of html.matchAll(/<details class="fold"/g)) {
    let depth = 0;
    let i = open.index!;
    while (i < html.length) {
      const nextOpen = html.indexOf('<details', i + 1);
      const nextClose = html.indexOf('</details>', i + 1);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) { depth += 1; i = nextOpen; continue; }
      if (depth === 0) { out.push([open.index!, nextClose + 10]); break; }
      depth -= 1; i = nextClose;
    }
  }
  return out;
}

const inside = (spans: Array<[number, number]>, at: number): boolean =>
  spans.some(([a, b]) => at > a && at < b);

describe('what is wrong stays in front of him', () => {
  it('has something to report, or this file is proving nothing', () => {
    // A page where everything holds would pass every assertion below without
    // exercising one of them. The seeded institution is empty, so properties
    // genuinely do not hold; if that ever stops being true this says so
    // rather than going quietly green.
    expect(body, 'no failing property on the page — the proof has nothing to stand on')
      .toContain('does not hold');
  });

  it('leaves no failing property inside a fold', () => {
    const spans = folded(body);
    expect(spans.length, 'nothing is folded — the compression is gone').toBeGreaterThan(0);
    const hidden = [...body.matchAll(/<span class="state bad">does not hold<\/span>/g)]
      .filter((m) => inside(spans, m.index!));
    expect(hidden.length,
      `${String(hidden.length)} failing properties are behind a disclosure`).toBe(0);
  });

  it('leaves no repair instruction inside a fold', () => {
    const spans = folded(body);
    const hidden = [...body.matchAll(/What would fix it:/g)].filter((m) => inside(spans, m.index!));
    expect(hidden.length, 'a way to fix a failure is one tap away instead of on the page')
      .toBe(0);
  });

  it('answers the question at the top, one cell per horizon, each a door', () => {
    const strip = /<div class="ev-strip">([\s\S]*?)<\/div>\s*<div class="absence-horizons"/
      .exec(body)?.[1] ?? '';
    expect(strip, 'the horizons are not summarised before they are detailed').not.toBe('');
    for (const days of [7, 30, 90]) {
      expect(strip, `${String(days)} days is not in the strip`).toContain(`${String(days)} days`);
      expect(strip, `${String(days)} days has no door to its reading`)
        .toContain(`href="#h${String(days)}"`);
      expect(body, `nothing for #h${String(days)} to land on`).toContain(`id="h${String(days)}"`);
    }
  });
});
