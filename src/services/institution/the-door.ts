// =============================================================================
// FOUNDRY - one door.
//
// A PRODUCT FAILURE THIS FIXES, AND IT WAS MINE TWICE OVER. The owner opened
// the deployed product to give the institution its first real mandate, and got
// a 404: the form I had shipped an hour earlier posted to a route that does not
// exist. But the 404 was the smaller half. The larger half is that a form
// posting to /foundry/venture is the wrong shape entirely — it requires the
// owner to know that a thing called a venture mandate exists, and to have
// navigated to the one screen that collects one.
//
// He should be able to say what he wants. Choosing which of the institution's
// systems receives the sentence is Foundry's job, not his.
//
// So this is the doorway. It reads one sentence, decides which durable
// capability it belongs to, and hands it there. It invents nothing: every
// destination below is a handler that already existed and was already reachable
// by somebody who knew the route. What is new is that nobody has to know.
//
// WHAT IT WILL NOT DO. It will not guess. A sentence it cannot place comes back
// as "I did not follow that", with what he typed preserved and offered back —
// losing three hundred words of mandate because a classifier shrugged is a
// worse failure than the 404 was.
// =============================================================================

import { interpret } from './standing-intent.js';
import { readPosture } from '../founder/burden.js';
import { readVentureParagraph } from '../venture/mandate.js';

/** Where a sentence belongs. Each names a capability that already exists. */
export type Destination =
  | 'venture'          // find, steer or stop a search for another asset
  | 'company'          // steer, bound or fund one company
  | 'posture'          // what a company is FOR now: grow, hold, harvest, retire
  | 'question'         // he is asking, not instructing
  | 'unplaceable';     // say so, and keep what he wrote

export interface Doorway {
  destination: Destination;
  /** What Foundry took him to be doing, in his own register. */
  understoodAs: string;
  /** Where the sentence goes next, as a route the owner never has to see. */
  handOffTo: string | null;
  /** Preserved verbatim, always — including when nothing could be placed. */
  said: string;
  /** Set when the destination needs something he has not given. */
  needs: string | null;
}

/**
 * A QUESTION IS NOT AN INSTRUCTION.
 *
 * "How are things?" and "Make things better" are different acts, and hearing
 * the first as the second would have the institution start work because he
 * asked after it. Questions are recognised first and separately.
 */
const ASKING = /^\s*(how|what|why|when|where|which|who|show me|tell me)\b/i;
const ASKING_MARK = /\?\s*$/;
// "DO NOT CONTACT CUSTOMERS" IS NOT A QUESTION. A negative imperative opens
// with the same auxiliaries a question does, and hearing "don't spend anything"
// as an enquiry would file his firmest instruction as idle curiosity.
const TOLD_NOT_TO = /^\s*(do not|don't|dont|never|no\b)/i;

function isAsking(said: string): boolean {
  if (TOLD_NOT_TO.test(said)) return false;
  return ASKING_MARK.test(said) || ASKING.test(said);
}

/**
 * READ ONE SENTENCE AND DECIDE WHERE IT BELONGS.
 *
 * Order matters and is deliberate. A venture mandate frequently contains a
 * spending limit and a boundary — "spend no more than $25 validating anything,
 * and bring me only things that deserve my attention" — and reading that as a
 * budget instruction would file two thirds of a mandate as company machinery
 * and drop the rest. The whole paragraph is offered to the venture reader
 * first, because it is the only reader that keeps every clause.
 */
export function whichDoor(
  raw: string, world: { searching: boolean } = { searching: false },
): Doorway {
  const said = raw.trim();
  if (!said) {
    return { destination: 'unplaceable', understoodAs: 'nothing at all',
      handOffTo: null, said, needs: 'something to go on' };
  }

  if (isAsking(said)) {
    return { destination: 'question',
      understoodAs: 'you asked me something rather than told me to do something',
      handOffTo: '/foundry/ask/answer', said, needs: null };
  }

  // THE WHOLE PARAGRAPH, EVERY CLAUSE OF IT. readVentureParagraph returns one
  // reading per sentence, and a paragraph counts as venture when any sentence
  // of it is - the constraints travel with the mandate rather than away from it.
  const readings = readVentureParagraph(said);
  const venture = readings.filter((r) => r.kind !== 'not_venture');
  const opening = venture.some((r) => r.kind === 'mandate');
  const stopping = venture.length > 0 && venture.every((r) => r.kind === 'stop_mandate');
  // STEERING NEEDS SOMETHING TO STEER. "Keep legal risk low" is guidance for a
  // search, and with no search open it is not a venture instruction at all — it
  // is far more likely to be about a company. Routing it into an empty search
  // would absorb nothing and redirect him to a screen that had not changed,
  // which is the silent version of the failure he already hit once today.
  if (opening || stopping || (venture.length > 0 && world.searching)) {
    return {
      destination: 'venture',
      understoodAs: stopping ? 'you want me to stop looking'
        : opening ? 'you want me to look for another way to make money'
          : 'you are steering what I am already looking for',
      handOffTo: '/foundry/venture', said, needs: null,
    };
  }

  // POSTURE BEFORE STEERING, for the same reason the company handler does it:
  // "leave that alone" contains a stopping phrase, and hearing it as "stop what
  // is live" would do the opposite of what he asked.
  if (readPosture(said) !== null) {
    return { destination: 'posture',
      understoodAs: 'you are telling me what one of your companies is for now',
      handOffTo: null, said, needs: 'which company you mean' };
  }

  const proposal = interpret(said);
  // ITS FALLBACK IS NOT A RECOGNITION. The company parser answers `objective`
  // for anything it does not recognise, which inside one company's page is
  // sensible — every sentence there is about that company. As a general
  // classifier it would swallow the weather, so an objective that names no
  // concern and no channel counts as nothing having been understood.
  const emptyFallback = proposal.kind === 'objective'
    && proposal.concerns.length === 0 && proposal.channels.length === 0;
  if (proposal.kind !== 'unclear' && !emptyFallback) {
    const asWhat: Record<string, string> = {
      boundary: 'you are telling me something I must not do',
      objective: 'you are telling me what matters',
      allowance: 'you are setting what I may spend',
      preference: 'you are telling me which way to lean',
      stop: 'you want me to stop something',
    };
    return { destination: 'company',
      understoodAs: asWhat[proposal.kind] ?? 'you are steering a company',
      handOffTo: null, said, needs: 'which company you mean' };
  }

  return { destination: 'unplaceable',
    understoodAs: 'I could not tell what you wanted me to do with that',
    handOffTo: null, said, needs: null };
}
