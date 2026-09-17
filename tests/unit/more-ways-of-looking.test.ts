process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '6'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// MORE WAYS OF LOOKING.
//
// Two eyes — a package registry and one forum — and no real candidate ever
// survived, because a candidate takes two genuinely different ways of knowing
// and a registry read fifteen times is one. Six public eyes join them here,
// each supplying a stance the constitution already names, each proven by the
// sense check asking it one dull question, each asked in weeding the question
// it can answer and nothing else.
//
// The reality this proves in miniature: a seed sown from what somebody wrote
// is asked what exists, what people say, what users of what exists say fails,
// what people search for and who is paying somebody for the work; its claims
// gather observations under distinct source types; and the promotion bar,
// which counts stances, is met without anybody telling a story about it.
// =============================================================================

const OWNER = 'eyes_owner';
let mandateId = '';

const APPS = {
  resultCount: 2,
  results: [
    { trackId: 111, trackName: 'Bid Tracker Pro', sellerName: 'Trades Software LLC', trackViewUrl: 'https://apps.apple.com/us/app/bid-tracker-pro/id111',
      description: 'Track every construction bid and estimate in one place. Contractors log bids, due dates and win rates.', price: 4.99,
      averageUserRating: 4.1, userRatingCount: 212, currentVersionReleaseDate: new Date(Date.now() - 40 * 86_400_000).toISOString(), releaseDate: '2021-01-01T00:00:00Z' },
    { trackId: 222, trackName: 'Sunset Photo Filters', sellerName: 'Nice Pixels', trackViewUrl: 'https://apps.apple.com/us/app/sunset/id222',
      description: 'Beautiful filters for your photos.', price: 0, averageUserRating: 4.8, userRatingCount: 9000, currentVersionReleaseDate: '2019-01-01T00:00:00Z', releaseDate: '2018-01-01T00:00:00Z' },
  ],
};
const REVIEWS = { feed: { entry: [
  { id: { label: 'r1' }, title: { label: 'No export' }, content: { label: 'Cannot export the bid log to a spreadsheet, so I still keep the real tracker in Excel by hand.' }, updated: { label: '2026-09-01T10:00:00-07:00' }, 'im:rating': { label: '2' } },
  { id: { label: 'r2' }, title: { label: 'Fine' }, content: { label: 'Does what it says, tracks bids nicely.' }, updated: { label: '2026-08-20T10:00:00-07:00' }, 'im:rating': { label: '5' } },
  { id: { label: 'r3' }, title: { label: 'Loses estimates' }, content: { label: 'Lost three estimates after the update. Back to the spreadsheet for our bids.' }, updated: { label: '2026-08-02T10:00:00-07:00' }, 'im:rating': { label: '1' } },
] } };
const DDG = ['contractor bid tracker', ['contractor bid tracker', 'contractor bid tracker template', 'contractor bid tracker excel', 'contractor bid tracker app free', 'contractor license lookup']];
const JOBS = { 'job-count': 2, jobs: [
  { id: 9001, url: 'https://remotive.com/remote-jobs/ops/bid-coordinator-9001', title: 'Bid Coordinator (Construction)', company_name: 'Northline Builders', category: 'Operations',
    publication_date: '2026-09-10T09:00:00', salary: '$55k - $65k', description: '<p>Track incoming bids and estimates for our contractor teams, maintain the bid tracker, chase due dates.</p>' },
  { id: 9002, url: 'https://remotive.com/remote-jobs/dev/ml-engineer-9002', title: 'ML Engineer', company_name: 'Vectorish', category: 'Software Development', publication_date: '2026-09-11T09:00:00', salary: '', description: '<p>Build models.</p>' },
] };
const ISSUES = { total_count: 1, items: [
  { number: 42, title: 'Bid tracker export loses contractor estimates', body: 'When exporting the bid tracker every estimate over 30 days is dropped; contractors have to redo it by hand.', html_url: 'https://github.com/example/tracker/issues/42', created_at: '2026-08-15T00:00:00Z', comments: 4, reactions: { total_count: 7 } },
] };
const OPENSEARCH = ['contractor bid tracker', ['Bid tracker', 'Bidding'], ['', ''], ['https://en.wikipedia.org/wiki/Bid_tracker', 'https://en.wikipedia.org/wiki/Bidding']];
const PAGEVIEWS = { items: [{ timestamp: '2026060100', views: 1200 }, { timestamp: '2026070100', views: 1350 }, { timestamp: '2026080100', views: 1100 }] };
const NPM_EMPTY = { objects: [{ package: { name: 'logger-lite', version: '1.0.0', date: '2026-08-01', description: 'A tiny logger', links: { npm: 'https://www.npmjs.com/package/logger-lite' } } }], total: 1 };
const HN = { hits: [
  { objectID: 'h1', comment_text: 'We track every contractor bid in a spreadsheet by hand and it costs us a day a week.', created_at: '2026-07-01T00:00:00Z', points: 12 },
], nbHits: 1 };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Every public eye, answering with its recorded shape. */
function theWorld(broken: Set<string> = new Set()): (url: string | URL | Request) => Promise<Response> {
  return async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    const host = new URL(url).host;
    if (broken.has(host)) throw new Error(`${host} did not answer`);
    if (host === 'itunes.apple.com' && url.includes('/search')) return json(APPS);
    if (host === 'itunes.apple.com' && url.includes('customerreviews')) return json(REVIEWS);
    if (host === 'duckduckgo.com') return json(DDG);
    if (host === 'remotive.com') return json(JOBS);
    if (host === 'api.github.com') return json(ISSUES);
    if (host === 'en.wikipedia.org') {
      return url.includes('Spreadsheet') ? json(['Spreadsheet', ['Spreadsheet'], [''], ['https://en.wikipedia.org/wiki/Spreadsheet']]) : json(OPENSEARCH);
    }
    if (host === 'wikimedia.org') return json(PAGEVIEWS);
    if (host === 'registry.npmjs.org') return json(NPM_EMPTY);
    if (host === 'api.npmjs.org') return json({ downloads: 0 });
    if (host === 'hn.algolia.com') return json(HN);
    return json({ error: `nothing recorded for ${host}` }, 404);
  };
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_eyes', 'owner@example.com', 'Owner']);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES ('eyes_co','Apex Micro',?,'active','real')", [OWNER]);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  mandateId = m.id;
});

afterEach(() => { vi.restoreAllMocks(); });

describe('each eye reads the world it was built for', () => {
  it('the App Store says what exists, and its reviews say what fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(theWorld() as never);
    const { whatAppsExist, whatUsersSay } = await import('../../src/services/venture/sources/app-store.js');
    const apps = await whatAppsExist('contractor bid tracker', 5);
    expect(apps.found.map((a) => [a.name, a.relevant, a.maintained])).toEqual([
      ['Bid Tracker Pro', true, true], ['Sunset Photo Filters', false, false]]);
    expect(apps.found[0]).toMatchObject({ rating: 4.1, ratingCount: 212, price: 4.99, url: 'https://apps.apple.com/us/app/bid-tracker-pro/id111' });
    const reviews = await whatUsersSay(111);
    expect(reviews.found.map((r) => r.rating)).toEqual([2, 5, 1]);
    expect(reviews.found[0]!.text).toContain('Excel by hand');
  });

  it('a search box says what people look for and the words they add', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(theWorld() as never);
    const { whatPeopleSearchFor } = await import('../../src/services/venture/sources/search-demand.js');
    const d = await whatPeopleSearchFor('contractor bid tracker');
    expect(d.found.filter((c) => c.relevant)).toHaveLength(4);
    expect(d.wanted.map((w) => w.word)).toEqual(['app', 'excel', 'free', 'template']);
  });

  it('a jobs board says who is paying somebody for the work', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(theWorld() as never);
    const { whoIsHiringFor } = await import('../../src/services/venture/sources/job-postings.js');
    const h = await whoIsHiringFor('contractor bid tracker');
    expect(h.found.filter((p) => p.relevant).map((p) => [p.company, p.salary])).toEqual([['Northline Builders', '$55k - $65k']]);
    expect(h.found[1]).toMatchObject({ relevant: false, salary: null });
  });

  it('an issue tracker reads as a discussion, and an encyclopedia counts by month', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(theWorld() as never);
    const { whatIsReportedBroken } = await import('../../src/services/venture/sources/issue-trackers.js');
    const issues = await whatIsReportedBroken('contractor bid tracker', 5);
    expect(issues.found[0]).toMatchObject({ kind: 'comment', points: 7, url: 'https://github.com/example/tracker/issues/42' });
    const { howOftenLookedUp } = await import('../../src/services/venture/sources/pageviews.js');
    const looked = await howOftenLookedUp('contractor bid tracker', new Date('2026-09-17T00:00:00Z'));
    expect(looked.article).toBe('Bid tracker');
    expect(looked.months).toEqual([{ month: '2026-06', views: 1200 }, { month: '2026-07', views: 1350 }, { month: '2026-08', views: 1100 }]);
    // The window asked for is the last three full months, not whatever today is.
    const asked = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).find((u) => u.includes('wikimedia.org'))!;
    expect(asked).toContain('/monthly/20260601/20260831');
  });
});

describe('the sense check proves each eye by asking it one dull question', () => {
  it('moves every answering eye to available and leaves a silent one declared', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(theWorld(new Set(['remotive.com'])) as never);
    const { checkTheSenses } = await import('../../src/services/institution/sense-check.js');
    const checked = await checkTheSenses();
    const by = Object.fromEntries(checked.map((c) => [c.provider, c]));
    for (const p of ['apple_app_store', 'apple_app_reviews', 'duckduckgo_autocomplete', 'github_issues', 'wikipedia_pageviews', 'hn_algolia', 'npm_registry']) {
      expect(by[p]?.answered, p).toBe(true);
      expect(by[p]?.movedTo, p).toBe('available');
    }
    expect(by.remotive).toMatchObject({ answered: false, movedTo: null, was: 'declared' });
    expect(by.remotive!.because).toContain('did not answer');
    // Proven today, looked through today.
    const { openTheEyesThatAreProven, waysOfLooking } = await import('../../src/services/venture/research-sources.js');
    const opened = await openTheEyesThatAreProven(OWNER);
    expect(opened).toEqual(expect.arrayContaining(['apple_app_store', 'apple_app_reviews', 'duckduckgo_autocomplete', 'github_issues', 'wikipedia_pageviews']));
    expect(opened).not.toContain('remotive');
    const ways = await waysOfLooking(OWNER, 'real');
    expect(new Set(ways.map((w) => w.sourceType))).toEqual(new Set(['community', 'directory', 'app_store', 'review', 'search_evidence', 'public_dataset']));
    // The silent one is asked again next time, and proven when it answers.
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(theWorld() as never);
    const again = await checkTheSenses();
    expect(again.find((c) => c.provider === 'remotive')).toMatchObject({ answered: true, movedTo: 'available' });
  });
});

describe('weeding asks every reachable stance the question it can answer', () => {
  const SEED = 'eyes_seed_1';

  it('gathers independent stances on one seed, and the promotion bar is met by evidence', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(theWorld() as never);
    // A seed sown from what somebody wrote, read as a claim that the work
    // hurts, answerable by reading.
    const { formClaim, observe } = await import('../../src/services/venture/market-evidence.js');
    const said = 'We track every contractor bid in a spreadsheet by hand and it costs us a day a week';
    const wroteId = await formClaim({ founderId: OWNER, evidenceMode: 'real', claim: `somebody wrote: "${said}"` });
    const obsId = await observe({ founderId: OWNER, claimId: wroteId, sourceType: 'community', source: 'https://news.ycombinator.com/item?id=h1',
      saw: said, bearing: 'supports', directness: 'direct', observedAt: new Date('2026-07-01'), evidenceMode: 'real' });
    await query(
      `INSERT INTO observation_interpretations
         (id, founder_id, observation_id, reading, motivated_by, misread_if, hypothesis, hypothesis_kind, who_it_may_be, interpreted_by, evidence_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ['eyes_read_1', OWNER, obsId, 'This may describe a recurring burden of tracking contractor bids by hand.',
        'in a spreadsheet by hand', 'it is one unusual firm rather than common practice',
        'a small bid tracker for contractors might reduce that burden', 'pain_exists', 'small construction contractors', 'sonnet', 'real']);
    await query(
      `INSERT INTO opportunity_seeds
         (id, founder_id, mandate_id, seed, origin, origin_said, origin_observation_id, evidence_mode, interpretation_id, hypothesis_kind, answerable_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [SEED, OWNER, mandateId, 'contractor bid tracker spreadsheet by hand', 'signal', said, obsId, 'real', 'eyes_read_1', 'pain_exists', 'read']);
    await query('UPDATE market_claims SET seed_id = ? WHERE id = ?', [SEED, wroteId]);

    const { whatItWouldTakeToBelieve } = await import('../../src/services/venture/seeds.js');
    expect((await whatItWouldTakeToBelieve(SEED)).enough).toBe(false);

    const { weedOut, promoteWhatEarnedIt } = await import('../../src/services/venture/discovery.js');
    const first = await weedOut({ founderId: OWNER, world: 'real' });
    expect(first.buried).toEqual([]);
    const { whatWasAsked } = await import('../../src/services/venture/falsification.js');
    const askedOnce = await whatWasAsked(SEED);
    // The registry first, as before; then the first two other eyes that could
    // settle "pain exists", in constitutional order of their stances.
    // The App Store is not asked about pain: no bearing row says a substitute
    // can settle it, so the registry of askers never offers it for this seed.
    expect(askedOnce.map((q) => q.stance)).toEqual(['substitute', 'problem_pain', 'satisfaction']);
    expect(askedOnce[1]).toMatchObject({ found: 'found', bearing: 'supports' });
    expect(askedOnce[2]).toMatchObject({ found: 'found', bearing: 'supports' });

    // Later passes ask the next eyes, and never the same question twice.
    const second = await weedOut({ founderId: OWNER, world: 'real' });
    expect(second.buried).toEqual([]);
    const third = await weedOut({ founderId: OWNER, world: 'real' });
    expect(third.buried).toEqual([]);
    const askedThrice = await whatWasAsked(SEED);
    expect(askedThrice.map((q) => q.stance)).toEqual([
      'substitute', 'problem_pain', 'satisfaction',
      'substitute', 'demand_signal', 'procurement_labour',
      'substitute', 'problem_pain']);
    expect(askedThrice.find((q) => q.stance === 'procurement_labour')?.asked).toContain('jobs board');
    expect(askedThrice.filter((q) => q.stance === 'problem_pain').map((q) => q.asked.includes('issue trackers'))).toEqual([false, true]);
    // A fourth pass finds nothing left to ask but the registry's own question.
    const fourth = await weedOut({ founderId: OWNER, world: 'real' });
    expect(fourth.asked).toBe(1);

    // The observations landed under their own source types, whole.
    const types = (await query(
      `SELECT DISTINCT o.source_type FROM market_observations o JOIN market_claims c ON c.id = o.claim_id WHERE c.seed_id = ? ORDER BY 1`, [SEED]))
      .rows.map((r) => String(r.source_type));
    expect(types).toEqual(['community', 'directory', 'job_posting', 'review', 'search_evidence']);
    const kept = (await query(
      `SELECT source_type, relevant_count, returned_count FROM market_retrievals WHERE founder_id = ? ORDER BY source_type`, [OWNER])).rows;
    expect(kept.some((r) => String(r.source_type) === 'review' && Number(r.relevant_count) === 2)).toBe(true);

    // Five genuinely different ways of knowing have said something; the bar
    // was two. Nobody wrote a story: the counts are of rows.
    const believe = await whatItWouldTakeToBelieve(SEED);
    expect(believe.enough).toBe(true);
    expect(believe.have.map((h) => h.stance)).toEqual(expect.arrayContaining(['problem_pain', 'satisfaction', 'demand_signal', 'procurement_labour']));
    const earned = await promoteWhatEarnedIt({ founderId: OWNER, world: 'real' });
    expect(earned.refused).toEqual([]);
    expect(earned.promoted).toHaveLength(1);
    const candidate = (await query('SELECT headline, sources_json, kill_thesis FROM venture_opportunities WHERE id = ?', [earned.promoted[0]!.opportunityId])).rows[0]!;
    expect(String(candidate.headline)).toContain('bid tracker');
    expect(String(candidate.sources_json)).toContain('remotive.com');
    expect(String(candidate.kill_thesis)).toContain('one unusual firm');
  });

  it('an eye that does not answer is said so, and the seed lives', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(theWorld(new Set(['itunes.apple.com'])) as never);
    await query(
      `INSERT INTO opportunity_seeds (id, founder_id, mandate_id, seed, origin, origin_said, evidence_mode, hypothesis_kind, answerable_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      ['eyes_seed_2', OWNER, mandateId, 'contractor estimate template excel', 'reasoned', 'we redo the estimate template every job', 'real', 'gap_exists', 'read']);
    const { weedOut } = await import('../../src/services/venture/discovery.js');
    const pass = await weedOut({ founderId: OWNER, world: 'real', most: 6 });
    const mine = pass.saidNothing.filter((s) => s.seed === 'contractor estimate template excel');
    // A gap thesis is settled by what exists and what fails in it. The registry
    // has already answered for what exists, so the day's questions go to the
    // stances not yet heard: the reviews, which are silent and are said to be.
    expect(mine.some((s) => s.because.includes('apple_app_reviews did not answer'))).toBe(true);
    expect(pass.survived.some((s) => s.seed === 'contractor estimate template excel' && s.nowKnows.startsWith('supported'))).toBe(true);
    expect(pass.buried.map((b) => b.seed)).not.toContain('contractor estimate template excel');
    const buried = (await query('SELECT buried_at FROM opportunity_seeds WHERE id = ?', ['eyes_seed_2'])).rows[0]!;
    expect(buried.buried_at).toBeNull();
  });
});
