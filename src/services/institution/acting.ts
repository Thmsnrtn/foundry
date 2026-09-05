// =============================================================================
// FOUNDRY — the act carries its own consequence, and the company its own name
//
// This is the machinery that lets the institution hold real responsibility
// instead of asking the owner about every ordinary act. Three ideas, and the
// order of them matters.
//
// CONSEQUENCE BELONGS TO THE ACT. A browser click, an API call and a shell
// command that produce the same effect in the world are the same institutional
// act and must meet the same rule. So the rung is computed from what the act
// DOES — who it reaches, whether it can be undone, what it costs — and is never
// lower than the rung its capability already carries. Attributes can only ever
// raise it.
//
// THE COMPANY ACTS, NOT THE OWNER. An institution whose every asset speaks as
// its owner is one whose assets cannot be sold: the buyer cannot take the
// support inbox or the marketplace account, because all of it was him.
//
// CALIBRATION INFORMS AUTHORITY. IT DOES NOT CREATE IT.
//
// This is the line that must not be crossed, and it would be easy to cross by
// accident. Nothing in this file reads a hit rate and widens what is permitted.
// A record can make a delegation ELIGIBLE, RECOMMENDED or UNWISE — a sentence
// the owner reads before deciding — and the delegation itself is his act. An
// institution that promoted its own authority because its score improved would
// be creating autonomy by removing governance, which is precisely the thing
// this whole apparatus exists to refuse.
// =============================================================================

import { nanoid } from 'nanoid';
import { query, realCompany } from '../../db/client.js';
import type { Rung } from './consequence.js';

/**
 * A READ CHANGES NOTHING, which is not the same as being easy to undo. The
 * lowest of the other three still describes an act that DID something and could
 * be put back; looking at a public page does not belong on that scale.
 */
export type Reversibility = 'changes_nothing' | 'reversible' | 'recoverable'
  | 'irreversible';
export type Audience = 'none' | 'owned_surface' | 'existing_customer'
  | 'prospect' | 'public' | 'counterparty';

export interface ActDescription {
  founderId: string;
  productId?: string | null;
  /** What responsibility this act is part of. A delegation covers a
   *  responsibility, never a shape of act. */
  responsibility?: string | null;
  actClass?: string | null;
  tool: string;
  /** What actually happens outside, in one sentence. */
  externalEffect: string;
  reversibility: Reversibility;
  audience: Audience;
  moneyCents?: number;
  /** How many of these are being done, where a volume changes the consequence. */
  volume?: number;
  actorId?: string | null;
}

export interface ActVerdict {
  rung: Rung;
  /** Why it stands there, naming the attribute that raised it. */
  because: string;
  /** The delegation that covers it, when one does. */
  delegationId: string | null;
  allowed: boolean;
  /** In his words, when it is not allowed. */
  refusal: string | null;
}

/**
 * WHAT RUNG DOES THIS ACT STAND ON?
 *
 * The highest floor any of its attributes implies, and never below the rung its
 * capability already carries. Attributes raise; they never lower. A tool bound
 * to nothing is refused outright, as it already is at the door.
 */
export async function rungOfAct(act: ActDescription): Promise<{
  rung: Rung; because: string;
} | { refused: string }> {
  const rungs = ((await query(
    'SELECT rung, sort_order, absorbable FROM consequence_rungs', []))
    .rows as unknown as Array<Record<string, unknown>>)
    .reduce<Record<string, number>>((acc, r) => {
    acc[String(r.rung)] = Number(r.sort_order);
    return acc;
  }, {});

  const { rungOfTool } = await import('./consequence.js');
  const facts = await rungOfTool(act.tool);
  if (!facts) {
    return { refused: `nothing says what consequence '${act.tool}' has, so it may not act` };
  }

  const floors = ((await query(
    `SELECT dimension, value, floor_rung, why FROM act_consequence_floors
      WHERE (dimension = 'reversibility' AND value = ?)
         OR (dimension = 'audience' AND value = ?)`,
    [act.reversibility, act.audience]))
    .rows as unknown as Array<Record<string, unknown>>);

  let rung: Rung = facts.rung;
  let because = `the capability itself: ${facts.whatItMeans}`;
  for (const f of floors) {
    const candidate = String(f.floor_rung) as Rung;
    if ((rungs[candidate] ?? 0) > (rungs[rung] ?? 0)) {
      rung = candidate;
      because = `${String(f.dimension)} is ${String(f.value)} — ${String(f.why)}`;
    }
  }

  // MONEY IS AN ATTRIBUTE LIKE ANY OTHER. An act that moves the owner's money is
  // at least financial however harmless the tool that moves it looks.
  const money = act.moneyCents ?? 0;
  if (money > 0 && (rungs.financial ?? 0) > (rungs[rung] ?? 0)) {
    rung = 'financial';
    because = `it spends $${(money / 100).toFixed(2)}`;
  }

  return { rung, because };
}

/**
 * MAY THIS ACT PROCEED, AND UNDER WHOSE STANDING AUTHORITY?
 *
 * A live delegation covers it only when every one of its bounds holds: the
 * company, the rung, the audience, the daily volume, the daily money, the
 * expiry — and no breaker tripped. A single failing bound means no cover, and
 * the act falls back to the ordinary door, which asks him.
 *
 * Nothing here consults a hit rate.
 */
export async function authorityForAct(act: ActDescription): Promise<ActVerdict> {
  const judged = await rungOfAct(act);
  if ('refused' in judged) {
    return { rung: 'observe', because: judged.refused, delegationId: null,
      allowed: false, refusal: judged.refused };
  }
  const { rung, because } = judged;

  const rungs = ((await query(
    'SELECT rung, sort_order, absorbable FROM consequence_rungs', []))
    .rows as unknown as Array<Record<string, unknown>>);
  const order = (r: string): number =>
    Number(rungs.find((x) => String(x.rung) === r)?.sort_order ?? 0);
  const absorbable = Number(
    rungs.find((x) => String(x.rung) === rung)?.absorbable ?? 0) === 1;

  // TWO RUNGS ARE NEVER ABSORBED, and this is where that has to hold hardest:
  // standing authority is exactly the mechanism by which they would be.
  if (!absorbable) {
    return {
      rung, because, delegationId: null, allowed: false,
      refusal: 'this cannot be covered by any standing permission — it is yours '
        + 'to decide each time, and that is deliberate',
    };
  }

  const live = ((await query(
    `SELECT d.id, d.class, d.responsibility, d.act_class, d.ceiling, d.audience,
            d.max_acts_per_day, d.max_cents_per_day, d.excludes
       FROM delegations d
      WHERE d.founder_id = ? AND d.revoked_at IS NULL
        AND (d.expires_at IS NULL OR datetime(d.expires_at) > datetime('now'))
        AND (d.product_id IS ? OR d.product_id IS NULL)
      ORDER BY d.granted_at DESC`,
    [act.founderId, act.productId ?? null]))
    .rows as unknown as Array<Record<string, unknown>>);

  for (const d of live) {
    if (order(String(d.ceiling)) < order(rung)) continue;
    if (String(d.audience) !== act.audience) continue;
    // THE RESPONSIBILITY HAS TO MATCH, not merely the company, the audience and
    // the rung. A support reply and a promotional message to the same customer
    // share all three and are not the same permission.
    if (String(d.responsibility) !== (act.responsibility ?? '')) continue;
    if (String(d.act_class) !== (act.actClass ?? '')) continue;

    const tripped = (await query(
      `SELECT id FROM delegation_breakers
        WHERE delegation_id = ? AND tripped_at IS NOT NULL AND cleared_at IS NULL
        LIMIT 1`, [String(d.id)])).rows[0];
    if (tripped) {
      return {
        rung, because, delegationId: null, allowed: false,
        refusal: `I stopped doing this: a limit on "${String(d.class)}" was reached `
          + 'and only you can start it again',
      };
    }

    const today = (await query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(money_cents),0) AS c
         FROM act_classifications
        WHERE delegation_id = ? AND allowed = 1
          AND date(classified_at) = date('now')`, [String(d.id)]))
      .rows[0] as Record<string, unknown>;

    const capActs = d.max_acts_per_day == null ? null : Number(d.max_acts_per_day);
    const capCents = d.max_cents_per_day == null ? null : Number(d.max_cents_per_day);
    if (capActs !== null && Number(today.n) + 1 > capActs) continue;
    if (capCents !== null && Number(today.c) + (act.moneyCents ?? 0) > capCents) continue;

    return { rung, because, delegationId: String(d.id), allowed: true, refusal: null };
  }

  return {
    rung, because, delegationId: null, allowed: false,
    refusal: 'nothing you have said covers this, so I am asking',
  };
}

/**
 * CLASSIFY, DECIDE, AND WRITE DOWN WHAT WAS DECIDED.
 *
 * The record is the point. An act that proceeded under a delegation and left no
 * trace of which one, or on what grounds, is an act nobody can later audit — and
 * standing authority without an audit trail is how governance quietly stops
 * meaning anything.
 */
export async function classifyAndRecord(act: ActDescription): Promise<ActVerdict> {
  const verdict = await authorityForAct(act);
  await query(
    `INSERT INTO act_classifications
       (id, founder_id, product_id, actor_id, delegation_id, tool, reversibility,
        audience, external_effect, money_cents, rung, because, allowed,
        responsibility, act_class)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [nanoid(), act.founderId, act.productId ?? null, act.actorId ?? null,
      verdict.delegationId, act.tool, act.reversibility, act.audience,
      act.externalEffect.trim(), act.moneyCents ?? 0, verdict.rung,
      verdict.because, verdict.allowed ? 1 : 0,
      act.responsibility ?? null, act.actClass ?? null]);

  // A REFUSAL FOR WANT OF COVER IS EVIDENCE THAT THE WORK RECURS — and it is
  // the only kind of evidence that cost him something, so it is recorded rather
  // than sought. Nothing here creates an interruption to qualify a proposal.
  if (!verdict.allowed && verdict.delegationId === null
      && (act.responsibility ?? '') !== ''
      && verdict.refusal === 'nothing you have said covers this, so I am asking') {
    await noteResponsibilitySignal({
      founderId: act.founderId, productId: act.productId ?? null,
      responsibility: String(act.responsibility),
      kind: 'refused_for_authority', ref: act.externalEffect.trim(),
    });
  }
  return verdict;
}

/**
 * A COUNTED FACT THE WORLD PRODUCED.
 *
 * Trips a breaker when the threshold is met inside its window. Never called by
 * the thing being bounded deciding it has gone too far — the caller reports a
 * fact (a bounce, a complaint, a provider rejection) and the arithmetic here
 * decides.
 */
export async function noteCountedFact(input: {
  delegationId: string; fact: string; ref: string;
}): Promise<{ tripped: boolean }> {
  const breaker = (await query(
    `SELECT id, window_minutes, threshold FROM delegation_breakers
      WHERE delegation_id = ? AND counted_fact = ? AND tripped_at IS NULL`,
    [input.delegationId, input.fact])).rows[0] as Record<string, unknown> | undefined;
  if (!breaker) return { tripped: false };

  await query(
    `INSERT INTO act_classifications
       (id, founder_id, tool, reversibility, audience, external_effect,
        rung, because, allowed, product_id)
     SELECT ?, d.founder_id, ?, 'reversible', 'none', ?, 'observe',
            'a fact the world produced, counted against a limit', 0, d.product_id
       FROM delegations d WHERE d.id = ?`,
    [nanoid(), `counted:${input.fact}`, input.ref, input.delegationId]);

  const seen = (await query(
    `SELECT COUNT(*) AS n FROM act_classifications
      WHERE tool = ? AND allowed = 0
        AND datetime(classified_at) > datetime('now', ?)`,
    [`counted:${input.fact}`, `-${String(Number(breaker.window_minutes))} minutes`]))
    .rows[0] as Record<string, unknown>;

  if (Number(seen.n) < Number(breaker.threshold)) return { tripped: false };

  await query(
    `UPDATE delegation_breakers SET tripped_at = datetime('now'), tripped_by = ?
      WHERE id = ? AND tripped_at IS NULL`, [input.ref, String(breaker.id)]);
  return { tripped: true };
}

export interface DelegationAdvice {
  eligible: boolean;
  recommended: boolean;
  /** The sentence he reads before deciding. Never a decision. */
  sentence: string;
}

/**
 * WHETHER A RECORD MAKES A DELEGATION WORTH CONSIDERING.
 *
 * This returns ADVICE and nothing else. It cannot grant, widen, or renew
 * anything — there is deliberately no code path from here to a row in
 * `delegations`, because "the score improved so the permission grew" is the
 * failure mode standing authority exists in tension with.
 *
 * HOW MUCH EVIDENCE IS ENOUGH DEPENDS ON THE CONSEQUENCE. Eight successful
 * low-consequence corrections mean something; eight successes in a class that
 * can cost real money or reach a stranger mean very little. So the bar is a
 * function of the ceiling rather than one number for everything.
 */
export async function adviceOnDelegating(input: {
  founderId: string; ceiling: Rung; responsibility?: string | null;
  kind?: 'venture_experiment' | 'proposed_act';
}): Promise<DelegationAdvice> {
  // THE PRINCIPLE IS CONSTITUTIONAL. THE NUMBERS ARE NOT.
  //
  // What must never move: the evidence required before recommending a broader
  // delegation scales with the responsibility and its downside — failure cost,
  // reversibility, blast radius, economic exposure, volume, variance, novelty,
  // and how much of the record was settled by the world rather than by his
  // agreement with it. Two acts on the same rung can need radically different
  // evidence.
  //
  // What may move: every number below. They are conservative present policy in
  // a table the owner can supersede, not truths about the world.
  const policy = (await query(
    `SELECT min_graded, min_from_world, max_surprise_bp FROM delegation_evidence_policy
      WHERE founder_id = ? AND ceiling = ? AND superseded_at IS NULL
        AND (responsibility IS NULL OR responsibility = ?)
      ORDER BY responsibility IS NULL, set_at DESC LIMIT 1`,
    [input.founderId, input.ceiling, input.responsibility ?? null]))
    .rows[0] as Record<string, unknown> | undefined;

  const absorbable = (await query(
    'SELECT absorbable FROM consequence_rungs WHERE rung = ?', [input.ceiling]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!absorbable || Number(absorbable.absorbable) !== 1) {
    return { eligible: false, recommended: false,
      sentence: 'No amount of good history makes this delegable. Acts on this rung '
        + 'stay yours, one at a time.' };
  }
  if (!policy) {
    return { eligible: false, recommended: false,
      sentence: `Nothing says how much evidence a ${input.ceiling} responsibility `
        + 'should take before I suggest handling it routinely, so I am not suggesting it.' };
  }

  const needed = Number(policy.min_graded);
  const neededFromWorld = Number(policy.min_from_world);
  const maxSurpriseBp = Number(policy.max_surprise_bp);

  const { howOftenRight } = await import('./calibration.js');
  const record = await howOftenRight(input.founderId, input.kind);
  const surpriseBp = record.graded === 0 ? 10_000
    : Math.round((record.surprised / record.graded) * 10_000);

  if (record.graded < needed || record.settledByTheWorld < neededFromWorld) {
    return { eligible: false, recommended: false,
      sentence: `I have been graded ${String(record.graded)} times on this, `
        + `${String(record.settledByTheWorld)} settled by what actually happened. For `
        + `something at the ${input.ceiling} rung the policy asks for `
        + `${String(needed)} and ${String(neededFromWorld)} before I suggest you let `
        + 'me do it routinely.' };
  }
  const clean = surpriseBp <= maxSurpriseBp;
  return {
    eligible: true,
    recommended: clean,
    sentence: `I have handled this ${String(record.graded)} times, `
      + `${String(record.settledByTheWorld)} settled by what actually happened, and was `
      + `wrong ${String(record.surprised)} times. `
      + (clean ? 'I think this is worth allowing routinely, within limits.'
        : 'I would not suggest allowing this routinely yet — I have been wrong too often.'),
  };
}

/**
 * WHAT SIGNALS THAT A RESPONSIBILITY RECURS.
 *
 * Written by whatever noticed. A refusal for want of authority is one kind and
 * was briefly the only kind, which made owner attention the price of learning
 * that work recurs — an institution that could only discover it should stop
 * interrupting him by interrupting him three times first.
 */
/**
 * THE STARTING BAR, WHICH IS POLICY AND SAYS SO.
 *
 * The same numbers migration 264 seeds, in one place so the two cannot drift.
 * Every one of them is a present judgment the owner may supersede; what is
 * durable is the shape — more evidence for more consequence, most of it settled
 * by what happened rather than by agreeing in hindsight.
 *
 * The two non-absorbable rungs are absent rather than set high. No bar exists
 * for them because no amount of evidence makes them delegable, and a large
 * number would imply that one eventually would.
 */
export const STARTING_EVIDENCE_POLICY: Record<string, {
  minGraded: number; minFromWorld: number; maxSurpriseBp: number;
}> = {
  observe: { minGraded: 3, minFromWorld: 1, maxSurpriseBp: 3300 },
  prepare: { minGraded: 3, minFromWorld: 1, maxSurpriseBp: 3300 },
  reversible: { minGraded: 8, minFromWorld: 4, maxSurpriseBp: 2500 },
  public: { minGraded: 20, minFromWorld: 12, maxSurpriseBp: 1500 },
  financial: { minGraded: 40, minFromWorld: 30, maxSurpriseBp: 1000 },
};

export async function seedStartingPolicy(founderId: string): Promise<void> {
  for (const [ceiling, bar] of Object.entries(STARTING_EVIDENCE_POLICY)) {
    await query(
      `INSERT OR IGNORE INTO delegation_evidence_policy
         (id, founder_id, ceiling, min_graded, min_from_world, max_surprise_bp,
          why, set_by)
       VALUES (?,?,?,?,?,?,?,'institution:starting_policy')`,
      [`evp_${founderId}_${ceiling}`, founderId, ceiling, bar.minGraded,
        bar.minFromWorld, bar.maxSurpriseBp,
        'conservative starting policy, not a truth about the world: more evidence '
        + 'for more consequence, and most of it settled by what happened rather '
        + 'than by agreeing in hindsight']);
  }
}

export async function noteResponsibilitySignal(input: {
  founderId: string; productId?: string | null; responsibility: string;
  kind: 'refused_for_authority' | 'recurring_queue' | 'scheduled'
    | 'prepared_not_finished' | 'owner_intent';
  ref: string;
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO responsibility_signals
       (id, founder_id, product_id, responsibility, kind, ref)
     VALUES (?,?,?,?,?,?)`,
    [id, input.founderId, input.productId ?? null, input.responsibility.trim(),
      input.kind, input.ref.trim()]);
  return id;
}

export interface RecurringResponsibility {
  responsibility: string;
  productId: string | null;
  companyName: string | null;
  /** Every kind of evidence that this recurs, not only the kinds that cost him. */
  signals: Array<{ kind: string; times: number }>;
  times: number;
  example: string;
  /** How many of these had to interrupt him. Zero is the good number. */
  interruptions: number;
}

/**
 * WHAT KEEPS COMING BACK.
 *
 * Where a delegation proposal may legitimately come from — and just as
 * importantly, where it may not. Never "the institution thought of a permission
 * it would like": only a responsibility that has demonstrably recurred, from
 * evidence anybody can check.
 *
 * A refusal for want of authority is ONE signal and was briefly the only one,
 * which made owner attention the price of learning that work recurs — an
 * institution that could only discover it should stop interrupting him by
 * interrupting him three times first. A queue that keeps filling, a schedule
 * that keeps firing, work prepared and left unfinished for want of a hand, and
 * the owner saying a class should eventually be handled are all evidence, and
 * none of them costs him anything.
 *
 * Grouped by RESPONSIBILITY rather than by the shape of an act. A support reply
 * and a promotional message to the same customer share a company, an audience
 * and a rung, and must never share a permission.
 */
export async function whatKeepsRecurring(
  founderId: string, atLeast = 3,
): Promise<RecurringResponsibility[]> {
  const rows = ((await query(
    `SELECT s.responsibility, s.product_id, COUNT(*) AS times,
            MIN(s.ref) AS example, p.name AS company_name,
            SUM(CASE WHEN s.kind = 'refused_for_authority' THEN 1 ELSE 0 END)
              AS interruptions
       FROM responsibility_signals s
       LEFT JOIN products p ON p.id = s.product_id
      WHERE s.founder_id = ?
        AND (s.product_id IS NULL OR ${realCompany('p')})
        AND NOT EXISTS (
          SELECT 1 FROM delegations d
           WHERE d.founder_id = s.founder_id
             AND d.responsibility = s.responsibility
             AND d.product_id IS s.product_id
             AND d.revoked_at IS NULL
             AND (d.expires_at IS NULL OR datetime(d.expires_at) > datetime('now')))
      GROUP BY s.responsibility, s.product_id
      HAVING COUNT(*) >= ?
      ORDER BY COUNT(*) DESC`, [founderId, atLeast]))
    .rows as unknown as Array<Record<string, unknown>>);

  const out: RecurringResponsibility[] = [];
  for (const r of rows) {
    const kinds = ((await query(
      `SELECT kind, COUNT(*) AS n FROM responsibility_signals
        WHERE founder_id = ? AND responsibility = ? AND product_id IS ?
        GROUP BY kind ORDER BY COUNT(*) DESC`,
      [founderId, String(r.responsibility), r.product_id ?? null]))
      .rows as unknown as Array<Record<string, unknown>>)
      .map((k) => ({ kind: String(k.kind), times: Number(k.n) }));
    out.push({
      responsibility: String(r.responsibility),
      productId: r.product_id == null ? null : String(r.product_id),
      companyName: r.company_name == null ? null : String(r.company_name),
      signals: kinds, times: Number(r.times), example: String(r.example),
      interruptions: Number(r.interruptions),
    });
  }
  return out;
}

/**
 * GIVE A COMPANY A NAME OF ITS OWN.
 *
 * Called when a company is created, so from its first day it has an identity
 * that is not its owner's. An asset whose support inbox, sending domain and
 * marketplace account are all personal cannot be sold — the buyer cannot take
 * any of it — and by the time that is noticed the accounts exist and the
 * customers know them.
 */
export async function nameAnActor(input: {
  founderId: string; productId: string | null;
  kind: 'company' | 'asset' | 'brand' | 'support_channel' | 'marketplace_account' | 'owner';
  displayName: string; externalRef?: string | null; portable?: boolean;
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO business_actors
       (id, founder_id, product_id, kind, display_name, external_ref, portable)
     VALUES (?,?,?,?,?,?,?)`,
    [id, input.founderId, input.productId, input.kind, input.displayName.trim(),
      input.externalRef ?? null,
      (input.portable ?? input.kind !== 'owner') ? 1 : 0]);
  return id;
}

/** The identities a company can act as. */
export async function actorsFor(productId: string): Promise<Array<{
  id: string; kind: string; displayName: string; portable: boolean;
}>> {
  return ((await query(
    `SELECT id, kind, display_name, portable FROM business_actors
      WHERE product_id = ? AND retired_at IS NULL ORDER BY rowid`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), kind: String(r.kind), displayName: String(r.display_name),
    portable: Number(r.portable) === 1,
  }));
}

/**
 * HIS ACT, AND ONLY HIS.
 *
 * `grantedBy` is built by the route from the authenticated session, never from
 * a request, and the database checks it is a person regardless. Everything this
 * function does is write down what he said; nothing here decides anything.
 */
export async function grantDelegation(input: {
  founderId: string; productId: string | null; actorId: string;
  /** The responsibility being absorbed. What this exists to carry. */
  responsibility: string;
  /** The kind of act within it. Two act classes are two delegations. */
  actClass: string;
  /** What content or data it may touch — the axis that separates a support
   *  reply from a promotional message to the same person. */
  contentScope: string;
  className: string; purpose: string; audience: Audience; excludes: string;
  ceiling: Rung; maxActsPerDay?: number | null; maxCentsPerDay?: number | null;
  /** Either a lifetime in days, or null for a durable one that is reviewed. */
  days?: number | null;
  /** How often Foundry reassesses it. Required when there is no expiry. */
  reviewEveryDays?: number | null;
  grantedBy: string; evidenceRef?: string | null;
}): Promise<{ id: string } | { refused: string }> {
  if (input.excludes.trim() === '') {
    return { refused: 'a permission with nothing excluded has not been thought about' };
  }
  const absorbable = (await query(
    'SELECT absorbable FROM consequence_rungs WHERE rung = ?', [input.ceiling]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!absorbable || Number(absorbable.absorbable) !== 1) {
    return { refused: 'acts on that rung stay yours, one at a time, and no standing '
      + 'permission can reach them' };
  }
  // DURABLE IS ALLOWED. UNREASSESSABLE IS NOT.
  //
  // An expiry forces him to re-permission the same stable responsibility
  // forever, which at nine assets is a calendar of re-permissioning — the
  // organisational burden this institution exists to absorb. So a delegation
  // may instead be durable with a review cadence Foundry carries, surfacing
  // only when something materially changed. It may never have neither.
  const days = input.days ?? null;
  const review = input.reviewEveryDays ?? (days === null ? 90 : null);
  if (days === null && review === null) {
    return { refused: 'a permission with no expiry and no review is one nobody '
      + 'would ever look at again' };
  }
  if (input.responsibility.trim() === '' || input.actClass.trim() === '') {
    return { refused: 'a permission has to say which responsibility it carries' };
  }

  const id = nanoid();
  await query(
    `INSERT INTO delegations
       (id, founder_id, product_id, actor_id, responsibility, act_class, class,
        purpose, audience, content_scope, excludes, ceiling, max_acts_per_day,
        max_cents_per_day, expires_at, review_every_days, granted_by, evidence_ref)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,
             CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', ?) END, ?,?,?)`,
    [id, input.founderId, input.productId, input.actorId,
      input.responsibility.trim(), input.actClass.trim(), input.className.trim(),
      input.purpose.trim(), input.audience, input.contentScope.trim(),
      input.excludes.trim(), input.ceiling,
      input.maxActsPerDay ?? null, input.maxCentsPerDay ?? null,
      days, days === null ? null : `+${String(days)} days`,
      review, input.grantedBy, input.evidenceRef ?? null]);
  return { id };
}

/**
 * THE FUSE, ARMED WHEN THE PERMISSION IS GRANTED.
 *
 * Deliberately not optional and not deferred. A standing permission whose
 * breakers are "to be added later" is a standing permission with no breakers,
 * and later is after the thing they existed to catch.
 */
export async function armBreaker(input: {
  delegationId: string; fact: string; windowMinutes: number; threshold: number;
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO delegation_breakers
       (id, delegation_id, counted_fact, window_minutes, threshold)
     VALUES (?,?,?,?,?)`,
    [id, input.delegationId, input.fact, input.windowMinutes, input.threshold]);
  return id;
}

/** Taking it back, which must be as easy as giving it. */
export async function revokeDelegation(id: string, reason: string): Promise<void> {
  await query(
    `UPDATE delegations SET revoked_at = datetime('now'), revoked_reason = ?
      WHERE id = ? AND revoked_at IS NULL`, [reason.trim(), id]);
}

export interface LiveDelegation {
  id: string; className: string; purpose: string; audience: string;
  excludes: string; ceiling: string; companyName: string | null;
  actorName: string; expiresAt: string; usedToday: number;
  maxActsPerDay: number | null; breakers: string[]; trippedFact: string | null;
  /** The specific thing that tripped it, so "I stopped" can say why. */
  trippedBy: string | null;
}

/** What he has allowed to run without him, and what would stop each. */
export async function liveDelegations(founderId: string): Promise<LiveDelegation[]> {
  const rows = ((await query(
    `SELECT d.id, d.class, d.purpose, d.audience, d.excludes, d.ceiling,
            d.expires_at, d.max_acts_per_day, a.display_name AS actor_name,
            p.name AS company_name
       FROM delegations d
       JOIN business_actors a ON a.id = d.actor_id
       LEFT JOIN products p ON p.id = d.product_id
      WHERE d.founder_id = ? AND d.revoked_at IS NULL
        AND datetime(d.expires_at) > datetime('now')
        -- A delegation on a rehearsal company is a rehearsal of delegating, and
        -- listing it beside the real ones would tell him he had allowed
        -- something he has not. Institution-level ones carry no company at all.
        AND (d.product_id IS NULL OR ${realCompany('p')})
      ORDER BY d.granted_at DESC`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>);

  const out: LiveDelegation[] = [];
  for (const r of rows) {
    const used = (await query(
      `SELECT COUNT(*) AS n FROM act_classifications
        WHERE delegation_id = ? AND allowed = 1 AND date(classified_at) = date('now')`,
      [String(r.id)])).rows[0] as Record<string, unknown>;
    const breakers = ((await query(
      `SELECT counted_fact, threshold, tripped_at, tripped_by, cleared_at
         FROM delegation_breakers WHERE delegation_id = ?`, [String(r.id)]))
      .rows as unknown as Array<Record<string, unknown>>);
    const tripped = breakers.find((b) => b.tripped_at != null && b.cleared_at == null);
    out.push({
      id: String(r.id), className: String(r.class), purpose: String(r.purpose),
      audience: String(r.audience), excludes: String(r.excludes),
      ceiling: String(r.ceiling),
      companyName: r.company_name == null ? null : String(r.company_name),
      actorName: String(r.actor_name), expiresAt: String(r.expires_at),
      usedToday: Number(used.n),
      maxActsPerDay: r.max_acts_per_day == null ? null : Number(r.max_acts_per_day),
      breakers: breakers.map((b) =>
        `${String(b.counted_fact)} reaching ${String(b.threshold)}`),
      trippedFact: tripped == null ? null : String(tripped.counted_fact),
      trippedBy: tripped?.tripped_by == null ? null : String(tripped.tripped_by),
    });
  }
  return out;
}


/**
 * WHAT HE TOOK BACK, AND WHY.
 *
 * A revocation is a judgment about the institution, and the most useful record
 * it will ever have. Keeping the reason where nothing reads it would make
 * taking a permission back feel like deleting a row instead of saying
 * something.
 */
export async function whatHeTookBack(founderId: string, limit = 10): Promise<Array<{
  className: string; companyName: string | null; reason: string; revokedAt: string;
}>> {
  return ((await query(
    `SELECT d.class, d.revoked_reason, d.revoked_at, p.name AS company_name
       FROM delegations d
       LEFT JOIN products p ON p.id = d.product_id
      WHERE d.founder_id = ? AND d.revoked_at IS NOT NULL
        AND (d.product_id IS NULL OR ${realCompany('p')})
      ORDER BY d.revoked_at DESC LIMIT ?`, [founderId, limit]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    className: String(r.class),
    companyName: r.company_name == null ? null : String(r.company_name),
    reason: r.revoked_reason == null ? '' : String(r.revoked_reason),
    revokedAt: String(r.revoked_at),
  }));
}


/**
 * WHAT IT HAS ACTUALLY BEEN DOING UNDER A PERMISSION.
 *
 * The question standing authority makes urgent. He allowed a class of work and
 * stopped seeing each act — so the record of what was done has to be legible on
 * demand, or "I am carrying this for you" is indistinguishable from "I stopped
 * telling you". Newest first, because the thing he wants is almost always the
 * last thing that happened.
 */
export async function whatWasDoneUnder(delegationId: string, limit = 20): Promise<Array<{
  did: string; rung: string; at: string; allowed: boolean;
}>> {
  return ((await query(
    `SELECT external_effect, rung, classified_at, allowed
       FROM act_classifications
      WHERE delegation_id = ?
      ORDER BY classified_at DESC, rowid DESC LIMIT ?`, [delegationId, limit]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    did: String(r.external_effect), rung: String(r.rung),
    at: String(r.classified_at), allowed: Number(r.allowed) === 1,
  }));
}
