// =============================================================================
// FOUNDRY — Development Shadowing
//
// Foundry watching development work it does not carry. It states, in advance,
// what it expects the repository's own checks to report; development then
// happens elsewhere; the independently recorded results are compared.
//
//   proposal        != implementation
//   implementation  != verification
//   tests passing   != constitutional permission
//
// This module performs zero repository mutation and executes no commands. It
// reuses the generic Shadowing primitives unchanged — there is no development
// expectation table, comparison table, or responsibility ledger of its own.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { recordReconstructionClaim } from './reconstruction.js';
import { beginResponsibilityShadowing, compareShadowObservation } from './responsibility-shadowing.js';
import { developmentEventType, getDevelopmentObservationsInWindow } from './development-observation.js';
import type { Responsibility } from './responsibility.js';

export type ShadowClassification = 'matched' | 'deviated' | 'unresolved';

export interface DevelopmentShadowVerdict {
  expectationId: string;
  expectedEventType: string;
  comparisons: Array<{ observationId: string; eventType: string; classification: ShadowClassification }>;
  /** Deviation dominates: one matching observation can never bury a differing one. */
  verdict: ShadowClassification;
  learnedClaimId: string | null;
}

/**
 * Enter Shadowing on a development responsibility with one bounded, falsifiable
 * expectation: which repository check should report which result.
 *
 * The expectation is stated before the work, and its own grounding claim and
 * independent observation channel are verified by the existing Shadowing
 * guards. No authority is created and nothing in the repository changes.
 */
export async function beginDevelopmentShadowing(input: {
  productId: string; responsibilityId: string;
  expectedCheck: string; expectedResult: string;
  expectationClaimId: string; observationSourceSignalId: string; validUntil?: Date;
}): Promise<{ responsibility: Responsibility; expectationId: string; expectedEventType: string }> {
  const expectedEventType = developmentEventType(input.expectedCheck, input.expectedResult);
  const responsibility = await beginResponsibilityShadowing({
    productId: input.productId, responsibilityId: input.responsibilityId,
    expectedEventType, expectationClaimId: input.expectationClaimId,
    observationSourceSignalId: input.observationSourceSignalId, validUntil: input.validUntil,
  });
  const created = await query(
    `SELECT id FROM responsibility_shadow_expectations
     WHERE responsibility_id=? AND product_id=? AND expected_event_type=?
     ORDER BY created_at DESC,rowid DESC LIMIT 1`,
    [input.responsibilityId, input.productId, expectedEventType],
  );
  return {
    responsibility, expectedEventType,
    expectationId: String((created.rows[0] as Record<string, unknown>).id),
  };
}

/**
 * Compare every independent development observation in the expectation's own
 * window and record what Foundry learned.
 *
 * The window comes from the expectation, so the caller cannot choose which
 * evidence counts. An expired expectation stays unresolved rather than being
 * quietly resolved by whatever arrived late.
 */
export async function resolveDevelopmentShadowing(input: {
  productId: string; expectationId: string;
}): Promise<DevelopmentShadowVerdict> {
  const found = await query(
    `SELECT x.responsibility_id,x.expected_event_type,x.created_at,x.valid_until
     FROM responsibility_shadow_expectations x
     JOIN institutional_responsibilities r ON r.id=x.responsibility_id
     WHERE x.id=? AND x.product_id=? AND r.capability='development'`,
    [input.expectationId, input.productId],
  );
  if (!found.rows.length) throw new Error('development shadow resolution refused');
  const expectation = found.rows[0] as Record<string, unknown>;
  const responsibilityId = String(expectation.responsibility_id);
  const expectedEventType = String(expectation.expected_event_type);
  const validUntil = expectation.valid_until == null ? null : String(expectation.valid_until);

  const observations = await getDevelopmentObservationsInWindow(
    input.productId, String(expectation.created_at), validUntil,
  );

  const comparisons: DevelopmentShadowVerdict['comparisons'] = [];
  for (const observation of observations) {
    const classification = await compareShadowObservation({
      productId: input.productId, expectationId: input.expectationId, observationSignalId: observation.id,
    });
    comparisons.push({ observationId: observation.id, eventType: observation.eventType, classification });
  }

  const verdict: ShadowClassification = comparisons.some((c) => c.classification === 'deviated') ? 'deviated'
    : comparisons.some((c) => c.classification === 'unresolved') ? 'unresolved'
      : comparisons.length ? 'matched' : 'unresolved';

  // Learning is provenance-bearing and grants nothing. A shadow verdict never
  // moves the responsibility forward on its own.
  const learnedClaimId = comparisons.length
    ? await recordReconstructionClaim({
      productId: input.productId, subject: `responsibility:${responsibilityId}`,
      predicate: 'development_shadow_comparison',
      value: { expectedEventType, verdict, observed: comparisons.map((c) => c.eventType) },
      epistemicStatus: verdict === 'deviated' ? 'conflicting' : 'known',
      evidenceRefs: comparisons.map((c) => ({ kind: 'signal_event' as const, id: c.observationId })),
      derivationMethod: 'bounded development shadow comparison', observedAt: new Date(),
    })
    : null;

  return { expectationId: input.expectationId, expectedEventType, comparisons, verdict, learnedClaimId };
}

/**
 * Checks this company has actually received independent development
 * observations for.
 *
 * Shadowing may only begin where real evidence already arrives — the same rule
 * the metric path enforces. Offering a check nothing reports would be promising
 * that observation will happen rather than proving that it does.
 */
export async function availableDevelopmentChecks(productId: string): Promise<string[]> {
  const rows = await query(
    `SELECT DISTINCT json_extract(payload_json,'$.check') AS check_name FROM signal_events
      WHERE product_id=? AND source='development_verification'
      ORDER BY check_name`,
    [productId],
  );
  return (rows.rows as unknown as Array<Record<string, unknown>>)
    .map((r) => String(r.check_name ?? '')).filter(Boolean);
}

/**
 * The owner states what they would expect a development check to report if this
 * responsibility is being carried, and Foundry begins watching.
 *
 * This is the development twin of `beginExternalMetricShadowing`, and it exists
 * for the same reason: without it, `development-shadowing.ts` had no production
 * path that OPENS an expectation, so observations arrived with nothing to
 * resolve. Foundry does not predict on its own behalf — the expectation is the
 * owner's, stated as a bounded structured choice from checks that already
 * report, never parsed out of prose.
 *
 * Watching is not permission, here as everywhere.
 */
export async function beginFounderDevelopmentShadowing(input: {
  productId: string; responsibilityId: string; founderId: string;
  check: string; expectedResult: string; validUntil?: Date;
}): Promise<Responsibility | null> {
  const check = input.check.trim();
  const expectedResult = input.expectedResult.trim();
  if (!check || !['passed', 'failed'].includes(expectedResult)) return null;

  const owned = await query(
    `SELECT r.id FROM institutional_responsibilities r JOIN products p ON p.id=r.product_id
      WHERE r.id=? AND r.product_id=? AND p.owner_id=? AND r.state='understood'
        AND r.capability='development' AND r.disposition='active'`,
    [input.responsibilityId, input.productId, input.founderId],
  );
  if (!owned.rows.length) return null;

  // The check must already have produced real independent evidence for this
  // company. Entering the rung on a silent check would be a promise.
  const source = (await query(
    `SELECT id FROM signal_events
      WHERE product_id=? AND source='development_verification'
        AND json_extract(payload_json,'$.check')=?
      ORDER BY created_at DESC LIMIT 1`,
    [input.productId, check],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!source) return null;

  const statementId = nanoid();
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES (?,?,'founder_assertion_structured',?,'low',?,?)`,
    [statementId, input.productId, `founder_expects_check:${check}:${expectedResult}`,
      JSON.stringify({
        founder_id: input.founderId, responsibility_id: input.responsibilityId,
        check, expected_result: expectedResult,
      }),
      'The owner said what they would expect this check to report if this is being handled'],
  );
  const expectationClaimId = await recordReconstructionClaim({
    productId: input.productId, subject: `responsibility:${input.responsibilityId}`,
    predicate: 'development_expectation',
    value: { check, expected: expectedResult },
    epistemicStatus: 'known',
    evidenceRefs: [{ kind: 'signal_event', id: statementId }],
    derivationMethod: 'authenticated owner expectation, stated as a bounded choice',
    observedAt: new Date(),
  });

  const { responsibility } = await beginDevelopmentShadowing({
    productId: input.productId, responsibilityId: input.responsibilityId,
    expectedCheck: check, expectedResult,
    expectationClaimId, observationSourceSignalId: String(source.id),
    validUntil: input.validUntil,
  });
  return responsibility;
}
