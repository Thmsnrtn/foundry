// =============================================================================
// A LESSON KNOWS WHICH LATER DESIGNS READ IT.
//
// Integrated plan §7: "A lesson keeps its source, context, contrary evidence,
// expiry or invalidator, and past decisions that used it." Lessons already
// carried their source (the settled test) and their invalidator (the test's
// own outcome: invalid, superseded, retired). What nothing kept was the other
// direction — which later designs had the lesson in front of them. So a lesson
// that turned out wrong could not say what it had already influenced.
//
// Each design now records which tests' lessons its record carried, and a
// test's page says which later designs read it.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(63) + '1';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'lr@example.com';
process.env.OPENROUTER_API_KEY = 'test-key';

import { beforeAll, describe, expect, it, vi } from 'vitest';

let down = false;
const say = (o: unknown) => ({ content: JSON.stringify(o), tokensUsed: 10, costUsd: 0 });
const unavailable = (): never => { throw new Error('the model provider did not answer (503)'); };

vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callHaiku: vi.fn(async () => unavailable()),
  callSonnet: vi.fn(async () => (down ? unavailable() : say({
    finding: 'People write that they track contractor bids by hand.',
    grounds: ['https://news.ycombinator.com/item?id=d1'], risk: 'material', recommends: 'run', because: 'a small real test',
  }))),
  callOpus: vi.fn(async (system: string) => {
    if (down) return unavailable();
    if (system.startsWith('You compose the design')) {
      return say({
        decides: 'Whether a contractor who tracks bids by hand will pay for a filtered brief.',
        decides_because: 'Only money settles it.', exchange: 'upfront_price', exchange_because: 'The one exchange available.',
        can_prove: 'That one stranger pays.', cannot_prove: 'Whether they would pay twice.',
        rather_than_waiting: 'Reading more would not change the decision.', distribution: 'The Workshop page; nobody is written to.',
        if_it_succeeds: 'A second edition.', fulfilment_cap: 10, recommendation: 'run', recommendation_because: 'Cheap and bounded.',
        interpretations: [
          { observation: 'nobody pays', reading: 'not worth it', distinguished_by: null },
          { observation: 'nobody pays', reading: 'nobody found the page', distinguished_by: null },
        ],
        alternatives: [],
        costs: [
          { dimension: 'cash', level: 'low', grounds: 'a payment link' },
          { dimension: 'reputation', level: 'low', grounds: 'a page' },
          { dimension: 'participant_burden', level: 'none', grounds: 'nobody is written to' },
        ],
        stop_conditions: [{ kind: 'complaints', threshold: 2, because: 'a pattern' }, { kind: 'opt_outs', threshold: 3, because: 'enough' }],
      });
    }
    return say({ attacks: [], verdict: 'run', because: 'It can run.' });
  }),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');

const OWNER = 'lr_owner';
const LESSON = 'lr_lesson';
const NEW = 'lr_new';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_lr', 'lr@example.com', 'Owner']);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES ('lr_co','Apex Micro',?,'active','real')", [OWNER]);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES ('lr_opp',?,?,'a filtered bid brief for contractors','small contractors','they track bids by hand','people said so','one firm','[]','real')`, [m.id, OWNER]);
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES ('lr_unk',?,'lr_opp','whether a contractor would pay for a filtered brief',1,'offer one at a fixed price')`, [OWNER]);
  // An earlier test the owner approved: its lesson is what the new design reads.
  // Proposed, then approved: a test cannot arrive already decided.
  await query(
    `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,'lr_opp','lr_unk','offer the brief to ten contractors by email','one pays','nobody pays',500,'real')`, [LESSON, OWNER]);
  await query(`UPDATE venture_experiments SET decision = 'approved', decided_at = datetime('now'), decided_by = ? WHERE id = ?`,
    [`founder:${OWNER}`, LESSON]);
  await query(
    `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,'lr_opp','lr_unk','offer one at a fixed price','one pays','nobody pays',1000,'real')`, [NEW, OWNER]);
  const { formClaim, observe } = await import('../../src/services/venture/market-evidence.js');
  const claim = await formClaim({ founderId: OWNER, claim: 'contractors track bids by hand', opportunityId: 'lr_opp', evidenceMode: 'real' });
  await observe({ founderId: OWNER, claimId: claim, sourceType: 'community', source: 'https://news.ycombinator.com/item?id=l1',
    saw: 'Three of us track contractor bids by hand in a spreadsheet.', bearing: 'supports', directness: 'direct',
    observedAt: new Date(), evidenceMode: 'real' });
});

describe('a design records the lessons in front of it', () => {
  it('writes which tests\' lessons the design read, and never itself', async () => {
    const { deliberate } = await import('../../src/services/venture/forge-deliberation.js');
    const d = await deliberate(NEW);
    expect(d.outcome, JSON.stringify(d)).toBe('designed');
    const { readByLaterDesigns } = await import('../../src/services/venture/forge.js');
    const readers = await readByLaterDesigns(LESSON);
    expect(readers.map((r) => r.experimentId)).toEqual([NEW]);
    expect(await readByLaterDesigns(NEW)).toEqual([]);
  });

  it('keeps it as recorded: nothing rewrites which lessons a design read', async () => {
    await expect(query(`UPDATE lessons_read SET lesson_experiment_id = 'x' WHERE design_experiment_id = ?`, [NEW]))
      .rejects.toThrow(/read_is_read/);
  });

  it('says on the earlier test\'s page which later design read it', async () => {
    const { Hono } = await import('hono');
    const { experimentRoutes } = await import('../../src/routes/dashboard/experiments-place.js');
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'lr@example.com' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
    app.route('/', experimentRoutes);
    const text = (await (await app.request(`https://f.test/foundry/experiments/${LESSON}`)).text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toMatch(/Read by 1 later design/);
    expect(text).toMatch(/offer one at a fixed price/);
  });
});

describe('when a lesson turns out not to hold, the designs that read it say so', () => {
  const page = async (id: string) => {
    const { Hono } = await import('hono');
    const { experimentRoutes } = await import('../../src/routes/dashboard/experiments-place.js');
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'lr@example.com' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
    app.route('/', experimentRoutes);
    return (await (await app.request(`https://f.test/foundry/experiments/${id}`)).text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  };

  it('says nothing while the lesson stands', async () => {
    const { lessonsThatChanged } = await import('../../src/services/venture/forge.js');
    expect(await lessonsThatChanged(NEW)).toEqual([]);
    expect(await page(NEW)).not.toMatch(/has since/);
  });

  it('names the lesson, and what happened to it, once its test is invalidated', async () => {
    await new Promise((r) => setTimeout(r, 1100));
    await query(`UPDATE venture_experiments SET validity = 'invalid', invalid_because = 'instrumentation_defect',
      invalidated_by = 'the record', invalidated_at = datetime('now') WHERE id = ?`, [LESSON]);
    const { lessonsThatChanged } = await import('../../src/services/venture/forge.js');
    const changed = await lessonsThatChanged(NEW);
    expect(changed.map((c) => c.experimentId)).toEqual([LESSON]);
    expect(changed[0].what).toMatch(/invalid/);
    const text = await page(NEW);
    expect(text).toMatch(/This design read a lesson that has since changed/);
    expect(text).toMatch(/offer the brief to ten contractors by email/);
  });
});

