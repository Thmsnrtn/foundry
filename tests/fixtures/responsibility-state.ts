// =============================================================================
// FOUNDRY — move a responsibility through the ladder, honestly
//
// Seven test files used to set the state directly:
//
//   UPDATE institutional_responsibilities SET state='assisting' WHERE id=?
//
// Migration 159 closed that door, because a state column writable without a
// transition is the silent redefinition the constitutional invariant names. The
// fixtures were reaching around the same machine the tests were about — so each
// one was asserting behaviour in a state the machine may never have let it
// reach.
//
// This walks the ladder for real: one rung at a time, with evidence that names
// a signal this company actually recorded, and with authority that names a live
// consent for the responsibility's own capability. If a state is unreachable,
// the fixture fails here rather than the test passing on a state that could not
// exist.
// =============================================================================

import { nanoid } from 'nanoid';

import { query } from '../../src/db/client.js';

const LADDER = ['unknown', 'visible', 'understood', 'shadowing', 'assisting'] as const;
export type ReachableState = typeof LADDER[number];

/** A signal event for this company. Returns the raw id — the two consumers want
 *  it in different shapes: `evidence_ref` wants the `signal_event:<id>` string,
 *  and a reconstruction claim's evidence list wants `{kind, id}` objects, which
 *  its guard destructures with `json_extract(..., '$.kind')`. Handing the string
 *  form to the claim is what produces a bare "malformed JSON" from SQLite. */
export async function recordSignal(productId: string, summary = 'Observed'): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO signal_events (id, product_id, source, event_type, severity, payload_json, summary)
     VALUES (?, ?, 'stripe', 'payment_failed', 'medium', '{}', ?)`,
    [id, productId, summary]);
  return id;
}

/** The same thing in the form a transition's `evidence_ref` takes. */
export async function recordEvidence(productId: string, summary = 'Observed'): Promise<string> {
  return `signal_event:${await recordSignal(productId, summary)}`;
}

/** A live act-consent for this capability, so `authority_ref` names something
 *  the reference guard will accept. */
export async function grantAuthority(
  productId: string, founderId: string, capability: string, responsibilityId?: string,
): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO autonomy_consents
       (id, founder_id, product_id, capability, from_mode, to_mode, disclosure_version,
        responsibility_id, allowed_scope_json, consequence_boundary, expires_at)
     VALUES (?, ?, ?, ?, 'suggest', 'act', 'test', ?, ?, 'low', datetime('now','+1 day'))`,
    [id, founderId, productId, capability, responsibilityId ?? null,
      JSON.stringify(['send_email:responsibility_notice'])]);
  return `autonomy_consent:${id}`;
}

/**
 * SHADOW PROOF, NOT A SHORTCUT.
 *
 * Entering 'assisting' requires evidence that is a shadow COMPARISON — Foundry
 * may only be trusted to assist with something it has been watched doing — and
 * the expectation behind it must rest on a reconstruction claim. Building that
 * is most of this helper, and it is the part the old fixtures skipped: they
 * wrote `state='assisting'` with no shadow record of any kind.
 *
 * The order is forced by the guards: an expectation may only be created while
 * the responsibility is 'understood', and a comparison only while 'shadowing'.
 */
async function shadowProof(responsibilityId: string, productId: string): Promise<string> {
  const claimId = nanoid();
  await query(
    `INSERT INTO reconstruction_claims
       (id, product_id, subject, predicate, value_json, epistemic_status, confidence,
        evidence_refs_json, derivation_method, observed_at)
     VALUES (?, ?, 'support', 'is_answered_within', ?, 'known', 0.9, ?, 'test fixture', datetime('now'))`,
    [claimId, productId, JSON.stringify('1 day'),
      JSON.stringify([{ kind: 'signal_event', id: await recordSignal(productId, 'claim basis') }])]);

  const expectationId = nanoid();
  await query(
    `INSERT INTO responsibility_shadow_expectations
       (id, responsibility_id, product_id, expected_event_type,
        expectation_evidence_ref, observation_source_evidence_ref)
     VALUES (?, ?, ?, 'support_restored', ?, ?)`,
    [expectationId, responsibilityId, productId, `reconstruction_claim:${claimId}`,
      await recordEvidence(productId, 'observation source')]);

  // The comparison can only be written once the responsibility is shadowing.
  await query(
    `INSERT INTO responsibility_transitions
       (id, responsibility_id, from_state, to_state, evidence_ref, reason, actor_ref)
     VALUES (?, ?, 'understood', 'shadowing', ?, 'test fixture', 'test')`,
    [nanoid(), responsibilityId, await recordEvidence(productId, 'reached shadowing')]);

  const comparisonId = nanoid();
  await query(
    `INSERT INTO responsibility_shadow_comparisons
       (id, expectation_id, product_id, observation_ref, classification)
     VALUES (?, ?, ?, ?, 'matched')`,
    [comparisonId, expectationId, productId, await recordEvidence(productId, 'what happened')]);

  return `shadow_comparison:${comparisonId}`;
}

/**
 * Walk a responsibility up to `target`, one rung at a time, through real
 * transitions with evidence the guards accept.
 *
 * `authorityRef` is required when the target is 'assisting' — pass one from
 * `grantAuthority`, bound to this responsibility. Supplying authority below that
 * rung is refused by the state machine, so it is attached only where it belongs.
 */
export async function moveResponsibilityTo(
  responsibilityId: string,
  target: ReachableState,
  opts: { productId: string; authorityRef?: string },
): Promise<void> {
  const row = (await query(
    'SELECT state FROM institutional_responsibilities WHERE id = ?', [responsibilityId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`no responsibility ${responsibilityId}`);

  let from = String(row.state) as ReachableState;
  const targetIndex = LADDER.indexOf(target);
  if (targetIndex < 0) throw new Error(`${target} is not on the walkable ladder`);

  while (LADDER.indexOf(from) < targetIndex) {
    const to = LADDER[LADDER.indexOf(from) + 1];

    if (to === 'assisting') {
      if (!opts.authorityRef) {
        throw new Error('assisting requires an authority_ref — pass one from grantAuthority()');
      }
      // shadowProof leaves the responsibility at 'shadowing' and hands back the
      // comparison that entitles the next rung.
      const evidenceRef = from === 'shadowing'
        ? await shadowProofFromShadowing(responsibilityId, opts.productId)
        : await shadowProof(responsibilityId, opts.productId);
      await query(
        `INSERT INTO responsibility_transitions
           (id, responsibility_id, from_state, to_state, evidence_ref, authority_ref, reason, actor_ref)
         VALUES (?, ?, 'shadowing', 'assisting', ?, ?, 'test fixture', 'test')`,
        [nanoid(), responsibilityId, evidenceRef, opts.authorityRef]);
      from = 'assisting';
      continue;
    }

    await query(
      `INSERT INTO responsibility_transitions
         (id, responsibility_id, from_state, to_state, evidence_ref, reason, actor_ref)
       VALUES (?, ?, ?, ?, ?, 'test fixture', 'test')`,
      [nanoid(), responsibilityId, from, to, await recordEvidence(opts.productId, `reached ${to}`)]);
    from = to;
  }
}

/** A responsibility already sitting at 'shadowing' has to step back to
 *  'understood' to have an expectation written for it, because the expectation
 *  guard insists on watching something you have not yet been trusted with. The
 *  demotion is a real transition and is recorded as one. */
async function shadowProofFromShadowing(
  responsibilityId: string, productId: string,
): Promise<string> {
  await query(
    `INSERT INTO responsibility_transitions
       (id, responsibility_id, from_state, to_state, evidence_ref, reason, actor_ref)
     VALUES (?, ?, 'shadowing', 'understood', ?, 'test fixture: stepping back to record a shadow expectation', 'test')`,
    [nanoid(), responsibilityId, await recordEvidence(productId, 'stepping back')]);
  return shadowProof(responsibilityId, productId);
}


/**
 * Put a responsibility into Shadowing with a stated set of comparison verdicts.
 *
 * The order matters and the guards enforce it: an expectation may only be
 * written while the responsibility is UNDERSTOOD, and a comparison only once it
 * is SHADOWING. So every expectation is created first, then the rung is
 * climbed, then the verdicts are recorded. A fixture that tried to add a fourth
 * comparison later would be refused, which is correct — Foundry cannot decide
 * after the fact what it had expected.
 */
export async function shadowWithVerdicts(
  responsibilityId: string,
  productId: string,
  classifications: Array<'matched' | 'deviated'>,
): Promise<void> {
  await moveResponsibilityTo(responsibilityId, 'understood', { productId });

  const expectationIds: string[] = [];
  for (const _ of classifications) {
    const claimId = nanoid();
    await query(
      `INSERT INTO reconstruction_claims
         (id, product_id, subject, predicate, value_json, epistemic_status, confidence,
          evidence_refs_json, derivation_method, observed_at)
       VALUES (?, ?, 'support', 'is_answered_within', ?, 'known', 0.9, ?, 'test fixture', datetime('now'))`,
      [claimId, productId, JSON.stringify('1 day'),
        JSON.stringify([{ kind: 'signal_event', id: await recordSignal(productId, 'claim basis') }])]);
    const expectationId = nanoid();
    await query(
      `INSERT INTO responsibility_shadow_expectations
         (id, responsibility_id, product_id, expected_event_type,
          expectation_evidence_ref, observation_source_evidence_ref)
       VALUES (?, ?, ?, 'support_restored', ?, ?)`,
      [expectationId, responsibilityId, productId, `reconstruction_claim:${claimId}`,
        await recordEvidence(productId, 'observation source')]);
    expectationIds.push(expectationId);
  }

  await query(
    `INSERT INTO responsibility_transitions
       (id, responsibility_id, from_state, to_state, evidence_ref, reason, actor_ref)
     VALUES (?, ?, 'understood', 'shadowing', ?, 'test fixture', 'test')`,
    [nanoid(), responsibilityId, await recordEvidence(productId, 'reached shadowing')]);

  for (let i = 0; i < classifications.length; i++) {
    await query(
      `INSERT INTO responsibility_shadow_comparisons
         (id, expectation_id, product_id, observation_ref, classification)
       VALUES (?, ?, ?, ?, ?)`,
      [nanoid(), expectationIds[i], productId,
        await recordEvidence(productId, 'what happened'), classifications[i]]);
  }
}
