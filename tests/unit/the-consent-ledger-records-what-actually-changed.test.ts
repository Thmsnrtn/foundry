process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getAssistingCandidates, grantAssistingAuthority } from '../../src/services/institution/assisting-admission.js';

// =============================================================================
// THE LEDGER THAT MAKES AUTHORISATION PROVABLE MAY NOT CARRY A FICTION.
//
// Migration 098 says what `autonomy_consents` is for: "who, which product,
// which capability, FROM/TO MODE, the disclosure version they saw, and when …
// This is what makes 'the user authorized this' provable, not merely asserted."
//
// Three writers put three different things in `from_mode`. The autopilot writes
// the real prior mode. The institution's two writers hard-coded 'draft' and
// 'suggest' — vocabulary from a different system. A responsibility has never
// been in a mode called draft; it was at Shadowing, which is a fact the ladder
// records and the guards enforce.
//
// Nothing reads the column, which is exactly why it could drift into fiction
// unnoticed. A field in the proof record that says something that never
// happened is worse than no field: it is the record disagreeing with the
// ledger beside it.
// =============================================================================

const P = 'cl_product';
const OWNER = 'cl_owner';


beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'cl_c','o@example.com')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Fold Street Dance',?,'active')`, [P, OWNER]);
});

describe('an institution grant', () => {
  it('records the rung the responsibility was actually on', async () => {
    const { moveResponsibilityTo, recordSignal, reportedObligation } =
      await import('../fixtures/responsibility-state.js');
    const { recordReconstructionClaim } = await import('../../src/services/institution/reconstruction.js');
    const { beginResponsibilityShadowing, compareShadowObservation } =
      await import('../../src/services/institution/responsibility-shadowing.js');

    const reported = await reportedObligation(P, OWNER,
      { kind: 'customer_commitment', what: 'Answer the people waiting in the support queue' });
    const responsibilityId = reported.responsibilityId;
    await moveResponsibilityTo(responsibilityId, 'understood', { productId: P });

    // Watched for real, and left AT Shadowing — the rung the grant is made
    // from, which is the whole point of the assertion below.
    const channel = await recordSignal(P, 'Independent channel');
    const observed = await recordSignal(P, 'Capacity restored');
    const expectationClaim = await recordReconstructionClaim({
      productId: P, subject: `responsibility:${responsibilityId}`,
      predicate: 'expected_observed_event', value: 'company_observation_baseline:observed',
      epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: channel }],
      derivationMethod: 'bounded expectation', observedAt: new Date(),
    });
    await beginResponsibilityShadowing({
      productId: P, responsibilityId,
      expectedEventType: 'company_observation_baseline:observed',
      expectationClaimId: expectationClaim, observationSourceSignalId: channel,
    });
    const expectation = (await query(
      'SELECT id FROM responsibility_shadow_expectations WHERE responsibility_id=?',
      [responsibilityId])).rows[0] as Record<string, unknown>;
    await compareShadowObservation({
      productId: P, expectationId: String(expectation.id), observationSignalId: observed });
    expect((await query('SELECT state FROM institutional_responsibilities WHERE id=?',
      [responsibilityId])).rows[0]).toMatchObject({ state: 'shadowing' });

    const candidates = await getAssistingCandidates(P);
    const candidate = candidates.find((c) => c.responsibilityId === responsibilityId);
    expect(candidate, 'the responsibility should be offerable for assisting').toBeTruthy();

    const granted = await grantAssistingAuthority({
      productId: P, founderId: OWNER, responsibilityId,
    });
    expect(granted.refusal).toBeNull();

    const row = (await query(
      `SELECT from_mode,to_mode FROM autonomy_consents
        WHERE product_id=? AND responsibility_id=? ORDER BY rowid DESC LIMIT 1`,
      [P, responsibilityId])).rows[0];
    // Shadowing is where it was. 'draft' is not a rung, and never was.
    expect(row).toMatchObject({ from_mode: 'shadowing', to_mode: 'act' });
  });
});
