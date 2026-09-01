// =============================================================================
// FOUNDRY — standing intent: what the owner said, and what it binds
//
// The owner asked to be able to say ordinary sentences — "Do not change pricing
// without asking", "Retention matters more than acquisition right now", "Do not
// spend anything" — and have the institution turn them into something real.
//
// WHY THE INTERPRETATION IS DETERMINISTIC AND NOT A MODEL CALL.
//
// A boundary is a governance control. A model that mishears one either binds
// something the owner did not mean or, far worse, quietly fails to bind
// something he did — and he has no way to tell which happened, because the
// whole value of a standing boundary is that he stops thinking about it.
//
// So this matches his words against a closed, constitutional vocabulary and
// REFUSES TO GUESS. When it does not recognise a sentence it says so and shows
// him what it can hold, which teaches the vocabulary in one interaction and is
// honest in a way "I've noted that" is not. A model pass could later PROPOSE a
// reading — that is a genuine use for one — but the structure it proposes into,
// and the confirmation that binds it, stay exactly as they are here.
//
// NOTHING IS BOUND WITHOUT CONFIRMATION. `interpret` produces a proposal;
// `setBoundary` and `setObjective` are called only after the owner has seen, in
// plain words, exactly what will happen. That is the interaction grammar the
// owner set: he should be able to predict the resulting state before tapping.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── the vocabulary, in his words ────────────────────────────────────────────

/**
 * The phrases that name each subject.
 *
 * Ordered longest-first at match time, so "spend money on ads" does not become
 * a general spending boundary because "spend" appeared. Every phrase is
 * something an owner would actually type; none is jargon.
 */
const SUBJECT_PHRASES: Record<string, string[]> = {
  contact_people: [
    'contact anyone', 'contact people', 'contact customers', 'email anyone',
    'email customers', 'email people', 'message anyone', 'message customers',
    'reach out', 'send anything', 'send any email', 'send emails', 'talk to customers',
  ],
  spend_money: [
    'spend anything', 'spend any money', 'spend money', 'spend my money',
    'cost me anything', 'spend a cent', 'spend a penny', 'incur any cost',
  ],
  set_prices: [
    'change pricing', 'change the pricing', 'change prices', 'change the price',
    'touch pricing', 'touch the pricing', 'adjust pricing', 'raise prices',
    'lower prices', 'change what we charge', 'change what it charges',
  ],
  move_money: [
    'move money', 'issue refunds', 'refund anyone', 'charge anyone',
    'charge customers', 'take payments', 'pay anyone out', 'move any money',
  ],
  change_software: [
    'change the code', 'change any code', 'touch the code', 'change the product',
    'deploy', 'change infrastructure', 'ship anything', 'merge anything',
    'change the software',
  ],
  publish: [
    'publish anything', 'post anything', 'post publicly', 'publish',
    'put anything out', 'announce anything', 'tweet', 'post on social',
  ],
  commit_on_my_behalf: [
    'commit to anything', 'promise anything', 'agree to anything',
    'sign anything', 'make any commitments', 'commit me to',
  ],
};

/**
 * What makes a sentence a prohibition.
 *
 * Deliberately narrow. "I want you to change pricing" must not become a
 * boundary because it contains the word pricing, so a subject match alone is
 * never enough — one of these has to be there too.
 */
const PROHIBITIONS = [
  "don't", 'do not', 'dont', 'never', 'no longer', 'stop ', 'not allowed',
  "won't", 'must not', 'cannot', "can't", 'refuse to', 'without asking',
  'without my', 'without me', 'unless i',
];

/** What an objective points at, and which of the company's numbers that is. */
const FOCUS_CONCERNS: Record<string, { phrases: string[]; channels: string[] }> = {
  revenue: {
    phrases: ['revenue', 'mrr', 'arr', 'money', 'sales', 'income', 'paying', 'earn'],
    channels: ['mrr_cents', 'new_mrr_cents', 'churned_mrr_cents'],
  },
  customers: {
    phrases: ['customers', 'users', 'people using', 'paying customers', 'accounts'],
    channels: ['active_users', 'new_mrr_cents'],
  },
  retention: {
    phrases: ['retention', 'retain', 'churn', 'leaving', 'stay', 'stick', 'keep customers'],
    channels: ['day_30_retention', 'churn_rate', 'churned_mrr_cents'],
  },
  activation: {
    phrases: ['activation', 'onboarding', 'get started', 'first run', 'set up'],
    channels: ['activation_rate', 'day_30_retention'],
  },
  growth: {
    phrases: ['growth', 'grow', 'acquisition', 'signups', 'sign ups', 'traffic', 'top of funnel'],
    channels: ['signups_7d', 'active_users', 'new_mrr_cents'],
  },
  support: {
    phrases: ['support', 'tickets', 'queue', 'help', 'responsiveness'],
    channels: ['support_volume_7d'],
  },
};

// ─── interpretation ──────────────────────────────────────────────────────────

export interface BoundaryProposal {
  kind: 'boundary';
  subject: string;
  /** His words, verbatim. Never rewritten. */
  statement: string;
}

export interface ObjectiveProposal {
  kind: 'objective';
  statement: string;
  concerns: string[];
  channels: string[];
}

export interface Unclear {
  kind: 'unclear';
  statement: string;
  because: string;
}

export type IntentProposal = BoundaryProposal | ObjectiveProposal | Unclear;

/**
 * Read one sentence from the owner.
 *
 * A prohibition that names a subject is a boundary. Anything else that points
 * at something the institution can watch is an objective. Everything else is
 * unclear, and says so.
 */
export function interpret(raw: string): IntentProposal {
  const statement = raw.trim();
  const text = ` ${statement.toLowerCase().replace(/[’]/g, "'")} `;
  if (!statement) {
    return { kind: 'unclear', statement, because: 'you did not say anything' };
  }

  const prohibited = PROHIBITIONS.some((p) => text.includes(p));
  if (prohibited) {
    // Longest phrase first, so the most specific subject wins a sentence that
    // could match two.
    const candidates = Object.entries(SUBJECT_PHRASES)
      .flatMap(([subject, phrases]) => phrases.map((phrase) => ({ subject, phrase })))
      .sort((a, b) => b.phrase.length - a.phrase.length);
    const hit = candidates.find((c) => text.includes(c.phrase));
    if (hit) return { kind: 'boundary', subject: hit.subject, statement };
    return {
      kind: 'unclear', statement,
      because: 'I understood that as something you want me not to do, but not what',
    };
  }

  const concerns = Object.entries(FOCUS_CONCERNS)
    .filter(([, c]) => c.phrases.some((p) => text.includes(p)))
    .map(([name]) => name);
  const channels = [...new Set(concerns.flatMap((c) => FOCUS_CONCERNS[c]?.channels ?? []))];
  if (concerns.length > 0) return { kind: 'objective', statement, concerns, channels };

  // An objective that names nothing measurable is still an objective — it is
  // what he is trying to do, and recording it with an empty focus is honest.
  // What is NOT honest is calling a fragment an objective, so a sentence has to
  // look like one.
  if (statement.split(/\s+/).length >= 3) {
    return { kind: 'objective', statement, concerns: [], channels: [] };
  }
  return {
    kind: 'unclear', statement,
    because: 'that is too short for me to be sure what you mean',
  };
}

// ─── what the owner is shown before anything binds ───────────────────────────

export interface SubjectFacts {
  subject: string;
  ownerWords: string;
  /** Null when no path exists: the boundary is recorded and already true. */
  door: string | null;
}

export async function subjectFacts(subject: string): Promise<SubjectFacts | null> {
  const row = (await query(
    'SELECT subject, owner_words, door FROM owner_boundary_subjects WHERE subject = ?',
    [subject])).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    subject: String(row.subject), ownerWords: String(row.owner_words),
    door: row.door == null ? null : String(row.door),
  };
}

export async function everySubject(): Promise<SubjectFacts[]> {
  return ((await query(
    'SELECT subject, owner_words, door FROM owner_boundary_subjects ORDER BY sort_order', []))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    subject: String(r.subject), ownerWords: String(r.owner_words),
    door: r.door == null ? null : String(r.door),
  }));
}

// ─── writing ─────────────────────────────────────────────────────────────────

/**
 * Bind a boundary. `productId` null means every company he owns, now and later.
 *
 * Idempotent on (company, subject): saying the same thing twice is one
 * boundary, not two, and the words that survive are the ones he used first.
 */
export async function setBoundary(input: {
  productId: string | null; subject: string; statement: string;
}): Promise<string> {
  const live = (await query(
    `SELECT id FROM owner_boundaries
      WHERE subject = ? AND lifted_at IS NULL
        AND product_id IS ?`, [input.subject, input.productId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (live) return String(live.id);

  const id = nanoid();
  await query(
    'INSERT INTO owner_boundaries (id, product_id, subject, statement) VALUES (?,?,?,?)',
    [id, input.productId, input.subject, input.statement.trim()]);
  return id;
}

export async function liftBoundary(id: string, reason: string): Promise<void> {
  await query(
    "UPDATE owner_boundaries SET lifted_at = datetime('now'), lifted_reason = ? WHERE id = ?",
    [reason, id]);
}

/**
 * Set what this company is for right now, retiring whatever it replaces.
 *
 * One live objective per company is a schema rule; retiring the previous one is
 * how a change of direction is recorded rather than a second direction being
 * added beside the first.
 */
export async function setObjective(input: {
  productId: string; statement: string; channels: string[];
}): Promise<string> {
  await query(
    `UPDATE owner_objectives SET retired_at = datetime('now'),
            retired_reason = 'the owner said something else'
      WHERE product_id = ? AND retired_at IS NULL`, [input.productId]);
  const id = nanoid();
  await query(
    'INSERT INTO owner_objectives (id, product_id, statement, focus_json) VALUES (?,?,?,?)',
    [id, input.productId, input.statement.trim(), JSON.stringify(input.channels)]);
  return id;
}

// ─── reading ─────────────────────────────────────────────────────────────────

export interface LiveBoundary {
  id: string; subject: string; statement: string;
  ownerWords: string; door: string | null; everywhere: boolean; setAt: string;
}

/** Every boundary in force for this company — its own, and the global ones. */
export async function boundariesFor(productId: string): Promise<LiveBoundary[]> {
  return ((await query(
    `SELECT b.id, b.subject, b.statement, b.set_at, b.product_id,
            s.owner_words, s.door
       FROM owner_boundaries b
       JOIN owner_boundary_subjects s ON s.subject = b.subject
      WHERE b.lifted_at IS NULL AND (b.product_id IS NULL OR b.product_id = ?)
      ORDER BY s.sort_order, b.rowid`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), subject: String(r.subject), statement: String(r.statement),
    ownerWords: String(r.owner_words), door: r.door == null ? null : String(r.door),
    everywhere: r.product_id == null, setAt: String(r.set_at),
  }));
}

export interface LiveObjective {
  id: string; statement: string; channels: string[]; setAt: string;
}

export async function objectiveFor(productId: string): Promise<LiveObjective | null> {
  const row = (await query(
    `SELECT id, statement, focus_json, set_at FROM owner_objectives
      WHERE product_id = ? AND retired_at IS NULL`, [productId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id), statement: String(row.statement),
    channels: JSON.parse(String(row.focus_json)) as string[], setAt: String(row.set_at),
  };
}

// ─── enforcement ─────────────────────────────────────────────────────────────

/**
 * WHICH TOOLS REACH A PERSON.
 *
 * The outbound door refuses by tool name, and `contact_people` is about
 * reaching someone — not about every effect that happens to travel outward. The
 * list is here rather than derived from `governed_effect_kinds` because that
 * table answers a different question (what consent class an effect needs), and
 * a subject the owner named should not silently change meaning when a new
 * effect kind is registered.
 */
const REACHES_A_PERSON = new Set(['send_email', 'post_slack', 'post_webhook', 'send_sms']);

/**
 * Is something the owner said standing in the way of this?
 *
 * Returns his own words when it is, because that is what should be shown at the
 * moment of refusal — not a subject key, and not a paraphrase. Null when
 * nothing stands in the way, which is the ordinary case and the fast path.
 *
 * Called from the two doors that already refuse things: the outbound kill
 * switch and the spend gate. It is deliberately not called anywhere else — a
 * boundary consulted in nine places is a boundary that will be forgotten in a
 * tenth.
 */
export async function boundaryStandingInTheWay(input: {
  productId: string; door: 'outbound' | 'spend'; tool?: string;
}): Promise<{ statement: string; refusal: string } | null> {
  const rows = (await query(
    `SELECT b.subject, b.statement, s.refusal
       FROM owner_boundaries b
       JOIN owner_boundary_subjects s ON s.subject = b.subject
      WHERE b.lifted_at IS NULL AND s.door = ?
        AND (b.product_id IS NULL OR b.product_id = ?)
      ORDER BY s.sort_order, b.rowid`, [input.door, input.productId]))
    .rows as unknown as Array<Record<string, unknown>>;

  for (const row of rows) {
    const subject = String(row.subject);
    // At the outbound door, `contact_people` binds only the tools that reach
    // one. Everything else at that door is unbound by this subject.
    if (subject === 'contact_people'
      && !(input.tool != null && REACHES_A_PERSON.has(input.tool))) continue;
    return { statement: String(row.statement), refusal: String(row.refusal) };
  }
  return null;
}

// ─── what he changed his mind about ──────────────────────────────────────────

/**
 * LIFTING WAS NEVER MEANT TO BE FINAL, AND THE PRODUCT ACTED AS THOUGH IT WERE.
 *
 * The same defect migration 109 fixed for a declined candidate: the record kept
 * everything, and no surface offered it back, so "lift" read as "forget". A
 * lifted boundary is a thing he once cared enough to state — he should be able
 * to see it and put it back without recalling the sentence he used.
 *
 * This is also what `lifted_reason` and `retired_reason` are FOR. A column
 * written and never read is a column that is not really recording anything,
 * which is why the gate asks.
 */
export interface LiftedBoundary {
  id: string; subject: string; statement: string; ownerWords: string;
  everywhere: boolean; liftedAt: string; liftedReason: string;
}

export async function liftedBoundariesFor(productId: string): Promise<LiftedBoundary[]> {
  return ((await query(
    `SELECT b.id, b.subject, b.statement, b.product_id, b.lifted_at, b.lifted_reason,
            s.owner_words
       FROM owner_boundaries b
       JOIN owner_boundary_subjects s ON s.subject = b.subject
      WHERE b.lifted_at IS NOT NULL AND (b.product_id IS NULL OR b.product_id = ?)
        -- Only while nothing has replaced it. A boundary he lifted and then set
        -- again is simply in force, and offering to "set it again" would be
        -- offering him something he already has.
        AND NOT EXISTS (
          SELECT 1 FROM owner_boundaries live
           WHERE live.subject = b.subject AND live.lifted_at IS NULL
             AND live.product_id IS b.product_id)
      ORDER BY b.lifted_at DESC, b.rowid DESC`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), subject: String(r.subject), statement: String(r.statement),
    ownerWords: String(r.owner_words), everywhere: r.product_id == null,
    liftedAt: String(r.lifted_at).slice(0, 10), liftedReason: String(r.lifted_reason),
  }));
}

/** What this company was for before, and why that stopped. */
export interface FormerObjective { statement: string; retiredAt: string; retiredReason: string }

export async function formerObjectiveFor(productId: string): Promise<FormerObjective | null> {
  const row = (await query(
    `SELECT statement, retired_at, retired_reason FROM owner_objectives
      WHERE product_id = ? AND retired_at IS NOT NULL
      ORDER BY retired_at DESC, rowid DESC LIMIT 1`, [productId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    statement: String(row.statement), retiredAt: String(row.retired_at).slice(0, 10),
    retiredReason: String(row.retired_reason ?? ''),
  };
}
