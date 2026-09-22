// =============================================================================
// THE BOUNDARY HE NARROWED BY NAME.
//
// On 22 September 2026 the owner authorised one change and fenced it four ways:
// narrow Experiment 002's `publish: never` SOLELY to permit its concise Apex
// Micro portfolio entry; no separate offer, price, checkout, payment link or
// fulfilment process; preserve the Etsy arrangement and the private records;
// and "do not generalize this authorization to other experiments or assets".
//
// `approveListing` writes the narrowed wording for any listing approved from
// here on, and refuses to run twice — so it can never reach the row that
// already exists in production. `keepProof2sEntryCurrent` is the only thing
// that can, and these are the proofs that it reaches that row and nothing else.
//
// The fence is the interesting half. Three of these tests are about what the
// reconciler REFUSES: a test with the right name but the wrong shape, another
// founder's books, and a boundary he has reworded since. Each returns a named
// refusal rather than proceeding, because a narrowing authorised against
// different words is not authorised at all.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'thomas@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  PROOF2_ENTRY_AUTHORISED, PROOF2_PLAN, PROOF2_PUBLIC, PROOF2_SLUG, PROOF2_TITLE,
  approveListing, keepProof2sEntryCurrent, seedProof2,
} from '../../src/services/venture/proof-2.js';
import { boundariesFor, setBoundary } from '../../src/services/institution/standing-intent.js';
import { publicIdentityOf } from '../../src/services/public-workshop/identity.js';
import { howItShouldShow } from '../../src/services/public-workshop/how-it-should-show.js';

const OWNER = 'n_owner';
const OTHER = 'n_other';

/** The boundary as `approveListing` wrote it before 21 September — the row in production. */
const AS_WRITTEN = 'Foundry publishes nothing for this test; the listing is my own act on the venue';

async function productOf(experimentId: string): Promise<string> {
  const r = (await query(
    'SELECT id FROM products WHERE from_experiment_id = ? AND deleted_at IS NULL ORDER BY rowid LIMIT 1',
    [experimentId])).rows[0] as Record<string, unknown>;
  return String(r.id);
}

/** Put the product's publishing boundary back to the pre-21-September row. */
async function restoreTheOldNever(productId: string): Promise<void> {
  await query(
    `UPDATE owner_boundaries SET lifted_at = datetime('now'), lifted_reason = 'the test is rewinding it'
      WHERE product_id = ? AND subject = 'publish' AND lifted_at IS NULL`, [productId]);
  await setBoundary({ productId, subject: 'publish', mode: 'never', statement: AS_WRITTEN });
}

let X = '';
let P = '';

beforeAll(async () => {
  await runMigrations();
  for (const f of [OWNER, OTHER]) {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
      [f, `clerk_${f}`, `${f}@example.com`, f]);
  }
  const seeded = await seedProof2(OWNER);
  X = seeded.experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  P = await productOf(X);
  // `approveListing` now writes the NARROWED wording. Production carries the
  // old one, which is the row this whole mechanism exists to reach, so the
  // fixture is rewound to it.
  await restoreTheOldNever(P);
});

describe('it reaches the row that already exists, and narrows it', () => {
  it('replaces the never with his words, and writes the entry that had no identity', async () => {
    const before = (await boundariesFor(P)).find((b) => b.subject === 'publish')!;
    expect(before.mode).toBe('never');
    expect(before.statement).toBe(AS_WRITTEN);
    // NOTHING TO UNHOLD. `proof-2.ts` never gave the workbook a public identity,
    // so narrowing alone would have freed a page that was never written.
    expect(await publicIdentityOf(X)).toBeNull();

    expect(await keepProof2sEntryCurrent(OWNER)).toBe('narrowed');

    const after = (await boundariesFor(P)).filter((b) => b.subject === 'publish');
    expect(after).toHaveLength(1);
    expect(after[0].mode).toBe('ask_first');
    expect(after[0].statement).toBe(PROOF2_ENTRY_AUTHORISED.statement);
    // HIS LIMIT, IN THE ROW ITSELF.
    expect(after[0].statement).toContain('No separate offer, price, checkout, payment link');
    expect(after[0].statement).toContain('Etsy remains the purchasing and delivery channel');

    const identity = (await publicIdentityOf(X))!;
    expect(identity.slug).toBe(PROOF2_SLUG);
  });

  it('is idempotent: a second pass changes nothing and says so', async () => {
    expect(await keepProof2sEntryCurrent(OWNER)).toBe('already');
    expect(await keepProof2sEntryCurrent(OWNER)).toBe('already');
    const after = (await boundariesFor(P)).filter((b) => b.subject === 'publish');
    expect(after).toHaveLength(1);
  });

  it('leaves the lifted row behind as history rather than editing one in place', async () => {
    const all = (await query(
      `SELECT mode, statement, lifted_at, lifted_reason FROM owner_boundaries
        WHERE product_id = ? AND subject = 'publish' ORDER BY rowid`, [P]))
      .rows as unknown as Array<Record<string, unknown>>;
    // Every earlier row is lifted with a reason; only the narrowed one stands.
    const live = all.filter((r) => r.lifted_at == null);
    expect(live).toHaveLength(1);
    expect(String(live[0].statement)).toBe(PROOF2_ENTRY_AUTHORISED.statement);
    const oldOne = all.find((r) => String(r.statement) === AS_WRITTEN)!;
    expect(oldOne.lifted_at).not.toBeNull();
    expect(String(oldOne.lifted_reason)).toBeTruthy();
  });
});

describe('the entry it permits, and the offer it does not', () => {
  it('carries no price anywhere in the words that will be published', () => {
    const everyField = Object.values(PROOF2_PUBLIC).join(' ');
    expect(everyField).not.toMatch(/\$\d/);
    expect(everyField).not.toMatch(/\b14\b/);
    expect(everyField.toLowerCase()).not.toContain('checkout');
    expect(everyField.toLowerCase()).not.toContain('payment link');
  });

  it('says what it is, who it is for, and who is responsible', () => {
    expect(PROOF2_PUBLIC.summary.toLowerCase()).toContain('bidding');
    expect(PROOF2_PUBLIC.who.toLowerCase()).toContain('contractors');
    expect(PROOF2_PUBLIC.note).toContain('Apex Micro');
  });

  it('does not carry the operator\'s name, which is not one of the two disclosures', () => {
    const everyField = Object.values(PROOF2_PUBLIC).join(' ');
    expect(everyField).not.toContain('Thomas');
    expect(everyField).not.toContain('Norton');
  });

  it('still does not publish, because nothing has reached a customer yet', async () => {
    // THE LISTING IS NOT LIVE. He said so. The boundary is no longer what
    // stands in the way — the absence of any exposure is — and the reader must
    // say that rather than implying the entry is up.
    const shown = await howItShouldShow(X);
    expect(shown.yourWord).toBeNull();
    expect(shown.shape).toBe('not_public');
    expect(shown.because.join(' ')).toContain('never been put in front of anybody');
  });
});

describe('it does not generalise, which he asked for by name', () => {
  it('refuses a boundary he has reworded since authorising this', async () => {
    await query(
      `UPDATE owner_boundaries SET lifted_at = datetime('now'), lifted_reason = 'he changed his mind'
        WHERE product_id = ? AND subject = 'publish' AND lifted_at IS NULL`, [P]);
    await setBoundary({
      productId: P, subject: 'publish', mode: 'never',
      statement: 'Publish nothing for the workbook at all, I have changed my mind',
    });

    expect(await keepProof2sEntryCurrent(OWNER)).toBe('not_the_boundary_he_narrowed');

    // AND IT CHANGED NOTHING. His newer words stand.
    const after = (await boundariesFor(P)).filter((b) => b.subject === 'publish');
    expect(after).toHaveLength(1);
    expect(after[0].mode).toBe('never');
    expect(after[0].statement).toContain('changed my mind');

    await restoreTheOldNever(P);
  });

  it('refuses another founder\'s books, because the tick runs for every Workshop', async () => {
    expect(await keepProof2sEntryCurrent(OTHER)).toBe('no_record');
  });

  it('refuses a test with the right name whose offer is not this venue\'s listing', async () => {
    // The authorisation is about a workbook sold on a venue. A test wearing the
    // same title whose offer the Workshop carries itself is a different thing.
    const other = await seedProof2(OTHER);
    // Through the proper door: a material is immutable, so the shape is
    // SUPERSEDED rather than edited — the guard refusing an in-place rewrite is
    // itself working correctly here.
    const { recordMaterial } = await import('../../src/services/venture/hand.js');
    const carriedHere = { ...PROOF2_PLAN } as Record<string, unknown>;
    delete carriedHere.listing;
    carriedHere.venue = 'workshop';
    await recordMaterial({
      founderId: OTHER, experimentId: other.experimentId, kind: 'offer_shape',
      title: 'The offer\'s shape', body: JSON.stringify(carriedHere), by: 'test:rewrite',
    });
    expect(await keepProof2sEntryCurrent(OTHER)).toBe('not_the_authorised_record');
  });
});

describe('the authorisation is in the repository, not only in a chat', () => {
  it('keeps his words verbatim and dated, the way the clarification is kept', () => {
    expect(PROOF2_ENTRY_AUTHORISED.on).toBe('2026-09-22');
    expect(PROOF2_ENTRY_AUTHORISED.said).toContain('solely to permit its concise Apex Micro portfolio entry');
    expect(PROOF2_ENTRY_AUTHORISED.said).toContain('Do not generalize this authorization');
    expect(PROOF2_ENTRY_AUTHORISED.said).toContain('does not extend to publishing a separate offer');
  });

  it('names the test it was authorised for, so a rename cannot carry it elsewhere', () => {
    expect(PROOF2_TITLE).toContain('Bid Decision Workbook');
  });
});
