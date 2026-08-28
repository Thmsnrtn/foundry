process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { earnResponsibilityUnderstanding } from '../../src/services/institution/responsibility-understanding.js';
import { recordDevelopmentObservation } from '../../src/services/institution/development-observation.js';
import {
  beginDevelopmentShadowing, resolveDevelopmentShadowing,
} from '../../src/services/institution/development-shadowing.js';
import { getMaterialShadowingExceptions } from '../../src/services/institution/responsibility-shadowing.js';

// ─── One observation is allowed to falsify a prediction ──────────────────────
//
// A shadow verdict of `deviated` was written as a `conflicting` claim, and the
// claim guard has said since migration 106 that a conflicting claim needs at
// least two sources to be in conflict with each other. The most ordinary
// deviation there is — one observation reporting something other than what was
// predicted — therefore threw, in the write of what Foundry had just learned.
//
// Only a window whose observations disagreed among themselves ever reached the
// database, so every test of the deviation path had two, and none of them was
// the shape production would meet first.
//
// A conflict is between sources. A prediction that reality falsified is not
// unsettled; it is a known result, and the deviation is carried by the verdict.

const CHECK = 'schema-snapshot-freshness';

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

async function watch(productId: string, prefix: string): Promise<string> {
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
  const claimId = await recordReconstructionClaim({
    productId, subject: `responsibility:${responsibilityId}`, predicate: 'development_expectation',
    value: { check: CHECK, expected: 'passed' }, epistemicStatus: 'inferred', confidence: 0.8,
    evidenceRefs: [{ kind: 'signal_event', id: `${prefix}_sig` }],
    derivationMethod: 'bounded expectation from observed repository reality', observedAt: new Date(),
  });
  const { expectationId } = await beginDevelopmentShadowing({
    productId, responsibilityId, expectedCheck: CHECK, expectedResult: 'passed',
    expectationClaimId: claimId, observationSourceSignalId: `${prefix}_sig`,
  });
  await query(
    "UPDATE responsibility_shadow_expectations SET created_at=datetime(created_at,'-10 seconds') WHERE id=?",
    [expectationId],
  );
  return expectationId;
}

const claimStatus = async (id: string) => String((( await query(
  'SELECT epistemic_status FROM reconstruction_claims WHERE id=?', [id],
)).rows[0] as Record<string, unknown>).epistemic_status);

describe('a deviation with only one source', () => {
  beforeAll(async () => {
    await runMigrations();
    await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('dos_owner','dos_clerk','dos@example.com')", []);
    await query(`INSERT INTO products (id,name,owner_id) VALUES
      ('dos_a','A Co','dos_owner'),('dos_b','B Co','dos_owner'),('dos_c','C Co','dos_owner')`, []);
  });

  it('records what it learned when a single observation falsified the prediction', async () => {
    const expectationId = await watch('dos_a', 'dosa');
    await recordDevelopmentObservation({
      productId: 'dos_a', check: CHECK, result: 'failed', detail: 'a migration landed without a snapshot' });

    const verdict = await resolveDevelopmentShadowing({ productId: 'dos_a', expectationId });
    expect(verdict.verdict).toBe('deviated');
    expect(verdict.comparisons).toHaveLength(1);
    // The learning is written, not lost in a throw.
    expect(verdict.learnedClaimId).toBeTruthy();
    expect(await claimStatus(verdict.learnedClaimId!)).toBe('known');
  });

  it('still shows the founder the deviation, and the authority path still counts it', async () => {
    const expectationId = await watch('dos_b', 'dosb');
    await recordDevelopmentObservation({
      productId: 'dos_b', check: CHECK, result: 'failed', detail: 'a migration landed without a snapshot' });
    await resolveDevelopmentShadowing({ productId: 'dos_b', expectationId });

    expect((await query(
      "SELECT COUNT(*) n FROM responsibility_shadow_comparisons WHERE expectation_id=? AND classification='deviated'",
      [expectationId])).rows[0]).toMatchObject({ n: 1 });
    const shown = await getMaterialShadowingExceptions('dos_b');
    expect(shown.map((s) => s.classification)).toEqual(['deviated']);
  });

  it('keeps conflicting for observations that disagree with each other', async () => {
    const expectationId = await watch('dos_c', 'dosc');
    await recordDevelopmentObservation({
      productId: 'dos_c', check: CHECK, result: 'passed', detail: 'snapshot regenerated, no diff' });
    await recordDevelopmentObservation({
      productId: 'dos_c', check: CHECK, result: 'failed', detail: 'a later migration landed without a snapshot' });

    const verdict = await resolveDevelopmentShadowing({ productId: 'dos_c', expectationId });
    expect(verdict.verdict).toBe('deviated');
    // Two sources genuinely disagree, so the claim stays unsettled rather than
    // being flattened into whichever arrived last.
    expect(await claimStatus(verdict.learnedClaimId!)).toBe('conflicting');
  });
});
