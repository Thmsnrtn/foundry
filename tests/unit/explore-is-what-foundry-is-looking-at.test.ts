process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { absorbGuidance, openMandate, rejectCandidate, type Mandate } from '../../src/services/venture/mandate.js';
import { exploreSummary } from '../../src/services/explore/summary.js';
import { proposeAct, setBoundary } from '../../src/services/institution/standing-intent.js';
import { withViewer, needsYouNow } from '../../src/views/owner/viewer.js';

// =============================================================================
// EXPLORE IS WHAT FOUNDRY IS LOOKING AT (long-horizon directive, 30 September
// 2026; INSTITUTION_MODEL §5.10, §8).
//
// One door answers: what is being looked for, how far each idea got, what is
// in flight, and what was turned down and why. Every number is a count over
// the row that is the fact — reference material is said apart and never
// added in — and another owner's rows are never counted. And the count in
// every header says what needs the owner, or nothing at all, never a zero nobody
// counted.
// =============================================================================

const OWNER = 'f_explore';
const OTHER = 'f_explore_other';
let app: Hono;
let mandate: Mandate;

beforeAll(async () => {
  await runMigrations();
  for (const [id, email] of [[OWNER, 'owner@example.com'], [OTHER, 'x@example.com']]) {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [id, `clk_${id}`, email, 'X']);
  }
  const m = await openMandate({ founderId: OWNER, statement: 'Find a low-maintenance digital product under $100', shape: null });
  if ('refused' in m) throw new Error(m.refused);
  mandate = m;
  await absorbGuidance({ mandateId: m.id, statement: 'No SaaS', kind: 'avoid', subject: 'saas' });
  for (const [id, mode] of [['s1', 'real'], ['s2', 'real'], ['s3', 'reference']] as const) {
    await query(`INSERT INTO opportunity_seeds (id, founder_id, mandate_id, seed, origin, origin_said, evidence_mode)
      VALUES (?,?,?,?,'reasoned','because',?)`, [`seed_${id}`, OWNER, m.id, `idea ${id}`, mode]);
  }
  await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
    VALUES ('opp_x1',?,?,'A pricing template for bakers','bakers','they guess prices','they asked','nobody pays','[]','real')`, [m.id, OWNER]);
  await rejectCandidate({ opportunityId: 'opp_x1', by: 'owner', why: 'too crowded', revisitIf: 'a marketplace opens' });
  await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
    VALUES ('opp_x2',?,?,'A bid checklist for roofers','roofers','bids by hand','people said so','one firm','[]','real')`, [m.id, OWNER]);
  // Another owner's search must never be counted here.
  const theirs = await openMandate({ founderId: OTHER, statement: 'Theirs', shape: null });
  if ('refused' in theirs) throw new Error(theirs.refused);
  await query(`INSERT INTO opportunity_seeds (id, founder_id, mandate_id, seed, origin, origin_said, evidence_mode)
    VALUES ('seed_theirs',?,?,'theirs','reasoned','because','real')`, [OTHER, theirs.id]);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await withViewer(OWNER, next); });
  app.route('/', letterRoutes);
});

describe('the reading', () => {
  it('counts each stage from its own rows, keeps reference material apart, and counts only the owner\'s', async () => {
    const x = await exploreSummary(OWNER);
    const at = Object.fromEntries(x.stages.map((s) => [s.key, s]));
    expect(x.stages.map((st) => st.key)).toEqual(['noticed', 'screened', 'looked_at', 'tested', 'paid', 'became_company']);
    expect(at.noticed).toMatchObject({ n: 2, reference: 1 });
    expect(at.screened).toMatchObject({ n: 0 });
    expect(at.looked_at).toMatchObject({ n: 2, reference: 0 });
    expect(at.tested).toMatchObject({ n: 0 });
    expect(at.paid).toMatchObject({ n: 0 });
    expect(at.became_company).toMatchObject({ n: 0 });
    // Turned down with a condition for another look is parked, not buried.
    expect(x.turnedDown).toMatchObject({ n: 0, parked: 1 });
    expect(x.turnedDown.recent[0]).toMatchObject({ headline: 'A pricing template for bakers', revisitIf: 'a marketplace opens' });
    expect(x.search).toMatchObject({ statement: mandate.statement, avoid: ['No SaaS'] });
    expect(x.work.map((w) => w.key)).toContain(`mandate:${mandate.id}`);
    expect(x.trading.capitalAtRiskCents).toBe(0);
  });

  it('counts a seed decided about as screened, and a test only as paid when the world recorded a payment', async () => {
    await query(`UPDATE opportunity_seeds SET buried_at = datetime('now'), buried_because = 'a capable source said nobody pays' WHERE id = 'seed_s1'`);
    await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
      VALUES ('unk_x2',?,'opp_x2','will anyone pay',1,'offer one')`, [OWNER]);
    for (const e of ['exp_paid', 'exp_unpaid']) {
      await query(`INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
        VALUES (?,?,'opp_x2','unk_x2','sell a checklist','someone pays','nobody pays',0,'real')`, [e, OWNER]);
      await query(`UPDATE venture_experiments SET decision='approved', decided_at=datetime('now'), decided_by='owner' WHERE id=?`, [e]);
      await query(`INSERT INTO experiment_exposures (id, founder_id, experiment_id, provider, exposure_ref, evidence_mode, placed_by)
        VALUES (?,?,?,'stripe',?,'real','test fixture')`, [`x_${e}`, OWNER, e, `plink_${e}`]);
    }
    // A refund or a click is not a payment; only the payment counts.
    await query(`INSERT INTO business_outcome_events (id, founder_id, exposure_id, kind, amount_cents, observed_at, provider, provider_event_ref, evidence_mode)
      VALUES ('boe_1',?,'x_exp_paid','payment',900,datetime('now'),'stripe','pi_1','real')`, [OWNER]);
    const at = Object.fromEntries((await exploreSummary(OWNER)).stages.map((st) => [st.key, st.n]));
    expect(at).toMatchObject({ screened: 1, tested: 2, paid: 1 });
  });

  it('writes nothing', async () => {
    const before = (await query(`SELECT (SELECT COUNT(*) FROM opportunity_seeds) + (SELECT COUNT(*) FROM venture_opportunities) AS n`)).rows[0];
    await exploreSummary(OWNER);
    expect((await query(`SELECT (SELECT COUNT(*) FROM opportunity_seeds) + (SELECT COUNT(*) FROM venture_opportunities) AS n`)).rows[0]).toEqual(before);
  });
});

describe('the page', () => {
  it('says what is looked for, what is kept out, how far each idea got, and why ideas were turned down', async () => {
    const r = await app.request('/foundry/explore');
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('Find a low-maintenance digital product under $100');
    expect(html).toContain('Kept out of the search, because you said so: No SaaS.');
    expect(html).toContain('1 more from reference material, not the real market.');
    expect(html).toContain('A pricing template for bakers');
    expect(html).toContain('Worth another look if a marketplace opens.');
    expect(html).toContain('No capital is at risk');
    expect(html).not.toContain('theirs');
  });

  it('says what the Mandate paused and what it asked Foundry to look harder at', async () => {
    const { readMandate, stateMandate } = await import('../../src/services/mandate/statements.js');
    await stateMandate(OWNER, readMandate('No SaaS for now')!, 'direct');
    await stateMandate(OWNER, readMandate('Focus on digital downloads')!, 'direct');
    await stateMandate(OWNER, readMandate('Keep trading theoretical')!, 'direct');
    const html = await (await app.request('/foundry/explore')).text();
    expect(html).toMatch(/<b>SaaS:<\/b> paused by your Mandate/);
    expect(html).toMatch(/<b>digital downloads:<\/b> looking harder, because you asked/);
    expect(html).toContain('You asked for it to stay theoretical, and it does.');
  });
});

describe('the count in every header', () => {
  it('is nothing outside a request, and the number of things waiting inside one', async () => {
    expect(await needsYouNow()).toBeNull();
    await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_ex','Lamplight',?,'active','active','real')`, [OWNER]);
    await setBoundary({ productId: 'p_ex', subject: 'set_prices', mode: 'ask_first', statement: 'Ask me before changing prices' });
    await proposeAct({ productId: 'p_ex', subject: 'set_prices', actionType: null, params: { price: 49 },
      summary: 'Raise the price to $49', why: 'Buyers asked', expectedEffect: 'More per sale', risk: 'Fewer sales',
      consequence: 'low', proposedBy: 'institution:test' });
    const html = await (await app.request('/foundry/explore')).text();
    expect(html).toMatch(/<a class="needs hot" href="\/foundry\/needs-you" aria-label="1 thing needs you">/);
  });
});
