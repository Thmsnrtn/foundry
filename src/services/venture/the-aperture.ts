// =============================================================================
// FOUNDRY - what this institution could not have noticed
//
// THE FACTORY MUST NOT DEFINE THE OPPORTUNITY SPACE, and today it does. Every
// search begins from five phrases about repeated manual effort; every sentence
// that survives triage matched one of ten markers about the same; the hands can
// make exactly one of five forms; and any offer must be a single payment inside
// a narrow band. Each of those is a defensible engineering decision. Together
// they are an aperture, and an institution that reports only what came through
// it is reporting the shape of its own lens as though it were the shape of the
// world.
//
// AN OBSERVED ZERO IS NOT AN UNMEASURED QUANTITY, and that distinction is the
// whole of this module. "Foundry found no opportunity worth two hundred dollars
// a year" and "Foundry has never once looked for one" are different sentences,
// and only the second one is true. Nothing here is a judgement about whether
// those opportunities are good. It is a statement about which of them were
// eligible to be judged at all.
//
// IT IS DERIVED, NOT WRITTEN DOWN. Every line below is read from the live
// facts - the search seeds, the marker vocabulary, the kind registry with its
// own `needs` strings, the enforced price band. A hand-kept list of blind spots
// would be accurate on the day it was written and quietly wrong afterwards,
// which is the failure this whole institution is built against: two readings
// of one fact disagree unless one is derived from the other.
//
// AND IT IS NOT A SHOPPING LIST. Nothing here authorises building anything. A
// capability is bought by a specific evidenced opportunity, never by an empty
// slot in a registry - so each entry names what it would take and stops there.
// =============================================================================

import { BASE_TERMS, MARKERS } from './discovery.js';
import { KINDS, kindsFoundryCanMake } from './products/registry.js';
import type { KindFacts } from './products/registry.js';
import { OFFER_BAND } from './products/offer-composition.js';

/** Why something could not have been noticed, which is never "it was rejected". */
export type Blindness =
  /** The eyes were never pointed at it. No search Foundry runs would return it. */
  | 'never_searched_for'
  /** It could be found and could not be made, so the forge would not design it. */
  | 'no_form_to_make_it'
  /** It could be found and made, and could not be charged for in the only shape money takes. */
  | 'outside_the_band';

export interface Unseen {
  kind: Blindness;
  /** The shape of opportunity, in the owner's words rather than the registry's. */
  what: string;
  /** The live fact that closes it off, quoted from where that fact is enforced. */
  because: string;
  /** What it would take, from the registry's own account. Never a plan. */
  wouldNeed: string;
}

export interface Aperture {
  /** The phrases every search starts from. */
  looksFor: readonly string[];
  /** The only kinds of sentence triage will pay to have read. */
  hearsOnly: string[];
  canMake: KindFacts[];
  cannotMake: KindFacts[];
  band: typeof OFFER_BAND;
  unseen: Unseen[];
  /** The one sentence, which has to carry the distinction or it is decoration. */
  sentence: string;
}

/**
 * WHAT CAME THROUGH, AND WHAT COULD NOT HAVE.
 *
 * Synchronous and reads nothing: the aperture is a property of the code, not of
 * the database. A version of this that counted rows would answer "what has
 * Foundry found", which is the question that is already answered everywhere
 * else and not the one that is missing.
 */
export function theAperture(): Aperture {
  const canMake = kindsFoundryCanMake();
  const cannotMake = KINDS.filter((k) => !k.canMake);
  const made = canMake.map((k) => k.whatItIs).join('; ') || 'nothing';

  const unseen: Unseen[] = [];

  // THE EYES. Five phrases about effort, and ten markers about effort. A want
  // nobody has yet turned into a complaint about their own labour does not
  // match any of them, and a sentence that matches none of them is never paid
  // to be read - so it is not that it lost, it is that it was never heard.
  unseen.push({
    kind: 'never_searched_for',
    what: 'a want nobody describes as repeated manual work - an audience already '
      + 'gathered somewhere, a thing people buy badly today, a price that is wrong '
      + 'in somebody\'s favour',
    because: `every search begins from ${String(BASE_TERMS.length)} phrases about effort `
      + `(${BASE_TERMS.map((t) => `"${t}"`).join(', ')}) and nothing that fails all `
      + `${String(MARKERS.length)} triage markers is ever read`,
    wouldNeed: 'a second family of search terms about demand rather than labour, and '
      + 'the markers to triage it, which is a change to the eyes and not to the hands',
  });

  // THE HANDS. Each unmakeable kind carries its own account of what is missing,
  // written by whoever decided not to build it. Quoting it here means the day
  // somebody builds one, this stops claiming it is missing.
  for (const k of cannotMake) {
    unseen.push({
      kind: 'no_form_to_make_it',
      what: `an opportunity whose honest answer is ${k.whatItIs}`,
      because: `the hands make ${made}`,
      wouldNeed: k.needs ?? 'something the registry does not name',
    });
  }

  // THE TILL. One payment, once, inside a band narrow enough that a real
  // business could sit just outside it in either direction.
  unseen.push({
    kind: 'outside_the_band',
    what: `anything worth more than $${String(OFFER_BAND.highDollars)} to a buyer once`,
    because: `an offer is refused unless its price is a whole number of dollars `
      + `between ${String(OFFER_BAND.lowDollars)} and ${String(OFFER_BAND.highDollars)}`,
    wouldNeed: 'a reason to widen the band, and the delivery and remedy that a larger '
      + 'promise would oblige - the band is narrow because what is owed on it is small',
  });
  unseen.push({
    kind: 'outside_the_band',
    what: 'anything somebody would pay for repeatedly',
    because: 'the only exchange the hands compose is a single upfront price, and '
      + 'recurring billing is refused as a structural fact of the offer',
    wouldNeed: 'an account a buyer can end by themselves, and the obligation to keep '
      + 'delivering for as long as they are charged',
  });

  return {
    looksFor: BASE_TERMS,
    hearsOnly: MARKERS.map((m) => m.kind),
    canMake, cannotMake, band: OFFER_BAND, unseen,
    sentence: `Foundry can currently find one shape of problem and make one shape of `
      + `answer for it, sold once for between $${String(OFFER_BAND.lowDollars)} and `
      + `$${String(OFFER_BAND.highDollars)}. ${String(unseen.length)} kinds of `
      + `opportunity could not have reached you through that - not because they were `
      + `judged and found wanting, but because nothing here would have seen them. `
      + `That is a limit of the machine, not a finding about the world.`,
  };
}
