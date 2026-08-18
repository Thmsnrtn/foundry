process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

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
  await query(
    "UPDATE institutional_responsibilities SET state='assisting',authority_ref='autonomy_consent:bca_consent' WHERE id='bca_resp'",
    []);
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
// ONBOARDING ↔ BILLING: an account that never paid looked exactly like one that did.
//
// The cancellation path is a Stripe webhook, so it only fires for a
// subscription that once existed. A founder who onboarded and never started
// one has no Stripe customer at all, and a trial that expires without
// converting produces no event either. `scp_status` stayed 'active' from
// onboarding and `tier` stayed NULL, and nothing anywhere read trial expiry —
// `getTrialStatus` was computed for a dashboard badge and consulted by nothing
// that spends money or acts.
//
// Owner decision: such an account is READ-ONLY. Its data stays readable;
// Foundry stops spending and stops reaching outward on its behalf.
// =============================================================================

describe('entitlement to act', () => {
  const paying = 'ent_paying';
  const lapsed = 'ent_lapsed';
  const trialing = 'ent_trialing';

  it('is granted by a paid tier, a live trial, or a period already paid for', async () => {
    const { entitledToAct } = await import('../../src/services/billing/entitlement.js');
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();

    expect(entitledToAct({ tier: 'solo', trialEndsAt: null })).toBe(true);
    expect(entitledToAct({ tier: 'solo', trialEndsAt: past }),
      'a paid tier outlives its trial window').toBe(true);
    expect(entitledToAct({ tier: null, trialEndsAt: future }),
      'a live trial is entitlement').toBe(true);
    expect(entitledToAct({ tier: null, trialEndsAt: past }),
      'an expired trial is not').toBe(false);
    expect(entitledToAct({ tier: null, trialEndsAt: null }),
      'never having started is not').toBe(false);
    // The convention the owner asked for: cancelling ends the plan, not the
    // period already bought.
    expect(entitledToAct({ tier: null, trialEndsAt: past, paidThrough: future }),
      'a cancelled founder keeps what they paid for').toBe(true);
    expect(entitledToAct({ tier: null, trialEndsAt: past, paidThrough: past }),
      'and loses it when that period ends').toBe(false);
  });

  it('pauses a company whose trial lapsed without converting', async () => {
    const { sweepEntitlements } = await import('../../src/services/billing/entitlement.js');
    await query(
      `INSERT INTO founders (id,clerk_user_id,email,tier,trial_ends_at) VALUES
        ('ent_f1','ent_c1','p@example.com','growth',NULL),
        ('ent_f2','ent_c2','l@example.com',NULL,datetime('now','-3 days')),
        ('ent_f3','ent_c3','t@example.com',NULL,datetime('now','+3 days'))`, []);
    await query(
      `INSERT INTO products (id,name,owner_id,status,scp_status) VALUES
        (?,'Paying','ent_f1','active','active'),
        (?,'Lapsed','ent_f2','active','active'),
        (?,'Trialing','ent_f3','active','active')`, [paying, lapsed, trialing]);

    const { paused } = await sweepEntitlements();
    expect(paused).toContain(lapsed);
    expect(paused, 'a paying company must not be paused').not.toContain(paying);
    expect(paused, 'a live trial must not be paused').not.toContain(trialing);
  });

  it('warns before the trial ends, not only after', async () => {
    // The lifecycle mail Foundry did not have: a trial ended, the account went
    // read-only, and the first the founder knew was that nothing worked.
    const notices: Array<Record<string, unknown>> = [];
    const { registerToolHandler } = await import('../../src/services/outbound/gateway.js');
    const { ACCOUNT_NOTICE_POLICY } = await import('../../src/services/billing/account-notice.js');
    registerToolHandler('send_account_notice', async (req) => {
      notices.push(req.params as Record<string, unknown>);
      return { message_id: 'em_notice' };
    }, ACCOUNT_NOTICE_POLICY);

    const { sendTrialEndingNotices } = await import('../../src/services/billing/entitlement.js');
    await query(
      `INSERT INTO founders (id,clerk_user_id,email,tier,trial_ends_at) VALUES
        ('ent_f5','ent_c5','soon@example.com',NULL,datetime('now','+2 days')),
        ('ent_f6','ent_c6','later@example.com',NULL,datetime('now','+9 days')),
        ('ent_f7','ent_c7','paying@example.com','growth',datetime('now','+2 days'))`, []);
    await query(
      `INSERT INTO products (id,name,owner_id,status,scp_status) VALUES
        ('ent_p5','Ending Soon','ent_f5','active','active'),
        ('ent_p6','Ending Later','ent_f6','active','active'),
        ('ent_p7','Paying','ent_f7','active','active')`, []);

    const warned = await sendTrialEndingNotices();
    expect(warned, 'a trial ending inside the window is warned').toContain('ent_p5');
    expect(warned, 'one ending well outside it is not').not.toContain('ent_p6');
    expect(warned, 'a paying founder has no trial to warn about').not.toContain('ent_p7');
    const before = notices.length;

    // The job runs hourly; the founder is warned once, not every hour.
    await sendTrialEndingNotices();
    expect(notices.length, 'an hourly job must not send an hourly email').toBe(before);
  });

  it('tells the founder their company went read-only, and only once', async () => {
    // The pause is total, so the notice is the only mail that can reach them —
    // and the reason it may is that it is the mail ABOUT the pause. An account
    // that silently stops working is the version of this feature that produces
    // support tickets.
    const notices: Array<Record<string, unknown>> = [];
    const { registerToolHandler } = await import('../../src/services/outbound/gateway.js');
    const { ACCOUNT_NOTICE_POLICY } = await import('../../src/services/billing/account-notice.js');
    registerToolHandler('send_account_notice', async (req) => {
      notices.push(req.params as Record<string, unknown>);
      return { message_id: 'em_notice' };
    }, ACCOUNT_NOTICE_POLICY);

    const { sweepEntitlements } = await import('../../src/services/billing/entitlement.js');
    await query(
      `INSERT INTO founders (id,clerk_user_id,email,tier,trial_ends_at) VALUES
        ('ent_f4','ent_c4','notice@example.com',NULL,datetime('now','-3 days'))`, []);
    await query(
      `INSERT INTO products (id,name,owner_id,status,scp_status)
       VALUES ('ent_p4','Notified','ent_f4','active','active')`, []);

    // Scoped to THIS founder: the sweep now selects on the record rather than
    // on operation, so other cases' lapsed companies are legitimately in scope
    // too and counting every notice would be counting other tests.
    const mine = () => notices.filter(
      (n) => JSON.stringify(n).includes('ent_p4')
        || (n.notice as Record<string, unknown> | undefined)?.companyName === 'Notified');

    await sweepEntitlements();
    expect(mine().length, 'exactly one notice for the lapse').toBe(1);

    // The hourly sweep runs again. The company is already paused, so there is
    // nothing to pause and nothing to say.
    await sweepEntitlements();
    expect(mine().length, 'a repeated sweep must not re-send').toBe(1);
  });

  it('stops that company acting, on the axis that belongs to billing', async () => {
    // Migration 145 gave commercial entitlement its own field. It used to write
    // `scp_status`, which is where a founder's own pause and an operator's
    // pause also live — so the sweep could resume a company somebody had
    // deliberately stopped, and no reader could tell which subject had spoken.
    const row = (await query(
      'SELECT scp_status, entitlement_paused_at FROM products WHERE id=?', [lapsed]))
      .rows[0] as Record<string, string | null>;
    expect(row.entitlement_paused_at, 'the billing axis carries the billing pause')
      .not.toBeNull();
    expect(row.scp_status, 'and the operating axis is left to its own writers')
      .toBe('active');

    // The canonical predicate is what every reader uses, and it is false now.
    const { operatingProduct } = await import('../../src/db/client.js');
    expect((await query(
      `SELECT COUNT(*) n FROM products WHERE id=? AND ${operatingProduct()}`, [lapsed]))
      .rows[0]).toMatchObject({ n: 0 });
  });

  it('resumes when they subscribe, without asking for permission again', async () => {
    // One-way enforcement leaves a founder who pays after a lapse stuck
    // read-only until somebody notices — a worse product than not enforcing.
    const { sweepEntitlements } = await import('../../src/services/billing/entitlement.js');
    await query("UPDATE founders SET tier='solo' WHERE id='ent_f2'", []);
    const { resumed } = await sweepEntitlements();
    expect(resumed).toContain(lapsed);
    expect((await query('SELECT entitlement_paused_at FROM products WHERE id=?', [lapsed]))
      .rows[0]).toMatchObject({ entitlement_paused_at: null });
  });

  it('never forges a revocation or a demotion', async () => {
    // A billing pause is not the founder saying "stop". Nothing is revoked and
    // nothing is demoted, which is what makes resuming honest.
    const { sweepEntitlements } = await import('../../src/services/billing/entitlement.js');
    await query("UPDATE founders SET tier=NULL, trial_ends_at=datetime('now','-1 day') WHERE id=?", [OWNER]);
    await sweepEntitlements();
    expect((await query('SELECT revoked_at FROM autonomy_consents WHERE id=?', ['bca_consent'])).rows[0])
      .toMatchObject({ revoked_at: null });
    expect((await query('SELECT state FROM institutional_responsibilities WHERE id=?', ['bca_resp'])).rows[0])
      .toMatchObject({ state: 'assisting' });
  });

  it('is registered on a schedule, or it is a function nobody runs', async () => {
    const { JOB_REGISTRY } = await import('../../src/jobs/index.js');
    expect(JOB_REGISTRY.entitlement_sweep).toBeTruthy();
    expect(JOB_REGISTRY.entitlement_sweep.schedule).toMatch(/^\S+ \S+ \S+ \S+ \S+$/);
  });
});

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

  it('refuses when the billing axis is paused, which is where cancellation writes now', async () => {
    await query(
      "UPDATE products SET entitlement_paused_at=datetime('now') WHERE id=?", [P]);
    const before = dispatched;
    const action = await plan('bca_effect_entitlement');
    expect(await executeAssistedSupportEmail(action))
      .toEqual({ dispatched: false, certainty: 'not_attempted' });
    expect(dispatched).toBe(before);

    // WHICH refusal, not just that one happened. The outbound gateway would
    // also refuse this send, so "nothing was dispatched" is true either way —
    // a mutation restoring the old scp_status-only predicate passed an earlier
    // version of this case for exactly that reason.
    //
    // The row says which: an authority refusal returns before the plan is
    // claimed, leaving it 'approved'; a gateway refusal happens after the
    // claim and marks it 'failed'.
    const row = (await query('SELECT status FROM outbound_actions WHERE id=?', [action]))
      .rows[0] as Record<string, string>;
    expect(row.status, 'the authority read must refuse this, not the gateway')
      .toBe('approved');
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
    // The new grant is made from Shadowing, which is the path migration 133
    // permits without fresh comparison evidence — a re-grant from Assisting
    // needs that evidence, and demanding it here would make this a test about
    // the ladder rather than about which grant a plan belongs to.
    await query(
      "UPDATE institutional_responsibilities SET state='shadowing',authority_ref=NULL WHERE id='bca_resp'",
      []);
    await query(
      `INSERT INTO autonomy_consents
         (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
          responsibility_id,allowed_scope_json,consequence_boundary,expires_at)
       VALUES ('bca_consent_b',?,?,'operations','suggest','act','v1','bca_resp',?,'low',datetime('now','+1 day'))`,
      [OWNER, P, JSON.stringify(['send_email:responsibility_notice'])]);
    await query(
      "UPDATE institutional_responsibilities SET state='assisting',authority_ref='autonomy_consent:bca_consent_b' WHERE id='bca_resp'",
      []);

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
