// =============================================================================
// FOUNDRY — The shelves: everything found and believed, arranged by what it is.
//
// The Experiments place answers "what is running". It could not answer "what
// have you found", which is the question an owner asks when nothing is running
// — and the honest answer to that is frequently "nothing yet", which is a good
// answer and was not being given either.
//
// Three queries, never `candidatesFor`'s loop. That reader assembles the whole
// argument for one candidate, which is right on the page where he decides and
// wrong on a shelf where he is glancing. Here: the open candidates and their
// seeds; one grouped count of how many independent ways of knowing support
// each; one pass of what still blocks each. Everything else is on the
// candidate's own page, one tap away.
//
// A CANDIDATE IS NEVER MANUFACTURED BY BEING LOOKED FOR. Every row here
// already survived promotion, which requires genuinely different ways of
// knowing, and the form it is filed under comes from a sentence somebody else
// wrote. An empty shelf is a true answer about the world.
// =============================================================================
import { query } from '../../db/client.js';
import { ECONOMIC_FORMS, formOf } from './economic-forms.js';

export interface ShelfCandidate {
  id: string;
  headline: string;
  whoHasIt: string;
  theProblem: string;
  /** How many genuinely different ways of knowing have said something. */
  stances: number;
  /** That, in the owner's language, with no number standing on its own. */
  evidence: string;
  /** The first thing that still stops it, else null. */
  blockedBy: string | null;
  /** The strongest reason it fails, which is what a card shows when nothing blocks. */
  killThesis: string;
  /** Which economic form it answers to, and the words that put it there. */
  form: string;
  because: string;
  /** Which of its own sentences the words were found in. */
  where: string;
}

export interface Shelf {
  key: string;
  label: string;
  whatItIs: string;
  candidates: ShelfCandidate[];
  /** Named when a test of this form could not be run today, else null. */
  cannotTestYet: string | null;
}

/**
 * WHAT HAS BEEN FOUND, ON SHELVES.
 *
 * Real candidates only: a rehearsal search exists to let him see the machinery
 * work, and its inventions must never be counted among things found about the
 * world. An empty return means nothing has been found, which the surface says.
 */
export async function shelfCandidates(founderId: string): Promise<Shelf[]> {
  const rows = (await query(
    `SELECT o.id, o.headline, o.who_has_it, o.the_problem, o.why_it_might, o.kill_thesis,
            s.id AS seed_id, s.origin_said
       FROM venture_opportunities o
       LEFT JOIN opportunity_seeds s ON s.promoted_to = o.id
      WHERE o.founder_id = ? AND o.verdict IS NULL AND o.evidence_mode = 'real'
      ORDER BY o.rowid DESC`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;

  const seedIds = rows.map((r) => r.seed_id).filter((s): s is string => s != null).map(String);
  const stanceOf = new Map<string, number>();
  if (seedIds.length > 0) {
    const holes = seedIds.map(() => '?').join(',');
    for (const r of (await query(
      `SELECT c.seed_id AS seed_id, COUNT(DISTINCT t.epistemic_stance) AS stances
         FROM market_claims c
         JOIN market_observations o ON o.claim_id = c.id
         JOIN market_source_types t ON t.source_type = o.source_type
        WHERE c.seed_id IN (${holes})
          AND o.evidence_mode <> 'reference' AND t.epistemic_stance <> 'rehearsal'
          AND (o.from_absence = 0 OR o.bearing = 'supports')
        GROUP BY c.seed_id`, seedIds))
      .rows as unknown as Array<Record<string, unknown>>) {
      stanceOf.set(String(r.seed_id), Number(r.stances));
    }
  }

  const blockedOf = new Map<string, string>();
  if (rows.length > 0) {
    const holes = rows.map(() => '?').join(',');
    for (const r of (await query(
      `SELECT opportunity_id, question FROM market_unknowns
        WHERE opportunity_id IN (${holes}) AND blocking = 1 AND answered_at IS NULL
        ORDER BY rowid`, rows.map((r) => String(r.id))))
      .rows as unknown as Array<Record<string, unknown>>) {
      if (!blockedOf.has(String(r.opportunity_id))) blockedOf.set(String(r.opportunity_id), String(r.question));
    }
  }

  const exchanges = new Map<string, boolean>();
  for (const r of (await query('SELECT exchange, available FROM probe_exchanges', []))
    .rows as unknown as Array<Record<string, unknown>>) {
    exchanges.set(String(r.exchange), Number(r.available) === 1);
  }

  const placed: ShelfCandidate[] = rows.map((r) => {
    const seedId = r.seed_id == null ? null : String(r.seed_id);
    const stances = seedId === null ? 0 : stanceOf.get(seedId) ?? 0;
    const said = formOf([
      { said: String(r.headline), where: 'its headline' },
      { said: String(r.the_problem), where: 'the problem it names' },
      { said: String(r.why_it_might), where: 'why it might work' },
      ...(r.origin_said == null ? [] : [{ said: String(r.origin_said), where: 'the sentence that started it' }]),
    ]);
    return {
      id: String(r.id), headline: String(r.headline), whoHasIt: String(r.who_has_it),
      theProblem: String(r.the_problem), stances,
      evidence: stances === 0 ? 'nothing observed yet'
        : stances === 1 ? 'only one way of knowing'
          : `${String(stances)} independent ways of knowing have said something`,
      blockedBy: blockedOf.get(String(r.id)) ?? null,
      killThesis: String(r.kill_thesis),
      form: said.form, because: said.because, where: said.where,
    };
  });

  return ECONOMIC_FORMS.map((f) => {
    const mine = placed.filter((p) => p.form === f.key);
    const missing = f.needsExchange.filter((x) => exchanges.get(x) !== true);
    return {
      key: f.key, label: f.label, whatItIs: f.whatItIs, candidates: mine,
      // ONLY WHERE IT MATTERS. A shelf with nothing on it does not need to
      // explain what could not be sold on it; the sentence is for the case
      // where something real is sitting there and the hands cannot test it.
      cannotTestYet: mine.length > 0 && missing.length === f.needsExchange.length && missing.length > 0
        ? `I cannot run a test of this kind yet: it would need ${missing.join(' or ').replace(/_/g, ' ')}.`
        : null,
    };
  });
}
