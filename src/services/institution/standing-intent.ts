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

import { createHash } from 'node:crypto';
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
    // THE SINGULAR, BECAUSE HE SPEAKS IT. "Run it by me before you email any
    // customer" matched nothing and fell through to unclear, while the same
    // sentence in the plural produced a boundary.
    'contact a customer', 'contact any customer', 'email a customer',
    'email any customer', 'message a customer', 'message any customer',
    'talk to a customer', 'talk to any customer',
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

/**
 * AND WHAT MAKES IT "ASK ME FIRST" RATHER THAN "NEVER".
 *
 * These two are genuinely different instructions and the owner said the second
 * one: "do not change pricing WITHOUT ASKING" is not "do not change pricing".
 * Migration 225 could only honour the first because there was no way to be
 * asked; migration 228 built one, so the distinction his sentence already made
 * is now the distinction the institution makes.
 *
 * Absence of these markers means NEVER, which is the safe direction: a
 * misheard boundary that refuses too much is visible the first time it bites
 * and he lifts it in one tap. One that refuses too little is invisible.
 */
const ASK_MARKERS = [
  'without asking', 'without my say', 'without my approval', 'without my permission',
  'without me', 'without checking', 'unless i say', 'unless i approve', 'ask me first',
  'ask first', 'check with me', 'run it by me', 'without telling me',
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

export type BoundaryMode = 'never' | 'ask_first';

export interface BoundaryProposal {
  kind: 'boundary';
  subject: string;
  mode: BoundaryMode;
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

export interface AllowanceProposal {
  kind: 'allowance'; statement: string; amountCents: number; purpose: string;
}
export interface PreferenceProposal { kind: 'preference'; statement: string }
export interface StopProposal { kind: 'stop'; statement: string }

export type IntentProposal =
  | BoundaryProposal | ObjectiveProposal | AllowanceProposal
  | PreferenceProposal | StopProposal | Unclear;

/** "spend up to $25", "no more than 20 dollars". Cents, so nothing rounds. */
function amountIn(text: string): number | null {
  const match = /(?:\$|usd\s*)?(\d+(?:\.\d{1,2})?)\s*(?:dollars?|usd|bucks?)?/.exec(text);
  if (!match) return null;
  const cents = Math.round(Number(match[1]) * 100);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}

const SPENDING = ['spend', 'budget', 'put', 'invest', 'use up to', 'costing'];
const CAPPING = ['up to', 'no more than', 'at most', 'maximum', 'max ', 'limit', 'cap'];
const PREFERRING = ['i would rather', "i'd rather", 'i prefer', 'prefer to', 'rather than',
  'ideally', 'if possible', 'i would prefer'];
const STOPPING = ['stop working on', 'stop doing', 'drop that', 'forget that',
  'leave that', 'stop that', 'never mind that', 'stop focusing'];

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

  // ORDER MATTERS AND IS NOT ARBITRARY. "Stop working on that" contains a
  // prohibition marker and is not a boundary — it is an act on something that
  // already exists. "Spend no more than $25" contains one too and is a grant,
  // not a refusal. Both are checked before the prohibition branch so that the
  // narrower reading wins over the broader one.
  if (STOPPING.some((p) => text.includes(p))) return { kind: 'stop', statement };

  const amount = amountIn(text);
  if (amount !== null && SPENDING.some((p) => text.includes(p))
    && CAPPING.some((p) => text.includes(p))) {
    return {
      kind: 'allowance', statement, amountCents: amount,
      // His own sentence is the purpose. Categorising it would be Foundry
      // deciding what he meant the money was for.
      purpose: statement,
    };
  }

  if (PREFERRING.some((p) => text.includes(p))) return { kind: 'preference', statement };

  // "ASK ME FIRST" IS A BOUNDARY, AND IT WAS NOT REACHING THIS BRANCH.
  //
  // The gate below asks whether the sentence forbids something. Only then does
  // it look at the ask-markers to decide whether the answer is "never" or "ask
  // me first". But four of the five ask-markers — "ask me first", "ask first",
  // "check with me", "run it by me" — appear in no prohibition phrase, so a
  // sentence carrying one and nothing else never reached the branch at all.
  //
  // "Ask me first before you email customers" is not an odd way of phrasing it.
  // It is the most natural way to say the thing this institution is most often
  // asked to do, and it produced no boundary — the sentence fell through to a
  // later branch and was filed as what the company is FOR.
  //
  // Asking to be consulted is a constraint on Foundry either way. Which kind it
  // is stays exactly as it was.
  const asking = ASK_MARKERS.some((m) => text.includes(m));
  const prohibited = asking || PROHIBITIONS.some((p) => text.includes(p));
  if (prohibited) {
    // Longest phrase first, so the most specific subject wins a sentence that
    // could match two.
    const candidates = Object.entries(SUBJECT_PHRASES)
      .flatMap(([subject, phrases]) => phrases.map((phrase) => ({ subject, phrase })))
      .sort((a, b) => b.phrase.length - a.phrase.length);
    const hit = candidates.find((c) => text.includes(c.phrase));
    if (hit) {
      const mode: BoundaryMode = asking ? 'ask_first' : 'never';
      return { kind: 'boundary', subject: hit.subject, mode, statement };
    }
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
  productId: string | null; subject: string; statement: string; mode?: BoundaryMode;
}): Promise<string> {
  const live = (await query(
    `SELECT id, mode FROM owner_boundaries
      WHERE subject = ? AND lifted_at IS NULL
        AND product_id IS ?`, [input.subject, input.productId]))
    .rows[0] as Record<string, unknown> | undefined;

  // CHANGING HIS MIND WAS A SILENT NO-OP, AND THE PAGE SAID IT HAD WORKED.
  //
  // Saying the same thing twice should change nothing, and that is why this
  // returned the live row. But it compared nothing: "ask me first before you
  // email customers", later replaced with "never email customers", found the
  // live ask_first boundary and returned its id. Foundry then told him "I will
  // not email your customers" — while still holding a boundary that permits it
  // with his approval. The affirmation was the dangerous part: a no-op he could
  // see would have been a smaller failure than one he was thanked for.
  //
  // A repeat is still idempotent. A change is recorded the way every other
  // change of mind is recorded here: the old one lifted, the new one written,
  // both kept.
  if (live) {
    if (String(live.mode) === (input.mode ?? 'never')) return String(live.id);
    await liftBoundary(String(live.id), 'you replaced it with something different');
  }

  const id = nanoid();
  await query(
    'INSERT INTO owner_boundaries (id, product_id, subject, statement, mode) VALUES (?,?,?,?,?)',
    [id, input.productId, input.subject, input.statement.trim(), input.mode ?? 'never']);
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
  id: string; subject: string; statement: string; mode: BoundaryMode;
  ownerWords: string; door: string | null; everywhere: boolean; setAt: string;
}

/** Every boundary in force for this company — its own, and the global ones. */
export async function boundariesFor(productId: string): Promise<LiveBoundary[]> {
  return ((await query(
    `SELECT b.id, b.subject, b.statement, b.set_at, b.product_id, b.mode,
            s.owner_words, s.door
       FROM owner_boundaries b
       JOIN owner_boundary_subjects s ON s.subject = b.subject
      WHERE b.lifted_at IS NULL AND (b.product_id IS NULL OR b.product_id = ?)
      ORDER BY s.sort_order, b.rowid`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), subject: String(r.subject), statement: String(r.statement),
    mode: String(r.mode) as BoundaryMode,
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
  /** What exactly is about to be done. Server-computed; see `fingerprint`. */
  paramsFingerprint?: string;
}): Promise<{ statement: string; refusal: string } | null> {
  const rows = (await query(
    `SELECT b.subject, b.statement, b.mode, s.refusal
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

    if (String(row.mode) === 'ask_first') {
      // HE ASKED TO BE ASKED, SO THE QUESTION IS WHETHER HE ANSWERED — about
      // THIS act, not about this kind of act. Spending the approval here rather
      // than after the handler is deliberate: between an approval spent on an
      // effect that failed and one still standing after an effect that may have
      // reached the world, a governance control fails toward asking again.
      const spent = await spendApprovalFor({
        productId: input.productId, actionType: input.tool ?? null,
        paramsFingerprint: input.paramsFingerprint ?? null,
      });
      if (spent) continue;
      return {
        statement: String(row.statement),
        refusal: `${String(row.refusal)} without asking you first, and you have not `
          + 'approved this',
      };
    }
    return { statement: String(row.statement), refusal: String(row.refusal) };
  }
  return null;
}

// ─── asking, and being answered ──────────────────────────────────────────────

/**
 * EXACTLY WHAT WILL BE DONE, REDUCED TO ONE STRING.
 *
 * The attack this exists for is not a forged approval — it is a real one, used
 * for something else: propose a reasonable message to one customer, obtain a
 * yes, then send a different message to everyone. So the approval is bound to
 * the parameters, both ends compute this the same way from server-held values,
 * and a single changed character is a different act.
 *
 * Keys are sorted, because two objects that mean the same thing must hash the
 * same, and JSON.stringify preserves insertion order.
 */
export function fingerprint(params: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, canonical(v)]));
    }
    return value;
  };
  return createHash('sha256').update(JSON.stringify(canonical(params) ?? null))
    .digest('hex').slice(0, 32);
}

export interface ProposedAct {
  id: string; productId: string; subject: string; actionType: string | null;
  summary: string; why: string; expectedEffect: string; risk: string;
  consequence: 'low' | 'medium' | 'high';
  /**
   * WHAT KIND OF ACT THIS IS, AND WHAT UNDOING IT WOULD INVOLVE.
   *
   * Null on acts proposed before the ladder reached this table. The card says
   * so rather than inventing a classification nobody made.
   */
  rung: string | null;
  rungMeans: string | null;
  puttingItBack: string | null;
  /** Whether standing policy could ever cover this class of act. */
  absorbable: boolean | null;
  /** What it would cost in cents, or null where that is genuinely not known. */
  costCents: number | null;
  proposedAt: string; expiresAt: string;
  decision: 'approved' | 'refused' | null;
}

/**
 * Foundry asks. It cannot answer.
 *
 * Refused outright when nothing standing asked to be consulted about this: a
 * proposal the owner never requested is an interruption manufactured out of
 * nothing, and his attention is the scarcest thing this institution spends.
 */
export async function proposeAct(input: {
  productId: string; subject: string; actionType: string | null;
  params: unknown; summary: string; why: string; expectedEffect: string; risk: string;
  consequence: 'low' | 'medium' | 'high';
  /**
   * Which rung of the consequence ladder this act sits on. Optional only
   * because acts proposed before the ladder reached this table have none, and
   * inventing one for them afterwards would assert a classification nobody
   * made.
   */
  rung?: string;
  /** What it would cost, in cents. Null means genuinely not known. */
  costCents?: number | null;
  proposedBy: string; validForHours?: number;
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO proposed_acts
       (id, product_id, subject, action_type, params_fingerprint, summary, why,
        expected_effect, risk, consequence, rung, cost_cents, proposed_by, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now', ?))`,
    [id, input.productId, input.subject, input.actionType,
      fingerprint(input.params), input.summary.trim(), input.why.trim(),
      input.expectedEffect.trim(), input.risk.trim(), input.consequence,
      input.rung ?? null, input.costCents ?? null,
      input.proposedBy, `+${String(input.validForHours ?? 72)} hours`]);
  return id;
}

export async function openProposals(productId: string): Promise<ProposedAct[]> {
  return ((await query(
    `SELECT a.id, a.product_id, a.subject, a.action_type, a.summary, a.why,
            a.expected_effect, a.risk, a.consequence, a.proposed_at, a.expires_at,
            a.decision, a.rung, a.cost_cents,
            r.what_it_means AS rung_means, r.putting_it_back, r.absorbable
       FROM proposed_acts a
       LEFT JOIN consequence_rungs r ON r.rung = a.rung
      WHERE a.product_id = ? AND a.decision IS NULL AND a.revoked_at IS NULL
        AND datetime(a.expires_at) > datetime('now')
      ORDER BY a.proposed_at, a.rowid`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), productId: String(r.product_id), subject: String(r.subject),
    actionType: r.action_type == null ? null : String(r.action_type),
    summary: String(r.summary), why: String(r.why),
    expectedEffect: String(r.expected_effect), risk: String(r.risk),
    consequence: String(r.consequence) as ProposedAct['consequence'],
    rung: r.rung == null ? null : String(r.rung),
    rungMeans: r.rung_means == null ? null : String(r.rung_means),
    puttingItBack: r.putting_it_back == null ? null : String(r.putting_it_back),
    absorbable: r.absorbable == null ? null : Number(r.absorbable) === 1,
    costCents: r.cost_cents == null ? null : Number(r.cost_cents),
    proposedAt: String(r.proposed_at), expiresAt: String(r.expires_at),
    decision: r.decision == null ? null : String(r.decision) as 'approved' | 'refused',
  }));
}

/**
 * The owner answers. `decidedBy` is a principal reference the ROUTE builds from
 * the authenticated session — never from the request — and the database checks
 * it against the company's actual owner regardless.
 */
export async function decideProposedAct(input: {
  id: string; decision: 'approved' | 'refused'; decidedBy: string;
}): Promise<void> {
  await query(
    `UPDATE proposed_acts
        SET decision = ?, decided_by = ?, decided_at = datetime('now')
      WHERE id = ? AND decision IS NULL`,
    [input.decision, input.decidedBy, input.id]);
}

export async function revokeApproval(id: string, reason: string): Promise<void> {
  await query(
    `UPDATE proposed_acts SET revoked_at = datetime('now'), revoke_reason = ?
      WHERE id = ? AND consumed_at IS NULL`, [reason, id]);
}

/**
 * Spend one approval for exactly this act, if there is one.
 *
 * Returns false rather than throwing when there is nothing to spend — that is
 * the ordinary case, and it is the caller's job to turn it into the refusal
 * with the owner's own words in it.
 */
export async function spendApprovalFor(input: {
  productId: string; actionType: string | null; paramsFingerprint: string | null;
}): Promise<boolean> {
  if (input.paramsFingerprint == null) return false;
  const row = (await query(
    `SELECT id FROM proposed_acts
      WHERE product_id = ? AND decision = 'approved'
        AND consumed_at IS NULL AND revoked_at IS NULL
        AND datetime(expires_at) > datetime('now')
        AND params_fingerprint = ?
        AND action_type IS ?
      ORDER BY decided_at, rowid LIMIT 1`,
    [input.productId, input.paramsFingerprint, input.actionType]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) return false;
  // `consumed_by` is AUDIT PROVENANCE and is deliberately not on the owner's
  // page: which internal door spent an approval is the right question for
  // someone reconstructing what happened months later, and noise on the screen
  // where he is deciding what to do about his business today. It is baselined
  // as write-only on purpose, with this comment as the reason the gate asks for.
  await query(
    `UPDATE proposed_acts SET consumed_at = datetime('now'), consumed_by = 'outbound_door'
      WHERE id = ? AND consumed_at IS NULL`, [String(row.id)]);
  return true;
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

/**
 * WHAT HE DECIDED, AND WHAT HE TOOK BACK.
 *
 * "Auditable afterward" was one of the properties the owner named, and an audit
 * nobody can read is a claim rather than a property. This is the readable half:
 * the acts he approved, the ones he refused, and the approvals he revoked
 * before they were used — each with the reason recorded at the time.
 *
 * Bounded to the recent ones, because this is a record he glances at rather
 * than a ledger he audits. The full history is in the table and nothing deletes
 * from it.
 */
export interface DecidedAct {
  id: string; summary: string; outcome: 'approved' | 'refused' | 'revoked';
  at: string; note: string | null; used: boolean;
}

export async function recentDecisions(
  productId: string, limit = 5,
): Promise<DecidedAct[]> {
  return ((await query(
    `SELECT id, summary, decision, decided_at, revoked_at, revoke_reason, consumed_at
       FROM proposed_acts
      WHERE product_id = ? AND (decision IS NOT NULL OR revoked_at IS NOT NULL)
      ORDER BY coalesce(revoked_at, decided_at) DESC, rowid DESC
      LIMIT ?`, [productId, limit]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), summary: String(r.summary),
    outcome: r.revoked_at != null ? 'revoked'
      : String(r.decision) === 'approved' ? 'approved' : 'refused',
    at: String(r.revoked_at ?? r.decided_at).slice(0, 10),
    note: r.revoke_reason == null ? null : String(r.revoke_reason),
    used: r.consumed_at != null,
  }));
}

// ─── the rest of what he can say ─────────────────────────────────────────────

export interface LiveAllowance {
  id: string; statement: string; amountCents: number; spentCents: number;
  remainingCents: number; setAt: string;
}

/**
 * WHAT HE HAS ALLOWED, AND WHAT IS LEFT OF IT.
 *
 * Spend is counted from `ai_daily_spend` since the day the allowance was set —
 * the ledger the ceilings already use — rather than kept as a second running
 * total here. Two counters for one quantity is the shape this codebase keeps
 * finding broken, with the weaker one live.
 */
export async function allowanceFor(productId: string): Promise<LiveAllowance | null> {
  const row = (await query(
    `SELECT id, statement, amount_cents, set_at FROM owner_allowances
      WHERE product_id = ? AND withdrawn_at IS NULL
        AND (until IS NULL OR datetime(until) > datetime('now'))`, [productId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const spent = Number(((await query(
    `SELECT COALESCE(SUM(spent_cents), 0) AS c FROM ai_daily_spend
      WHERE scope = 'product' AND scope_id = ? AND date >= date(?)`,
    [productId, String(row.set_at)])).rows[0] as Record<string, unknown>).c);
  const amount = Number(row.amount_cents);
  return {
    id: String(row.id), statement: String(row.statement), amountCents: amount,
    spentCents: spent, remainingCents: Math.max(0, amount - spent),
    setAt: String(row.set_at).slice(0, 10),
  };
}

export async function setAllowance(input: {
  productId: string; statement: string; amountCents: number; purpose: string;
}): Promise<string> {
  // Replacing rather than refusing: saying a new number is how a person changes
  // a budget, and making him withdraw the old one first would be machinery.
  await query(
    `UPDATE owner_allowances SET withdrawn_at = datetime('now'),
            withdraw_reason = 'the owner set a different amount'
      WHERE product_id = ? AND withdrawn_at IS NULL`, [input.productId]);
  const id = nanoid();
  await query(
    `INSERT INTO owner_allowances (id, product_id, purpose, statement, amount_cents)
     VALUES (?,?,?,?,?)`,
    [id, input.productId, input.purpose.trim(), input.statement.trim(), input.amountCents]);
  return id;
}

export async function withdrawAllowance(id: string, reason: string): Promise<void> {
  await query(
    `UPDATE owner_allowances SET withdrawn_at = datetime('now'), withdraw_reason = ?
      WHERE id = ? AND withdrawn_at IS NULL`, [reason, id]);
}

export interface LivePreference { id: string; statement: string; setAt: string }

export async function preferencesFor(productId: string): Promise<LivePreference[]> {
  return ((await query(
    `SELECT id, statement, set_at FROM owner_preferences
      WHERE product_id = ? AND dropped_at IS NULL ORDER BY rowid`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), statement: String(r.statement), setAt: String(r.set_at).slice(0, 10),
  }));
}

export async function setPreference(input: {
  productId: string; statement: string;
}): Promise<string> {
  const id = nanoid();
  await query('INSERT INTO owner_preferences (id, product_id, statement) VALUES (?,?,?)',
    [id, input.productId, input.statement.trim()]);
  return id;
}

/**
 * STOP. An act on state, not new state.
 *
 * Retires whatever direction is live and says which — because "stop working on
 * that" is only meaningful if he can see what Foundry understood "that" to be.
 * Returns null when there was nothing to stop, which is the honest answer and
 * not a silent success.
 */
export async function stopWhatIsLive(productId: string): Promise<string | null> {
  const live = await objectiveFor(productId);
  if (!live) return null;
  await query(
    `UPDATE owner_objectives SET retired_at = datetime('now'),
            retired_reason = 'the owner said to stop'
      WHERE id = ?`, [live.id]);
  return live.statement;
}

/** What the ceiling used to be, and why it changed. */
export interface FormerAllowance {
  statement: string; amountCents: number; withdrawnAt: string; reason: string;
}

export async function formerAllowanceFor(productId: string): Promise<FormerAllowance | null> {
  const row = (await query(
    `SELECT statement, amount_cents, withdrawn_at, withdraw_reason FROM owner_allowances
      WHERE product_id = ? AND withdrawn_at IS NOT NULL
      ORDER BY withdrawn_at DESC, rowid DESC LIMIT 1`, [productId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    statement: String(row.statement), amountCents: Number(row.amount_cents),
    withdrawnAt: String(row.withdrawn_at).slice(0, 10),
    reason: String(row.withdraw_reason),
  };
}
