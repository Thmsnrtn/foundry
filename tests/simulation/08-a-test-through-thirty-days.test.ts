// =============================================================================
// A TEST THROUGH THIRTY DAYS — AND WHAT THE OWNER READS AT EACH RETURN.
//
// The owner allows a test on day 1 and comes back on days 2, 3, 8, 10, 25, 30
// and 41. Between his visits the routines run against stubbed providers: the
// hand writes, receipts arrive, nobody buys, the window closes, the sealed
// rule settles the test, the budget ends with the answer, the lesson reaches
// the next design, and the asset retires when the grace runs out. At each
// return the pages he opens and the letter he asks for have to agree with
// the rows. Nothing here is market evidence: the providers are in memory.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
process.env.CLOUDFLARE_API_TOKEN = 'cfat_test_token';
process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_test';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { query } from '../../src/db/client.js';
import { providerStubs } from '../helpers/provider-stubs.js';
import { OWNER, advanceDays, asText, owner, ownerApp, routinesRanThisMorning, runMorning, seedProductionShape } from '../helpers/world.js';

const { state, fetch: fetchStub } = providerStubs();
vi.stubGlobal('fetch', fetchStub);
const say = (o: unknown) => ({ content: JSON.stringify(o), tokensUsed: 1, costUsd: 0 });
vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async () => say({ abstain: 'nothing to read' })),
  callOpus: vi.fn(async () => say({ abstain: 'nothing to read' })),
}));
afterAll(() => { vi.unstubAllGlobals(); });

// The Workshop republishes what changed before the hand writes: in production the
// publication tick runs at :40 and the hand at :20 the next hour, so a page
// that is stale the moment a test is allowed is fresh within the hour.
const HANDS = ['public_workshop_tick', 'experiment_hand_tick', 'business_outcome_tick'] as const;
let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
let X = '';
let productId = '';
const one = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows[0] as Record<string, unknown>;
const morning = async () => { const r = await runMorning(HANDS); await routinesRanThisMorning(); return r; };
const money = async () => (await import('../../src/services/founder/experiment-view.js')).moneyOfExperiment(X);

beforeAll(async () => {
  ({ experimentId: X } = await seedProductionShape({ unsettled: true, undecided: true }));
  app = await ownerApp();
  me = owner(app);
  // The Workshop's domain is verified at the provider; every approved business
  // has its recorded reason for being in the population; a charter of one
  // week stands (it will expire while the test runs).
  state.domains.push({ id: 'dom_w', name: 'apexmicro.ai', status: 'verified', records: [] });
  const { qualifyRecipient, recipientsOf } = await import('../../src/services/venture/hand.js');
  for (const r of (await recipientsOf(X)).filter((x) => x.reviewStatus === 'approved')) {
    await qualifyRecipient({ founderId: OWNER, experimentId: X, recipientId: r.id,
      because: 'listed as a Massachusetts millwork or casework contractor on the state register', source: 'https://www.commbuys.com/bso/' });
  }
  // The Workshop stands on the edge (stubbed): a page store, a worker, a zone.
  const { standUpWorkshop } = await import('../../src/services/public-workshop/infrastructure.js');
  await standUpWorkshop(OWNER, fetchStub as unknown as typeof fetch);
  const { signCharter } = await import('../../src/services/institution/charter.js');
  await signCharter({ founderId: OWNER, testsTotalCents: 10000, probesInFlight: 3, cognitionCentsPerDay: 300, days: 7,
    publicVoice: 'Apex Micro', statement: 'A river of nickels.' });
});

describe('day 1 — he allows the test', () => {
  it('one act: the test is approved, its acts stand, its budget is set aside', async () => {
    const { allowExperiment } = await import('../../src/services/venture/hand.js');
    await allowExperiment({ founderId: OWNER, experimentId: X });
    const e = await one('SELECT decision FROM venture_experiments WHERE id = ?', [X]);
    expect(String(e.decision)).toBe('approved');
    productId = String((await one('SELECT id FROM products WHERE from_experiment_id = ?', [X])).id);
    const a = await one('SELECT amount_cents, withdrawn_at FROM owner_allowances WHERE product_id = ?', [productId]);
    expect(Number(a.amount_cents)).toBe(10000);
    expect(a.withdrawn_at).toBeNull();
    expect((await money()).word).toBe('authorised');
    expect(asText(await me.page('/foundry'))).toContain('set aside for tests, nothing paid yet');
  });
});

describe('day 2 — the hand writes', () => {
  it('the first stage is sent through the provider and the offer is placed; the page says Running', async () => {
    await advanceDays(1);
    const ran = await morning();
    expect(ran.filter((r) => !r.ok).map((r) => `${r.job}: ${r.error ?? ''}`)).toEqual([]);
    expect(state.sends.length).toBeGreaterThan(0);
    const { exposureOf } = await import('../../src/services/venture/outcome.js');
    expect(await exposureOf(X)).not.toBeNull();
    const { getExperimentView } = await import('../../src/services/founder/experiment-view.js');
    expect((await getExperimentView(OWNER, X))?.state).toBe('running');
    expect(asText(await me.page('/foundry/experiments'))).toContain('Running');
  });
});

describe('day 3 — receipts arrive', () => {
  it('delivered receipts become offer_delivered events; nobody buys', async () => {
    for (const s of state.sends) state.deliveryState.set(s.id, 'delivered');
    await advanceDays(1);
    await morning();
    const { exposureOf, whatTheWorldSaid } = await import('../../src/services/venture/outcome.js');
    const x = (await exposureOf(X))!;
    const said = await whatTheWorldSaid(x.id);
    expect(said.filter((s) => s.kind === 'offer_delivered').length).toBeGreaterThan(0);
    expect(said.filter((s) => s.kind === 'payment')).toHaveLength(0);
  });
});

describe('day 8 — he asks what happened, and the charter has expired around a running test', () => {
  it('the letter says what was sent and that nothing was paid; the expired charter lets nothing new in and stops nothing running', async () => {
    await advanceDays(5);
    await morning();
    const { whileYouWereAway } = await import('../../src/services/founder/a-week-away.js');
    const letter = await whileYouWereAway(OWNER, 8);
    expect(letter.effects.some((e) => /of \d+ messages sent to people under the test/.test(e))).toBe(true);
    expect(letter.money.some((m) => /paid/.test(m) && !/nothing paid/.test(m))).toBe(false);
    const { liveCharter } = await import('../../src/services/institution/charter.js');
    expect(await liveCharter(OWNER)).toBeNull();
    const { exposureOf } = await import('../../src/services/venture/outcome.js');
    expect((await exposureOf(X))?.withdrawnAt ?? null).toBeNull();
    expect(asText(await me.answer('What are you allowed to spend?'))).toContain('No charter is signed');
  });
});

describe('day 10 — the window closes and the world settles it', () => {
  it('the sealed rule settles it surprised; it leaves Now; the budget ends with the answer; the reading says settled', async () => {
    await advanceDays(2);
    await morning();
    const e = await one('SELECT verdict, ran_at FROM venture_experiments WHERE id = ?', [X]);
    expect(String(e.verdict)).toBe('surprised');
    expect(e.ran_at).not.toBeNull();
    const a = await one('SELECT withdrawn_at, withdraw_reason FROM owner_allowances WHERE product_id = ?', [productId]);
    expect(a.withdrawn_at).not.toBeNull();
    expect(String(a.withdraw_reason)).toContain('its budget ended with its answer');
    expect((await money()).word).toBe('settled');
    const experiments = asText(await me.page('/foundry/experiments'));
    expect(experiments).toContain('Nothing is being tested now');
    expect(experiments).toContain('Recently finished');
    const { waitingOn } = await import('../../src/services/founder/attention.js');
    expect((await waitingOn(OWNER)).map((i) => i.id)).not.toContain(X);
    expect(asText(await me.page('/foundry'))).not.toContain('set aside for tests');
  });

  it('a provider reporting the same event twice is one event; a payment after the window is recorded and changes no verdict', async () => {
    const { exposureOf, recordBusinessOutcome, whatTheWorldSaid } = await import('../../src/services/venture/outcome.js');
    const x = (await exposureOf(X))!;
    const before = (await whatTheWorldSaid(x.id)).length;
    await recordBusinessOutcome({ exposureId: x.id, kind: 'payment', amountCents: 2900, currency: 'usd', observedAt: new Date(), provider: 'stripe', providerRef: 'pi_late_1' });
    await recordBusinessOutcome({ exposureId: x.id, kind: 'payment', amountCents: 2900, currency: 'usd', observedAt: new Date(), provider: 'stripe', providerRef: 'pi_late_1' });
    const after = await whatTheWorldSaid(x.id);
    expect(after.length).toBe(before + 1);
    expect(String((await one('SELECT verdict FROM venture_experiments WHERE id = ?', [X])).verdict)).toBe('surprised');
    expect((await money()).paidCents).toBe(2900);
  });
});

describe('day 25 — the lesson reaches the next design', () => {
  it('a new design under the same candidate is written against what this one could not establish', async () => {
    await advanceDays(15);
    await morning();
    const { lessonsFor } = await import('../../src/services/venture/forge.js');
    const lessons = await lessonsFor(OWNER);
    const mine = lessons.find((l) => l.experimentId === X);
    expect(mine).toBeDefined();
    expect(mine!.verdict).toBe('surprised');
    const base = await one('SELECT opportunity_id FROM venture_experiments WHERE id = ?', [X]);
    const { raiseUnknown } = await import('../../src/services/venture/market-evidence.js');
    const unknownId = await raiseUnknown({ founderId: OWNER, opportunityId: String(base.opportunity_id), blocking: true,
      question: 'Would a shop that saw the brief pay for the next one?', cheapestTest: 'offer the second brief to the nineteen who received the first' });
    const { designExperiment } = await import('../../src/services/venture/validation.js');
    const next = await designExperiment({ founderId: OWNER, opportunityId: String(base.opportunity_id), unknownId,
      whatWeDo: 'offering a second brief to those who received the first', whatWeExpect: 'at least one pays', wouldDisprove: 'nobody pays',
      costCents: 2500, evidenceMode: 'real' });
    const { theRecordOf } = await import('../../src/services/venture/forge-deliberation.js');
    const record = await theRecordOf(next);
    expect(record?.lessons.some((l) => l.whatWeDid.includes('Massachusetts millwork') && l.verdict === 'surprised')).toBe(true);
    // And "why did it fail" answers from the same record, in his words.
    const why = await me.answer('Why did the millwork test fail?');
    expect(why).toContain('It did not hold.');
  });
});

describe('day 30 and day 41 — the month closes and the asset retires', () => {
  it('the thirty-day letter, Home and the reading agree; after the grace the asset is retired and History says so', async () => {
    await advanceDays(5);
    await morning();
    const { whileYouWereAway } = await import('../../src/services/founder/a-week-away.js');
    const letter = await whileYouWereAway(OWNER, 30);
    expect(letter.outcomes.some((o) => /not what I expected/.test(o))).toBe(true);
    expect(letter.learned.some((l) => /did not hold/.test(l))).toBe(true);
    expect(letter.money.some((m) => /set aside for it/.test(m))).toBe(true);
    expect(letter.money.some((m) => /\$100\.00 on a test/.test(m))).toBe(false);
    expect((await money()).word).toBe('settled');

    await advanceDays(11);
    await morning();
    const p = await one('SELECT status, retired_because FROM products WHERE id = ?', [productId]);
    expect(String(p.status)).toBe('archived');
    expect(String(p.retired_because)).toContain('did not hold');
    const history = asText(await me.page('/foundry/experiments/history'));
    expect(history).toContain('is retired: its test did not hold');
  });
});
