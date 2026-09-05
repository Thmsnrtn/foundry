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
    //    produce a result; the reason is kept.
    //
    //    WHAT DOES NOT HAPPEN HERE is an owner question. This used to manufacture
    //    one — "may I keep asking the registry when packages were published" —
    //    which is the wrong shape entirely: a public, free, credential-less read
    //    that changes nothing is ordinary perception, and an institution with
    //    hundreds of eyes would have produced hundreds of those. The eye is
    //    granted once, where one is needed at all; the blink never asks.
    logger.info(
      `carrying ${DEPENDENCY_RESPONSIBILITY}: refused — ${verdict.refusal ?? ''}`,
      { jobName: 'carry_responsibility' });
    return {
      responsibility: DEPENDENCY_RESPONSIBILITY, covered: false,
      delegationId: null, rung: verdict.rung, because: verdict.because,
      performed: null, settled, needsHim: null,
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


// =============================================================================
// "I MAY NOT" AND "I CANNOT" ARE DIFFERENT ANSWERS.
//
// Only one of them is his to decide, and confusing them is how an institution
// starts asking its owner to authorise things that no permission would enable.
//
//   I MAY NOT — the capability exists, a provider is connected, and nothing
//   permits this act. That is an owner decision, and it belongs on his screen.
//
//   I CANNOT — no provider can perform it at all, or the one that exists cannot
//   do the part that matters. That is a CAPABILITY NEED. Putting it to him as a
//   permission would be asking him to authorise something that would still not
//   happen afterwards.
//
// Found by carrying the second real responsibility rather than by reasoning
// about it. Foundry has exactly one consequential hand with a real provider —
// `open_pull_request`, bound to `github_create_pr`, at maturity 'available' —
// and it opens a pull request from a branch that ALREADY EXISTS. It cannot
// create the branch and cannot put anything in it. So the work it would be
// authorised to do could not be completed by the authority being sought.
// =============================================================================

export type WhyNot = 'may_not' | 'cannot';

export interface WhatStandsInTheWay {
  why: WhyNot;
  /** The capability that would have to exist or be permitted. */
  capability: string;
  /** In his words. Only surfaced when this is genuinely his to decide. */
  sentence: string;
  /** True when this belongs on his first screen at all. */
  reachesHim: boolean;
}

/**
 * WHAT IS ACTUALLY STOPPING A RESPONSIBILITY, AND WHOSE PROBLEM IT IS.
 *
 * A capability with no provider at any maturity cannot be authorised into
 * existence, so it is recorded as a need and never reaches him as a question. A
 * capability whose provider exists and whose act nothing covers is a decision,
 * and it does.
 */
export async function whatStandsInTheWayOf(input: {
  founderId: string; responsibility: string; capability: string;
  /** Named when the provider exists but cannot do the part that matters. */
  providerCannot?: string | null;
}): Promise<WhatStandsInTheWay> {
  const provider = (await query(
    `SELECT p.id, p.maturity FROM capability_providers p
      WHERE p.capability_key = ? ORDER BY p.sort_order LIMIT 1`,
    [input.capability])).rows[0] as Record<string, unknown> | undefined;

  const { noteNeed } = await import('./capabilities.js');

  if (!provider) {
    await noteNeed({
      founderId: input.founderId, subjectKind: 'responsibility',
      subjectId: input.responsibility, capabilityKey: input.capability,
      why: `nothing can perform this at all, so no permission would make the work happen`,
    });
    return {
      why: 'cannot', capability: input.capability, reachesHim: false,
      sentence: `Nothing I have can do this yet, so there is nothing to allow.`,
    };
  }

  if (input.providerCannot != null && input.providerCannot !== '') {
    await noteNeed({
      founderId: input.founderId, subjectKind: 'responsibility',
      subjectId: input.responsibility, capabilityKey: input.capability,
      why: input.providerCannot,
    });
    return {
      why: 'cannot', capability: input.capability, reachesHim: false,
      sentence: `What I have cannot do the part that matters: ${input.providerCannot}.`,
    };
  }

  return {
    why: 'may_not', capability: input.capability, reachesHim: true,
    sentence: `I can do this and nothing you have said permits it.`,
  };
}


/** The responsibility this institution has toward its own description. */
export const SNAPSHOT_RESPONSIBILITY = 'keep the description of my own database current';

export interface SnapshotChain {
  responsibility: string;
  /** Whether the description has actually drifted from the migrations. */
  drifted: boolean;
  standing: WhatStandsInTheWay | null;
  /** Present only when something genuinely belongs on his screen. */
  needsHim: string | null;
}

/**
 * THE SECOND REAL RESPONSIBILITY, WHICH HAS A CONSEQUENCE.
 *
 * Reading the registry changes nothing. This one would change software: the
 * file that describes Foundry's own database drifts every time a migration is
 * added, a gate catches it, and somebody regenerates it by hand. That has
 * happened repeatedly and it is real recurring work with a real external effect
 * — a pull request that exists in the world.
 *
 * AND IT STOPS BEFORE THE OWNER, FOR THE RIGHT REASON. `open_pull_request` has a
 * real provider at maturity 'available', and `createPRHandler` opens a pull
 * request from a branch that already exists. Nothing in the institution can
 * create the branch or put the corrected file in it. So the answer is not "may
 * I" — it is "I cannot", and it is recorded as a capability need rather than
 * put to him as a permission that would change nothing if granted.
 *
 * The drift itself is detected from the live database, which is the honest
 * source: what the institution's own schema actually contains, compared with
 * what its description says it contains.
 */
export async function carrySchemaDescription(
  founderId: string,
): Promise<SnapshotChain> {
  const acting = await import('./acting.js');

  // Real recurrence, and it costs him nothing to learn: the work has been
  // prepared and left unfinished every time the description drifted.
  await acting.noteResponsibilitySignal({
    founderId, productId: null, responsibility: SNAPSHOT_RESPONSIBILITY,
    kind: 'prepared_not_finished',
    ref: 'the schema snapshot drifts whenever a migration is added',
  });

  // Has it actually drifted? Asked of the live database rather than assumed —
  // an institution that reported work needing doing without checking would be
  // manufacturing its own recurrence.
  const live = ((await query(
    `SELECT name FROM sqlite_master
      WHERE type IN ('table','view','index','trigger') AND name NOT LIKE 'sqlite_%'`,
    [])).rows as unknown as Array<Record<string, unknown>>).map((r) => String(r.name));

  const described = await (async () => {
    try {
      const { readFile } = await import('node:fs/promises');
      return await readFile('docs/db/schema.snapshot.sql', 'utf8');
    } catch { return null; }
  })();

  // Nothing to say when the description cannot be read at all — that is a
  // deployment fact, not a drift, and reporting it as one would be a guess.
  if (described === null) {
    return { responsibility: SNAPSHOT_RESPONSIBILITY, drifted: false,
      standing: null, needsHim: null };
  }
  const missing = live.filter((n) => !described.includes(n));
  if (missing.length === 0) {
    return { responsibility: SNAPSHOT_RESPONSIBILITY, drifted: false,
      standing: null, needsHim: null };
  }

  const standing = await whatStandsInTheWayOf({
    founderId, responsibility: SNAPSHOT_RESPONSIBILITY,
    capability: 'open_pull_request',
    // The specific thing the existing hand cannot do, named rather than
    // implied, so the capability need says what would actually unblock it.
    providerCannot: 'it opens a pull request from a branch that already exists, '
      + 'and nothing here can create the branch or put the corrected file in it',
  });

  return {
    responsibility: SNAPSHOT_RESPONSIBILITY, drifted: true, standing,
    needsHim: standing.reachesHim ? standing.sentence : null,
  };
}

/**
 * WHAT WAS ACTUALLY READ ABOUT A SUBSTRATE, AND WHERE.
 *
 * A provider must earn the role. Recording the evaluation as rows rather than
 * as a decision means the choice can be checked later against what was actually
 * published, and revisited when the contract changes — which for a young
 * product it will.
 *
 * Deliberately findings rather than a verdict. "Sprites are the answer" is a
 * claim; "the API is at api.sprites.dev, exec is a POST, the filesystem is
 * durable, the network policy is enforced at packet level and code inside can
 * read it but never change it" are things somebody can go and check.
 */
export async function noteSubstrateEvaluation(input: {
  substrate: string;
  findings: Array<{ property: string; finding: string; source: string }>;
}): Promise<void> {
  for (const f of input.findings) {
    await query(
      `INSERT OR REPLACE INTO substrate_evaluations
         (id, substrate, property, finding, source)
       VALUES (?,?,?,?,?)`,
      [`${input.substrate}:${f.property}`, input.substrate, f.property,
        f.finding.trim(), f.source.trim()]);
  }
}

export interface SubstrateStanding {
  substrate: string;
  isolation: string;
  /** Whether a real change to software may be produced there at all. */
  mayProduceChanges: boolean;
  /** Whether an adapter exists that can actually run a step. */
  canRunAStep: boolean;
  findings: Array<{ property: string; finding: string; source: string }>;
}

/**
 * WHICH COMPUTERS THE INSTITUTION COULD ACTUALLY USE.
 *
 * Two independent facts per substrate, and confusing them is how a capability
 * comes to be believed available when nothing can run on it: whether the
 * isolation permits producing a change, and whether an adapter exists that can
 * execute a step. `fly_machines` passes the first and fails the second — its
 * `run` throws by design, because the exec semantics were never settled.
 */
export async function whichComputersCouldWork(): Promise<SubstrateStanding[]> {
  const subs = ((await query(
    `SELECT s.substrate, s.isolation, COALESCE(i.may_produce, 0) AS may
       FROM workspace_substrates s
       LEFT JOIN change_production_isolation i ON i.isolation = s.isolation
      ORDER BY s.sort_order`, []))
    .rows as unknown as Array<Record<string, unknown>>);

  const out: SubstrateStanding[] = [];
  for (const s of subs) {
    const name = String(s.substrate);
    const findings = ((await query(
      `SELECT property, finding, source FROM substrate_evaluations
        WHERE substrate = ? ORDER BY property`, [name]))
      .rows as unknown as Array<Record<string, unknown>>).map((f) => ({
      property: String(f.property), finding: String(f.finding),
      source: String(f.source),
    }));
    // An adapter that exists is not the same as one that can run a step, and
    // this is read from the evaluation rather than assumed from the file
    // existing — `fly-machines.ts` is a complete file whose `run` throws.
    const runs = findings.find((f) => f.property === 'can run a step');
    out.push({
      substrate: name, isolation: String(s.isolation),
      mayProduceChanges: Number(s.may) === 1,
      canRunAStep: runs !== undefined && runs.finding.startsWith('yes'),
      findings,
    });
  }
  return out;
}
