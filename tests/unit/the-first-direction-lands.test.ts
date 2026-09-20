// =============================================================================
// THE FIRST DIRECTION LANDS, AND THE ANSWERS AGREE WITH THE RECORD.
//
// Three reviewers who had not seen the code drove the product as the owner on
// a phone (scripts/owner-review-harness.mts, 20 September). What they found,
// each now a proof from the real entrance:
//
//   - a direction given while a search was running was silently folded into
//     it as a preference — his first real direction, absorbed into the search
//     Experiment 001 had already answered;
//   - "avoid anything that needs customer support" fell through to "which
//     company do you mean" (he owns none);
//   - "what can you spend?" was answered from code-change consents and said
//     "I cannot contact anyone" after 21 businesses had been written to;
//   - "why did the test fail?" and "is Foundry healthy?" were "I don't know yet";
//   - the week-away letter said nothing left the building and nothing changed;
//   - a settled test's allowance stayed standing; "Last healthy: not recorded"
//     sat beside "Healthy".
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

const OWNER = 'fd_owner';
let app: Hono;
const form = (body: Record<string, string>) => ({
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body).toString(),
});
const ask = (said: string) => app.request('/foundry/ask', form({ said }));
const confirm = (said: string, mode?: string) => app.request('/foundry/venture/confirm', form(mode ? { said, mode } : { said }));
const page = async (path: string) => (await app.request(path)).text();
const answer = async (q: string) => {
  const r = await ask(q);
  expect(r.status, q).toBe(302);
  return page(String(r.headers.get('location')));
};
const openSearch = async () => (await query(`SELECT id, statement FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL`, [OWNER])).rows as unknown as Array<Record<string, unknown>>;
const guidance = async () => (await query(
  `SELECT g.kind, g.subject, g.statement FROM venture_guidance g JOIN venture_mandates m ON m.id = g.mandate_id
    WHERE m.founder_id = ? AND m.closed_at IS NULL AND g.superseded_by IS NULL ORDER BY g.rowid`, [OWNER])).rows as unknown as Array<Record<string, unknown>>;

let experimentId = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_fd', 'owner@example.com', 'Thomas']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES ('fd_f','Foundry',?,'active',50)`, [OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry','fd_f','test')`, []);
  const { recordJobSuccess, INSTITUTION_LOOPS } = await import('../../src/services/institution/loop-health.js');
  for (const j of Object.keys(INSTITUTION_LOOPS)) await recordJobSuccess(j);
  // Experiment 001's shape: its search open, its test approved and settled by
  // the world — surprised. Plus one approved test with a budget, to settle here.
  const { seedProof1 } = await import('../../src/services/venture/proof-1.js');
  const seeded = await seedProof1(OWNER);
  const { designExperiment, decideExperiment, recordResult } = await import('../../src/services/venture/validation.js');
  const base = (await query('SELECT opportunity_id, unknown_id FROM venture_experiments WHERE id = ?', [seeded.experimentId])).rows[0] as Record<string, unknown>;
  experimentId = await designExperiment({
    founderId: OWNER, opportunityId: String(base.opportunity_id), unknownId: String(base.unknown_id),
    whatWeDo: 'offering the brief to twenty more shops', whatWeExpect: 'at least one pays', wouldDisprove: 'nobody pays',
    costCents: 2500, evidenceMode: 'real' });
  await decideExperiment({ experimentId, decision: 'approved', by: `founder:${OWNER}`, via: 'its own authorisation' });
  await decideExperiment({ experimentId: seeded.experimentId, decision: 'approved', by: `founder:${OWNER}`, via: 'its own authorisation' });
  await new Promise((r) => { setTimeout(r, 1100); });
  await recordResult({ experimentId: seeded.experimentId, asPredicted: false,
    whatHappened: '21 businesses were written to, 19 were delivered, and none bought within the seven days the test allowed.' });

  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Thomas', preferences: {} } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
  const { placeRoutes } = await import('../../src/routes/dashboard/places.js');
  app.route('/', placeRoutes as never);
  const { workshopRoutes } = await import('../../src/routes/dashboard/workshop-place.js');
  app.route('/', workshopRoutes as never);
  const { establishPublicWorkshop } = await import('../../src/services/public-workshop/settings.js');
  await establishPublicWorkshop({ founderId: OWNER });
  const { activityRoutes } = await import('../../src/routes/dashboard/activity-place.js');
  app.route('/', activityRoutes as never);
});

describe('a direction while a search is running', () => {
  const said = 'Find and investigate low-maintenance digital income opportunities, explore different economic forms, evaluate evidence, reject weak candidates, and develop justified experiments within my authority and spending limits.';

  it('names the running search and offers the choice — never silently absorbs the direction', async () => {
    expect(await openSearch()).toHaveLength(1);
    const r = await ask(said);
    expect(r.status).toBe(200);
    const t = await r.text();
    expect(t).toContain('Point the search, or start this one?');
    expect(t).toContain('A search is already running');
    expect(t).toContain('Close that search and look for this');
    expect(t).toContain('Keep that search, pointed this way');
    expect(await openSearch()).toHaveLength(1); // nothing bound yet
  });

  it('closing it and starting this is one real transaction, with the old search kept on the record', async () => {
    const before = (await openSearch())[0]!;
    const r = await confirm(said, 'replace');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toContain('done=replacedsearch');
    const open = await openSearch();
    expect(open).toHaveLength(1);
    expect(open[0]!.id).not.toBe(before.id);
    // The reader keeps his sentence and normalises its joins.
    expect(String(open[0]!.statement)).toContain('low-maintenance digital income opportunities');
    const closed = (await query(`SELECT closed_reason FROM venture_mandates WHERE id = ?`, [before.id])).rows[0] as Record<string, unknown>;
    expect(String(closed.closed_reason)).toContain('the owner gave a new direction');
    // The constraint inside the direction is steering on the new search.
    expect((await guidance()).map((g) => [String(g.kind), String(g.subject)])).toContainEqual(['prefer', 'almost no support burden']);
    // And it reads back where he looks.
    expect(await page(String(r.headers.get('location')))).toContain('Looking for that instead');
    const searching = await page('/foundry/searching');
    expect(searching).toContain('low-maintenance digital income opportunities');
    expect(searching).toContain(String(before.statement)); // the earlier search, under its history
  });
});

describe('steering in his own words', () => {
  it('"avoid anything that needs customer support" is heard as the support-burden preference, not "which company"', async () => {
    const r = await ask('Avoid anything that needs customer support.');
    const t = await r.text();
    expect(t).toContain('Hold the search to this?');
    expect(t).not.toContain('which company');
    await confirm('Avoid anything that needs customer support.');
    expect((await guidance()).map((g) => [String(g.kind), String(g.subject)])).toContainEqual(['prefer', 'almost no support burden']);
  });

  it('"stay away from marketplaces" and "I don\'t want subscriptions" are avoidances in his words', async () => {
    await confirm('Stay away from marketplaces.');
    await confirm("I don't want subscriptions.");
    const g = (await guidance()).map((x) => [String(x.kind), String(x.subject)]);
    expect(g).toContainEqual(['avoid', 'marketplaces']);
    expect(g).toContainEqual(['avoid', 'subscription']);
  });
});

describe('the answers agree with the record', () => {
  it('"what can you spend" reads the charter and the tests, not the code-change consents', async () => {
    const t = await answer('What are you allowed to spend?');
    expect(t).toContain('No charter is signed');
    expect(t).toMatch(/approved at \$\d+\.\d\d in all; \d+ messages? sent to people/);
    expect(t).not.toContain('I cannot\n        change anything, spend anything, or contact anyone');
  });

  it('"why did the test fail" is answered from the settled test: prediction, outcome, limit, and what changes', async () => {
    const t = await answer('Why did the millwork test fail?');
    expect(t).toContain('It did not hold.');
    expect(t).toContain('What I predicted');
    expect(t).toContain('21 businesses were written to');
    expect(t).toContain('did not sell. Not that the category is worthless');
    expect(t).not.toContain("I don't know yet");
  });

  it('"is Foundry healthy" is about the institution, not a company', async () => {
    const t = await answer('Is Foundry healthy right now?');
    expect(t).toContain('Foundry is');
    expect(t).not.toContain('which company');
    expect(t).not.toContain("I don't know yet");
  });

  it('a healthy estate has a last-healthy date', async () => {
    const { healthOf } = await import('../../src/services/founder/health.js');
    const h = await healthOf(OWNER);
    expect(h.state).toBe('ok');
    expect(h.lastHealthy).not.toBeNull();
    expect(await page('/foundry/activity')).not.toContain('not recorded');
  });

  it('the week-away letter carries the venture: the search that opened, the steering, the test that settled', async () => {
    const { whileYouWereAway } = await import('../../src/services/founder/a-week-away.js');
    const letter = await whileYouWereAway(OWNER, 7);
    expect(letter.changed.some((c) => c.startsWith('a search opened:'))).toBe(true);
    expect(letter.changed.some((c) => c.includes('you steered the search'))).toBe(true);
    expect(letter.learned.some((l) => l.includes('did not hold'))).toBe(true);
  });
});

describe('a budget ends with its answer', () => {
  it('the allowance granted with an approved test is withdrawn when the test settles', async () => {
    const standing = async () => (await query(
      `SELECT a.id, a.withdrawn_at FROM owner_allowances a JOIN products p ON p.id = a.product_id
        WHERE p.from_experiment_id = ?`, [experimentId])).rows as unknown as Array<Record<string, unknown>>;
    const before = await standing();
    expect(before).toHaveLength(1);
    expect(before[0]!.withdrawn_at).toBeNull();
    const { recordResult } = await import('../../src/services/venture/validation.js');
    await recordResult({ experimentId, asPredicted: false, whatHappened: 'nobody paid' });
    const after = await standing();
    expect(after[0]!.withdrawn_at).not.toBeNull();
  });
});

describe('holding sending without cancelling the search', () => {
  const said = "Hold off sending anything to anyone for now, but don't cancel the search — keep looking.";

  it('is not heard as "stop looking" — a negated stop is not a stop', async () => {
    const { readVentureSentence } = await import('../../src/services/venture/mandate.js');
    expect(readVentureSentence(said).kind).not.toBe('stop_mandate');
    expect(readVentureSentence("Don't stop the search.").kind).not.toBe('stop_mandate');
    expect(readVentureSentence('Stop looking.').kind).toBe('stop_mandate');
  });

  it('is offered as the one act that does it, and saying yes pauses new economic activity on the Workshop', async () => {
    const r = await ask(said);
    expect(r.status).toBe(200);
    const t = await r.text();
    expect(t).toContain('Hold all sending?');
    expect(t).toContain('action="/foundry/public-workshop/pause"');
    expect(t).not.toContain('which company');
    expect(t).not.toContain('Stop looking?');
    const before = await openSearch();
    const yes = await app.request('/foundry/public-workshop/pause', form({ reason: said }));
    expect(yes.status).toBe(302);
    const { publicWorkshopOf } = await import('../../src/services/public-workshop/settings.js');
    const w = await publicWorkshopOf(OWNER);
    expect(w?.economicPause?.reason).toBe(said);
    // The search was not cancelled.
    expect(await openSearch()).toEqual(before);
    // And the hold is visible from the box: "are you allowed to contact anyone?"
    const a = await answer('Are you allowed to contact anyone right now?');
    expect(a).toContain('Sending is on hold');
    // Asking again says it is already held, rather than offering it twice.
    expect(await (await ask('Pause all outreach.')).text()).toContain('Sending is already on hold');
  });
});

describe('the Decisions tile', () => {
  it('never points at an anchor that is not on the page', async () => {
    const home = await page('/foundry');
    if (home.includes('href="#the-one-thing"')) expect(home).toContain('id="the-one-thing"');
  });
});
