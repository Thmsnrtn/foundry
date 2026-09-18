// =============================================================================
// FOUNDRY — Steering a search with one tap, and nothing new underneath.
//
// The owner can already steer by typing a sentence, and every sentence he
// could type lands as a `venture_guidance` row. What he could not do was steer
// the thing he is LOOKING AT: a candidate on a screen, with no way to say "more
// like this" except to describe it back to Foundry in prose.
//
// EVERY NUDGE HERE WRITES A ROW THAT ALREADY EXISTED. No new vocabulary, no new
// table, no hidden preference model: each is exactly the guidance kind the
// sentence-reader would have produced, with a subject taken from the candidate
// he was looking at, and the statement says in his own language what he did.
// That is what makes it inspectable — on Discover a nudge is a sentence among
// the sentences he typed, and it can be read, superseded and argued with the
// same way.
//
// RESTRAINT IS PART OF THE DESIGN. Ten buttons under a candidate is not agency,
// it is a control panel; `nudgesFor` returns at most four, and they are the
// four that mean something for that particular candidate.
// =============================================================================
import { query } from '../../db/client.js';

export interface Nudge {
  key: string;
  /** What the button says. */
  label: string;
  /** What it will do, in plain words, read before he presses it. */
  what: string;
}

const MORE = 'more_like';
const LESS = 'less_like';
const DEEPER = 'deeper';
const CHEAPER = 'cheaper_test';
const LOW_SUPPORT = 'low_support';
const ANOTHER_FORM = 'another_form';

const ALL: Record<string, Nudge> = {
  [MORE]: { key: MORE, label: 'More like this',
    what: 'I will treat that kind as the front runner and put my effort there.' },
  [LESS]: { key: LESS, label: 'Less like this',
    what: 'I will reject candidates that depend on that, and say that is why.' },
  [DEEPER]: { key: DEEPER, label: 'Go deeper',
    what: 'I will keep working on this one rather than moving on.' },
  [CHEAPER]: { key: CHEAPER, label: 'Cheaper test',
    what: 'I will look for the cheapest thing that would answer the question in the way.' },
  [LOW_SUPPORT]: { key: LOW_SUPPORT, label: 'Lower maintenance',
    what: 'I will weight the search toward things that do not need looking after.' },
  [ANOTHER_FORM]: { key: ANOTHER_FORM, label: 'A different kind',
    what: 'I will look for a different economic form.' },
};

/**
 * THE FOUR THAT MEAN SOMETHING FOR THIS ONE.
 *
 * Three are always true of a candidate — more of its kind, less of its kind,
 * or stay on this one. The fourth is read from the candidate itself: a money
 * question standing in the way makes "cheaper test" the useful lever; a form
 * whose way of getting paid the hands cannot run makes "a different kind" the
 * useful one; otherwise the standing preference he is most likely to want.
 */
export function nudgesFor(c: { blockedBy: string | null; cannotTestYet: boolean }): Nudge[] {
  const money = c.blockedBy !== null && /\b(pay|paying|money|price|charge|afford)\b/i.test(c.blockedBy);
  const fourth = money ? CHEAPER : c.cannotTestYet ? ANOTHER_FORM : LOW_SUPPORT;
  return [ALL[MORE], ALL[LESS], ALL[DEEPER], ALL[fourth]].filter((n): n is Nudge => n !== undefined);
}

export const nudgeNamed = (key: string): Nudge | null => ALL[key] ?? null;

/**
 * WRITE IT, AS THE SENTENCE HE WOULD HAVE TYPED.
 *
 * Everything is re-derived here from the candidate and the open search. The
 * form posts a candidate and a nudge key and nothing else, so nothing about
 * what is written can be chosen by whoever built the request.
 */
export async function steer(input: {
  founderId: string; opportunityId: string; nudge: string;
}): Promise<{ said: string } | { refused: string }> {
  const nudge = nudgeNamed(input.nudge);
  if (!nudge) return { refused: 'I do not know that one.' };

  const row = (await query(
    `SELECT o.id, o.headline, o.mandate_id, s.origin_said
       FROM venture_opportunities o
       LEFT JOIN opportunity_seeds s ON s.promoted_to = o.id
      WHERE o.id = ? AND o.founder_id = ? AND o.verdict IS NULL`,
    [input.opportunityId, input.founderId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) return { refused: 'I could not find that one.' };

  const { absorbGuidance, currentMandate } = await import('./mandate.js');
  const open = await currentMandate(input.founderId);
  // A NUDGE STEERS A SEARCH. With none open there is nothing to steer, and
  // silently opening one because he tapped a button under an old candidate
  // would start real work from a gesture that did not ask for it.
  if (!open) return { refused: 'There is no search running to steer.' };
  if (open.id !== String(row.mandate_id)) {
    return { refused: 'That one belongs to a search that has finished.' };
  }

  // WHAT IT IS ABOUT, IN WORDS THAT WERE ALREADY WRITTEN DOWN. The form it was
  // filed under comes from the candidate's own sentences, so the subject a
  // nudge records is the candidate's, never a category Foundry invented for it.
  const { formNamed, formOf } = await import('./economic-forms.js');
  const kind = formNamed(formOf([
    { said: String(row.headline), where: 'its headline' },
    ...(row.origin_said == null ? [] : [{ said: String(row.origin_said), where: 'the sentence that started it' }]),
  ]).form);
  const about = kind.key === 'other' ? String(row.headline) : kind.label.toLowerCase();

  const written = nudge.key === MORE
    ? { kind: 'favour' as const, subject: about, dimension: null,
      statement: `More like this: ${about}` }
    : nudge.key === LESS
      ? { kind: 'avoid' as const, subject: about, dimension: null,
        statement: `Less like this: ${about}` }
      : nudge.key === DEEPER
        ? { kind: 'deeper' as const, subject: String(row.headline), dimension: null,
          statement: `Go deeper on ${String(row.headline)}` }
        : nudge.key === CHEAPER
          ? { kind: 'budget' as const, subject: null, dimension: null,
            statement: 'Find a cheaper way to answer the question in the way' }
          : nudge.key === LOW_SUPPORT
            ? { kind: 'prefer' as const, subject: 'almost no support burden',
              dimension: 'support_burden', statement: 'Prefer things that do not need looking after' }
            : { kind: 'another' as const, subject: null, dimension: null,
              statement: 'Look for a different kind of thing' };

  await absorbGuidance({
    mandateId: open.id, statement: written.statement, kind: written.kind,
    subject: written.subject, dimension: written.dimension,
  });
  return { said: written.statement };
}
