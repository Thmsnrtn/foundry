process.env.TURSO_DATABASE_URL='file::memory:';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { registerToolHandler } from '../../src/services/outbound/gateway.js';
import { SEND_EMAIL_POLICY } from '../../src/services/integration/resend.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import {
  earnResponsibilityUnderstanding, type UnderstandingFact,
} from '../../src/services/institution/responsibility-understanding.js';
import {
  beginResponsibilityShadowing, compareShadowObservation,
} from '../../src/services/institution/responsibility-shadowing.js';
import { recordConsent } from '../../src/services/autopilot/consent.js';
import { enterResponsibilityAssisting } from '../../src/services/institution/responsibility-assisting.js';
import {
  executeAssistedSupportEmail, getFounderAssistingActivity, planAssistedSupportEmail,
  reconcileAssistedSupportEmail,
} from '../../src/services/institution/responsibility-assisted-email.js';
import { reportEffectOutcome } from '../../src/services/institution/effect-outcome.js';
import { reportedObligation } from '../fixtures/responsibility-state.js';

// =============================================================================
// SOMEBODY SAYING "IT DID NOT WORK" AFTER SOMEBODY SAID "IT DID" IS A CONFLICT.
//
// The outcome layer exists to refuse one claim: that a provider accepting
// something is the thing having worked. It keeps `conflicting` deliberately,
// and the letter says so in the founder's own words — "I have kept both. I have
// no way to tell which is right, so I am not going to pick one."
//
// That only holds while a verdict can still change. The reconciliation job
// selected rows with `outcome_status IS NULL OR = 'unresolved'`, so the FIRST
// report to arrive settled the question permanently. A customer who said it
// worked and a founder who later said it did not left Foundry reporting that it
// worked, with the contradiction sitting unread in the same table.
//
// Meanwhile the founder-facing line counted every report about the effect, not
// the ones the verdict rested on — so the letter could say two separate reports
// told it the thing worked, when one of them said the opposite.
// =============================================================================

const P = 'lc_product';
const OWNER = 'lc_owner';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'lc_clerk','o@example.com')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES (?,'Generic Support Co',?)`, [P, OWNER]);
});
beforeEach(() => {
  registerToolHandler('send_email', async (req) => ({ message_id: `provider-${req.dedupKey}` }), SEND_EMAIL_POLICY);
});

async function assistedEffect(suffix: string): Promise<{ responsibilityId: string; actionId: string; effectId: string }> {
  const channel = `lc_channel_${suffix}`; const actual = `lc_actual_${suffix}`;
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
    (?,?,'support','support_queue_observed','low','{}','Independent channel'),
    (?,?,'support','support_capacity_restored','low','{}','Capacity restored')`, [channel, P, actual, P]);
  const reported = await reportedObligation(P, OWNER,
    { kind: 'customer_commitment', what: `Answer the people waiting in the support queue (${suffix})` });
  const responsibilityId = reported.responsibilityId;
  const facts: Partial<Record<UnderstandingFact, unknown>> = {
    purpose: 'Keep customers supported', desired_outcome: 'Restore response capacity',
    success_conditions: ['customer receives reply'], operating_constraints: ['one low-risk reply'],
    dependencies: ['support inbox'], risks: ['wrong recipient'],
  };
  for (const predicate of Object.keys(facts) as UnderstandingFact[]) {
    await recordReconstructionClaim({
      productId: P, subject: `responsibility:${responsibilityId}`, predicate, value: facts[predicate],
      epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: reported.signalId }],
      derivationMethod: 'vertical fixture evidence', observedAt: new Date(),
    });
  }
  await earnResponsibilityUnderstanding(P, responsibilityId);
  const expectationClaim = await recordReconstructionClaim({
    productId: P, subject: `responsibility:${responsibilityId}`, predicate: 'expected_observed_event',
    value: 'support_capacity_restored', epistemicStatus: 'known',
    evidenceRefs: [{ kind: 'signal_event', id: channel }],
    derivationMethod: 'bounded expectation', observedAt: new Date(),
  });
  await beginResponsibilityShadowing({
    productId: P, responsibilityId, expectedEventType: 'support_capacity_restored',
    expectationClaimId: expectationClaim, observationSourceSignalId: channel,
    observationSourceKind: 'support',
  });
  const expectation = (await query(
    'SELECT id FROM responsibility_shadow_expectations WHERE responsibility_id=?', [responsibilityId])).rows[0] as Record<string, unknown>;
  await compareShadowObservation({ productId: P, expectationId: String(expectation.id), observationSignalId: actual });
  const comparison = (await query(
    'SELECT id FROM responsibility_shadow_comparisons WHERE expectation_id=?', [expectation.id])).rows[0] as Record<string, unknown>;
  const consent = await recordConsent({
    founderId: OWNER, productId: P, capability: 'customer_support', fromMode: 'observe', toMode: 'act',
    responsibilityId, allowedScope: ['send_email:support_reply'], consequenceBoundary: 'low',
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await enterResponsibilityAssisting({ productId: P, responsibilityId, shadowComparisonId: String(comparison.id), authorityConsentId: consent });
  const effectId = `lc-effect-${suffix}`;
  const actionId = await planAssistedSupportEmail({
    productId: P, responsibilityId, authorityConsentId: consent, effectId,
    to: 'customer@example.com', subject: 'We are on it', html: 'Help is underway',
    rationale: 'Restore bounded support communication',
  });
  await executeAssistedSupportEmail(actionId);
  return { responsibilityId, actionId, effectId };
}

describe('an outcome that has already been settled', () => {
  it('is reopened when somebody outside contradicts it', async () => {
    const { actionId, effectId } = await assistedEffect('contradicted');

    await reportEffectOutcome({ productId: P, effectId, verdict: 'achieved', reporter: 'customer:aisha' });
    expect(await reconcileAssistedSupportEmail(P, actionId)).toBe('verified_success');

    // The founder, later, says otherwise.
    await reportEffectOutcome({ productId: P, effectId, verdict: 'failed', reporter: `founder:${OWNER}` });

    const { listActionsAwaitingOutcomeReconciliation } = await import(
      '../../src/services/institution/responsibility-assisted-email.js');
    const pending = await listActionsAwaitingOutcomeReconciliation();
    expect(pending.map((p) => p.actionId)).toContain(actionId);

    expect(await reconcileAssistedSupportEmail(P, actionId)).toBe('conflicting');
    expect((await query('SELECT outcome_status FROM outbound_actions WHERE id=?', [actionId])).rows[0])
      .toMatchObject({ outcome_status: 'conflicting' });

    // And once reconciled against everything it has seen, it stops asking.
    expect((await listActionsAwaitingOutcomeReconciliation()).map((p) => p.actionId))
      .not.toContain(actionId);
  });

  it('never tells the founder that reports agreed when they disagree', async () => {
    const { actionId, effectId } = await assistedEffect('attribution');
    await reportEffectOutcome({ productId: P, effectId, verdict: 'achieved', reporter: 'external:rota_system' });
    await reconcileAssistedSupportEmail(P, actionId);
    await reportEffectOutcome({ productId: P, effectId, verdict: 'failed', reporter: `founder:${OWNER}` });

    // Before the next reconciliation the verdict still rests on one report.
    // The line must describe the evidence the verdict rests on, not every
    // report that happens to exist about the effect.
    const line = (await getFounderAssistingActivity(P))
      .find((i) => i.title.includes('(attribution)'))!;
    // Names the one witness the verdict rests on. "2 separate reports" would be
    // counting a report that says the opposite; "somebody outside" would be
    // forgetting the witness it has.
    expect(line.detail).toMatch(/a system you connected/);
    expect(line.detail).not.toContain('2 separate reports');
    expect(line.detail).not.toContain('somebody outside');
  });
});
