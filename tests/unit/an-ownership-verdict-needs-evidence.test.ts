// =============================================================================
// AN OWNERSHIP VERDICT NEEDS EVIDENCE, AND HIS TIME IS NOT TRADED FOR MONEY.
//
// An independent reviewer read `burdenFor` and reproduced three verdicts from
// fixtures. All three were wrong, and they were wrong in three different ways
// with one cause: the verdict was computed from two numbers that were not the
// institution's own economics.
//
//   $0 earned, $0 recorded cost, nobody asked        -> "earning its keep"
//   $600/mo, $1 cost, FIFTY interruptions in a month -> "earning its keep"
//   nothing known at all                             -> "too early to say"
//
// The first is a favourable verdict on an asset nothing has been measured
// about. The second is fifty interruptions disappearing because the asset
// earned more than an invented, undisclosed five-hundred-dollar threshold.
// The third is the only honest one, and it is honest by accident: an asset
// that sells a thing ONCE reads that way for ever, because the rule could
// only see monthly recurring revenue — and the first real thing this
// institution ever sold was a $29 one-time brief.
//
// This is the scenario list the owner asked for, each one a shape of business
// the verdict has to be able to read without flattering it.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { burdenFor } from '../../src/services/founder/burden.js';

const OWNER = 'bv_owner';
const MANDATE = 'bv_mandate';
let seq = 0;

/** An earned, real company of his, with nothing else said about it. */
async function anAsset(name: string, opts: { aiUsd?: number | null; mrrCents?: number | null; fromExperiment?: string; standing?: string } = {}): Promise<string> {
  const id = `bv_p${++seq}`;
  // THE LINEAGE IS SET AT BIRTH OR NEVER: the rows refuse to move an asset
  // from one test to another afterwards, which is the right refusal and means
  // a selling asset has to be built in that order.
  await query(
    `INSERT INTO products (id, name, owner_id, status, standing, reality, ai_cost_trailing_30d_usd, from_experiment_id)
     VALUES (?,?,?,'active',?,'real',?,?)`,
    [id, name, OWNER, opts.standing ?? 'earned', opts.aiUsd === undefined ? null : opts.aiUsd, opts.fromExperiment ?? null]);
  if (opts.mrrCents != null) {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents) VALUES (?,?,date('now'),?)`,
      [`bv_m${seq}`, id, opts.mrrCents]);
  }
  return id;
}

/**
 * HE WAS ASKED SOMETHING ABOUT IT, n times, inside the window — through a
 * situation the institution noticed and the advice it raised, which is one of
 * the two things `burdenFor` counts and the one a fixture can honestly build.
 */
async function asked(productId: string, n: number): Promise<void> {
  const sit = `bv_sit${++seq}`;
  await query(
    `INSERT INTO company_situations (id, product_id, situation, headline, evidence_mode, began_at)
     VALUES (?,?,'needs_attention','it keeps needing something','real',datetime('now','-10 day'))`,
    [sit, productId]);
  for (let i = 0; i < n; i += 1) {
    await query(
      `INSERT INTO situation_recommendations (id, situation_id, product_id, kind, summary, why, would_need, raised_at)
       VALUES (?,?,?,?,?,'because it came up','a decision from you',datetime('now','-1 day'))`,
      [`bv_r${++seq}`, sit, productId, `a thing ${String(i)}`, `something ${String(i)}`]);
  }
}

/**
 * AN ASSET THAT HAS ACTUALLY SOLD SOMETHING, through the chain the rows
 * insist on: a search, something found, an unknown worth settling, a test of
 * it, the exposure it was sold at, the sale, what it owed the buyer, and the
 * money — every line of it in the institution's own ledger, so the verdict is
 * read from the same figures Economics shows him.
 */
async function anAssetThatSold(
  name: string, sales: Array<{ charge: number; fee: number; daysAgo?: number }>,
  opts: { aiUsd?: number | null; mrrCents?: number | null } = {},
): Promise<string> {
  const n = ++seq;
  const experimentId = `bv_x${n}`;
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem,
                                        why_it_might, kill_thesis, evidence_mode)
     VALUES (?,?,?,'a thing to sell','somebody','a problem','it might work','nobody pays','real')`,
    [`bv_o${n}`, MANDATE, OWNER]);
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question)
     VALUES (?,?,?,'will anybody pay')`, [`bv_u${n}`, OWNER, `bv_o${n}`]);
  await query(
    `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, evidence_mode, cost_cents)
     VALUES (?,?,?,?,'sell it','somebody buys','nobody buys','real',0)`,
    [experimentId, OWNER, `bv_o${n}`, `bv_u${n}`]);
  // He allowed it: nothing is exposed to the world under a test he did not.
  await query(
    `UPDATE venture_experiments SET decision = 'approved', decided_at = datetime('now','-5 day'),
            decided_by = ? WHERE id = ?`,
    [`founder:${OWNER}`, experimentId]);
  await query(
    `INSERT INTO experiment_exposures (id, experiment_id, founder_id, provider, exposure_ref, placed_at, placed_by, evidence_mode)
     VALUES (?,?,?,'stripe',?,datetime('now','-3 day'),'institution:hand','real')`, [`bv_e${n}`, experimentId, OWNER, `plink_${n}`]);
  // AN ASSET OUT OF A TEST ARRIVES EXPERIMENTAL and earns its standing from
  // the world. That is the frontier, and it is where every real sale this
  // institution has ever made lives.
  const productId = await anAsset(name, { aiUsd: opts.aiUsd, mrrCents: opts.mrrCents, fromExperiment: experimentId, standing: 'experimental' });
  for (const sale of sales) {
    const k = ++seq;
    const when = `-${String(sale.daysAgo ?? 3)} day`;
    await query(
      `INSERT INTO business_outcome_events (id, founder_id, exposure_id, kind, amount_cents, currency, observed_at,
                                            provider, provider_event_ref, evidence_mode, counterparty, arrived_via)
       VALUES (?,?,?,'payment',?,'usd',datetime('now',?),'stripe',?,'real','unmatched_external','payment_link')`,
      [`bv_ev${k}`, OWNER, `bv_e${n}`, sale.charge, when, `pi_bv_${k}`]);
    await query(
      `INSERT INTO experiment_fulfilments (id, founder_id, experiment_id, exposure_id, payment_event_id, provider, payment_ref, amount_cents, currency, status)
       VALUES (?,?,?,?,?,'stripe',?,?,'usd','owed')`,
      [`bv_f${k}`, OWNER, experimentId, `bv_e${n}`, `bv_ev${k}`, `pi_bv_${k}`, sale.charge]);
    // What was bought reached the buyer. A fulfilment cannot arrive settled;
    // it becomes so, which is the rows insisting that delivery is an event.
    await query(`UPDATE experiment_fulfilments SET status = 'delivered' WHERE id = ?`, [`bv_f${k}`]);
    const event = async (kind: string, cents: number): Promise<void> => {
      await query(
        `INSERT INTO economic_events (id, founder_id, kind, amount_cents, currency, occurred_at, provider, provider_ref,
                                      fulfilment_id, source_event_id, claim_quality, evidence_mode, because)
         VALUES (?,?,?,?,'usd',datetime('now',?),'stripe',?,?,?,'measured','real','the provider said so')`,
        [`bv_ec${++seq}`, OWNER, kind, cents, when, `ch_bv_${k}_${kind}`, `bv_f${k}`, `bv_ev${k}`]);
    };
    await event('charge', sale.charge);
    if (sale.fee > 0) await event('provider_fee', sale.fee);
  }
  return productId;
}

/** Money that left through the door, with the provider's receipt. */
async function spent(productId: string, cents: number): Promise<void> {
  await query(
    `INSERT INTO asset_money_spent (id, product_id, tool, amount_cents, currency, source, provider_ref, recorded_at)
     VALUES (?,?,'a_tool',?,'usd','settled',?,datetime('now','-2 day'))`,
    [`bv_s${++seq}`, productId, cents, `rcpt_${seq}`]);
}

const of = async (productId: string) => (await burdenFor(OWNER)).find((b) => b.productId === productId)!;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email, name) VALUES (?,?,?,?)`,
    [OWNER, 'bv_clk', 'owner@example.com', 'Thomas Norton']);
  // One search, open, because a person has one at a time.
  await query(
    `INSERT INTO venture_mandates (id, founder_id, statement, evidence_mode)
     VALUES (?,?,'find something worth selling','real')`, [MANDATE, OWNER]);
});

describe('the three verdicts a reviewer reproduced', () => {
  it('nothing measured, nobody asked: it does not say the asset is earning its keep', async () => {
    const id = await anAsset('Nothing Known Ltd');
    const b = await of(id);
    expect(b.verdict, 'a favourable verdict on an unmeasured asset is a lie the owner would act on')
      .toBe('not enough to say');
    expect(b.flow.quality).toBe('unavailable');
    expect(b.cost.quality, 'a cost nobody recorded is not a cost of zero').toBe('unavailable');
    expect(b.contribution.cents).toBeNull();
    expect(b.sentence).toContain('I cannot see what it earns');
    expect(b.sentence).toContain('not enough to say');
  });

  it('$600 a month and fifty interruptions: the fifty do not disappear', async () => {
    const id = await anAsset('Demanding Ltd', { aiUsd: 0.01, mrrCents: 60_000 });
    await asked(id, 50);
    const b = await of(id);
    // The money verdict is favourable, and truthfully so: it does earn more
    // than it costs. That was never the defect.
    expect(b.verdict).toBe('earning its keep');
    // THE DEFECT: his time used to vanish above five hundred dollars a month.
    expect(b.interruptions).toBe(50);
    expect(b.burden, 'his week is the same length whatever an asset earns').toBe('needs you often');
    expect(b.sentence).toContain('needed you 50 times');
    expect(b.sentence).toContain('asking a lot of you');
  });

  it('a one-time sale is money, not an absence — which is what this institution actually sells', async () => {
    const id = await anAssetThatSold('Sells It Once Ltd', [{ charge: 2_900, fee: 117 }], { aiUsd: 1 });
    const b = await of(id);
    expect(b.cadence, 'the first real thing this institution sold was a one-time brief').toBe('one_time');
    expect(b.flow.quality).toBe('measured');
    expect(b.flow.cents, 'the charge, less what the provider took').toBe(2_900 - 117);
    expect(b.verdict).toBe('earning its keep');
    expect(b.sentence).toContain('brought in $28 in sales');
  });
});

describe('the shapes of business an ownership verdict has to be able to read', () => {
  it('a genuinely profitable low-maintenance asset reads well, and says so plainly', async () => {
    const id = await anAsset('Quiet Earner Ltd', { aiUsd: 2, mrrCents: 150_000 });
    const b = await of(id);
    expect(b).toMatchObject({ verdict: 'earning its keep', burden: 'has not needed you' });
    expect(b.contribution.cents).toBe(150_000 - 200);
  });

  it('a high-revenue asset with excessive ongoing work is not simply "earning its keep"', async () => {
    const id = await anAsset('Busy And Rich Ltd', { aiUsd: 5, mrrCents: 900_000 });
    await asked(id, 22);
    const b = await of(id);
    expect(b.verdict).toBe('earning its keep');
    expect(b.burden).toBe('needs you often');
    // Both halves reach him in one sentence, which the old rule could not do.
    expect(b.sentence).toMatch(/earns about \$9000 a month/);
    expect(b.sentence).toMatch(/asking a lot of you/);
  });

  it('an asset with unknown operating costs keeps its uncertainty', async () => {
    const id = await anAsset('Unknown Costs Ltd', { mrrCents: 40_000 });
    const b = await of(id);
    expect(b.cost.quality).toBe('unavailable');
    expect(b.verdict, 'earning cannot be judged against a cost nobody has measured').toBe('not enough to say');
    expect(b.sentence).toContain('nothing has been recorded of what it costs');
  });

  it('a one-time product with intermittent sales that cost more than they brought', async () => {
    const id = await anAssetThatSold('Thin Margins Ltd', [{ charge: 1_000, fee: 59 }], { aiUsd: 3 });
    await spent(id, 4_000);
    const b = await of(id);
    expect(b.cadence).toBe('one_time');
    expect(b.verdict).toBe('costs more than it earns');
    expect(b.contribution.cents).toBe((1_000 - 59) - (4_000 + 300));
  });

  it('a pre-revenue investigation is not condemned, and is not flattered either', async () => {
    // Nothing has been sold and something has been spent. That is what a
    // bounded investigation looks like from the outside, and the honest
    // answer is that its keep is not yet a question the record can settle.
    const id = await anAsset('Still Looking Ltd', { aiUsd: 4 });
    await spent(id, 2_500);
    const b = await of(id);
    expect(b.cadence).toBe('not_yet');
    expect(b.flow.quality).toBe('unavailable');
    expect(b.verdict, 'an investigation that has not sold anything has not failed').toBe('not enough to say');
    expect(b.cost.cents, 'and what it has cost is known exactly').toBe(2_500 + 400);
  });

  it('predictable low-frequency work and unpredictable interruption are not the same burden', async () => {
    const rare = await anAsset('Once A Month Ltd', { aiUsd: 1, mrrCents: 80_000 });
    await asked(rare, 1);
    const constant = await anAsset('All The Time Ltd', { aiUsd: 1, mrrCents: 80_000 });
    await asked(constant, 12);
    expect((await of(rare)).burden).toBe('needs you now and then');
    expect((await of(constant)).burden).toBe('needs you often');
    // Same money, same verdict on the money, different thing to own.
    expect((await of(rare)).verdict).toBe((await of(constant)).verdict);
  });
});

// GATE 1, CASE 10: A VERDICT ON MONEY COMPARES LIKE WITH LIKE. Lifetime sales
// were set against thirty days of cost; a monthly subscription figure was added
// on top of ledger sales that may already contain it; and a sale whose fee had
// not been read counted as fee-free while still being called "after fees".
describe('money is compared over one period, with what is actually known', () => {
  it('does not let an old sale pay for this month', async () => {
    const id = await anAssetThatSold('Sold Long Ago Ltd', [{ charge: 5_000, fee: 175, daysAgo: 60 }], { aiUsd: 2 });
    const b = await of(id);
    expect(b.verdict, 'a sale two months ago was set against thirty days of cost').not.toBe('earning its keep');
  });

  it('does not call an unread fee zero, or a sale "after fees" while one is missing', async () => {
    const id = await anAssetThatSold('Fee Unread Ltd', [{ charge: 2_900, fee: 0 }], { aiUsd: 1 });
    const b = await of(id);
    expect(b.verdict, 'a sale whose fee was never read earned its keep on a fee of zero').not.toBe('earning its keep');
    expect(b.flow.because).not.toMatch(/after fees/);
    expect(b.flow.because).toMatch(/fee/);
  });

  it('does not add a subscription reading on top of sales that may already contain it', async () => {
    const id = await anAssetThatSold('Both Ways Ltd', [{ charge: 2_900, fee: 117 }], { aiUsd: 1, mrrCents: 4_000 });
    const b = await of(id);
    expect(b.flow.cents, 'the month of subscription was stacked on the ledger').toBe(2_900 - 117);
    expect(b.flow.because).toMatch(/subscription/);
  });
});
