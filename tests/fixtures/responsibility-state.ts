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
import {
  reportCompanyObligation, type ReportableObligation,
} from '../../src/services/founder/company-report.js';

const LADDER = ['unknown', 'visible', 'understood', 'shadowing', 'assisting'] as const;
export type ReachableState = typeof LADDER[number];

/** A signal event for this company. Returns the raw id — the two consumers want
 *  it in different shapes: `evidence_ref` wants the `signal_event:<id>` string,
 *  and a reconstruction claim's evidence list wants `{kind, id}` objects, which
 *  its guard destructures with `json_extract(..., '$.kind')`. Handing the string
 *  form to the claim is what produces a bare "malformed JSON" from SQLite.
 *
 *  The source/event pair is one production actually writes
 *  (`company-observation.ts`). It used to be a pair nothing in this system emits.
 *  Nothing here depended on those words; the evidence only has to be evidence,
 *  and evidence the running system could have produced is strictly better than
 *  evidence it could not. */
export async function recordSignal(productId: string, summary = 'Observed'): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO signal_events (id, product_id, source, event_type, severity, payload_json, summary)
     VALUES (?, ?, 'company_observation_baseline', 'company_observation_baseline:observed',
             'low', '{}', ?)`,
    [id, productId, summary]);
  return id;
}

/**
 * THE DOOR THE LADDER ACTUALLY HAS — AND NOW THE ONLY ONE.
 *
 * Most of this suite created its first responsibility by emitting a SaaS-shaped
 * signal, because `discovery.ts` mapped four such event types onto
 * responsibilities. Nothing in production emitted any of them, so the fixtures
 * were entering the ladder through a door the running system does not have, and
 * everything they went on to assert rested on a state production cannot reach.
 * Every one of them was moved here and the map was deleted.
 *
 * This goes through the one intake that exists: the company says what it owes,
 * naming the kind from a closed generic vocabulary, and `reportCompanyObligation`
 * — the real production function, not a re-implementation of it — records the
 * evidence and runs discovery. If that path ever stops producing a
 * responsibility, every fixture built on it fails here, which is the correct
 * place to find out.
 *
 * The founder must own the product: migration 126 verifies it against
 * `products.owner_id` and refuses the whole report otherwise.
 */
export async function reportedObligation(
  productId: string,
  founderId: string,
  opts: {
    /** One of migration 126's eight generic kinds. The type comes from the
     *  production module, so a kind added or removed there is a type error
     *  here rather than a fixture that silently stops matching. */
    kind?: ReportableObligation;
    /** The company's own words for what must be handled. */
    what?: string;
    /** A date the COMPANY stated. Never inferred, and a past date is refused. */
    dueAt?: string;
  } = {},
): Promise<{ signalId: string; responsibilityId: string }> {
  const reported = await reportCompanyObligation({
    productId, founderId,
    obligationKind: opts.kind ?? 'revenue_collection',
    what: opts.what ?? 'Collect the payments customers still owe',
    ...(opts.dueAt ? { dueAt: opts.dueAt } : {}),
  });
  if (!reported) {
    throw new Error(
      `reportedObligation: the report was refused for product ${productId}. `
      + `The founder must own it — check the fixture created ${founderId} as products.owner_id.`);
  }
  if (!reported.responsibility) {
    throw new Error(
      'reportedObligation: the report was recorded but discovery produced no '
      + 'responsibility. That is the intake breaking, not the fixture.');
  }
  return { signalId: reported.signalId, responsibilityId: reported.responsibility.id };
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
    // `observation_source_kind` is the channel that may resolve this
    // expectation. `recordSignal` writes `company_observation_baseline`, so that
    // is what every observation this fixture goes on to compare against carries.
    //
    // This helper and `shadowWithVerdicts` both named no channel, and fourteen
    // test files reach shadowing through this one. Neither was covered by
    // migration 119's or 127's prefix-keyed guards: 'support_restored' matches
    // neither LIKE. That is the hole migration 191 closes, and its size is the
    // reason the fix was worth making general rather than adding a third
    // special case.
    `INSERT INTO responsibility_shadow_expectations
       (id, responsibility_id, product_id, expected_event_type,
        expectation_evidence_ref, observation_source_evidence_ref, observation_source_kind)
     VALUES (?, ?, ?, 'support_restored', ?, ?, 'company_observation_baseline')`,
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
      // `observation_source_kind` names the channel that may resolve this
      // expectation — `company_observation_baseline`, which is what
      // `recordSignal` writes and therefore what the comparisons below carry.
      // Migration 191 refuses an expectation that names no channel, and this
      // fixture named none: it was one of the setups that proved a shadowing
      // kind outside the two prefix-keyed triggers had no guard at all.
      `INSERT INTO responsibility_shadow_expectations
         (id, responsibility_id, product_id, expected_event_type,
          expectation_evidence_ref, observation_source_evidence_ref, observation_source_kind)
       VALUES (?, ?, ?, 'support_restored', ?, ?, 'company_observation_baseline')`,
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
