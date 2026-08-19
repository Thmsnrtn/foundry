// =============================================================================
// FOUNDRY — Owner disposition on institutional judgments
//
// Closes the judgment loop without turning agreement into permission.
//
//   Owner direction  =  which way the company should go.
//   Execution authority = a separate, exact, responsibility-bound consent.
//
// Nothing in this module writes a consent, policy, action, execution,
// responsibility state, or maturity row, and the judgment it disposes is never
// rewritten.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { getReconstructionClaims } from './reconstruction.js';

export type JudgmentDisposition = 'accepted' | 'rejected' | 'deferred' | 'alternative_selected';

export interface MaterialJudgment {
  id: string;
  title: string;
  description: string;
  /** Alternatives Foundry represented at judgment time, in their original order. */
  alternatives: string[];
  /** What remained unresolved when the judgment was made — never hidden by a direction. */
  uncertainties: string[];
  /** Current owner direction, or null when the judgment still awaits one. */
  disposition: JudgmentDisposition | null;
  selectedAlternative: string | null;
  /** Latest later-reality comparison, or null when none has been recorded. */
  evaluationState: string | null;
  /** Always true: a judgment cannot allocate or execute. */
  authorityStillRequired: boolean;
}

const parseArray = (value: unknown): string[] => {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
};

/**
 * Append an authenticated owner's direction for one institutional judgment.
 *
 * `ownerId` must come from the caller's authenticated session. The database
 * guard independently verifies it against the real product owner, verifies the
 * judgment's tenant and institutional provenance, requires a reason, and
 * requires any selected alternative to be one Foundry actually represented.
 *
 * Recording a direction grants no authority. A later change of direction
 * appends a new row; earlier directions and the judgment itself are preserved.
 */
export async function recordJudgmentDisposition(input: {
  productId: string; judgmentId: string; ownerId: string;
  disposition: JudgmentDisposition; reason: string; selectedAlternative?: string;
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO institutional_judgment_dispositions
     (id,judgment_id,product_id,owner_id,disposition,selected_alternative,reason) VALUES (?,?,?,?,?,?,?)`,
    [id, input.judgmentId, input.productId, input.ownerId, input.disposition,
      input.disposition === 'alternative_selected' ? (input.selectedAlternative ?? null) : null,
      input.reason],
  );
  return id;
}

/**
 * Resolve one represented alternative by its position in the canonical
 * judgment row, so the owner's choice is located rather than declared. A
 * caller-supplied alternative string is never trusted as the selection.
 */
export async function resolveRepresentedAlternative(
  productId: string, judgmentId: string, index: number,
): Promise<string | null> {
  const row = (await query(
    `SELECT alternatives_considered_json FROM strategic_decisions_log
     WHERE id=? AND product_id=? AND responsibility_refs_json IS NOT NULL`,
    [judgmentId, productId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const alternatives = parseArray(row.alternatives_considered_json);
  return Number.isInteger(index) && index >= 0 && index < alternatives.length ? alternatives[index] : null;
}

/**
 * The compressed set of judgments that genuinely need the owner: those still
 * awaiting a direction, and those whose later reality has contradicted or
 * conflicted with what Foundry judged. Judgments already dispositioned and
 * since supported stay quiet.
 */
export async function getMaterialJudgments(productId: string): Promise<MaterialJudgment[]> {
  const rows = (await query(
    `SELECT j.id, j.decision_title, j.decision_description, j.alternatives_considered_json,
            j.uncertainties_json,
            (SELECT d.disposition FROM institutional_judgment_dispositions d
              WHERE d.judgment_id=j.id AND d.product_id=j.product_id
              ORDER BY d.created_at DESC, d.rowid DESC LIMIT 1) AS disposition,
            (SELECT d.selected_alternative FROM institutional_judgment_dispositions d
              WHERE d.judgment_id=j.id AND d.product_id=j.product_id
              ORDER BY d.created_at DESC, d.rowid DESC LIMIT 1) AS selected_alternative,
            (SELECT e.state FROM institutional_judgment_evaluations e
              WHERE e.judgment_id=j.id AND e.product_id=j.product_id
              ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1) AS evaluation_state
     FROM strategic_decisions_log j
     WHERE j.product_id=? AND j.responsibility_refs_json IS NOT NULL
     ORDER BY j.made_at DESC, j.rowid DESC`,
    [productId],
  )).rows as Array<Record<string, unknown>>;

  return rows
    .map((row) => ({
      id: String(row.id),
      title: String(row.decision_title),
      description: String(row.decision_description),
      alternatives: parseArray(row.alternatives_considered_json),
      uncertainties: parseArray(row.uncertainties_json),
      disposition: (row.disposition as JudgmentDisposition | null) ?? null,
      selectedAlternative: (row.selected_alternative as string | null) ?? null,
      evaluationState: (row.evaluation_state as string | null) ?? null,
      authorityStillRequired: true,
    }))
    .filter((j) => j.disposition === null
      || j.evaluationState === 'conflicting' || j.evaluationState === 'contradicted');
}

/**
 * FOUNDRY'S OWN JUDGMENT TRACK RECORD.
 *
 * `evaluateInstitutionalJudgment` wrote every later-reality comparison twice:
 * to `institutional_judgment_evaluations.state`, and as a
 * `later_reality_comparison` reconstruction claim carrying the observations it
 * rested on. The column is read — `getMaterialJudgments` uses it to decide what
 * still needs the owner. The claim was read by nothing, and neither was the
 * `learned_claim_id` pointing at it. The same dead-sided dual-write the
 * development outcomes had.
 *
 * The two sides get different jobs rather than one being deleted. The column
 * answers "does THIS judgment still need you". The claims answer "how has
 * Foundry's judgment about this company held up", which is the question a
 * founder deciding how much weight to give the next one is actually asking, and
 * it needs provenance and expiry rather than a current-state enum.
 *
 * Counts, never a rate, for the same reason as the development record: two
 * borne out of three is not "67% accurate", and a percentage invites a
 * confidence the evidence cannot carry.
 *
 * STALENESS RUNS ONE WAY ONLY, against Foundry. Read-time expiry exists so an
 * old positive claim does not silently remain current, so a `supported`
 * judgment whose evidence has expired falls back to unresolved. A
 * `contradicted` one is not retired the same way: being wrong is a thing that
 * happened, and letting time turn it into "nobody knows" would let Foundry
 * improve its record by waiting.
 */
export interface JudgmentRecord {
  borneOut: number;
  contradicted: number;
  unresolved: number;
}

export async function getJudgmentRecord(
  productId: string, now: Date = new Date(),
): Promise<JudgmentRecord | null> {
  const claims = (await getReconstructionClaims(productId, now))
    .filter((claim) => claim.predicate === 'later_reality_comparison');
  if (!claims.length) return null;

  const tally: JudgmentRecord = { borneOut: 0, contradicted: 0, unresolved: 0 };
  for (const claim of claims) {
    const state = typeof claim.value === 'string' ? claim.value : null;
    const current = claim.epistemicStatus === 'known' || claim.epistemicStatus === 'inferred';
    // `conflicting` is evidence on both sides. It is not Foundry being right,
    // and it is not Foundry being wrong — it is unresolved, and saying anything
    // else would be picking a side the evidence does not.
    if (state === 'contradicted') tally.contradicted++;
    else if (state === 'supported' && current) tally.borneOut++;
    else tally.unresolved++;
  }
  return tally;
}
