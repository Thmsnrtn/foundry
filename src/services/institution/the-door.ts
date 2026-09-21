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
import { readVentureParagraph, sentenceAsks } from '../venture/mandate.js';
import { readUndertaking } from './undertaking.js';

/** Where a sentence belongs. Each names a capability that already exists. */
export type Destination =
  | 'venture'          // find, steer or stop a search for another asset
  | 'company'          // steer, bound or fund one company
  | 'posture'          // what a company is FOR now: grow, hold, harvest, retire
  | 'undertaking'      // a verb: investigate, grow, fix, test, spend less, handle, take on
  | 'question'         // he is asking, not instructing
  | 'authority'        // an act only a test or the charter may carry: say the boundary
  | 'housekeeping'     // clear what he has dealt with: reversible, confirmed, his
  | 'clarify'          // it both asks and instructs: say which, in one question
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

/**
 * A POLITE FRAME AROUND AN INSTRUCTION IS AN INSTRUCTION.
 *
 * "Could you stop this search?" and "Please stop contacting people?" were
 * filed as idle curiosity, because a trailing question mark sent a sentence to
 * the answer desk before one action reader was consulted, and the only
 * exemption was a list of negative OPENINGS. Every polite framing in English
 * sits outside that list, and the owner should not have to learn imperative
 * syntax to stop his own institution doing something.
 *
 * This is not a patch for two phrases. It is the distinction the two phrases
 * exposed: English asks for things with the grammar of a question, and which
 * kind of asking a sentence is doing is knowable from how it opens. "Could
 * you", "please", "would you" are how a person gives an instruction without
 * barking it. "What", "how", "why" open an enquiry.
 */
const POLITE_FRAME = /^\s*(?:and\s+|but\s+|actually,?\s+|ok(?:ay)?,?\s+|so\s+)*(?:please\b|could you\b|can you\b|would you\b|will you\b|can we\b|could we\b|let's\b|lets\b|i'?d like you to\b|i want you to\b|do you mind\b|would you mind\b)/i;

function isAsking(said: string): boolean {
  if (TOLD_NOT_TO.test(said)) return false;
  return ASKING_MARK.test(said) || ASKING.test(said);
}

/**
 * WHAT THIS SENTENCE WOULD DO, if it is an instruction at all.
 *
 * The readers that already recognise these acts, asked as a group and without
 * acting on anything. Interpretation only: what may follow from it is the
 * authority system's, every time.
 */
function actInIt(said: string, world: { searching: boolean }): { understoodAs: string; door: Destination } | null {
  const hold = readHoldAsk(said);
  if (hold !== null) return { understoodAs: hold, door: 'authority' };
  const housekeeping = readHousekeepingAsk(said);
  if (housekeeping !== null) return { understoodAs: housekeeping, door: 'housekeeping' };
  const venture = readVentureParagraph(said).filter((r) => r.kind !== 'not_venture');
  if (venture.length > 0 && venture.every((r) => r.kind === 'stop_mandate')) {
    return { understoodAs: 'you want me to stop looking', door: 'venture' };
  }
  if (venture.some((r) => r.kind === 'mandate')) {
    return { understoodAs: 'you want me to look for another way to make money', door: 'venture' };
  }
  if (venture.length > 0 && world.searching) {
    return { understoodAs: 'you are steering what I am already looking for', door: 'venture' };
  }
  return null;
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
/**
 * THE SAME SENTENCE, READ AS THE INSTRUCTION IT ALSO IS.
 *
 * Only for the second half of a clarification he answered: he was asked which
 * he meant and said he was telling me. The reading is the door's own, so there
 * is no second interpreter and no chance of the two disagreeing about what he
 * asked for. Nothing here authorises anything; it places the sentence.
 */
export function actAsTold(said: string, world: { searching: boolean } = { searching: false }): Doorway | null {
  const act = actInIt(said.trim(), world);
  if (act === null) return null;
  return { destination: act.door, understoodAs: act.understoodAs, handOffTo: null, said: said.trim(), needs: null };
}

export function whichDoor(
  raw: string, world: { searching: boolean } = { searching: false },
): Doorway {
  const said = raw.trim();
  if (!said) {
    return { destination: 'unplaceable', understoodAs: 'nothing at all',
      handOffTo: null, said, needs: 'something to go on' };
  }

  // ─── WHAT IT ASKS FOR, BEFORE WHAT IT LOOKS LIKE ─────────────────────────
  //
  // Grammatical form used to decide this outright, and an independent reviewer
  // showed what that cost: two boundaries filed as enquiries by their
  // punctuation, before any reader that would have recognised them ran. Both
  // WERE recognised — by readers the door never asked. So the readers are
  // asked first, and the question mark decides only what is left.
  if (isAsking(said)) {
    const act = actInIt(said, world);
    if (act !== null) {
      // HE ASKED FOR IT POLITELY: an instruction, and treated as one.
      if (POLITE_FRAME.test(said) || TOLD_NOT_TO.test(said)) {
        return { destination: act.door, understoodAs: act.understoodAs, handOffTo: null, said, needs: null };
      }
      // HE ASKED ABOUT IT: "should I stop the search?", "what happens if you
      // stop contacting people?". Both readings are live and the act is
      // consequential, so the institution asks which he meant rather than
      // guessing confidently in either direction. One question, not a habit.
      return {
        destination: 'clarify',
        understoodAs: 'you asked about something I can also do',
        handOffTo: null, said,
        needs: `whether you are asking me, or telling me: ${act.understoodAs}`,
      };
    }
    return { destination: 'question',
      understoodAs: 'you asked me something rather than told me to do something',
      handOffTo: '/foundry/ask/answer', said, needs: null };
  }

  // THE WHOLE PARAGRAPH, EVERY CLAUSE OF IT. readVentureParagraph returns one
  // reading per sentence, and a paragraph counts as venture when any sentence
  // of it is - the constraints travel with the mandate rather than away from it.
  // A HOLD ON SENDING IS AN ACT WITH A PRIMITIVE. "Hold off sending anything to
  // anyone for now", "pause outreach", "don't email anybody": the Workshop's
  // pause on new economic activity. Read before the venture reader, which
  // heard "keep looking" in it as steering; before posture, because "stop
  // sending" is not "stop everything"; and before the company parser, which
  // heard every "do not …" as a boundary on a company he does not own.
  if (readHoldAsk(said) !== null) {
    return { destination: 'authority', understoodAs: 'you want me to hold off writing to anyone',
      handOffTo: null, said, needs: null };
  }

  // "CLEAR THE MESSAGES I'VE ALREADY DEALT WITH." Housekeeping was "done where
  // the things are" — which meant the one sentence a returning owner says
  // first was answered with a list of pages. It is one reversible act on the
  // Inbox, confirmed with the count before anything moves.
  const housekeeping = readHousekeepingAsk(said);
  if (housekeeping !== null) {
    return { destination: 'housekeeping', understoodAs: housekeeping,
      handOffTo: '/foundry/inbox/clear-handled', said, needs: null };
  }

  const readings = readVentureParagraph(said);
  const venture = readings.filter((r) => r.kind !== 'not_venture');
  const opening = venture.some((r) => r.kind === 'mandate');
  const stopping = venture.length > 0 && venture.every((r) => r.kind === 'stop_mandate');
  // STEERING NEEDS SOMETHING TO STEER. "Keep legal risk low" is guidance for a
  // search, and with no search open it is not a venture instruction at all — it
  // is far more likely to be about a company. Routing it into an empty search
  // would absorb nothing and redirect him to a screen that had not changed,
  // which is the silent version of the failure he already hit once today.
  // A STEERING SENTENCE THAT ITSELF ASKS TO LOOK — "find something with less
  // legal exposure" — is a direction to open when nothing is open, not a
  // sentence about a company: absorbParagraph already opens it that way, and
  // the door must not drop on the floor what the absorber would have heard.
  const asksToo = venture.some((r) => r.kind === 'guidance' && sentenceAsks(r.statement));
  // AND A REJECTION OF THE DIRECTION — "I don't like this direction" — is
  // about the search whether or not one is open: with none, the answer is
  // that nothing is being looked for and how to give one, never a shrug.
  const dislikes = venture.some((r) => r.kind === 'guidance' && r.guidance === 'another');
  if (opening || stopping || (venture.length > 0 && (world.searching || asksToo || dislikes))) {
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

  // A VERB IS WORK TO TAKE ON, and it needs a company to take it on for. Read
  // before the company parser, whose catch-all would file "spend less here" as
  // what the company is for.
  const asked = readUndertaking(said);
  if (asked) {
    return { destination: 'undertaking',
      understoodAs: `you want me to ${asked.understoodAs}`,
      handOffTo: null, said, needs: 'which company you mean' };
  }

  // AN ACT THAT ONLY A TEST OR THE CHARTER MAY CARRY.
  //
  // "Email every millwork shop today" is not a question and not steering: it
  // is an instruction to write to strangers, spend, or commit — the three
  // things this institution does only inside a test he allowed or the charter
  // let in, never on a sentence. Read as a question it was answered with what
  // happened today; read as nothing it came back "I did not follow that". Both
  // hide the one fact he needs: where the boundary is and what moves it.
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

  // ONLY WHAT NOTHING ELSE COULD PLACE. "Spend no more than $200" is an
  // allowance and "spend less here" is an undertaking; both were heard above
  // and stay heard. What reaches here is an imperative to act outward that no
  // reader owns — and the honest answer to it is the boundary, not a shrug.
  const authority = readAuthorityAsk(said);
  if (authority !== null) {
    return { destination: 'authority', understoodAs: authority, handOffTo: null, said, needs: null };
  }

  return { destination: 'unplaceable',
    understoodAs: 'I could not tell what you wanted me to do with that',
    handOffTo: null, said, needs: null };
}

/**
 * The imperatives that ask for an outward act. Recognised only at the head of
 * the sentence — the instruction, not a mention — so "find me a business that
 * emails invoices" is a search (read earlier) and "email the shops" is this.
 */
const OUTWARD = /^\s*(?:please\s+)?(?:(?:email|e-mail|mail|write to|contact|message|reach out to|call|phone|text|send (?:an? )?(?:email|message|offer)s? to)\b|(?:spend|pay|buy|purchase|charge|sign up for|subscribe to)\b)/i;

/**
 * "Clear the messages I've already dealt with", "archive what's handled",
 * "tidy the inbox". Only the Inbox's handled conversations; nothing else is
 * housekeeping from a sentence, and nothing here touches the record.
 */
export function readHousekeepingAsk(said: string): string | null {
  const t = said.trim().toLowerCase().replace(/[’]/g, "'");
  const verb = /\b(?:clear|archive|put away|tidy(?: up)?|clean up|sweep|file away|clear out|clear away)\b/;
  const object = /\b(?:messages?|conversations?|threads?|inbox|mail|correspondence)\b/;
  const handled = /\b(?:i'?ve|i have|you'?ve|you have|already|that (?:are|is|were)) (?:already )?(?:dealt with|handled|answered|done with|finished with|read|sorted|resolved)\b|\bhandled\b|\bdealt with\b/;
  if (!verb.test(t)) return null;
  if (!(object.test(t) || handled.test(t))) return null;
  if (!handled.test(t) && !/\binbox\b/.test(t)) return null;
  return 'you want me to put away the conversations you have already dealt with';
}

/** "Hold off sending", "pause outreach", "don't send anything to anyone". */
export function readHoldAsk(said: string): string | null {
  const t = said.trim().toLowerCase();
  // EVERY INFLECTION OF THE VERB, not the imperative alone. This read "hold
  // off" and "hold" but not "holding off", so "do you mind holding off on
  // sending anything?" was not recognised as a hold at all — and the sentence
  // then fell through to the answer desk, which is how a boundary becomes a
  // chat. A reader that only knows one form of each word is a reader that
  // works when he phrases it the way the author happened to.
  const holds = /\b(?:hold(?:ing)? off|hold(?:ing)?|paus(?:e|ing)|freez(?:e|ing)|suspend(?:ing)?|stop(?:ping)?|no more|don'?t|do not|never)\b[^.]{0,30}\b(?:send(?:ing)?|mail(?:ing)?|email(?:ing|s)?|outreach|messag(?:e|es|ing)|writ(?:e|ing) to|contact(?:ing)?|reach(?:ing)? out)\b/.test(t)
    || /\b(?:send|email|mail|write to|contact|message)\s+(?:nobody|no one|no-one|nothing to anyone)\b/.test(t);
  if (!holds) return null;
  // "Stop looking" and "stop everything" are not this; nor is a sentence that
  // asks to send more.
  if (/\bstop(?:ping)? (?:looking|searching|everything)\b/.test(t)) return null;
  return 'you want me to hold off writing to anyone';
}

export function readAuthorityAsk(said: string): string | null {
  const t = said.trim();
  if (!OUTWARD.test(t)) return null;
  if (/^\s*(?:please\s+)?(?:spend|pay|buy|purchase|charge|sign up for|subscribe to)\b/i.test(t)) {
    return 'you want me to spend or commit money';
  }
  return 'you want me to write to people';
}
