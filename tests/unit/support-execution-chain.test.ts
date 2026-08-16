process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { reportCompanyObligation } from '../../src/services/founder/company-report.js';
import {
  recordFounderEvidenceAnswer, selectFounderEvidenceQuestion,
} from '../../src/services/institution/founder-evidence.js';
import { earnResponsibilityUnderstanding } from '../../src/services/institution/responsibility-understanding.js';
import { recordExternalMetricObservations } from '../../src/services/institution/external-observation.js';
import {
  beginExternalMetricShadowing, resolveExternalMetricShadowing,
} from '../../src/services/institution/external-shadowing.js';
import {
  grantAssistingAuthority, revokeAssistingAuthority,
} from '../../src/services/institution/assisting-admission.js';
import {
  ingestCustomerMessage, registerSupportChannel,
} from '../../src/services/institution/customer-message-intake.js';
import {
  getSupportReplyState, planProposedReply, proposeSupportReply,
} from '../../src/services/institution/support-reply.js';
import { executeAssistedSupportEmail } from '../../src/services/institution/responsibility-assisted-email.js';

// =============================================================================
// The first complete production-facing support execution chain.
//
// Nothing past the first founder report and the first outside reading is
// seeded. Every step runs through the real service it would run through in
// production.
//
// What this proves: real message → legitimate proposed response → bounded plan
// → authority revalidation → governed effect → receipt.
//
// What it does NOT prove: autonomous reply generation. The founder wrote the
// reply. That is the deterministic human baseline any future model-generated
// proposal has to beat.
// =============================================================================

const OWNER = 'sc_owner';
const STRANGER = 'sc_stranger';
const PRODUCT = 'sc_pottery';
const OTHER = 'sc_other';

async function countOf(sql: string, args: unknown[] = []): Promise<number> {
  return Number(((await query(sql, args)).rows[0] as Record<string, unknown>).n);
}

let responsibilityId: string;
let intakeKey: string;
let messageId: string;
let proposalId: string;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    (?,'sc_clerk','owner@example.com'),(?,'sc_stranger_clerk','stranger@example.com')`, [OWNER, STRANGER]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    (?,'Marlow Pottery Studio',?),(?,'Other Co',?)`, [PRODUCT, OWNER, OTHER, STRANGER]);

  // Visible — the founder reports something the company must handle.
  responsibilityId = (await reportCompanyObligation({
    productId: PRODUCT, founderId: OWNER, obligationKind: 'customer_commitment',
    what: 'Answer customers asking where their order is',
  }))!.responsibility!.id;

  // Understood — the founder answers what Foundry cannot observe.
  for (let i = 0; i < 20; i++) {
    const question = await selectFounderEvidenceQuestion(PRODUCT);
    if (!question || question.answerShape === 'resource_amount') break;
    await recordFounderEvidenceAnswer({
      requestId: question.requestId, founderId: OWNER, statement: `How the studio handles this (${i})`,
    });
  }
  await earnResponsibilityUnderstanding(PRODUCT, responsibilityId);

  // Shadowing — an outside system reports, the founder states an expectation,
  // a later reading resolves it.
  await query(`INSERT INTO metric_snapshots (id,product_id,snapshot_date,support_volume_7d)
    VALUES ('sc_snap',?,date('now','-1 day'),40)`, [PRODUCT]);
  await recordExternalMetricObservations({
    productId: PRODUCT, origin: 'ingest_endpoint', readings: [{ field: 'support_volume_7d', observedValue: 12 }],
  });
  await query(`UPDATE signal_events SET created_at=datetime('now','-1 day')
    WHERE product_id=? AND source='external_metric_ingest'`, [PRODUCT]);
  await beginExternalMetricShadowing({
    productId: PRODUCT, responsibilityId, founderId: OWNER,
    field: 'support_volume_7d', direction: 'fell',
  });
  const expectationId = String(((await query(
    'SELECT id FROM responsibility_shadow_expectations WHERE product_id=?', [PRODUCT]))
    .rows[0] as Record<string, unknown>).id);
  await query("UPDATE responsibility_shadow_expectations SET created_at=datetime(created_at,'-60 seconds') WHERE id=?",
    [expectationId]);
  await recordExternalMetricObservations({
    productId: PRODUCT, origin: 'ingest_endpoint', readings: [{ field: 'support_volume_7d', observedValue: 5 }],
  });
  await resolveExternalMetricShadowing(PRODUCT, expectationId);

  // Assisting — the founder grants exact bounded authority.
  const granted = await grantAssistingAuthority({
    productId: PRODUCT, responsibilityId, founderId: OWNER, durationDays: 30,
  });
  expect(granted).toMatchObject({ admitted: true });

  // A customer writes in on the responsibility's own channel.
  intakeKey = (await registerSupportChannel({
    productId: PRODUCT, responsibilityId, founderId: OWNER, label: 'orders@marlow.example',
  }))!.intakeKey;
  const ingested = await ingestCustomerMessage({
    intakeKey, externalMessageId: 'provider-evt-1', contactEmail: 'ada@example.com',
    subject: 'Where is order 4471?', body: 'I ordered three mugs on the 2nd and they have not arrived.',
  });
  if ('refused' in ingested) throw new Error(`fixture: ${ingested.refused}`);
  messageId = ingested.message.id;
});

describe('the first production-facing support execution chain', () => {
  it('shows a message with no reply as exactly that', async () => {
    expect(await getSupportReplyState(PRODUCT, messageId))
      .toEqual({ state: 'message_only', actionId: null, outcome: null });
    expect(await countOf('SELECT COUNT(*) n FROM outbound_actions WHERE product_id=?', [PRODUCT])).toBe(0);
  });

  it('takes a founder-authored reply and treats it as an event, not company evidence', async () => {
    const claimsBefore = await countOf('SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id=?', [PRODUCT]);
    const proposed = await proposeSupportReply({
      productId: PRODUCT, founderId: OWNER, messageId,
      body: 'They shipped Tuesday — tracking is on its way to you now.',
    });
    expect('refused' in proposed).toBe(false);
    if ('refused' in proposed) return;
    proposalId = proposed.proposal.id;
    expect(proposed.duplicate).toBe(false);

    // What a founder proposes to tell a customer is not a fact about the
    // company. No claim was derived from it.
    expect(await countOf('SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id=?', [PRODUCT]))
      .toBe(claimsBefore);

    // Proposing is not planning, and it certainly is not sending.
    expect(await getSupportReplyState(PRODUCT, messageId))
      .toMatchObject({ state: 'proposed', actionId: null });
    expect(await countOf('SELECT COUNT(*) n FROM outbound_actions WHERE product_id=?', [PRODUCT])).toBe(0);

    // The same text proposed again is the same proposal.
    const again = await proposeSupportReply({
      productId: PRODUCT, founderId: OWNER, messageId,
      body: 'They shipped Tuesday — tracking is on its way to you now.',
    });
    expect(again).toMatchObject({ duplicate: true });
  });

  it('refuses a proposal that tries to decide what Foundry may do with it', async () => {
    // Writing a reply is not deciding the recipient, the responsibility, or the
    // authority. Each is resolved server-side, so the payload may not name them.
    for (const smuggled of [
      { responsibility_id: responsibilityId }, { capability: 'customer_support' },
      { scope: 'send_email:anything' }, { consent: true }, { to: 'someone@else.example' },
      { recipient: 'someone@else.example' }, { consequence_boundary: 'high' },
      { state: 'operating' }, { outcome_status: 'verified_success' },
    ]) {
      await expect(query(
        `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
         VALUES (?,?,'founder_reply_proposal','founder_authored_reply','low',?,'Smuggled')`,
        [`sc_smuggle_${Object.keys(smuggled)[0]}`, PRODUCT,
          JSON.stringify({ message_id: messageId, founder_id: OWNER, body: 'text', ...smuggled })],
      )).rejects.toThrow(/authority_smuggled/);
    }
  });

  it('refuses a foreign message, a foreign author, and empty content', async () => {
    expect(await proposeSupportReply({
      productId: PRODUCT, founderId: STRANGER, messageId, body: 'not mine to write',
    })).toEqual({ refused: 'message_invalid' });
    expect(await proposeSupportReply({
      productId: OTHER, founderId: STRANGER, messageId, body: 'not my company',
    })).toEqual({ refused: 'message_invalid' });
    expect(await proposeSupportReply({
      productId: PRODUCT, founderId: OWNER, messageId, body: '   ',
    })).toEqual({ refused: 'content_required' });
    expect(await proposeSupportReply({
      productId: PRODUCT, founderId: OWNER, messageId, body: 'x'.repeat(9000),
    })).toEqual({ refused: 'content_too_large' });
  });

  it('plans a bounded action that binds message, proposal, consent and effect — and sends nothing', async () => {
    const planned = await planProposedReply({ productId: PRODUCT, founderId: OWNER, proposalId });
    expect('refused' in planned).toBe(false);
    if ('refused' in planned) return;

    const action = (await query(
      `SELECT product_id,responsibility_id,authority_consent_id,authority_scope,effect_id,status,
              inbound_message_id,reply_proposal_id,parameters_json,outcome_status
         FROM outbound_actions WHERE id=?`, [planned.actionId])).rows[0] as Record<string, unknown>;
    expect(action).toMatchObject({
      product_id: PRODUCT, responsibility_id: responsibilityId,
      authority_scope: 'send_email:support_reply', status: 'approved',
      inbound_message_id: messageId, reply_proposal_id: proposalId,
      outcome_status: 'unresolved',
    });
    expect(action.authority_consent_id).not.toBeNull();

    // The recipient is the customer who wrote in. There was no parameter for it.
    const params = JSON.parse(String(action.parameters_json)) as { to: string[] };
    expect(params.to).toEqual(['ada@example.com']);

    // Planning is not execution.
    expect(await countOf('SELECT COUNT(*) n FROM action_executions WHERE product_id=?', [PRODUCT])).toBe(0);
    expect(await getSupportReplyState(PRODUCT, messageId)).toMatchObject({ state: 'planned' });

    // Replay converges on the same plan rather than queueing a second reply.
    const replay = await planProposedReply({ productId: PRODUCT, founderId: OWNER, proposalId });
    expect(replay).toEqual({ actionId: planned.actionId, duplicate: true });
    expect(await countOf('SELECT COUNT(*) n FROM outbound_actions WHERE product_id=?', [PRODUCT])).toBe(1);
  });

  it('refuses to let another responsibility claim the plan', async () => {
    // A message belongs to the responsibility whose channel it arrived on.
    const other = (await reportCompanyObligation({
      productId: PRODUCT, founderId: OWNER, obligationKind: 'recurring_work',
      what: 'Something else entirely',
    }))!.responsibility!.id;
    await expect(query(
      `INSERT INTO outbound_actions
         (id,product_id,agent_name,integration_name,action_type,status,parameters_json,rationale,
          responsibility_id,inbound_message_id,reply_proposal_id)
       VALUES ('sc_claim',?,'x','resend','send_email','approved','{}','r',?,?,?)`,
      [PRODUCT, other, messageId, proposalId],
    )).rejects.toThrow(/message_binding_invalid/);
  });

  it('crosses the governed gateway, and leaves the outcome unresolved', async () => {
    const actionId = String(((await query(
      'SELECT id FROM outbound_actions WHERE product_id=?', [PRODUCT])).rows[0] as Record<string, unknown>).id);
    await executeAssistedSupportEmail(actionId);

    // The send crosses the ordinary governed email boundary and is recorded
    // there — whether or not a provider is configured in this environment.
    expect(await countOf(
      `SELECT COUNT(*) n FROM audit_log WHERE product_id=? AND action_type='gateway:send_email'`, [PRODUCT]))
      .toBeGreaterThan(0);

    // Whatever the provider said, the customer's problem is not known to be
    // solved. Acceptance is not resolution, and silence is not success.
    expect((await query('SELECT outcome_status FROM outbound_actions WHERE id=?', [actionId])).rows[0])
      .toMatchObject({ outcome_status: 'unresolved' });
  });

  it('does not send when authority was withdrawn after planning', async () => {
    // The race that matters: plan exists, owner revokes, execution attempted.
    await query('DELETE FROM outbound_actions WHERE product_id=?', [PRODUCT]);
    const replanned = await planProposedReply({ productId: PRODUCT, founderId: OWNER, proposalId });
    if ('refused' in replanned) throw new Error(`unexpected refusal: ${replanned.refused}`);
    expect(await revokeAssistingAuthority({ productId: PRODUCT, responsibilityId, founderId: OWNER })).toBe(true);

    const result = await executeAssistedSupportEmail(replanned.actionId);
    expect(result.dispatched).toBe(false);
    expect(await countOf(
      "SELECT COUNT(*) n FROM outbound_actions WHERE id=? AND status='executed'", [replanned.actionId])).toBe(0);

    // And a new plan cannot be made while the grant is gone.
    await query('DELETE FROM outbound_actions WHERE product_id=?', [PRODUCT]);
    expect(await planProposedReply({ productId: PRODUCT, founderId: OWNER, proposalId }))
      .toEqual({ refused: 'no_authority' });
  });

  it('cannot restore a withdrawn permission without watching again — a real finding', async () => {
    // Migration 112 admits a responsibility-bound consent only while the
    // responsibility is Shadowing. Once it has been admitted to Assisting, a
    // withdrawn permission therefore cannot be re-granted: the founder would
    // have to return the responsibility to Shadowing first.
    //
    // Recording this rather than working around it. Whether withdrawal should
    // be reversible in place is an owner-level question about what a grant
    // means, not something to settle by loosening a constitutional guard.
    // The database refuses the grant outright rather than returning empty.
    await expect(grantAssistingAuthority({
      productId: PRODUCT, responsibilityId, founderId: OWNER, durationDays: 30,
    })).rejects.toThrow(/invalid_binding/);
    expect(await countOf(
      'SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=? AND revoked_at IS NULL', [PRODUCT])).toBe(0);
  });

  it('has production callers for every link in the chain', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
      const p = resolve(dir, e);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
    const src = walk(resolve(process.cwd(), 'src'));
    const callers = (symbol: string, definedIn: string): string[] => src
      .filter((f) => !f.endsWith(definedIn))
      .filter((f) => new RegExp(`\\b${symbol}\\b`).test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(process.cwd() + '/', ''));

    // Each link must be reachable from something that is not its own module.
    expect(callers('ingestCustomerMessage', 'customer-message-intake.ts')).not.toEqual([]);
    expect(callers('registerSupportChannel', 'customer-message-intake.ts')).not.toEqual([]);
    expect(callers('proposeSupportReply', 'support-reply.ts')).not.toEqual([]);
    expect(callers('planProposedReply', 'support-reply.ts')).not.toEqual([]);
    expect(callers('grantAssistingAuthority', 'assisting-admission.ts')).not.toEqual([]);
    expect(callers('planAssistedSupportEmail', 'responsibility-assisted-email.ts'))
      .toContain('src/services/institution/support-reply.ts');
    expect(callers('executeAssistedSupportEmail', 'responsibility-assisted-email.ts')).not.toEqual([]);
  });
});
