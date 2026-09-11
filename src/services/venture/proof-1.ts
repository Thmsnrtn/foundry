// =============================================================================
// PROOF 1 — THE FIRST REAL EXPERIMENT, AS ROWS THE INSTITUTION ALREADY HAS.
//
// A $29 one-time brief of open Massachusetts public bid notices relevant to
// cabinet and millwork shops, offered once each to up to 25 businesses the
// owner has reviewed, under a $100 allowance and a seven-day window, settled
// by what the world does at a Stripe payment link. Owner direction 2026-09-07;
// the record is river/proof-1/.
//
// This seeds nothing River-shaped. It writes a candidate under his search, the
// claim and the public observations it rests on, the unknown the test answers,
// the experiment with its sealed rule, the businesses awaiting his review, and
// the materials the hand needs. It spends nothing, permits nothing and contacts
// no one: the owner's three acts (review, connect sending, allow) come after,
// on /foundry/experiments/:id.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { currentMandate, openMandate, stopMandate } from './mandate.js';
import { formClaim, observe } from './market-evidence.js';
import { designExperiment } from './validation.js';
import { addRecipients, recordMaterial, materialOf } from './hand.js';
import type { OfferShapePlan } from './hand.js';
import { BRIEF_MD, OUTREACH_TEMPLATE_MD } from './proof-1-content.js';

export const PROOF1_TITLE = 'Massachusetts Commercial Millwork Bid Brief, pilot edition';
/**
 * WHEN THE EVIDENCE WAS SEEN, which is not when the goods were made.
 *
 * The observations below were made on 7 September and are dated for ever as
 * that: an observation is a record of a moment and re-dating one because a
 * later edition of the product exists would be rewriting what was known when.
 * The brief that is actually sent has its own date, which moves as it is
 * re-pulled.
 */
export const PROOF1_PULLED_AT = new Date('2026-09-07T12:00:00Z');
/** When the edition now on sale was pulled from COMMBUYS. */
export const PROOF1_EDITION_PULLED_AT = new Date('2026-09-10T18:00:00Z');

export const PROOF1_RECIPIENTS: Array<{ counterpartyRef: string; email: string | null; channel: 'email' | 'web_form'; sourceUrl: string }> = [
  { counterpartyRef: 'Quality Design Cabinet, Boston', email: 'contact@qualitydesigncabinet.com', channel: 'email', sourceUrl: 'https://qualitydesigncabinet.com/commercial' },
  { counterpartyRef: 'Mass Cabinets, Inc., Methuen', email: null, channel: 'web_form', sourceUrl: 'https://www.masscabinetsinc.com/' },
  { counterpartyRef: 'New England Cabinetry & Millwork, Marlborough', email: 'sales@necabinetry.com', channel: 'email', sourceUrl: 'https://necabinetry.com/' },
  { counterpartyRef: 'Salem Architectural Woodworking, LLC, Gloucester', email: 'pguido@salemwoodworking.net', channel: 'email', sourceUrl: 'http://salemwoodworking.net/' },
  { counterpartyRef: 'CMD Cabinetry, Walpole', email: null, channel: 'web_form', sourceUrl: 'https://cmdcabinetry.com/' },
  { counterpartyRef: 'Specialty Millwork Inc., Fall River', email: 'info.specialtymillwork@gmail.com', channel: 'email', sourceUrl: 'https://specialtymillwork.com/' },
  { counterpartyRef: 'RGC Millwork, Lowell', email: 'sales@rgcmillwork.com', channel: 'email', sourceUrl: 'https://www.rgcmillwork.com/' },
  { counterpartyRef: 'General Woodworking, Lowell', email: 'info@genwood.com', channel: 'email', sourceUrl: 'https://www.genwood.com/' },
  { counterpartyRef: 'Continental Woodcraft, Worcester', email: 'info@continentalwoodcraft.com', channel: 'email', sourceUrl: 'https://www.continentalwoodcraft.com/' },
  { counterpartyRef: 'Deerfield Cabinets & Millwork, Greenfield', email: null, channel: 'web_form', sourceUrl: 'https://visitgreenfieldma.com/listing/deerfield-cabinets-and-millwork/' },
  { counterpartyRef: 'Westek Architectural Woodworking, South Hadley', email: null, channel: 'web_form', sourceUrl: 'https://www.westekaw.com/' },
  { counterpartyRef: 'Grain Architectural Millwork, East Boston', email: null, channel: 'web_form', sourceUrl: 'https://grainarchitecturalmillwork.com/' },
  { counterpartyRef: 'Hamel Woodworks, Hyannis', email: 'info@hamelwoodworks.com', channel: 'email', sourceUrl: 'http://hamelwoodworks.com/' },
  { counterpartyRef: 'Toby Leary Fine Woodworking, Cape Cod', email: 'info@tobyleary.com', channel: 'email', sourceUrl: 'https://www.tobyleary.com/' },
  { counterpartyRef: 'Master Millwork, Massachusetts', email: 'info@mastermillwork.com', channel: 'email', sourceUrl: 'https://www.mastermillwork.com/' },
  { counterpartyRef: 'Classic Millwork Design, Webster', email: null, channel: 'web_form', sourceUrl: 'https://www.classicmillworkdesign.com/' },
  { counterpartyRef: 'FabWright Origins, Brookline', email: null, channel: 'web_form', sourceUrl: 'https://fabwrightorigins.com/commercial-custom-cabinetry-millwork/' },
  { counterpartyRef: 'Mass Millworks, Massachusetts', email: null, channel: 'web_form', sourceUrl: 'https://www.macabinetry.com/' },
  { counterpartyRef: 'ML Custom Millwork and Cabinetry, Massachusetts', email: null, channel: 'web_form', sourceUrl: 'https://mlcustomwork.com/' },
  { counterpartyRef: 'New England Custom Cabinetry, Plainville', email: null, channel: 'web_form', sourceUrl: 'https://www.necustomcabinetry.com/' },
  { counterpartyRef: 'Architectural Casework & Millwork, Inc., Gloucester', email: null, channel: 'web_form', sourceUrl: 'https://www.thebluebook.com/iProView/793392/acm-architectural-casework-millwork-inc/manufacturers/' },
  { counterpartyRef: 'SBS OneSource Custom Millwork, Harwich (borderline: building-supply company)', email: 'christine@sbsonesource.com', channel: 'email', sourceUrl: 'https://sbsonesource.com/builders/custom-millwork/' },
  { counterpartyRef: 'TrimBoard, Springfield (borderline: trim and moulding supplier)', email: null, channel: 'web_form', sourceUrl: 'https://trimboard.net/' },
];

/** What was seen on the public web, and where. Observed 2026-09-07. */
const OBSERVATIONS: Array<{ sourceType: string; source: string; saw: string; bearing: 'supports' | 'contradicts'; directness: 'direct' | 'inferred' }> = [
  { sourceType: 'community', source: 'https://woodweb.com/knowledge_base/Getting_Commercial_Millwork_Jobs_Without.html',
    saw: 'Millwork shop owners publicly describe difficulty winning commercial and public work without being the low bidder: "I have bid work for the past year and I have been low balled by many of my competitors."', bearing: 'supports', directness: 'inferred' },
  { sourceType: 'vendor_site', source: 'https://www.sec.state.ma.us/divisions/pubs-regs/advertise-goods-services.htm',
    saw: 'The Central Register, the authoritative Massachusetts public construction bid listing, is online only and subscription for a fee.', bearing: 'supports', directness: 'direct' },
  { sourceType: 'pricing_page', source: 'https://www.capterra.com/p/166830/Periscope-S2G/',
    saw: 'The COMMBUYS platform vendor sells bid notification at $109 per month for a state plan.', bearing: 'supports', directness: 'direct' },
  { sourceType: 'public_dataset', source: 'https://www.commbuys.com/bso/view/search/external/advancedSearchBid.xhtml?openBids=true',
    saw: 'COMMBUYS listed 952 open solicitations on 2026-09-07; 62 building-related notices read in full; 13 appear relevant to millwork.', bearing: 'supports', directness: 'direct' },
];

export const PROOF1_PLAN: OfferShapePlan = {
  shape: {
    sells: 'a one-time pilot brief of open Massachusetts public bid notices that appear relevant to cabinet and millwork work, with links to the authoritative record',
    claimsMade: 'covers COMMBUYS only, not the Central Register or DCAMM; relevance judged from notice text, not bid documents; those limits are stated in the brief',
    collects: 'the buyer\'s email address from the payment provider, used once to deliver and never kept in a ledger',
    deliversBy: 'email, in the body of the message, after the payment provider confirms payment',
    sellsTo: 'independent commercial cabinet and architectural millwork businesses in Massachusetts, written to once each after the owner\'s review',
    chargesHow: 'one-time, $29, no subscription, refunded on request through the link in the delivery',
  },
  lighter: 'a single hand-assembled brief delivered by email; no feed, no account, no software',
  facts: {
    recurring_billing: { present: 0, grounds: 'Charges: one-time, no subscription' },
    persistent_personal_data: { present: 0, grounds: 'Collects: the buyer address is read from the provider at delivery and not kept' },
    cross_border_selling: { present: 0, grounds: 'Sells to: Massachusetts businesses only' },
    support_obligation: { present: 0, grounds: 'Delivers: one brief, once; a refund link instead of support' },
    manual_fulfilment: { present: 0, grounds: 'Delivers by: the stored brief is sent by the institution after payment; nobody does anything by hand per sale' },
    user_generated_content: { present: 0, grounds: 'Sells: public notice metadata, nobody else\'s words' },
    account_system: { present: 0, grounds: 'Delivers by: email; no account' },
    two_sided_marketplace: { present: 0, grounds: 'Sells to: one audience, the buyer' },
    one_visit_delivery: { present: 0, grounds: 'Delivers by: email on the institution\'s next hourly pass after payment, not on the page itself' },
    front_loaded_attention: { present: 1, grounds: 'The owner\'s non-delegable work is three acts before it runs: review who may be contacted, connect his sending address, allow it; nothing weekly' },
  },
  price: {
    amountCents: 2900, currency: 'USD', lookupKey: 'foundry_proof1_ma_millwork_brief_one_time',
    productName: 'Massachusetts Commercial Millwork Bid Brief — pilot edition',
    productMetadata: { app_object: 'experiment_deliverable', plan_key: 'proof1_ma_millwork_bid_brief' },
    confirmationMessage: 'Thanks — the brief will be in your inbox within a business day.',
  },
  offerSubject: 'A shortlist of open Massachusetts public bids with cabinet and millwork scope',
};

/**
 * THE PUBLIC WORDS FOR EXPERIMENT 001, authored for publication. Nothing here
 * is inferred from private rows; it is the offer as the owner reviewed it,
 * said to a stranger in his voice.
 */
export const PROOF1_SLUG = 'ma-millwork-bid-brief';
export const PROOF1_PUBLIC = {
  title: 'Massachusetts Millwork Bid Brief',
  // SAID ACROSS A TABLE, NOT ACROSS A LECTERN. The earlier versions described a
  // test of a way of finding opportunities, then a hand-screened shortlist of
  // notices that look like work. Both were true; both sounded written. What a
  // shop owner needs in the first line is the thing itself and roughly how many.
  summary: 'A short brief of the Massachusetts public bid notices that look like cabinet, casework or millwork work — twenty-three of them, with the bid number, when it opens, who to contact and a link to the notice itself.',
  who: 'Small commercial cabinet, casework and architectural millwork shops in Massachusetts that bid on public work, or would like to.',
  // NOBODY'S HAND. "Screened by hand" implied Thomas sat and read 952 notices.
  // Software did most of that, and saying otherwise is the manufactured personal
  // attention this workshop is not allowed to fake — so the sentence says what
  // was done and stays quiet about whose hands did it.
  // WHAT A BUYER WHO ALREADY KNOWS COMMBUYS IS BUYING. The second paragraph
  // exists because the sharpest reader — a shop already registered, already
  // getting seller notifications — asks "why would I pay for public links?".
  // The full answer is measured and lives in the record; the page carries two
  // numbers and the plain reason, because a page that argues its own case at
  // length is a page that does not trust it. It says COMMBUYS is free, because
  // it is: the brief is for people who would rather not do the reading.
  what: 'One brief, by email, within a business day of paying. It\'s a fixed edition rather than a live feed: this one was pulled from COMMBUYS on 10 September 2026. Each notice gives you the bid number, when it opens, who to contact, a line on why it might fit, and a link to the notice so you can read it yourself.\n\nYou can search COMMBUYS yourself — it\'s free, and if you bid public work you are probably on it already. This is for shops that would rather not read through hundreds of notices to find the few worth a look. This edition started with 726 open notices; twenty-three made the cut.',
  limits: 'It\'s a shortlist, not a database. It covers COMMBUYS only — not the Central Register, not DCAMM\'s e-bid room, not the town portals that don\'t post there — so something missing from it isn\'t necessarily missing from the market. Some entries name the cabinetry, countertops or carpentry outright. Others are there because the work described usually carries some, which is an inference and is labelled as one in the brief — it is worth a look, not a fact. And nothing in it tells you a job is winnable or worth your time. Read the bid documents before you commit to anything.',
  sources: 'COMMBUYS is the state\'s public procurement site — where Massachusetts agencies, housing authorities and a lot of towns post their bids. Every notice in the brief was read there in full, and each item links back to the original so you can check it.',
  // ONLY WHAT THE RECORD SUPPORTS. The grounds actually written down for each
  // qualifying shop are public-sector projects shown on the business's own site.
  // That is what this says, and it does not claim anybody browsed it personally.
  selection: 'Your shop came up because your own website shows public-sector work — schools, municipal buildings, that kind of thing. I\'m trying this brief with a small number of Massachusetts shops it might genuinely be useful to, writing to the address each one publishes. Nobody sold me your details, there\'s no list, and I only write once.',
  note: 'I\'m Thomas Norton, and Apex Micro is my workshop. I build small, practical things, try them for real, and keep the ones that turn out to be useful. Software I\'ve built does a lot of the research and the running; the decisions and the responsibility are mine.\n\nThis is the first edition of this brief, so I\'m finding out whether it\'s worth $29 to the shops it\'s meant for. If it isn\'t, I\'d rather know.',
  // ONE ITEM, AS IT ARRIVES. Not a mock-up and not a description of one: the
  // first entry of the edition that is actually sent. The agency officer's name,
  // phone and email are in the brief and deliberately are not here — they are a
  // real person's contact details, and a page anyone can read is not the place
  // to republish them.
  sample: '1. Framingham Housing Authority — On-Call Carpentry Services\n\nBid # BD-26-1507-FHA01-JJB01-132802 · Bid opening: September 14, 2026, 2:00 PM · Closing soon\n\nWhat the notice says: "invites written quotes from Contractors for On-Call Carpentry Services for the FHA in Framingham, MA."\n\nContact: the housing authority\'s procurement officer, by name, with email and phone.\n\nAlso worth knowing: electronic quotes are not accepted; see the ad attached to the notice.\n\nWhy it may fit: a standing carpentry contract with a housing authority. How broad the scope is won\'t be clear until you read the ad.\n\nSource: a link to the notice on COMMBUYS.\n\nThe other twenty-two look like that too.',
} as const;

export interface Proof1Seed { experimentId: string; opportunityId: string; recipientsAdded: number; alreadyExisted: boolean }

/**
 * The experiment already seeded for this owner, if any: by its deliverable's
 * title. A superseded design and its successor share a title and can share a
 * second, so the order is stated rather than left to the rows: the one still
 * open wins, then the newest, then the last written. Without the last of those
 * this returned whichever the storage engine happened to hand back first.
 */
export async function findProof1(founderId: string): Promise<string | null> {
  const r = (await query(
    `SELECT e.id FROM venture_experiments e JOIN experiment_materials m ON m.experiment_id = e.id AND m.kind = 'deliverable'
      WHERE e.founder_id = ? AND e.evidence_mode = 'real' AND m.title = ?
      ORDER BY CASE WHEN e.decision IS NULL THEN 0 WHEN e.decision = 'approved' THEN 1 ELSE 2 END,
               e.proposed_at DESC, e.rowid DESC LIMIT 1`, [founderId, PROOF1_TITLE]))
    .rows[0] as Record<string, unknown> | undefined;
  return r ? String(r.id) : null;
}

/** Idempotent on the owner: a second run refreshes materials and adds new recipients, never a second experiment. */
export async function seedProof1(founderId: string): Promise<Proof1Seed> {
  const founder = (await query('SELECT id FROM founders WHERE id = ?', [founderId])).rows[0];
  if (!founder) throw new Error(`no founder ${founderId}`);
  const existing = await findProof1(founderId);
  if (existing) {
    const e = (await query('SELECT opportunity_id FROM venture_experiments WHERE id = ?', [existing])).rows[0] as Record<string, unknown>;
    const added = (await addRecipients({ founderId, experimentId: existing, recipients: PROOF1_RECIPIENTS })).added;
    await refreshMaterials(founderId, existing);
    return { experimentId: existing, opportunityId: String(e.opportunity_id), recipientsAdded: added, alreadyExisted: true };
  }

  let mandate = await currentMandate(founderId);
  // A REHEARSAL SEARCH YIELDS TO A REAL ONE. A reference mandate exercises the
  // machinery; a real experiment cannot hang under it (the candidate is only
  // as real as the search that found it), and one search runs at a time. It
  // is closed with the reason on its row, never deleted, and the owner can
  // open another search whenever he likes.
  if (mandate && mandate.evidenceMode !== 'real') {
    await stopMandate(founderId, 'superseded by the first real experiment the owner directed (Proof 1); a rehearsal search yields to a real one');
    mandate = null;
  }
  if (!mandate) {
    const opened = await openMandate({ founderId, statement: 'Find out whether small Massachusetts trade businesses will pay for filtered public-bid discovery', shape: null, evidenceMode: 'real' });
    if ('refused' in opened) throw new Error(opened.refused);
    mandate = opened;
  }
  const opportunityId = nanoid();
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [opportunityId, mandate.id, founderId,
      'A filtered brief of public bid notices for Massachusetts millwork shops',
      'independent commercial cabinet and architectural millwork businesses in Massachusetts',
      'public bid notices are scattered across COMMBUYS, the paid Central Register and agency portals, and shops say they lose work they never saw',
      'the authoritative listing is paid and the platform vendor already sells notification at $109 a month, so filtered discovery has a price somebody pays',
      'misread if 25 businesses receive a plain $29 offer and none pays: then the friction is real but not worth money at this price, or not to these businesses',
      JSON.stringify(OBSERVATIONS.map((o) => o.source)), 'real']);
  const claimId = await formClaim({ founderId, evidenceMode: 'real', opportunityId, claim: 'an independent Massachusetts millwork business will pay $29 one-time for a filtered brief of current public bid notices' });
  for (const o of OBSERVATIONS) {
    await observe({ founderId, claimId, sourceType: o.sourceType, source: o.source, saw: o.saw, bearing: o.bearing, directness: o.directness, observedAt: PROOF1_PULLED_AT, evidenceMode: 'real' });
  }
  const unknownId = nanoid();
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, claim_id, question, blocking, cheapest_test) VALUES (?,?,?,?,?,1,?)`,
    [unknownId, founderId, opportunityId, claimId, 'Will an independent Massachusetts millwork business pay $29 for filtered public-bid discovery at all?',
      'offer a hand-assembled $29 brief once to up to 25 reviewed businesses and count settled payments']);
  const experimentId = await designExperiment({
    founderId, opportunityId, unknownId, claimId, evidenceMode: 'real', costCents: 10_000,
    whatWeDo: 'Write once to each approved Massachusetts millwork business, in the owner\'s name, offering a $29 one-time pilot brief of open public bid notices relevant to millwork, and deliver it by email on payment',
    whatWeExpect: 'At least one business pays $29 and receives the brief before 25 have received the offer, within seven days of the offer being placed',
    wouldDisprove: 'Twenty-five businesses receive the offer and none pays and receives the brief, or seven days pass without one; a refunded or undelivered purchase does not count',
    // THE PAID EVENT IS THE DELIVERY: a payment counts only once what was paid for
    // is confirmed to have reached the buyer, so a bounced, refunded purchase never validates the test.
    settlesWhen: { event: 'delivery', atLeast: 1, outOf: 'offer_delivered', atMost: 25, withinDays: 7 },
  });
  // The deliverable already exists; no computer is needed for this test.
  await query('UPDATE venture_experiments SET needs_workshop = 0 WHERE id = ?', [experimentId]);
  const recipientsAdded = (await addRecipients({ founderId, experimentId, recipients: PROOF1_RECIPIENTS })).added;
  await refreshMaterials(founderId, experimentId);
  return { experimentId, opportunityId, recipientsAdded, alreadyExisted: false };
}

export interface Proof1Reframe { original: string; successor: string; number: number; slug: string; alreadyReframed: boolean }

/**
 * PROOF 1 REACHED A REAL CONTRADICTION BEFORE LAUNCH: the identity, the sender
 * and the trust surface a stranger would meet cost more owner attention and
 * more shared reputation than the design had counted, and the design pointed
 * a raw payment link from a fresh domain. Under the existing semantics the
 * prediction of an undecided test is not sealed, but a rewrite in place would
 * leave no trace of the contradiction. So: the original is declined as
 * superseded, by the institution and with the successor naming it, and the
 * successor carries the same question, the same rule, the same brief and the
 * same businesses under the Workshop's identity, with a public page. The
 * owner's review of who may be contacted is not carried: whether those
 * businesses are still the right ones is one of the questions the reframe
 * asks, and the answer is his.
 */
export async function reframeProof1UnderTheWorkshop(founderId: string): Promise<Proof1Reframe> {
  const { publicWorkshopOf } = await import('../public-workshop/settings.js');
  const { givePublicIdentity, publicIdentityOf, updatePublicCopy } = await import('../public-workshop/identity.js');
  const w = await publicWorkshopOf(founderId);
  if (!w) throw new Error('no public Workshop; establish it first');
  const current = await findProof1(founderId);
  if (!current) throw new Error('Proof 1 is not seeded');
  const already = await publicIdentityOf(current);
  if (already) return { original: already.supersedes ?? current, successor: current, number: already.number, slug: already.slug, alreadyReframed: true };
  const e = (await query('SELECT opportunity_id, unknown_id, claim_id, decision, cost_cents, settles_when FROM venture_experiments WHERE id = ?', [current])).rows[0] as Record<string, unknown>;
  if (e.decision != null) throw new Error(`Proof 1 is already decided (${String(e.decision)}); a decided test is not reframed in place`);
  const successor = await designExperiment({
    founderId, opportunityId: String(e.opportunity_id), unknownId: String(e.unknown_id), claimId: e.claim_id == null ? null : String(e.claim_id), evidenceMode: 'real', costCents: Number(e.cost_cents),
    whatWeDo: `Write once to each approved Massachusetts millwork business as ${w.operatorName} — ${w.publicName}, pointing at the experiment's page on ${w.zoneName}, offering a $29 one-time pilot brief of open public bid notices relevant to millwork, and deliver it by email on payment. Supersedes ${current}, which was declined before launch because its design pointed a raw payment link from a fresh domain and carried more identity and reputation cost than it counted.`,
    whatWeExpect: 'At least one business pays $29 and receives the brief before 25 have received the offer, within seven days of the offer being placed',
    wouldDisprove: 'Twenty-five businesses receive the offer and none pays and receives the brief, or seven days pass without one; a refunded or undelivered purchase does not count',
    settlesWhen: { event: 'delivery', atLeast: 1, outOf: 'offer_delivered', atMost: 25, withinDays: 7 },
  });
  await query('UPDATE venture_experiments SET needs_workshop = 0 WHERE id = ?', [successor]);
  const identity = await givePublicIdentity({ experimentId: successor, founderId, slug: PROOF1_SLUG, copy: PROOF1_PUBLIC, supersedesExperimentId: current });
  // THE IDENTITY IS FIXED; THE WORDS ARE NOT. Reframing is idempotent, so an
  // identity that already exists keeps its number and its slug — and would
  // otherwise keep whatever copy it was first given, leaving an improvement to
  // the public words with no way to reach the page it was written for.
  await updatePublicCopy(successor, PROOF1_PUBLIC);
  await addRecipients({ founderId, experimentId: successor, recipients: PROOF1_RECIPIENTS });
  await refreshMaterials(founderId, successor);
  const { decideExperiment } = await import('./validation.js');
  await decideExperiment({ experimentId: current, decision: 'declined', by: 'institution:workshop_keeper', via: 'its own authorisation' });
  return { original: current, successor, number: identity.number, slug: identity.slug, alreadyReframed: false };
}

async function refreshMaterials(founderId: string, experimentId: string): Promise<void> {
  const by = 'institution:seed:proof-1';
  const same = async (kind: 'deliverable' | 'offer_template' | 'offer_shape', body: string) => (await materialOf(experimentId, kind))?.body === body;
  if (!(await same('deliverable', BRIEF_MD))) await recordMaterial({ founderId, experimentId, kind: 'deliverable', title: PROOF1_TITLE, body: BRIEF_MD, pulledAt: PROOF1_EDITION_PULLED_AT, by });
  if (!(await same('offer_template', OUTREACH_TEMPLATE_MD))) await recordMaterial({ founderId, experimentId, kind: 'offer_template', title: PROOF1_PLAN.offerSubject, body: OUTREACH_TEMPLATE_MD, by });
  const plan = JSON.stringify(PROOF1_PLAN);
  if (!(await same('offer_shape', plan))) await recordMaterial({ founderId, experimentId, kind: 'offer_shape', title: 'The offer\'s shape', body: plan, by });
}
