process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
// The access-billing machinery is only asked on a commercial deployment, which
// is no longer the default (29 September 2026); this file tests that machinery.
process.env.FOUNDRY_INSTANCE_POSTURE = 'commercial';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { registerToolHandler } from '../../src/services/outbound/gateway.js';
import { SEND_EMAIL_POLICY } from '../../src/services/integration/resend.js';
import {
  executeAssistedSupportEmail, planAssistedSupportEmail,
} from '../../src/services/institution/responsibility-assisted-email.js';
import { nanoid } from 'nanoid';
import { moveResponsibilityTo, recordEvidence } from '../fixtures/responsibility-state.js';

// =============================================================================
// BILLING ↔ CAPABILITY ACCESS: the pause reached one layer and not the other.
//
// `customer.subscription.deleted` clears the tier and pauses the SCP agents at
// BOTH levels — `products.scp_status` and every `agent_instances` row — with a
// comment explaining that the scheduler checks the first one. Careful work, for
// the layer that existed when it was written.
//
// It never learned about the institution. `autonomy_consents` were untouched,
// the institutional jobs iterate `products WHERE status='active'` rather than
// `scp_status`, and nothing on the governed-effect path consulted billing at
// all. So a founder who had cancelled still had emails sent on their behalf,
// under a grant they gave while they were a customer.
//
// The fix reads the pause at the point authority is resolved, rather than
// revoking the grants. "You stopped paying" and "you withdrew permission" are
// different facts, and this codebase already distinguishes them — a defect
// about exactly that distinction was fixed earlier in this campaign.
// Resubscribing restores the permission the founder already gave; a genuine
// revocation is still a revocation.
// =============================================================================

const ROOT = resolve(__dirname, '../..');
const P = 'bca_co';
const OWNER = 'bca_owner';
let dispatched = 0;

/** A distinct recipient per case, deliberately.
 *
 * Sending repeatedly to one address lets the communication budget refuse the
 * later ones, and a refusal for that reason is indistinguishable from a refusal
 * for the reason under test — a mutation removing the archived check passed an
 * earlier version of this file for exactly that reason. */
async function plan(effectId: string): Promise<string> {
  return planAssistedSupportEmail({
    productId: P, responsibilityId: 'bca_resp', authorityConsentId: 'bca_consent',
    effectId, to: `${effectId}@example.com`, subject: 'S', html: 'B',
    rationale: 'r', scope: 'send_email:responsibility_notice',
  });
}

beforeAll(async () => {
  await runMigrations();
  registerToolHandler('send_email', async (req) => {
    dispatched += 1;
    return { message_id: `provider-${req.dedupKey}` };
  }, SEND_EMAIL_POLICY);

  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES ('${OWNER}','bca_c','o@example.com')`, []);
  await query(
    `INSERT INTO products (id,name,owner_id,status,scp_status) VALUES (?,?,?,'active','active')`,
    [P, 'Co', OWNER]);
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES ('bca_sig',?,'repository','development_need_observed','low','{}','seed')`, [P]);
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES ('bca_resp',?,'Cover the Saturday class','operations','shadowing','signal_event:bca_sig')`, [P]);
  await query(
    `INSERT INTO autonomy_consents
       (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
        responsibility_id,allowed_scope_json,consequence_boundary,expires_at)
     VALUES ('bca_consent',?,?,'operations','suggest','act','v1','bca_resp',?, 'low',datetime('now','+1 day'))`,
    [OWNER, P, JSON.stringify(['send_email:responsibility_notice'])]);
  await moveResponsibilityTo('bca_resp', 'assisting',
    { productId: P, authorityRef: 'autonomy_consent:bca_consent' });
});

describe('a governed effect and the subscription behind it', () => {
  it('is carried while the company is a paying customer', async () => {
    const action = await plan('bca_effect_paying');
    expect(await executeAssistedSupportEmail(action))
      .toEqual({ dispatched: true, certainty: 'provider_acknowledged' });
  });

  it('stops the moment the subscription is cancelled', async () => {
    // Exactly what `customer.subscription.deleted` writes.
    await query("UPDATE products SET scp_status='paused' WHERE id=?", [P]);

    const before = dispatched;
    const action = await plan('bca_effect_cancelled');
    expect(await executeAssistedSupportEmail(action))
      .toEqual({ dispatched: false, certainty: 'not_attempted' });
    expect(dispatched, 'nothing may be sent for a cancelled company').toBe(before);
  });

  it('does not treat that as the founder withdrawing permission', async () => {
    // The distinction matters on screen and in the record: a founder who
    // stopped paying has not said "I do not want you doing this".
    const consent = (await query(
      'SELECT revoked_at FROM autonomy_consents WHERE id=?', ['bca_consent'])).rows[0];
    expect(consent, 'a billing pause must not forge a revocation')
      .toMatchObject({ revoked_at: null });

    const responsibility = (await query(
      'SELECT state FROM institutional_responsibilities WHERE id=?', ['bca_resp'])).rows[0];
    expect(responsibility, 'nor demote what the company already earned')
      .toMatchObject({ state: 'assisting' });
  });

  it('resumes on resubscription without asking for permission again', async () => {
    await query("UPDATE products SET scp_status='active' WHERE id=?", [P]);
    const action = await plan('bca_effect_resumed');
    expect(await executeAssistedSupportEmail(action))
      .toEqual({ dispatched: true, certainty: 'provider_acknowledged' });
  });

  it('stops for an archived company too, at the gateway', async () => {
    // `archived` is what the data-deletion path sets. It used to write
    // `status='deleted'`, a value the CHECK constraint has never permitted, so
    // that job deleted rows from thirty tables and then threw on the very next
    // line — data gone, product unmarked, and no completion record.
    //
    // This case is stopped by the gateway's kill switch, which refuses any
    // product whose `status` is not 'active' — NOT by the authority read. An
    // earlier version of the fix also tested `status <> 'archived'` there;
    // mutation showed removing it changed nothing, so it was removed. A
    // predicate that cannot fail is worse than no predicate.
    await query("UPDATE products SET status='archived' WHERE id=?", [P]);
    const before = dispatched;
    const action = await plan('bca_effect_archived');
    expect(await executeAssistedSupportEmail(action))
      .toEqual({ dispatched: false, certainty: 'not_attempted' });
    expect(dispatched, 'nothing may be sent for an archived company').toBe(before);
    await query("UPDATE products SET status='active' WHERE id=?", [P]);
  });

  it('lets the deletion path finish, and record that it finished', async () => {
    await query(
      `INSERT INTO founders (id,clerk_user_id,email) VALUES ('bca_del_owner','bca_dc','d@example.com')`, []);
    await query(
      `INSERT INTO products (id,name,owner_id,status) VALUES ('bca_del','Doomed','bca_del_owner','active')`, []);
    // Scheduling is recorded in the audit log, which is also where the
    // processor looks for work and for the completion marker that stops it
    // reprocessing — so the missing completion record was not merely a lost
    // receipt, it left the deletion permanently pending.
    await query(
      `INSERT INTO agent_audit_log
         (id, product_id, event_type, actor_type, actor_id, target_type, target_id,
          description, metadata_json, created_at)
       VALUES ('bca_sched','bca_del','data_deletion_scheduled','founder','bca_del_owner',
               'product','bca_del','scheduled',
               json_object('scheduled_at', datetime('now','-60 days'), 'delete_after_days', 30),
               datetime('now','-60 days'))`, []);

    const { processScheduledDeletions } = await import('../../src/services/privacy/consent.js');
    await processScheduledDeletions();

    expect((await query("SELECT status FROM products WHERE id='bca_del'", [])).rows[0])
      .toMatchObject({ status: 'archived' });
    // The completion record sits AFTER the archive write, so it is the thing
    // that proves the job reached the end rather than throwing in the middle.
    expect((await query(
      `SELECT COUNT(*) n FROM agent_audit_log
        WHERE product_id='bca_del' AND event_type='data_deletion_completed'`, [])).rows[0])
      .toMatchObject({ n: 1 });
  });

  it('reads billing where authority is resolved, not somewhere convenient', () => {
    // Structural. Authority is re-read immediately before dispatch, which is
    // what makes a mid-flight revocation stop a send; the billing state has to
    // be read in the same place or it would be checked once and then trusted.
    const source = readFileSync(
      resolve(ROOT, 'src/services/institution/responsibility-assisted-email.ts'), 'utf8');
    const fn = source.slice(source.indexOf('async function currentAuthority'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain("scp_status");
    expect(body).toContain('JOIN products p');
  });
});

// =============================================================================
// ENTITLEMENT TO ACT WAS DELETED (Private S7b1, 29 September 2026).
//
// A lapsed commercial account used to go read-only by an hourly sweep. Foundry
// has no commercial accounts — it is the owner's alone — and on this
// deployment the sweep had long been answering "entitled" for every company.
// The rule, its job, the trial and the subscription webhook are gone. What the
// tests above and below still hold is that a pause on ANY axis — the billing
// column included, while it is still read — stops the institution acting.
// =============================================================================

// =============================================================================
// §3 + §5: the axis the cancellation now writes, and the instant the authority
// must be valid at.
//
// The test above cancels by writing `scp_status='paused'` — which is what
// `customer.subscription.deleted` USED to write. Migration 145 gave commercial
// entitlement its own field, so a cancellation now writes
// `entitlement_paused_at` and leaves `scp_status` alone. This file kept
// passing, because it was asserting against the old axis: the authority read
// had stopped seeing the exact case it was written for and nothing noticed.
//
// That is the copied-fragment failure. `currentAuthority` had a hand-written
// piece of the operating rule instead of the rule, and a fragment drifts the
// moment the rule grows another axis.
// =============================================================================

describe('the authority read follows the canonical predicate', () => {
  beforeEach(async () => {
    await query(
      `UPDATE products SET scp_status='active', entitlement_paused_at=NULL WHERE id=?`, [P]);
  });

  it('refuses when the founder pauses on the operating axis', async () => {
    await query("UPDATE products SET scp_status='paused' WHERE id=?", [P]);
    const action = await plan('bca_effect_operating');
    expect(await executeAssistedSupportEmail(action))
      .toEqual({ dispatched: false, certainty: 'not_attempted' });
  });

  it('refuses when the record is archived', async () => {
    await query("UPDATE products SET status='archived' WHERE id=?", [P]);
    const action = await plan('bca_effect_archived_axis');
    expect(await executeAssistedSupportEmail(action))
      .toEqual({ dispatched: false, certainty: 'not_attempted' });
    await query("UPDATE products SET status='active' WHERE id=?", [P]);
  });
});

describe('temporal authority is revalidated at the last safe point', () => {
  beforeEach(async () => {
    await query(
      `UPDATE products SET scp_status='active', entitlement_paused_at=NULL, status='active' WHERE id=?`, [P]);
    await query(
      "UPDATE autonomy_consents SET revoked_at=NULL, expires_at=datetime('now','+1 day') WHERE id='bca_consent'",
      []);
  });

  it('refuses a plan whose grant expired between planning and dispatch', async () => {
    // The plan was legitimate when it was made. Authority is a fact about NOW,
    // and a queued plan does not carry it forward.
    const action = await plan('bca_effect_expired');
    await query(
      "UPDATE autonomy_consents SET expires_at=datetime('now','-1 minute') WHERE id='bca_consent'",
      []);
    const before = dispatched;
    expect(await executeAssistedSupportEmail(action))
      .toEqual({ dispatched: false, certainty: 'not_attempted' });
    expect(dispatched, 'an expired grant licenses nothing').toBe(before);
  });

  it('refuses when the grant expires after the claim but before the send', async () => {
    // The window between claiming the plan and crossing the provider boundary.
    // Revalidating only before the claim would send under authority that ended
    // while the row was being marked.
    const action = await plan('bca_effect_expired_midflight');
    const before = dispatched;
    const result = await executeAssistedSupportEmail(action, {
      afterClaim: async () => {
        await query(
          "UPDATE autonomy_consents SET expires_at=datetime('now','-1 minute') WHERE id='bca_consent'",
          []);
      },
    });
    expect(result).toEqual({ dispatched: false, certainty: 'not_attempted' });
    expect(dispatched, 'nothing crosses the provider boundary').toBe(before);
  });

  it('leaves a plan dead when a NEW grant replaces the expired one', async () => {
    // Grant A → Plan A → A expires → Grant B. Plan A references the grant that
    // owned its authority; a later grant is a different fact and does not
    // reanimate it.
    const action = await plan('bca_effect_regrant');
    await query(
      "UPDATE autonomy_consents SET expires_at=datetime('now','-1 minute') WHERE id='bca_consent'",
      []);
    // The new grant is made from Shadowing. That used to be arranged by writing
    // the state directly; migration 159 closed that door, so the step back down
    // is now a real transition and the step back up brings its own fresh shadow
    // proof. The fixture is longer and it is no longer asserting from a state
    // the ladder might never have permitted.
    await query(
      `INSERT INTO responsibility_transitions
         (id, responsibility_id, from_state, to_state, evidence_ref, reason, actor_ref)
       VALUES (?, 'bca_resp', 'assisting', 'shadowing', ?, 'grant expired', 'test')`,
      [nanoid(), await recordEvidence(P, 'grant expired')]);
    await query(
      `INSERT INTO autonomy_consents
         (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
          responsibility_id,allowed_scope_json,consequence_boundary,expires_at)
       VALUES ('bca_consent_b',?,?,'operations','suggest','act','v1','bca_resp',?,'low',datetime('now','+1 day'))`,
      [OWNER, P, JSON.stringify(['send_email:responsibility_notice'])]);
    await moveResponsibilityTo('bca_resp', 'assisting',
      { productId: P, authorityRef: 'autonomy_consent:bca_consent_b' });

    const before = dispatched;
    expect(await executeAssistedSupportEmail(action))
      .toEqual({ dispatched: false, certainty: 'not_attempted' });
    expect(dispatched, 'a new grant does not resurrect an old plan').toBe(before);

    await query("DELETE FROM autonomy_consents WHERE id='bca_consent_b'", []);
    await query(
      "UPDATE institutional_responsibilities SET authority_ref='autonomy_consent:bca_consent' WHERE id='bca_resp'",
      []);
  });

  it('does not re-dispatch on a retry after the grant expired', async () => {
    // The first attempt succeeded; the grant then lapsed. A retry must find the
    // plan already claimed and report what happened, not send again.
    const action = await plan('bca_effect_retry');
    expect(await executeAssistedSupportEmail(action))
      .toEqual({ dispatched: true, certainty: 'provider_acknowledged' });
    const after = dispatched;
    await query(
      "UPDATE autonomy_consents SET expires_at=datetime('now','-1 minute') WHERE id='bca_consent'",
      []);
    const replay = await executeAssistedSupportEmail(action);
    expect(replay.dispatched, 'a retry is not a second authority').toBe(false);
    expect(dispatched).toBe(after);
  });
});
