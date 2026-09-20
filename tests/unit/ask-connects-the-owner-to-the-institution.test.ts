process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.APP_URL = 'http://localhost:8080';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// ASK CONNECTS THE OWNER TO THE INSTITUTION.
//
// The owner opened the deployed product, found the box the Ask button goes to,
// and typed a direction: find and investigate low-maintenance digital income
// opportunities, explore economic forms, evaluate evidence, reject weak
// candidates, develop justified experiments within his authority. Foundry
// answered "I don't know yet."
//
// The box was a GET to the question path, which classifies with a question
// regex and nothing else: it matched "reject" and read the sentence as "what
// did I turn down?", then fell to the fallback. The door that hears initiation
// and steering sat behind a different form he never saw, and would have read
// the same sentence as a mandate. Two entrances, one deaf.
//
// Every sentence now goes through the door first, from the box he actually
// used. This file walks his exact sentence from that box to the row it must
// create, and then the other kinds of thing he can say. Every case asserts a
// canonical state — a row, or the absence of one — never only a page that
// sounds right.
// =============================================================================

const OWNER = 'ak_owner';
const SAID = 'Find and investigate low-maintenance digital income opportunities, explore different economic forms, evaluate evidence, reject weak candidates, and develop justified experiments within my authority and spending limits.';
let app: Hono;

const form = (body: Record<string, string>) => ({
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body).toString(),
});
/** Exactly what the composer on every page submits. */
const ask = (said: string, scope = '') => app.request('/foundry/ask', form(scope ? { said, scope } : { said }));
const confirm = (said: string) => app.request('/foundry/venture/confirm', form({ said }));
const page = async (path: string) => (await app.request(path)).text();
const openSearch = async () => (await query(`SELECT id, statement FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL`, [OWNER])).rows as unknown as Array<Record<string, unknown>>;
const guidance = async () => (await query(
  `SELECT g.kind, g.subject, g.statement FROM venture_guidance g JOIN venture_mandates m ON m.id = g.mandate_id
    WHERE m.founder_id = ? AND m.closed_at IS NULL AND g.superseded_by IS NULL ORDER BY g.rowid`, [OWNER])).rows as unknown as Array<Record<string, unknown>>;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_ak', 'owner@example.com', 'Thomas']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES ('ak_f','Foundry',?,'active',50)`, [OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry','ak_f','test')`, []);
  // The economic loop has run, so the pulse reads as working rather than
  // "not yet" — this file is about Ask, not about a fresh install.
  const { recordJobSuccess, ECONOMIC_LOOPS } = await import('../../src/services/institution/loop-health.js');
  for (const j of ECONOMIC_LOOPS) await recordJobSuccess(j);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Thomas', preferences: {} } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

describe('the box he used', () => {
  it('posts every sentence through the door, on every page', async () => {
    const home = await page('/foundry');
    expect(home).toContain('<form class="ask" id="ask-foundry" method="POST" action="/foundry/ask">');
    expect(home).toContain('name="said"');
    expect(home).not.toContain('method="GET" action="/foundry"');
  });

  it('no page ships its own development notes', async () => {
    // Prose in an HTML comment goes to the phone on every request, and it is
    // read by tests and search engines as page text: one such comment carried
    // "I don't know yet" on every page after the sentence itself was gone.
    // Comments in the templates are TypeScript comments now, and stay so.
    for (const path of ['/foundry', '/foundry/searching', '/foundry/experiments', '/foundry/money', '/foundry/inbox', '/foundry/activity', '/foundry/controls', '/foundry/absence', '/foundry/decisions', '/foundry/charter']) {
      const t = await page(path);
      expect(t, path).not.toContain('<!' + '--'); // spelled apart, so the comment gate does not read it as one
      expect(t, path).not.toContain('$' + '{/*'); // spelled apart, so the comment gate does not read it as one
    }
  });
});

describe('the exact instruction he gave', () => {
  it('is heard as a direction and shown back before it binds — never "I don\'t know yet"', async () => {
    const r = await ask(SAID);
    expect(r.status).toBe(200);
    const t = await r.text();
    expect(t).not.toContain("I don't know yet");
    expect(t).toContain('Go and look?');
    expect(t).toContain(SAID);
    expect(t).toContain('Every morning');
    expect(t).toContain('Nothing is sealed, sent or spent without authority');
    // Shown back, not bound: no search exists until he says yes.
    expect(await openSearch()).toEqual([]);
  });

  it('and saying yes is a real institutional state change', async () => {
    const r = await confirm(SAID);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toContain('done=looking');
    const open = await openSearch();
    expect(open).toHaveLength(1);
    expect(String(open[0]!.statement)).toContain('low-maintenance digital income opportunities');
    // The search is the work: the daily discovery pass iterates exactly this row.
    const due = (await query(`SELECT id FROM venture_mandates WHERE closed_at IS NULL`, [])).rows;
    expect(due).toHaveLength(1);
    // And the constraint he put inside the direction is held against every
    // candidate, as a preference on the record — not left on the statement.
    expect((await guidance()).map((g) => [String(g.kind), String(g.subject)]))
      .toContainEqual(['prefer', 'almost no support burden']);
  });

  it('he can see it on Home, and coming back later it is still there', async () => {
    const home = await page('/foundry?done=looking');
    expect(home).toContain('What I am looking for');
    expect(home).toContain('low-maintenance digital income opportunities');
    // A day later, from a cold open, the same.
    const later = await page('/foundry');
    expect(later).toContain('What I am looking for');
    expect(later).toContain('low-maintenance digital income opportunities');
    // And on the search's own place, with what it is held to.
    const discover = await page('/foundry/searching');
    expect(discover).toContain('low-maintenance digital income opportunities');
  });

  it('the old question entrance no longer answers an instruction as a question either', async () => {
    const t = await page(`/foundry?q=${encodeURIComponent(SAID)}`);
    expect(t).not.toContain("I don't know yet");
    expect(t).not.toContain('What did I turn down');
    // One search is running, so the same direction is steering, shown back first.
    expect(t).toMatch(/Hold the search to this\?|Go and look\?|Point the search, or start this one\?/);
  });
});

// What the direction above left on the record (the constraint inside it),
// held so that the cases below can prove they add exactly their own rows.
let steeringBefore: Record<string, unknown>[] = [];

describe('the other things he can say, from the same box', () => {
  it('a factual question is answered from state and creates nothing', async () => {
    const before = (await openSearch()).length;
    steeringBefore = await guidance();
    const r = await ask('What is Foundry doing?');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toContain('/foundry?q=');
    const t = await page(String(r.headers.get('location')));
    expect(t).toContain('Foundry is working');
    expect((await openSearch()).length).toBe(before);
    expect(await guidance()).toEqual(steeringBefore);
  });

  it('a question typed inside a company keeps its scope', async () => {
    const r = await ask('How is it doing?', 'company:ak_f');
    expect(r.headers.get('location')).toContain('scope=company%3Aak_f');
  });

  it('steering an open search is applied through the durable owner-intent machinery, one row per thing', async () => {
    const r = await ask('Focus more on APIs and calculators.');
    expect(r.status).toBe(200);
    const t = await r.text();
    expect(t).toContain('Hold the search to this?');
    expect(await guidance()).toEqual(steeringBefore);
    await confirm('Focus more on APIs and calculators.');
    const g = (await guidance()).slice(steeringBefore.length);
    expect(g.map((x) => [String(x.kind), String(x.subject)])).toEqual([['favour', 'APIs'], ['favour', 'calculators']]);
    // Visible where the search is read back, in his words (the reader keeps
    // the sentence and normalises its joins).
    expect(await page('/foundry/searching')).toContain('Focus more on APIs');
  });

  it('asking for something already underway points the running search rather than opening a second', async () => {
    const r = await confirm('Explore API opportunities');
    expect(r.headers.get('location')).toContain('pointedsearch');
    expect(await openSearch()).toHaveLength(1);
    expect((await guidance()).some((x) => String(x.statement) === 'Explore API opportunities')).toBe(true);
  });

  it('an ambiguous instruction comes back with his words kept and what can be heard, and changes nothing', async () => {
    const before = await guidance();
    const t = await (await ask('Do the thing.')).text();
    expect(t).toContain('I did not follow that');
    expect(t).toContain('Do the thing.');
    expect(t).toContain('What I can act on');
    expect(await guidance()).toEqual(before);
    expect(await openSearch()).toHaveLength(1);
  });

  it('work outside current authority is answered with the boundary and what moves it, not a fallback', async () => {
    const t = await (await ask('Email every millwork shop in Massachusetts today.')).text();
    expect(t).toContain('I do not write to anyone on a sentence');
    expect(t).toContain('only inside a test');
    expect(t).toContain('/foundry/charter');
    expect(t).not.toContain("I don't know yet");
    expect(t).not.toContain('What happened today');
    expect((await query(`SELECT COUNT(*) AS n FROM outbound_actions`, [])).rows[0]).toMatchObject({ n: 0 });
    const spend = await (await ask('Spend $500 on ads for the brief.')).text();
    expect(spend).toContain('I do not spend on a sentence');
  });

  it('asking Foundry to stop a direction closes the search, and the record stays', async () => {
    const t = await (await ask('Stop looking for anything.')).text();
    expect(t).toContain('Stop looking?');
    await confirm('Stop looking for anything.');
    expect(await openSearch()).toEqual([]);
    const closed = (await query(`SELECT statement FROM venture_mandates WHERE founder_id = ? AND closed_at IS NOT NULL`, [OWNER])).rows;
    expect(closed).toHaveLength(1);
    // And Home offers to start again from what it learned, rather than from nothing.
    expect(await page('/foundry?done=searchstopped')).toContain('Stopped looking');
  });

  it('a direction with no search open opens one — he never has to find the Experiments screen first', async () => {
    // What the morning sense check leaves behind in production: public sources
    // proven to answer. Witnessed, because maturity cannot be written directly.
    const { recordMaturity } = await import('../../src/services/institution/capabilities.js');
    const proven = (await query(`SELECT id FROM capability_providers WHERE supplies_source_type IS NOT NULL AND maturity = 'declared' LIMIT 2`, [])).rows as unknown as Array<{ id: string }>;
    expect(proven.length).toBeGreaterThan(0);
    for (const { id } of proven) {
      await recordMaturity({ providerId: id, to: 'available', evidenceMode: 'real', witnessedBy: 'test', evidence: 'answered the sense check' });
    }
    // Before anything opens: nothing to look through, honestly.
    const { waysOfLooking } = await import('../../src/services/venture/research-sources.js');
    expect(await waysOfLooking(OWNER, 'real')).toHaveLength(0);

    await confirm('Find low-maintenance digital income.');
    const open = await openSearch();
    expect(open).toHaveLength(1);
    expect(String(open[0]!.statement)).toBe('Find low-maintenance digital income.');

    // THE SEARCH CAN LOOK FROM THE MOMENT IT OPENS. The proven eyes used to be
    // opened for him only by the next morning's sense check, so his fresh
    // direction read "Blocked: nowhere to look" on Home for the rest of the day.
    expect((await waysOfLooking(OWNER, 'real')).length).toBe(proven.length);
    const home = await page('/foundry');
    expect(home).not.toContain('nowhere to look');
    expect(home).toContain('What I am looking for');
    // And a constraint said inside the direction reads back as what it means,
    // not as the direction repeated beneath itself.
    const searching = await page('/foundry/searching');
    expect(searching).toContain('I will weight the search toward almost no support burden');
    expect(searching.split('Find low-maintenance digital income.').length - 1).toBeLessThanOrEqual(2); // the statement, and "you said" once
  });
});
