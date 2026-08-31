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
import { planProposedReply, proposeSupportReply } from '../../src/services/institution/support-reply.js';
import { executeAssistedSupportEmail } from '../../src/services/institution/responsibility-assisted-email.js';

// =============================================================================
// Authority is revocable and re-grantable; maturity does not move with it.
//
//   responsibility maturity != authority
//   Assisting                != active permission
//   revocation               != loss of competence
//
// The property that makes this safe is that a new grant revives nothing. The
// old consent stays revoked, plans bound to it stay bound to it and stay dead,
// and their effect identity does not migrate. A new grant requires new planning
// before anything can be sent.
// =============================================================================

const OWNER = 'al_owner';
const STRANGER = 'al_stranger';
const PRODUCT = 'al_bakery';

async function countOf(sql: string, args: unknown[] = []): Promise<number> {
  return Number(((await query(sql, args)).rows[0] as Record<string, unknown>).n);
}

let responsibilityId: string;
let messageId: string;
let proposalId: string;
let grantA: string;
let planA: string;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    (?,'al_clerk','owner@example.com'),(?,'al_stranger_clerk','stranger@example.com')`, [OWNER, STRANGER]);
  await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)', [PRODUCT, 'Halden Bread', OWNER]);

  responsibilityId = (await reportCompanyObligation({
    productId: PRODUCT, founderId: OWNER, obligationKind: 'customer_commitment',
    what: 'Answer wholesale customers about their standing orders',
  }))!.responsibility!.id;
  for (let i = 0; i < 20; i++) {
    const q = await selectFounderEvidenceQuestion(PRODUCT);
    if (!q || q.answerShape === 'resource_amount') break;
    await recordFounderEvidenceAnswer({ requestId: q.requestId, founderId: OWNER, statement: `fact ${i}` });
  }
  await earnResponsibilityUnderstanding(PRODUCT, responsibilityId);

  await query(`INSERT INTO metric_snapshots (id,product_id,snapshot_date,support_volume_7d)
    VALUES ('al_snap',?,date('now','-1 day'),40)`, [PRODUCT]);
  await recordExternalMetricObservations({
    productId: PRODUCT, origin: 'ingest_endpoint', readings: [{ field: 'support_volume_7d', observedValue: 12 }],
  });
  await query(`UPDATE signal_events SET created_at=datetime('now','-1 day')
    WHERE product_id=? AND source='external_metric_ingest'`, [PRODUCT]);
  await beginExternalMetricShadowing({
    productId: PRODUCT, responsibilityId, founderId: OWNER, field: 'support_volume_7d', direction: 'fell',
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

  const intakeKey = (await registerSupportChannel({
    productId: PRODUCT, responsibilityId, founderId: OWNER, label: 'orders@halden.example',
  }))!.intakeKey;
  const ingested = await ingestCustomerMessage({
    intakeKey, externalMessageId: 'evt-1', contactEmail: 'ada@example.com',
    subject: 'Standing order', body: 'Can you confirm next week is unchanged?',
  });
  if ('refused' in ingested) throw new Error(`fixture: ${ingested.refused}`);
  messageId = ingested.message.id;
});

describe('the authority lifecycle', () => {
  it('grants from Shadowing, admits, and executes nothing', async () => {
    const granted = await grantAssistingAuthority({
      productId: PRODUCT, responsibilityId, founderId: OWNER, durationDays: 30,
    });
    expect(granted).toMatchObject({ admitted: true });
    grantA = granted!.consentId;
    expect(granted!.responsibility).toMatchObject({ state: 'assisting' });
    expect(await countOf('SELECT COUNT(*) n FROM outbound_actions WHERE product_id=?', [PRODUCT])).toBe(0);
  });

  it('blocks execution the moment permission is withdrawn, without touching maturity', async () => {
    const proposed = await proposeSupportReply({
      productId: PRODUCT, founderId: OWNER, messageId, body: 'Yes — next week is unchanged.',
    });
    if ('refused' in proposed) throw new Error(proposed.refused);
    proposalId = proposed.proposal.id;
    const planned = await planProposedReply({ productId: PRODUCT, founderId: OWNER, proposalId });
    if ('refused' in planned) throw new Error(planned.refused);
    planA = planned.actionId;

    expect(await revokeAssistingAuthority({ productId: PRODUCT, responsibilityId, founderId: OWNER })).toBe(true);
    expect((await executeAssistedSupportEmail(planA)).dispatched).toBe(false);

    // The responsibility is still Assisting. Foundry did not forget how to
    // help; it simply may not act.
    expect((await query('SELECT state FROM institutional_responsibilities WHERE id=?', [responsibilityId])).rows[0])
      .toMatchObject({ state: 'assisting' });
    expect(await countOf(
      'SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=? AND revoked_at IS NULL', [PRODUCT])).toBe(0);
  });

  it('accepts a new grant while the responsibility stays Assisting, with a new identity', async () => {
    const regranted = await grantAssistingAuthority({
      productId: PRODUCT, responsibilityId, founderId: OWNER, durationDays: 7,
    });
    expect(regranted).not.toBeNull();
    expect(regranted!.consentId).not.toBe(grantA);
    // A re-grant restores permission. It promotes nothing.
    expect(regranted!.responsibility).toMatchObject({ state: 'assisting' });
    expect(await countOf(
      `SELECT COUNT(*) n FROM responsibility_transitions rt
         JOIN institutional_responsibilities r ON r.id=rt.responsibility_id
        WHERE r.product_id=? AND rt.to_state IN ('operating','mature','exception_owned')`, [PRODUCT])).toBe(0);
    // Scope is stated afresh, never inherited or widened.
    const scope = (await query('SELECT allowed_scope_json,consequence_boundary FROM autonomy_consents WHERE id=?',
      [regranted!.consentId])).rows[0] as Record<string, unknown>;
    expect(JSON.parse(String(scope.allowed_scope_json))).toEqual(['send_email:support_reply']);
    expect(scope.consequence_boundary).toBe('low');
  });

  it('leaves the old grant dead and the old plan unexecutable', async () => {
    // grant A → plan A → revoke A → grant B → execute plan A  ⇒  NO SEND.
    expect((await executeAssistedSupportEmail(planA)).dispatched).toBe(false);
    expect(await countOf("SELECT COUNT(*) n FROM outbound_actions WHERE id=? AND status='executed'", [planA])).toBe(0);
    expect(await countOf('SELECT COUNT(*) n FROM action_executions WHERE product_id=?', [PRODUCT])).toBe(0);

    // The revoked consent cannot be brought back to life by an UPDATE.
    await expect(query('UPDATE autonomy_consents SET revoked_at=NULL WHERE id=?', [grantA]))
      .rejects.toThrow(/revocation_permanent/);
  });

  it('requires new planning under the new grant, with a new effect identity', async () => {
    const oldEffect = String(((await query('SELECT effect_id FROM outbound_actions WHERE id=?', [planA]))
      .rows[0] as Record<string, unknown>).effect_id);

    const planned = await planProposedReply({ productId: PRODUCT, founderId: OWNER, proposalId });
    if ('refused' in planned) throw new Error(planned.refused);
    expect(planned.actionId).not.toBe(planA);

    const planB = (await query('SELECT effect_id,authority_consent_id,status FROM outbound_actions WHERE id=?',
      [planned.actionId])).rows[0] as Record<string, unknown>;
    // The stranded plan's effect identity does not migrate to the new grant.
    expect(String(planB.effect_id)).not.toBe(oldEffect);
    expect(String(planB.authority_consent_id)).not.toBe(grantA);

    // Plan A stepped aside rather than coming back.
    expect((await query('SELECT status FROM outbound_actions WHERE id=?', [planA])).rows[0])
      .toMatchObject({ status: 'cancelled' });
    expect(await countOf(
      "SELECT COUNT(*) n FROM outbound_actions WHERE product_id=? AND status<>'cancelled'", [PRODUCT])).toBe(1);

    // And the new plan may execute — the ordinary checks all pass.
    await executeAssistedSupportEmail(planned.actionId);
    expect(await countOf(
      `SELECT COUNT(*) n FROM audit_log WHERE product_id=? AND action_type='gateway:send_email'`, [PRODUCT]))
      .toBeGreaterThan(0);
  });

  it('blocks again on a second revocation', async () => {
    const live = String(((await query(
      "SELECT id FROM outbound_actions WHERE product_id=? AND status<>'cancelled'", [PRODUCT]))
      .rows[0] as Record<string, unknown>).id);
    await revokeAssistingAuthority({ productId: PRODUCT, responsibilityId, founderId: OWNER });
    expect((await executeAssistedSupportEmail(live)).dispatched).toBe(false);
    expect(await planProposedReply({ productId: PRODUCT, founderId: OWNER, proposalId }))
      .toEqual({ refused: 'no_authority' });
  });

  it('replaces an expired grant, and refuses a grant born revoked', async () => {
    const granted = await grantAssistingAuthority({
      productId: PRODUCT, responsibilityId, founderId: OWNER, durationDays: 1,
    });
    expect(granted).not.toBeNull();
    await query("UPDATE autonomy_consents SET expires_at=datetime('now','-1 hour') WHERE id=?",
      [granted!.consentId]);
    expect(await planProposedReply({ productId: PRODUCT, founderId: OWNER, proposalId }))
      .toEqual({ refused: 'no_authority' });

    // An expired grant is replaceable exactly like a revoked one.
    const replacement = await grantAssistingAuthority({
      productId: PRODUCT, responsibilityId, founderId: OWNER, durationDays: 30,
    });
    expect(replacement).not.toBeNull();
    expect(replacement!.consentId).not.toBe(granted!.consentId);

    // A consent cannot be created already revoked — that would be a grant that
    // never was, occupying the record as if it had been.
    await expect(query(
      `INSERT INTO autonomy_consents
         (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
          responsibility_id,allowed_scope_json,consequence_boundary,expires_at,revoked_at)
       VALUES ('al_born_dead',?,?,'customer_support','draft','act','v1',?,
               '["send_email:support_reply"]','low',datetime('now','+1 day'),datetime('now'))`,
      [OWNER, PRODUCT, responsibilityId],
    )).rejects.toThrow(/revoked_at_birth/);
  });

  it('refuses a re-grant that is not exactly this owner, company, responsibility and capability', async () => {
    // A stranger cannot re-grant.
    expect(await grantAssistingAuthority({
      productId: PRODUCT, responsibilityId, founderId: STRANGER,
    })).toBeNull();
    // A capability that does not match the responsibility is refused by the
    // database, not by the caller.
    await expect(query(
      `INSERT INTO autonomy_consents
         (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
          responsibility_id,allowed_scope_json,consequence_boundary,expires_at)
       VALUES ('al_wrong_cap',?,?,'development','draft','act','v1',?,
               '["send_email:support_reply"]','low',datetime('now','+1 day'))`,
      [OWNER, PRODUCT, responsibilityId],
    )).rejects.toThrow(/invalid_binding/);
    // And a responsibility with no shadow evidence cannot be granted at all,
    // whatever state it is in — Assisting is not a permanent qualification.
    const unwatched = (await reportCompanyObligation({
      productId: PRODUCT, founderId: OWNER, obligationKind: 'customer_commitment',
      what: 'Something nobody has watched',
    }))!.responsibility!.id;
    await expect(query(
      `INSERT INTO autonomy_consents
         (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
          responsibility_id,allowed_scope_json,consequence_boundary,expires_at)
       VALUES ('al_unwatched',?,?,'customer_support','draft','act','v1',?,
               '["send_email:support_reply"]','low',datetime('now','+1 day'))`,
      [OWNER, PRODUCT, unwatched],
      // A responsibility that has never been watched is refused — by the state
      // check first, and by the evidence check if it ever reached that state.
    )).rejects.toThrow(/invalid_binding|shadow_evidence_missing/);
  });

  it('never unfreezes Operating, however many grants there have been', async () => {
    expect(await countOf('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [PRODUCT]))
      .toBeGreaterThan(2);
    expect((await query('SELECT state FROM institutional_responsibilities WHERE id=?', [responsibilityId])).rows[0])
      .toMatchObject({ state: 'assisting' });
    await expect(query(
      `INSERT INTO responsibility_transitions (id,responsibility_id,from_state,to_state,evidence_ref,authority_ref,reason,actor_ref)
       VALUES ('al_operating',?,'assisting','operating','signal_event:x','autonomy_consent:y','many grants','test')`,
      [responsibilityId],
    )).rejects.toThrow();
  });
});
