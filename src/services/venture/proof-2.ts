// =============================================================================
// PROOF 2 — THE SECOND REAL EXPERIMENT, AS ROWS THE INSTITUTION ALREADY HAS.
//
// A $14 one-time bid-decision workbook for small contractors, listed by the
// owner himself on a marketplace with its own buyer search (Etsy), under Apex
// Micro with the AI-assistance disclosure, with no promotion, no email and no
// outreach of any kind, under a $25 allowance and a thirty-day window, settled
// by what the venue reports. Owner direction 2026-09-15; the record is
// river/proof-2/.
//
// Proof 1 pushed one offer to twenty-one businesses through Foundry's hand and
// heard nothing. Proof 2 is pull: the customer arrives, or does not, through
// distribution the venue controls. Foundry contacts nobody, publishes nothing
// and spends nothing. What it does is design, seal, govern, record and settle.
//
// This seeds nothing River-shaped. It writes a candidate under his search, the
// claim and the platform observations it rests on, the unknown the test
// answers, the experiment with its sealed rule, the materials, and the
// recorded design with its rival readings, refused exchanges, true costs and
// stop conditions. It spends nothing, permits nothing and contacts no one: the
// owner's acts (approve; open the shop and list; paste the address; enter the
// venue's readings) come after, on /foundry/experiments/:id.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { currentMandate, openMandate, stopMandate } from './mandate.js';
import { formClaim, observe } from './market-evidence.js';
import { decideExperiment, designExperiment } from './validation.js';
import {
  HandRefused, experimentRow, materialOf, offerShapePlanOf, recordMaterial, statedShapeAndFacts,
} from './hand.js';
import type { OfferShapePlan } from './hand.js';
import { designOf, recordDesign, sealDesign, designStandsInTheWay, stopConditionsMet } from './probe-design.js';
import { exposureOf, placeExposure, recordBusinessOutcome, settleFromTheWorld, withdrawExposure } from './outcome.js';
import { setBoundary } from '../institution/standing-intent.js';
import { record as recordEconomicEvent } from '../economy/ledger.js';
import { HOW_TO_MD, LISTING_MD, OWNER_ACTS_MD, PRIVACY_POLICY_MD, WORKBOOK_BYTES, WORKBOOK_FILE, WORKBOOK_SHA256 } from './proof-2-content.js';

export const PROOF2_TITLE = 'Bid Decision Workbook for small contractors, version 1.0';
export const PROOF2_VENUE = 'etsy';
export const PROOF2_PRICE_CENTS = 1400;
export const PROOF2_ALLOWANCE_CENTS = 2500;
export const PROOF2_WINDOW_DAYS = 30;
/** When the platform and demand evidence was read. An observation is a record of a moment. */
export const PROOF2_OBSERVED_AT = new Date('2026-09-15T12:00:00Z');
const BY = 'institution:seed:proof-2';
const DESIGNED_BY = 'institution:probe_designer';

/** What was seen, and where. Every source is Etsy's own page or a comparable listing; nothing is a model's estimate. */
const OBSERVATIONS: Array<{ sourceType: string; source: string; saw: string; bearing: 'supports' | 'contradicts'; directness: 'direct' | 'inferred' }> = [
  { sourceType: 'marketplace', source: 'https://www.etsy.com/market/general_contractor_spreadsheet_template',
    saw: 'Several listings for contractor bid trackers and estimate templates are for sale at roughly $10 to $20, including a construction bid tracker at $19.99 from a seller carrying the Star Seller badge, with reviews; on this venue a review can only follow a purchase and a download.', bearing: 'supports', directness: 'direct' },
  { sourceType: 'marketplace', source: 'https://www.etsy.com/listing/1253661489/bid-tracker-spreadsheet-google-sheets',
    saw: 'A Google Sheets bid tracker listing with reviews and a Star Seller badge, describing bid summary, status tracking and value-by-period dashboards.', bearing: 'supports', directness: 'direct' },
  { sourceType: 'vendor_site', source: 'https://help.etsy.com/hc/en-us/articles/115015628207-Shop-Stats-Glossary',
    saw: 'Etsy reports to the seller, per listing, views, visits, favourites, orders, revenue, conversion rate and traffic source (Etsy search; Etsy app and other Etsy pages; Etsy marketing and SEO; Etsy Ads; Offsite Ads; direct; social); Search Analytics reports the queries shoppers used, impressions and average position. No statistic reports a download.', bearing: 'supports', directness: 'direct' },
  { sourceType: 'vendor_site', source: 'https://www.etsy.com/legal/fees/',
    saw: 'Fees: $0.20 per listing for four months renewing at $0.20 on each sale; 6.5% transaction; 3% + $0.25 processing; a one-time non-refundable $15 shop set-up fee; Offsite Ads at 15% of an attributed order with opt-out permitted below $10,000 in 365 days; Etsy Ads off unless started.', bearing: 'supports', directness: 'direct' },
  { sourceType: 'vendor_site', source: 'https://www.etsy.com/legal/creativity/',
    saw: 'Designed-by-seller digital downloads made with AI assistance are permitted with a disclosure; listings that omit it are removed; AI prompt bundles are prohibited.', bearing: 'supports', directness: 'direct' },
  { sourceType: 'vendor_site', source: 'https://help.etsy.com/hc/en-us/articles/115013293148-When-Can-I-Leave-a-Review-for-My-Order',
    saw: 'Reviews on digital items open 100 days from the first download; a buyer must download before opening a not-as-described case; the seller may refund at any time through Etsy Payments.', bearing: 'supports', directness: 'direct' },
  { sourceType: 'vendor_site', source: 'https://help.etsy.com/hc/en-us/articles/360046998234-How-to-Receive-Your-Etsy-Payments-Deposit',
    saw: 'Identity is verified through Persona and the bank account name must match the ID; new sellers\' funds are eligible for deposit about 14 days after a sale, weekly on Mondays by default, with a 5-day hold after bank changes; digital sales are not held in a payment reserve.', bearing: 'supports', directness: 'direct' },
];

export const PROOF2_PLAN: OfferShapePlan = {
  shape: {
    sells: 'a one-time bid-decision workbook for small contractors: a bid pipeline with due and follow-up flags, a bid/no-bid line from the contractor\'s own win rate by lead source, a win/loss log with reasons, and a one-page summary; one .xlsx file that also imports into Google Sheets',
    claimsMade: 'that it helps decide which bids to chase and shows whether the chased ones are won; that it is not estimating, invoicing, scheduling or job-costing software; that nothing recurs; that it was designed with AI assistance and checked by hand; refund on request',
    collects: 'nothing directly: the venue shows the seller the buyer\'s name and Etsy email for the order, which are used for nothing but the order; Foundry\'s records hold the order number and amounts and never the buyer',
    deliversBy: 'the venue\'s instant download, made available the moment payment confirms; nobody does anything by hand per sale',
    sellsTo: 'small contractors and trade shops who bid for work and shop the venue for business spreadsheets, wherever the venue sells; self-selected by search, nobody written to',
    chargesHow: 'one-time, $14 through Etsy Payments, no subscription, refunded on request through the venue',
  },
  lighter: 'a single workbook listed on a venue that already has buyers, takes the money and delivers the file; no site, no account, no software, no sending',
  facts: {
    recurring_billing: { present: 0, grounds: 'Charges: one-time, no subscription; nothing renews' },
    persistent_personal_data: { present: 0, grounds: 'Collects: the venue holds the buyer relationship; Foundry records the order number and amounts and never the buyer' },
    cross_border_selling: { present: 1, grounds: 'Sells to: wherever the venue sells; a marketplace listing cannot be limited to one state, and the venue handles the buyer, the payment and any tax it collects' },
    support_obligation: { present: 0, grounds: 'Delivers: one file, once; a refund on request instead of support; questions answered through the venue\'s messages by a person' },
    manual_fulfilment: { present: 0, grounds: 'Delivers by: the venue\'s instant download; nobody does anything by hand per sale' },
    user_generated_content: { present: 0, grounds: 'Sells: the institution\'s own workbook, nobody else\'s words or images' },
    account_system: { present: 0, grounds: 'Delivers by: the venue; a guest checkout receives the file by receipt email; no account with Apex Micro' },
    two_sided_marketplace: { present: 0, grounds: 'Sells to: one audience, the buyer; the venue is somebody else\'s marketplace, not one this institution runs' },
    one_visit_delivery: { present: 1, grounds: 'Delivers by: instant download; a buyer arrives, understands, pays and receives in one visit' },
    front_loaded_attention: { present: 1, grounds: 'The owner\'s non-delegable work is spent once, before the listing: open the shop, attach the account, review the file and the words, list it; then three short readings' },
  },
  price: {
    amountCents: PROOF2_PRICE_CENTS, currency: 'USD', lookupKey: 'foundry_proof2_bid_decision_workbook_one_time',
    productName: 'Bid Decision Workbook for Small Contractors',
    productMetadata: { app_object: 'experiment_deliverable', plan_key: 'proof2_bid_decision_workbook' },
    confirmationMessage: 'Thank you. The workbook is ready to download.',
  },
  offerSubject: 'Bid Decision Workbook for Small Contractors — Excel & Google Sheets',
  listing: { venue: PROOF2_VENUE, venueName: 'Etsy', readingsAtDays: [7, 14, 30] },
};

export interface Proof2Seed { experimentId: string; opportunityId: string; alreadyExisted: boolean }

/** The experiment already seeded for this owner, if any: by its deliverable's title, the open one first. */
export async function findProof2(founderId: string): Promise<string | null> {
  const r = (await query(
    `SELECT e.id FROM venture_experiments e JOIN experiment_materials m ON m.experiment_id = e.id AND m.kind = 'deliverable'
      WHERE e.founder_id = ? AND e.evidence_mode = 'real' AND m.title = ?
      ORDER BY CASE WHEN e.decision IS NULL THEN 0 WHEN e.decision = 'approved' THEN 1 ELSE 2 END,
               e.proposed_at DESC, e.rowid DESC LIMIT 1`, [founderId, PROOF2_TITLE]))
    .rows[0] as Record<string, unknown> | undefined;
  return r ? String(r.id) : null;
}

/** Idempotent on the owner: a second run refreshes materials and records the design if missing, never a second experiment. */
export async function seedProof2(founderId: string): Promise<Proof2Seed> {
  const founder = (await query('SELECT id FROM founders WHERE id = ?', [founderId])).rows[0];
  if (!founder) throw new Error(`no founder ${founderId}`);
  const existing = await findProof2(founderId);
  if (existing) {
    const e = (await query('SELECT opportunity_id FROM venture_experiments WHERE id = ?', [existing])).rows[0] as Record<string, unknown>;
    await refreshMaterials(founderId, existing);
    await recordProof2Design(founderId, existing);
    return { experimentId: existing, opportunityId: String(e.opportunity_id), alreadyExisted: true };
  }

  let mandate = await currentMandate(founderId);
  // A REHEARSAL SEARCH YIELDS TO A REAL ONE, as for Proof 1. A real search
  // already open is kept: Proof 2 is the next candidate under the same
  // question, and one search runs at a time.
  if (mandate && mandate.evidenceMode !== 'real') {
    await stopMandate(founderId, 'superseded by the second real experiment the owner directed (Proof 2); a rehearsal search yields to a real one');
    mandate = null;
  }
  if (!mandate) {
    const opened = await openMandate({ founderId, statement: 'Find another small digital income stream that would make my portfolio more resilient, and find out whether a buyer will come to it rather than be written to', shape: null, evidenceMode: 'real' });
    if ('refused' in opened) throw new Error(opened.refused);
    mandate = opened;
  }
  const opportunityId = nanoid();
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [opportunityId, mandate.id, founderId,
      'A bid-decision workbook for small contractors, listed where they already shop for spreadsheets',
      'small contractors and trade shops who bid for work and buy business spreadsheets on a marketplace with its own search',
      'a contractor deciding which bids to chase has a blank spreadsheet or nothing; incumbents on the venue sell trackers at $10 to $20 and carry reviews, so the artifact is bought, but a maker with no reviews there has never been seen to sell one',
      'the venue already produces discovery for this artifact class and handles payment, delivery and tax; a listing costs cents; the question it answers, whether anyone comes to Apex Micro unasked, is the one the first experiment could not ask',
      'misread if thirty days pass with no order: then either nobody found the listing (impressions say), or people opened it and were not persuaded at $14 with no reviews, and the second cannot be told from a price objection by this test',
      JSON.stringify(OBSERVATIONS.map((o) => o.source)), 'real']);
  const claimId = await formClaim({ founderId, evidenceMode: 'real', opportunityId,
    claim: 'a small contractor who encounters a bid-decision workbook through the venue\'s own distribution will pay $14 for it before delivery, from a maker with no reviews there' });
  for (const o of OBSERVATIONS) {
    await observe({ founderId, claimId, sourceType: o.sourceType, source: o.source, saw: o.saw, bearing: o.bearing, directness: o.directness, observedAt: PROOF2_OBSERVED_AT, evidenceMode: 'real' });
  }
  const unknownId = nanoid();
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, claim_id, question, blocking, cheapest_test) VALUES (?,?,?,?,?,1,?)`,
    [unknownId, founderId, opportunityId, claimId,
      'Will a buyer who arrives by the venue\'s own distribution pay $14 up front for a bid-decision workbook from a maker with no reviews there?',
      'list one workbook at $14 for thirty days with no promotion and count orders, with the venue\'s own views and impressions as the denominator']);
  const experimentId = await designExperiment({
    founderId, opportunityId, unknownId, claimId, evidenceMode: 'real', costCents: PROOF2_ALLOWANCE_CENTS,
    whatWeDo: 'List one bid-decision workbook for small contractors on Etsy at $14 one-time, under Apex Micro with the AI-assistance disclosure, with no promotion, no email and no outreach of any kind. The owner opens the shop and lists it himself; Foundry contacts nobody, publishes nothing, records what the venue reports, and settles by the rule.',
    whatWeExpect: 'At least one buyer the venue cannot match to the owner pays $14 within thirty days of the listing going live; expected zero to three orders, views in the tens, at least one favourite, and the prior on a first order is below even',
    wouldDisprove: 'Thirty days pass from the listing going live with no order that counts; the owner\'s own or a test purchase never counts, and an order that is later refunded may settle the prediction but never earns the asset',
    // THE PAID EVENT IS THE PAYMENT. On this venue the file is made available
    // the moment payment confirms, so delivery is the platform's fact and is
    // recorded beside the payment; a refund is read from the exposure and
    // disqualifies the asset from being earned.
    settlesWhen: { event: 'payment', atLeast: 1, withinDays: PROOF2_WINDOW_DAYS },
  });
  // The deliverable already exists; no computer is needed for this test.
  await query('UPDATE venture_experiments SET needs_workshop = 0 WHERE id = ?', [experimentId]);
  await refreshMaterials(founderId, experimentId);
  await recordProof2Design(founderId, experimentId);
  return { experimentId, opportunityId, alreadyExisted: false };
}

/** The deliverable on record names the exact file by digest; the listing text is the offer as written. */
async function refreshMaterials(founderId: string, experimentId: string): Promise<void> {
  const deliverable = `${HOW_TO_MD}\n\n---\n\nFile: ${WORKBOOK_FILE} (${WORKBOOK_BYTES} bytes, SHA-256 ${WORKBOOK_SHA256}), kept at river/proof-2/ and uploaded to the venue by the owner.\n`;
  const same = async (kind: 'deliverable' | 'offer_template' | 'offer_shape', body: string) => (await materialOf(experimentId, kind))?.body === body;
  if (!(await same('deliverable', deliverable))) await recordMaterial({ founderId, experimentId, kind: 'deliverable', title: PROOF2_TITLE, body: deliverable, pulledAt: PROOF2_OBSERVED_AT, by: BY });
  const offer = `${LISTING_MD}\n\n---\n\nShop privacy policy:\n\n${PRIVACY_POLICY_MD}`;
  if (!(await same('offer_template', offer))) await recordMaterial({ founderId, experimentId, kind: 'offer_template', title: PROOF2_PLAN.offerSubject, body: offer, by: BY });
  const plan = JSON.stringify(PROOF2_PLAN);
  if (!(await same('offer_shape', plan))) await recordMaterial({ founderId, experimentId, kind: 'offer_shape', title: 'The offer\'s shape', body: plan, by: BY });
}

/**
 * THE DELIBERATION, RECORDED BEFORE THE OWNER DECIDES AND SEALED WHEN HE DOES.
 * Every sentence below was written before the world was asked; the rival
 * readings that this probe cannot separate say so now, so the admission
 * survives contact with a result.
 */
export async function recordProof2Design(founderId: string, experimentId: string): Promise<{ alreadyRecorded: boolean }> {
  if (await designOf(experimentId)) return { alreadyRecorded: true };
  await recordDesign({
    founderId, experimentId, designedBy: DESIGNED_BY,
    decides: 'Whether a small contractor who encounters the listing through distribution the venue controls will pay $14 before delivery for a bid-decision workbook from Apex Micro, a maker with no reviews and no history on the venue — and, underneath it, whether Private Foundry should originate assets that customers come to rather than assets that must be sent to customers.',
    decidesBecause: 'The first experiment wrote to twenty-one businesses and heard nothing at all: no purchase, no reply, no complaint, no opt-out, and no observation between the provider accepting the message and money moving. Every deferred portfolio subsystem waits on a second settled experiment, and the River\'s economics depend on pull; the institution has never observed one arrival. This is the cheapest venue that already has buyers for this class of artifact and reports the funnel as its own facts.',
    exchange: 'upfront_price',
    exchangeBecause: 'Money moved before delivery is the cleanest observation of pre-delivery willingness to pay, and it is the same exchange as the first experiment, so the change between the two is the demand mechanism and not the instrument. The venue\'s instant download makes delivery the platform\'s fact at the moment of payment.',
    canProve: 'That at least one buyer who arrived by the venue\'s own distribution paid $14 before delivery for this workbook from Apex Micro; the shape of the funnel from impressions to views to favourites to orders for one listing in one month; and whether a listing with no reviews is findable there at all.',
    cannotProve: 'A market, a price, a rate, durability, or a second purchase; anything about commercial millwork shops or the bid-brief thesis; whether search outside this venue would find Apex Micro; whether the buyer used the file; whether any other artifact would sell. One month on one venue with one listing is an observation and not a rate — and views with no orders cannot say whether the price or the listing was the fault.',
    ratherThanWaiting: 'No reading can answer whether anyone comes to Apex Micro unasked. The venue\'s Search Analytics reports impressions from the first day, so listing is itself the first observation of demand for this artifact, and waiting produces nothing it could compare against.',
    distribution: 'A stranger encounters the listing through distribution the marketplace controls — its search, its own pages and its own marketing and SEO — with no outreach, link, post or paid placement initiated by Apex Micro. Etsy Ads are never started and Offsite Ads are opted out before listing, because a paid impression answers a different question. An order from Etsy search with a recorded query is stronger evidence of deliberate search than one from the venue\'s other pages, and both are recorded without collapsing them.',
    ifItSucceeds: 'Nothing widens. The listing stays up untouched and is observed for a second and third month with no intervention, so the first two-point base rate the institution is allowed to compute is about repeat and decay, not launch. Origination policy gains a preference for artifacts with an existing pull venue. A second artifact for the same buyer, or the same artifact on a second venue, is a new probe with its own design.',
    fulfilmentCap: null,
    recommendation: 'run',
    recommendationBecause: 'The question is the one the first experiment could not ask, the artifact exists and was checked by hand, the venue reports every step of the funnel, the fixed exposure is fifteen dollars of platform fees inside a twenty-five dollar allowance, nobody is written to, and every outcome except one changes the next action differently — and that one is declared inseparable here rather than discovered afterwards. It should not go live before the owner has opted out of Offsite Ads and attached a bank account holding only Apex Micro money; those are his acts and the page lists them.',
    interpretations: [
      { observation: 'No views in thirty days, and no impressions', reading: 'the listing is not surfaced for any query: invisible, not unwanted', distinguishedBy: 'the venue\'s Search Analytics: zero impressions is a fact about placement, not about the file' },
      { observation: 'No views in thirty days, but impressions', reading: 'it is shown and never clicked: the thumbnail, title or price loses at the results page', distinguishedBy: 'impressions with no visits, from Search Analytics' },
      { observation: 'Views, no favourites, no orders', reading: 'the price is wrong for a listing with no reviews', distinguishedBy: null },
      { observation: 'Views, no favourites, no orders', reading: 'the listing page does not persuade: screenshot, description, zero reviews', distinguishedBy: null },
      { observation: 'Favourites, no orders', reading: 'interest without money at $14; reviews or price are the block', distinguishedBy: 'favourites are recorded by the venue as interest without purchase' },
      { observation: 'One order', reading: 'one stranger paid before delivery for the expected value of this artifact from an unknown maker on this venue; nothing more', distinguishedBy: 'the venue\'s order record with a reference the owner cannot be matched to' },
      { observation: 'An order followed by a refund', reading: 'the listing over-promised, or the buyer misjudged; the refund on request was honoured', distinguishedBy: 'the buyer\'s stated reason, if any, through the venue\'s messages' },
      { observation: 'A review, any star count', reading: 'the file was downloaded and used, in the buyer\'s own words', distinguishedBy: 'the review itself, which on this venue can only follow a download' },
    ],
    alternatives: [
      { exchange: 'value_first', notChosenBecause: 'Giving the file away and asking afterwards measures experienced value, not whether a stranger will buy sight unseen, and on a marketplace a free listing is a different venue with different buyers.' },
      { exchange: 'sample_then_paid', notChosenBecause: 'A sample of a one-file workbook large enough to be useful is the workbook.' },
      { exchange: 'subscription', notChosenBecause: 'The unknown is whether one file is worth money at all; asking for recurrence before that is settled tests a harder question, and a no would not say which was refused.' },
      { exchange: 'free_with_role', notChosenBecause: 'An opinion about whether somebody would pay is the evidence this institution distrusts most.' },
    ],
    costs: [
      { dimension: 'cash', level: 'low', grounds: 'A one-time $15 shop set-up fee, a $0.20 listing fee, $0.20 renewal on each sale, and the venue\'s percentage fees only on sales. The allowance is $25.' },
      { dimension: 'owner_attention', level: 'low', grounds: 'About two hours once: open the shop, verify identity, attach the account, opt out of Offsite Ads, review the file and the words, list it. Then three readings of under fifteen minutes.' },
      { dimension: 'participant_burden', level: 'none', grounds: 'Nobody is written to. A buyer arrives on their own or not at all.' },
      { dimension: 'reputation', level: 'low', grounds: 'A public, reviewable listing under Apex Micro; a weak file would be visible there. A takedown by the venue would be visible too, and is a stop condition.' },
      { dimension: 'legal_uncertainty', level: 'low', grounds: 'A digital good; the venue collects sales tax where it applies and holds the buyer relationship; the AI-assistance disclosure is made; the state treatment of a spreadsheet file for tax is unverified and is the venue\'s to collect, not Apex Micro\'s to file.' },
      { dimension: 'support_burden', level: 'low', grounds: 'A refund on request instead of support; questions through the venue\'s messages, answered by a person.' },
      { dimension: 'infrastructure', level: 'none', grounds: 'Nothing new. The venue carries the listing, the payment, the delivery and the statistics. No adapter, no site, no sending.' },
      { dimension: 'obligation', level: 'low', grounds: 'One file per buyer, delivered by the venue at payment; a refund promise without time limit, at the price paid.' },
      { dimension: 'complexity', level: 'low', grounds: 'One listing, one file, three readings entered by hand. Nothing to maintain after the window.' },
      { dimension: 'opportunity_cost', level: 'low', grounds: 'Two hours of owner attention and fifteen dollars, against the first observation of whether anyone comes to the institution unasked.' },
    ],
    stopConditions: [
      { kind: 'complaints', threshold: 1, because: 'One buyer saying the listing was not what it described, through the venue\'s case process, is the venue\'s own finding that the words promised what the file did not deliver. New sales stop until the description and the file are reconciled.' },
      { kind: 'refunds', threshold: 2, because: 'Two buyers wanting their money back is a pattern about the file, not a fluke about a buyer. Every refund is honoured at once regardless of this number; what it stops is selling a third.' },
      { kind: 'unfulfillable', threshold: 1, because: 'One purchase the venue could not deliver is an unmet obligation. Selling a second before that is fixed would be taking money for something known not to arrive.' },
    ],
  });
  return { alreadyRecorded: false };
}

/**
 * APPROVE THE LISTING EXPERIMENT: one owner gesture, three things recorded.
 * The experiment's decision (prediction sealed, asset and allowance made), the
 * offer's shape and the facts the first-proof policy reads, and two standing
 * boundaries on the experimental asset that say what Foundry may not do here:
 * write to anybody, or publish anything. Nothing is placed by this; the
 * listing is the owner's act on the venue, and its address comes back to
 * Foundry through `recordListing`.
 */
export async function approveListing(input: { founderId: string; experimentId: string }): Promise<{ productId: string }> {
  const e = await experimentRow(input.experimentId);
  if (!e || e.founderId !== input.founderId) throw new HandRefused('experiment_not_found');
  if (e.decision !== null) throw new HandRefused('already_decided', e.decision);
  const plan = await offerShapePlanOf(input.experimentId);
  if (!plan?.listing) throw new HandRefused('not_a_listing', 'this test is not shaped as a listing the owner places');
  const inTheWay = await designStandsInTheWay(input.experimentId);
  if (inTheWay.length) throw new HandRefused('design_not_ready', inTheWay.join('; '));
  if (!(await materialOf(input.experimentId, 'deliverable'))) throw new HandRefused('not_ready', 'nothing to deliver is attached');
  if (!(await materialOf(input.experimentId, 'offer_template'))) throw new HandRefused('not_ready', 'the listing text is not written');
  const by = `founder:${input.founderId}`;
  // THE GENERAL CONTROL IS THE RIGHT DOOR HERE, and it says so itself: no
  // business is named and no page is written for strangers, so approving
  // this test authorises nothing that reaches a person. It builds something
  // to test with — an experimental asset and an allowance — and nothing else.
  const decided = await decideExperiment({ experimentId: input.experimentId, decision: 'approved', by });
  if (decided.refused) throw new HandRefused('refused', decided.refused);
  const after = await experimentRow(input.experimentId);
  if (!after?.productId) throw new HandRefused('asset_missing');
  await statedShapeAndFacts(after, after.productId, plan);
  // HIS STANDING WORD FOR THIS ASSET, in the mode the door enforces: never.
  // The first experiment's asset carried ask-first boundaries with one act
  // approved under each; this one carries no act at all, because there is
  // nothing for Foundry to do to a person or the public here.
  await setBoundary({ productId: after.productId, subject: 'contact_people', mode: 'never',
    statement: 'Nobody is written to for this test, by anyone; a buyer arrives on their own or not at all' });
  await setBoundary({ productId: after.productId, subject: 'publish', mode: 'never',
    statement: 'Foundry publishes nothing for this test; the listing is my own act on the venue' });
  // Sealed with the prediction: a deliberation that could be edited afterwards
  // would let every result be narrated as the expected one.
  await sealDesign(input.experimentId);
  return { productId: after.productId };
}

/**
 * THE LISTING IS LIVE, AND ITS ADDRESS IS THE EXPOSURE. The owner pastes the
 * venue's address for the listing; that places the exposure (provider: the
 * venue) and starts the window the sealed rule counts within. The legal
 * picture at asset level is read by `placeExposure` before the row exists.
 */
export async function recordListing(input: { founderId: string; experimentId: string; url: string }): Promise<{ exposureId: string }> {
  const e = await experimentRow(input.experimentId);
  if (!e || e.founderId !== input.founderId) throw new HandRefused('experiment_not_found');
  if (e.decision !== 'approved') throw new HandRefused('not_approved', 'approve the test before recording where it is listed');
  if (!e.productId) throw new HandRefused('asset_missing');
  const plan = await offerShapePlanOf(input.experimentId);
  if (!plan?.listing) throw new HandRefused('not_a_listing');
  const url = input.url.trim();
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { throw new HandRefused('bad_url', 'that is not an address'); }
  if (!/^https:\/\//.test(url) || !(host === `${plan.listing.venue}.com` || host.endsWith(`.${plan.listing.venue}.com`))) {
    throw new HandRefused('bad_url', `the listing address must be on ${plan.listing.venueName}`);
  }
  const existing = await exposureOf(input.experimentId);
  if (existing && existing.withdrawnAt === null) return { exposureId: existing.id };
  const placed = await placeExposure({ experimentId: input.experimentId, productId: e.productId, provider: plan.listing.venue, exposureRef: url, evidenceMode: e.evidenceMode as 'real' | 'reference', placedBy: `founder:${input.founderId}` });
  if ('refused' in placed) throw new HandRefused('not_placed', placed.refused);
  // The offer, completed: the listing text with the address it lives at, so
  // the page and the timeline can show where the offer is.
  const template = await materialOf(input.experimentId, 'offer_template');
  await recordMaterial({ founderId: input.founderId, experimentId: input.experimentId, kind: 'offer', title: plan.offerSubject,
    body: `${template?.body ?? ''}\n\nListed at: ${url}`, paymentLinkUrl: url, by: `founder:${input.founderId}` });
  return { exposureId: placed.id };
}

export interface VenueReading {
  /** The day the reading was taken, as the venue's statistics page showed it. */
  date: string;
  impressions: number | null; views: number | null; visits: number | null; favourites: number | null; orders: number | null;
  /** The traffic-source split and the top search queries, in the owner's words, as the venue showed them. */
  sources: string; queries: string;
}

/**
 * WHAT THE VENUE REPORTED, entered by the owner from its own statistics and
 * recorded as an observation on the claim. A reading of zero orders is a fact
 * about a day and neither supports nor contradicts the claim; it is recorded
 * from absence, so it can never read as presence. A reading with an order
 * supports it; the order itself is recorded separately as the provider's
 * event, because a count on a statistics page is not the order record.
 */
export async function recordVenueReading(input: { founderId: string; experimentId: string; reading: VenueReading }): Promise<{ observationId: string }> {
  const e = await experimentRow(input.experimentId);
  if (!e || e.founderId !== input.founderId) throw new HandRefused('experiment_not_found');
  if (e.decision !== 'approved') throw new HandRefused('not_approved');
  const plan = await offerShapePlanOf(input.experimentId);
  if (!plan?.listing) throw new HandRefused('not_a_listing');
  const claim = (await query('SELECT claim_id FROM venture_experiments WHERE id = ?', [input.experimentId])).rows[0] as Record<string, unknown> | undefined;
  if (!claim?.claim_id) throw new HandRefused('no_claim');
  const r = input.reading;
  const date = r.date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HandRefused('bad_date', 'the reading needs the day it was taken, as YYYY-MM-DD');
  const n = (v: number | null, what: string) => v === null ? `${what} not read` : `${v} ${what}`;
  const saw = `${plan.listing.venueName} statistics on ${date}: ${[n(r.impressions, 'impressions'), n(r.views, 'views'), n(r.visits, 'visits'), n(r.favourites, 'favourites'), n(r.orders, 'orders')].join(', ')}.`
    + (r.sources.trim() ? ` Sources: ${r.sources.trim()}.` : '') + (r.queries.trim() ? ` Queries: ${r.queries.trim()}.` : '');
  const orders = r.orders ?? 0;
  const observationId = await observe({
    founderId: input.founderId, claimId: String(claim.claim_id), sourceType: 'marketplace',
    source: `${plan.listing.venue}:stats:${date}`, saw, bearing: 'supports', directness: 'direct',
    observedAt: new Date(`${date}T12:00:00Z`), evidenceMode: e.evidenceMode as 'real' | 'sandbox' | 'reference',
    fromAbsence: orders === 0,
  });
  return { observationId };
}

export interface VenueOrder { orderRef: string; paidAt: string; grossCents: number; feeCents: number | null; currency?: string }

/**
 * AN ORDER, AS THE VENUE'S STATEMENT SHOWS IT. Recorded as the provider's
 * payment event and, because the venue makes the file available the moment
 * payment confirms, the delivery event beside it; what is owed is a
 * fulfilment row that is delivered at once; and the ledger takes the charge
 * (pointing at the payment event) and the venue's fee, both measured from
 * the statement. The order reference is what classifies the counterparty as
 * somebody the owner is not; no buyer identity is stored.
 */
export async function recordVenueOrder(input: { founderId: string; experimentId: string; order: VenueOrder }): Promise<{ paymentEventId: string; fulfilmentId: string; duplicate: boolean }> {
  const e = await experimentRow(input.experimentId);
  if (!e || e.founderId !== input.founderId) throw new HandRefused('experiment_not_found');
  if (e.decision !== 'approved') throw new HandRefused('not_approved');
  const plan = await offerShapePlanOf(input.experimentId);
  if (!plan?.listing) throw new HandRefused('not_a_listing');
  const x = await exposureOf(input.experimentId);
  if (!x || x.withdrawnAt !== null) throw new HandRefused('not_listed', 'record where the test is listed before recording an order');
  const o = input.order;
  const ref = o.orderRef.trim();
  if (!ref) throw new HandRefused('bad_order', 'the venue\'s order number is required');
  if (!Number.isInteger(o.grossCents) || o.grossCents <= 0) throw new HandRefused('bad_order', 'the amount charged must be a whole number of cents above zero');
  const paidAt = new Date(o.paidAt);
  if (Number.isNaN(paidAt.getTime())) throw new HandRefused('bad_order', 'the order needs the date it was paid');
  const currency = (o.currency ?? 'usd').toLowerCase();
  const paid = await recordBusinessOutcome({ exposureId: x.id, kind: 'payment', amountCents: o.grossCents, currency, observedAt: paidAt,
    provider: plan.listing.venue, providerRef: ref, payerReference: `order:${ref}`, arrivedVia: plan.listing.venue, exchange: 'upfront_price' });
  if ('refused' in paid) throw new HandRefused('not_recorded', paid.refused);
  if (paid.duplicate) {
    const f = (await query('SELECT id FROM experiment_fulfilments WHERE payment_event_id = ?', [paid.id])).rows[0] as Record<string, unknown> | undefined;
    return { paymentEventId: paid.id, fulfilmentId: f ? String(f.id) : '', duplicate: true };
  }
  const delivered = await recordBusinessOutcome({ exposureId: x.id, kind: 'delivery', amountCents: null, currency, observedAt: paidAt,
    provider: plan.listing.venue, providerRef: `${ref}:download-available`, payerReference: `order:${ref}`, arrivedVia: plan.listing.venue, exchange: 'upfront_price' });
  if ('refused' in delivered) throw new HandRefused('not_recorded', delivered.refused);
  const fulfilmentId = nanoid();
  await query(
    `INSERT INTO experiment_fulfilments (id, founder_id, experiment_id, exposure_id, payment_event_id, provider, payment_ref, amount_cents, currency)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [fulfilmentId, input.founderId, input.experimentId, x.id, paid.id, plan.listing.venue, ref, o.grossCents, currency]);
  await query(`UPDATE experiment_fulfilments SET status = 'delivered', updated_at = datetime('now') WHERE id = ?`, [fulfilmentId]);
  await recordEconomicEvent({ founderId: input.founderId, kind: 'charge', amountCents: o.grossCents, currency, occurredAt: paidAt,
    provider: plan.listing.venue, providerRef: ref, sourceEventId: paid.id, fulfilmentId, claimQuality: 'measured',
    evidenceMode: e.evidenceMode as 'real' | 'sandbox' | 'reference', because: `${plan.listing.venueName} order ${ref}, as the statement shows it` });
  if (o.feeCents !== null && Number.isInteger(o.feeCents) && o.feeCents >= 0) {
    await recordEconomicEvent({ founderId: input.founderId, kind: 'provider_fee', amountCents: o.feeCents, currency, occurredAt: paidAt,
      provider: plan.listing.venue, providerRef: `${ref}:fees`, fulfilmentId, claimQuality: 'measured',
      evidenceMode: e.evidenceMode as 'real' | 'sandbox' | 'reference', because: `${plan.listing.venueName} fees on order ${ref}, as the statement shows them` });
  }
  return { paymentEventId: paid.id, fulfilmentId, duplicate: false };
}

/**
 * A REFUND, AS THE VENUE'S STATEMENT SHOWS IT. The provider's refund event at
 * the exposure, the fulfilment marked refunded, the ledger's refund row, and
 * the stop conditions read — a refund is one of them (migration 318).
 */
export async function recordVenueRefund(input: { founderId: string; experimentId: string; orderRef: string; refundedAt: string; amountCents: number }): Promise<{ stop: boolean; because: string[] }> {
  const e = await experimentRow(input.experimentId);
  if (!e || e.founderId !== input.founderId) throw new HandRefused('experiment_not_found');
  const plan = await offerShapePlanOf(input.experimentId);
  if (!plan?.listing) throw new HandRefused('not_a_listing');
  const x = await exposureOf(input.experimentId);
  if (!x) throw new HandRefused('not_listed');
  const ref = input.orderRef.trim();
  const at = new Date(input.refundedAt);
  if (!ref || Number.isNaN(at.getTime()) || !Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new HandRefused('bad_refund');
  const f = (await query('SELECT id FROM experiment_fulfilments WHERE experiment_id = ? AND payment_ref = ?', [input.experimentId, ref])).rows[0] as Record<string, unknown> | undefined;
  if (!f) throw new HandRefused('no_such_order', 'record the order before its refund');
  const refunded = await recordBusinessOutcome({ exposureId: x.id, kind: 'refund', amountCents: input.amountCents, currency: 'usd', observedAt: at,
    provider: plan.listing.venue, providerRef: `${ref}:refund`, payerReference: `order:${ref}`, arrivedVia: plan.listing.venue, exchange: 'upfront_price' });
  if ('refused' in refunded) throw new HandRefused('not_recorded', refunded.refused);
  if (!refunded.duplicate) {
    await query(`UPDATE experiment_fulfilments SET status = 'refunded', refund_requested_at = ?, refund_ref = ?, updated_at = datetime('now') WHERE id = ?`,
      [at.toISOString(), `${ref}:refund`, String(f.id)]);
    await recordEconomicEvent({ founderId: input.founderId, kind: 'refund', amountCents: input.amountCents, currency: 'usd', occurredAt: at,
      provider: plan.listing.venue, providerRef: `${ref}:refund`, sourceEventId: refunded.id, claimQuality: 'measured',
      evidenceMode: e.evidenceMode as 'real' | 'sandbox' | 'reference', because: `${plan.listing.venueName} refund on order ${ref}, as the statement shows it` });
  }
  return stopConditionsMet(input.experimentId);
}

/**
 * THE SEALED RULE READS WHAT THE VENUE REPORTED. The hand's pass runs only
 * over experiments with an approved act, and a listing the owner places has
 * none: nothing is sent, so nothing was authorised. Its settlement is the
 * same reading of the same rows by the same rule, taken here on the hourly
 * pass, and a settled listing's exposure is withdrawn in Foundry's record;
 * taking the listing down at the venue is the owner's act, and the page says so.
 */
export interface ListingReport { experimentId: string; settled: 'as_predicted' | 'partly' | 'surprised' | null; because: string; earned: boolean }

export async function settleListings(input: { founderId?: string; now?: Date } = {}): Promise<ListingReport[]> {
  const now = input.now ?? new Date();
  const live = (await query(
    `SELECT e.id FROM venture_experiments e
      WHERE e.decision = 'approved' AND e.ran_at IS NULL AND e.validity = 'valid' AND e.evidence_mode = 'real'
        ${input.founderId ? 'AND e.founder_id = ?' : ''}
        AND EXISTS (SELECT 1 FROM experiment_exposures x WHERE x.experiment_id = e.id AND x.withdrawn_at IS NULL)
        AND EXISTS (SELECT 1 FROM experiment_materials m WHERE m.experiment_id = e.id AND m.kind = 'offer_shape')
      ORDER BY e.decided_at, e.rowid`, input.founderId ? [input.founderId] : [])).rows as unknown as Array<Record<string, unknown>>;
  const reports: ListingReport[] = [];
  for (const row of live) {
    const experimentId = String(row.id);
    const plan = await offerShapePlanOf(experimentId);
    if (!plan?.listing) continue;
    const s = await settleFromTheWorld(experimentId, now);
    if (s.settled !== null) {
      const x = await exposureOf(experimentId);
      if (x && x.withdrawnAt === null) await withdrawExposure(x.id);
    }
    reports.push({ experimentId, settled: s.settled, because: s.because, earned: s.earned });
  }
  return reports;
}

/** The owner's acts, as the record states them, for the page. */
export function ownerActsForListing(): string { return OWNER_ACTS_MD; }
