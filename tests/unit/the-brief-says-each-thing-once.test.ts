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
    const html = await brief();
    expect(html.replace(/\s+/g, ' ')).toMatch(/to look through|nothing to look through/);
  });
});
