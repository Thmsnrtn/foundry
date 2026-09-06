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
  /** RECOGNISED, or UNRESOLVED INTERNALLY: Foundry could not tell from here
   * whether this class applies. Both are honest; only the second is "I do not
   * know", and under the first-closure policy it blocks like a serious one. */
  standing: 'recognised' | 'unresolved_internally';
  /** The words the recognition rests on, copied from the record it was read
   * from. A recognition with no grounds is an opinion. */
  grounds: string | null;
  recognisedBy: string | null;
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
  standing?: 'recognised' | 'unresolved_internally';
  grounds?: string | null; recognisedBy?: string | null;
}): Promise<string | null> {
  const id = nanoid();
  try {
    await query(
      `INSERT INTO legal_surfaces
         (id, founder_id, subject_kind, subject_id, class, what_it_creates, known,
          unknown, assumes, severity, needs_professional, observed_at, evidence_mode,
          standing, grounds, recognised_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, input.founderId, input.subjectKind, input.subjectId, input.cls,
        input.whatItCreates.trim(), input.known ?? null, input.unknown ?? null,
        input.assumes ?? null, input.severity, input.needsProfessional ? 1 : 0,
        (input.observedAt ?? new Date()).toISOString(), input.evidenceMode,
        input.standing ?? 'recognised', input.grounds ?? null, input.recognisedBy ?? null]);
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
            s.severity, s.needs_professional, s.standing, s.grounds, s.recognised_by,
            c.what_it_is, c.often_avoided_by,
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
    standing: String(r.standing ?? 'recognised') as 'recognised' | 'unresolved_internally',
    grounds: r.grounds == null ? null : String(r.grounds),
    recognisedBy: r.recognised_by == null ? null : String(r.recognised_by),
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
  /** WHAT THE FIRST-PROOF POLICY SAYS OF IT, row by row. Policy, not law: each
   * row can be superseded by the owner, and the verdict is computed from the
   * structural facts the pass recorded — never asserted. `unknown` is a real
   * verdict and, at candidate level, does not block: the fact cannot be known
   * until the offer has a shape. */
  policy: Array<{
    requirement: string; treatment: string; verdict: 'satisfied' | 'violated' | 'unknown';
    why: string; setBy: string;
  }>;
  /** The strongest sentence the evidence supports, and never stronger. */
  sentence: string;
}

export interface PolicyRow {
  id: string; requirement: string; treatment: string; value: string | null;
  why: string; setBy: string; setAt: string; ownersOwn: boolean;
}

/**
 * THE LIVE ORIGINATION POLICY FOR THIS OWNER. Institutional defaults
 * (founder_id NULL) overridden by his own rows for the same requirement; a
 * superseded row of either kind is gone. Read here and nowhere else, so the
 * pass, the picture and the tick cannot disagree about what is in force.
 */
export async function originationPolicyFor(founderId: string): Promise<PolicyRow[]> {
  const rows = (await query(
    `SELECT id, founder_id, requirement, treatment, value, why, set_by, set_at
       FROM origination_policy
      WHERE superseded_at IS NULL AND (founder_id IS NULL OR founder_id = ?)
      ORDER BY requirement, founder_id IS NULL`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;
  // His row wins over the default for the same requirement (his sorts first).
  const seen = new Set<string>();
  const out: PolicyRow[] = [];
  for (const r of rows) {
    const req = String(r.requirement);
    if (seen.has(req)) continue;
    seen.add(req);
    out.push({
      id: String(r.id), requirement: req, treatment: String(r.treatment),
      value: r.value == null ? null : String(r.value), why: String(r.why),
      setBy: String(r.set_by), setAt: String(r.set_at).slice(0, 10),
      ownersOwn: r.founder_id != null,
    });
  }
  return out;
}

/** The structural facts on record for a subject, live rows only. */
export async function structuralFactsOf(
  subjectKind: 'company' | 'opportunity', subjectId: string,
): Promise<Array<{ fact: string; present: boolean | null; basis: string; grounds: string | null;
  whatItIs: string; answersRequirement: string | null; satisfiedWhen: number | null }>> {
  return ((await query(
    `SELECT f.fact, f.present, f.basis, f.grounds, k.what_it_is, k.answers_requirement,
            k.satisfied_when
       FROM structural_facts f
       JOIN structural_fact_kinds k ON k.fact = f.fact
      WHERE f.subject_kind = ? AND f.subject_id = ? AND f.superseded_at IS NULL
      ORDER BY k.sort_order`, [subjectKind, subjectId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    fact: String(r.fact), present: r.present == null ? null : Number(r.present) === 1,
    basis: String(r.basis), grounds: r.grounds == null ? null : String(r.grounds),
    whatItIs: String(r.what_it_is),
    answersRequirement: r.answers_requirement == null ? null : String(r.answers_requirement),
    satisfiedWhen: r.satisfied_when == null ? null : Number(r.satisfied_when),
  }));
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
  /** 'company' for an asset with an offer shape; defaults to the candidate. */
  subjectKind?: 'company' | 'opportunity';
}): Promise<LegalPicture> {
  const surfaces = await legalSurfaceOf(input.subjectKind ?? 'opportunity', input.opportunityId);
  // THE LIGHTER QUESTION LIVES ON THE CANDIDATE. An asset carries the answer
  // its candidate was given, through the lineage it was born with.
  const opp = (await query(
    input.subjectKind === 'company'
      ? `SELECT o.lighter_architecture FROM products p
           JOIN venture_opportunities o ON o.id = p.from_opportunity_id WHERE p.id = ?`
      : 'SELECT lighter_architecture FROM venture_opportunities WHERE id = ?',
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
  const policy = await originationPolicyFor(input.founderId);
  const blockOnUnresolved = policy.some((p) =>
    p.requirement === 'block_on_unresolved_material_uncertainty' && p.treatment === 'require');
  for (const s of surfaces) {
    if (s.needsProfessional) {
      inTheWay.push(`${s.whatItIs} needs somebody qualified to look before this `
        + 'goes further - that is past what I should answer');
    }
    // I COULD NOT RESOLVE WHETHER THIS APPLIES. Under the first-proof policy
    // that blocks exactly as a recognised serious surface does, because
    // proceeding on a question Foundry could not answer is the confidence
    // laundering this pass exists to refuse.
    if (s.standing === 'unresolved_internally' && s.severity !== 'minor' && blockOnUnresolved) {
      inTheWay.push(`I cannot resolve from here whether ${s.whatItIs} applies, and it would `
        + 'be material if it did - that is a question, not a finding, and it stands in the way');
    }
    if (s.stale) inTheWay.push(`what I know about ${s.whatItIs} is over six months old`);
  }

  // THE POLICY, ROW BY ROW, FROM THE FACTS ON RECORD. An unknown fact is a
  // real verdict: at candidate level it does not block, because the offer has
  // no shape yet and guessing would be worse; once an offer shape exists the
  // asset-level pass answers it, and a refused or required row that is still
  // unknown then stands in the way.
  const facts = await structuralFactsOf(input.subjectKind ?? 'opportunity', input.opportunityId);
  const factByRequirement = new Map(facts.filter((f) => f.answersRequirement !== null)
    .map((f) => [String(f.answersRequirement), f]));
  const shaped = input.subjectKind === 'company';
  const policyVerdicts: LegalPicture['policy'] = [];
  for (const row of policy) {
    if (row.treatment === 'policy' || row.requirement === 'block_on_unresolved_material_uncertainty') continue;
    const fact = factByRequirement.get(row.requirement);
    const verdict: 'satisfied' | 'violated' | 'unknown' = fact === undefined || fact.present === null
      ? 'unknown'
      : (fact.present ? 1 : 0) === fact.satisfiedWhen ? 'satisfied' : 'violated';
    policyVerdicts.push({ requirement: row.requirement, treatment: row.treatment, verdict,
      why: row.why, setBy: row.setBy });
    const binding = row.treatment === 'refuse' || row.treatment === 'require';
    if (binding && verdict === 'violated') {
      inTheWay.push(`the first-proof policy ${row.treatment === 'refuse' ? 'refuses' : 'requires'} `
        + `${row.requirement.replace(/_/g, ' ')} (${row.why})`);
    }
    if (binding && verdict === 'unknown' && shaped) {
      inTheWay.push(`whether ${row.requirement.replace(/_/g, ' ')} holds is still unknown, and `
        + 'the offer has a shape now, so that is no longer a question for later');
    }
  }

  const worst = surfaces[0];
  const unresolved = surfaces.filter((s) => s.standing === 'unresolved_internally');
  const profile = surfaces.length === 0
    ? 'Not looked at yet.'
    : `${surfaces.length === 1 ? 'One kind of exposure' : `${String(surfaces.length)} kinds of exposure`}, `
      + `the heaviest ${worst?.severity ?? ''}: ${worst?.whatItCreates ?? ''}.`
      + (unresolved.length > 0
        ? ` ${String(unresolved.length)} of them I could not resolve from here: `
          + `${unresolved.map((s) => s.whatItIs).join('; ')}.`
        : '')
      + (sharedWithPortfolio.length > 0
        ? ` ${String(sharedWithPortfolio[0]?.carriedBy ?? 0)} of your businesses already `
          + `carry ${sharedWithPortfolio[0]?.cls.replace(/_/g, ' ') ?? ''}, so this would `
          + 'be one more thing the same rule change reaches.'
        : '')
      + (lighter ? ` Lighter version: ${lighter}` : '');

  // THE STRONGEST SENTENCE THE EVIDENCE SUPPORTS, AND NEVER STRONGER. This is
  // not "legal risk is low" and it is not a certification. It is recognition,
  // bounded by what was recognised and by what could not be.
  const sentence = surfaces.length === 0
    ? 'I have not yet looked at what legal surface this creates.'
    : surfaces.some((s) => s.needsProfessional)
      ? 'Somebody qualified needs to look before this goes further.'
      : unresolved.some((s) => s.severity !== 'minor')
        ? 'There is a material exposure I cannot resolve from here.'
        : surfaces.every((s) => s.severity === 'minor')
          ? 'No currently recognised material legal surface requires professional review. '
            + 'That is recognition, not certification.'
          : 'There is recognised material exposure; nothing here requires professional review yet.';

  return { surfaces, inTheWay, sharedWithPortfolio, lighter, profile,
    policy: policyVerdicts, sentence };
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

/**
 * THE OWNER SUPERSEDES A ROW OF THE FIRST-PROOF POLICY. His row for the same
 * requirement outranks the institutional default from then on; the default is
 * never edited, so what the institution started from stays on record. Policy,
 * not constitution: the floors in `exposure_floors` cannot be reached this way.
 */
export async function supersedeOriginationPolicy(input: {
  founderId: string; requirement: string; treatment: 'refuse' | 'penalise' | 'prefer' | 'require' | 'policy';
  value?: string | null; why: string; by: string;
}): Promise<{ id: string } | { refused: string }> {
  const def = (await query(
    `SELECT id FROM origination_policy WHERE requirement = ? AND founder_id IS NULL AND superseded_at IS NULL`,
    [input.requirement])).rows[0];
  if (!def) return { refused: `there is no policy row called ${input.requirement} to supersede` };
  if (input.why.trim() === '') return { refused: 'a policy change needs its reason' };
  const id = nanoid();
  try {
    await query(
      `UPDATE origination_policy SET superseded_at = datetime('now'), superseded_by = ?
        WHERE founder_id = ? AND requirement = ? AND superseded_at IS NULL`,
      [input.by, input.founderId, input.requirement]);
    await query(
      `INSERT INTO origination_policy (id, founder_id, requirement, treatment, value, why, set_by)
       VALUES (?,?,?,?,?,?,?)`,
      [id, input.founderId, input.requirement, input.treatment, input.value ?? null,
        input.why.trim(), input.by]);
  } catch (err) {
    return { refused: err instanceof Error ? err.message : String(err) };
  }
  return { id };
}
