// =============================================================================
// FOUNDRY — the forge shapes the offer for what the hands can make
//
// A sealed design says what a test decides and which exchange settles it. It
// does not yet say what is sold, at what price, to whom and how it is
// delivered — the six sentences an asset states of itself, and the facts the
// legal pass reads. For a hand-written test those were the owner's. Here the
// forge composes them for one of the kinds the hands can make today, on the
// operational model, from the design and the record; the recipe fills the
// structural facts, because they are properties of the recipe and not
// opinions; and the hands make the thing and refuse it at their own gate.
// =============================================================================
import { callSonnet } from '../../ai/client.js';
import { dataBlockInstruction } from '../../ai/sanitize.js';
import { institutionSpend } from '../../ai/what-it-is-for.js';
import type { OfferShapePlan } from '../hand.js';
import { designOf } from '../probe-design.js';
import { theRecordOf } from '../forge-deliberation.js';
import { PAID_BRIEF_SOURCES, kindsFoundryCanMake, makeBrief, sourcesRefusedForSale } from './registry.js';
import type { BriefSpec, Made } from './registry.js';
import { checkToolQuality, toolFrom } from './tool.js';
import { BANNED_CLAIMS } from '../hand.js';
import { priceIsMostlyFees } from '../fee-floor.js';

/**
 * THE EXCHANGES THE HANDS CAN CARRY, and what each makes. A fixed price sells
 * the brief. A free thing with a downstream role is a free calculator on the
 * same page as the brief it leads to (PENDING 20 and 31, migration 379). A
 * subscription sells a new edition of the brief every week, for as long as
 * the buyer wants it and the test may deliver it (R19, migration 381).
 */
export const EXCHANGES_THE_HANDS_CARRY = ['upfront_price', 'free_with_role', 'value_first', 'subscription'] as const;

/**
 * A WEEK OF A BRIEF, bounded. Three dollars is the least a week is worth
 * charging for once the provider's fee is taken; fifteen is the most a test
 * asks a stranger to commit to every week before it has shown them one.
 */
export const WEEKLY_BAND = { lowDollars: 3, highDollars: 15 } as const;

const SUBSCRIPTION_SYSTEM = [
  '',
  'THIS DESIGN CHARGES EVERY WEEK, and that replaces "Nothing recurs" and the one-time price above.',
  'The buyer gets a new edition of the brief each week, made again from what the eyes retrieved that',
  'week, until they cancel or the test ends. "price_dollars" is the WEEKLY price, a whole number from',
  `${String(WEEKLY_BAND.lowDollars)} to ${String(WEEKLY_BAND.highDollars)}. "charges_how" says it is charged every week until`,
  'cancelled, and that every email carries a link that cancels it with nothing charged after the week',
  'paid for. "delivers_by" says a new edition arrives by email each week. Nothing else recurs.',
].join('\n');

/**
 * PAY WHAT IT WAS WORTH, bounded. Three dollars is the floor (R29): at a
 * dollar the card fee is a third of the money, and a payment that is mostly
 * fee says nothing about what the brief was worth. Paying nothing at all is
 * still allowed and is not a payment. A hundred is the ceiling because a test
 * of what a brief is worth to somebody is not a request for a donation.
 */
export const CHOSEN_BAND = { minimumCents: 300, maximumCents: 10_000 } as const;

const VALUE_SYSTEM = [
  '',
  'THIS DESIGN GIVES FIRST. The whole brief is published free on the page; afterwards the reader may',
  'pay what it was worth to them, including nothing. "price_dollars" is the amount SUGGESTED, not',
  'charged; "charges_how" says plainly that paying is optional and the reader chooses the amount;',
  '"delivers_by" says the brief is on the page and a copy is emailed to anyone who pays.',
].join('\n');

/** What the composition is asked for besides the brief, when the design gives something away. */
const TOOL_SYSTEM = [
  '',
  'THIS DESIGN GIVES SOMETHING AWAY. Beside the paid brief, the page carries a free calculator for',
  'the same people: a few numbers in, an answer out, which leads naturally to wanting the brief.',
  'Add a "tool" key to the JSON:',
  '"tool": { "title": <short>, "explains": <one sentence: what it works out>,',
  '  "inputs": [ { "id": <lowercase_name>, "label": <words>, "unit": <short word or null>, "min": n, "max": n, "step": n, "value": n } ],',
  '  "outputs": [ { "id": <lowercase_name>, "label": <words>, "unit": <short word or null>, "formula": <arithmetic>, "decimals": 0-4 } ],',
  '  "examples": [ { "inputs": { <id>: n }, "outputs": { <id>: n } } ] }',
  'Formulas use numbers, input names, earlier output names, + - * / ^, brackets, and min, max, abs,',
  'floor, ceil, round(x, places), sqrt. 1-8 inputs, 1-6 outputs, 2-6 worked examples you have checked',
  'by hand; the tool is refused if any example is wrong or any answer breaks inside the ranges.',
  'It claims nothing it cannot compute, names nobody, and carries no address.',
].join('\n');

/**
 * THE ONLY SHAPE OF MONEY THE HANDS CAN CURRENTLY TAKE, named once so that
 * anything reporting on it reports the number that is actually enforced.
 *
 * The prompt says it in words and the gate below says it in a comparison, and
 * a third statement of it somewhere else would be a fourth thing to keep in
 * step. Whatever reads this is reading the rule, not a copy of it.
 */
export const OFFER_BAND = { lowDollars: 5, highDollars: 49, exchange: 'upfront_price', recurs: false } as const;

/**
 * WHAT A WEEKLY BRIEF IS, where it differs from one sold once. The recurring
 * charge is present and enforced, which the first-proof rule refuses until
 * the owner lifts it themselves (R17); every other fact is the brief's.
 */
export function subscriptionFacts(): OfferShapePlan['facts'] {
  return {
    ...briefFacts(),
    recurring_billing: {
      present: 1, basis: 'enforced',
      enforcedBy: 'validateExperimentPaymentLink accepts only a weekly link at the stated price, every delivery carries a signed cancel link, and the hand stops every subscription before the test can no longer deliver (stopWhatRecurs)',
      grounds: 'Charges: every week until the buyer cancels or the test ends; nothing is charged after the week paid for',
    },
    support_obligation: {
      present: 0, basis: 'observed',
      grounds: 'Delivers: a new edition each week paid for, and a refund of that week on request instead of ongoing help. '
        + 'What is owed is bounded and real: each week\'s brief, a refund when a week\'s delivery fails or the buyer '
        + 'asks, and a stop whenever the buyer asks or the test ends',
    },
    one_visit_delivery: { present: 0, basis: 'observed', grounds: 'Delivers by: a new edition by email each week the buyer pays for' },
  };
}

/** The kinds of source a brief may be built from: what the eyes keep, item by item. */
// ONLY WHAT MAY BE SOLD (R23). The eyes read more kinds than these; the
// composer is offered the two whose terms allow a paid list of links.
const BRIEF_SOURCES = PAID_BRIEF_SOURCES;

const SYSTEM = [
  'You shape the offer for one small real test a studio has designed: what is sold, what it',
  'claims, what it collects, how it is delivered, to whom it sells, how it charges — six plain',
  'sentences a buyer could hold the Workshop to — and the brief the hands will make: a title, the',
  'search words the eyes were asked with, which kinds of source to draw on, and what it covers.',
  '',
  'YOU MAY NOT CREATE a fact about the world: no counts, no names, no market sizes, no claims the',
  'record does not carry. The brief is made of rows the eyes already retrieved and cites each one;',
  'you name the words and the sources, nothing else. THE WORKSHOP IS THE VOICE; no person is named.',
  'Nothing recurs. Nothing is guaranteed. The price is one-time, between five and forty-nine',
  'dollars, and says why.',
  '',
  'Reply with one JSON object and nothing else:',
  '{',
  '  "title": <the brief\'s title, without a date>,',
  '  "terms": <the exact search words of one of the record\'s RETRIEVALS, copied verbatim; a brief is built only from rows the eyes kept>,',
  '  "source_types": <an array from: "community", "directory"; other kinds the eyes read may not go into anything sold>,',
  '  "coverage": <one or two sentences on what the brief covers and does not>,',
  '  "price_dollars": <integer 5-49>, "price_because": <one sentence>,',
  '  "product_name": <a short product name>,',
  '  "sells": <sentence>, "claims_made": <sentence>, "collects": <sentence>,',
  '  "delivers_by": <sentence>, "sells_to": <sentence>, "charges_how": <sentence>,',
  '  "lighter": <one sentence: why nothing lighter would settle the question>,',
  '  "offer_subject": <the email subject line>,',
  '  "page": {',
  '    "summary": <one or two plain sentences for the public page: what it is and why>,',
  '    "who": <who it is for>, "what": <exactly what a buyer receives>,',
  '    "limits": <what it does not claim>, "sources": <what it relies on, named as the record names them>,',
  '    "note": <two sentences in the Workshop\'s own voice about this pilot; no person named>',
  '  }',
  '}',
  '',
  dataBlockInstruction('record'),
  dataBlockInstruction('design'),
].join('\n');

/** The structural facts of a brief, which are properties of the recipe and not opinions. */
/**
 * WHAT A BRIEF ACTUALLY IS, and what kind of claim each line is.
 *
 * These are the premises the first-proof policy is evaluated against, and
 * three of them used to be recipe INTENTIONS recorded as though somebody had
 * checked. An independent reviewer traced the path — recipe to structural fact
 * to policy verdict — and found nothing anywhere that said which was which.
 *
 *   "nothing kept beyond the order record" — the order record holds the
 *   buyer's email address. That is personal information, kept. Saying it is
 *   not kept does not make it not kept; it defines it away, and the owner
 *   needs it carried honestly through the lifecycle rather than argued out of
 *   existence.
 *
 *   "sells to businesses in the United States" — an intention. A public
 *   payment link takes a card from anywhere, and nothing in this institution
 *   refuses one.
 *
 *   "a refund on request instead of support" — a refund policy does not remove
 *   delivery failures or the work of handling them. This institution proved,
 *   one wave ago, that it carries exactly those obligations: a bounced
 *   delivery is refunded, a buyer may ask for their money back through a
 *   signed link, and where goods cannot go out the owner is asked to act.
 *
 * So each fact now says whether a control ENFORCES it, whether somebody
 * OBSERVED it, or whether it is ASSUMED. The policy can then refuse to treat
 * an assumption as a finding, which is the whole repair.
 */
export function briefFacts(): OfferShapePlan['facts'] {
  return {
    recurring_billing: {
      present: 0, basis: 'enforced',
      enforcedBy: 'validateExperimentPaymentLink refuses a recurring link before any offer goes out',
      grounds: 'Charges: one-time; nothing renews, and the gate refuses a link that would',
    },
    // CHECKED, NOT INFERRED. A reviewer reasoned that an order record must
    // hold the buyer's email, and that is a sound inference about most
    //institutions and wrong about this one: `buyerAddressFor` reads the
    // address from the provider at the moment of delivery, and the only
    // durable trace is a keyed hash that exists to tell the owner's own
    // payments apart from the market's. The claim survives being checked, so
    // it stands — and the grounds now say what IS kept rather than implying
    // nothing is.
    persistent_personal_data: {
      present: 0, basis: 'observed',
      grounds: 'Collects: the buyer\'s email is read from the provider at delivery and not stored; '
        + 'what stays is a keyed hash of it, which tells the owner\'s own payments from the '
        + 'market\'s and cannot be read back into an address. No account, no profile, no tracking',
    },
    cross_border_selling: {
      present: 0, basis: 'assumed',
      grounds: 'Sells to: anyone who finds the page. Nobody is written to, and the way to pay is '
        + 'not restricted by country, so where it sells is an intention rather than a boundary '
        + 'anything enforces',
    },
    // NOT ONGOING HELP — and not nothing either. The fact asks whether a buyer
    // would reasonably expect continuing support; for one brief sold once with
    // a refund link, they would not. What the institution DOES owe is named
    // here rather than left out, because "a refund instead of support" read as
    // though there were no obligations at all, and there are three.
    support_obligation: {
      present: 0, basis: 'observed',
      grounds: 'Delivers: one brief, once; a refund on request instead of ongoing help. What is owed '
        + 'is bounded and real: the brief itself, a refund when a delivery fails or a buyer asks '
        + 'through the signed link, and a decision for the owner where goods cannot go out at all',
    },
    manual_fulfilment: {
      present: 0, basis: 'observed',
      grounds: 'Delivers by: the hand sends the brief by email when the payment settles; nobody does anything by hand per sale',
    },
    user_generated_content: {
      present: 0, basis: 'observed',
      grounds: 'Sells: a shortlist of public records with their addresses, nobody\'s words republished as the Workshop\'s own',
    },
    account_system: {
      present: 0, basis: 'enforced',
      enforcedBy: 'there is no account system in this institution for a buyer to be given one',
      grounds: 'Delivers by: email; no account with the Workshop',
    },
    two_sided_marketplace: { present: 0, basis: 'observed', grounds: 'Sells to: one audience, the buyer' },
    one_visit_delivery: { present: 1, basis: 'observed', grounds: 'Delivers by: a buyer pays and the brief arrives by email' },
    // NOT YET, AND SAID PLAINLY. The brief is made from rows the eyes keep,
    // but a sale can still cost the owner minutes: a refund is his while the
    // money switch is off, and a buyer's email is his while correspondence is
    // off. Nothing may write this fact true; only the owner may decide that an
    // offer which is not yet attention-spent-once can be placed (PENDING 32).
    front_loaded_attention: {
      present: 0, basis: 'assumed',
      grounds: 'Attention is still spent per sale: while the money switch is off every refund is the '
        + 'owner\'s, and while correspondence is off every buyer email is theirs. Nothing here is checked yet',
    },
  };
}

type Row = Record<string, unknown>;
const str = (raw: Row, k: string): string | null => {
  const v = raw[k];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};

/**
 * SHAPE THE OFFER AND MAKE THE THING. Refuses, with the reason, when the
 * design's exchange is not one a brief can carry, when the composition left a
 * sentence unsaid, or when the hands' own gate refuses the brief.
 */
export async function shapeAndMake(experimentId: string): Promise<Made | { refused: string }> {
  const design = await designOf(experimentId);
  if (!design) return { refused: 'no design' };
  const exchange = design.exchange.exchange;
  if (!(EXCHANGES_THE_HANDS_CARRY as readonly string[]).includes(exchange)) return { refused: `the hands sell a brief at a fixed price or every week, give a free tool beside one, or give it first for what it was worth; the design chose ${design.exchange.whatItIs}` };
  if (!kindsFoundryCanMake().some((k) => k.kind === 'data_brief')) return { refused: 'the hands cannot make a brief' };
  const givesATool = exchange === 'free_with_role';
  const givesFirst = exchange === 'value_first';
  const recurs = exchange === 'subscription';
  if (givesATool && !kindsFoundryCanMake().some((k) => k.kind === 'static_tool')) return { refused: 'the hands cannot make a free tool' };
  const record = await theRecordOf(experimentId);
  if (!record) return { refused: 'no record' };
  // Refused before anything is thought or made: the allowance would refuse it.
  if (recurs) {
    const { subscriptionsRunnable } = await import('../hand.js');
    const runnable = await subscriptionsRunnable(record.founderId);
    if (!runnable.ok) return { refused: runnable.because };
  }
  const reply = await callSonnet(givesATool ? `${SYSTEM}\n${TOOL_SYSTEM}` : givesFirst ? `${SYSTEM}\n${VALUE_SYSTEM}` : recurs ? `${SYSTEM}\n${SUBSCRIPTION_SYSTEM}` : SYSTEM,
    `<record>${JSON.stringify({ candidate: record.candidate, test: record.experiment, evidence: record.evidence.slice(0, 20), retrievals: record.retrievals, charter: record.charter }, null, 1)}</record>\n<design>${JSON.stringify({
      decides: design.decides, canProve: design.canProve, cannotProve: design.cannotProve, distribution: design.distribution, ifItSucceeds: design.ifItSucceeds }, null, 1)}</design>`,
    givesATool ? 3200 : 1800, institutionSpend('shaping the offer of a designed test for the owner\'s portfolio search, which has no company to charge yet', 'shaping an offer', { kind: 'experiment', id: experimentId }));
  const from = reply.content.indexOf('{'); const to = reply.content.lastIndexOf('}');
  if (from < 0 || to <= from) return { refused: 'the composition was not an offer' };
  let raw: Row;
  try { raw = JSON.parse(reply.content.slice(from, to + 1)) as Row; } catch { return { refused: 'the composition was not an offer' }; }
  const need = ['title', 'terms', 'coverage', 'price_because', 'product_name', 'sells', 'claims_made', 'collects', 'delivers_by', 'sells_to', 'charges_how', 'lighter', 'offer_subject'];
  const page = (raw.page && typeof raw.page === 'object' ? raw.page : {}) as Row;
  const pageNeed = ['summary', 'who', 'what', 'limits', 'sources', 'note'].filter((k) => str(page, k) === null);
  if (pageNeed.length) return { refused: `the page copy left out ${pageNeed.join(', ')}` };
  const missing = need.filter((k) => str(raw, k) === null);
  if (missing.length) return { refused: `the offer left out ${missing.join(', ')}` };
  // WHAT THE MODEL WROTE IS READ BEFORE IT IS STORED (R29c). The offer text
  // and the deliverable were held to the banned claims and the page copy was
  // not, though the page is what a stranger reads first; and the sentence that
  // says how it charges was never read against the plan it describes.
  const said = [...need.map((k) => str(raw, k) ?? ''), ...['summary', 'who', 'what', 'limits', 'sources', 'note'].map((k) => str(page, k) ?? '')].join('\n').toLowerCase();
  const banned = BANNED_CLAIMS.filter((phrase) => said.includes(phrase));
  if (banned.length) return { refused: `the copy makes a claim the Workshop does not make: ${banned.map((b) => `"${b}"`).join(', ')}` };
  const chargesHow = (str(raw, 'charges_how') ?? '').toLowerCase().replace(/\bno subscription\b|\bnot a subscription\b/g, '');
  const saysRecurring = /\b(weekly|every week|a week|per week|monthly|every month|per month|subscription|recurring|renews?)\b/.test(chargesHow);
  if (recurs && !/\b(weekly|every week|a week|per week)\b/.test(chargesHow)) return { refused: 'the sentence on how it charges does not say it charges every week' };
  if (!recurs && saysRecurring) return { refused: 'the sentence on how it charges describes a repeating charge the plan does not make' };
  const price = Number(raw.price_dollars);
  const band = recurs ? WEEKLY_BAND : OFFER_BAND;
  if (!Number.isInteger(price) || price < band.lowDollars || price > band.highDollars) return { refused: `the ${recurs ? 'weekly ' : ''}price is not a whole number of dollars between ${String(band.lowDollars)} and ${String(band.highDollars)}` };
  // NO PRICE IS MOSTLY FEES (R29), read at the least a buyer could pay. The
  // bands sit above the line today; this keeps a band change honest.
  const mostlyFees = priceIsMostlyFees({ venue: 'stripe', amountCents: price * 100, chosen: givesFirst ? CHOSEN_BAND : null });
  if (mostlyFees) return { refused: `the price is mostly fees: ${mostlyFees}` };
  // THE FREE TOOL, read strictly and refused at its own gate: every worked
  // example reproduced by the arithmetic the page will run, every answer
  // finite across the ranges. A tool that fails is not published, and neither
  // is the offer it was meant to stand beside.
  const tool = givesATool ? toolFrom(raw.tool) : null;
  if (givesATool) {
    if (!tool) return { refused: 'the design gives a tool away and the composition sent none' };
    const problems = checkToolQuality(tool, BANNED_CLAIMS);
    if (problems.length) return { refused: `the free tool did not pass its gate: ${problems.slice(0, 3).join('; ')}` };
  }
  const named = Array.isArray(raw.source_types) ? raw.source_types.map(String) : [];
  const sourceTypes = named.filter((s): s is typeof BRIEF_SOURCES[number] => (BRIEF_SOURCES as readonly string[]).includes(s));
  if (sourceTypes.length === 0) {
    const refused = sourcesRefusedForSale(named);
    return { refused: refused.length > 0 ? `a brief that is sold may not be made from ${refused.join('; ')}` : 'no source the eyes keep was named' };
  }
  // THE WORDS ARE THE EYES' WORDS. The composed terms are used when they name
  // a retrieval the record holds; otherwise the record's own retrievals are
  // tried in order of what they found, and a brief of nothing is refused.
  const composedTerms = str(raw, 'terms')!;
  const known = record.retrievals.filter((x) => sourceTypes.includes(x.sourceType as typeof BRIEF_SOURCES[number]));
  const candidates = [composedTerms, ...known.map((x) => x.terms)].filter((t, i, all) => all.indexOf(t) === i);
  const spec: BriefSpec = { kind: 'data_brief', title: str(raw, 'title')!, terms: composedTerms, sourceTypes, coverage: str(raw, 'coverage')!, limit: 25 };
  const { rowsForBrief } = await import('./registry.js');
  for (const terms of candidates) {
    if ((await rowsForBrief(record.founderId, { ...spec, terms })).items.length > 0) { spec.terms = terms; break; }
  }
  const plan: OfferShapePlan = {
    shape: { sells: str(raw, 'sells')!, claimsMade: str(raw, 'claims_made')!, collects: str(raw, 'collects')!, deliversBy: str(raw, 'delivers_by')!, sellsTo: str(raw, 'sells_to')!, chargesHow: str(raw, 'charges_how')! },
    lighter: str(raw, 'lighter')!,
    facts: recurs ? subscriptionFacts() : briefFacts(),
    price: recurs
      ? { amountCents: price * 100, currency: 'USD', lookupKey: `foundry_brief_${experimentId}_weekly`, productName: str(raw, 'product_name')!,
        productMetadata: { app_object: 'experiment_deliverable', plan_key: `brief_${experimentId}` }, confirmationMessage: 'Thank you. This week\'s brief is on its way by email, with a link to cancel in every one.',
        recurring: { interval: 'week' } }
      : givesFirst
      ? { amountCents: price * 100, currency: 'USD', lookupKey: `foundry_brief_${experimentId}_chosen`, productName: str(raw, 'product_name')!,
        productMetadata: { app_object: 'experiment_deliverable', plan_key: `brief_${experimentId}` }, confirmationMessage: 'Thank you. A copy of the brief is on its way by email.',
        chosen: { ...CHOSEN_BAND } }
      : { amountCents: price * 100, currency: 'USD', lookupKey: `foundry_brief_${experimentId}_one_time`, productName: str(raw, 'product_name')!,
        productMetadata: { app_object: 'experiment_deliverable', plan_key: `brief_${experimentId}` }, confirmationMessage: 'Thank you. The brief is on its way by email.' },
    offerSubject: str(raw, 'offer_subject')!,
    venue: 'workshop',
    ...(tool ? { tool } : {}),
  };
  const made = await makeBrief({ founderId: record.founderId, experimentId, spec, plan });
  if ('refused' in made) return made;
  // THE PAGE IS THE VENUE. The experiment gets its public identity — a number,
  // a slug, the copy a stranger reads — in the Workshop's voice, and the copy
  // says plainly that nobody was written to.
  const { givePublicIdentity, publicIdentityOf, slugify } = await import('../../public-workshop/identity.js');
  if (!(await publicIdentityOf(experimentId))) {
    const base = slugify(spec.title).slice(0, 48) || 'brief';
    const { query } = await import('../../../db/client.js');
    const taken = (await query('SELECT 1 FROM public_experiments WHERE founder_id = ? AND slug = ?', [record.founderId, base])).rows.length > 0;
    await givePublicIdentity({
      experimentId, founderId: record.founderId, slug: taken ? `${base}-${experimentId.slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, '')}` : base,
      copy: { title: spec.title, summary: str(page, 'summary')!, who: str(page, 'who')!, what: str(page, 'what')!, limits: str(page, 'limits')!,
        sources: str(page, 'sources')!, selection: 'Nobody was written to about this. You found this page yourself.', note: str(page, 'note')! },
    });
  }
  return made;
}
