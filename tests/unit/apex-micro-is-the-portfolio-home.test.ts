// =============================================================================
// APEX MICRO IS THE PORTFOLIO HOME, NOT THE STOREFRONT.
//
// The owner's clarification: Private Foundry carries the intelligence and the
// operating work and stays private; Apex Micro is the public business identity,
// credible enough that somebody can tell who is responsible for an offer; and
// each asset reaches customers through whatever channel suits its actual
// economic mechanism. A workbook sold on Etsy is discovered, bought and
// delivered on Etsy, and Apex Micro says what it is, who stands behind it, and
// links there.
//
// THE CODE HAD EXACTLY ONE SHAPE. A full six-section product page, or nothing
// at all — which is why Experiment 002 sells on Etsy today with no presence on
// the site whatsoever. The missing shape is a portfolio entry, and the things
// that stood in its way were specific: the listing URL was classed as a secret,
// and the publication gate demanded a price and a way to pay.
//
// AND IT IS NOT A LADDER. Nothing progresses through these shapes. An asset may
// sit at `portfolio_entry` for its whole life and that is a complete answer.
//
// Nobody real is written to; every provider is stubbed at the network edge.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, seedProductionShape } from '../helpers/world.js';
import { howItShouldShow } from '../../src/services/public-workshop/how-it-should-show.js';
import { privateStringsOf, projectExperiment, workshopFactsOfExperiment } from '../../src/services/public-workshop/projection.js';
import { renderExperiment } from '../../src/services/public-workshop/site.js';

let X = '';

beforeAll(async () => {
  await seedProductionShape({
    charter: true, searching: true, eyes: true, settledBy: 'the world', earsOpen: true,
  });
  const { findProof1 } = await import('../../src/services/venture/proof-1.js');
  X = (await findProof1(OWNER))!;
});

describe('the reader is a judgement, and deliberately not a score', () => {
  it('carries no number anybody could optimise', () => {
    // THE OWNER ASKED FOR PATTERNS, NOT A SCORING SYSTEM, and the reason is the
    // one that keeps every other judgement here unscored: a number invites the
    // reader to move it, and what is wanted is a decision somebody can argue
    // with. A reviewer should be able to grep this file and find none.
    const src = readFileSync('src/services/public-workshop/how-it-should-show.ts', 'utf8');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    expect(/\bscore\b|\brank\b|\bweight\b|\bindex\b|\btier\b|\blevel\b/i.test(code)).toBe(false);
    // No ordering between shapes: nothing compares one to another.
    expect(/shape\s*[<>]|>=\s*'|<=\s*'/.test(code)).toBe(false);
  });

  it('says what it read, never an adjective on its own', async () => {
    const shown = await howItShouldShow(X);
    expect(shown.because.length).toBeGreaterThan(0);
    for (const b of shown.because) expect(b.length).toBeGreaterThan(12);
  });
});

describe('the Workshop as the venue is still a product page', () => {
  it('reads Experiment 001 as a product page', async () => {
    const shown = await howItShouldShow(X);
    expect(shown.shape).toBe('product_page');
    expect(shown.because.join(' ')).toContain('the Workshop\'s own page is the venue');
    expect(shown.mustCarry).toContain('who is responsible for it, by business name');
    expect(shown.mustCarry.join(' ')).toContain('what it costs');
  });

  it('still renders the full record, unchanged', async () => {
    const x = (await projectExperiment(X))!;
    expect(x.shape).toBe('product_page');
    expect(x.whereToGetIt).toBeNull();
    const html = renderExperiment((await workshopFactsOfExperiment(X))!, x);
    for (const section of ['What you get', 'Why I wrote to you', 'Who it\'s for',
      'What it doesn\'t cover', 'Where it comes from', 'Who I am']) {
      expect(html).toContain(section);
    }
  });
});

describe('what reached nobody is not published', () => {
  it('answers not_public for a test that was never put in front of anyone', async () => {
    await query(
      `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question)
       SELECT 'pf_u', founder_id, opportunity_id, 'never asked' FROM venture_experiments WHERE id = ?`, [X]);
    await query(
      `INSERT INTO venture_experiments
         (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect,
          would_disprove, evidence_mode)
       SELECT 'pf_internal', founder_id, opportunity_id, 'pf_u', 'think about it',
              'nothing', 'nothing', 'real' FROM venture_experiments WHERE id = ?`, [X]);

    const shown = await howItShouldShow('pf_internal');
    expect(shown.shape).toBe('not_public');
    expect(shown.because.join(' ')).toContain('never been put in front of anybody');
  });

  it('answers not_public when the owner has said never, whatever else is true', async () => {
    // AN OWNER'S never IS DECISIVE AND IS NEVER REASONED AROUND. A product
    // clarification does not quietly lift a boundary he set by name.
    const p = (await query(
      `SELECT id FROM products WHERE from_experiment_id = ? AND deleted_at IS NULL`, [X]))
      .rows[0] as Record<string, unknown> | undefined;
    if (!p) return;
    const { setBoundary } = await import('../../src/services/institution/standing-intent.js');
    await setBoundary({ productId: String(p.id), subject: 'publish', mode: 'never',
      statement: 'Foundry publishes nothing for this one' });

    const shown = await howItShouldShow(X);
    expect(shown.shape).toBe('not_public');
    expect(shown.because[0]).toContain('you said so');
    expect(shown.mustCarry).toHaveLength(0);
  });
});

describe('a Stripe link is a secret and a listing address is not', () => {
  it('keeps every exposure reference private for an offer the Workshop carries', async () => {
    // THE RULE THIS NARROWING MUST NOT BREAK. A payment-link id is a private
    // handle on a live checkout and must never appear on a page, by any path.
    const refs = (await query(
      `SELECT exposure_ref FROM experiment_exposures WHERE experiment_id = ?`, [X]))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(refs.length).toBeGreaterThan(0);
    const secrets = await privateStringsOf(X);
    for (const r of refs) expect(secrets).toContain(String(r.exposure_ref));
  });

  it('never lets a payment-link reference onto the rendered page', async () => {
    const { leakIn } = await import('../../src/services/public-workshop/projection.js');
    const x = (await projectExperiment(X))!;
    const html = renderExperiment((await workshopFactsOfExperiment(X))!, x);
    expect(leakIn(html, await privateStringsOf(X))).toBeNull();
  });
});

// =============================================================================
// THE MISSING SHAPE, AGAINST A REAL VENUE-SOLD ASSET.
//
// Experiment 002 sells a workbook on Etsy: the venue carries discovery,
// payment and delivery. What Apex Micro owes is not a second checkout — the
// owner was explicit that duplicating the venue's fulfilment experience is the
// thing to avoid — but a way for somebody to check who stands behind it, and a
// way to get there from here.
// =============================================================================

describe('a venue-sold asset gets an entry, not a storefront', () => {
  const LISTING = 'https://www.etsy.com/listing/1234567890/bid-decision-workbook';
  let V = '';

  beforeAll(async () => {
    const { seedProof2, approveListing, recordListing } =
      await import('../../src/services/venture/proof-2.js');
    const seeded = await seedProof2(OWNER);
    V = seeded.experimentId;
    await approveListing({ founderId: OWNER, experimentId: V });
    await recordListing({ founderId: OWNER, experimentId: V, url: LISTING });
    // The owner's narrowed word: an entry may go up, and it asks him each time.
    const p = (await query(
      `SELECT id FROM products WHERE from_experiment_id = ? AND deleted_at IS NULL`, [V]))
      .rows[0] as Record<string, unknown>;
    const { givePublicIdentity } = await import('../../src/services/public-workshop/identity.js');
    await givePublicIdentity({
      experimentId: V, founderId: OWNER, slug: 'bid-decision-workbook',
      copy: {
        title: 'Bid Decision Workbook', summary: 'A spreadsheet for deciding whether a job is worth bidding.',
        who: 'Small contractors who price their own work.', what: 'One .xlsx file.',
        limits: 'It does not price the job for you.', sources: 'Built from the way estimators actually work.',
        selection: 'You found it on the listing.', note: 'A small digital workshop in Massachusetts.',
      },
    });
    expect(String(p.id)).toBeTruthy();
  });

  it('reads it as a portfolio entry, because the venue carries the sale', async () => {
    const shown = await howItShouldShow(V);
    expect(shown.shape).toBe('portfolio_entry');
    expect(shown.because.join(' ')).toContain('Etsy');
    expect(shown.because.join(' ')).toContain('discovery, payment and delivery');
    // AND IT WAITS FOR HIM. The narrowed boundary is ask-first, not open.
    expect(shown.because.join(' ')).toContain('waits for you each time');
    // The floor holds whatever the shape: a customer can always find out who
    // is responsible and reach a person.
    expect(shown.mustCarry).toContain('who is responsible for it, by business name');
    expect(shown.mustCarry).toContain('a way to reach a person');
    expect(shown.mustCarry.join(' ')).toContain('Etsy takes the payment');
  });

  it('publishes the listing address, which is not a secret', async () => {
    // THE OWNER PUT THAT URL ON A PUBLIC SITE HIMSELF. Classing it with the
    // Stripe payment-link ids meant the entry carrying it would have been
    // silently skipped at publication rather than published.
    expect(await privateStringsOf(V)).not.toContain(LISTING);
    const x = (await projectExperiment(V))!;
    expect(x.shape).toBe('portfolio_entry');
    expect(x.whereToGetIt).toEqual({ url: LISTING, venueName: 'Etsy' });
  });

  it('renders an entry that links out and sells nothing here', async () => {
    const x = (await projectExperiment(V))!;
    const html = renderExperiment((await workshopFactsOfExperiment(V))!, x);

    expect(html).toContain(LISTING);
    expect(html).toContain('Get it on Etsy');
    expect(html).toContain('Etsy takes the payment and delivers it');
    // WHO IS RESPONSIBLE, which is what somebody came to this page to check.
    expect(html).toContain('Apex Micro is the seller');
    expect(html).toContain('/contact');

    // AND NONE OF THE PRODUCT PAGE. No checkout, no price, and none of the six
    // sections that describe a purchase happening here — because it does not.
    expect(html).not.toContain('What you get');
    expect(html).not.toContain('Where it comes from');
    expect(html).not.toContain('Stripe');
    expect(html).not.toMatch(/\$\d/);
  });

  it('does not claim this site\'s refund path for a sale made elsewhere', async () => {
    const x = (await projectExperiment(V))!;
    const html = renderExperiment((await workshopFactsOfExperiment(V))!, x);
    expect(html).toContain('Refunds for anything bought on Etsy go through Etsy');
    expect(html).toContain('covers what you buy directly from Apex Micro, which this is not');
  });

  it('is not judged by a gate written for an offer the Workshop carries', async () => {
    // Price, payment link, cadence and sender authentication are category
    // errors here. A gate demanding them would make the shape unpublishable.
    const x0 = (await projectExperiment(V))!;
    const { publicationGate } = await import('../../src/services/public-workshop/publication.js');
    const gate = await publicationGate(V, { verifyLive: false });
    const said = gate.failures.join(' | ');
    expect(said).not.toContain('states no price');
    expect(said).not.toContain('no way to pay');
    expect(said).not.toContain('sending identity');
    expect(said).not.toContain('no subscription');
    expect(said).not.toContain('states no price, and this one does');

    // AND THE BOUNDARY REFUSES TO HAND IT ONE AT ALL, so the renderer is not
    // the only thing standing between a listing's price and this site.
    expect(x0.price).toBeNull();
    expect(x0.payUrl).toBeNull();
  });
});
