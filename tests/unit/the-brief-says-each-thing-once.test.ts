// =============================================================================
// THE BRIEF SAYS EACH THING ONCE.
//
// The owner's Eventide directive, on the primary screen: "Avoid presenting an
// extensive report on initial entry. Prioritize the one or two matters that
// genuinely require attention." And on density generally: "Default screens
// should prioritize current state, meaningful numbers, important changes, the
// next useful action… Move detailed reasoning, source evidence, institutional
// terminology, technical configuration, and historical context into
// appropriately organized secondary views or expandable sections."
//
// WHAT WAS ACTUALLY WRONG, and it was not length for its own sake. A calm
// Brief said "nothing needs you" THREE TIMES before showing anything: a
// greeting line, a pulse panel, and an owner-action card. Whoever read all
// three knew after the first, and the two he did not need pushed the estate
// below the fold on a phone.
//
// Repetition is the measurable half of that, so it is what this holds. Not a
// height ceiling — the owner was explicit that heights are diagnostic, not
// targets — but the property underneath: one fact, one place.
//
// AND NOTHING WAS DELETED TO GET THERE. The search surface still exists, still
// posts where it posted, and is one tap away. A short screen that lost a
// capability is not a better screen.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'brief@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const F = 'f_brief', P = 'p_brief';
let app: Hono;

const brief = async (): Promise<string> => {
  const res = await app.request('/foundry');
  expect(res.status).toBe(200);
  return res.text();
};

/** How many times a sentence appears in what the owner can actually read. */
const times = (html: string, phrase: string): number =>
  html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').split(phrase).length - 1;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [F, 'c_brief', 'brief@example.com', 'Thomas']);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
    [P, 'Apex Micro', F, 'active']);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder', { id: F, email: 'brief@example.com', name: 'Thomas' }); await next();
  });
  app.route('/', foundryShellRoutes);
});

describe('a calm screen states its calm once', () => {
  it('says whether it has been running in exactly one place', async () => {
    // THE DUPLICATION THIS FILE EXISTS FOR, and the repair for it duplicated
    // it again on the first attempt: hiding the pulse panel only when the
    // pulse was FINE left the one case it was meant to fix — a Foundry that
    // has never completed a pass — rendering in both places, four lines apart.
    const html = await brief();
    expect(times(html, 'has not completed a scheduled pass'),
      'the pulse is stated twice').toBeLessThanOrEqual(1);
  });

  it('answers "does anything need me" once, not once per card', async () => {
    const html = await brief();
    expect(times(html, 'Nothing is waiting on your judgment')).toBeLessThanOrEqual(1);
    expect(times(html, 'None required')).toBeLessThanOrEqual(1);
  });

  it('still tells him the state it stopped repeating', async () => {
    // The point is not to say less. A calm card that dropped the evidence for
    // its own claim would be a quieter screen and a worse one.
    const html = await brief();
    expect(html).toContain('None required');
    expect(html).toContain('has not completed a scheduled pass');
  });
});

describe('what is folded is still there', () => {
  it('keeps the search surface, one tap away', async () => {
    // "Do not remove or hide functioning capabilities merely to reproduce a
    // conceptual navigation mockup." It is a disclosure, not a deletion: the
    // heading, the field and the button are all in the document.
    const html = await brief();
    expect(html).toContain('I am not looking for anything');
    expect(html).toContain('Start looking');
    expect(html).toContain('name="said"');
  });

  it('posts where it always posted', async () => {
    // The form's action is the institution's one door for a sentence. A
    // restyle that quietly re-pointed it would be a capability change wearing
    // a design change's clothes.
    const html = await brief();
    expect(html).toContain('action="/foundry/ask"');
  });

  it('says on the summary what the fold would tell him', async () => {
    // A fold whose label gives no reason to open it is a fold nobody opens.
    //
    // It used to read "nothing to look through" when there was nothing, which
    // is the heading again in different words — and the summary is one row, so
    // the browser clipped it to "nothing to loo…" to make room for the
    // repetition. Said twice and said badly, for the same space. The gist has
    // to earn its row either way: a count when there is something to count,
    // and what opening it is for when there is not.
    //
    // READ THE GIST, NOT THE PAGE. The first form of this assertion searched
    // the whole document for "nothing to look through" and failed on the
    // fold's own body — "I would be starting blind, I have nothing to look
    // through yet" — which is a true sentence that belongs there. A phrase
    // search cannot tell a summary from the prose underneath it, so it reads
    // the one span that is actually the summary.
    const html = await brief();
    const gists = [...html.matchAll(/<span class="gist">([^<]*)<\/span>/g)]
      .map((m) => m[1].replace(/\s+/g, ' ').trim());
    expect(gists.length, 'no fold summary rendered at all').toBeGreaterThan(0);
    expect(gists.some((g) => /^\d+ to look through$|^Start one$/.test(g)),
      `no gist earned its row; got ${JSON.stringify(gists)}`).toBe(true);
    expect(gists, 'a gist restates its own heading instead of adding to it')
      .not.toContain('nothing to look through');
  });

  it('does not restate the glance inside the card that sits under it', async () => {
    // "Health healthy" and "Autonomy asks first" were chips on the calm card
    // and the first two tiles of the glance directly above it. The glance is
    // always rendered and the calm card appears only when it is, so the chips
    // could never be the only place he read them.
    const html = await brief();
    expect(times(html, 'Health healthy'),
      'the calm card restates the health tile').toBe(0);
    expect(times(html, 'Autonomy asks first'),
      'the calm card restates the autonomy tile').toBe(0);
  });

  it('still shows both readings, at the glance, as doors', async () => {
    // Removing two chips must not remove two facts. The tiles carry them with
    // more detail than the chips did, and each is a door the chips were not.
    const html = await brief();
    expect(html).toContain('Healthy');
    expect(html).toContain('Asks first');
    expect(html).toContain('href="/foundry/controls"');
    expect(html).toContain('href="/foundry/charter"');
  });
});
