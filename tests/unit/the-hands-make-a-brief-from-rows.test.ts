process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.OPENROUTER_API_KEY = 'test-key';

import { beforeAll, describe, expect, it, vi } from 'vitest';

// =============================================================================
// THE HANDS MAKE A BRIEF FROM ROWS.
//
// Two real deliverables, both made by a person. The first recipe the hands can
// execute is a brief made of the rows the eyes keep: every item cites the
// retrieval row it came from, the counts are the retrievals' own, and not a
// sentence is composed. The gate reads the text back against the rows and
// refuses an item that cites nothing. The forge shapes the offer — six plain
// sentences, a price — and the hands make the thing, or say why not.
// =============================================================================

const reply = {
  title: 'Remote bid coordinator roles', terms: 'contractor bid tracker', source_types: ['job_posting', 'community'],
  coverage: 'It covers what one public jobs board and one public forum showed on the pull date, and nothing else.',
  price_dollars: 19, price_because: 'a short read that saves an afternoon of searching', product_name: 'Bid Coordinator Roles Brief',
  sells: 'a dated shortlist of public postings and discussions about tracking contractor bids, each with its source',
  claims_made: 'that it is a shortlist of what two public sources showed on the date, not a complete listing; refund on request',
  collects: 'the buyer\'s email for one delivery', delivers_by: 'email, when the payment settles',
  sells_to: 'Small contractors and trade shops that track bids by hand.', charges_how: 'one-time, $19, no subscription',
  lighter: 'a shortlist of public rows is the lightest thing that settles whether anyone pays for the filtering',
  offer_subject: 'A short brief of bid-coordination postings and discussions',
};
vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async () => ({ content: JSON.stringify(reply), tokensUsed: 10, costUsd: 0 })),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');

const OWNER = 'hands_owner';
const X = 'hands_x1';
let mandateId = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_hands', 'owner@example.com', 'Thomas Norton']);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES ('hands_ws','Apex Micro',?,'active','real')", [OWNER]);
  await query(
    `INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement, about)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [OWNER, 'hands_ws', 'Apex Micro', 'Thomas Norton', 'https://apexmicro.example', 'apexmicro.example', 'hello@apexmicro.example', 'A small workshop.', '']);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  mandateId = m.id;
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES ('hands_opp',?,?,'a filtered bid brief for contractors','small contractors','they track bids by hand','people said so','one firm','[]','real')`, [mandateId, OWNER]);
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES ('hands_unk',?,'hands_opp','whether a contractor would pay for a filtered brief',1,'offer one at a fixed price')`, [OWNER]);
  await query(
    `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,'hands_opp','hands_unk','offer one at a fixed price','one pays','nobody pays',1000,'real')`, [X, OWNER]);
  // What the eyes kept: two retrievals for the same words, with items.
  const { recordRetrieval } = await import('../../src/services/venture/sources/index.js');
  await recordRetrieval({
    founderId: OWNER, sourceType: 'job_posting', source: 'https://remotive.com/api/remote-jobs?search=contractor+bid+tracker', terms: 'contractor bid tracker',
    returnedCount: 3, canSee: 'jobs', cannotSee: 'the rest', wouldMostHelp: 'a wider board', notAlsoTried: null, evidenceMode: 'real',
    items: [
      { label: 'Northline Builders: Bid Coordinator', url: 'https://remotive.com/remote-jobs/ops/bid-coordinator-9001', datedAt: '2026-09-10T09:00:00', said: 'Track incoming bids and estimates, maintain the bid tracker.', relevant: true, sharedTerms: ['bid', 'tracker'] },
      { label: 'Vectorish: ML Engineer', url: 'https://remotive.com/remote-jobs/dev/ml-9002', datedAt: '2026-09-11T09:00:00', said: 'Build models.', relevant: false, sharedTerms: [] },
      { label: 'Harbor Homes: Estimator', url: 'https://remotive.com/remote-jobs/ops/estimator-9003', datedAt: '2026-09-12T09:00:00', said: 'Prepare bids and track their outcomes for a residential contractor.', relevant: true, sharedTerms: ['bids'] },
    ],
  });
  await recordRetrieval({
    founderId: OWNER, sourceType: 'community', source: 'https://hn.algolia.com/api/v1/search?query=contractor+bid+tracker', terms: 'contractor bid tracker',
    returnedCount: 1, canSee: 'talk', cannotSee: 'money', wouldMostHelp: 'a person', notAlsoTried: null, evidenceMode: 'real',
    items: [{ label: 'We track every contractor bid in a spreadsheet by hand', url: 'https://news.ycombinator.com/item?id=h1', datedAt: '2026-07-01T00:00:00Z', said: 'We track every contractor bid in a spreadsheet by hand and it costs us a day a week.', relevant: true, sharedTerms: ['contractor', 'bid'] }],
  });
});

describe('a brief made of rows', () => {
  it('cites a retrieval row for every item, counts what the eyes counted, and names nobody', async () => {
    const { rowsForBrief, renderBrief, checkBriefQuality } = await import('../../src/services/venture/products/registry.js');
    const spec = { kind: 'data_brief' as const, title: 'Remote bid coordinator roles', terms: 'contractor bid tracker', sourceTypes: ['job_posting', 'community'], coverage: 'Two public sources on the pull date.', limit: 25 };
    const made = await rowsForBrief(OWNER, spec);
    expect(made.items.map((i) => i.url)).toEqual([
      'https://remotive.com/remote-jobs/ops/estimator-9003', 'https://remotive.com/remote-jobs/ops/bid-coordinator-9001', 'https://news.ycombinator.com/item?id=h1']);
    const body = renderBrief(spec, made, 'Apex Micro');
    expect(body).toContain('job posting returned 3 result(s)');
    expect(body).toContain('of which 2 were about the subject');
    expect(body).toContain('### 1. Harbor Homes: Estimator');
    expect(body).toContain('- **Source:** https://remotive.com/remote-jobs/ops/estimator-9003');
    expect(body).not.toContain('Thomas Norton');
    const q = await checkBriefQuality(OWNER, { id: 'p', kind: 'deliverable', title: spec.title, body, pulledAt: made.pulledAt!.toISOString(), digest: '', paymentLinkUrl: null, recordedAt: '' });
    expect(q).toEqual({ ok: true, failures: [] });
  });

  it('refuses an item that cites nothing the eyes retrieved, a stale pull, and a named person', async () => {
    const { checkBriefQuality } = await import('../../src/services/venture/products/registry.js');
    const body = '# A brief\n\nCoverage is limited to nothing.\n\n### 1. Invented\n- **Source:** https://example.com/made-up\n\nThomas Norton compiled this.';
    const q = await checkBriefQuality(OWNER, { id: 'p', kind: 'deliverable', title: 'A brief', body, pulledAt: new Date(Date.now() - 12 * 86_400_000).toISOString(), digest: '', paymentLinkUrl: null, recordedAt: '' });
    expect(q.ok).toBe(false);
    expect(q.failures.join(' | ')).toMatch(/not a row anything retrieved/);
    expect(q.failures.join(' | ')).toMatch(/pulled 1[12] days ago/);
    expect(q.failures.join(' | ')).toMatch(/a person is named/);
  });
});

describe('the forge shapes the offer and the hands make the thing', () => {
  it('records the offer shape, the brief and the offer text as the hand\'s, and readiness then wants only people and a sender', async () => {
    const { recordDesign } = await import('../../src/services/venture/probe-design.js');
    await recordDesign({
      founderId: OWNER, experimentId: X, decides: 'whether a contractor pays for a filtered brief', decidesBecause: 'only money settles it',
      exchange: 'upfront_price', exchangeBecause: 'the one exchange the Workshop can run', canProve: 'one pays', cannotProve: 'twice',
      ratherThanWaiting: 'reading will not settle it', distribution: 'one message each, as the Workshop', ifItSucceeds: 'a second cohort',
      recommendation: 'run', recommendationBecause: 'cheap and bounded', designedBy: 'test',
      interpretations: [{ observation: 'nobody pays', reading: 'not worth it' }, { observation: 'nobody pays', reading: 'wrong channel' }],
      costs: [{ dimension: 'cash', level: 'low', grounds: 'sending' }, { dimension: 'reputation', level: 'material', grounds: 'strangers' }, { dimension: 'participant_burden', level: 'low', grounds: 'once' }],
      stopConditions: [{ kind: 'complaints', threshold: 2, because: 'a pattern' }, { kind: 'opt_outs', threshold: 3, because: 'enough' }],
    });
    const { shapeAndMake } = await import('../../src/services/venture/products/offer-composition.js');
    const made = await shapeAndMake(X);
    expect('refused' in made ? made.refused : 'made').toBe('made');
    if ('refused' in made) return;
    expect(made.items).toBe(3);
    const { materialOf, offerShapePlanOf, readiness } = await import('../../src/services/venture/hand.js');
    const plan = (await offerShapePlanOf(X))!;
    expect(plan.price.amountCents).toBe(1900);
    expect(plan.facts.recurring_billing.present).toBe(0);
    expect(plan.facts.one_visit_delivery.present).toBe(1);
    const offer = (await materialOf(X, 'offer_template'))!;
    expect(offer.body).toContain("It's $19, one-time. No subscription.");
    expect(offer.body).toContain('[APEX MICRO EXPERIMENT PAGE]');
    expect(offer.body).not.toContain('Thomas Norton');
    expect((await materialOf(X, 'deliverable'))!.body).toContain('### 1. Harbor Homes: Estimator');
    const ready = await readiness(X);
    expect(ready.ok).toBe(false);
    // What is still missing is people to write to and a way to send — never
    // the thing itself, its shape or its offer text.
    expect(ready.missing).toEqual(expect.arrayContaining(['no candidate businesses are loaded', 'email sending is not connected']));
    expect(ready.missing.join(' | ')).not.toMatch(/nothing to deliver|offer text|stated shape|design has not/);
  });

  it('refuses a design whose exchange a brief cannot carry, without making anything', async () => {
    await query(`INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
      VALUES ('hands_x2',?,'hands_opp','hands_unk','give it first','they pay after','nobody pays',0,'real')`, [OWNER]);
    const { recordDesign } = await import('../../src/services/venture/probe-design.js');
    await recordDesign({
      founderId: OWNER, experimentId: 'hands_x2', decides: 'd', decidesBecause: 'b', exchange: 'value_first', exchangeBecause: 'e', canProve: 'c', cannotProve: 'n',
      ratherThanWaiting: 'r', distribution: 'x', ifItSucceeds: 'i', recommendation: 'defer', recommendationBecause: 'w', designedBy: 'test',
    });
    const { shapeAndMake } = await import('../../src/services/venture/products/offer-composition.js');
    const made = await shapeAndMake('hands_x2');
    expect('refused' in made && made.refused).toContain('a brief is sold at a fixed price');
    const { materialOf } = await import('../../src/services/venture/hand.js');
    expect(await materialOf('hands_x2', 'deliverable')).toBeNull();
  });
});
