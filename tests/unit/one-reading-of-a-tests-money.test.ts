// =============================================================================
// ONE READING OF A TEST'S MONEY.
//
// One approved $100 test read as $-100 on Home, "$100 more without asking" on
// Controls, "Spent $0.00" on its page, "$100 on a test" in the week-away
// letter and "$800 over 7 days" on the absence test — five figures, each
// correct about a different quantity, none reconciled, one of them printing
// the ceiling as spend. There is one reader now, and every surface renders
// from it with its own label. Proven in a world where authorised, spent and
// paid are all different numbers.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { query } from '../../src/db/client.js';
import { providerStubs } from '../helpers/provider-stubs.js';
import { OWNER, asText, owner, ownerApp, seedProductionShape } from '../helpers/world.js';

// The providers, shape-faithful and in memory: nothing here is market evidence.
const { fetch: fetchStub } = providerStubs();
vi.stubGlobal('fetch', fetchStub);
afterAll(() => { vi.unstubAllGlobals(); });

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
let testId = '';
let productId = '';
const one = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows[0] as Record<string, unknown>;

beforeAll(async () => {
  // Experiment 001 itself, approved at $100 with its offer stated, not yet
  // settled: the one test is read authorised, then spending, then settled.
  ({ experimentId: testId } = await seedProductionShape({ charter: true, unsettled: true }));
  app = await ownerApp();
  me = owner(app);
  productId = String((await one('SELECT id FROM products WHERE from_experiment_id = ?', [testId])).id);
});

describe('before anything moves', () => {
  it('the reading says authorised, and Home says set aside — not spent, not lost', async () => {
    const { moneyOfExperiment } = await import('../../src/services/founder/experiment-view.js');
    const m = await moneyOfExperiment(testId);
    expect(m.authorisedCents).toBe(10000);
    expect(m.spentCents).toBe(0);
    expect(m.paidCents).toBe(0);
    expect(m.word).toBe('authorised');
    const home = asText(await me.page('/foundry'));
    expect(home).toContain('set aside for tests, nothing paid yet');
  });

  it('the absence test bounds thinking by the charter he signed, not the provider ceiling', async () => {
    const { absenceReading } = await import('../../src/services/institution/absence-test.js');
    const reading = await absenceReading(OWNER, 7);
    const bounded = reading.properties.find((p) => p.property === 'bounded');
    expect(bounded).toBeDefined();
    expect(bounded!.evidence.join(' ')).toMatch(/at most \$3(\.00)? a day under the charter/);
    expect(bounded!.evidence.join(' ')).not.toMatch(/at most \$100(\.00)? a day/);
    // $3 × 7 days of thinking plus the $100 set aside for the approved test.
    expect(bounded!.sentence).toMatch(/At most \$121(\.00)? could be spent over 7 days/);
  });
});

describe('when authorised, spent and paid are three different numbers', () => {
  beforeAll(async () => {
    // $12 of thinking against the asset, one $29 purchase, one refund of it.
    await query(`INSERT INTO ai_daily_spend (scope, scope_id, date, spent_cents, updated_at) VALUES ('product', ?, date('now'), 1200, datetime('now'))`, [productId]);
    // The hand states the offer's shape and places the payment link, as it
    // does every hour in production — against the stubbed providers.
    const { runHand } = await import('../../src/services/venture/hand.js');
    await runHand({ founderId: OWNER, now: new Date() });
    const { exposureOf, placeExposure, recordBusinessOutcome } = await import('../../src/services/venture/outcome.js');
    let x = await exposureOf(testId);
    if (!x) {
      // The hand could not place it in this world (no owner-verified sending
      // domain), so the same steps by hand: the shape and its facts stated so
      // the legal pass can read them, then the link.
      const { experimentRow, offerShapePlanOf, statedShapeAndFacts } = await import('../../src/services/venture/hand.js');
      const plan = await offerShapePlanOf(testId);
      const e = await experimentRow(testId);
      if (!plan || !e) throw new Error('no offer shape plan');
      await statedShapeAndFacts(e, productId, plan);
      const placed = await placeExposure({ experimentId: testId, productId, provider: 'stripe', exposureRef: 'https://buy.stripe.com/test_world', evidenceMode: 'real', placedBy: `founder:${OWNER}` });
      if ('refused' in placed) throw new Error(placed.refused);
      x = await exposureOf(testId);
    }
    if (!x) throw new Error('the offer was not placed');
    await recordBusinessOutcome({ exposureId: x.id, kind: 'payment', amountCents: 2900, currency: 'usd', observedAt: new Date(), provider: 'stripe', providerRef: 'pi_world_1' });
    await recordBusinessOutcome({ exposureId: x.id, kind: 'refund', amountCents: 2900, currency: 'usd', observedAt: new Date(), provider: 'stripe', providerRef: 're_world_1' });
  });

  it('the one reader holds all three apart', async () => {
    const { moneyOfExperiment } = await import('../../src/services/founder/experiment-view.js');
    const m = await moneyOfExperiment(testId);
    expect(m.authorisedCents).toBe(10000);
    expect(m.spentCents).toBe(1200);
    expect(m.remainingCents).toBe(8800);
    expect(m.paidCents).toBe(2900);
    expect(m.refundedCents).toBe(2900);
    expect(m.word).toBe('spending');
    expect(m.sentence).toBe('$100.00 set aside for it; $12.00 of that spent; $29.00 paid by customers, $29.00 refunded');
  });

  it('the experiment page names each quantity for what it is', async () => {
    const t = asText(await me.page(`/foundry/experiments/${testId}`));
    expect(t).toContain('Set aside $100.00');
    expect(t).toContain('Allowance standing $88.00 of $100.00');
    expect(t).toContain('Spent by Foundry $12.00');
    expect(t).toContain('Paid by customers $29.00');
  });

  it('once the world settles it, the reading says settled and the letter never prints the ceiling as spend', async () => {
    const { recordResult } = await import('../../src/services/venture/validation.js');
    await new Promise((r) => { setTimeout(r, 1100); });
    await recordResult({ experimentId: testId, asPredicted: false, whatHappened: 'one paid and asked for the money back; nobody else bought' });
    const { moneyOfExperiment } = await import('../../src/services/founder/experiment-view.js');
    expect((await moneyOfExperiment(testId)).word).toBe('settled');
    const { whileYouWereAway } = await import('../../src/services/founder/a-week-away.js');
    const letter = await whileYouWereAway(OWNER, 7);
    const line = letter.money.find((l) => l.startsWith('a test,'));
    expect(line).toBeDefined();
    expect(line).toContain('$100.00 set aside for it; $12.00 of that spent; $29.00 paid by customers, $29.00 refunded');
    expect(letter.money.some((l) => /\$100\.00 on a test/.test(l))).toBe(false);
  });

  it('the money answer from the box reads the charter and the tests', async () => {
    const t = await me.answer('What are you allowed to spend?');
    expect(t).toContain('Under the charter');
    expect(t).toMatch(/approved at \$\d+\.\d\d in all/);
  });
});
