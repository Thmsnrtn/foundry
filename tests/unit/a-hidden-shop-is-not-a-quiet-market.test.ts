// =============================================================================
// A HIDDEN SHOP IS NOT A QUIET MARKET.
//
// On 25 September 2026 the owner found Etsy's notice on his shop: ApexMicro was
// in Developer Mode, which "makes your shop's listings not discoverable via
// search". Nothing in Foundry could have seen it. The reader asks Etsy which
// shop, what is listed and what was paid — never whether a buyer can find any
// of it — and Etsy is not known to tell an app. A listing test run in that shop
// would have closed its window with no sale, and the settlement would have
// written "Not as predicted" about a market nobody could reach.
//
// So the fact is asked of the one person who can see it, and what he says is
// held to three things:
//
//   READINESS — no Etsy test is ready until he has said buyers can find the
//               shop, and it stops being ready when he says they cannot.
//   EVIDENCE  — a silent window that overlaps anything he said was hidden is
//               not a verdict. It is invalid, with the kind that already
//               exists for it: the offer never appeared where people could
//               see it. A sale that did happen still counts.
//   RECORD    — what he said, and when, is kept as said. Nothing rewrites it,
//               and nobody but the company's owner can say it.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'c'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { approveListing, PROOF2_WINDOW_DAYS, recordListing, recordVenueOrder, seedProof2, settleListings } from '../../src/services/venture/proof-2.js';
import { qualificationOf } from '../../src/services/venture/qualification.js';
import { findabilityOf, sayWhetherFindable, shopHiddenDuring } from '../../src/services/venture/findability.js';

const OWNER = 'hs_owner';
const OTHER = 'hs_other';
const CONTROL_OWNER = 'hs_control';
let X = '';
let PRODUCT = '';
let CX = '';
let CPRODUCT = '';

const FIND = 'buyers can find the shop';
const conditionOf = async (experimentId: string) =>
  (await qualificationOf(experimentId)).conditions.find((c) => c.name === FIND);

async function founder(id: string): Promise<void> {
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [id, `clerk_${id}`, `${id}@example.com`, id]);
}

async function listingTest(owner: string): Promise<{ x: string; product: string }> {
  const seeded = await seedProof2(owner);
  await approveListing({ founderId: owner, experimentId: seeded.experimentId });
  const product = String(((await query(
    'SELECT id FROM products WHERE from_experiment_id = ?', [seeded.experimentId])).rows[0] as Record<string, unknown>).id);
  return { x: seeded.experimentId, product };
}

/** Moves every statement for a product back in time, so a window can sit after it. */
async function backdate(productId: string, days: number): Promise<void> {
  // The table refuses an UPDATE, by design; the test rebuilds history the only
  // way it can — by dropping the guard for the one statement and restoring it.
  await query('DROP TRIGGER venue_findability_is_as_said');
  await query(`UPDATE venue_findability SET said_at = datetime(said_at, ?) WHERE product_id = ?`,
    [`-${String(days)} days`, productId]);
  await query(`CREATE TRIGGER venue_findability_is_as_said
    BEFORE UPDATE ON venue_findability
    BEGIN SELECT RAISE(ABORT, 'venue_findability:said_is_said'); END`);
}

beforeAll(async () => {
  await runMigrations();
  await founder(OWNER);
  await founder(OTHER);
  await founder(CONTROL_OWNER);
  ({ x: X, product: PRODUCT } = await listingTest(OWNER));
  ({ x: CX, product: CPRODUCT } = await listingTest(CONTROL_OWNER));
  // A grade in the same second as the prediction is refused as ambiguous
  // (migration 262), so the predictions are allowed to be a second old.
  await new Promise((r) => setTimeout(r, 1100));
});

describe('readiness: no Etsy test is ready until he says buyers can find the shop', () => {
  it('asks, and says why, when nothing has been said', async () => {
    const c = await conditionOf(X);
    expect(c?.verdict).toBe('waits_for_you');
    expect(c?.because).toMatch(/Developer Mode/);
    expect(c?.because).toMatch(/cannot see/);
    expect((await qualificationOf(X)).blocking).toContain(FIND);
  });

  it('holds the test back when he says the shop is hidden', async () => {
    const r = await sayWhetherFindable({ productId: PRODUCT, provider: 'etsy', findable: false, saidBy: `founder:${OWNER}` });
    expect('refused' in r).toBe(false);
    const c = await conditionOf(X);
    expect(c?.verdict).toBe('waits_for_you');
    expect(c?.because).toMatch(/you said on \d{4}-\d{2}-\d{2}/);
    expect(c?.because).toMatch(/not.*find|hidden/i);
  });

  it('lets it through when he says buyers can find it, and records both', async () => {
    await sayWhetherFindable({ productId: PRODUCT, provider: 'etsy', findable: true, saidBy: `founder:${OWNER}` });
    expect((await conditionOf(X))?.verdict).toBe('met');
    const now = await findabilityOf(PRODUCT, 'etsy');
    expect(now?.findable).toBe(true);
    const n = (await query('SELECT COUNT(*) AS n FROM venue_findability WHERE product_id = ?', [PRODUCT])).rows[0] as Record<string, unknown>;
    expect(Number(n.n)).toBe(2);
  });

  it('asks the new owner again when the company changes hands', async () => {
    // What the last owner said is kept, and is theirs; it is not the new one's.
    await query('UPDATE products SET owner_id = ? WHERE id = ?', [OTHER, PRODUCT]);
    try {
      const c = await conditionOf(X);
      expect(c?.verdict).toBe('waits_for_you');
      expect(c?.because).toMatch(/does not own this company now/);
      expect((await findabilityOf(PRODUCT, 'etsy'))?.byTheOwner).toBe(false);
    } finally {
      await query('UPDATE products SET owner_id = ? WHERE id = ?', [OWNER, PRODUCT]);
    }
    expect((await conditionOf(X))?.verdict).toBe('met');
  });

  it('is not a question for a test that is not on a venue', async () => {
    // Only a listing owes it; the condition is absent rather than met elsewhere.
    const workshop = (await qualificationOf('no-such-test')).conditions.find((c) => c.name === FIND);
    expect(workshop).toBeUndefined();
  });
});

describe('record: said is said, and only by the owner', () => {
  it('refuses somebody who does not own the company', async () => {
    const r = await sayWhetherFindable({ productId: PRODUCT, provider: 'etsy', findable: true, saidBy: `founder:${OTHER}` });
    expect('refused' in r && r.refused).toMatch(/owner/);
  });

  it('refuses a caller that is not a founder at all', async () => {
    const r = await sayWhetherFindable({ productId: PRODUCT, provider: 'etsy', findable: true, saidBy: 'agent:helpful' });
    expect('refused' in r).toBe(true);
  });

  it('refuses a statement about a product that does not exist', async () => {
    const r = await sayWhetherFindable({ productId: 'nope', provider: 'etsy', findable: true, saidBy: `founder:${OWNER}` });
    expect('refused' in r).toBe(true);
  });

  it('cannot be rewritten after the fact', async () => {
    await expect(query(`UPDATE venue_findability SET findable = 1 WHERE product_id = ?`, [PRODUCT]))
      .rejects.toThrow(/said_is_said/);
  });

  it('cannot be written by the database for somebody else', async () => {
    await expect(query(
      `INSERT INTO venue_findability (id, founder_id, product_id, provider, findable, said_by)
       VALUES (?,?,?,?,?,?)`, [nanoid(), OWNER, PRODUCT, 'etsy', 1, 'agent:helpful']))
      .rejects.toThrow();
  });
});

describe('evidence: a silence while the shop was hidden is not a verdict', () => {
  it('names the hidden stretch of a window, and nothing for a window he called findable', async () => {
    // As said so far: hidden, then findable, both today.
    const from = new Date(Date.now() - 60_000);
    const to = new Date(Date.now() + 86_400_000);
    expect(await shopHiddenDuring(X, from, to)).toMatch(/could not find ApexMicro|could not find the shop|hidden/i);
    // A window that starts after he said findable, with nothing hidden since.
    const later = new Date(Date.now() + 60_000);
    expect(await shopHiddenDuring(X, later, new Date(later.getTime() + 86_400_000))).toBeNull();
  });

  it('invalidates a silent test whose window he said was hidden, with the kind that already exists for it', async () => {
    await recordListing({ founderId: OWNER, experimentId: X, url: 'https://www.etsy.com/listing/1111111111/hidden' });
    await sayWhetherFindable({ productId: PRODUCT, provider: 'etsy', findable: false, saidBy: `founder:${OWNER}` });
    const [r] = await settleListings({ founderId: OWNER, now: new Date(Date.now() + 400 * 86_400_000) });
    expect(r.settled).toBeNull();
    expect(r.because).toMatch(/search/);
    expect(r.because).toMatch(/did not measure/);
    const e = (await query(
      'SELECT validity, invalid_because, verdict, ran_at FROM venture_experiments WHERE id = ?', [X])).rows[0] as Record<string, unknown>;
    expect(e.validity).toBe('invalid');
    expect(e.invalid_because).toBe('offer_not_published');
    expect(e.verdict).toBeNull();
    expect(e.ran_at).toBeNull();
  });

  it('still settles a silent test he said was findable throughout — the control', async () => {
    await sayWhetherFindable({ productId: CPRODUCT, provider: 'etsy', findable: true, saidBy: `founder:${CONTROL_OWNER}` });
    await backdate(CPRODUCT, PROOF2_WINDOW_DAYS + 5);
    await recordListing({ founderId: CONTROL_OWNER, experimentId: CX, url: 'https://www.etsy.com/listing/2222222222/seen' });
    // The window has closed: it opened after he said findable, and nothing since.
    await query(`UPDATE experiment_exposures SET placed_at = datetime('now', ?) WHERE experiment_id = ?`,
      [`-${String(PROOF2_WINDOW_DAYS + 1)} days`, CX]);
    const [r] = await settleListings({ founderId: CONTROL_OWNER, now: new Date(Date.now() + 10 * 60_000) });
    expect(r.settled).toBe('surprised');
    const e = (await query('SELECT validity FROM venture_experiments WHERE id = ?', [CX])).rows[0] as Record<string, unknown>;
    expect(e.validity).toBe('valid');
  });

  it('never un-observes a sale because the shop was hidden', async () => {
    const third = 'hs_sold';
    await founder(third);
    const t = await listingTest(third);
    await new Promise((r) => setTimeout(r, 1100));
    await recordListing({ founderId: third, experimentId: t.x, url: 'https://www.etsy.com/listing/3333333333/sold' });
    await sayWhetherFindable({ productId: t.product, provider: 'etsy', findable: false, saidBy: `founder:${third}` });
    await recordVenueOrder({ founderId: third, experimentId: t.x,
      order: { orderRef: '4567890123', paidAt: new Date().toISOString(), grossCents: 1200, feeCents: 150 } });
    const [r] = await settleListings({ founderId: third, now: new Date(Date.now() + 10 * 60_000) });
    expect(r.settled).not.toBeNull();
    const e = (await query('SELECT validity FROM venture_experiments WHERE id = ?', [t.x])).rows[0] as Record<string, unknown>;
    expect(e.validity).toBe('valid');
  });
});
