// =============================================================================
// FOUNDRY - what liability a thing creates, and whether we should be the ones
// answering
//
// The owner's rule: prefer the structurally lighter way of producing the same
// value; see heavy exposure early; never let several assets share one legal
// failure; and know when a question has left what Foundry can responsibly
// answer. None of that is a legal opinion, and nothing here produces one. This
// is recognition, mapping, freshness and escalation - the parts an institution
// can honestly own.
//
// A MATERIAL EXPOSURE IS A PORTFOLIO EXPOSURE. Recording one also files it on
// the `legal_exposure` axis, so four businesses that each hold personal data are
// counted as one failure with four victims by the same arithmetic that counts
// four businesses on one channel. Shared legal failure was the concentration
// hardest to see; this is how it becomes visible without a second machine.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { noteExposure, type World } from '../founder/resilience.js';

const STALE_DAYS = 180;

export type Severity = 'minor' | 'material' | 'serious';

export interface Surface {
  id: string;
  cls: string;
  whatItIs: string;
  whatItCreates: string;
  known: string | null;
  unknown: string | null;
  assumes: string | null;
  severity: Severity;
  needsProfessional: boolean;
  /** Days since this was last known to be true. */
  age: number;
  stale: boolean;
  /** The structural way of not having this kind of exposure at all. */
  oftenAvoidedBy: string;
}

export async function noteLegalSurface(input: {
  founderId: string; subjectKind: 'company' | 'opportunity'; subjectId: string;
  cls: string; whatItCreates: string; severity: Severity;
  known?: string | null; unknown?: string | null; assumes?: string | null;
  needsProfessional?: boolean; observedAt?: Date;
  evidenceMode: 'real' | 'reference';
}): Promise<string | null> {
  const id = nanoid();
  try {
    await query(
      `INSERT INTO legal_surfaces
         (id, founder_id, subject_kind, subject_id, class, what_it_creates, known,
          unknown, assumes, severity, needs_professional, observed_at, evidence_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, input.founderId, input.subjectKind, input.subjectId, input.cls,
        input.whatItCreates.trim(), input.known ?? null, input.unknown ?? null,
        input.assumes ?? null, input.severity, input.needsProfessional ? 1 : 0,
        (input.observedAt ?? new Date()).toISOString(), input.evidenceMode]);
  } catch (err) {
    // A serious exposure with neither a professional flagged nor a stated
    // reason is refused by the table, and that refusal is the product: it is
    // not swallowed here as a duplicate.
    if (String((err as Error).message).includes('serious_needs_a_professional')) throw err;
    return null;
  }
  // WHAT IS MATERIAL COUNTS TOWARD CONCENTRATION. A minor one does not, or
  // every business would share "has a website" and the axis would say nothing.
  if (input.severity !== 'minor') {
    await noteExposure({
      founderId: input.founderId, subjectKind: input.subjectKind,
      subjectId: input.subjectId, dimension: 'legal_exposure', value: input.cls,
      howKnown: input.subjectKind === 'company' ? 'owner_said' : 'inferred',
      evidenceMode: input.evidenceMode === 'reference' ? 'reference' : 'real',
    });
  }
  return id;
}

export async function legalSurfaceOf(
  subjectKind: 'company' | 'opportunity', subjectId: string,
): Promise<Surface[]> {
  return ((await query(
    `SELECT s.id, s.class, s.what_it_creates, s.known, s.unknown, s.assumes,
            s.severity, s.needs_professional, c.what_it_is, c.often_avoided_by,
            CAST(julianday('now') - julianday(s.observed_at) AS INTEGER) AS age
       FROM legal_surfaces s
       JOIN exposure_classes c ON c.class = s.class
      WHERE s.subject_kind = ? AND s.subject_id = ? AND s.retired_at IS NULL
      ORDER BY CASE s.severity WHEN 'serious' THEN 0 WHEN 'material' THEN 1 ELSE 2 END,
               c.sort_order`, [subjectKind, subjectId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), cls: String(r.class), whatItIs: String(r.what_it_is),
    whatItCreates: String(r.what_it_creates),
    known: r.known == null ? null : String(r.known),
    unknown: r.unknown == null ? null : String(r.unknown),
    assumes: r.assumes == null ? null : String(r.assumes),
    severity: String(r.severity) as Severity,
    needsProfessional: Number(r.needs_professional) === 1,
    age: Number(r.age), stale: Number(r.age) > STALE_DAYS,
    oftenAvoidedBy: String(r.often_avoided_by),
  }));
}

export interface LegalPicture {
  surfaces: Surface[];
  /** Sentences, each a reason this cannot advance on legal grounds. */
  inTheWay: string[];
  /** Classes already carried by companies he owns, so a shared failure is named. */
  sharedWithPortfolio: Array<{ cls: string; carriedBy: number }>;
  /** The recorded answer to "could this be built with less legal surface?" */
  lighter: string | null;
  /** The one paragraph. */
  profile: string;
}

/**
 * THE LEGAL PICTURE OF A CANDIDATE, AS THE OWNER READS IT.
 *
 * Not a score. The surfaces, worst first; what already ails the portfolio in
 * the same way; whether anyone has asked the lighter-architecture question; and
 * the exact reasons, if any, this cannot advance yet.
 */
export async function legalPictureOf(input: {
  founderId: string; opportunityId: string; world: World;
}): Promise<LegalPicture> {
  const surfaces = await legalSurfaceOf('opportunity', input.opportunityId);
  const opp = (await query(
    'SELECT lighter_architecture FROM venture_opportunities WHERE id = ?',
    [input.opportunityId])).rows[0] as Record<string, unknown> | undefined;
  const lighter = opp?.lighter_architecture == null ? null : String(opp.lighter_architecture);

  const carried = (await query(
    `SELECT s.class, COUNT(DISTINCT s.subject_id) AS n
       FROM legal_surfaces s
       JOIN products p ON p.id = s.subject_id
      WHERE s.founder_id = ? AND s.subject_kind = 'company' AND s.retired_at IS NULL
        AND s.severity <> 'minor' AND s.evidence_mode = ? AND p.reality = ?
        AND p.status = 'active' AND p.standing = 'earned' AND p.deleted_at IS NULL
      GROUP BY s.class`, [input.founderId, input.world, input.world]))
    .rows as unknown as Array<Record<string, unknown>>;
  const sharedWithPortfolio = carried
    .filter((row) => surfaces.some((s) => s.cls === String(row.class) && s.severity !== 'minor'))
    .map((row) => ({ cls: String(row.class), carriedBy: Number(row.n) }));

  const inTheWay: string[] = [];
  if (surfaces.length === 0) {
    inTheWay.push('nobody has asked what legal surface this creates');
  }
  if (lighter === null) {
    inTheWay.push('nobody has asked whether the same value could be created with '
      + 'less legal surface');
  }
  for (const s of surfaces) {
    if (s.needsProfessional) {
      inTheWay.push(`${s.whatItIs} needs somebody qualified to look before this `
        + 'goes further - that is past what I should answer');
    }
    if (s.stale) inTheWay.push(`what I know about ${s.whatItIs} is over six months old`);
  }

  const worst = surfaces[0];
  const profile = surfaces.length === 0
    ? 'Not looked at yet.'
    : `${surfaces.length === 1 ? 'One kind of exposure' : `${String(surfaces.length)} kinds of exposure`}, `
      + `the heaviest ${worst?.severity ?? ''}: ${worst?.whatItCreates ?? ''}.`
      + (sharedWithPortfolio.length > 0
        ? ` ${String(sharedWithPortfolio[0]?.carriedBy ?? 0)} of your businesses already `
          + `carry ${sharedWithPortfolio[0]?.cls.replace(/_/g, ' ') ?? ''}, so this would `
          + 'be one more thing the same rule change reaches.'
        : '')
      + (lighter ? ` Lighter version: ${lighter}` : '');

  return { surfaces, inTheWay, sharedWithPortfolio, lighter, profile };
}

/**
 * SOMEBODY QUALIFIED LOOKED. This is the only way a "needs a professional"
 * surface stops standing in the way, and it is attributed: what they found is
 * appended to what is known, with who said it, and the exposure is fresh again
 * from today. Foundry cannot call this on its own conclusions - the `by` is
 * recorded verbatim and a reader can see whether it names a person.
 */
export async function recordProfessionalReview(input: {
  surfaceId: string; by: string; found: string;
}): Promise<void> {
  await query(
    `UPDATE legal_surfaces
        SET needs_professional = 0,
            known = COALESCE(known || ' ', '') || ?,
            observed_at = datetime('now')
      WHERE id = ? AND retired_at IS NULL`,
    [`Reviewed by ${input.by.trim()}: ${input.found.trim()}`, input.surfaceId]);
}

/** Record the answer to "could this be built with less legal surface?" */
export async function answerLighter(input: {
  opportunityId: string; answer: string;
}): Promise<void> {
  await query(
    'UPDATE venture_opportunities SET lighter_architecture = ? WHERE id = ?',
    [input.answer.trim(), input.opportunityId]);
}
