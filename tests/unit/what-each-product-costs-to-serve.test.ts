// =============================================================================
// WHAT EACH PRODUCT COSTS TO SERVE (F1, 9 October 2026).
//
// Economics said what Foundry costs to carry and what came in, as two totals.
// Neither said which product earns its keep. Now each product stream (one
// experiment: one thing for sale) has its own line for the last 30 days, on
// the Economics page the owner already reads (no new surface):
//   * revenue: real charges less refunds, through that product's fulfilments;
//   * fees: what the provider took, less fees it returned — NOT KNOWN when a
//     charge has no fee row, never zero;
//   * thinking: settled model spend whose purpose is that experiment;
//   * hosting: the stated monthly Fly bill split equally across the streams
//     with any activity, LABELLED an estimate, and "not stated" when he has
//     not stated it;
//   * thinking that served no one product (the search itself) is its own line,
//     never smeared across products.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, asText, owner, ownerApp, seedProductionShape } from '../helpers/world.js';

let app: Awaited<ReturnType<typeof ownerApp>>;
let EXP = '';

async function fulfilment(ref: string, cents: number): Promise<string> {
  await query(`INSERT OR IGNORE INTO experiment_exposures (id, founder_id, experiment_id, provider, exposure_ref, evidence_mode, placed_by)
    VALUES ('expo_cts',?,?,'stripe','plink_cts','real','test fixture')`, [OWNER, EXP]);
  await query(`INSERT INTO business_outcome_events (id, founder_id, exposure_id, kind, amount_cents, observed_at, provider, provider_event_ref, evidence_mode)
    VALUES (?,?,'expo_cts','payment',?,datetime('now'),'stripe',?,'real')`, [`boe_${ref}`, OWNER, cents, `pi_${ref}`]);
  await query(`INSERT INTO experiment_fulfilments (id, founder_id, experiment_id, exposure_id, payment_event_id, provider, payment_ref, charge_ref, amount_cents, currency, status)
    VALUES (?,?,?,'expo_cts',?,'stripe',?,?,?,'usd','owed')`, [`ful_${ref}`, OWNER, EXP, `boe_${ref}`, `pi_${ref}`, `ch_${ref}`, cents]);
  const { record } = await import('../../src/services/economy/ledger.js');
  await record({ founderId: OWNER, kind: 'charge', amountCents: cents, occurredAt: new Date(), provider: 'stripe', providerRef: `ch_${ref}`,
    sourceEventId: `boe_${ref}`, fulfilmentId: `ful_${ref}`, evidenceMode: 'real', because: 'a buyer paid' });
  return `ful_${ref}`;
}

async function thought(cents: number, purpose: { kind: string; id: string } | null): Promise<void> {
  const { reserveSpend, finishReservation } = await import('../../src/services/ai/spend-ledger.js');
  const r = await reserveSpend({ founderId: OWNER, model: 'anthropic/claude-sonnet-5', amountCents: cents + 1,
    caps: { global: 1e9, product: 1e9, founder: 1e9 }, purpose, work: 'a lens' });
  await finishReservation(r, { kind: 'settled', actualCents: cents });
}

beforeAll(async () => {
  await seedProductionShape();
  app = await ownerApp();
  EXP = String(((await query(`SELECT id FROM venture_experiments WHERE founder_id = ? ORDER BY rowid LIMIT 1`, [OWNER])).rows[0] as Record<string, unknown>).id);
}, 180_000);

describe('cost to serve, by product', () => {
  it('a product with a sale whose fee was never read: revenue is known, fees and net are NOT KNOWN', async () => {
    const { record } = await import('../../src/services/economy/ledger.js');
    const a = await fulfilment('a', 900);
    await fulfilment('b', 900);
    // Only the first charge's fee has been read.
    await record({ founderId: OWNER, kind: 'provider_fee', amountCents: 56, occurredAt: new Date(), provider: 'stripe', providerRef: 'txn_a',
      fulfilmentId: a, evidenceMode: 'real', because: 'the provider said' });
    await thought(40, { kind: 'experiment', id: EXP });
    await thought(25, null);
    const { costToServe } = await import('../../src/services/economy/projection.js');
    const c = await costToServe(OWNER);
    const s = c.streams.find((x) => x.experimentId === EXP)!;
    expect(s.revenue).toMatchObject({ cents: 1800, quality: 'measured' });
    expect(s.fees.cents).toBeNull();
    expect(s.net.cents).toBeNull();
    expect(s.thinking).toMatchObject({ cents: 40, quality: 'measured' });
    expect(c.unattributedThinking.cents).toBe(25);
  });

  it('every fee read: net is revenue less fees and thinking; hosting is an estimate only once he has stated the bill', async () => {
    const { record } = await import('../../src/services/economy/ledger.js');
    await record({ founderId: OWNER, kind: 'provider_fee', amountCents: 56, occurredAt: new Date(), provider: 'stripe', providerRef: 'txn_b',
      fulfilmentId: 'ful_b', evidenceMode: 'real', because: 'the provider said' });
    // A refund in another world (a rehearsal) moves nothing real.
    await record({ founderId: OWNER, kind: 'refund', amountCents: 500, occurredAt: new Date(), provider: 'stripe', providerRef: 're_sandbox',
      fulfilmentId: 'ful_a', evidenceMode: 'sandbox', because: 'a rehearsal' });
    const { costToServe, stateCostLine } = await import('../../src/services/economy/projection.js');
    let s = (await costToServe(OWNER)).streams.find((x) => x.experimentId === EXP)!;
    expect(s.revenue.cents).toBe(1800);
    expect(s.fees).toMatchObject({ cents: 112, quality: 'measured' });
    expect(s.hosting.cents).toBeNull();
    expect(s.net).toMatchObject({ cents: 1800 - 112 - 40, quality: 'measured' });
    await stateCostLine(OWNER, 'fly', 300, 'the Fly invoice for September');
    s = (await costToServe(OWNER)).streams.find((x) => x.experimentId === EXP)!;
    expect(s.hosting.quality).toBe('estimated');
    expect(s.hosting.cents).toBeGreaterThan(0);
    expect(s.net).toMatchObject({ cents: 1800 - 112 - 40 - s.hosting.cents!, quality: 'estimated' });
  });

  it('is on the Economics page the owner already reads, with the unknowns said as unknown', async () => {
    const text = asText(await owner(app).page('/foundry/money'));
    expect(text).toContain('Cost to serve, by product');
    expect(text).toContain('$18.00');
    expect(text).toMatch(/Thinking that served no one product[^$]*\$0\.25/);
    expect(text).toMatch(/hosting.*estimate/i);
  });

  // F2 audit of F1: "every fee read" was decided by counting FULFILMENTS with a
  // fee, not CHARGES. A fulfilment charged twice (a renewal, a second invoice)
  // with one fee read said its fees were known, and the net was overstated by
  // the fee nobody read.
  it('a second charge on the same fulfilment, its fee unread: fees and net are NOT KNOWN again', async () => {
    const { record } = await import('../../src/services/economy/ledger.js');
    await record({ founderId: OWNER, kind: 'charge', amountCents: 900, occurredAt: new Date(), provider: 'stripe', providerRef: 'ch_a_second',
      sourceEventId: 'boe_a', fulfilmentId: 'ful_a', evidenceMode: 'real', because: 'a buyer paid again' });
    const { costToServe } = await import('../../src/services/economy/projection.js');
    const s = (await costToServe(OWNER)).streams.find((x) => x.experimentId === EXP)!;
    expect(s.revenue.cents).toBe(2700);
    expect(s.fees.cents).toBeNull();
    expect(s.net.cents).toBeNull();
  });
});
