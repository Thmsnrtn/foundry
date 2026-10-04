process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '9'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.OPENROUTER_API_KEY = 'test-key';

import { beforeAll, describe, expect, it, vi } from 'vitest';

// =============================================================================
// THE WORKSHOP IS THE FIRST VENUE.
//
// Every real test so far reached the world by writing to people the owner
// reviewed one by one. A studio needs a venue where buyers come to the offer:
// the Workshop's own page, with a payment link the hand places, and the
// deliverable sent by email under an act that covers exactly that. Nobody is
// written to. Readiness wants the thing, its words, its page and a way to
// send — never a list of people — and the charter lets the test in.
//
// AND WHAT A BUYER PAYS FOR CAN GO OUT (R20). The delivery gate was
// Experiment 001's: it counted COMMBUYS bid links and refused every brief the
// hands made from what the eyes read, so the first stranger to pay for a test
// launched on its own would have been owed something no pass could send, and
// told nothing. A brief the hands made now passes the hands' own gate — every
// item cites a row this owner's eyes retrieved — at launch, at delivery, on
// the page's readiness and in what the obligation says.
// =============================================================================

const reply = {
  title: 'Remote bid coordinator roles', terms: 'contractor bid tracker', source_types: ['job_posting'],
  coverage: 'One public jobs board on the pull date, nothing else.', price_dollars: 19, price_because: 'a short read',
  product_name: 'Bid Roles Brief', sells: 'a dated shortlist of public postings about tracking contractor bids, each with its source',
  claims_made: 'a shortlist of what one public board showed on the date; refund on request', collects: 'the buyer\'s email for one delivery',
  delivers_by: 'email, when the payment settles', sells_to: 'Small contractors and trade shops.', charges_how: 'one-time, $19, no subscription',
  lighter: 'a shortlist of public rows is the lightest thing that settles it', offer_subject: 'A short brief of bid-coordination postings',
  page: { summary: 'A dated shortlist of public postings about tracking contractor bids.', who: 'Small contractors who track bids by hand.',
    what: 'One brief by email, with a link to every posting.', limits: 'It is a shortlist of one board on one date, not a listing of the market.',
    sources: 'A public remote-jobs board.', note: 'A small pilot from Apex Micro. If it is no use to you, you get your money back.' },
};
vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async () => ({ content: JSON.stringify(reply), tokensUsed: 10, costUsd: 0 })),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');

const OWNER = 'venue_owner';
const WS = 'venue_ws';
const X = 'venue_x1';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_venue', 'owner@example.com', 'Thomas Norton']);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES (?,'Apex Micro',?,'active','real')", [WS, OWNER]);
  await query(
    `INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement, about, postal_address)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [OWNER, WS, 'Apex Micro', 'Thomas Norton', 'https://apexmicro.example', 'apexmicro.example', 'hello@apexmicro.example', 'A small workshop.', '', 'Apex Micro\n11 Example Drive\nMarlborough, MA 01752']);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES ('venue_opp',?,?,'a filtered bid brief for contractors','small contractors','they track bids by hand','people said so','one firm','[]','real')`, [m.id, OWNER]);
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES ('venue_unk',?,'venue_opp','whether a contractor would pay for a filtered brief',1,'offer one at a fixed price')`, [OWNER]);
  await query(
    `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,'venue_opp','venue_unk','offer one at a fixed price on the Workshop page','one pays','nobody pays',1000,'real')`, [X, OWNER]);
  const { recordRetrieval } = await import('../../src/services/venture/sources/index.js');
  await recordRetrieval({
    founderId: OWNER, sourceType: 'job_posting', source: 'https://remotive.com/api/remote-jobs?search=contractor+bid+tracker', terms: 'contractor bid tracker',
    returnedCount: 1, canSee: 'jobs', cannotSee: 'the rest', wouldMostHelp: 'a wider board', notAlsoTried: null, evidenceMode: 'real',
    items: [{ label: 'Northline Builders: Bid Coordinator', url: 'https://remotive.com/remote-jobs/ops/bid-coordinator-9001', datedAt: '2026-09-10T09:00:00', said: 'Track incoming bids.', relevant: true, sharedTerms: ['bid'] }],
  });
  const { recordDesign } = await import('../../src/services/venture/probe-design.js');
  await recordDesign({
    founderId: OWNER, experimentId: X, decides: 'whether a contractor pays for a filtered brief from the page', decidesBecause: 'only money settles it',
    exchange: 'upfront_price', exchangeBecause: 'the one exchange the Workshop can run', canProve: 'one pays', cannotProve: 'twice',
    ratherThanWaiting: 'reading will not settle it', distribution: 'the Workshop\'s own page; nobody is written to', ifItSucceeds: 'a second edition',
    recommendation: 'run', recommendationBecause: 'cheap and bounded', designedBy: 'forge',
    interpretations: [{ observation: 'nobody pays', reading: 'not worth it' }, { observation: 'nobody pays', reading: 'nobody found the page' }],
    costs: [{ dimension: 'cash', level: 'low', grounds: 'a payment link' }, { dimension: 'reputation', level: 'low', grounds: 'a page under the Workshop\'s name' }, { dimension: 'participant_burden', level: 'none', grounds: 'nobody is written to' }],
    stopConditions: [{ kind: 'complaints', threshold: 2, because: 'a pattern' }, { kind: 'refunds', threshold: 3, because: 'enough' }],
  }).catch(async () => {
    // A forge design needs five findings behind it; this fixture is the forge's in name only.
    for (const lens of ['market_reality', 'experimental_design', 'commercial_operations', 'risk_ethics_compliance', 'economics_portfolio']) {
      await query(`INSERT INTO probe_lens_findings (id, experiment_id, founder_id, lens, finding, grounds_json, risk, recommends, because, recorded_by) VALUES (?,?,?,?,'f','["x"]','low','run','b','forge')`, [`venue_${lens}`, X, OWNER, lens]);
    }
    await recordDesign({
      founderId: OWNER, experimentId: X, decides: 'whether a contractor pays for a filtered brief from the page', decidesBecause: 'only money settles it',
      exchange: 'upfront_price', exchangeBecause: 'the one exchange the Workshop can run', canProve: 'one pays', cannotProve: 'twice',
      ratherThanWaiting: 'reading will not settle it', distribution: 'the Workshop\'s own page; nobody is written to', ifItSucceeds: 'a second edition',
      recommendation: 'run', recommendationBecause: 'cheap and bounded', designedBy: 'forge',
      interpretations: [{ observation: 'nobody pays', reading: 'not worth it' }, { observation: 'nobody pays', reading: 'nobody found the page' }],
      costs: [{ dimension: 'cash', level: 'low', grounds: 'a payment link' }, { dimension: 'reputation', level: 'low', grounds: 'a page under the Workshop\'s name' }, { dimension: 'participant_burden', level: 'none', grounds: 'nobody is written to' }],
      stopConditions: [{ kind: 'complaints', threshold: 2, because: 'a pattern' }, { kind: 'refunds', threshold: 3, because: 'enough' }],
    });
  });
});

describe('the Workshop\'s page as the venue', () => {
  it('the hands make the brief and give the test its page; readiness then wants only a way to send', async () => {
    const { shapeAndMake } = await import('../../src/services/venture/products/offer-composition.js');
    const made = await shapeAndMake(X);
    expect('refused' in made ? made.refused : 'made').toBe('made');
    const { publicIdentityOf } = await import('../../src/services/public-workshop/identity.js');
    const id = (await publicIdentityOf(X))!;
    expect(id.slug).toBe('remote-bid-coordinator-roles');
    expect(id.copy.selection).toBe('Nobody was written to about this. You found this page yourself.');
    expect(id.copy.note).not.toContain('Thomas Norton');
    const { offerShapePlanOf, readiness } = await import('../../src/services/venture/hand.js');
    expect((await offerShapePlanOf(X))!.venue).toBe('workshop');
    const before = await readiness(X);
    expect(before.ok).toBe(false);
    expect(before.missing).toEqual(['email sending is not connected']);
    const { setSendingIdentity } = await import('../../src/services/outbound/sending-identity.js');
    await setSendingIdentity({ productId: WS, provider: 'resend', credential: 're_test', fromEmail: 'hello@apexmicro.example', fromName: 'Apex Micro' });
    const after = await readiness(X);
    expect(after).toMatchObject({ ok: true, missing: [], reachable: 0 });
  });

  it('the charter lets it in: a placement, a refund and one delivery act, no campaign, nobody written to, settled by payment', async () => {
    const { signCharter, charterPrincipal, liveCharter } = await import('../../src/services/institution/charter.js');
    await signCharter({ founderId: OWNER, testsTotalCents: 10_000, probesInFlight: 3, cognitionCentsPerDay: 300, days: 30, publicVoice: 'Apex Micro', statement: 'A river of nickels.' });
    const { allowExperiment, campaignActOf } = await import('../../src/services/venture/hand.js');
    const allowed = await allowExperiment({ founderId: OWNER, experimentId: X, under: 'the charter' });
    const charter = (await liveCharter(OWNER))!;
    const acts = (await query('SELECT subject, action_type, decided_by, measurement_critical, summary FROM proposed_acts WHERE experiment_id = ? ORDER BY proposed_at, rowid', [X])).rows;
    expect(acts.map((a) => [a.subject, a.action_type, a.decided_by])).toEqual([
      ['publish', 'stripe_create_payment_link', charterPrincipal(charter.id)],
      ['move_money', 'stripe_create_refund', charterPrincipal(charter.id)],
      ['contact_people', 'send_email', charterPrincipal(charter.id)],
    ]);
    expect(String(acts[2]!.summary)).toContain('nobody else is written to');
    expect(acts.some((a) => String(a.summary).includes('businesses you approved'))).toBe(false);
    expect((await campaignActOf(X))!.id).toBe(allowed.actId);
    const e = (await query('SELECT decision, decided_by, settles_when FROM venture_experiments WHERE id = ?', [X])).rows[0]!;
    expect(e).toMatchObject({ decision: 'approved', decided_by: charterPrincipal(charter.id) });
    const { parseSettlementRule } = await import('../../src/services/venture/outcome.js');
    expect(parseSettlementRule(e.settles_when)).toMatchObject({ event: 'payment', atLeast: 1, withinDays: 30 });
    expect((await query('SELECT sealed_at FROM probe_designs WHERE experiment_id = ?', [X])).rows[0]!.sealed_at).not.toBeNull();
    const carve = (await query('SELECT cents FROM portfolio_envelope_carves WHERE experiment_id = ?', [X])).rows[0]!;
    expect(Number(carve.cents)).toBe(1000);
    // The hand's hourly pass picks it up and says, honestly, what stands between it and the world here.
    const { runHand } = await import('../../src/services/venture/hand.js');
    const reports = await runHand({ founderId: OWNER });
    expect(reports.map((r) => r.experimentId)).toEqual([X]);
    // No payment provider answers from here; the pass says so and sends nothing.
    expect(reports[0]!.exceptions.join(' | ')).toContain('offer not placed: Stripe');
    expect(reports[0]!.offersPlanned).toBe(0);
  });
});

describe('what a buyer pays for can go out (R20)', () => {
  it('the brief the hands made passes the gate delivery runs, and that gate is the hands\' own', async () => {
    const { deliverableGate, materialOf } = await import('../../src/services/venture/hand.js');
    const goods = (await materialOf(X, 'deliverable'))!;
    expect(goods.body).toContain('https://remotive.com/remote-jobs/ops/bid-coordinator-9001');
    expect(await deliverableGate(X, goods, new Date())).toEqual({ ok: true, failures: [] });
    // A citation of something nobody retrieved is refused, so the gate is not a rubber stamp.
    const forged = { ...goods, body: goods.body.replace('https://remotive.com/remote-jobs/ops/bid-coordinator-9001', 'https://example.com/made-up') };
    expect((await deliverableGate(X, forged, new Date())).failures.join(' ')).toMatch(/not a row anything retrieved/);
  });

  it('a buyer who paid is planned a delivery, not refused at the gate', async () => {
    const { campaignActOf, planDelivery } = await import('../../src/services/venture/hand.js');
    // The offer as the hand would have placed it, and a buyer paying at it.
    if (!(await query('SELECT id FROM experiment_exposures WHERE experiment_id = ?', [X])).rows[0]) {
      const productId = String((await query('SELECT id FROM products WHERE from_experiment_id = ?', [X])).rows[0]!.id);
      await query(`INSERT INTO experiment_exposures (id, founder_id, experiment_id, product_id, provider, exposure_ref, evidence_mode, placed_by)
        VALUES ('venue_exposure',?,?,?,'stripe','plink_venue','real','test')`, [OWNER, X, productId]);
    }
    const { intakeStripeSettlement } = await import('../../src/services/venture/settlement-intake.js');
    await intakeStripeSettlement({ id: 'evt_venue_buyer', type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'pi_venue_buyer', object: 'payment_intent', amount_received: 1900, currency: 'usd', latest_charge: 'ch_venue_buyer',
        metadata: { app: 'foundry', experiment_id: X, payment_link: 'plink_venue' } } } });
    const fid = String((await query("SELECT id FROM experiment_fulfilments WHERE payment_ref = 'pi_venue_buyer'", [])).rows[0]!.id);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('/payment_intents/pi_venue_buyer')
      ? new Response(JSON.stringify({ id: 'pi_venue_buyer', receipt_email: 'buyer@trade.example' }), { status: 200 })
      : new Response('{}', { status: 404 })));
    process.env.STRIPE_SECRET_KEY ??= 'sk_test_venue';
    try {
      expect(await campaignActOf(X)).not.toBeNull();
      const plan = await planDelivery({ experimentId: X, fulfilmentId: fid });
      expect(plan.status).toBe('pending_approval');
    } finally { vi.unstubAllGlobals(); }
  });

  it('goods that could not go out keep a test from launching, and an owed buyer is told the real reason', async () => {
    const { deliverableGate, materialOf, recordMaterial } = await import('../../src/services/venture/hand.js');
    const goods = (await materialOf(X, 'deliverable'))!;
    await recordMaterial({ founderId: OWNER, experimentId: X, kind: 'deliverable', title: goods.title,
      body: goods.body.replace('https://remotive.com/remote-jobs/ops/bid-coordinator-9001', 'https://example.com/made-up'), pulledAt: goods.pulledAt ? new Date(goods.pulledAt) : new Date(), by: 'test' });
    const now = (await materialOf(X, 'deliverable'))!;
    expect((await deliverableGate(X, now, new Date())).ok).toBe(false);
    const { readiness } = await import('../../src/services/venture/hand.js');
    expect((await readiness(X)).missing.join(' ')).toMatch(/what a buyer would be sent could not go out: .*not a row anything retrieved/);
    const { obligationsOf } = await import('../../src/services/venture/obligations.js');
    const owed = (await obligationsOf(X)).find((o) => o.paymentRef === 'pi_venue_buyer')!;
    expect(owed.sentence).not.toMatch(/goes out on the next pass/);
    expect(owed.sentence).toMatch(/the delivery is refused: .*not a row anything retrieved/);
    expect(owed.asksHim).toMatch(/This one is yours/);
  });
});
