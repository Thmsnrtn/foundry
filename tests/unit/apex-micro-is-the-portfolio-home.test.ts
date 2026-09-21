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
    // AND THIS IS NOT THE OWNER'S WORD. The shape is small because the rows
    // cannot describe it, which is a reading; `yourWord` is the permission, and
    // only it holds a page at publication. Conflating the two deadlocked the
    // asset whose own page is the venue.
    expect(shown.yourWord).toBeNull();
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

// THE VENUE-SOLD ASSET, SEEDED ONCE AT MODULE SCOPE. Four later describes read
// it, and it was first declared inside the describe below — which passed the
// one suite that used it and threw `V is not defined` in every other.
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

describe('a venue-sold asset gets an entry, not a storefront', () => {
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

  it('names the venue\'s mechanism without narrowing the promise', async () => {
    // THIS TEST PINNED THE WRONG COPY AND THE REPAIR ROUND CHANGED IT. The
    // first entry told an Etsy buyer the refunds page "covers what you buy
    // directly from Apex Micro, which this is not" — while the live Etsy
    // listing sends that buyer to that very page, and promises a refund with
    // no form and no time limit. The entry contradicted a standing customer
    // promise to narrow one. What actually differs between channels is where
    // the money goes back through, and that is all the entry now says.
    const x = (await projectExperiment(V))!;
    const html = renderExperiment((await workshopFactsOfExperiment(V))!, x);
    expect(html).toContain('You can have your money back');
    expect(html).toContain('No form, no time limit');
    expect(html).toContain('Message me through Etsy and I\'ll refund it there');
    // The mechanism is named because that is where the payment was taken — and
    // a person here is still reachable, so the venue is never the only door.
    expect(html).toContain('a person reads it');
    // AND NOTHING TELLS THIS BUYER THEY ARE OUTSIDE THE PROMISE.
    expect(html).not.toContain('which this is not');
    expect(html).not.toMatch(/only covers|does not cover/i);
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

// =============================================================================
// WHAT TWO REVIEW CELLS FOUND, CLOSED.
//
// Both found the same severe one independently: the reader's headline rule —
// an owner's `never` is decisive and is never reasoned around — was enforced in
// exactly one function whose output nothing on the publishing path read. The
// guarantee was a comment. These are the tests that make it a rule.
// =============================================================================

describe('the owner\'s word decides what goes up, not a comment saying so', () => {
  it('holds a page whose owner said never, on the pass that publishes', async () => {
    // FAILING SCENARIO BEFORE THIS: the owner sets publish:never after a
    // complaint. `howItShouldShow` returns not_public, `renderExperiment` falls
    // straight past the one branch that reads the shape, and the next hourly
    // pass republishes the full product page with its price and Buy button
    // intact. The world sees no change at all.
    const { setBoundary } = await import('../../src/services/institution/standing-intent.js');
    const p = (await query(
      `SELECT id FROM products WHERE from_experiment_id = ? AND deleted_at IS NULL
        ORDER BY rowid LIMIT 1`, [V])).rows[0] as Record<string, unknown>;
    await setBoundary({ productId: String(p.id), subject: 'publish', mode: 'never',
      statement: 'Take it down and publish nothing for it' });

    const shown = await howItShouldShow(V);
    expect(shown.shape).toBe('not_public');

    const { publishSite } = await import('../../src/services/public-workshop/publication.js');
    const report = await publishSite(OWNER, 'test:the-owner-said-never');
    const entryPath = '/experiments/bid-decision-workbook';
    expect(report.held.map((h) => h.path)).toContain(entryPath);
    expect(report.published).not.toContain(entryPath);
    expect(report.unchanged).not.toContain(entryPath);
    expect(report.held.find((h) => h.path === entryPath)?.reason).toContain('you said so');
  });

  it('holds it for ask_first too, because a routine cannot satisfy "ask me"', async () => {
    // `publish` has a NULL door in `owner_boundary_subjects`, so the kill
    // switch never sees it and ask_first was enforced by nothing whatsoever.
    // An hourly pass must not read a shape as permission.
    const { setBoundary } = await import('../../src/services/institution/standing-intent.js');
    const p = (await query(
      `SELECT id FROM products WHERE from_experiment_id = ? AND deleted_at IS NULL
        ORDER BY rowid LIMIT 1`, [V])).rows[0] as Record<string, unknown>;
    await query(
      `UPDATE owner_boundaries SET lifted_at = datetime('now'), lifted_reason = 'narrowing it'
        WHERE product_id = ? AND subject = 'publish' AND lifted_at IS NULL`, [String(p.id)]);
    await setBoundary({ productId: String(p.id), subject: 'publish', mode: 'ask_first',
      statement: 'Ask me before you publish anything for it' });

    const shown = await howItShouldShow(V);
    expect(shown.shape).toBe('portfolio_entry');
    expect(shown.yourWord).toBe('ask_first');

    const { publishSite } = await import('../../src/services/public-workshop/publication.js');
    const report = await publishSite(OWNER, 'test:ask-me-first');
    const entryPath = '/experiments/bid-decision-workbook';
    expect(report.held.map((h) => h.path)).toContain(entryPath);
    expect(report.held.find((h) => h.path === entryPath)?.reason).toContain('waits for you');
  });

  it('holds for his word and never for a shape it could not yet read', async () => {
    // THE OTHER HALF OF THE SAME RULE, AND THE MORE EXPENSIVE HALF TO GET
    // WRONG. The first version of the filter held on any `not_public`, and the
    // reader answers `not_public` for anything nothing has reached yet — which
    // deadlocked the one asset whose page IS the venue, because the offer gate
    // will not place an offer until the page is up and the page was being held
    // until an offer existed. `seedProductionShape` failed outright. A hold is
    // the owner overriding an approval he already gave; it is not a second
    // opinion on whether the thing is public at all.
    const { publishSite } = await import('../../src/services/public-workshop/publication.js');
    const report = await publishSite(OWNER, 'test:his-word-only');
    for (const h of report.held) {
      expect(h.reason).toMatch(/you said so|waits for you|publishes nothing for it/);
      expect(h.reason).not.toContain('never been put in front of anybody');
    }
    // THE DEADLOCK'S OWN GUARD IS `seedProductionShape` IN `beforeAll`, and it
    // is a better one than anything assertable here: it cannot complete unless
    // Experiment 001's page goes up BEFORE its offer is placed, which is the
    // exact order the first filter made impossible. Nothing needs asserting
    // about that path at this point in the file — the test above deliberately
    // left a `never` standing on it, so it is held here, correctly.
    expect(report.held.length).toBeGreaterThan(0);
  });

  it('tells the owner a page is held, where he reads that it is not up', async () => {
    // A HOLD HE CANNOT SEE IS THE SAME TO HIM AS A PAGE THAT QUIETLY STOPPED
    // UPDATING. `publishSite` reported `published`, `unchanged` and `failed`
    // and said nothing about what it deliberately withheld, so the owner's own
    // word being applied left no trace on any screen. One read-only reader now
    // answers the same question for the pass and for his Workshop page.
    const { heldFromPublishing } = await import('../../src/services/public-workshop/publication.js');
    const holds = await heldFromPublishing(OWNER);
    const entry = holds.find((h) => h.path === '/experiments/bid-decision-workbook');
    expect(entry).toBeTruthy();
    expect(entry!.reason).toContain('waits for you');
    expect(entry!.title).toBeTruthy();
    // AND IT PUBLISHES NOTHING BY BEING LOOKED AT: the same call, twice, with
    // no publication in between, answers the same.
    expect(await heldFromPublishing(OWNER)).toEqual(holds);
  });

  it('takes the strictest word, not the first row it finds', async () => {
    // A global `never` written after a product-scoped `ask_first` was silently
    // ignored, because the reader took `.find`'s first match and the two share
    // a sort order.
    const { setBoundary } = await import('../../src/services/institution/standing-intent.js');
    await setBoundary({ productId: null, subject: 'publish', mode: 'never',
      statement: 'Publish nothing anywhere for now' });
    expect((await howItShouldShow(V)).shape).toBe('not_public');
    await query(
      `UPDATE owner_boundaries SET lifted_at = datetime('now'), lifted_reason = 'done'
        WHERE product_id IS NULL AND subject = 'publish' AND lifted_at IS NULL`);
  });
});

describe('an entry never falls through to a product page', () => {
  it('says there is nowhere to buy it rather than rendering a checkout', async () => {
    // THE WORST FALL-THROUGH. An entry whose listing address cannot be resolved
    // used to render the SIX-SECTION PRODUCT PAGE, complete with "Buying this
    // here, Stripe handles the payment" — the exact false sentence this whole
    // change exists to remove. Uncertainty must go less public, never more.
    const x = (await projectExperiment(V))!;
    const html = renderExperiment((await workshopFactsOfExperiment(V))!,
      { ...x, whereToGetIt: null });
    expect(html).toContain('isn\'t listed at the moment');
    expect(html).not.toContain('Buying this here');
    expect(html).not.toContain('What you get');
    expect(html).not.toContain('Why I wrote to you');
    // AND WHAT WAS PROMISED TO ANYBODY WHO ALREADY BOUGHT STILL STANDS.
    expect(html).toContain('still stands');
  });
});

describe('the promise is the same wherever you bought it', () => {
  it('does not send an Etsy buyer to a remedy the site says is not theirs', async () => {
    // THE LISTING ITSELF TELLS THEM TO COME HERE. `LISTING_MD` reads "Message
    // me through Etsy or use the refunds page at apexmicro.ai/refunds. No form
    // and no time limit." The first version of the entry then told them that
    // page covers what you buy directly "which this is not" — contradicting a
    // live customer promise and pointing at a remedy Etsy does not grant on an
    // instant download. What differs between channels is the mechanism.
    const x = (await projectExperiment(V))!;
    const html = renderExperiment((await workshopFactsOfExperiment(V))!, x);
    expect(html).toContain('You can have your money back');
    expect(html).toContain('No form, no time limit');
    expect(html).not.toContain('which this is not');
    expect(html).toContain('refund it there');
  });

  it('keeps the promise unconditional on the refunds page for both channels', async () => {
    const { renderRefunds } = await import('../../src/services/public-workshop/site.js');
    const html = renderRefunds((await workshopFactsOfExperiment(V))!);
    expect(html).toContain('Bought here');
    expect(html).toContain('Bought on a marketplace');
    // PINNED ON THE CLAIM, NOT ON WHERE THE PROSE HAPPENS TO WRAP. The first
    // version of this assertion carried a newline from the source's own line
    // break, so re-flowing a paragraph would have failed a test about refunds.
    expect(html.replace(/\s+/g, ' ')).toContain('the promise is the same one');
    expect(html.replace(/\s+/g, ' ')).toContain('mine is not limited by it');
    // AND NOT THE WORDING THAT HANDED THE REMEDY TO THE VENUE.
    expect(html).not.toContain('under its policy and the terms on the listing');
    expect(html.replace(/\s+/g, ' ')).not.toMatch(/refunded by that marketplace/i);
  });
});
