// =============================================================================
// LAW (Roadmap 2027 R28): WEEK TWO OF A BRIEF IS ASKED OF THE WORLD AGAIN.
//
// A weekly brief is sold as a new edition each week, and nothing asked its
// question twice: the steward re-read rows something else had happened to
// pull, discovery never asks the same words again, and so readiness refused
// every weekly brief ("week two would repeat week one"). Now the steward puts
// the sealed words again to the very sources they were first put to, at most
// once in six days and only where that source's terms of use are written down,
// keeps what came back as a retrieval with nothing inferred from it, and makes
// the next edition from it through the same gate. A weekly brief is refused
// only when none of its sources can be asked again.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '9'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.OPENROUTER_API_KEY = 'test-key';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const reply = {
  title: 'Remote bid coordinator roles', terms: 'contractor bid tracker', source_types: ['directory', 'community'],
  coverage: 'It covers what one public jobs board and one public forum showed on the pull date, and nothing else.',
  price_dollars: 19, price_because: 'a short read that saves an afternoon of searching', product_name: 'Bid Coordinator Roles Brief',
  sells: 'a dated shortlist of public postings and discussions about tracking contractor bids, each with its source',
  claims_made: 'that it is a shortlist of what two public sources showed on the date, not a complete listing; refund on request',
  collects: 'the buyer\'s email for one delivery', delivers_by: 'email, when the payment settles',
  sells_to: 'Small contractors and trade shops that track bids by hand.', charges_how: 'one-time, $19, no subscription',
  lighter: 'a shortlist of public rows is the lightest thing that settles whether anyone pays for the filtering',
  offer_subject: 'A short brief of bid-coordination postings and discussions',
  page: { summary: 'A dated shortlist of public postings about tracking contractor bids.', who: 'Small contractors who track bids by hand.',
    what: 'One brief by email, with a link to every posting.', limits: 'A shortlist of one board on one date, not a listing of the market.',
    sources: 'A public remote-jobs board.', note: 'A small pilot from Apex Micro. If it is no use to you, you get your money back.' },
};
vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async () => ({ content: JSON.stringify(reply), tokensUsed: 10, costUsd: 0 })),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');

const OWNER = 'week_owner';
const X = 'week_x1';
let mandateId = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_week', 'owner@example.com', 'Thomas Norton']);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES ('week_ws','Apex Micro',?,'active','real')", [OWNER]);
  await query(
    `INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement, about)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [OWNER, 'week_ws', 'Apex Micro', 'Thomas Norton', 'https://apexmicro.example', 'apexmicro.example', 'hello@apexmicro.example', 'A small workshop.', '']);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  mandateId = m.id;
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES ('week_opp',?,?,'a filtered bid brief for contractors','small contractors','they track bids by hand','people said so','one firm','[]','real')`, [mandateId, OWNER]);
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES ('week_unk',?,'week_opp','whether a contractor would pay for a filtered brief',1,'offer one at a fixed price')`, [OWNER]);
  await query(
    `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,'week_opp','week_unk','offer one at a fixed price','one pays','nobody pays',1000,'real')`, [X, OWNER]);
  // What the eyes kept: two retrievals for the same words, with items.
  const { recordRetrieval } = await import('../../src/services/venture/sources/index.js');
  await recordRetrieval({
    founderId: OWNER, sourceType: 'directory', source: 'https://api.github.com/search/repositories?q=contractor+bid+tracker', terms: 'contractor bid tracker',
    returnedCount: 3, canSee: 'jobs', cannotSee: 'the rest', wouldMostHelp: 'a wider board', notAlsoTried: null, evidenceMode: 'real',
    items: [
      { label: 'Northline Builders: Bid Coordinator', url: 'https://github.com/northline/bid-coordinator', datedAt: '2026-09-10T09:00:00', said: 'Track incoming bids and estimates, maintain the bid tracker.', relevant: true, sharedTerms: ['bid', 'tracker'] },
      { label: 'Vectorish: ML Engineer', url: 'https://github.com/vectorish/ml', datedAt: '2026-09-11T09:00:00', said: 'Build models.', relevant: false, sharedTerms: [] },
      { label: 'Harbor Homes: Estimator', url: 'https://github.com/harbor-homes/estimator', datedAt: '2026-09-12T09:00:00', said: 'Prepare bids and track their outcomes for a residential contractor.', relevant: true, sharedTerms: ['bids'] },
    ],
  });
  await recordRetrieval({
    founderId: OWNER, sourceType: 'community', source: 'https://hn.algolia.com/api/v1/search?query=contractor+bid+tracker', terms: 'contractor bid tracker',
    returnedCount: 1, canSee: 'talk', cannotSee: 'money', wouldMostHelp: 'a person', notAlsoTried: null, evidenceMode: 'real',
    items: [{ label: 'We track every contractor bid in a spreadsheet by hand', url: 'https://news.ycombinator.com/item?id=h1', datedAt: '2026-07-01T00:00:00Z', said: 'We track every contractor bid in a spreadsheet by hand and it costs us a day a week.', relevant: true, sharedTerms: ['contractor', 'bid'] }],
  });
});


const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
let asked: string[] = [];
/** The world, a week on: the discussion archive has one new thread on the subject. */
function aWeekOn(url: string | URL | Request): Promise<Response> {
  const u = String(url instanceof Request ? url.url : url);
  asked.push(new URL(u).host);
  if (new URL(u).host === 'hn.algolia.com') {
    return Promise.resolve(json({ nbHits: 1, hits: [{ objectID: 'w2', comment_text: 'Our contractor bid tracker spreadsheet broke again this week; we lost two bids.', created_at: new Date().toISOString() }] }));
  }
  return Promise.reject(new Error(`nothing recorded for ${new URL(u).host}`));
}
afterEach(() => { vi.restoreAllMocks(); });

const observations = async () => Number(((await query('SELECT COUNT(*) AS n FROM market_observations WHERE founder_id = ?', [OWNER])).rows[0] as Record<string, unknown>).n);

describe('the sealed words, asked again', () => {
  it('not within six days of the last time they were asked', async () => {
    const { rePullSealedQuery } = await import('../../src/services/venture/sources/re-pull.js');
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(aWeekOn as never);
    const r = await rePullSealedQuery({ founderId: OWNER, terms: 'contractor bid tracker', sourceTypes: ['community'] });
    expect(r.asked).toEqual([]);
    expect(r.notAsked.join(' ')).toMatch(/community \(hn\.algolia\.com\): asked 0 days ago; at most once in 6/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('never of a source whose terms are not written down', async () => {
    const { rePullSealedQuery } = await import('../../src/services/venture/sources/re-pull.js');
    const r = await rePullSealedQuery({ founderId: OWNER, terms: 'contractor bid tracker', sourceTypes: ['directory'], now: new Date(Date.now() + 7 * 86_400_000) });
    expect(r.asked).toEqual([]);
    expect(r.notAsked.join(' ')).toMatch(/directory \(api\.github\.com\): no terms of use are written down for it/);
  });

  it('a week on, the steward asks again, keeps what came back as a retrieval and nothing more, and makes the next edition', async () => {
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
    const { materialOf } = await import('../../src/services/venture/hand.js');
    const first = (await materialOf(X, 'deliverable'))!;
    const seen = await observations();
    asked = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(aWeekOn as never);
    const { refreshStaleBriefs } = await import('../../src/services/venture/products/registry.js');
    const later = new Date(Date.now() + 6.5 * 86_400_000);
    const r = await refreshStaleBriefs(later);
    expect(r).toEqual([{ experimentId: X, refreshed: true, because: expect.stringContaining('re-pulled') }]);
    expect(asked).toEqual(['hn.algolia.com']);
    const second = (await materialOf(X, 'deliverable'))!;
    expect(second.id).not.toBe(first.id);
    expect(second.body).toContain('https://news.ycombinator.com/item?id=w2');
    expect(second.body).not.toContain('lost two bids');
    expect(await observations()).toBe(seen);
    // Asked once; the same pass an hour later asks nothing.
    asked = [];
    await refreshStaleBriefs(new Date(later.getTime() + 3_600_000));
    expect(asked).toEqual([]);
  });
});

describe('a weekly brief is refused only when none of its sources can be asked again', () => {
  const weekly = { price: { recurring: { interval: 'week' } } } as never;
  it('a brief whose discussion source can be asked again may be sold weekly', async () => {
    const { recurringCannotBeMade } = await import('../../src/services/venture/hand.js');
    expect(await recurringCannotBeMade(X, weekly)).toBeNull();
  });
  it('one whose only source has no written terms may not, and says why', async () => {
    const { whyItCannotBeAskedAgain } = await import('../../src/services/venture/sources/re-pull.js');
    expect(await whyItCannotBeAskedAgain(OWNER, 'contractor bid tracker', ['directory'])).toMatch(/directory has no terms of use written down for its source/);
    expect(await whyItCannotBeAskedAgain(OWNER, 'words nobody asked', ['community'])).toMatch(/community was never asked these words/);
  });
  it('the steward also keeps a still-subscribed brief\'s next edition ready', async () => {
    const { readFileSync } = await import('fs');
    expect(readFileSync('src/services/venture/products/registry.ts', 'utf8')).toMatch(/OR EXISTS \(SELECT 1 FROM experiment_fulfilments f\s+WHERE f\.experiment_id = e\.id AND \$\{STILL_RECURS\('f'\)\}\)/);
  });
});
