// =============================================================================
// FOUNDRY - reading a real sentence, without inventing what it says
//
// Discovery can find real sentences that real people wrote. Until now it could
// only quote them, and the two attempts at understanding them without
// comprehension both failed in ways worth keeping: naming a seed after the
// search term produced four ways of writing down what Foundry typed, and
// extracting content words near the marker produced word salad - "manual
// workaround: manually good idea execution". Picking nearby nouns is not
// reading.
//
// So a model reads the sentence. That is a real widening of what Foundry may
// do, and the boundary it needs is structural, because the failure is quiet: a
// model paraphrases a source, the paraphrase is stored, and three steps later
// the institution believes the source said the paraphrase.
//
// THREE OBJECTS. The OBSERVATION is what reality supplied. The INTERPRETATION
// is Foundry's reading of what it may indicate. The HYPOTHESIS is Foundry's
// entrepreneurial inference. Only the first is evidence, and the model is told
// so in as many words.
//
// AND ABSTENTION IS THE GOOD OUTCOME. "I cannot infer a coherent economic
// problem from this" is what most real sentences deserve. A reader that finds
// a venture in everything has told you nothing about any of them.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { callSonnet, institutionSpend } from '../ai/client.js';
import { shieldUntrustedContent } from '../ai/prompt-shield.js';
import { dataBlockInstruction, wrapDataBlock } from '../ai/sanitize.js';

export interface Interpretation {
  id: string;
  /** Foundry's reading of what the observation may indicate. Inference. */
  reading: string;
  /** A verbatim span of what the source said. The database checks this. */
  motivatedBy: string;
  ambiguity: string | null;
  orItCouldBe: string | null;
  misreadIf: string;
  /** The entrepreneurial inference, which is a different kind of thing. */
  hypothesis: string | null;
  hypothesisKind: string | null;
  /** A guess at whose problem it is. A segment, not a customer. */
  whoItMayBe: string | null;
  nextQuestion: string | null;
}

export interface Abstained {
  /** Recorded rather than silent: a declined reading is a result. */
  id: string;
  abstained: string;
}

export type Read = Interpretation | Abstained | { refused: string };

export function abstained(r: Read): r is Abstained {
  return 'abstained' in r;
}
export function understood(r: Read): r is Interpretation {
  return 'reading' in r;
}

const SYSTEM = [
  'You are reading one thing a real person wrote, on behalf of an institution that',
  'owns a small portfolio of digital cash-flow assets and is looking for its next',
  'one. Your job is comprehension, and nothing else.',
  '',
  'THREE THINGS, AND YOU MUST NOT MERGE THEM.',
  '  OBSERVATION: what the person actually wrote. You do not produce this. It is',
  '    given to you, it is the only evidence in play, and it is not yours to',
  '    restate as though they said something else.',
  '  INTERPRETATION: what you think it may indicate. This is your reading. Say it',
  '    in your own words, and say "may" where you mean may.',
  '  HYPOTHESIS: what economic opportunity it might imply. This is a guess built',
  '    on your reading, and it is further from the evidence than the reading is.',
  '',
  'YOU MAY CREATE interpretations, questions, hypotheses, possible customer',
  'segments and possible economic forms. YOU MAY NOT CREATE customer pain, market',
  'demand, willingness to pay, usage figures, substitute quality or pricing',
  'acceptance. Those are facts about the world. Reality supplies them; you do not.',
  'Never write a number, a company name, a market size or a user count that is not',
  'in the text in front of you.',
  '',
  'ABSTAINING IS A GOOD ANSWER AND OFTEN THE RIGHT ONE. If you cannot infer a',
  'coherent economic problem from this sentence, say so and stop. Most sentences',
  'people write are not opportunities. Do not force this one into a venture-shaped',
  'story to be helpful; a reader that finds a business in everything is useless.',
  '',
  'Reply with one JSON object and nothing else:',
  '{',
  '  "abstain": <string or null — if you cannot read a coherent economic problem',
  '              out of this, put the reason here and set every field below null>,',
  '  "reading": <your reading of what it may indicate, one or two sentences>,',
  '  "motivated_by": <THE EXACT WORDS from the observation that drove your reading,',
  '                   copied character for character. Not a summary. Not tidied.',
  '                   At least a dozen characters. It will be checked against the',
  '                   text, and a reading whose quote is not in the text is thrown',
  '                   away>,',
  '  "ambiguity": <what genuinely remains unclear, or null>,',
  '  "or_it_could_be": <a different plausible reading of the same words, or null>,',
  '  "misread_if": <what would show you read this wrong. Required. A reading that',
  '                 cannot be wrong is not a reading>,',
  '  "hypothesis": <the entrepreneurial inference, phrased as might, or null>,',
  '  "hypothesis_kind": <one of the kinds listed below, or null>,',
  '  "who_it_may_be": <a guess at whose problem this is, phrased as a guess, or',
  '                    null. This is a segment you are proposing, not a customer',
  '                    you have met>,',
  '  "next_question": <the one question that would most cheaply establish whether',
  '                    this is nonsense>',
  '}',
  '',
  dataBlockInstruction('observation'),
].join('\n');

/** Un-escape what the data block escaped, so a quote can be checked against the
 * text as stored rather than as shown. */
function unescape(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

interface Parsed {
  abstain: string | null; reading: string | null; motivated_by: string | null;
  ambiguity: string | null; or_it_could_be: string | null; misread_if: string | null;
  hypothesis: string | null; hypothesis_kind: string | null;
  who_it_may_be: string | null; next_question: string | null;
}

function parse(text: string): Parsed | null {
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (from === -1 || to <= from) return null;
  try {
    const raw = JSON.parse(text.slice(from, to + 1)) as Record<string, unknown>;
    const str = (k: string): string | null => {
      const v = raw[k];
      return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
    };
    return {
      abstain: str('abstain'), reading: str('reading'),
      motivated_by: raw.motivated_by == null ? null : String(raw.motivated_by),
      ambiguity: str('ambiguity'), or_it_could_be: str('or_it_could_be'),
      misread_if: str('misread_if'), hypothesis: str('hypothesis'),
      hypothesis_kind: str('hypothesis_kind'), who_it_may_be: str('who_it_may_be'),
      next_question: str('next_question'),
    };
  } catch {
    return null;
  }
}

/** The kinds a hypothesis may assert, read from the constitution rather than
 * duplicated here — a model naming a kind the institution does not recognise
 * has not named a kind. */
async function kinds(): Promise<Array<{ kind: string; asserts: string }>> {
  return ((await query(
    'SELECT kind, asserts FROM hypothesis_kinds ORDER BY sort_order'))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    kind: String(r.kind), asserts: String(r.asserts),
  }));
}

/**
 * READ ONE OBSERVATION.
 *
 * The text comes from the observation as STORED rather than from whatever the
 * caller has in hand, because the database checks the model's quote against the
 * stored text and the two must be the same string.
 *
 * A shielded observation is not read at all. If the text contains something
 * shaped like an instruction, the honest move is to decline rather than to
 * interpret a defanged version and pretend that was the sentence — and a signal
 * that is trying to talk to the reader is not a signal about work.
 */
export async function interpret(input: {
  founderId: string;
  observationId: string;
  /** What the search was for. Context only, and the prompt says so. */
  lookingFor?: string | null;
  /** What the owner said to hold it to, in his words. Relevance only, never a shape. */
  heldTo?: string | null;
  world: 'real' | 'reference';
}): Promise<Read> {
  const obs = (await query(
    'SELECT saw, source_type, evidence_mode FROM market_observations WHERE id = ?',
    [input.observationId])).rows[0] as Record<string, unknown> | undefined;
  if (!obs) return { refused: 'no such observation' };
  if (input.world !== 'reference' && String(obs.evidence_mode) === 'reference') {
    return { refused: 'that observation is a rehearsal, and reading it would not be' };
  }
  const saw = String(obs.saw);

  const shielded = shieldUntrustedContent(saw);
  if (shielded.triggered) {
    return record({
      founderId: input.founderId, observationId: input.observationId,
      world: input.world, model: 'not consulted',
      abstain: 'the text contains something shaped like an instruction to a reader '
        + `(${shielded.reasons.slice(0, 3).join(', ')}), so I did not read it. Somebody `
        + 'talking to a machine is not somebody describing work.',
    });
  }

  const available = await kinds();
  const user = [
    input.lookingFor == null || input.lookingFor.trim() === ''
      ? 'The institution is looking for anything that earns.'
      : `The institution is looking for: ${input.lookingFor}.`,
    ...(input.heldTo == null || input.heldTo.trim() === '' ? []
      : [`The owner holds the search to this, in his words: ${input.heldTo}.`]),
    'That context is for judging relevance only. It is NOT a shape to fit this',
    'sentence into, and a preference of the owner\'s is not a fact about the',
    'person who wrote this. If the sentence has nothing to do with it, abstain.',
    '',
    'The kinds a hypothesis may assert:',
    ...available.map((k) => `  ${k.kind} — ${k.asserts}`),
    '',
    'Here is the one thing a person wrote:',
    wrapDataBlock('observation', saw, 2000),
  ].join('\n');

  const model = 'sonnet';
  let reply;
  try {
    // The reason is a single written sentence rather than a label, because a
    // reviewer reads it to decide whether this really is institutional or just
    // unattributed spend.
    reply = await callSonnet(SYSTEM, user, 1200, institutionSpend(
      // eslint-disable-next-line max-len
      'reading one real market signal for the owner\'s own portfolio search; there is no company to charge because no venture exists yet'));
  } catch (err) {
    return { refused: `could not read it: ${err instanceof Error ? err.message : 'unknown'}` };
  }

  const first = parse(reply.content);
  if (first === null) {
    return record({
      founderId: input.founderId, observationId: input.observationId,
      world: input.world, model,
      abstain: 'the reading came back in a shape I could not use, and a reading I '
        + 'cannot parse is not a reading',
    });
  }
  if (first.abstain !== null) {
    return record({
      founderId: input.founderId, observationId: input.observationId,
      world: input.world, model, abstain: first.abstain,
    });
  }

  // THE QUOTE HAS TO BE IN THE TEXT. Checked here so the failure can be
  // explained and retried once, and checked again by the database so it can
  // never be stored either way.
  let read = first;
  if (!quoteIsInTheText(read, saw)) {
    const again = await callSonnet(SYSTEM, [user, '',
      'A previous attempt returned this as "motivated_by":',
      `  ${String(read.motivated_by ?? '')}`,
      'Those words are not in the observation. Copy the exact characters from',
      'inside the <observation> block instead — a span of it, unedited.',
    ].join('\n'), 1200, institutionSpend(
      // eslint-disable-next-line max-len
      'a second attempt at getting the reader to quote the sentence it read; the owner\'s portfolio search, which has no company to charge')).catch(() => null);
    const second = again === null ? null : parse(again.content);
    if (second === null || second.abstain !== null || !quoteIsInTheText(second, saw)) {
      return record({
        founderId: input.founderId, observationId: input.observationId,
        world: input.world, model,
        abstain: 'it could not show which words it was reading. A reading that cannot '
          + 'point at the text is a paraphrase wearing a citation.',
      });
    }
    read = second;
  }

  const kind = read.hypothesis_kind !== null
    && available.some((k) => k.kind === read.hypothesis_kind)
    ? read.hypothesis_kind : null;
  // A hypothesis that does not say what it asserts cannot later be tested
  // against a source capable of contradicting it, so it is not kept as one.
  const hypothesis = kind === null ? null : read.hypothesis;

  const id = nanoid();
  await query(
    `INSERT INTO observation_interpretations
       (id, founder_id, observation_id, reading, motivated_by, ambiguity,
        or_it_could_be, misread_if, hypothesis, hypothesis_kind, who_it_may_be,
        next_question, interpreted_by, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.observationId, read.reading, unescape(read.motivated_by ?? ''),
      read.ambiguity, read.or_it_could_be, read.misread_if, hypothesis, kind,
      read.who_it_may_be, read.next_question, model,
      input.world === 'reference' ? 'reference' : 'real']);

  return {
    id, reading: String(read.reading), motivatedBy: unescape(read.motivated_by ?? ''),
    ambiguity: read.ambiguity, orItCouldBe: read.or_it_could_be,
    misreadIf: String(read.misread_if), hypothesis, hypothesisKind: kind,
    whoItMayBe: read.who_it_may_be, nextQuestion: read.next_question,
  };
}

function quoteIsInTheText(read: Parsed, saw: string): boolean {
  if (read.reading === null || read.misread_if === null || read.motivated_by === null) {
    return false;
  }
  const quote = unescape(read.motivated_by).trim();
  return quote.length >= 12 && saw.includes(quote);
}

/** A declined reading is filed, not dropped. What Foundry looked at and could
 * not make sense of is the cheapest thing it owns and the easiest to lose. */
async function record(input: {
  founderId: string; observationId: string; world: 'real' | 'reference';
  model: string; abstain: string;
}): Promise<Abstained> {
  const id = nanoid();
  await query(
    `INSERT INTO observation_interpretations
       (id, founder_id, observation_id, abstained_because, interpreted_by, evidence_mode)
     VALUES (?,?,?,?,?,?)`,
    [id, input.founderId, input.observationId, input.abstain.trim().slice(0, 500),
      input.model, input.world === 'reference' ? 'reference' : 'real']);
  return { id, abstained: input.abstain.trim() };
}

/**
 * WHAT FOUNDRY MADE OF A SENTENCE, walkable from a seed backwards.
 *
 * Six questions, answerable: what did the person say, what does Foundry think
 * it means, what part of the observation motivated that, what remains unclear,
 * what else it could be, and what would show Foundry misread it.
 */
export async function howItWasRead(seedId: string): Promise<{
  said: string; reading: string; motivatedBy: string; ambiguity: string | null;
  orItCouldBe: string | null; misreadIf: string; hypothesis: string | null;
  asserts: string | null; readBy: string;
} | null> {
  const row = (await query(
    `SELECT o.saw, i.reading, i.motivated_by, i.ambiguity, i.or_it_could_be,
            i.misread_if, i.hypothesis, i.interpreted_by, k.asserts
       FROM opportunity_seeds s
       JOIN observation_interpretations i ON i.id = s.interpretation_id
       JOIN market_observations o ON o.id = i.observation_id
       LEFT JOIN hypothesis_kinds k ON k.kind = i.hypothesis_kind
      WHERE s.id = ? AND i.reading IS NOT NULL`, [seedId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    said: String(row.saw), reading: String(row.reading),
    motivatedBy: String(row.motivated_by),
    ambiguity: row.ambiguity == null ? null : String(row.ambiguity),
    orItCouldBe: row.or_it_could_be == null ? null : String(row.or_it_could_be),
    misreadIf: String(row.misread_if),
    hypothesis: row.hypothesis == null ? null : String(row.hypothesis),
    asserts: row.asserts == null ? null : String(row.asserts),
    readBy: String(row.interpreted_by),
  };
}

/**
 * HAVE I ALREADY LOOKED AT THIS AND FOUND NOTHING IN IT?
 *
 * The reason a reading was declined is only worth keeping if something reads
 * it, and paying a model twice to reach the same "there is no business here" is
 * exactly the unnecessary spend this institution is supposed to be minimising.
 *
 * Word overlap rather than embeddings, for the reason the graveyard uses it:
 * the match has to be explicable in one line and cheap enough to run before
 * every reading. It will miss a paraphrase and it will never claim a match it
 * cannot show.
 */
export async function alreadySetAside(founderId: string, text: string): Promise<{
  because: string; shares: string[];
} | null> {
  const words = new Set(text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 5));
  if (words.size < 3) return null;
  const declined = (await query(
    `SELECT i.abstained_because, o.saw
       FROM observation_interpretations i
       JOIN market_observations o ON o.id = i.observation_id
      WHERE i.founder_id = ? AND i.abstained_because IS NOT NULL
      ORDER BY i.interpreted_at DESC LIMIT 100`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;
  for (const row of declined) {
    const theirs = new Set(String(row.saw).toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/).filter((w) => w.length > 5));
    const shared = [...words].filter((w) => theirs.has(w));
    if (shared.length >= 3 && shared.length * 2 >= words.size) {
      return { because: String(row.abstained_because), shares: shared };
    }
  }
  return null;
}
