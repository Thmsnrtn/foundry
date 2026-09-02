// =============================================================================
// FOUNDRY — candidates for a search that cannot see
//
// `venture_opportunities` is read by the mandate and written by nothing,
// because Foundry has no market sense and will not invent one. A gate caught
// that and was right to: a surface showing permanent emptiness is worse than an
// absent one.
//
// So the writer is the reference world, doing here what it does everywhere
// else — exercising machinery that has no real input yet, through the
// production path, marked so that nothing it produces can walk out.
//
// WHAT THESE ARE. Three declared candidates that exist to put the CANDIDATE
// DISCIPLINE under load, not to be good ideas:
//
//   one that survives — it has sources, a stated way to die, and honest unknowns
//   one that its own kill thesis destroys — the discipline working as intended
//   one that fails the owner's guidance — steering doing something, visibly
//
// They are as fictional as the reference companies and refused a real mandate
// by the same trigger. What is real is what happens to them: the unknowns that
// block advancement, the source requirement, the rejection that is kept with
// its reason.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

interface DeclaredCandidate {
  headline: string; whoHasIt: string; theProblem: string; whyItMight: string;
  killThesis: string; unknowns: string[]; sources: string[];
}

const CANDIDATES: DeclaredCandidate[] = [
  {
    headline: 'Shift handover for independent veterinary practices',
    whoHasIt: 'two-to-six-vet practices that run more than one shift',
    theProblem: 'handover happens on paper and in someone\'s head, and the '
      + 'things that get missed are the ones that hurt an animal',
    whyItMight: 'they already pay for practice management software that does '
      + 'not do this, and the people who feel it are the ones who choose tools',
    killThesis: 'practice management vendors ship this as a feature within a '
      + 'year and it stops being a business',
    unknowns: [
      'whether anyone would pay for it separately from their existing system',
      'how many practices actually run multiple shifts',
      'whether the incumbent is already building it',
    ],
    sources: ['reference-world:declared-candidate'],
  },
  {
    headline: 'A dashboard that unifies every tool a small agency uses',
    whoHasIt: 'agencies of five to twenty people',
    theProblem: 'context is scattered across six tools and nobody sees the whole',
    whyItMight: 'everybody complains about it',
    // THE DISCIPLINE WORKING AS INTENDED. Everybody complaining is not demand,
    // and a candidate whose own kill thesis lands should die before it reaches
    // the owner rather than after.
    killThesis: 'this has been built dozens of times and dies every time, '
      + 'because the pain is real and the willingness to change tools is not',
    unknowns: [
      'whether anyone has ever paid for one of these',
      'why the previous attempts died',
    ],
    sources: ['reference-world:declared-candidate'],
  },
  {
    headline: 'A paid-search arbitrage play for local trades',
    whoHasIt: 'plumbers and electricians without their own marketing',
    theProblem: 'they cannot compete for search traffic on their own',
    whyItMight: 'margins on lead generation are good and the buyers are reachable '
      + 'through paid acquisition on search ads',
    killThesis: 'the channel gets more expensive every year and the whole thing '
      + 'is a bet on arbitrage that closes',
    unknowns: ['whether the arbitrage still exists at all'],
    sources: ['reference-world:declared-candidate'],
  },
];

/**
 * Put candidates in front of a reference mandate.
 *
 * Idempotent: a mandate that already has candidates is left alone, so the
 * routine that keeps the reference world moving does not accumulate them.
 */
export async function exerciseReferenceMandate(mandateId: string): Promise<number> {
  const mandate = (await query(
    `SELECT id, evidence_mode, founder_id FROM venture_mandates
      WHERE id = ? AND closed_at IS NULL`, [mandateId]))
    .rows[0] as Record<string, unknown> | undefined;
  // Real mandates are never seeded. What Foundry knows about a real market has
  // to come from somewhere it actually looked.
  if (!mandate || String(mandate.evidence_mode) !== 'reference') return 0;

  const already = (await query(
    'SELECT COUNT(*) AS n FROM venture_opportunities WHERE mandate_id = ?', [mandateId]))
    .rows[0] as Record<string, unknown>;
  if (Number(already.n) > 0) return 0;

  for (const candidate of CANDIDATES) {
    await query(
      `INSERT INTO venture_opportunities
         (id, mandate_id, founder_id, headline, who_has_it, the_problem,
          why_it_might, kill_thesis, unknowns_json, sources_json, evidence_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'reference')`,
      [nanoid(), mandateId, String(mandate.founder_id),
        candidate.headline, candidate.whoHasIt,
        candidate.theProblem, candidate.whyItMight, candidate.killThesis,
        JSON.stringify(candidate.unknowns), JSON.stringify(candidate.sources)]);
  }
  return CANDIDATES.length;
}
