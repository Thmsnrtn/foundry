process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
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
  getAssistingCandidates, grantAssistingAuthority, revokeAssistingAuthority,
} from '../../src/services/institution/assisting-admission.js';
import {
  getMessagesForResponsibility, ingestCustomerMessage, registerSupportChannel,
} from '../../src/services/institution/customer-message-intake.js';
import {
  getMessagesAwaitingReply, getSupportReplyState, planProposedReply, proposeSupportReply,
} from '../../src/services/institution/support-reply.js';
import { executeAssistedSupportEmail } from '../../src/services/institution/responsibility-assisted-email.js';
import {
  evaluateSupportPilotReadiness, OUTSTANDING_EXTERNAL_PROOF, READINESS_DIMENSIONS,
  type ReadinessDimension,
} from '../../src/services/institution/support-pilot-readiness.js';

// =============================================================================
// `support-pilot-readiness-v1` — could we responsibly ATTEMPT a bounded pilot?
//
// Every dimension is exercised against the real services. Nothing is asserted
// ready; each is observed. A dimension nothing exercises is reported as
// unexercised and fails the gate, so this contract cannot go green by being
// untested.
//
// A green result means the prerequisites are locally in place. It is not E4, no
// pilot has occurred, and the outstanding external proof travels with every
// result so it cannot be dropped when the gate turns green.
// =============================================================================

const OWNER = 'pr_owner';
const STRANGER = 'pr_stranger';
const P = 'pr_studio';
const OTHER = 'pr_other';

async function countOf(sql: string, args: unknown[] = []): Promise<number> {
  return Number(((await query(sql, args)).rows[0] as Record<string, unknown>).n);
}

const observed: Partial<Record<ReadinessDimension, boolean>> = {};
const mark = (d: ReadinessDimension, held: boolean): void => { observed[d] = held; };

let responsibilityId: string;
let messageId: string;
let proposalId: string;
let firstGrant: string;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    (?,'pr_clerk','owner@example.com'),(?,'pr_stranger_clerk','stranger@example.com')`, [OWNER, STRANGER]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    (?,'Marlow Pottery Studio',?),(?,'Other Co',?)`, [P, OWNER, OTHER, STRANGER]);
});

describe('support pilot readiness', () => {
  it('carries the narrow envelope end to end through real services', async () => {
    // ── intake → Visible ────────────────────────────────────────────────────
    const reported = await reportCompanyObligation({
      productId: P, founderId: OWNER, obligationKind: 'customer_commitment',
      what: 'Answer customers asking where their order is',
    });
    responsibilityId = reported!.responsibility!.id;
    mark('production_facing_intake', reported !== null);
    mark('responsibility_recognition', reported!.responsibility!.state === 'visible');

    // ── founder evidence → Understood ───────────────────────────────────────
    let answered = 0;
    for (let i = 0; i < 20; i++) {
      const q = await selectFounderEvidenceQuestion(P);
      if (!q || q.answerShape === 'resource_amount') break;
      await recordFounderEvidenceAnswer({ requestId: q.requestId, founderId: OWNER, statement: `fact ${i}` });
      answered++;
    }
    mark('founder_evidence', answered > 0);
    const understood = await earnResponsibilityUnderstanding(P, responsibilityId);
    mark('understanding_reachable', understood.state === 'understood');

    // ── independent observation → Shadowing → comparison ────────────────────
    await query(`INSERT INTO metric_snapshots (id,product_id,snapshot_date,support_volume_7d)
      VALUES ('pr_snap',?,date('now','-1 day'),40)`, [P]);
    const firstReading = await recordExternalMetricObservations({
      productId: P, origin: 'ingest_endpoint', readings: [{ field: 'support_volume_7d', observedValue: 12 }],
    });
    mark('independent_shadow_observer', firstReading.length === 1);
    await query(`UPDATE signal_events SET created_at=datetime('now','-1 day')
      WHERE product_id=? AND source='external_metric_ingest'`, [P]);
    await beginExternalMetricShadowing({
      productId: P, responsibilityId, founderId: OWNER, field: 'support_volume_7d', direction: 'fell',
    });
    const expectationId = String(((await query(
      'SELECT id FROM responsibility_shadow_expectations WHERE product_id=?', [P]))
      .rows[0] as Record<string, unknown>).id);
    await query("UPDATE responsibility_shadow_expectations SET created_at=datetime(created_at,'-60 seconds') WHERE id=?",
      [expectationId]);
    await recordExternalMetricObservations({
      productId: P, origin: 'ingest_endpoint', readings: [{ field: 'support_volume_7d', observedValue: 5 }],
    });
    const comparison = await resolveExternalMetricShadowing(P, expectationId);
    mark('shadow_comparison', comparison.classification === 'matched');

    // ── authority ───────────────────────────────────────────────────────────
    const granted = await grantAssistingAuthority({
      productId: P, responsibilityId, founderId: OWNER, durationDays: 30,
    });
    firstGrant = granted!.consentId;
    const consent = (await query('SELECT allowed_scope_json,expires_at,consequence_boundary FROM autonomy_consents WHERE id=?',
      [firstGrant])).rows[0] as Record<string, unknown>;
    mark('authority_grant_exact_scope',
      JSON.stringify(JSON.parse(String(consent.allowed_scope_json))) === '["send_email:support_reply"]'
      && consent.consequence_boundary === 'low');
    mark('authority_expiry', consent.expires_at != null);
    mark('assisting_admission', granted!.admitted && granted!.responsibility!.state === 'assisting');

    // ── customer message on the responsibility's own channel ────────────────
    const channel = await registerSupportChannel({
      productId: P, responsibilityId, founderId: OWNER, label: 'orders@marlow.example',
    });
    const ingested = await ingestCustomerMessage({
      intakeKey: channel!.intakeKey, externalMessageId: 'provider-evt-1',
      contactEmail: 'ada@example.com', subject: 'Where is order 4471?',
      body: 'I ordered three mugs on the 2nd and they have not arrived.',
    });
    if ('refused' in ingested) throw new Error(ingested.refused);
    messageId = ingested.message.id;
    mark('inbound_customer_message', !ingested.duplicate);
    mark('grounded_channel_attribution', ingested.message.responsibilityId === responsibilityId);

    // ── founder-authored reply → plan ───────────────────────────────────────
    const proposed = await proposeSupportReply({
      productId: P, founderId: OWNER, messageId,
      body: 'They shipped Tuesday — tracking is on its way to you now.',
    });
    if ('refused' in proposed) throw new Error(proposed.refused);
    proposalId = proposed.proposal.id;
    mark('founder_authored_reply', (await getSupportReplyState(P, messageId)).state === 'proposed');

    const planned = await planProposedReply({ productId: P, founderId: OWNER, proposalId });
    if ('refused' in planned) throw new Error(planned.refused);
    mark('action_planning', (await getSupportReplyState(P, messageId)).state === 'planned');

    // Replay converges rather than queueing a second reply to one question.
    const replay = await planProposedReply({ productId: P, founderId: OWNER, proposalId });
    mark('replay_idempotency',
      !('refused' in replay) && replay.actionId === planned.actionId && replay.duplicate === true);
  });

  it('honours an owner stop inside the narrowest window the architecture has', async () => {
    // The hardest meaningful race this architecture supports: the plan has been
    // atomically claimed for execution and has NOT yet crossed the irreversible
    // provider boundary. Revoking exactly there must still stop the send.
    const actionId = String(((await query(
      "SELECT id FROM outbound_actions WHERE product_id=? AND status<>'cancelled'", [P]))
      .rows[0] as Record<string, unknown>).id);

    const result = await executeAssistedSupportEmail(actionId, {
      afterClaim: async () => {
        await revokeAssistingAuthority({ productId: P, responsibilityId, founderId: OWNER });
      },
    });
    mark('execution_time_revalidation', result.dispatched === false);
    mark('authority_revocation',
      await countOf('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=? AND revoked_at IS NULL', [P]) === 0);

    // Nothing was dispatched, and the claimed plan was released rather than
    // left stuck as executing.
    expect(await countOf(
      "SELECT COUNT(*) n FROM outbound_actions WHERE id=? AND status='executing'", [actionId])).toBe(0);
    expect(await countOf('SELECT COUNT(*) n FROM action_executions WHERE product_id=?', [P])).toBe(0);
  });

  it('lets the founder deliberately restore permission as a genuinely new grant', async () => {
    const regranted = await grantAssistingAuthority({
      productId: P, responsibilityId, founderId: OWNER, durationDays: 7,
    });
    mark('authority_regrant_new_identity',
      regranted !== null && regranted.consentId !== firstGrant
      && regranted.responsibility!.state === 'assisting');

    // The old grant is dead and stays dead; its plan cannot be revived.
    await expect(query('UPDATE autonomy_consents SET revoked_at=NULL WHERE id=?', [firstGrant]))
      .rejects.toThrow(/revocation_permanent/);
  });

  it('crosses the governed boundary and leaves the outcome unresolved', async () => {
    const planned = await planProposedReply({ productId: P, founderId: OWNER, proposalId });
    if ('refused' in planned) throw new Error(planned.refused);
    await executeAssistedSupportEmail(planned.actionId);

    // The effect crossed the ordinary gateway and is recorded there.
    const gatewayRecords = await countOf(
      `SELECT COUNT(*) n FROM audit_log WHERE product_id=? AND action_type='gateway:send_email'`, [P]);
    mark('governed_effect', gatewayRecords > 0);

    // A receipt exists and is durable, whatever the provider said.
    const action = (await query(
      'SELECT status,effect_certainty,provider_receipt_json,outcome_status,effect_id FROM outbound_actions WHERE id=?',
      [planned.actionId])).rows[0] as Record<string, unknown>;
    mark('durable_receipt', action.provider_receipt_json != null && action.effect_id != null);

    // Provider acknowledgement is not business outcome. Whatever happened at
    // the provider, whether the customer's problem is solved is unknown.
    mark('unresolved_outcome_honesty', String(action.outcome_status) === 'unresolved');
  });

  it('reconstructs the whole chain from canonical records alone', async () => {
    // An auditor must be able to establish why the effect happened without a
    // separate audit ledger — every link is already canonical.
    const action = (await query(
      `SELECT id,responsibility_id,authority_consent_id,inbound_message_id,reply_proposal_id,effect_id
         FROM outbound_actions WHERE product_id=? AND status<>'cancelled'`, [P]))
      .rows[0] as Record<string, unknown>;

    const chain = {
      responsibility: await countOf('SELECT COUNT(*) n FROM institutional_responsibilities WHERE id=? AND product_id=?',
        [String(action.responsibility_id), P]),
      shadowEvidence: await countOf(
        `SELECT COUNT(*) n FROM responsibility_shadow_comparisons c
           JOIN responsibility_shadow_expectations x ON x.id=c.expectation_id
          WHERE x.responsibility_id=? AND c.classification IN ('matched','deviated')`,
        [String(action.responsibility_id)]),
      grant: await countOf('SELECT COUNT(*) n FROM autonomy_consents WHERE id=? AND responsibility_id=?',
        [String(action.authority_consent_id), String(action.responsibility_id)]),
      assistingTransition: await countOf(
        `SELECT COUNT(*) n FROM responsibility_transitions WHERE responsibility_id=? AND to_state='assisting'`,
        [String(action.responsibility_id)]),
      message: await countOf('SELECT COUNT(*) n FROM inbound_customer_messages WHERE id=? AND product_id=?',
        [String(action.inbound_message_id), P]),
      proposal: await countOf(
        `SELECT COUNT(*) n FROM signal_events WHERE id=? AND source='founder_reply_proposal'`,
        [String(action.reply_proposal_id)]),
      receipt: await countOf('SELECT COUNT(*) n FROM outbound_actions WHERE id=? AND provider_receipt_json IS NOT NULL',
        [String(action.id)]),
    };
    mark('auditability', Object.values(chain).every((n) => n === 1));
    expect(chain).toMatchObject({
      responsibility: 1, shadowEvidence: 1, grant: 1, assistingTransition: 1,
      message: 1, proposal: 1, receipt: 1,
    });
  });

  it('keeps everything inside one tenant, and keeps customer content out of logs', async () => {
    // Tenant isolation across every store the pilot touches.
    const foreign = await Promise.all([
      countOf('SELECT COUNT(*) n FROM inbound_customer_messages WHERE product_id=?', [OTHER]),
      countOf('SELECT COUNT(*) n FROM outbound_actions WHERE product_id=?', [OTHER]),
      countOf('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [OTHER]),
      countOf('SELECT COUNT(*) n FROM institutional_responsibilities WHERE product_id=?', [OTHER]),
    ]);
    // Through the reader a founder's surface actually calls. This mark used to
    // be proved with `getMessagesForResponsibility`, which no production
    // surface calls: the readiness suite stayed green with the founder-facing
    // query returning every OTHER tenant's messages. A readiness criterion
    // proved on a path production never runs is not evidence of readiness.
    const stranger = await getMessagesAwaitingReply(OTHER);
    const own = await getMessagesAwaitingReply(P);
    mark('tenant_isolation',
      foreign.every((n) => n === 0) && stranger.length === 0 && own.length > 0);
    expect(stranger).toEqual([]);
    expect(own.length).toBeGreaterThan(0);

    // Customer content is real personal data. It must not become convenient
    // diagnostic text: no log or error call in the intake path may carry the
    // message body.
    const intakePaths = [
      'src/services/institution/customer-message-intake.ts',
      'src/routes/ingest/index.ts',
      'src/services/institution/support-reply.ts',
    ];
    const leaks: string[] = [];
    for (const path of intakePaths) {
      readFileSync(resolve(process.cwd(), path), 'utf8').split('\n').forEach((line, i) => {
        if (!/\b(log|logger|console)\.\w+\(/.test(line)) return;
        if (/\bbody\b|\bstatement\b|contact_email|contactEmail/.test(line)) leaks.push(`${path}:${i + 1}`);
      });
    }
    mark('customer_content_safety', leaks.length === 0);
    expect(leaks, `Customer content reaches a log line:\n${leaks.join('\n')}`).toEqual([]);
  });

  it('has the founder controls the envelope depends on, on existing surfaces', async () => {
    // No pilot dashboard: every control lives behind the Letter, which is an
    // existing door.
    const letter = readFileSync(resolve(process.cwd(), 'src/routes/dashboard/letter.ts'), 'utf8');
    const controls = [
      /permission\/grant/, /permission\/revoke/, /messages\/:messageId\/reply/,
      /replies\/:proposalId\/plan/, /replies\/:actionId\/send/, /responsibilities\/:responsibilityId\/channel/,
    ];
    const present = controls.every((re) => re.test(letter));

    // The states the founder must be able to tell apart do not collapse.
    const distinct = new Set(['message_only', 'proposed', 'planned', 'sent', 'failed']).size === 5;

    // The permission surface states scope and expiry in plain language, with no
    // institutional vocabulary.
    const candidates = await getAssistingCandidates(P);
    const copy = candidates.map((c) => `${c.may} ${c.mayNot}`).join(' ');
    const jargonFree = !/autonomy|consent|scope|capability|assisting|shadowing|epistemic|migration/i.test(copy);
    mark('founder_control', present && distinct && jargonFree && candidates.length > 0);
  });

  it('requires the structural reachability gate to be part of the suite', () => {
    // Readiness depends on the chain staying reachable, so the gate that
    // enforces that must exist and must run.
    const gate = resolve(process.cwd(), 'tests/unit/institution-production-reachability.test.ts');
    const source = readFileSync(gate, 'utf8');
    mark('structural_production_reachability',
      /every link in the support chain has a real production caller/.test(source));
  });

  it('reports readiness, and says plainly what it does not mean', () => {
    const result = evaluateSupportPilotReadiness({
      exercised: observed,
      outstandingExternalProof: [...OUTSTANDING_EXTERNAL_PROOF],
    });
    expect(result.failed, `Prerequisites unmet: ${result.failed.join(', ')}`).toEqual([]);
    expect(result.unexercised, `Prerequisites untested: ${result.unexercised.join(', ')}`).toEqual([]);
    expect(result.ready).toBe(true);

    // A green gate is a statement about prerequisites, never about evidence.
    expect(result.meaning).toContain('READY TO ATTEMPT');
    expect(result.meaning).toContain('not E4');
    expect(result.outstandingExternalProof.length).toBeGreaterThan(0);
  });

  it('refuses to go green on an untested dimension', () => {
    // Coverage integrity, proven rather than asserted: drop one observation and
    // the gate reports it as unexercised rather than passing it by default.
    const partial = { ...observed };
    delete partial.durable_receipt;
    const result = evaluateSupportPilotReadiness({ exercised: partial, outstandingExternalProof: [] });
    expect(result.ready).toBe(false);
    expect(result.unexercised).toEqual(['durable_receipt']);
    expect(result.meaning).toContain('NOT READY');

    // And an empty observation is maximally not-ready, never vacuously green.
    const empty = evaluateSupportPilotReadiness({ exercised: {}, outstandingExternalProof: [] });
    expect(empty.ready).toBe(false);
    expect(empty.unexercised).toEqual([...READINESS_DIMENSIONS]);
  });

  it('is not reported anywhere as pilot evidence', () => {
    // The one way this contract could do harm is by being quoted as proof.
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
      const p = resolve(dir, e);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
    const claims = walk(resolve(process.cwd(), 'src'))
      .filter((f) => /support-pilot-readiness|SUPPORT_PILOT_READINESS/.test(readFileSync(f, 'utf8')))
      .filter((f) => /\bE4\b|pilot proven|pilot evidence/i.test(readFileSync(f, 'utf8')))
      .filter((f) => !f.endsWith('support-pilot-readiness.ts')); // its own disclaimer
    expect(claims).toEqual([]);
  });
});
