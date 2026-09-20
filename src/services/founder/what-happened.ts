/**
 * WHAT HAPPENED TO A TEST, IN ONE VOCABULARY.
 *
 * One settled test read as "Stopped by its own rule" on its page, "Stopped"
 * in History, "settled against its prediction" on Activity, "not what I
 * expected" in the week-away letter, "It did not hold" in the Ask answer and
 * "The world said: surprised" on the next-test page — six labels for one
 * outcome, two of them the raw column. A reviewer sent through the pages as a
 * person asked which of the six was true. All of them; none of them said why.
 *
 * This is the one reader. It turns the rows a test leaves behind into one
 * word, what the word means, the recorded reason, and what the result does
 * and does not establish. Every owner surface renders from it with its own
 * layout and none of them derives the word again.
 *
 * The word for a settled test is the grade's word, not the column's. The
 * column admits two ('as_predicted', 'surprised'); the grade the world wrote
 * beside it admits three, and 'partly' — some paid, fewer than the rule
 * asked — is a different lesson from nobody paying. Reading the grade is
 * how the finer word reaches the owner without rewriting a sealed column.
 */
import { query } from '../../db/client.js';

export type OutcomeWord =
  | 'proposed' | 'designed' | 'running' | 'as predicted' | 'partly' | 'surprised'
  | 'stopped by you' | 'closed with its search' | 'retired' | 'declined' | 'invalid' | 'superseded';

export interface Outcome {
  /** The owner's word, lower case, for a sentence: "settled surprised". */
  word: OutcomeWord;
  /** The same word as a label: "Surprised". */
  label: string;
  /** What the word means, in one sentence. */
  meaning: string;
  /** The recorded reason: the settlement's own words, or his, or the search's. */
  reason: string | null;
  /** What the result establishes, and what it does not. Null until it settles. */
  establishes: string | null;
  doesNotEstablish: string | null;
  /** When it ended, if it has. */
  when: string | null;
  /** Whether the world answered (ran and settled), as opposed to ending another way. */
  settled: boolean;
  /** Whether it has ended at all. */
  concluded: boolean;
}

export interface OutcomeRow {
  decision?: string | null;
  validity?: string | null;
  verdict?: string | null;
  /** The grade the world wrote beside the verdict, when one stands. */
  grade?: string | null;
  what_happened?: string | null;
  ran_at?: string | null;
  retired_at?: string | null;
  retired_because?: string | null;
  superseded_by?: string | null;
  invalidated_at?: string | null;
  invalid_because?: string | null;
  decided_at?: string | null;
  /** The limit the design wrote down before it ran. */
  cannot_prove?: string | null;
  /** True when the owner withdrew the exposure or the act before it settled. */
  stopped_by_owner?: boolean;
  /** Whether an offer was ever placed. Unknown (undefined) where the rows are not to hand. */
  placed?: boolean;
}

const str = (v: unknown): string | null => v == null || v === '' ? null : String(v);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The prose for what a settled result establishes, lifted from the Ask answer; one copy. */
function establishing(word: 'as predicted' | 'partly' | 'surprised', cannotProve: string | null): { establishes: string; doesNotEstablish: string } {
  const limit = cannotProve ? ` It could not establish: ${cannotProve.trim().replace(/\.+$/, '')}.` : '';
  if (word === 'surprised') {
    return {
      establishes: 'that this offer, to that population, through that channel, in that window, did not sell.',
      doesNotEstablish: `that the category is worthless, or that nobody would buy it another way.${limit}`,
    };
  }
  if (word === 'partly') {
    return {
      establishes: 'that some people paid at this offer, fewer than the rule asked for: one result, not a formula.',
      doesNotEstablish: `that it would sell at scale, or that it would not; the rule was not met and was not empty.${limit}`,
    };
  }
  return {
    establishes: 'that the prediction held for this offer, this population and this window: one result, not a formula.',
    doesNotEstablish: `that it would hold for a different offer, population or channel.${limit}`,
  };
}

/** The one derivation, from the rows alone. Pure; every surface calls this. */
export function outcomeFromRow(r: OutcomeRow): Outcome {
  const done = (word: OutcomeWord, meaning: string, reason: string | null, when: string | null, settled = false): Outcome => ({
    word, label: cap(word), meaning, reason, establishes: null, doesNotEstablish: null, when, settled, concluded: true,
  });
  const retiredBecause = str(r.retired_because);
  if (r.superseded_by) return done('superseded', 'Replaced by a later design; its record stands.', null, str(r.retired_at), false);
  if (r.retired_at && retiredBecause?.startsWith('you stopped it')) {
    return done('stopped by you', 'Nothing more is sent; what the world already did stays on record.',
      retiredBecause.replace(/^you stopped it:\s*/, '') || null, str(r.retired_at));
  }
  if (r.retired_at && /^its search was closed/.test(retiredBecause ?? '')) {
    return done('closed with its search', 'The search it belonged to closed before it was decided, so it was never run.', retiredBecause, str(r.retired_at));
  }
  if (r.retired_at) return done('retired', 'Retired before it ran.', retiredBecause, str(r.retired_at));
  if (r.decision === 'declined') return done('declined', 'You decided not to run it.', null, str(r.decided_at));
  if (r.validity != null && r.validity !== 'valid') {
    return done('invalid', 'It did not measure what it was for, so it is re-run rather than read.', str(r.invalid_because), str(r.invalidated_at));
  }
  if (r.ran_at) {
    const grade = str(r.grade);
    const word: 'as predicted' | 'partly' | 'surprised' = grade === 'partly' ? 'partly'
      : (grade ?? str(r.verdict)) === 'as_predicted' ? 'as predicted' : 'surprised';
    // WHAT THE ROWS SAY, NOT WHAT THE SENTENCE IMPLIES. A test settled with no
    // offer ever placed did not fail to sell; nobody could buy. The word stays
    // the world's; the meaning says so.
    const meaning = (word === 'as predicted' ? 'The prediction held.'
      : word === 'partly' ? 'Some of what was predicted happened, fewer than the rule asked for.'
        : 'The prediction did not hold.')
      + (r.placed === false ? ' Nothing was sent: no offer was ever placed, so nobody could buy.' : '');
    const e = establishing(word, str(r.cannot_prove));
    return { word, label: cap(word), meaning, reason: str(r.what_happened), establishes: e.establishes, doesNotEstablish: e.doesNotEstablish,
      when: str(r.ran_at), settled: true, concluded: true };
  }
  if (r.decision === 'approved' && r.stopped_by_owner) {
    return done('stopped by you', 'Nothing more is sent; what the world already did stays on record.', null, null);
  }
  if (r.decision === 'approved') {
    return { word: 'running', label: 'Running', meaning: 'It is out in the world; the sealed rule settles it.', reason: null,
      establishes: null, doesNotEstablish: null, when: null, settled: false, concluded: false };
  }
  if (r.decided_at == null && r.decision == null) {
    return { word: 'proposed', label: 'Proposed', meaning: 'Designed and waiting on your decision.', reason: null,
      establishes: null, doesNotEstablish: null, when: null, settled: false, concluded: false };
  }
  return { word: 'designed', label: 'Designed', meaning: 'Designed; not yet run.', reason: null,
    establishes: null, doesNotEstablish: null, when: null, settled: false, concluded: false };
}

/** The SQL that reads the grade the world wrote beside a test's verdict. */
export const GRADE_SQL = `(SELECT g.verdict FROM prediction_resolutions g
   WHERE g.kind = 'venture_experiment' AND g.prediction_id = e.id
   ORDER BY g.rowid DESC LIMIT 1)`;

/** The outcome of one test, from its rows. Null when there is no such test. */
export async function outcomeOf(experimentId: string): Promise<Outcome | null> {
  const r = (await query(
    `SELECT e.decision, e.validity, e.verdict, e.what_happened, e.ran_at, e.retired_at, e.retired_because,
            e.superseded_by, e.invalidated_at, e.invalid_because, e.decided_at, d.cannot_prove,
            ${GRADE_SQL} AS grade,
            EXISTS (SELECT 1 FROM experiment_exposures x WHERE x.experiment_id = e.id AND x.withdrawn_at IS NOT NULL) AS withdrawn,
            EXISTS (SELECT 1 FROM experiment_exposures x WHERE x.experiment_id = e.id) AS placed
       FROM venture_experiments e LEFT JOIN probe_designs d ON d.experiment_id = e.id
      WHERE e.id = ?`, [experimentId])).rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return outcomeFromRow({ ...(r as OutcomeRow), stopped_by_owner: Number(r.withdrawn) === 1, placed: Number(r.placed) === 1 });
}

/** "settled surprised on 2026-09-12: nobody bought …" — one line for a stream or a letter. */
export function outcomeSentence(o: Outcome): string {
  const when = o.when ? ` on ${o.when.slice(0, 10)}` : '';
  const head = o.settled ? `settled ${o.word}${when}` : `${o.word}${when}`;
  return o.reason ? `${head}: ${o.reason}` : `${head}.`;
}
