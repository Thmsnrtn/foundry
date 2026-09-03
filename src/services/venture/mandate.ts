// =============================================================================
// FOUNDRY — an entrepreneurial mandate
//
// "Find another small digital income stream that would make my portfolio more
// resilient." And its special case: "I'd like you to add a new micro-SaaS
// venture to my portfolio."
//
// THE CANONICAL REQUEST IS THE FIRST ONE, and the difference matters. A
// micro-SaaS is one economic form among many — transactional, data, API,
// marketplace-distributed, licensing, a productised service. Hearing the
// general request as the specific one would quietly turn this into a SaaS
// factory, which is the wrong institution: what is being assembled is a
// portfolio of small digital cash-flow engines, and the form each one takes is
// an outcome of the search rather than an input to it.
//
// THE FAILURE THIS EXISTS TO PREVENT is hearing either as "build me a SaaS". It
// is a standing instruction to go and LOOK — under constraints, with a budget,
// accreting guidance over weeks, stoppable — and the software, if it ever
// exists, is the last thing that happens rather than the first.
//
// STEERING IS ABSORBED, NOT ACKNOWLEDGED. "I don't want paid acquisition"
// becomes a row every later candidate is filtered by; "try harder to disprove
// it" raises the bar a candidate must clear. A mandate that heard those and
// kept its own counsel would be a chat window with a database behind it.
//
// AND IT PRODUCES NOTHING UNTIL IT CAN SEE. Foundry has no market sense
// (migration 234), so there is nowhere for a claim about the world to come
// from. It says so. The alternative — a fluent analysis assembled from a
// model's recollection, with no source anyone could check — is invented
// evidence wearing a research report's clothes, and it would be laundered into
// owner truth the moment a company was created on the strength of it.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import type { PortfolioFit } from '../founder/resilience.js';
import type { HowItWasResearched, OpenUnknown, Standing } from './market-evidence.js';
import type { Experiment, WhereToLookNext } from './validation.js';
import type { LegalPicture } from './legal-surface.js';
import type { Need } from '../institution/capabilities.js';

export type GuidanceKind =
  | 'avoid' | 'prefer' | 'industry' | 'budget' | 'harder' | 'deeper'
  | 'favour' | 'another';

export interface MandateProposal {
  kind: 'mandate'; statement: string; shape: string | null;
}
export interface GuidanceProposal {
  kind: 'guidance'; statement: string; guidance: GuidanceKind; subject: string | null;
  /**
   * STEERING THAT NAMES THE PORTFOLIO RATHER THAN A THING.
   *
   * "Avoid increasing our biggest existing dependencies" names nothing he could
   * point at - it names whatever the portfolio is most concentrated on today.
   * The sentence cannot be turned into rows without looking, so the reader
   * says what has to be looked up and the absorber does the looking, writing
   * one avoidance per concentration with the day's answer on the record.
   */
  resolve?: 'biggest_dependencies';
  /**
   * The exposure axis this steering is about, when it is about one.
   *
   * This is what makes "something less dependent on Google" mean something.
   * Without it the sentence could only be matched against a candidate's prose,
   * which would reject a candidate that mentioned Google in passing and accept
   * one whose entire distribution was search. With it, the steering is applied
   * to what the candidate DECLARED about how it makes money, in the same
   * sixteen-axis vocabulary the portfolio is measured on.
   */
  dimension: string | null;
}
export interface StopProposal { kind: 'stop_mandate'; statement: string }
export interface NotVenture { kind: 'not_venture'; statement: string }

export type VentureReading =
  | MandateProposal | GuidanceProposal | StopProposal | NotVenture;

/**
 * The shapes he might name, and NOT the space the search may look in.
 *
 * This list recognises words the owner used. It does not constrain what may be
 * found, and nothing downstream filters by it — an unnamed shape is a mandate
 * to look anywhere, and a named one is a preference on the record. The owner
 * was explicit that economic forms are examples rather than a closed taxonomy:
 * the moment this became the search space, the institution would only ever
 * discover the six things somebody once thought to type here.
 */
const SHAPES: Array<[string, string[]]> = [
  ['micro_saas', ['micro-saas', 'micro saas', 'microsaas', 'small saas', 'tiny saas']],
  ['saas', ['saas', 'software business', 'subscription business']],
  ['marketplace', ['marketplace', 'two-sided']],
  ['newsletter', ['newsletter', 'media business']],
  ['agency', ['agency', 'services business', 'consultancy']],
  ['ecommerce', ['ecommerce', 'e-commerce', 'physical product', 'shop']],
  ['transactional', ['take a cut', 'per transaction', 'transaction fee']],
  ['data', ['data business', 'dataset', 'data product']],
  ['api', ['api business', 'api product', 'developer tool']],
  ['licensing', ['licensing', 'license it', 'white label', 'white-label']],
  ['productised_service', ['productised service', 'productized service', 'done-for-you']],
];

const ASKING = [
  'add a new', 'add another', 'start a new', 'start another', 'find me a',
  'find me another', 'find a ', 'find another', 'look for a ', 'look for another',
  'new venture', 'another venture', 'new business', 'another business',
  'originate', 'a new company', 'another company',
];

/**
 * What he might be asking for one of.
 *
 * "Income stream" is here as a first-class noun, not a synonym for venture: the
 * canonical request names a stream of money rather than a company, and an
 * institution that only recognised "business" would have heard the general
 * mandate as no mandate at all.
 */
const A_THING_THAT_EARNS =
  /\b(venture|business|compan|saas|product|opportunit|income stream|revenue stream|cash[- ]?flow|earner)/;

/**
 * READ ONE SENTENCE ABOUT VENTURES.
 *
 * Deterministic and narrow, for the reason every other owner-intent reader here
 * is: a mandate that misheard would send the institution looking for the wrong
 * thing for weeks, and he would not find out until it came back. What it does
 * not recognise it says it does not recognise.
 */
export function readVentureSentence(raw: string): VentureReading {
  const statement = raw.trim();
  const t = ` ${statement.toLowerCase().replace(/[’]/g, "'")} `;

  if (/\b(stop|abandon|cancel|forget)\b.*\b(look|search|hunt|venture|business|company)/.test(t)
    || /\bstop looking\b|\bstop searching\b|\bcall it off\b/.test(t)) {
    return { kind: 'stop_mandate', statement };
  }

  // GUIDANCE BEFORE MANDATE. "Look for higher-ticket opportunities" contains
  // "look for" and is steering an existing search, not starting a new one.
  const guidance = readGuidance(t, statement);
  if (guidance) return guidance;

  // "MAKE THE RIVER STRONGER." The owner's own shorthand for the whole
  // institution's purpose, heard as the mandate it is: go and look for what
  // would make the portfolio more resilient, naming no shape.
  if (/\b(make|keep)\b[^.]{0,10}\b(the )?river\b[^.]{0,20}\b(strong|wider|deeper|resilient|better)/.test(t)
    || /\bstrengthen the (river|portfolio)\b/.test(t)) {
    return { kind: 'mandate', statement, shape: null };
  }
  if (ASKING.some((p) => t.includes(p)) && A_THING_THAT_EARNS.test(t)) {
    const shape = SHAPES.find(([, phrases]) => phrases.some((p) => t.includes(p)));
    return { kind: 'mandate', statement, shape: shape ? shape[0] : null };
  }
  return { kind: 'not_venture', statement };
}

function readGuidance(t: string, statement: string): GuidanceProposal | null {
  const say = (
    guidance: GuidanceKind, subject: string | null = null, dimension: string | null = null,
  ): GuidanceProposal => ({ kind: 'guidance', statement, guidance, subject, dimension });

  if (/\b(don'?t|do not|no|avoid|without)\b.*\b(paid acquisition|paid ads|ads|advertising|paid marketing)\b/.test(t)) {
    return say('avoid', 'paid acquisition', 'acquisition_channel');
  }
  if (/\b(don'?t|do not|avoid|no)\b.*\b(venture capital|investors|raising|fundraising)\b/.test(t)) {
    return say('avoid', 'outside investment', 'capital_intensity');
  }

  // "I DON'T WANT ANOTHER SUBSCRIPTION BUSINESS."
  //
  // Negation has to be adjacent and explicit, because the un-negated words are
  // most of a mandate: "add another subscription business" is a search, and
  // reading it as its own refusal would be the worst possible mishearing.
  if (/\b(don'?t want|do not want|no more|not another|rather not|sick of|tired of|avoid)\b[^.]{0,40}\b(subscription|recurring|another saas|more saas)\b/.test(t)) {
    return say('avoid', 'subscription', 'revenue_model');
  }

  // "AVOID INCREASING OUR BIGGEST EXISTING DEPENDENCIES."
  if (/\b(avoid|don'?t|do not|without)\b[^.]{0,30}\b(increas|deepen|add to|grow)\w*[^.]{0,20}\b(biggest|largest|existing|current)\b[^.]{0,20}\b(dependenc|concentration|exposure)/.test(t)) {
    return { ...say('avoid', null, null), resolve: 'biggest_dependencies' };
  }

  // "KEEP LEGAL RISK LOW." "REDUCE THE LEGAL EXPOSURE."
  if (/\b(keep|low|lower|reduce|minimi[sz]e|less|avoid)\b[^.]{0,30}\b(legal|regulat|liabilit|compliance)/.test(t)
    || /\b(legal|regulatory)\b[^.]{0,20}\b(risk|exposure)\b[^.]{0,20}\b(low|down|minimal)\b/.test(t)) {
    return say('prefer', 'low legal exposure', 'legal_exposure');
  }

  // "KEEP OWNER BURDEN LOW." "SOMETHING THAT DOESN'T NEED ME."
  if (/\b(owner|my)\b[^.]{0,10}\b(burden|attention|time|involvement)\b[^.]{0,20}\b(low|down|minimal|small)\b/.test(t)
    || /\b(low|minimal|little)\b[^.]{0,10}\b(owner|my)\b[^.]{0,10}\b(burden|attention|involvement)\b/.test(t)
    || /\b(doesn'?t|does not|won'?t) need (me|my attention)\b/.test(t)) {
    return say('prefer', 'almost none of your attention', 'owner_attention');
  }

  // "BRING ME ONLY THINGS THAT DESERVE MY ATTENTION." Fewer, more serious
  // survivors is what raising the bar means, so it is the same lever as "try
  // harder to disprove it" rather than a new kind the search could not act on.
  if (/\b(only|just)\b[^.]{0,30}\b(deserve|worth|serious|earn)\w*[^.]{0,20}\b(attention|time|looking)\b/.test(t)
    || /\bonly (bring|show) me\b/.test(t)) {
    return say('harder');
  }

  // "SOMETHING LESS DEPENDENT ON GOOGLE."
  //
  // The thing named is kept as he said it. Which axis it lands on is a
  // judgement — a platform, a provider and a channel are different failures —
  // and the honest default is the platform, because that is what "dependent on"
  // usually means about a named company.
  const dependence = /\b(less|not so|not too|not|reduce(?:s|d)? (?:my |our )?)\s*(?:dependent|reliant|dependence|reliance)\s*(?:on|upon)\s+([a-z0-9][a-z0-9 .'-]{1,40}?)\s*(?:$|[,.]|\band\b|\bfor\b)/.exec(t);
  if (dependence?.[2]) {
    const named = dependence[2].trim().replace(/\bthe\b\s*/g, '');
    const axis = /stripe|payment|billing|provider|aws|host/.test(named) ? 'provider_dependency'
      : /model|openai|anthropic|llm|\bai\b/.test(named) ? 'ai_dependency'
        : 'platform_dependency';
    return say('avoid', named, axis);
  }

  // "SELL TO BUSINESSES RATHER THAN CONSUMERS."
  const toBusinesses = /\b(businesses|companies|b2b)\b[^.]{0,20}\b(rather than|instead of|not)\b[^.]{0,20}\b(consumers|people|individuals|b2c)\b/.test(t)
    || /\bsell(ing)? to (businesses|companies)\b/.test(t);
  const toConsumers = /\b(consumers|individuals|b2c)\b[^.]{0,20}\b(rather than|instead of|not)\b[^.]{0,20}\b(businesses|companies|b2b)\b/.test(t)
    || /\bsell(ing)? to (consumers|individuals)\b/.test(t);
  if (toBusinesses) return say('prefer', 'businesses', 'customer_type');
  if (toConsumers) return say('prefer', 'consumers', 'customer_type');

  // "ALMOST NO SUPPORT BURDEN."
  if (/\b(almost no|little to no|hardly any|minimal|low|no)\b[^.]{0,20}\bsupport\b/.test(t)
    || /\bdoesn'?t need (looking after|babysitting|support)\b/.test(t)) {
    return say('prefer', 'almost no support burden', 'support_burden');
  }

  // "HIGHER PRICE, FEWER CUSTOMERS."
  if (/higher[- ]ticket|bigger deals|larger contracts|more expensive|higher price|fewer customers/.test(t)) {
    return say('prefer', 'higher ticket', 'pricing_model');
  }
  if (/lower[- ]ticket|smaller deals|smaller contracts|cheaper|self[- ]serve|volume/.test(t)) {
    return say('prefer', 'lower ticket', 'pricing_model');
  }
  if (/\btarget\b.*\binstead\b|\bfocus on\b.*\bindustry\b|\blook (at|in)\b.*\binstead\b/.test(t)) {
    // The industry is his words minus the instruction, kept whole rather than
    // parsed into a taxonomy Foundry would then have to maintain.
    const named = statement.replace(/^.*?\b(target|focus on|look at|look in)\b/i, '')
      .replace(/\binstead\b\.?/i, '').trim();
    return say('industry', named || null, 'industry');
  }
  if (/spend (no more than|up to|at most)|(don'?t|do not|never) spend (more than|over|above)|budget of|no more than \$?\d/.test(t)) {
    const amount = /(\d+(?:\.\d{1,2})?)/.exec(t);
    return amount ? say('budget', amount[1]) : say('budget');
  }
  if (/try harder to (disprove|kill)|be more sceptical|be more skeptical|tear it apart|attack it/.test(t)) {
    return say('harder');
  }
  if (/research (this|it) (more|further|deeper)|dig (deeper|into)|look into (this|it) more/.test(t)) {
    return say('deeper');
  }
  if (/\bi like (this|that) one\b|\bthat one\b.*\b(interesting|promising)\b|\bgo with (this|that)\b/.test(t)) {
    return say('favour');
  }
  if (/show me another|something else|a different one|next option|other options|none of these|keep looking/.test(t)) {
    return say('another');
  }
  return null;
}

/**
 * DOES THIS EXPOSURE ANSWER TO THAT WORD?
 *
 * Kept small on purpose. A generous synonym table would let the institution
 * decide that "search" and "Google" are the same thing on his behalf, and be
 * wrong in the one case where he meant something specific. Substring in either
 * direction covers most of it; the handful of aliases below are the ones where
 * two words are genuinely the same fact, and adding to the list should feel
 * like a decision rather than a convenience.
 */
const ALIASES: Array<string[]> = [
  ['businesses', 'business', 'b2b', 'small businesses', 'companies'],
  ['consumers', 'consumer', 'b2c', 'individuals', 'people'],
  ['subscription', 'recurring', 'saas'],
];

export function exposureAnswersTo(word: string, value: string): boolean {
  const a = word.trim().toLowerCase();
  const b = value.trim().toLowerCase();
  if (a === b || b.includes(a) || a.includes(b)) return true;
  return ALIASES.some((group) =>
    group.some((w) => a === w || a.includes(w))
    && group.some((w) => b === w || b.includes(w)));
}

/**
 * A PARAGRAPH, NOT A SENTENCE.
 *
 * The mature owner request is several sentences at once - a mandate, then the
 * constraints it runs under. Each is read on its own and every one of them
 * must land as durable state, which is the whole difference between an
 * institution and a chat window: "keep legal risk low" said in passing has to
 * still be filtering candidates a month later.
 *
 * What it does not recognise is returned as such, per sentence, so he can see
 * exactly which clause was not heard rather than being told the paragraph was.
 */
/**
 * A CLAUSE OPENING A NEW INSTRUCTION.
 *
 * Not every comma starts one. "A small, finished library" is one noun phrase
 * and splitting it would produce nonsense, so a fragment only counts as its own
 * clause when it opens the way an instruction opens.
 */
const OPENS_A_CLAUSE =
  /^(and\s+|but\s+|then\s+|also\s+|plus\s+)?(keep|avoid|do ?n'?t|do not|never|no more|spend|bring|show|give|prefer|favou?r|focus|stay|stick|make|find|look|only|without|nothing|less|lower|reduce|minimi[sz]e|stop|leave)\b/i;

/**
 * ONE SENTENCE CAN CARRY A MANDATE AND EVERY CONSTRAINT ON IT.
 *
 * THE FAILURE THIS FIXES REACHED THE OWNER. His first real mandate was one
 * sentence — "Make the river stronger by finding another small digital income
 * stream..., keep legal risk low, avoid increasing our biggest existing
 * dependencies, spend no more than $25 validating anything, and bring me only
 * things that deserve my attention." Splitting only on full stops left that as
 * a single piece; guidance is read before mandate, deliberately and correctly,
 * so "keep legal risk low" matched first and the whole thing was filed as
 * steering for a search that did not exist. No search opened. The institution
 * heard the smallest clause in the sentence and dropped the instruction.
 *
 * So a sentence is cut where a new instruction plainly begins, and nowhere
 * else. A fragment that does not open like an instruction is put back on the
 * one before it, which is what keeps ordinary prose intact.
 */
function intoClauses(sentence: string): string[] {
  const parts = sentence.split(/,\s+|\s+and\s+(?=[a-z])/i)
    .map((p) => p.trim()).filter((p) => p.length > 0);
  const clauses: string[] = [];
  for (const part of parts) {
    if (clauses.length > 0 && !OPENS_A_CLAUSE.test(part)) {
      clauses[clauses.length - 1] += `, ${part}`;
    } else {
      clauses.push(part);
    }
  }
  return clauses;
}

export function readVentureParagraph(raw: string): VentureReading[] {
  return raw
    .split(/(?<=[.;!?])\s+|\n+/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
    .flatMap(intoClauses)
    .map(readVentureSentence);
}

// ─── the mandate ─────────────────────────────────────────────────────────────

export interface Mandate {
  id: string; statement: string; shape: string | null; state: string;
  evidenceMode: 'real' | 'reference'; openedAt: string;
  guidance: Array<{
    id: string; statement: string; kind: GuidanceKind;
    subject: string | null; dimension: string | null;
  }>;
}

export async function openMandate(input: {
  founderId: string; statement: string; shape: string | null;
  evidenceMode?: 'real' | 'reference';
}): Promise<Mandate | { refused: string }> {
  const open = await currentMandate(input.founderId);
  if (open) {
    // ONE SEARCH AT A TIME. Two mandates would compete for the same attention
    // and the same budget, and deciding which wins is exactly the judgement
    // that is his.
    return {
      refused: 'you already have a search running. Tell me to stop that one '
        + 'first, or steer it instead.',
    };
  }
  const id = nanoid();
  await query(
    `INSERT INTO venture_mandates (id, founder_id, statement, shape, evidence_mode)
     VALUES (?,?,?,?,?)`,
    [id, input.founderId, input.statement.trim(), input.shape,
      input.evidenceMode ?? 'real']);
  // A REFERENCE MANDATE GETS SOMETHING TO WORK ON. Foundry cannot see a real
  // market, so a real mandate honestly finds nothing until it can — but the
  // machinery around a candidate (unknowns, kill theses, the source
  // requirement, rejection kept with its reason) has to be exercised somewhere,
  // and this is the same reference world everything else is proven in.
  if ((input.evidenceMode ?? 'real') === 'reference') {
    const { exerciseReferenceMandate } = await import('./reference-candidates.js');
    await exerciseReferenceMandate(id);
  }

  const made = await currentMandate(input.founderId);
  if (!made) throw new Error('mandate did not open');
  return made;
}

export async function currentMandate(founderId: string): Promise<Mandate | null> {
  const row = (await query(
    `SELECT id, statement, shape, state, evidence_mode, opened_at
       FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL`, [founderId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const guidance = ((await query(
    `SELECT id, statement, kind, subject, dimension FROM venture_guidance
      WHERE mandate_id = ? AND superseded_by IS NULL ORDER BY rowid`, [String(row.id)]))
    .rows as unknown as Array<Record<string, unknown>>).map((g) => ({
    id: String(g.id), statement: String(g.statement),
    kind: String(g.kind) as GuidanceKind,
    subject: g.subject == null ? null : String(g.subject),
    dimension: g.dimension == null ? null : String(g.dimension),
  }));
  return {
    id: String(row.id), statement: String(row.statement),
    shape: row.shape == null ? null : String(row.shape),
    state: String(row.state), evidenceMode: String(row.evidence_mode) as 'real' | 'reference',
    openedAt: String(row.opened_at).slice(0, 10), guidance,
  };
}

/**
 * Absorb one piece of steering.
 *
 * SUPERSEDING RATHER THAN EDITING. "Target this industry instead" replaces an
 * earlier industry by marking it superseded, so the record still says he
 * changed his mind and when — which is the difference between a search that
 * remembers being redirected and one that only knows where it currently points.
 */
export async function absorbGuidance(input: {
  mandateId: string; statement: string; kind: GuidanceKind;
  subject: string | null; dimension?: string | null;
}): Promise<string> {
  // Resolved from the mandate rather than taken from a caller: a guidance row
  // naming a different person would erase with the wrong account, or not at all.
  const owner = (await query(
    'SELECT founder_id FROM venture_mandates WHERE id = ?', [input.mandateId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!owner) throw new Error('no such mandate');
  const id = nanoid();
  // THE NEW ROW FIRST. `superseded_by` is a foreign key into this same table,
  // so pointing the old guidance at an id that does not exist yet fails — which
  // it did, on the first sentence that replaced an earlier one. The order is
  // not stylistic: the successor has to exist before anything can name it.
  const dimension = input.dimension ?? null;
  await query(
    `INSERT INTO venture_guidance
       (id, mandate_id, founder_id, statement, kind, subject, dimension)
     VALUES (?,?,?,?,?,?,?)`,
    [id, input.mandateId, String(owner.founder_id), input.statement.trim(),
      input.kind, input.subject, dimension]);

  // The kinds that REPLACE rather than accumulate. Two industries is a wider
  // search; two budgets is no budget.
  //
  // BUT ONLY ON THE SAME AXIS. "Higher ticket" and "almost no support burden"
  // are both preferences and they are not in conflict — superseding by kind
  // alone would have silently thrown one of them away, so the second thing he
  // asked for would quietly cancel the first. Two opinions about PRICING are a
  // change of mind; a preference naming no axis at all is treated the same way
  // it always was, because there is nothing finer to tell them apart by.
  const replaces: GuidanceKind[] = ['industry', 'budget', 'prefer'];
  if (replaces.includes(input.kind)) {
    await query(
      `UPDATE venture_guidance SET superseded_by = ?
        WHERE mandate_id = ? AND kind = ? AND superseded_by IS NULL AND id <> ?
          AND dimension IS ?`,
      [id, input.mandateId, input.kind, id, dimension]);
  }
  return id;
}

/**
 * ABSORB A WHOLE PARAGRAPH, resolving what names the portfolio.
 *
 * The mandate opens first if there is one, so the guidance has something to
 * bind to; guidance that arrives with no search running is refused rather than
 * filed nowhere. "Avoid our biggest dependencies" is resolved HERE, against the
 * concentrations of the day, and written as one avoidance per concentration -
 * so the record shows what the sentence meant when he said it, and a later
 * reader does not have to guess what the portfolio looked like.
 */
export async function absorbParagraph(input: {
  founderId: string; readings: VentureReading[]; evidenceMode?: 'real' | 'reference';
}): Promise<{
  opened: boolean; absorbed: number; refused: string[]; notHeard: string[];
}> {
  const refused: string[] = [];
  const notHeard: string[] = [];
  let opened = false;
  let absorbed = 0;

  const mandate = input.readings.find((r) => r.kind === 'mandate');
  if (mandate && mandate.kind === 'mandate') {
    const made = await openMandate({
      founderId: input.founderId, statement: mandate.statement, shape: mandate.shape,
      evidenceMode: input.evidenceMode ?? 'real',
    });
    if ('refused' in made) refused.push(made.refused);
    else opened = true;
  }

  const open = await currentMandate(input.founderId);
  for (const reading of input.readings) {
    if (reading.kind === 'not_venture') { notHeard.push(reading.statement); continue; }
    if (reading.kind === 'stop_mandate') {
      if (await stopMandate(input.founderId, 'the owner said to stop')) absorbed += 1;
      continue;
    }
    if (reading.kind !== 'guidance') continue;
    if (!open) { refused.push(`"${reading.statement}" - there is no search to steer`); continue; }

    if (reading.resolve === 'biggest_dependencies') {
      const { concentrationsFor } = await import('../founder/resilience.js');
      const biggest = (await concentrationsFor(input.founderId, open.evidenceMode)).slice(0, 3);
      if (biggest.length === 0) {
        refused.push(`"${reading.statement}" - nothing is concentrated yet, so there is `
          + 'nothing to avoid deepening');
        continue;
      }
      for (const con of biggest) {
        await absorbGuidance({
          mandateId: open.id, kind: 'avoid', subject: con.value, dimension: con.dimension,
          statement: `${reading.statement} (${String(con.carriedBy.length)} of yours `
            + `share ${con.value})`,
        });
        absorbed += 1;
      }
      continue;
    }
    await absorbGuidance({
      mandateId: open.id, statement: reading.statement, kind: reading.guidance,
      subject: reading.subject, dimension: reading.dimension,
    });
    absorbed += 1;
  }
  return { opened, absorbed, refused, notHeard };
}

export async function stopMandate(founderId: string, reason: string): Promise<boolean> {
  const open = await currentMandate(founderId);
  if (!open) return false;
  await query(
    `UPDATE venture_mandates SET state = 'stopped', closed_at = datetime('now'),
            closed_reason = ? WHERE id = ?`, [reason, open.id]);
  return true;
}

// ─── what it can honestly report ─────────────────────────────────────────────

export interface MandateProgress {
  mandate: Mandate;
  looked: number; rejected: number; open: number;
  /** Non-null when the search cannot proceed, saying exactly why. */
  blocked: string | null;
  /** What it would take to unblock it, in owner language. */
  wouldNeed: string | null;
  /** What it can see through, named. */
  seeingThrough: string[];
  /**
   * WHAT THIS SEARCH IS ACTUALLY FOR, and what it has tried.
   *
   * So a search that found nothing can be told from a search that was never
   * pointed anywhere — and so the shape stays visible as the owner's choice
   * rather than something the institution filled in.
   */
  brief: { lookingFor: string; shapeNamed: string | null; termsTried: string | null } | null;
  /** What it still cannot answer, even with those. */
  stillDark: string[];
}

/**
 * WHERE THE SEARCH ACTUALLY IS.
 *
 * The honest answer today is that it has not started, because Foundry cannot
 * see the market. Saying that plainly is the whole point: an institution that
 * produced three plausible opportunities instead would be inventing the
 * evidence it was asked to gather.
 */
export async function mandateProgress(founderId: string): Promise<MandateProgress | null> {
  const mandate = await currentMandate(founderId);
  if (!mandate) return null;

  const counts = (await query(
    `SELECT COUNT(*) AS looked,
            SUM(CASE WHEN verdict = 'rejected' THEN 1 ELSE 0 END) AS rejected,
            SUM(CASE WHEN verdict IS NULL THEN 1 ELSE 0 END) AS open
       FROM venture_opportunities WHERE mandate_id = ?`, [mandate.id]))
    .rows[0] as Record<string, unknown>;

  // WHICH WAYS OF LOOKING ARE LIVE, asked of the person rather than of a
  // company — a market belongs to nobody's business, and the earlier version of
  // this asked `company_senses`, which could only ever have answered about one.
  //
  // Asked rather than assumed absent, so the day a real source is connected
  // this unblocks itself without anybody editing this function. And asked in
  // the mandate's own world: a rehearsal search sees through rehearsal sources,
  // a real one needs something real.
  const { waysOfLooking, whatIsStillDark } = await import('./research-sources.js');
  const ways = await waysOfLooking(founderId, mandate.evidenceMode);
  const canSeeMarket = ways.length > 0;

  return {
    mandate,
    looked: Number(counts.looked ?? 0),
    rejected: Number(counts.rejected ?? 0),
    open: Number(counts.open ?? 0),
    // EVEN WITH SOURCES, WHAT IS STILL DARK IS SAID. Connecting one way of
    // looking does not mean a market has been comprehended, and an institution
    // that went quiet the moment it could see anything would be claiming
    // exactly that.
    blocked: canSeeMarket ? null
      : 'I cannot see what is happening outside your companies, so I have '
        + 'nowhere to look. I am not going to describe opportunities from '
        + 'memory — that would read like research and be nothing of the kind.',
    stillDark: canSeeMarket ? await whatIsStillDark(founderId, mandate.evidenceMode) : [],
    seeingThrough: ways.map((w) => `${w.named} — ${w.whatItIs}`),
    brief: await (async () => {
      const row = (await query(
        `SELECT looking_for, shape_named, terms_tried FROM search_briefs
          WHERE mandate_id = ? ORDER BY made_at DESC, rowid DESC LIMIT 1`, [mandate.id]))
        .rows[0] as Record<string, unknown> | undefined;
      return row === undefined ? null : {
        lookingFor: String(row.looking_for),
        shapeNamed: row.shape_named == null ? null : String(row.shape_named),
        termsTried: row.terms_tried == null ? null : String(row.terms_tried),
      };
    })(),
    // WHAT WOULD ACTUALLY UNBLOCK IT, NAMED.
    //
    // "I need a market provider" is the answer of an institution waiting for
    // one thing to be switched on. A market is not one provider, and the
    // machinery here is already built for many partial disagreeing sources —
    // so the honest sentence names the KINDS of thing that would each let it
    // start, and says the rest is ready. Read from the constitutional list, so
    // the day a source type is added this sentence says so by itself.
    wouldNeed: canSeeMarket ? null : await (async () => {
      const kinds = ((await query(
        `SELECT what_it_is FROM market_source_types
          WHERE stance = 'observed' AND source_type <> 'reference_world'
          ORDER BY sort_order LIMIT 4`, []))
        .rows as unknown as Array<Record<string, unknown>>)
        .map((r) => String(r.what_it_is));
      return `somewhere to actually look — ${kinds.join('; ')} — any one of `
        + 'which would let me start. What I would do with it is already built '
        + 'and rehearsed: I would date and attribute everything I saw, keep '
        + 'what contradicted a claim alongside what supported it, and tell you '
        + 'what remained unknown. What is missing is the looking, not the '
        + 'discipline.';
    })(),
  };
}

/**
 * Would this candidate survive what he has told me?
 *
 * The steering is applied HERE, to every candidate, rather than being consulted
 * when someone remembers. A mandate that collected guidance and filtered
 * nothing would be the failure the owner named: treating it as chat.
 */
export async function survivesGuidance(
  candidate: { id?: string; headline: string; why: string },
  guidance: Mandate['guidance'],
): Promise<{ survives: boolean; because: string | null; against: string[] }> {
  const text = `${candidate.headline} ${candidate.why}`.toLowerCase();

  // WHAT THE CANDIDATE SAID ABOUT ITSELF, on the axes the steering names. This
  // is the difference between filtering on evidence and filtering on prose.
  const declared = candidate.id
    ? ((await query(
      `SELECT dimension, value FROM portfolio_exposures
        WHERE subject_kind = 'opportunity' AND subject_id = ? AND retired_at IS NULL`,
      [candidate.id])).rows as unknown as Array<Record<string, unknown>>)
      .map((r) => ({ dimension: String(r.dimension), value: String(r.value) }))
    : [];

  const against: string[] = [];
  for (const g of guidance) {
    if (g.kind === 'avoid' && g.subject) {
      const named = declared.find((e) =>
        e.dimension === g.dimension && exposureAnswersTo(g.subject ?? '', e.value));
      if (named) {
        return {
          survives: false, against,
          because: `it makes its money through ${named.value}, and you told me `
            + `you did not want that`,
        };
      }
      // NO DECLARED EXPOSURE IS NOT A PASS. A candidate that has said nothing
      // about how it makes money cannot demonstrate it avoids anything, so the
      // prose is still read — the weaker test, used where the better one has
      // nothing to work with.
      if (declared.every((e) => e.dimension !== g.dimension)
        && text.includes(g.subject.toLowerCase())) {
        return {
          survives: false, against,
          because: `it depends on ${g.subject}, and you told me not to`,
        };
      }
    }
    // A PREFERENCE IS NOT A PROHIBITION, and collapsing the two would be the
    // easy mistake. "Sell to businesses" does not make a consumer candidate
    // illegitimate; it makes it something he should be told does not match
    // what he asked for, and then decide about himself.
    if (g.kind === 'prefer' && g.subject && g.dimension) {
      const on = declared.find((e) => e.dimension === g.dimension);
      if (on && !exposureAnswersTo(g.subject, on.value)) {
        against.push(`you asked for ${g.subject}; this is ${on.value}`);
      }
    }
  }
  return { survives: true, because: null, against };
}

/** How hard a candidate has to be attacked before it may advance. */
export function scepticismLevel(guidance: Mandate['guidance']): number {
  return 1 + guidance.filter((g) => g.kind === 'harder').length;
}

// ─── presenting them ─────────────────────────────────────────────────────────

/**
 * A SMALL NUMBER OF SERIOUS OPTIONS, IN PLAIN OWNER LANGUAGE.
 *
 * The owner's acceptance test asks for exactly that, and the shape of what he
 * is shown is the whole argument: who has the problem, what it is, why this
 * might matter, the strongest reason it fails, what is verified, and what
 * remains unknown. Not a score. Not a ranking with a number on it.
 *
 * `blockedBy` is what makes it honest rather than a pitch. A candidate whose
 * unknowns include whether anyone would pay has not earned a company however
 * good the rest reads, and it says so on the card rather than in a footnote —
 * which is the difference between advancing on evidence and advancing on prose.
 */
export interface PresentedCandidate {
  id: string; headline: string; whoHasIt: string; theProblem: string;
  whyItMight: string; killThesis: string;
  unknowns: string[]; sources: string[];
  /** Non-null when this cannot be advanced, saying which unknown stops it. */
  blockedBy: string | null;
  survivesGuidance: boolean; failsBecause: string | null;
  /** Preferences of his this does not meet. Not disqualifying; his to weigh. */
  against: string[];
  /**
   * WHAT ADDING IT WOULD DO TO WHAT HE ALREADY OWNS.
   *
   * On every candidate, not only when he asks about resilience. The owner's
   * evolution of the mandate was that this is part of SELECTION — a candidate
   * that would deepen a concentration is worse for him than one that would not,
   * whatever its own merits, and an institution that reported the merits and
   * left the portfolio effect for later would be helping him concentrate.
   */
  fit: PortfolioFit | null;
  /** Claims about the world, and how each currently stands on its evidence. */
  standing: Standing[];
  /**
   * HOW IT WAS RESEARCHED, COLLAPSED INTO JUDGMENT.
   *
   * What the owner meets: how much was looked at, how many ways, what weakens
   * it, what is still unknown — never the sources, the crawling or the calls.
   */
  research: HowItWasResearched[];
  /** What is still not known, with the cheapest thing that would settle it. */
  unanswered: OpenUnknown[];
  /**
   * WHETHER READING MORE WOULD CHANGE ANYTHING.
   *
   * The discipline that stops research becoming performance: when every
   * question in the way is about what people will actually do, another pile of
   * evidence is worth less than a small experiment, and the card says so.
   */
  lookNext: WhereToLookNext;
  /**
   * WHAT WOULD HAVE TO BE TRUE BEFORE IT COULD BECOME A COMPANY.
   *
   * Not a readiness score. A list of sentences he could act on, and an empty
   * list is the only thing that means ready.
   */
  inTheWay: string[];
  /** Tests waiting on him, each with the prediction he would be approving. */
  awaiting: Experiment[];
  /** A buried candidate this resembles, so the same bad idea is not rediscovered. */
  buriedBefore: { headline: string; why: string; revisitIf: string | null } | null;
  /** Which of the portfolio's stated needs this would serve, if any. */
  serves: string[];
  /** What liability it creates, as the owner reads it. */
  legal: LegalPicture;
  /** How it would earn and what it would ask of him, from its declared exposures. */
  declared: { earns: string | null; burden: string | null };
  /** What carrying it would take, one sentence per capability: met, acquirable, missing, or his. */
  wouldTake: Need[];
  reference: boolean;
}

/** The unknowns that are not "more work", but "we do not have a business". */
const DISQUALIFYING = [
  'would pay', 'will pay', 'anyone pays', 'ever paid', 'willing to pay',
];

export async function candidatesFor(mandateId: string): Promise<PresentedCandidate[]> {
  const mandate = (await query(
    `SELECT founder_id, evidence_mode FROM venture_mandates WHERE id = ?`, [mandateId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!mandate) return [];
  const founderId = String(mandate.founder_id);
  const world = String(mandate.evidence_mode) === 'reference' ? 'reference' : 'real';
  const open = await currentMandate(founderId);
  const guidance = open?.guidance ?? [];
  const { portfolioFitOf } = await import('../founder/resilience.js');
  const { standingOf, openUnknowns, howItWasResearched } = await import('./market-evidence.js');
  const { awaitingHim, whatStandsInTheWay, whereToLookNext } = await import('./validation.js');
  const { legalPictureOf } = await import('./legal-surface.js');
  const { whatItWouldTake } = await import('../institution/capabilities.js');

  const rows = ((await query(
    `SELECT id, headline, who_has_it, the_problem, why_it_might, kill_thesis,
            unknowns_json, sources_json, evidence_mode
       FROM venture_opportunities
      WHERE mandate_id = ? AND verdict IS NULL
      ORDER BY rowid`, [mandateId]))
    .rows as unknown as Array<Record<string, unknown>>);

  const presented: PresentedCandidate[] = [];
  for (const r of rows) {
    const unknowns = JSON.parse(String(r.unknowns_json)) as string[];
    const sources = JSON.parse(String(r.sources_json)) as string[];
    const blocking = unknowns.find((u) =>
      DISQUALIFYING.some((phrase) => u.toLowerCase().includes(phrase)));
    const verdict = await survivesGuidance({
      id: String(r.id), headline: String(r.headline), why: String(r.why_it_might),
    }, guidance);
    const fit = await portfolioFitOf({ founderId, opportunityId: String(r.id), world });
    const claims = ((await query(
      'SELECT id FROM market_claims WHERE opportunity_id = ?', [String(r.id)]))
      .rows as unknown as Array<Record<string, unknown>>).map((c) => String(c.id));
    const standing: Standing[] = [];
    const research: HowItWasResearched[] = [];
    for (const claimId of claims) {
      const how = await standingOf(claimId);
      if (how) standing.push(how);
      const done = await howItWasResearched(claimId);
      if (done && done.observations > 0) research.push(done);
    }
    presented.push({
      id: String(r.id), headline: String(r.headline),
      whoHasIt: String(r.who_has_it), theProblem: String(r.the_problem),
      whyItMight: String(r.why_it_might), killThesis: String(r.kill_thesis),
      unknowns, sources,
      blockedBy: blocking ?? (sources.length === 0
        ? 'nothing about it has been checked against anything' : null),
      survivesGuidance: verdict.survives, failsBecause: verdict.because,
      against: verdict.against,
      fit,
      standing, research,
      unanswered: await openUnknowns(String(r.id)),
      lookNext: await whereToLookNext(String(r.id)),
      inTheWay: await whatStandsInTheWay(String(r.id)),
      awaiting: await awaitingHim(String(r.id)),
      buriedBefore: await seenBefore(founderId, String(r.headline)),
      serves: fit.serves,
      legal: await legalPictureOf({ founderId, opportunityId: String(r.id), world }),
      declared: await declaredAbout(String(r.id)),
      wouldTake: await whatItWouldTake({ subjectKind: 'opportunity', subjectId: String(r.id) }),
      reference: String(r.evidence_mode) === 'reference',
    });
  }
  return presented;
}

/**
 * WHAT WAS LOOKED AT AND NOT TAKEN, WITH THE REASON.
 *
 * The constitution calls rejection the valuable half, and until this existed
 * the reason a candidate was turned down was written and never read again —
 * which would have made the record a filing cabinet rather than something the
 * next search starts from. A candidate that was rejected because its own kill
 * thesis landed is a thing worth seeing before somebody proposes it again.
 */
export interface Decided {
  headline: string; verdict: 'rejected' | 'advanced'; why: string; when: string;
}

export async function whatWasDecided(mandateId: string): Promise<Decided[]> {
  return ((await query(
    `SELECT headline, verdict, verdict_why, decided_at
       FROM venture_opportunities
      WHERE mandate_id = ? AND verdict IS NOT NULL
      ORDER BY decided_at DESC, rowid DESC`, [mandateId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    headline: String(r.headline),
    verdict: String(r.verdict) as 'rejected' | 'advanced',
    why: String(r.verdict_why ?? ''),
    when: String(r.decided_at ?? '').slice(0, 10),
  }));
}

/**
 * REJECTION, WHICH IS THE VALUABLE HALF AND HAD NO WRITER.
 *
 * `verdict = 'rejected'` was counted, displayed and never once written by live
 * code: the institution could describe a graveyard it had no way to fill. This
 * is the door. It takes the reason and, deliberately, WHAT WOULD MAKE IT WORTH
 * ANOTHER LOOK - without which a rejected thesis is indistinguishable from a
 * bad one, and the search either re-discovers the same idea every quarter or
 * never revisits one the world has since made good.
 */
export async function rejectCandidate(input: {
  opportunityId: string; why: string; revisitIf: string | null; by: string;
}): Promise<void> {
  await query(
    `UPDATE venture_opportunities
        SET verdict = 'rejected', verdict_why = ?, revisit_if = ?,
            decided_at = datetime('now')
      WHERE id = ? AND verdict IS NULL`,
    [`${input.by}: ${input.why.trim()}`, input.revisitIf?.trim() || null,
      input.opportunityId]);
}

export interface Buried {
  headline: string; why: string; revisitIf: string | null; when: string;
  reference: boolean;
}

/** Everything this person has rejected, across every search, newest first. */
export async function graveyardFor(founderId: string, limit = 20): Promise<Buried[]> {
  return ((await query(
    `SELECT headline, verdict_why, revisit_if, decided_at, evidence_mode
       FROM venture_opportunities
      WHERE founder_id = ? AND verdict = 'rejected'
      ORDER BY decided_at DESC, rowid DESC LIMIT ?`, [founderId, limit]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    headline: String(r.headline), why: String(r.verdict_why ?? ''),
    revisitIf: r.revisit_if == null ? null : String(r.revisit_if),
    when: String(r.decided_at ?? '').slice(0, 10),
    reference: String(r.evidence_mode) === 'reference',
  }));
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'for', 'of', 'to', 'and', 'that',
  'with', 'in', 'on', 'small', 'tool', 'app', 'platform', 'service', 'software']);

function meaningfulWords(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w)));
}

/**
 * HAVE WE BURIED THIS BEFORE?
 *
 * Word overlap, not embeddings, on purpose: the check has to be explicable in
 * one line ("it shares 'veterinary', 'handover' and 'shift' with something you
 * rejected in March") and cheap enough to run on every candidate. It will miss
 * a paraphrase, and it will never claim a match it cannot show.
 */
export async function seenBefore(
  founderId: string, headline: string,
): Promise<{ headline: string; why: string; revisitIf: string | null; shares: string[] } | null> {
  const words = meaningfulWords(headline);
  if (words.size === 0) return null;
  for (const buried of await graveyardFor(founderId, 200)) {
    const theirs = meaningfulWords(buried.headline);
    const shared = [...words].filter((w) => theirs.has(w));
    // Half of what this one says, and at least three words of it.
    if (shared.length >= 3 && shared.length * 2 >= words.size) {
      return { headline: buried.headline, why: buried.why, revisitIf: buried.revisitIf,
        shares: shared };
    }
  }
  return null;
}

/**
 * HOW IT WOULD EARN, AND WHAT IT WOULD ASK OF HIM - from what was declared on
 * the exposure axes, never from a guess dressed as a sentence. Each phrase
 * says whether it was told or worked out, because "almost no support" is a
 * different fact when a person said it than when Foundry inferred it.
 */
async function declaredAbout(opportunityId: string): Promise<{
  earns: string | null; burden: string | null;
}> {
  const rows = ((await query(
    `SELECT dimension, value, how_known FROM portfolio_exposures
      WHERE subject_kind = 'opportunity' AND subject_id = ? AND retired_at IS NULL`,
    [opportunityId])).rows as unknown as Array<Record<string, unknown>>)
    .map((r) => ({ d: String(r.dimension), v: String(r.value), k: String(r.how_known) }));
  const get = (d: string): { v: string; k: string } | undefined => rows.find((r) => r.d === d);
  const said = (x: { v: string; k: string } | undefined): string | null =>
    x ? `${x.v}${x.k === 'inferred' ? ' (worked out)' : ''}` : null;
  const parts = [
    said(get('revenue_model')), said(get('pricing_model')),
    get('acquisition_channel') ? `reached through ${said(get('acquisition_channel')) ?? ''}` : null,
    get('customer_type') ? `sold to ${said(get('customer_type')) ?? ''}` : null,
  ].filter((p): p is string => p !== null);
  const burdenParts = [
    get('support_burden') ? `support: ${said(get('support_burden')) ?? ''}` : null,
    get('owner_attention') ? `your attention: ${said(get('owner_attention')) ?? ''}` : null,
  ].filter((p): p is string => p !== null);
  return {
    earns: parts.length ? parts.join(', ') : null,
    burden: burdenParts.length ? burdenParts.join('; ') : null,
  };
}

/**
 * SEARCHES HE HAS ALREADY CALLED OFF, AND WHY.
 *
 * Starting again should not begin from nothing. A closed mandate carries what
 * he asked for and the reason it ended, so the next one can say "you looked for
 * this before and stopped because —" rather than making him remember.
 */
export interface PastSearch { statement: string; closedAt: string; why: string }

export async function pastSearches(founderId: string, limit = 3): Promise<PastSearch[]> {
  return ((await query(
    `SELECT statement, closed_at, closed_reason FROM venture_mandates
      WHERE founder_id = ? AND closed_at IS NOT NULL
      ORDER BY closed_at DESC, rowid DESC LIMIT ?`, [founderId, limit]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    statement: String(r.statement), closedAt: String(r.closed_at).slice(0, 10),
    why: String(r.closed_reason ?? ''),
  }));
}
