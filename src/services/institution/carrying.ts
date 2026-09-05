// =============================================================================
// FOUNDRY — carrying a real responsibility through the whole institutional loop
//
// Everything else in this directory is machinery. This is the first thing that
// USES it end to end, on work that genuinely exists.
//
// THE RESPONSIBILITY IS REAL AND WAS NOT INVENTED FOR THIS. Foundry runs on
// packages other people maintain. When one is abandoned, that is an operational
// risk to a real company — this one — and knowing about it is work somebody has
// to do. `dependency_health_tick` has been doing it daily against the real npm
// registry, forming a real claim and filing real observations for and against
// it. What was missing was everything around the act: nothing resolved WHO was
// acting, nothing derived what consequence the act carried, nothing checked
// whether any standing authority covered it, and nothing ever went back to
// settle the claim it made.
//
// THE LOOP, IN ORDER:
//
//   real responsibility, with evidence it recurs
//     -> the company actor it is performed as
//     -> a proposed act, described by what it does
//     -> consequence derived from the act itself
//     -> current owner policy and standing authority
//     -> covered, or refused and preserved
//     -> the real hand performs it
//     -> the provider's effect verified
//     -> the outcome observed when it is due
//     -> the prior prediction settled
//     -> calibration updated
//
// WHY THE PRIOR RUN'S CLAIM AND NOT THIS ONE'S. A claim settled in the same
// second it was made is not a prediction that survived contact with anything;
// the resolution trigger refuses same-second evidence as ambiguous, and it is
// right to. So each pass settles the claim the LAST pass made, against
// observations that genuinely came later. The institution predicts today and
// finds out tomorrow, which is the only shape in which finding out means
// anything.
//
// AND A REFUSAL IS A RESULT. If nothing covers the act, that is the governance
// working. The prepared work is kept, the reason is recorded, and what remains
// collapses to one decision for the owner — never to a weakened boundary.
// =============================================================================

import { query } from '../../db/client.js';
import { log as logger } from '../../lib/logger.js';

/** What this responsibility is called, everywhere it is referred to. */
export const DEPENDENCY_RESPONSIBILITY = 'keep the dependency list honest';
const ACT_CLASS = 'read a public registry';

export interface CarriedResult {
  responsibility: string;
  /** Whether standing authority covered the act, and which. */
  covered: boolean;
  delegationId: string | null;
  rung: string;
  because: string;
  /** Null when the act was refused — nothing was performed. */
  performed: {
    checked: number; abandoned: string[]; claimId: string;
    providerVerified: boolean; verificationBecause: string;
  } | null;
  /** What the previous run predicted, and how it turned out. */
  settled: { claimId: string; verdict: string; because: string } | null;
  /** What is now standing in the way, if anything, as one owner decision. */
  needsHim: string | null;
}

/**
 * THE INSTITUTION'S OWN IDENTITY.
 *
 * Foundry is a real owner-controlled company and acts as one. It is not a
 * stand-in for the owner, and an act it performs on its own behalf should say
 * so — which is what makes this the same shape as an act performed for any
 * other company in the portfolio.
 */
async function foundryItself(founderId: string): Promise<string> {
  const existing = (await query(
    `SELECT id FROM business_actors
      WHERE founder_id = ? AND product_id IS NULL AND kind = 'company'
        AND retired_at IS NULL ORDER BY rowid LIMIT 1`, [founderId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (existing) return String(existing.id);
  const { nameAnActor } = await import('./acting.js');
  return nameAnActor({
    founderId, productId: null, kind: 'company', displayName: 'Foundry',
    // Not portable: the institution does not transfer with any one asset.
    portable: false,
  });
}

/**
 * CARRY IT, OR SAY EXACTLY WHY NOT.
 */
export async function carryDependencyHealth(
  founderId: string, opts: { root?: string } = {},
): Promise<CarriedResult> {
  const acting = await import('./acting.js');

  // 1. THE RESPONSIBILITY RECURS, and saying so costs him nothing. A schedule
  //    that keeps firing is evidence of recurring work; an institution that
  //    could only learn this by interrupting him would have to interrupt him.
  await acting.noteResponsibilitySignal({
    founderId, productId: null, responsibility: DEPENDENCY_RESPONSIBILITY,
    kind: 'scheduled', ref: 'dependency_health_tick',
  });

  // 2. WHO IS ACTING.
  const actorId = await foundryItself(founderId);

  // 3-5. WHAT THE ACT IS, WHAT IT THEREFORE COSTS, AND WHETHER ANYTHING COVERS IT.
  const verdict = await acting.classifyAndRecord({
    founderId, productId: null, actorId,
    responsibility: DEPENDENCY_RESPONSIBILITY, actClass: ACT_CLASS,
    // The capability, not a door tool: this read never passes the outbound
    // gateway, and naming a tool that is not registered there would make it
    // unclassifiable and therefore refused for the wrong reason.
    capability: 'read_package_registry', tool: 'npm_registry_read',
    externalEffect: 'asks a public registry when each package Foundry runs on '
      + 'was last published',
    // Reading changes nothing and nobody outside can tell it happened.
    reversibility: 'changes_nothing', audience: 'none',
  });

  const settled = await settlePriorClaim(founderId);

  if (!verdict.allowed) {
    // 6. REFUSED, AND THAT IS THE GOVERNANCE WORKING. Nothing is weakened to
    //    produce a result; the reason is kept and what remains is one decision.
    logger.info(
      `carrying ${DEPENDENCY_RESPONSIBILITY}: refused — ${verdict.refusal ?? ''}`,
      { jobName: 'carry_responsibility' });
    return {
      responsibility: DEPENDENCY_RESPONSIBILITY, covered: false,
      delegationId: null, rung: verdict.rung, because: verdict.because,
      performed: null, settled,
      needsHim: 'May I keep asking the package registry when the things I run on '
        + 'were last published? It reads a public page, changes nothing, and tells '
        + 'me when something I depend on has been abandoned.',
    };
  }

  // 7. THE REAL HAND.
  const { checkOwnDependencies, verifyRealEvidenceLanded } = await import(
    './dependency-health.js');
  const health = await checkOwnDependencies({ founderId, root: opts.root });
  if (health === null) {
    return {
      responsibility: DEPENDENCY_RESPONSIBILITY, covered: true,
      delegationId: verdict.delegationId, rung: verdict.rung,
      because: verdict.because, performed: null, settled,
      needsHim: null,
    };
  }

  // 8. WHAT THE PROVIDER ACTUALLY DID, verified rather than assumed. A call
  //    that returned and left no observation behind is a call that did nothing.
  const landed = await verifyRealEvidenceLanded(health.claimId);

  // 9. WHAT IT MEANS OPERATIONALLY. An abandoned dependency is a real finding
  //    about a real company, and the responsibility that follows from it —
  //    replacing the package — is a different act at a higher rung that this
  //    permission does not reach. Said rather than silently attempted.
  const needsHim = health.abandoned.length === 0 ? null
    : `${health.abandoned.length === 1 ? 'A package' : `${String(health.abandoned.length)} packages`} `
      + `I run on ${health.abandoned.length === 1 ? 'has' : 'have'} not been published `
      + `in over eighteen months: ${health.abandoned.join(', ')}. Replacing `
      + `${health.abandoned.length === 1 ? 'it' : 'them'} changes my own software, `
      + 'which is not something reading the registry lets me do.';

  if (needsHim !== null) {
    // The follow-on responsibility is real and recurring too, and it is
    // recorded as prepared-and-unfinished rather than performed.
    await acting.noteResponsibilitySignal({
      founderId, productId: null,
      responsibility: 'replace a package that has been abandoned',
      kind: 'prepared_not_finished',
      ref: `abandoned: ${health.abandoned.join(', ')}`,
    });
  }

  logger.info(
    `carrying ${DEPENDENCY_RESPONSIBILITY}: ${health.sentence}`,
    { jobName: 'carry_responsibility' });

  return {
    responsibility: DEPENDENCY_RESPONSIBILITY, covered: true,
    delegationId: verdict.delegationId, rung: verdict.rung,
    because: verdict.because,
    performed: {
      checked: health.checked, abandoned: health.abandoned,
      claimId: health.claimId, providerVerified: landed.ok,
      verificationBecause: landed.because,
    },
    settled, needsHim,
  };
}

/**
 * 10-11. SETTLE WHAT THE LAST PASS PREDICTED, AND UPDATE THE RECORD.
 *
 * The claim is "every package Foundry runs on is still being maintained". The
 * observations filed against it since say whether that held. A contradiction is
 * a surprise, and a surprise is the useful half — it is the reading that told
 * the institution something it did not already believe.
 */
async function settlePriorClaim(founderId: string): Promise<
  { claimId: string; verdict: string; because: string } | null
> {
  const prior = (await query(
    `SELECT c.id, c.formed_at FROM market_claims c
      WHERE c.founder_id = ? AND c.evidence_mode = 'real'
        AND c.claim = 'Every package Foundry runs on is still being maintained'
        AND NOT EXISTS (
          SELECT 1 FROM prediction_resolutions r
           WHERE r.kind = 'institutional_judgment' AND r.prediction_id = c.id)
      ORDER BY c.formed_at, c.rowid LIMIT 1`, [founderId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!prior) return null;

  const claimId = String(prior.id);
  const formedAt = String(prior.formed_at);

  // Only evidence that genuinely came later may settle it.
  const after = (await query(
    `SELECT
        SUM(CASE WHEN bearing = 'contradicts' THEN 1 ELSE 0 END) AS against_,
        SUM(CASE WHEN bearing = 'supports' THEN 1 ELSE 0 END) AS for_,
        MIN(id) AS an_observation
       FROM market_observations
      WHERE claim_id = ? AND evidence_mode = 'real'
        AND datetime(observed_at) > datetime(?)`, [claimId, formedAt]))
    .rows[0] as Record<string, unknown>;

  const against = Number(after.against_ ?? 0);
  const supporting = Number(after.for_ ?? 0);
  if (against + supporting === 0) return null;

  const verdict = against > 0 ? 'surprised' : 'as_predicted';
  const because = against > 0
    ? `${String(against)} of the packages it runs on had gone quiet, which the claim `
      + 'said would not be so'
    : `every one of the ${String(supporting)} packages checked was still being published`;

  const { resolvePrediction } = await import('./calibration.js');
  const done = await resolvePrediction({
    founderId, kind: 'institutional_judgment', predictionId: claimId,
    resolvedBy: 'later_observation',
    evidenceRef: `market_observation:${String(after.an_observation)}`,
    verdict, because, predictedAt: formedAt,
  });
  if ('refused' in done) return null;
  return { claimId, verdict, because };
}
