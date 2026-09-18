// =============================================================================
// FOUNDRY — WHAT THE THINKING WAS FOR
//
// The spend ledger already records who pays for every model call: the product,
// the founder, the model, the cents. Read against production it said that
// $14.88 had been spent over 1,099 calls, and that $10.45 of it — seventy per
// cent — was Sonnet, on 878 calls that named no purpose at all.
//
// That is not a small gap in bookkeeping. "What is Foundry thinking about, and
// is it worth it" is the question the whole cognition-economics discipline
// exists to answer, and the ledger could answer it for fourteen per cent of the
// calls. The rest was a number with a model name on it.
//
// `purpose_kind`/`purpose_id` are not that answer and were never meant to be:
// they link a call to an OBJECT, so what an opportunity cost to reason about
// can later sit beside what it cost to test. Most calls have no such object.
// Forcing a made-up one onto them would be attribution theatre — it would add
// nothing over `product_id`, which is already recorded, while looking like it
// had solved something.
//
// WHY THIS IS A CLOSED VOCABULARY AND NOT A FREE STRING. A free string drifts:
// six spellings of the same work, and the grouping that was the whole point
// stops grouping. A closed set means adding a model call does not compile until
// somebody says what it is for, and every name here carries the sentence a
// person reads in the ledger rather than a slug they have to decode.
//
// WHY IT IS NOT DERIVED FROM THE CALL STACK. It could be — a stack frame is
// cheap next to a model call. But the module a call happens to sit in is not
// what it is FOR, it renames itself every time a file moves, and it would make
// the ledger's vocabulary an accident of the directory tree. The declaration
// belongs next to the call, which is where this codebase puts every other
// declaration of intent.
//
// A NAME HERE IS NOT A BUDGET AND NOT A PERMISSION. It buys nothing and
// authorises nothing; the ceilings are enforced on product, founder and global
// spend exactly as before. This says only what the money was for.
// =============================================================================

/**
 * Every kind of work that may reach a model, and what it is in plain words.
 *
 * Retiring a piece of work means deleting its entry here, and the compiler then
 * names every call site that still claims it — which is how the agent society's
 * entries will leave when their modules do.
 */
export const WORK_THE_MODEL_DOES = {
  // ── the institution reasoning about the world ────────────────────────────
  'reading an observation': 'turning one thing somebody said in public into a claim about a market',
  'a second reading': 'trying again when the first reading of an observation came back unusable',
  'legal exposure': 'recognising whether an idea would put its owner on the wrong side of a rule',
  'cross-company patterns': 'looking for a pattern across companies that no single one could see',
  'a lens': 'one discipline reading the record of a candidate test for what it shows and on which rows',
  'composing a probe': 'turning five disciplines\' findings into one design that says what a test decides',
  'attacking a probe': 'arguing a draft design is wrong before it is sealed, given only the draft',
  'shaping an offer': 'saying what a designed test sells, claims, collects, delivers, sells to and charges, for a thing the hands can make',

  // ── what the owner opens ─────────────────────────────────────────────────
  'the daily insight': 'the one thing worth saying about a company today',
  'the weekly plan': 'what the coming week should be spent on',
  'the morning briefing': 'the thirty-second read across everything at once',
  'the spoken briefing': 'the same, said out loud, for a commute',
  'the compressed brief': 'the long form squeezed into what fits on a phone',

  // ── judging work already done ────────────────────────────────────────────
  'scoring an audit': 'grading how well something was carried out',
  'planning a remedy': 'working out what to do about a finding',
  'a gate': 'deciding whether a piece of work is good enough to go on',
  'red team': 'arguing against a plan before it is committed to',
  'a decision': 'framing a choice, and what each way would cost',

  // ── reading signals ──────────────────────────────────────────────────────
  'a signal': 'deciding what one event actually means',
  'competitive read': 'what a competitor did and whether it matters here',
  'regulatory read': 'whether a rule change reaches this company',
  'recovering a company': 'what to do when something has gone badly wrong',
  'a scenario': 'playing out what would happen if',
  'a simulation': 'running a company forward to see where it ends up',
  'the graph': 'what the relationships between things imply',
  'global intelligence': 'what is happening beyond this company that bears on it',

  // ── the institution's own voice ──────────────────────────────────────────
  'reading the post': 'deciding what a message sent to the Workshop is asking for',
  'voice': 'matching how this owner writes, so nothing goes out sounding like a machine',
  'synthesis': 'putting many small findings into one account',
  'wisdom': 'what has been learned that should not have to be learned again',
  'strategy': 'what this company is actually trying to do',
  'temporal': 'what has changed over time rather than what is true now',

  // ── the agent society, which is no longer on a timer ─────────────────────
  //
  // Kept because the modules are kept: they are reached at boot and by two live
  // routes, and nothing schedules them. A call here would be somebody running
  // one deliberately. When those modules go, so do these.
  'an agent session': 'one of the retired agents doing its assessment',
  'agent coordination': 'the retired agents leaving each other notes',
  'agent evolution': 'a retired agent proposing a change to its own instructions',
} as const;

export type Work = keyof typeof WORK_THE_MODEL_DOES;

/** What a name in the ledger means, for a reader who did not write the code. */
export function whatThatWorkIs(work: string): string | null {
  return (WORK_THE_MODEL_DOES as Record<string, string>)[work] ?? null;
}

/**
 * WHO IS THIS CALL FOR?
 *
 * A model call is either work for one company or work for the institution
 * itself. There is no third case, and there is no "we did not say".
 *
 * `productId` used to be the fourth, optional argument, so omitting it meant
 * BOTH "this is institutional" and "somebody forgot" — fifty-five of a hundred
 * and four call sites had forgotten, and the resulting spend was bounded only
 * by the global ceiling. Omission cannot be allowed to carry meaning when the
 * two meanings differ by an unbounded amount of money.
 *
 * The subject is now required at the type boundary, and institutional calls say
 * so out loud with a reason a reader can check.
 */
/**
 * WHAT THE THINKING IS FOR. The same (kind, id) shape prediction_resolutions
 * uses, so what a question cost to reason about can later sit beside what it
 * cost to test and how the test came out. Optional: a call without one is
 * still attributed; it simply cannot be compared.
 */
export type SpendPurposeKind =
  'observation' | 'candidate' | 'experiment' | 'unknown' | 'undertaking' | 'responsibility' | 'workspace' | 'mandate';
export interface SpendPurpose { readonly kind: SpendPurposeKind; readonly id: string }

export interface InstitutionSpend {
  readonly institutionReason: string;
  readonly work: Work;
  readonly purpose?: SpendPurpose;
}

/** A company's call that also names what it was for. */
export interface CompanySpend {
  readonly productId: string;
  readonly work: Work;
  readonly purpose?: SpendPurpose;
}

/** Declare a model call as the institution's own, with the reason it has no
 * company to charge. The reason is not decoration: it is what a reviewer reads
 * to decide whether this really is institutional or just unattributed. */
export function institutionSpend(
  reason: string, work: Work, purpose?: SpendPurpose,
): InstitutionSpend {
  return purpose ? { institutionReason: reason, work, purpose } : { institutionReason: reason, work };
}

/** A company's call, saying what work it is and — where there is an object to
 *  point at — which one. */
export function companySpend(
  productId: string, work: Work, purpose?: SpendPurpose,
): CompanySpend {
  return purpose ? { productId, work, purpose } : { productId, work };
}

/**
 * WHO PAYS, AND WHAT FOR. Never undefined, and no longer a bare product id.
 *
 * A bare string said who pays and nothing else, which is how seventy per cent
 * of this institution's model spend came to be a number with a model name on
 * it. Both shapes now carry `work` from a closed vocabulary, so a new call does
 * not compile until somebody says what it is for.
 */
export type SpendSubject = InstitutionSpend | CompanySpend;

/** The purpose a subject names, if it names one. */
export function subjectPurpose(subject: SpendSubject | undefined): SpendPurpose | null {
  return subject?.purpose ?? null;
}

/** What the call is for. Required by the type, so this cannot be absent. */
export function subjectWork(subject: SpendSubject | undefined): Work | null {
  return subject?.work ?? null;
}
