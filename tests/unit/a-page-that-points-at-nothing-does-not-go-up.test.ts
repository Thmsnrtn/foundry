// =============================================================================
// A PAGE THAT POINTS AT NOTHING DOES NOT GO UP.
//
// Caught by a probe run before a deploy, and it would have been ugly.
//
// The owner authorised a portfolio entry for the Etsy workbook. Applying that
// gave the workbook its public identity, which made it a member of the
// registry; nothing held it, because his `never` no longer did; and its shape
// is `not_public` for want of any exposure — which is not one of the two
// shapes the entry renderer takes. So Apex Micro would have published the full
// six-section PRODUCT page for it, carrying the $14 price, for a listing that
// does not exist and nobody can buy from.
//
// That is the exact thing his authorisation excludes: "no separate offer,
// price, checkout, payment link, or fulfilment process on Apex Micro."
//
// THE RULE IS MECHANISM-AWARE, BECAUSE THE OPPOSITE ONE DEADLOCKED THE OTHER
// ASSET. A Workshop-carried offer's page IS its venue: it must go up before an
// offer can be placed, and holding it until something had reached somebody is
// the deadlock this file's neighbour already learned about the hard way. A
// listing's page is a pointer, and a pointer at nothing is worse than no page.
// So the question is asked only of an offer carried elsewhere: is the
// elsewhere there yet.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'c'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { OWNER, seedProductionShape } from '../helpers/world.js';
import { query } from '../../src/db/client.js';
import {
  PROOF2_SLUG, approveListing, keepProof2sEntryCurrent, recordListing, seedProof2,
} from '../../src/services/venture/proof-2.js';
import { setBoundary } from '../../src/services/institution/standing-intent.js';

const PATH = `/experiments/${PROOF2_SLUG}`;
const AS_WRITTEN = 'Foundry publishes nothing for this test; the listing is my own act on the venue';
let X = '';

beforeAll(async () => {
  await seedProductionShape({ charter: true, searching: true, eyes: true, settledBy: 'the world', earsOpen: true });
  const seeded = await seedProof2(OWNER);
  X = seeded.experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  // Rewind to the row production actually carries, then apply his narrowing.
  const p = (await query(
    `SELECT id FROM products WHERE from_experiment_id = ? AND deleted_at IS NULL ORDER BY rowid LIMIT 1`, [X]))
    .rows[0] as Record<string, unknown>;
  await query(
    `UPDATE owner_boundaries SET lifted_at = datetime('now'), lifted_reason = 'rewinding'
      WHERE product_id = ? AND subject = 'publish' AND lifted_at IS NULL`, [String(p.id)]);
  await setBoundary({ productId: String(p.id), subject: 'publish', mode: 'never', statement: AS_WRITTEN });
  expect(await keepProof2sEntryCurrent(OWNER)).toBe('narrowed');
});

describe('while the listing does not exist', () => {
  it('holds the page and says why, in words he can act on', async () => {
    const { publishSite } = await import('../../src/services/public-workshop/publication.js');
    const report = await publishSite(OWNER, 'test:no-listing-yet');
    expect(report.published).not.toContain(PATH);
    expect(report.unchanged).not.toContain(PATH);
    const held = report.held.find((h) => h.path === PATH);
    expect(held).toBeTruthy();
    expect(held!.reason).toContain('no listing to point at yet');
    expect(held!.reason).toContain('nobody can buy');
  });

  it('shows the same hold on his Workshop page, so it is not silent', async () => {
    const { heldFromPublishing } = await import('../../src/services/public-workshop/publication.js');
    expect((await heldFromPublishing(OWNER)).map((h) => h.path)).toContain(PATH);
  });

  it('publishes no price for it anywhere, which is the half of his word that stands', async () => {
    const { publishSite } = await import('../../src/services/public-workshop/publication.js');
    const report = await publishSite(OWNER, 'test:no-price');
    expect(report.published.concat(report.unchanged)).not.toContain(PATH);
  });

  it('does not hold the asset whose own page IS its venue', async () => {
    // THE DEADLOCK THIS RULE MUST NOT RECREATE. Experiment 001 sells through
    // the Workshop's own checkout: its page has to go up before an offer can
    // be placed against it, and `seedProductionShape` would not have completed
    // above if this rule had touched it.
    const { publishSite } = await import('../../src/services/public-workshop/publication.js');
    const report = await publishSite(OWNER, 'test:workshop-still-fine');
    expect(report.held.map((h) => h.path)).not.toContain('/experiments/ma-millwork-bid-brief');
  });
});

describe('once the listing exists', () => {
  it('goes up, as an entry, with no price on it', async () => {
    await recordListing({
      founderId: OWNER, experimentId: X,
      url: 'https://www.etsy.com/listing/5544332211/bid-decision-workbook',
    });
    const { publishSite } = await import('../../src/services/public-workshop/publication.js');
    const report = await publishSite(OWNER, 'test:listed-now');
    expect(report.held.map((h) => h.path)).not.toContain(PATH);
    expect(report.published.concat(report.unchanged)).toContain(PATH);

    const { projectExperiment } = await import('../../src/services/public-workshop/projection.js');
    const x = (await projectExperiment(X))!;
    expect(x.shape).toBe('portfolio_entry');
    // His limit, enforced at the projection boundary rather than trusted to a
    // renderer.
    expect(x.price).toBeNull();
    expect(x.payUrl).toBeNull();
    expect(x.whereToGetIt?.venueName).toBe('Etsy');
  });
});
