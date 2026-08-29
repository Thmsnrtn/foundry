// =============================================================================
// FOUNDRY — Progressive founder evidence elicitation (migration 125)
//
// Foundry could recognise a responsibility from real company evidence and then
// go no further, because understanding one requires facts no connected system
// observes: what it is for, what a good outcome looks like, what must never
// happen while carrying it. Those live with the founder.
//
// This asks for exactly one of them at a time, and only when the institution
// genuinely requires it. The path is the ordinary one:
//
//   observed reality → responsibility → the exact missing fact
//     → one contextual question → authenticated answer
//     → canonical evidence (a signal event) → a bounded claim
//     → the existing understanding projection
//
// Three things it deliberately does NOT do:
//
//   • It does not decide what is missing with a model. The institution's own
//     understanding requirements already encode that, per capability, and a
//     deterministic reading of them is both cheaper and auditable.
//   • It does not write Understanding state. It produces evidence; whether that
//     evidence is now sufficient is the existing projection's judgment, and the
//     transition still has to be earned.
//   • It does not generalise. The founder's own words are retained as evidence,
//     and the claim derived from them is scoped to the one responsibility that
//     was asked about — never promoted into company-wide policy.
// =============================================================================

import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { getReconstructionClaims, recordReconstructionClaim } from './reconstruction.js';
import {
  projectResponsibilityUnderstanding, requiredUnderstandingFacts, type UnderstandingFact,
} from './responsibility-understanding.js';

/** Plain questions in the founder's language. No internal vocabulary appears
 * here — not "predicate", not "epistemic", not a rung name. The founder is
 * being asked about their company, not about Foundry. */
const QUESTIONS: Record<UnderstandingFact, (title: string) => string> = {
  purpose: (t) => `What is "${t}" actually for?`,
  desired_outcome: (t) => `When "${t}" goes well, what has happened?`,
  success_conditions: (t) => `How would you know "${t}" is being handled properly?`,
  failure_conditions: (t) => `What would tell you "${t}" has gone wrong?`,
  operating_constraints: (t) => `What must never happen while handling "${t}"?`,
  dependencies: (t) => `What does "${t}" depend on to get done?`,
  systems: (t) => `Which systems or tools does "${t}" run through?`,
  current_carrier: (t) => `Who handles "${t}" today?`,
  commitments: (t) => `Has someone been promised something about "${t}"?`,
  authority_requirements: (t) => `What decisions about "${t}" would you want to make yourself?`,
  capability_requirements: (t) => `What does someone need to know or be able to do to handle "${t}"?`,
  risks: (t) => `What is the main thing that could go wrong with "${t}"?`,
  failure_modes: (t) => `When "${t}" goes wrong, how does it usually go wrong?`,
  stakeholder_obligations: (t) => `Who is owed something when "${t}" is handled?`,
  financial_consequence: (t) => `What does it cost the company when "${t}" is not handled?`,
};

/** Where a fact belongs. Scope follows the meaning of the evidence: what one
 * piece of work costs is about that work; what the company has in total is
 * about the company, and duplicating it per responsibility would let the same
 * fact disagree with itself. */
export type EvidenceScope = 'responsibility' | 'company';

/** Facts Foundry may ask about: the institution's understanding requirements,
 * plus the two inputs deterministic capacity judgment reads. */
export type AskableFact = UnderstandingFact | 'resource_demand' | 'resource_capacity';

export interface FounderEvidenceQuestion {
  requestId: string;
  responsibilityId: string;
  responsibilityTitle: string;
  fact: AskableFact;
  scope: EvidenceScope;
  /** `resource_amount` questions collect a bounded structure rather than prose:
   * a resource in the founder's own words and a number. */
  answerShape: 'text' | 'resource_amount';
  /** Why Foundry is asking, in one line the founder can evaluate. */
  because: string;
  question: string;
}

function requestId(productId: string, responsibilityId: string, fact: string): string {
  return 'feq_' + createHash('sha256')
    .update([productId, responsibilityId, fact].join('\n')).digest('hex').slice(0, 32);
}

/**
 * The one question worth the founder's attention right now, or null.
 *
 * Prioritisation is deterministic and defensible rather than invented: among
 * responsibilities that are blocked only for want of facts, the one closest to
 * being understood goes first, because a single answer unblocks it. Ties break
 * by how long the responsibility has been waiting, then by the institution's
 * own ordering of required facts.
 *
 * Attention rules, all of them subtractive:
 *   • one question, ever, at a time;
 *   • an already-open question is returned unchanged, never re-created, so
 *     refreshing does not produce a new question;
 *   • a fact that is already grounded is never asked about;
 *   • a question the founder set aside is not asked again — silence stays
 *     unknown, and Foundry does not nag;
 *   • conflicting facts are not asked about at all. A conflict must be
 *     preserved, not overwritten by soliciting a third opinion.
 */
export async function selectFounderEvidenceQuestion(
  productId: string, now: Date = new Date(),
): Promise<FounderEvidenceQuestion | null> {
  const opportunities = await factOpportunities(productId, now);
  if (!opportunities.length) return null;
  const first = opportunities[0];
  return openQuestion(productId, first.responsibilityId, first.responsibilityTitle,
    first.fact, first.scope, first.resource);
}

/** A fact the institution currently needs, before any question has been put to
 * the founder. Computing these writes nothing. */
export interface FactOpportunity {
  responsibilityId: string; responsibilityTitle: string;
  fact: AskableFact; scope: EvidenceScope; resource?: string;
}

/**
 * Everything Foundry is currently blocked on, highest value first — pure, with
 * no side effect.
 *
 * The order is the institution's own: facts that stand between a responsibility
 * and being understood come first (closest to understood leads, since one
 * answer unblocks it), then the inputs a judgment cannot be computed without.
 * Nothing appears here because a field exists; every entry has a consumer that
 * is waiting on it.
 */
async function factOpportunities(productId: string, now: Date): Promise<FactOpportunity[]> {
  const responsibilities = await query(
    `SELECT id,title,capability FROM institutional_responsibilities
      WHERE product_id=? AND state='visible' AND disposition='active' ORDER BY created_at,id`,
    [productId],
  );
  const resolved = await query(
    'SELECT responsibility_id,predicate,status,scope FROM founder_evidence_requests WHERE product_id=?', [productId],
  );
  // A company fact is settled for the whole company, not for the responsibility
  // that happened to surface it.
  const settled = new Set((resolved.rows as unknown as Array<Record<string, unknown>>)
    .filter((r) => r.status === 'deferred' || r.status === 'answered')
    .map((r) => `${r.scope === 'company' ? 'company' : String(r.responsibility_id)}\n${String(r.predicate)}`));

  const blocked: Array<{ id: string; title: string; askable: UnderstandingFact[] }> = [];
  for (const row of responsibilities.rows as unknown as Array<Record<string, unknown>>) {
    const id = String(row.id);
    const understanding = await projectResponsibilityUnderstanding(productId, id, now);
    const grounded = new Map(understanding.facts.map((f) => [f.predicate, f.epistemicStatus]));
    const askable = requiredUnderstandingFacts(String(row.capability)).filter((fact) => {
      const status = grounded.get(fact);
      // Missing entirely, explicitly unknown, or expired — all genuinely open.
      // Conflicting is excluded on purpose: asking would not settle it.
      if (status !== undefined && !['unknown', 'stale'].includes(status)) return false;
      return !settled.has(`${id}\n${fact}`);
    });
    if (askable.length) blocked.push({ id, title: String(row.title), askable });
  }
  // Closest to understood first. `responsibilities` is already in creation
  // order, and a stable sort keeps that as the tie-break.
  blocked.sort((a, b) => a.askable.length - b.askable.length);
  const out: FactOpportunity[] = blocked.map((b) => ({
    responsibilityId: b.id, responsibilityTitle: b.title, fact: b.askable[0], scope: 'responsibility' as const,
  }));
  return [...out, ...await judgmentInputOpportunities(productId, settled)];
}

export async function listFounderFactOpportunities(
  productId: string, now: Date = new Date(), limit = 5,
): Promise<Array<FactOpportunity & { question: string; answerShape: 'text' | 'resource_amount' }>> {
  return (await factOpportunities(productId, now)).slice(0, limit).map((o) => ({
    ...o,
    question: questionFor(o.fact, o.responsibilityTitle, o.resource),
    answerShape: answerShapeFor(o.fact),
  }));
}

/**
 * The inputs deterministic capacity judgment needs, offered only when a
 * judgment is genuinely blocked for want of them.
 *
 * The order is what makes this not a questionnaire. What one piece of work
 * costs is asked only once a company carries more than one understood
 * responsibility — a company with one has no capacity conflict to detect. What
 * the company *has* is asked only once two of those costs compete for the same
 * resource, which is the exact moment the question stops being curiosity and
 * starts being the one fact standing between Foundry and a real judgment.
 */
async function judgmentInputOpportunities(
  productId: string, settled: Set<string>,
): Promise<FactOpportunity[]> {
  const understood = (await query(
    `SELECT id,title FROM institutional_responsibilities
      WHERE product_id=? AND state IN ('understood','shadowing') AND disposition='active'
      ORDER BY created_at,id`, [productId],
  )).rows as unknown as Array<Record<string, unknown>>;
  if (understood.length < 2) return []; // no conflict is possible

  const claims = await getReconstructionClaims(productId);
  const demands = new Map<string, string>(); // responsibilityId → resource
  let hasCapacity = false;
  for (const claim of claims) {
    if (claim.predicate === 'resource_capacity' && claim.subject === `product:${productId}`
      && !['unknown', 'stale'].includes(claim.epistemicStatus)) hasCapacity = true;
    if (claim.predicate === 'resource_demand' && !['unknown', 'stale'].includes(claim.epistemicStatus)) {
      const value = claim.value as { resource?: unknown };
      const owner = claim.subject.startsWith('responsibility:') ? claim.subject.slice('responsibility:'.length) : null;
      if (owner && typeof value?.resource === 'string') demands.set(owner, value.resource);
    }
  }

  const out: FactOpportunity[] = [];
  // What does this piece of work cost? Offered per responsibility, in order.
  for (const row of understood) {
    const id = String(row.id);
    if (demands.has(id) || settled.has(`${id}\nresource_demand`)) continue;
    out.push({
      responsibilityId: id, responsibilityTitle: String(row.title),
      fact: 'resource_demand', scope: 'responsibility',
    });
  }

  // Two costs now compete for the same resource, and Foundry cannot say whether
  // the company can afford both.
  if (hasCapacity || settled.has('company\nresource_capacity')) return out;
  const contested = [...demands.values()].find((resource) =>
    [...demands.values()].filter((other) => other === resource).length > 1);
  if (!contested) return out;
  const blockedBy = [...demands.entries()].find(([, resource]) => resource === contested)!;
  out.push({
    responsibilityId: blockedBy[0],
    responsibilityTitle: String(understood.find((r) => String(r.id) === blockedBy[0])?.title ?? ''),
    fact: 'resource_capacity', scope: 'company', resource: contested,
  });
  return out;
}

function answerShapeFor(fact: AskableFact): 'text' | 'resource_amount' {
  return fact === 'resource_demand' || fact === 'resource_capacity' ? 'resource_amount' : 'text';
}

function questionFor(fact: AskableFact, title: string, resource?: string): string {
  if (fact === 'resource_capacity') return `How much ${resource ?? 'of that'} does the company have in a week, in total?`;
  if (fact === 'resource_demand') return `Roughly what does "${title}" take to keep up — of what, and how much per week?`;
  return QUESTIONS[fact](title);
}

async function openQuestion(
  productId: string, responsibilityId: string, responsibilityTitle: string,
  fact: AskableFact, scope: EvidenceScope, resource?: string,
): Promise<FounderEvidenceQuestion> {
  // A company fact has one question however many responsibilities need it, so
  // its identity does not include the responsibility that happened to surface it.
  const id = scope === 'company'
    ? requestId(productId, 'company', fact)
    : requestId(productId, responsibilityId, fact);

  const existing = await query('SELECT id FROM founder_evidence_requests WHERE id=?', [id]);
  if (!existing.rows.length) {
    await query(
      'INSERT INTO founder_evidence_requests (id,product_id,responsibility_id,predicate,scope) VALUES (?,?,?,?,?)',
      [id, productId, responsibilityId, fact, scope],
    );
  }
  const because = scope === 'company'
    ? `More than one thing this company carries needs the same ${resource ?? 'resource'}, and I can't tell how much of it you actually have`
    : fact === 'resource_demand'
      ? `You carry more than one thing at once, and I can't tell what "${responsibilityTitle}" costs to keep up`
      : `I can see "${responsibilityTitle}" is something this company carries, but I can't tell from anything I have access to`;
  return {
    requestId: id, responsibilityId, responsibilityTitle, fact, scope,
    answerShape: answerShapeFor(fact), because,
    question: questionFor(fact, responsibilityTitle, resource),
  };
}

/**
 * Exactly what Foundry will remember, in one sentence, before it remembers
 * anything. Pure: showing the founder a proposal must not create evidence.
 */
export function previewFounderFact(input: {
  fact: AskableFact; scope: EvidenceScope; responsibilityTitle: string;
  statement: string; resource?: string; amount?: number;
}): string | null {
  const statement = input.statement.trim();
  if (!statement) return null;
  const about = input.scope === 'company' ? 'this company' : `"${input.responsibilityTitle}"`;
  if (answerShapeFor(input.fact) === 'resource_amount') {
    const resource = input.resource?.trim();
    if (!resource || !Number.isFinite(input.amount) || (input.amount as number) < 0) return null;
    return input.fact === 'resource_capacity'
      ? `${about} has ${input.amount} ${resource} a week in total — ${statement}`
      : `Keeping up ${about} takes about ${input.amount} ${resource} a week — ${statement}`;
  }
  return `About ${about}: ${statement}`;
}

/**
 * The founder deliberately tells Foundry a currently relevant bounded fact.
 *
 * This is the founder-initiated half of the same path Foundry uses when it
 * asks: the fact must be one an institutional consumer is currently waiting on,
 * it opens the same request, and it is recorded through the same authenticated
 * answer. There is no separate store of founder knowledge, and no way to state
 * a fact nothing consumes.
 */
export async function submitFounderFact(input: {
  productId: string; founderId: string; fact: string; scope: string;
  responsibilityId: string; statement: string; resource?: string; amount?: number; now?: Date;
}): Promise<{ signalId: string; claimId: string } | null> {
  const owned = await query('SELECT 1 FROM products WHERE id=? AND owner_id=?',
    [input.productId, input.founderId]);
  if (!owned.rows.length) return null;

  // Only a fact something is actually waiting on. A founder cannot volunteer
  // into a predicate the institution does not consume, and cannot restate one
  // that is already grounded.
  const opportunity = (await factOpportunities(input.productId, input.now ?? new Date()))
    .find((o) => o.fact === input.fact && o.scope === input.scope
      && o.responsibilityId === input.responsibilityId);
  if (!opportunity) return null;

  const question = await openQuestion(input.productId, opportunity.responsibilityId,
    opportunity.responsibilityTitle, opportunity.fact, opportunity.scope, opportunity.resource);
  return recordFounderEvidenceAnswer({
    requestId: question.requestId, founderId: input.founderId, statement: input.statement,
    resource: input.resource, amount: input.amount, now: input.now,
  });
}

/**
 * An unanswered question, resolved server-side from the request id and the
 * authenticated founder. Nothing about the question is caller-supplied.
 *
 * DEFERRED COUNTS AS UNANSWERED. This asked for `status='open'`, which turned
 * "Foundry does not ask again" into "the founder can never tell it". Skipping
 * is a decision about being asked, not a decision to withhold the fact for
 * good — and the fact itself is load-bearing: a required understanding fact
 * that stays unknown keeps its responsibility out of Shadowing and therefore
 * out of Assisting, permanently and silently. One hurried click foreclosed a
 * responsibility.
 *
 * Not asking again is preserved: `factOpportunities` still treats a deferred
 * request as settled, so nothing puts the question back in front of them. The
 * founder reaches it by choosing to.
 */
export async function getOpenFounderEvidenceRequest(
  requestId: string, founderId: string,
): Promise<{ productId: string; responsibilityId: string; fact: AskableFact; scope: EvidenceScope } | null> {
  const row = (await query(
    `SELECT q.product_id,q.responsibility_id,q.predicate,q.scope FROM founder_evidence_requests q
       JOIN products p ON p.id=q.product_id
      WHERE q.id=? AND p.owner_id=? AND q.status IN ('open','deferred')`,
    [requestId, founderId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    productId: String(row.product_id), responsibilityId: String(row.responsibility_id),
    fact: String(row.predicate) as AskableFact, scope: String(row.scope) as EvidenceScope,
  };
}

/**
 * Record an authenticated founder answer as canonical evidence, then derive the
 * one bounded claim it justifies.
 *
 * The founder's actual words are kept in the evidence. The claim is scoped to
 * the single responsibility that was asked about — a founder saying what one
 * responsibility is for does not become a statement about the company.
 */
export async function recordFounderEvidenceAnswer(input: {
  requestId: string; founderId: string; statement: string; now?: Date;
  /** Bounded structure for `resource_amount` questions. Prose is kept as the
   * evidence either way; this is what makes the answer usable as an input
   * rather than only as a description. */
  resource?: string; amount?: number;
}): Promise<{ signalId: string; claimId: string } | null> {
  const statement = input.statement.trim();
  if (!statement) return null;
  const request = await getOpenFounderEvidenceRequest(input.requestId, input.founderId);
  if (!request) return null;

  // A structured question needs its structure. Recording a resource question as
  // prose would leave a claim that reads well and cannot be used, which is
  // worse than not having asked.
  const structured = request.fact === 'resource_demand' || request.fact === 'resource_capacity';
  const resource = input.resource?.trim();
  if (structured && (!resource || !Number.isFinite(input.amount) || (input.amount as number) < 0)) return null;

  const signalId = nanoid();
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES (?,?,'founder_assertion',?,'low',?,?)`,
    [signalId, request.productId, `founder_stated:${request.fact}`,
      JSON.stringify({
        request_id: input.requestId, predicate: request.fact,
        statement, founder_id: input.founderId, responsibility_id: request.responsibilityId,
      }),
      `The founder answered a question about this responsibility`],
  );
  await query(
    "UPDATE founder_evidence_requests SET status='answered',answer_signal_id=?,resolved_at=CURRENT_TIMESTAMP WHERE id=?",
    [signalId, input.requestId],
  );

  // Scope follows the meaning of the evidence. A company-wide fact is recorded
  // once, about the company, and referenced by every responsibility and
  // judgment that needs it — never copied into each of them, where the same
  // fact could then disagree with itself.
  const claimId = await recordReconstructionClaim({
    productId: request.productId,
    subject: request.scope === 'company'
      ? `product:${request.productId}` : `responsibility:${request.responsibilityId}`,
    predicate: request.fact,
    value: structured ? { resource, amount: input.amount, statement } : { statement },
    epistemicStatus: 'known',
    evidenceRefs: [{ kind: 'signal_event', id: signalId }],
    derivationMethod: 'authenticated founder assertion',
    observedAt: input.now ?? new Date(),
  });
  return { signalId, claimId };
}

/**
 * The founder set the question aside. The fact stays unknown — silence is never
 * read as a negative answer — and Foundry does not ask again.
 *
 * Not asking again is not the same as never being told. `getSetAsideQuestions`
 * lists these where the founder can find them, and the answer path takes them:
 * see migration 169 for why treating a skip as final foreclosed a
 * responsibility permanently and silently.
 */
export async function deferFounderEvidenceRequest(
  requestId: string, founderId: string,
): Promise<boolean> {
  const request = await getOpenFounderEvidenceRequest(requestId, founderId);
  if (!request) return false;
  await query(
    "UPDATE founder_evidence_requests SET status='deferred',resolved_at=CURRENT_TIMESTAMP WHERE id=?",
    [requestId],
  );
  return true;
}

/**
 * Questions the founder set aside, so they can find them again.
 *
 * Foundry does not re-ask these — `factOpportunities` still treats them as
 * settled. This is the other half of that: a list the founder chooses to look
 * at, on a surface that does not interrupt. Retrievable is not the same as
 * being asked.
 *
 * Ordered oldest first: the one set aside longest has been blocking longest.
 */
export async function getSetAsideQuestions(
  productId: string, limit = 10,
): Promise<Array<{
  requestId: string; responsibilityId: string; responsibilityTitle: string;
  fact: AskableFact; question: string; answerShape: 'text' | 'resource_amount';
}>> {
  const rows = await query(
    `SELECT q.id,q.responsibility_id,q.predicate,r.title
       FROM founder_evidence_requests q
       JOIN institutional_responsibilities r
         ON r.id=q.responsibility_id AND r.product_id=q.product_id
      WHERE q.product_id=? AND q.status='deferred' AND r.disposition='active'
      ORDER BY q.resolved_at, q.id LIMIT ?`,
    [productId, limit],
  );
  return (rows.rows as unknown as Array<Record<string, unknown>>).map((row) => {
    const fact = String(row.predicate) as AskableFact;
    const title = String(row.title);
    return {
      requestId: String(row.id), responsibilityId: String(row.responsibility_id),
      responsibilityTitle: title, fact,
      question: questionFor(fact, title),
      answerShape: answerShapeFor(fact),
    };
  });
}

// ─── WHAT FOUNDRY BELIEVES, AND HOW TO CORRECT IT ────────────────────────────
//
// Nothing showed the founder the facts Foundry holds about a responsibility,
// and nothing let them change one. `submitFounderFact` says so on its face —
// "cannot restate one that is already grounded" — which is the right guard for
// the path it protects and left a company fact write-once. A founder who
// mis-stated a fact, or whose company changed, had no door; and Foundry goes on
// to ask for authority on the strength of those facts.
//
// No claim in this system is ever given a `valid_until`, so an understanding
// does not age either: what a founder said once is current forever, and the
// freshness condition at the authority boundary is always satisfied. Inventing
// an expiry would be Foundry deciding how old a company fact may be — purpose
// ages slowly, dependencies quickly — so what is offered instead is the date
// and a way to correct it.
//
// THE INSTITUTION HAD ALREADY ANSWERED THIS ONE FUNCTION AWAY. Deferring a
// question used to be final, and the fix was not to re-ask: "Not asking again
// is preserved... The founder reaches it by choosing to." The same answer
// applies here. Foundry never re-asks a grounded fact, and the founder can
// reach it.

export interface UnderstandingViewFact {
  fact: UnderstandingFact;
  /** What the founder said, or null where nothing has been stated. */
  statement: string | null;
  observedAt: string | null;
  epistemicStatus: string | null;
}

export interface UnderstandingView {
  responsibilityId: string; title: string; capability: string; state: string;
  facts: UnderstandingViewFact[];
  /** Whether THIS viewer may correct a fact. Seeing is not correcting: a
   *  co-founder reads the company's letter, and the owner states what the
   *  company is. Migration 220 enforces the same boundary independently. */
  mayCorrect: boolean;
}

/** The statement inside a stored understanding value, whatever its shape. */
function statementOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'statement' in value) {
    const inner = (value as { statement?: unknown }).statement;
    if (typeof inner === 'string') return inner;
  }
  return null;
}

/**
 * Every fact this responsibility's capability requires, and what Foundry
 * currently believes about each.
 *
 * The belief is the LATEST claim per predicate, which is the same rule
 * `projectResponsibilityUnderstanding` applies internally to decide what it
 * knows — read from the same projection rather than re-derived, so the page and
 * the institution cannot come to disagree about what Foundry believes.
 */
export async function getFounderUnderstandingView(input: {
  productId: string; responsibilityId: string; founderId: string; now?: Date;
}): Promise<UnderstandingView | null> {
  // VISIBILITY IS NOT CAPABILITY, AND THIS ASKED THE WRONG ONE.
  //
  // The Letter resolves which company you are looking at through
  // `getVisibleProducts` — owner OR an accepted team member — so a co-founder
  // reads it daily. This page asked `owner_id` alone, so every responsibility
  // card offered them "What I understand about this" and answered 404: the
  // same answer Foundry gives for another company's responsibility. That is
  // the defect `getVisibleProducts` was created to fix, reintroduced one
  // surface later, which is why the rule is read from where it lives.
  //
  // Correcting stays the owner's. The page says so rather than offering a form
  // that fails.
  const viewer = (await query(
    `SELECT p.owner_id FROM products p WHERE p.id=? AND (p.owner_id=? OR EXISTS (
       SELECT 1 FROM team_members t
        WHERE t.product_id=p.id AND t.founder_id=? AND t.status='active'))`,
    [input.productId, input.founderId, input.founderId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!viewer) return null;
  const mayCorrect = String(viewer.owner_id) === input.founderId;

  let understanding;
  try {
    understanding = await projectResponsibilityUnderstanding(
      input.productId, input.responsibilityId, input.now ?? new Date());
  } catch {
    // A responsibility of another company, or none at all. Both answer the
    // same, so asking cannot reveal which.
    return null;
  }

  const current = new Map(understanding.facts.map((f) => [f.predicate, f]));
  return {
    responsibilityId: input.responsibilityId,
    title: understanding.responsibility.title,
    capability: understanding.responsibility.capability,
    state: understanding.responsibility.state,
    mayCorrect,
    facts: understanding.requiredFacts.map((fact) => {
      const held = current.get(fact);
      return {
        fact,
        statement: held ? statementOf(held.value) : null,
        observedAt: held ? held.observedAt : null,
        epistemicStatus: held ? held.epistemicStatus : null,
      };
    }),
  };
}

/**
 * The founder corrects a fact Foundry already holds.
 *
 * DELIBERATELY NOT `recordFounderEvidenceAnswer`, AND THE DATABASE AGREES.
 * Migration 125 requires a `founder_assertion` to name an OPEN request of this
 * company for this predicate — that requirement is what makes a replayed answer
 * inert, and it is not something to work around. Reopening the answered request
 * would also put the question back in front of the founder, undoing the rule
 * that Foundry does not ask again.
 *
 * So a correction is its own source with its own guard (migration 220), held to
 * the same standards: real ownership rather than a caller-supplied founder
 * string, a responsibility of this company, and a predicate its capability
 * requires. The CLAIM is identical in shape to an answered one — same subject,
 * predicate, status and derivation method — so nothing downstream needs a
 * second way of knowing a fact. Only the provenance differs, which is the part
 * that should: the record says whether Foundry asked or the founder came back.
 * Two writers of one claim shape is a defect unless something compares them,
 * so a test does.
 *
 * The scope of the check is what makes replay harmless: the responsibility must
 * belong to this founder's company, and the predicate must be one its
 * capability actually requires. A caller cannot volunteer into a predicate the
 * institution does not consume, which is the property `submitFounderFact`
 * bought with "must currently be open" — held here without foreclosing
 * revision.
 */
export async function reviseFounderFact(input: {
  productId: string; founderId: string; responsibilityId: string;
  fact: string; statement: string; now?: Date;
}): Promise<{ signalId: string; claimId: string } | null> {
  const statement = input.statement.trim();
  if (!statement) return null;

  const owned = (await query(
    `SELECT r.capability FROM institutional_responsibilities r
       JOIN products p ON p.id=r.product_id
      WHERE r.id=? AND r.product_id=? AND p.owner_id=?`,
    [input.responsibilityId, input.productId, input.founderId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!owned) return null;

  const required = requiredUnderstandingFacts(String(owned.capability));
  if (!required.includes(input.fact as UnderstandingFact)) return null;

  const signalId = nanoid();
  try {
    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES (?,?,'founder_correction',?,'low',?,?)`,
      [signalId, input.productId, `founder_corrected:${input.fact}`,
        JSON.stringify({
          predicate: input.fact, statement, founder_id: input.founderId,
          responsibility_id: input.responsibilityId,
        }),
        'The founder corrected something they had told me about this responsibility'],
    );
  } catch {
    // Migration 220 re-checks ownership independently and refuses a correction
    // to a fact nothing has ever stated. Stating one for the first time is
    // answering a question, and goes the other way.
    return null;
  }
  const claimId = await recordReconstructionClaim({
    productId: input.productId,
    subject: `responsibility:${input.responsibilityId}`,
    predicate: input.fact,
    value: { statement },
    epistemicStatus: 'known',
    evidenceRefs: [{ kind: 'signal_event', id: signalId }],
    derivationMethod: 'authenticated founder assertion',
    observedAt: input.now ?? new Date(),
  });
  return { signalId, claimId };
}
