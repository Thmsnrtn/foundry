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
import { recordReconstructionClaim } from './reconstruction.js';
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

export interface FounderEvidenceQuestion {
  requestId: string;
  responsibilityId: string;
  responsibilityTitle: string;
  fact: UnderstandingFact;
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
  const responsibilities = await query(
    `SELECT id,title,capability FROM institutional_responsibilities
      WHERE product_id=? AND state='visible' AND disposition='active' ORDER BY created_at,id`,
    [productId],
  );
  if (!responsibilities.rows.length) return null;

  const resolved = await query(
    'SELECT responsibility_id,predicate,status FROM founder_evidence_requests WHERE product_id=?', [productId],
  );
  const settled = new Set((resolved.rows as unknown as Array<Record<string, unknown>>)
    .filter((r) => r.status === 'deferred' || r.status === 'answered')
    .map((r) => `${String(r.responsibility_id)}\n${String(r.predicate)}`));

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
  if (!blocked.length) return null;

  // Closest to understood first. `responsibilities` is already in creation
  // order, and a stable sort keeps that as the tie-break.
  blocked.sort((a, b) => a.askable.length - b.askable.length);
  const target = blocked[0];
  const fact = target.askable[0];
  const id = requestId(productId, target.id, fact);

  const existing = await query('SELECT id FROM founder_evidence_requests WHERE id=?', [id]);
  if (!existing.rows.length) {
    await query(
      'INSERT INTO founder_evidence_requests (id,product_id,responsibility_id,predicate) VALUES (?,?,?,?)',
      [id, productId, target.id, fact],
    );
  }
  return {
    requestId: id, responsibilityId: target.id, responsibilityTitle: target.title, fact,
    because: `I can see "${target.title}" is something this company carries, but I can't tell from anything I have access to`,
    question: QUESTIONS[fact](target.title),
  };
}

/** An open question, resolved server-side from the request id and the
 * authenticated founder. Nothing about the question is caller-supplied. */
export async function getOpenFounderEvidenceRequest(
  requestId: string, founderId: string,
): Promise<{ productId: string; responsibilityId: string; fact: UnderstandingFact } | null> {
  const row = (await query(
    `SELECT q.product_id,q.responsibility_id,q.predicate FROM founder_evidence_requests q
       JOIN products p ON p.id=q.product_id
      WHERE q.id=? AND p.owner_id=? AND q.status='open'`,
    [requestId, founderId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    productId: String(row.product_id), responsibilityId: String(row.responsibility_id),
    fact: String(row.predicate) as UnderstandingFact,
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
}): Promise<{ signalId: string; claimId: string } | null> {
  const statement = input.statement.trim();
  if (!statement) return null;
  const request = await getOpenFounderEvidenceRequest(input.requestId, input.founderId);
  if (!request) return null;

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

  const claimId = await recordReconstructionClaim({
    productId: request.productId,
    subject: `responsibility:${request.responsibilityId}`,
    predicate: request.fact,
    value: { statement },
    epistemicStatus: 'known',
    evidenceRefs: [{ kind: 'signal_event', id: signalId }],
    derivationMethod: 'authenticated founder assertion',
    observedAt: input.now ?? new Date(),
  });
  return { signalId, claimId };
}

/** The founder set the question aside. The fact stays unknown — silence is
 * never read as a negative answer — and Foundry does not ask again. */
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
