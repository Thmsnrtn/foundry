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

export type Reversibility = 'reversible' | 'recoverable' | 'irreversible';
export type Audience = 'none' | 'owned_surface' | 'existing_customer'
  | 'prospect' | 'public' | 'counterparty';

export interface ActDescription {
  founderId: string;
  productId?: string | null;
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
    `SELECT d.id, d.class, d.ceiling, d.audience, d.max_acts_per_day,
            d.max_cents_per_day, d.excludes
       FROM delegations d
      WHERE d.founder_id = ? AND d.revoked_at IS NULL
        AND datetime(d.expires_at) > datetime('now')
        AND (d.product_id IS ? OR d.product_id IS NULL)
      ORDER BY d.granted_at DESC`,
    [act.founderId, act.productId ?? null]))
    .rows as unknown as Array<Record<string, unknown>>);

  for (const d of live) {
    if (order(String(d.ceiling)) < order(rung)) continue;
    if (String(d.audience) !== act.audience) continue;

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
        audience, external_effect, money_cents, rung, because, allowed)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [nanoid(), act.founderId, act.productId ?? null, act.actorId ?? null,
      verdict.delegationId, act.tool, act.reversibility, act.audience,
      act.externalEffect.trim(), act.moneyCents ?? 0, verdict.rung,
      verdict.because, verdict.allowed ? 1 : 0]);
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
  founderId: string; ceiling: Rung; kind?: 'venture_experiment' | 'proposed_act';
}): Promise<DelegationAdvice> {
  const NEEDED: Record<string, number> = {
    observe: 3, prepare: 3, reversible: 8, public: 20, financial: 40,
    legal: Number.POSITIVE_INFINITY, destructive: Number.POSITIVE_INFINITY,
  };
  const needed = NEEDED[input.ceiling] ?? Number.POSITIVE_INFINITY;

  if (!Number.isFinite(needed)) {
    return { eligible: false, recommended: false,
      sentence: 'No amount of good history makes this delegable. Acts on this rung '
        + 'stay yours, one at a time.' };
  }

  const { howOftenRight } = await import('./calibration.js');
  const record = await howOftenRight(input.founderId, input.kind);
  const enough = record.graded >= needed;
  // Settled by the world, not by his agreement with it — a record he graded
  // himself is a record of agreement and is not evidence of competence.
  const real = record.settledByTheWorld;
  const clean = record.graded > 0 && record.surprised / record.graded <= 0.25;

  if (!enough) {
    return { eligible: false, recommended: false,
      sentence: `I have been graded ${String(record.graded)} times on this; for something `
        + `at the ${input.ceiling} rung I would want at least ${String(needed)} before `
        + 'suggesting you let me do it routinely.' };
  }
  return {
    eligible: true,
    recommended: clean && real >= Math.ceil(needed / 2),
    sentence: `I have handled this ${String(record.graded)} times, ${String(real)} settled `
      + `by what actually happened, and was wrong ${String(record.surprised)} times. `
      + (clean ? 'I think this is worth allowing routinely, within limits.'
        : 'I would not suggest allowing this routinely yet.'),
  };
}

export interface KeepsAsking {
  productId: string;
  companyName: string;
  actorId: string | null;
  actorName: string | null;
  audience: Audience;
  rung: Rung;
  /** How many times this exact shape of act had to interrupt him. */
  times: number;
  /** One of them, verbatim, so the class is recognisable rather than abstract. */
  example: string;
  advice: DelegationAdvice;
}

/**
 * GIVE A COMPANY A NAME OF ITS OWN.
 *
 * Called when a company is created, so that from its first day it has an
 * identity that is not its owner's. An asset whose support inbox, sending
 * domain and marketplace account are all personal cannot be sold — the buyer
 * cannot take any of it — and by the time that is discovered the accounts
 * exist and the customers know them.
 *
 * Portable by default, and that default is the point: an identity is assumed to
 * belong to the asset unless somebody says otherwise.
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
 * WHAT I KEEP HAVING TO ASK YOU ABOUT.
 *
 * Where a delegation proposal comes from, and it is deliberately not "the
 * institution thought of a permission it would like". It is grounded in acts
 * that ACTUALLY HAPPENED and actually had to interrupt him: the same company,
 * the same audience, the same rung, refused for want of cover, more than once.
 *
 * An institution that invented permissions to request would be asking to be
 * trusted with things nothing has needed. This can only ever ask about work it
 * has already been doing the hard way.
 *
 * Real companies only, and never a rung that may not be absorbed — proposing a
 * standing permission for something that can never have one would be teaching
 * him that his refusals are negotiable.
 */
export async function whatIKeepAskingAbout(
  founderId: string, atLeast = 3,
): Promise<KeepsAsking[]> {
  const rows = ((await query(
    `SELECT c.product_id, c.audience, c.rung, COUNT(*) AS times,
            MIN(c.external_effect) AS example,
            MAX(c.actor_id) AS actor_id,
            p.name AS company_name
       FROM act_classifications c
       JOIN products p ON p.id = c.product_id
       JOIN consequence_rungs r ON r.rung = c.rung
      WHERE c.founder_id = ? AND c.allowed = 0 AND c.delegation_id IS NULL
        AND ${realCompany('p')} AND r.absorbable = 1
        AND NOT EXISTS (
          SELECT 1 FROM delegations d
           WHERE d.founder_id = c.founder_id AND d.product_id = c.product_id
             AND d.audience = c.audience AND d.revoked_at IS NULL
             AND datetime(d.expires_at) > datetime('now'))
      GROUP BY c.product_id, c.audience, c.rung
      HAVING COUNT(*) >= ?
      ORDER BY COUNT(*) DESC`, [founderId, atLeast]))
    .rows as unknown as Array<Record<string, unknown>>);

  const out: KeepsAsking[] = [];
  for (const r of rows) {
    const actorId = r.actor_id == null ? null : String(r.actor_id);
    const actor = actorId === null ? null : (await query(
      'SELECT display_name FROM business_actors WHERE id = ?', [actorId]))
      .rows[0] as Record<string, unknown> | undefined;
    out.push({
      productId: String(r.product_id), companyName: String(r.company_name),
      actorId, actorName: actor == null ? null : String(actor.display_name),
      audience: String(r.audience) as Audience, rung: String(r.rung) as Rung,
      times: Number(r.times), example: String(r.example),
      advice: await adviceOnDelegating({ founderId, ceiling: String(r.rung) as Rung }),
    });
  }
  return out;
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
  className: string; purpose: string; audience: Audience; excludes: string;
  ceiling: Rung; maxActsPerDay?: number | null; maxCentsPerDay?: number | null;
  days: number; grantedBy: string; evidenceRef?: string | null;
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
  const id = nanoid();
  await query(
    `INSERT INTO delegations
       (id, founder_id, product_id, actor_id, class, purpose, audience, excludes,
        ceiling, max_acts_per_day, max_cents_per_day, expires_at, granted_by,
        evidence_ref)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now', ?), ?, ?)`,
    [id, input.founderId, input.productId, input.actorId, input.className.trim(),
      input.purpose.trim(), input.audience, input.excludes.trim(), input.ceiling,
      input.maxActsPerDay ?? null, input.maxCentsPerDay ?? null,
      `+${String(input.days)} days`, input.grantedBy, input.evidenceRef ?? null]);
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
