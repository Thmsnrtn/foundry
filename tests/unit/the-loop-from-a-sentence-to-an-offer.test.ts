process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.OPENROUTER_API_KEY = 'test-key';

import { beforeAll, describe, expect, it, vi } from 'vitest';

// =============================================================================
// THE LOOP FROM A SENTENCE TO AN OFFER, WITH NOBODY'S HAND.
//
// Every earlier proof was hand-carried at some link: a cohort built by a
// person, a design written by a person, a listing placed by a person. This
// runs the studio's own links end to end, in miniature, on rows: something
// somebody wrote → two ways of knowing → a candidate → a test proposed from
// what only reality can settle → five lenses, a design, an adversary, a seal
// inside the charter → a brief made of the eyes' own rows → the Workshop's
// page as the venue → let in as the charter's principal. What it proves is
// the connections. What it cannot prove is a sale: that is reality's.
// =============================================================================

const world = { attackerVerdict: 'run' as const };
const say = (o: unknown) => ({ content: JSON.stringify(o), tokensUsed: 10, costUsd: 0 });
vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async (system: string) => {
    if (system.startsWith('You shape the offer')) {
      return say({ title: 'Bid tracking roles and complaints', terms: 'contractor bid tracker', source_types: ['job_posting', 'community'],
        coverage: 'One public jobs board and one public forum on the pull date.', price_dollars: 19, price_because: 'a short read', product_name: 'Bid Tracking Brief',
        sells: 'a dated shortlist of public postings and discussions about tracking contractor bids, each with its source', claims_made: 'a shortlist, not a listing; refund on request',
        collects: 'an email for one delivery', delivers_by: 'email when the payment settles', sells_to: 'Small contractors who track bids by hand.', charges_how: 'one-time, $19, no subscription',
        lighter: 'nothing lighter settles whether anyone pays for the filtering', offer_subject: 'A short brief on bid tracking',
        page: { summary: 'A dated shortlist about tracking contractor bids.', who: 'Small contractors.', what: 'One brief by email.', limits: 'One board and one forum on one date.', sources: 'A public jobs board and a public forum.', note: 'A small pilot from Apex Micro.' } });
    }
    const lens = /discipline — ([a-z ]+) —/.exec(system)?.[1] ?? 'unknown';
    return say({ finding: `From ${lens}: the record shows people tracking bids by hand and an organisation paying for it.`, grounds: ['https://news.ycombinator.com/item?id=h1'], risk: 'material', recommends: 'run', because: `${lens} sees a bounded test.` });
  }),
  callOpus: vi.fn(async (system: string) => {
    if (system.startsWith('You compose the design')) {
      return say({
        decides: 'Whether a contractor who tracks bids by hand will pay a fixed price for a filtered brief.', decides_because: 'Only money settles it.',
        exchange: 'upfront_price', exchange_because: 'The one exchange the Workshop can run.', can_prove: 'One stranger pays.', cannot_prove: 'Whether they pay twice.',
        rather_than_waiting: 'Reading more would not change the decision.', distribution: 'The Workshop\'s own page; nobody is written to.', if_it_succeeds: 'A second edition.',
        fulfilment_cap: 10, recommendation: 'run', recommendation_because: 'Cheap and bounded.',
        interpretations: [{ observation: 'nobody pays', reading: 'not worth it', distinguished_by: null }, { observation: 'nobody pays', reading: 'nobody found the page', distinguished_by: null }],
        alternatives: [], costs: [{ dimension: 'cash', level: 'low', grounds: 'a link' }, { dimension: 'reputation', level: 'low', grounds: 'a page' }, { dimension: 'participant_burden', level: 'none', grounds: 'nobody is written to' }],
        stop_conditions: [{ kind: 'complaints', threshold: 2, because: 'a pattern' }, { kind: 'refunds', threshold: 3, because: 'enough' }],
      });
    }
    return say({ attacks: [{ claim: 'The page alone may reach nobody.', why: 'No distribution beyond the site is named.', field: null, reads_now: null }], verdict: world.attackerVerdict, because: 'It can run; a null result will need the reading it names.' });
  }),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const OWNER = 'loop_owner';
const WS = 'loop_ws';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_loop', 'owner@example.com', 'Thomas Norton']);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES (?,'Apex Micro',?,'active','real')", [WS, OWNER]);
  await query(
    `INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement, about, postal_address)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [OWNER, WS, 'Apex Micro', 'Thomas Norton', 'https://apexmicro.example', 'apexmicro.example', 'hello@apexmicro.example', 'A small workshop.', '', 'Apex Micro\n11 Example Drive\nMarlborough, MA 01752']);
  const { setSendingIdentity } = await import('../../src/services/outbound/sending-identity.js');
  await setSendingIdentity({ productId: WS, provider: 'resend', credential: 're_test', fromEmail: 'hello@apexmicro.example', fromName: 'Apex Micro' });
  // A buyer who arrives on their own has one way to ask a question, and the
  // institution will not put an offer in front of them until a message sent to
  // that address has actually come back.
  const { theReplyRouteHasBeenProven } = await import('../helpers/world.js');
  await theReplyRouteHasBeenProven(OWNER);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  const { signCharter } = await import('../../src/services/institution/charter.js');
  await signCharter({ founderId: OWNER, testsTotalCents: 10_000, probesInFlight: 3, cognitionCentsPerDay: 300, days: 30, publicVoice: 'Apex Micro', statement: 'A river of nickels.' });

  // WHAT THE EYES KEPT, and what somebody wrote.
  const { recordRetrieval } = await import('../../src/services/venture/sources/index.js');
  const hn = await recordRetrieval({
    founderId: OWNER, sourceType: 'community', source: 'https://hn.algolia.com/api/v1/search?query=contractor+bid+tracker', terms: 'contractor bid tracker',
    returnedCount: 1, canSee: 'talk', cannotSee: 'money', wouldMostHelp: 'a person', notAlsoTried: null, evidenceMode: 'real',
    items: [{ label: 'We track every contractor bid in a spreadsheet by hand', url: 'https://news.ycombinator.com/item?id=h1', datedAt: '2026-07-01T00:00:00Z', said: 'We track every contractor bid in a spreadsheet by hand and it costs us a day a week.', relevant: true, sharedTerms: ['contractor', 'bid'] }],
  });
  const jobs = await recordRetrieval({
    founderId: OWNER, sourceType: 'job_posting', source: 'https://remotive.com/api/remote-jobs?search=contractor+bid+tracker', terms: 'contractor bid tracker',
    returnedCount: 1, canSee: 'jobs', cannotSee: 'the rest', wouldMostHelp: 'a wider board', notAlsoTried: null, evidenceMode: 'real',
    items: [{ label: 'Northline Builders: Bid Coordinator', url: 'https://remotive.com/remote-jobs/ops/bid-coordinator-9001', datedAt: '2026-09-10T09:00:00', said: 'Track incoming bids and estimates, maintain the bid tracker.', relevant: true, sharedTerms: ['bid', 'tracker'] }],
  });
  const { formClaim, observe } = await import('../../src/services/venture/market-evidence.js');
  const said = 'We track every contractor bid in a spreadsheet by hand and it costs us a day a week';
  const wroteId = await formClaim({ founderId: OWNER, evidenceMode: 'real', claim: `somebody wrote: "${said}"` });
  const obsId = await observe({ founderId: OWNER, claimId: wroteId, sourceType: 'community', source: 'https://news.ycombinator.com/item?id=h1', saw: said, bearing: 'supports', directness: 'direct', observedAt: new Date('2026-07-01'), evidenceMode: 'real', retrievalId: hn });
  await query(
    `INSERT INTO observation_interpretations (id, founder_id, observation_id, reading, motivated_by, misread_if, hypothesis, hypothesis_kind, who_it_may_be, interpreted_by, evidence_mode)
     VALUES ('loop_read', ?, ?, 'This may describe a recurring burden of tracking contractor bids by hand.', 'in a spreadsheet by hand', 'it is one unusual firm', 'a small bid tracker brief for contractors might reduce that burden', 'pain_exists', 'small construction contractors', 'sonnet', 'real')`, [OWNER, obsId]);
  await query(
    `INSERT INTO opportunity_seeds (id, founder_id, mandate_id, seed, origin, origin_said, origin_observation_id, evidence_mode, interpretation_id, hypothesis_kind, answerable_by)
     VALUES ('loop_seed', ?, ?, 'contractor bid tracker spreadsheet by hand', 'signal', ?, ?, 'real', 'loop_read', 'pain_exists', 'read')`, [OWNER, m.id, said, obsId]);
  await query('UPDATE market_claims SET seed_id = ? WHERE id = ?', ['loop_seed', wroteId]);
  const paysId = await formClaim({ founderId: OWNER, seedId: 'loop_seed', evidenceMode: 'real', claim: 'an organisation pays somebody to do this work: contractor bid tracker spreadsheet by hand' });
  await observe({ founderId: OWNER, claimId: paysId, sourceType: 'job_posting', source: 'https://remotive.com/api/remote-jobs?search=contractor+bid+tracker', saw: 'Northline Builders is paying a Bid Coordinator to maintain the bid tracker.', bearing: 'supports', directness: 'direct', observedAt: new Date('2026-09-10'), evidenceMode: 'real', retrievalId: jobs });
});

describe('the loop', () => {
  it('runs from what somebody wrote to an offer on the Workshop\'s page, let in under the charter, with nobody\'s hand', async () => {
    // Two ways of knowing: the seed earns candidacy on rows.
    const { promoteWhatEarnedIt } = await import('../../src/services/venture/discovery.js');
    const earned = await promoteWhatEarnedIt({ founderId: OWNER, world: 'real' });
    expect(earned.refused).toEqual([]);
    expect(earned.promoted).toHaveLength(1);
    const candidate = earned.promoted[0]!.opportunityId;
    // The candidate carries the question only reality can settle, with the cheapest thing that would.
    const unknowns = (await query('SELECT question, blocking, cheapest_test FROM market_unknowns WHERE opportunity_id = ? ORDER BY rowid', [candidate])).rows;
    expect(unknowns.some((u) => String(u.question).includes('would pay') && u.cheapest_test !== null)).toBe(true);

    // The forge's daily pass: proposes, designs, seals, makes, lets in.
    const { forgePass } = await import('../../src/services/venture/forge-deliberation.js');
    const pass = await forgePass(OWNER);
    expect(pass.skipped).toBeNull();
    expect(pass.proposed).toBe(1);
    expect(pass.deliberated).toHaveLength(1);
    const d = pass.deliberated[0]!;
    expect(d.outcome).toBe('designed');
    expect(d.design?.designedBy).toBe('forge');
    expect(d.sealed, d.unsealedBecause.join('; ')).toBe(true);
    expect(pass.notAllowed).toEqual([]);
    expect(pass.allowed).toEqual([d.experimentId]);

    // The brief is the eyes' own rows, every item citing its retrieval row.
    const { materialOf, offerShapePlanOf, readiness } = await import('../../src/services/venture/hand.js');
    const brief = (await materialOf(d.experimentId, 'deliverable'))!;
    expect(brief.body).toContain('- **Source:** https://remotive.com/remote-jobs/ops/bid-coordinator-9001');
    expect(brief.body).toContain('- **Source:** https://news.ycombinator.com/item?id=h1');
    expect(brief.body).not.toContain('Thomas Norton');
    expect((await offerShapePlanOf(d.experimentId))!.venue).toBe('workshop');
    expect((await readiness(d.experimentId)).ok).toBe(true);

    // Let in as the charter's principal: the acts, the carve, the seal, the rule.
    const { liveCharter, charterPrincipal, envelopeReading } = await import('../../src/services/institution/charter.js');
    const charter = (await liveCharter(OWNER))!;
    const e = (await query('SELECT decision, decided_by, settles_when FROM venture_experiments WHERE id = ?', [d.experimentId])).rows[0]!;
    expect(e).toMatchObject({ decision: 'approved', decided_by: charterPrincipal(charter.id) });
    expect(String(e.settles_when)).toContain('payment');
    const acts = (await query('SELECT action_type, decided_by FROM proposed_acts WHERE experiment_id = ? ORDER BY proposed_at, rowid', [d.experimentId])).rows;
    expect(acts.map((a) => a.action_type)).toEqual(['stripe_create_payment_link', 'stripe_create_refund', 'send_email']);
    expect(acts.every((a) => a.decided_by === charterPrincipal(charter.id))).toBe(true);
    const envelope = (await envelopeReading(OWNER))!;
    expect(envelope.inFlight).toBe(1);
    expect(envelope.carves[0]).toMatchObject({ experimentId: d.experimentId });
    // And the owner was asked nothing.
    const { waitingOn } = await import('../../src/services/founder/attention.js');
    expect((await waitingOn(OWNER)).filter((i) => i.kind !== 'charter')).toEqual([]);

    // Running the pass again designs nothing new and lets nothing in twice.
    const again = await forgePass(OWNER);
    expect(again.deliberated).toEqual([]);
    expect(again.allowed).toEqual([]);
  });
});
