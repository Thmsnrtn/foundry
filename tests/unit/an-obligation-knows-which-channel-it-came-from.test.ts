// =============================================================================
// AN OBLIGATION KNOWS WHICH CHANNEL IT CAME FROM.
//
// The owner: distinguish an obligation Foundry independently observed from one
// a marketplace reported, from one inferred, from one it cannot currently
// observe, and from one requiring his manual action. "Do not infer that Etsy
// handles every possible customer responsibility or that Apex Micro has none."
// And: "Do not describe manual obligations as autonomously fulfilled."
//
// TWO THINGS WERE WRONG, AND THE FIRST ONE MEANT A BUYER COULD NOT BE OWED.
//
// `recordVenueOrder` marks a venue fulfilment `delivered` on insert — correctly,
// because the venue hands the file over the moment payment confirms — and
// `recordVenueRefund` wrote the request and the refund reference in one
// statement, for a refund already made. Between them there was no state for
// "asked for, not yet given", so `OPEN_OBLIGATION` could never be true for a
// marketplace sale. The refunds page promises a refund with no form and no time
// limit; nothing in the institution could see one being owed.
//
// The second: every remedy sentence ended "in Stripe". That is true of a charge
// Foundry took and false of a marketplace order, and it sends the owner to an
// account where the charge does not exist.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'thomas@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  approveListing, recordListing, recordVenueOrder, recordVenueRefund, requestVenueRefund, seedProof2,
} from '../../src/services/venture/proof-2.js';
import { obligationsFor } from '../../src/services/venture/obligations.js';

const OWNER = 'ob_owner';
const LISTING = 'https://www.etsy.com/listing/9988776655/bid-decision-workbook';
const ORDER = '3001234567';
let X = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_ob', 'thomas@example.com', 'Owner']);
  const seeded = await seedProof2(OWNER);
  X = seeded.experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  await recordListing({ founderId: OWNER, experimentId: X, url: LISTING });
  await recordVenueOrder({
    founderId: OWNER, experimentId: X,
    order: { orderRef: ORDER, paidAt: new Date().toISOString(), grossCents: 1400, feeCents: 158 },
  });
});

describe('how it came to be known is recorded, because silence means different things', () => {
  it('marks a venue order as the owner having typed it off a statement', async () => {
    const r = (await query(
      'SELECT provider, observed_how, status FROM experiment_fulfilments WHERE payment_ref = ?', [ORDER]))
      .rows[0] as Record<string, unknown>;
    expect(String(r.provider)).toBe('etsy');
    // NOT `foundry_observed`. Nothing here watches Etsy; this row is as
    // complete as his attention was, and saying otherwise would turn his
    // typing into an institutional observation.
    expect(String(r.observed_how)).toBe('owner_entered');
    expect(String(r.status)).toBe('delivered');
  });

  it('refuses to let a channel default into looking observed', async () => {
    await expect(query(
      // check-vocabulary:expected-refusal
      `UPDATE experiment_fulfilments SET observed_how = 'telepathy' WHERE payment_ref = ?`, [ORDER]))
      .rejects.toThrow();
  });
});

describe('a buyer on the venue can now be owed something', () => {
  it('opens an obligation that could not previously exist', async () => {
    // Before this, `OPEN_OBLIGATION` could never be true for a marketplace
    // sale: delivered on insert, and the only refund writer set the reference
    // in the same statement as the request.
    expect(await obligationsFor(OWNER)).toHaveLength(0);

    const asked = await requestVenueRefund({ founderId: OWNER, experimentId: X, orderRef: ORDER });
    expect(asked.alreadyOpen).toBe(false);

    const owed = await obligationsFor(OWNER);
    expect(owed).toHaveLength(1);
    expect(owed[0].paymentRef).toBe(ORDER);
    expect(owed[0].amountCents).toBe(1400);
    expect(owed[0].state).toBe('refund_requested');
  });

  it('asked twice is still one buyer waiting, dated from the first time', async () => {
    const again = await requestVenueRefund({ founderId: OWNER, experimentId: X, orderRef: ORDER });
    expect(again.alreadyOpen).toBe(true);
    expect(await obligationsFor(OWNER)).toHaveLength(1);
  });

  it('refuses a refund request against an order nobody recorded', async () => {
    await expect(requestVenueRefund({ founderId: OWNER, experimentId: X, orderRef: 'not-an-order' }))
      .rejects.toThrow(/no_such_order/);
  });
});

describe('the remedy points at the account the money is actually in', () => {
  it('names the venue and the order, and never sends him to Stripe', async () => {
    const owed = (await obligationsFor(OWNER))[0];
    expect(owed.provider).toBe('etsy');
    expect(owed.action).toBe('refund_on_the_venue');
    expect(owed.asksHim).toContain('Etsy');
    expect(owed.asksHim).toContain(ORDER);
    // THE SENTENCE THAT WOULD HAVE SENT HIM TO AN ACCOUNT WHERE THE CHARGE
    // DOES NOT EXIST.
    expect(owed.asksHim).not.toContain('in Stripe');
    expect(owed.sentence).not.toContain('Stripe');
  });

  it('says plainly that Foundry has no way to do it, rather than promising to try', async () => {
    const owed = (await obligationsFor(OWNER))[0];
    // Not "I try again on the next pass" — there is no pass that could. A
    // promise nothing can keep is worse than an honest hand-off.
    expect(owed.sentence).not.toContain('next pass');
    expect(owed.asksHim).toContain('no way to move');
  });

  it('carries how it was seen, so the owner can weigh the record', async () => {
    const owed = (await obligationsFor(OWNER))[0];
    expect(owed.observedHow).toBe('owner_entered');
  });
});

describe('recording the refund he made closes it', () => {
  it('closes the obligation and leaves the history true', async () => {
    await recordVenueRefund({
      founderId: OWNER, experimentId: X, orderRef: ORDER,
      refundedAt: new Date().toISOString(), amountCents: 1400,
    });
    expect(await obligationsFor(OWNER)).toHaveLength(0);
    const r = (await query(
      'SELECT status, refund_ref, refund_requested_at FROM experiment_fulfilments WHERE payment_ref = ?', [ORDER]))
      .rows[0] as Record<string, unknown>;
    expect(String(r.status)).toBe('refunded');
    expect(r.refund_ref).not.toBeNull();
    // The request it discharges is still dated, so how long the buyer waited
    // survives the refund.
    expect(r.refund_requested_at).not.toBeNull();
  });
});
