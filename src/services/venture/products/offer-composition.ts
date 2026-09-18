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
import { kindsFoundryCanMake, makeBrief } from './registry.js';
import type { BriefSpec, Made } from './registry.js';

/** The kinds of source a brief may be built from: what the eyes keep, item by item. */
const BRIEF_SOURCES = ['job_posting', 'app_store', 'community', 'review', 'directory'] as const;

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
  '  "source_types": <an array from: "job_posting", "app_store", "community", "review", "directory">,',
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
export function briefFacts(): OfferShapePlan['facts'] {
  return {
    recurring_billing: { present: 0, grounds: 'Charges: one-time; nothing renews' },
    persistent_personal_data: { present: 0, grounds: 'Collects: the buyer\'s email for the one delivery and a refund on request; nothing kept beyond the order record' },
    cross_border_selling: { present: 0, grounds: 'Sells to: businesses in the United States, written to once each' },
    support_obligation: { present: 0, grounds: 'Delivers: one brief, once; a refund on request instead of support' },
    manual_fulfilment: { present: 0, grounds: 'Delivers by: the hand sends the brief by email when the payment settles; nobody does anything by hand per sale' },
    user_generated_content: { present: 0, grounds: 'Sells: a shortlist of public records with their addresses, nobody\'s words republished as the Workshop\'s own' },
    account_system: { present: 0, grounds: 'Delivers by: email; no account with the Workshop' },
    two_sided_marketplace: { present: 0, grounds: 'Sells to: one audience, the buyer' },
    one_visit_delivery: { present: 1, grounds: 'Delivers by: a buyer pays and the brief arrives by email' },
    front_loaded_attention: { present: 0, grounds: 'The brief is made from rows the eyes keep; nobody\'s attention is spent per edition' },
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
  if (design.exchange.exchange !== 'upfront_price') return { refused: `a brief is sold at a fixed price; the design chose ${design.exchange.whatItIs}` };
  if (!kindsFoundryCanMake().some((k) => k.kind === 'data_brief')) return { refused: 'the hands cannot make a brief' };
  const record = await theRecordOf(experimentId);
  if (!record) return { refused: 'no record' };
  const reply = await callSonnet(SYSTEM,
    `<record>${JSON.stringify({ candidate: record.candidate, test: record.experiment, evidence: record.evidence.slice(0, 20), retrievals: record.retrievals, charter: record.charter }, null, 1)}</record>\n<design>${JSON.stringify({
      decides: design.decides, canProve: design.canProve, cannotProve: design.cannotProve, distribution: design.distribution, ifItSucceeds: design.ifItSucceeds }, null, 1)}</design>`,
    1800, institutionSpend('shaping the offer of a designed test for the owner\'s portfolio search, which has no company to charge yet', 'shaping an offer', { kind: 'experiment', id: experimentId }));
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
  const price = Number(raw.price_dollars);
  if (!Number.isInteger(price) || price < 5 || price > 49) return { refused: 'the price is not a whole number of dollars between 5 and 49' };
  const sourceTypes = (Array.isArray(raw.source_types) ? raw.source_types.map(String) : []).filter((s): s is typeof BRIEF_SOURCES[number] => (BRIEF_SOURCES as readonly string[]).includes(s));
  if (sourceTypes.length === 0) return { refused: 'no source the eyes keep was named' };
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
    facts: briefFacts(),
    price: { amountCents: price * 100, currency: 'USD', lookupKey: `foundry_brief_${experimentId}_one_time`, productName: str(raw, 'product_name')!,
      productMetadata: { app_object: 'experiment_deliverable', plan_key: `brief_${experimentId}` }, confirmationMessage: 'Thank you. The brief is on its way by email.' },
    offerSubject: str(raw, 'offer_subject')!,
    venue: 'workshop',
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
