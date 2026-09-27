// =============================================================================
// REHEARSAL B: THE MODEL PROVIDER IS UNAVAILABLE.
//
// Integrated plan §9 names three degraded conditions to rehearse. Etsy
// unreadable is `an-unreadable-venue-is-not-a-quiet-one`; the owner away while
// a buyer waits is `the-owner-away-while-a-buyer-waits`. This is the third.
//
// Every call to a model fails. What has to hold:
//   · nothing is designed, sealed or let in on a partial or absent review —
//     no half-deliberation survives as a design;
//   · the loop that does that work reports itself failing, so the Brief does
//     not call the day healthy;
//   · everything that never needed a model carries on: a listing with a sale
//     settles by its sealed rule, and a buyer waiting on the owner is still
//     named to him;
//   · when the model answers again, the same pass designs the test and the
//     loop reports itself well.
//
// Workshop mail read while the model is down is marked `unreachable` and
// handed to the owner — proved in `the-workshop-answers-for-itself`.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'down@example.com';
process.env.OPENROUTER_API_KEY = 'test-key';

import { beforeAll, describe, expect, it, vi } from 'vitest';

let down = true;
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

const OWNER = 'down_owner';
const X = 'down_x';
const SELLER = 'down_seller';
let LX = '';

/** The scheduler's own contract (src/index.ts): a job that throws is recorded failing. */
async function runLikeTheScheduler(name: string): Promise<void> {
  const { JOB_REGISTRY } = await import('../../src/jobs/index.js');
  const { recordJobFailure, recordJobSuccess } = await import('../../src/services/institution/loop-health.js');
  try { await JOB_REGISTRY[name].fn(); await recordJobSuccess(name); } catch (err) { await recordJobFailure(name, err); }
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_down', 'down@example.com', 'Owner']);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES ('down_co','Apex Micro',?,'active','real')", [OWNER]);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES ('down_opp',?,?,'a filtered bid brief for contractors','small contractors','they track bids by hand','people said so','one firm','[]','real')`, [m.id, OWNER]);
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES ('down_unk',?,'down_opp','whether a contractor would pay for a filtered brief',1,'offer one at a fixed price')`, [OWNER]);
  await query(
    `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,'down_opp','down_unk','offer one at a fixed price','one pays','nobody pays',1000,'real')`, [X, OWNER]);
  const { formClaim, observe } = await import('../../src/services/venture/market-evidence.js');
  const claim = await formClaim({ founderId: OWNER, claim: 'contractors track bids by hand', opportunityId: 'down_opp', evidenceMode: 'real' });
  await observe({ founderId: OWNER, claimId: claim, sourceType: 'community', source: 'https://news.ycombinator.com/item?id=d1',
    saw: 'Three of us track contractor bids by hand in a spreadsheet.', bearing: 'supports', directness: 'direct',
    observedAt: new Date(), evidenceMode: 'real' });

  // A second owner whose listing sold, and whose buyer then asked for a refund.
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [SELLER, 'clerk_seller', 'seller@example.com', 'Seller']);
  const { approveListing, recordListing, recordVenueOrder, requestVenueRefund, seedProof2 } = await import('../../src/services/venture/proof-2.js');
  LX = (await seedProof2(SELLER)).experimentId;
  await approveListing({ founderId: SELLER, experimentId: LX });
  await recordListing({ founderId: SELLER, experimentId: LX, url: 'https://www.etsy.com/listing/9988776658/workbook' });
  await new Promise((r) => setTimeout(r, 1100));
  await recordVenueOrder({ founderId: SELLER, experimentId: LX,
    order: { orderRef: '7000000001', paidAt: new Date().toISOString(), grossCents: 1400, feeCents: 158 } });
  await requestVenueRefund({ founderId: SELLER, experimentId: LX, orderRef: '7000000001' });
});

const designs = async (): Promise<number> => Number(((await query(
  'SELECT COUNT(*) AS n FROM probe_designs WHERE experiment_id = ?', [X])).rows[0] as Record<string, unknown>).n);

describe('while the model is down', () => {
  it('designs, seals and lets in nothing, and leaves no half-deliberation behind', async () => {
    const { deliberate } = await import('../../src/services/venture/forge-deliberation.js');
    await expect(deliberate(X)).rejects.toThrow(/did not answer/);
    expect(await designs()).toBe(0);
    expect(Number(((await query('SELECT COUNT(*) AS n FROM probe_lens_findings WHERE experiment_id = ?', [X]))
      .rows[0] as Record<string, unknown>).n)).toBe(0);
    const e = (await query('SELECT decision FROM venture_experiments WHERE id = ?', [X])).rows[0] as Record<string, unknown>;
    expect(e.decision).toBeNull();
  });

  it('reports the loop that does that work as failing, so the Brief is not healthy', async () => {
    await runLikeTheScheduler('forge_tick');
    await runLikeTheScheduler('forge_tick');
    const { healthOf } = await import('../../src/services/founder/health.js');
    const h = await healthOf(OWNER);
    expect(h.state).not.toBe('healthy');
    expect(h.failed.join('\n')).toMatch(/designing and attacking tests.*failed 2 times running/);
  });

  it('settles a listing with a sale by its sealed rule, which never needed a model', async () => {
    const { settleListings } = await import('../../src/services/venture/proof-2.js');
    const [r] = await settleListings({ founderId: SELLER, now: new Date(Date.now() + 10 * 60_000) });
    expect(r.settled).toBe('as_predicted');
  });

  it('still names the buyer who is waiting on the owner', async () => {
    const { buyersWaitingOnHim } = await import('../../src/services/venture/obligations.js');
    const waiting = await buyersWaitingOnHim(SELLER);
    expect(waiting).toHaveLength(1);
    expect(waiting[0].sentence).toMatch(/7000000001/);
  });
});

describe('when the model answers again', () => {
  it('designs the test on the next pass, and the loop reports itself well', async () => {
    down = false;
    await runLikeTheScheduler('forge_tick');
    expect(await designs()).toBe(1);
    const { healthOf } = await import('../../src/services/founder/health.js');
    expect((await healthOf(OWNER)).failed.join('\n')).not.toMatch(/designing and attacking tests/);
  });
});
