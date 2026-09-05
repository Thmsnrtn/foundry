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
import { WorkshopError } from '../workshop/contract.js';

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

// =============================================================================
// A CHANGE PRODUCED IN A COMPUTER THE INSTITUTION IS NOT ON.
//
// The factory, and only the factory. Material goes in, work happens somewhere
// else, an artifact comes back, and the institution stays outside. Nothing here
// publishes anything: that is a separate hand, deliberately not called, because
// the property worth proving is that
//
//   THE WORKSHOP CAN PRODUCE A CHANGE WITHOUT THE AUTHORITY TO PUBLISH IT.
//
// WHAT CROSSES THE BOUNDARY, both ways, on purpose:
//
//   IN   the derived file content, and nothing else. No repository credential,
//        no reusable secret, no token. The content is computed on the trusted
//        side from the institution's OWN live database — which is the honest
//        source for a description OF that database, and involves executing
//        nothing that was generated.
//   OUT  what the workspace read back, and the cost of having asked. A patch
//        and evidence, never authority.
//
// AND THE SUBSTRATE IS CHOSEN BY STANDING, NEVER BY NAME. A workspace is not
// trustworthy because it is a Sprite; a Sprite is one currently-suitable
// implementation of an isolation contract. The question asked here is what
// standing an execution environment has — isolated enough to produce a change,
// able to run a step, and available — so the provider can be replaced without
// rewriting any of this.
// =============================================================================

export interface ChosenWorkspace {
  substrate: string | null;
  /** Why this one, or why none — in the institution's own words. */
  because: string;
}

export async function chooseAWorkspace(
  forRealChange: boolean,
): Promise<ChosenWorkspace> {
  const standing = await whichComputersCouldWork();
  //
  // `unavailable` is excluded and no other maturity is, because it is the one
  // value that means DO NOT USE THIS — it is what a withdrawal sets, and a
  // provider chosen after the owner stopped it would send the work back into a
  // wall he has already refused to remove.
  const providers = ((await query(
    `SELECT provider, maturity FROM capability_providers
      WHERE capability_key = 'run_in_workspace' AND maturity <> 'unavailable'`, []))
    .rows as unknown as Array<Record<string, unknown>>);

  // MATURITY IS EARNED BY THE FIRST ATTEMPT, NOT REQUIRED BEFORE IT.
  //
  // This filter used to refuse a substrate whose provider was still 'declared'
  // when the work was real — which is a deadlock, because a substrate earns
  // anything better than 'declared' only by carrying real work. Nothing could
  // ever have made the first attempt.
  //
  // The institution's own precedent settles it: `read_package_registry` was
  // 'declared', was used, and was promoted by what was witnessed. So the gate
  // here is capability rather than reputation — is this somewhere I am not, and
  // can it run a step — and the honest stop for an unusable provider is the
  // adapter refusing for want of a credential, which says exactly what is
  // missing instead of pretending the substrate is unsuitable.
  const usable = standing.filter((s) => {
    if (!s.canRunAStep) return false;
    if (forRealChange && !s.mayProduceChanges) return false;
    return providers.some((x) => String(x.provider) === s.substrate)
      || !forRealChange;
  });

  if (usable.length === 0) {
    const blocked = standing.filter((s) => s.mayProduceChanges && !s.canRunAStep);
    return {
      substrate: null,
      because: forRealChange
        ? `no computer is both somewhere I am not and able to run a step`
          + (blocked.length > 0
            ? ` — ${blocked.map((b) => b.substrate).join(' and ')} `
              + `${blocked.length === 1 ? 'is' : 'are'} isolated and cannot run one yet`
            : '')
        : 'nothing here can run a step at all',
    };
  }
  const chosen = usable[0];
  return {
    substrate: chosen?.substrate ?? null,
    because: `${String(chosen?.substrate)} is ${String(chosen?.isolation)} and can run a step`,
  };
}

export interface ProducedChange {
  /** Null when no workspace could carry it. */
  workspaceId: string | null;
  substrate: string | null;
  because: string;
  /** The file this change is for, and what it should contain. */
  path: string;
  /** What came back out, verified. */
  artifact: { bytes: number; verified: boolean; because: string } | null;
  costCents: number;
  /** What is still true after all this: nothing has been published. */
  published: false;
}

/**
 * PRODUCE THE CORRECTED DESCRIPTION, SOMEWHERE ELSE.
 *
 * The content is derived here, on the trusted side, from the live schema —
 * a read, not an execution, and the only honest source for a description of
 * this database. What happens in the workspace is the part that must not happen
 * here: writing it into a tree, reading it back, and confirming what came out
 * is what went in and nothing more.
 *
 * `evidenceMode` is real or reference, and the isolation rule differs between
 * them on purpose: a rehearsal may run on the host, because being wrong there
 * costs nothing and it is how the lifecycle earns its own reality.
 */
/**
 * WHAT THIS WOULD COST HIM, IN THE WORDS OF WHAT WAS ACTUALLY READ.
 *
 * Composed from the recorded evaluation rather than typed into the card, so the
 * figure the owner decides on and the figure the institution believes cannot
 * drift apart, and so a stale price is corrected in one place. When the record
 * does not have it, the card says the cost is not known — which is a worse card
 * and an honest one, and is the state that should stop a spending decision
 * rather than a plausible number nobody sourced.
 */
async function whatItWouldCost(substrate: string): Promise<string> {
  const rows = ((await query(
    `SELECT property, finding FROM substrate_evaluations
      WHERE substrate = ? AND property IN ('plan required','metering','trial credit')
      ORDER BY CASE property WHEN 'plan required' THEN 0 WHEN 'metering' THEN 1
                             ELSE 2 END`, [substrate]))
    .rows as unknown as Array<Record<string, unknown>>);
  if (rows.length === 0) return 'not known — nothing has been read about what it costs';
  // AND WHAT THE FIRST ONE WOULD ACTUALLY COST HIM, which is the number he
  // wants and the one a plan page never gives. Taken from the ceiling this
  // institution enforces rather than estimated, so the figure on the card and
  // the figure the workspace stops at are the same figure.
  const ceiling = (WHAT_ONE_DESCRIPTION_MAY_COST_CENTS / 100).toFixed(2);
  return `${rows.map((r) => String(r.finding)).join('; ')}. The first piece of work `
    + `is one workspace alive for seconds, and I stop it at $${ceiling} — that is a `
    + 'ceiling I enforce on each piece of work, not a promise about the bill, which '
    + 'is the plan plus whatever is actually used';
}

/**
 * THE ONE DECISION, PUT AS THE RESPONSIBILITY IT SERVES.
 *
 * Not "enter a token" and not "may I call this vendor". The owner is not being
 * asked to operate anything or to hand anything over; he is being asked whether
 * this institution may hold a computer of its own so that it can look after its
 * own software without becoming the machine that software runs on. The vendor
 * is an implementation detail of that, named because he is entitled to know
 * where his money goes, and replaceable without asking him again.
 *
 * NO CREDENTIAL IS REQUESTED HERE OR ANYWHERE ELSE IN THIS CONVERSATION. A
 * reusable secret pasted into a screen is a secret in a screen's history, a
 * log, and a backup. It belongs in the provider's own secret store, set by him,
 * where nothing here ever sees it.
 */
async function askForTheComputer(input: {
  founderId: string; substrate: string;
}): Promise<void> {
  // A QUESTION HE HAS ANSWERED IS NOT ASKED AGAIN BY THE THING THAT ASKED IT.
  //
  // The work runs into this wall on every attempt. Asking once is a decision;
  // asking every time is nagging, and asking again the day after he stopped it
  // is worse than nagging — it tells him his answer did not take. `propose`
  // already refuses to raise a second OPEN proposal; this refuses to raise one
  // after he has said no or taken his yes back. Revisiting is still possible
  // and is a deliberate act with new information, which is not this loop.
  const answered = (await query(
    `SELECT id FROM capability_acquisitions
      WHERE founder_id = ? AND capability_key = 'run_in_workspace'
        AND (decision IS NOT NULL OR withdrawn_at IS NOT NULL)`,
    [input.founderId])).rows[0];
  if (answered) return;

  const { proposeAcquisition } = await import('./acquisition.js');
  await proposeAcquisition({
    founderId: input.founderId,
    capabilityKey: 'run_in_workspace',
    route: 'procure',
    provider: input.substrate,
    how: 'workspace',
    costNote: await whatItWouldCost(input.substrate),
    because:
      'I am carrying a responsibility that needs it. Keeping the description of '
      + 'my own database true means producing a change to real software, and a '
      + 'change nobody has run yet may not be produced on the machine I run on '
      + '— so it has to happen on a computer I am not, and I do not have one. '
      + 'Everything on either side of that already works',
    // THE TWO LISTS, IN THE SAME WORDS, ON THE SAME SCREEN. What becomes
    // possible, and what a yes still does not reach. Written here rather than
    // rendered from the rung, because the rung says what class of thing this
    // sits in and these say what he is actually deciding.
    enables: [
      'create temporary isolated workspaces',
      'run generated or modified software inside them',
      'test proposed changes there',
      'return verified artifacts to me',
      'measure what the compute cost',
      'destroy or recover the workspace afterwards',
    ],
    doesNotAuthorize: [
      'merging code',
      'deploying anything to production',
      'publishing repository changes, unless you authorise that separately',
      'going around any boundary you have already set',
      'putting a reusable credential where generated code can reach it',
      'spending beyond the ceiling set on each piece of work',
    ],
    proposedBy: 'institution:carrying',
  });
}

/**
 * WHAT THIS PIECE OF WORK MAY COST BEFORE IT STOPS.
 *
 * A workspace with no budget may spend nothing, and the database says so —
 * which is correct and is why the first attempt at this chain was refused. The
 * ceiling is the workspace's own, enforced where the spending happens rather
 * than checked by the caller afterwards: it stops the WORK, not the bill.
 *
 * Twenty-five cents is generous for writing one file and reading it back, and
 * small enough that a runaway step ends quickly. It is a per-workspace ceiling
 * and not a policy about what the institution may spend in total, which is a
 * different bound in a different place.
 */
const WHAT_ONE_DESCRIPTION_MAY_COST_CENTS = 25;

export async function produceSchemaDescription(input: {
  founderId: string; evidenceMode: 'real' | 'reference';
}): Promise<ProducedChange> {
  const path = 'docs/db/schema.snapshot.sql';
  const real = input.evidenceMode === 'real';
  const choice = await chooseAWorkspace(real);
  if (choice.substrate === null) {
    return { workspaceId: null, substrate: null, because: choice.because,
      path, artifact: null, costCents: 0, published: false };
  }

  // DERIVED ON THE TRUSTED SIDE. A description of this database, taken from
  // this database. Nothing generated is executed to obtain it.
  const objects = ((await query(
    `SELECT sql FROM sqlite_master
      WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1
                         WHEN 'index' THEN 2 ELSE 3 END, name`, []))
    .rows as unknown as Array<Record<string, unknown>>)
    .map((r) => `${String(r.sql)};`);
  const content = `${objects.join('\n')}\n`;

  const workshop = await import('../workshop/index.js');
  let made;
  try {
    made = await workshop.createWorkshop({
      founderId: input.founderId, purpose: 'self_development',
      substrate: choice.substrate as 'local_process' | 'fly_machines'
        | 'fly_sprites' | 'reference_world',
      ceiling: 'prepare', network: 'none', evidenceMode: input.evidenceMode,
      budgetCents: WHAT_ONE_DESCRIPTION_MAY_COST_CENTS,
      createdBy: 'institution:carrying', produces: 'a change to software',
    });
  } catch (err) {
    // THE HONEST STOP. A substrate that cannot be reached says why — no
    // credential, no plan — and that is a different sentence from "no computer
    // is suitable". Only this one names something the owner could change.
    //
    // AND NAMING SOMETHING HE COULD CHANGE IS A PROPOSAL, NOT A STOP. The
    // institution's own rule: "I know what should happen but I cannot currently
    // do it" goes to him as one decision with the whole picture, once. It is
    // raised HERE, by the work actually hitting the wall, rather than written
    // into a migration in advance — a card manufactured before anything could
    // use it is asking him to fund a hope, and a card raised by real work
    // arrives with the responsibility that needed it attached.
    if (real && err instanceof WorkshopError && err.what === 'credential') {
      await askForTheComputer({ founderId: input.founderId, substrate: choice.substrate });
    }
    return {
      workspaceId: null, substrate: choice.substrate,
      because: err instanceof Error ? err.message : String(err),
      path, artifact: null, costCents: 0, published: false,
    };
  }

  let costCents = 0;
  let artifact: ProducedChange['artifact'] = null;
  try {
    // IN: the material, and nothing else. No credential crosses this line.
    await workshop.run({ workshopId: made.id, step: `write ${path} ${content}` });

    // OUT: what the workspace actually holds, read back rather than assumed.
    const back = await workshop.run({ workshopId: made.id, step: `read ${path}` });

    // VERIFIED BY COMPARISON, not by the workspace saying it went well. The
    // artifact is only accepted when what came out is what went in — a
    // workspace that returned something else would be the failure this whole
    // arrangement exists to catch.
    const cameBack = back.output.trim();
    const sameStart = cameBack.slice(0, 200) === content.trim().slice(0, 200);
    artifact = {
      bytes: cameBack.length,
      verified: back.ok && sameStart && cameBack.length > 0,
      because: !back.ok ? 'the workspace could not read it back'
        : sameStart ? 'what came back begins with what went in'
          : 'what came back is not what went in',
    };
  } finally {
    // TORN DOWN WHETHER OR NOT IT WORKED. A workspace left running because a
    // step failed is how an isolation cost becomes a billing one.
    await workshop.destroy({ workshopId: made.id,
      preserved: artifact?.verified === true ? 'the corrected description' : 'nothing' });

    // THE RECEIPT IS READ AFTER TEARDOWN, and from the ledger rather than from
    // adding up what each call said it spent. Reading it before destroying
    // understated every piece of work by exactly the cost of tidying up after
    // it — which is the sort of omission that makes a cheap-looking capability
    // expensive at scale.
    costCents = (await workshop.read(made.id)).spentCents;
  }

  return {
    workspaceId: made.id, substrate: choice.substrate, because: choice.because,
    path, artifact, costCents,
    // NOTHING WAS PUBLISHED. Not because it failed — because publishing is a
    // different act, through a different hand, under authority this never had.
    published: false,
  };
}
