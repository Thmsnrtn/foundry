process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { earnResponsibilityUnderstanding } from '../../src/services/institution/responsibility-understanding.js';
import {
  developmentEventCheck, developmentEventType, recordDevelopmentObservation,
} from '../../src/services/institution/development-observation.js';
import {
  beginDevelopmentShadowing, resolveDevelopmentShadowing,
} from '../../src/services/institution/development-shadowing.js';
import { getMaterialShadowingExceptions } from '../../src/services/institution/responsibility-shadowing.js';

// ─── Two checks, one expectation ─────────────────────────────────────────────
//
// The window selector is about the whole company on purpose, so a deviating
// observation cannot be hidden from a verdict. Every observation it returned
// was then compared against the one expectation being resolved, and comparison
// is exact event-type equality. With one check in existence that was
// indistinguishable from correct. With two it says a responsibility deviated
// from a prediction that was never made about it.
//
// A second check is coming — `availableDevelopmentChecks` is a list, and the
// founder chooses from it — so this is written against the population the
// design already promises, not the one that happens to exist today.

const SUBJECT = 'schema-snapshot-freshness';
const OTHER = 'ratchet-baselines-current';

const UNDERSTANDING: Array<[string, unknown]> = [
  ['purpose', 'Keep the committed schema snapshot in sync with the migrations'],
  ['desired_outcome', 'A migration and its snapshot always land together'],
  ['success_conditions', 'Regenerating the snapshot produces no diff'],
  ['operating_constraints', 'Generated artefact only; never hand-edited'],
  ['dependencies', 'The migration runner and the snapshot generator'],
  ['risks', 'A stale snapshot hides schema drift until an unrelated check fails'],
  ['systems', 'src/db/migrations and docs/db/schema.snapshot.sql'],
  ['failure_modes', 'Snapshot not regenerated after a migration is added'],
];

async function seed(productId: string, prefix: string): Promise<string> {
  const responsibilityId = `${prefix}_resp`;
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
    VALUES (?,?,'repository','development_need_observed','medium','{}','Schema snapshot drifted from migrations')`,
  [`${prefix}_sig`, productId]);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state)
    VALUES (?,?,'Keep the schema snapshot in sync with migrations','development','visible')`,
  [responsibilityId, productId]);
  for (const [predicate, value] of UNDERSTANDING) {
    await recordReconstructionClaim({
      productId, subject: `responsibility:${responsibilityId}`, predicate, value,
      epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: `${prefix}_sig` }],
      derivationMethod: 'observed repository reality', observedAt: new Date(),
    });
  }
  await earnResponsibilityUnderstanding(productId, responsibilityId);
  return responsibilityId;
}

/** Open an expectation about SUBJECT and wind it back so observations follow it. */
async function watch(productId: string, prefix: string, expected: string): Promise<string> {
  const responsibilityId = await seed(productId, prefix);
  const claimId = await recordReconstructionClaim({
    productId, subject: `responsibility:${responsibilityId}`, predicate: 'development_expectation',
    value: { check: SUBJECT, expected }, epistemicStatus: 'inferred', confidence: 0.8,
    evidenceRefs: [{ kind: 'signal_event', id: `${prefix}_sig` }],
    derivationMethod: 'bounded expectation from observed repository reality', observedAt: new Date(),
  });
  const { expectationId } = await beginDevelopmentShadowing({
    productId, responsibilityId, expectedCheck: SUBJECT, expectedResult: expected,
    expectationClaimId: claimId, observationSourceSignalId: `${prefix}_sig`,
  });
  await query(
    "UPDATE responsibility_shadow_expectations SET created_at=datetime(created_at,'-10 seconds') WHERE id=?",
    [expectationId],
  );
  return expectationId;
}

describe('a verdict about a different check', () => {
  beforeAll(async () => {
    await runMigrations();
    await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('vdc_owner','vdc_clerk','vdc@example.com')", []);
    // One product per scenario: shared development reality between unrelated
    // expectations would make each verdict depend on test ordering.
    await query(`INSERT INTO products (id,name,owner_id) VALUES
      ('vdc_a','A Co','vdc_owner'),('vdc_b','B Co','vdc_owner'),('vdc_c','C Co','vdc_owner'),
      ('vdc_d','D Co','vdc_owner'),('vdc_e','E Co','vdc_owner'),('vdc_f','F Co','vdc_owner')`, []);
  });

  it('does not let another check\'s result deviate an expectation it was never about', async () => {
    const expectationId = await watch('vdc_a', 'vdca', 'passed');
    await recordDevelopmentObservation({
      productId: 'vdc_a', check: SUBJECT, result: 'passed', detail: 'snapshot regenerated, no diff' });
    await recordDevelopmentObservation({
      productId: 'vdc_a', check: OTHER, result: 'passed', detail: 'baselines match the live schema' });

    const verdict = await resolveDevelopmentShadowing({ productId: 'vdc_a', expectationId });
    expect(verdict.verdict).toBe('matched');
    expect(verdict.comparisons).toHaveLength(1);
    expect(verdict.comparisons[0].eventType).toBe(developmentEventType(SUBJECT, 'passed'));
  });

  it('still lets the predicted check deviate its own expectation', async () => {
    const expectationId = await watch('vdc_b', 'vdcb', 'passed');
    await recordDevelopmentObservation({
      productId: 'vdc_b', check: SUBJECT, result: 'failed', detail: 'a migration landed without a snapshot' });
    await recordDevelopmentObservation({
      productId: 'vdc_b', check: OTHER, result: 'passed', detail: 'baselines match the live schema' });

    const verdict = await resolveDevelopmentShadowing({ productId: 'vdc_b', expectationId });
    expect(verdict.verdict).toBe('deviated');
    expect(verdict.comparisons.map((c) => c.eventType)).toEqual([developmentEventType(SUBJECT, 'failed')]);
  });

  it('stays unresolved when only other checks reported, rather than calling it a deviation', async () => {
    const expectationId = await watch('vdc_c', 'vdcc', 'passed');
    await recordDevelopmentObservation({
      productId: 'vdc_c', check: OTHER, result: 'failed', detail: 'a baseline names a table that is gone' });

    const verdict = await resolveDevelopmentShadowing({ productId: 'vdc_c', expectationId });
    expect(verdict.verdict).toBe('unresolved');
    expect(verdict.comparisons).toHaveLength(0);
    // Nothing was compared, so there is nothing to have learned.
    expect(verdict.learnedClaimId).toBeNull();
  });

  it('writes no deviation the founder would be shown for a check they did not predict', async () => {
    const expectationId = await watch('vdc_d', 'vdcd', 'passed');
    await recordDevelopmentObservation({
      productId: 'vdc_d', check: OTHER, result: 'failed', detail: 'a baseline names a table that is gone' });
    await resolveDevelopmentShadowing({ productId: 'vdc_d', expectationId });

    // The stored comparison is what the authority request counts as a wrong
    // prediction, and what The Letter reads back as an exception.
    const stored = await query(
      `SELECT classification FROM responsibility_shadow_comparisons WHERE expectation_id=?`, [expectationId]);
    expect(stored.rows).toHaveLength(0);
    expect(await getMaterialShadowingExceptions('vdc_d')).toHaveLength(0);
  });

  it('surfaces the predicted check\'s own deviation to the founder unchanged', async () => {
    const expectationId = await watch('vdc_e', 'vdce', 'passed');
    await recordDevelopmentObservation({
      productId: 'vdc_e', check: SUBJECT, result: 'failed', detail: 'a migration landed without a snapshot' });
    await recordDevelopmentObservation({
      productId: 'vdc_e', check: OTHER, result: 'failed', detail: 'a baseline names a table that is gone' });
    await resolveDevelopmentShadowing({ productId: 'vdc_e', expectationId });

    const shown = await getMaterialShadowingExceptions('vdc_e');
    expect(shown).toHaveLength(1);
    expect(shown[0].expectedEventType).toBe(developmentEventType(SUBJECT, 'passed'));
    expect(shown[0].observedSummary).toContain(SUBJECT);
    expect(shown[0].observedSummary).not.toContain(OTHER);
  });

  it('refuses an identity it could not read back', () => {
    // A colon in either field makes `check:result` ambiguous, and resolution
    // reads the check back out of the event type to decide what a comparison
    // is about.
    expect(() => developmentEventType('a:b', 'passed')).toThrow(/identity refused/);
    expect(() => developmentEventType('check', 'pa:ssed')).toThrow(/identity refused/);
    expect(() => developmentEventType(' ', 'passed')).toThrow(/identity refused/);
  });

  it('reads a check back out of its own event type, and nothing else', () => {
    expect(developmentEventCheck(developmentEventType(SUBJECT, 'passed'))).toBe(SUBJECT);
    expect(developmentEventCheck(developmentEventType(OTHER, 'failed'))).toBe(OTHER);
    // Not every signal event is one of ours, and guessing would be worse than
    // saying so: an unreadable subject leaves the expectation unresolved.
    expect(developmentEventCheck('support_reply_failed')).toBeNull();
    expect(developmentEventCheck('development_verified:only_two_parts')).toBeNull();
  });

  it('refuses a check name at intake that could not form an identity', async () => {
    await expect(recordDevelopmentObservation({
      productId: 'vdc_f', check: 'has:colon', result: 'passed', detail: 'x',
    })).rejects.toThrow(/identity refused/);
  });
});
