process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getFounderAssistingActivity } from '../../src/services/institution/responsibility-assisted-email.js';
import { moveResponsibilityTo } from '../fixtures/responsibility-state.js';

// =============================================================================
// "NO CONSEQUENTIAL ACTION WAS VERIFIED" IS NOT A REASON.
//
// When the gateway refuses before the provider is touched, Foundry knows
// exactly why: the kill switch is on, the data classification would have been
// breached, the weekly cap is reached, the policy refused it, there is no
// handler. All of it is recorded in `provider_receipt_json`, which nothing has
// ever read. The founder — whose message to a person did not go — read "no
// consequential action was verified" and could not tell a switched-off Foundry
// from a rule they could change.
//
// THE REASON TEXT IS DELIBERATELY NOT SHOWN. `reason` carries handler and
// provider error strings, which are external content and may carry anything.
// `phase` is a closed vocabulary Foundry owns, so it can be said in plain words
// without repeating something a provider wrote.
// =============================================================================

const P = 'why_product';
const OWNER = 'why_owner';
const RESP = 'why_resp';

async function refusedAt(actionId: string, effectId: string, phase: string): Promise<void> {
  await query(
    `INSERT INTO outbound_actions
       (id,product_id,agent_name,integration_name,action_type,status,parameters_json,rationale,
        preview_text,responsibility_id,authority_consent_id,authority_scope,effect_id,outcome_status)
     VALUES (?,?,'institution:assisting','resend','send_email','approved','{}','r',
             'Send bounded responsibility notice to ines@example.com',?,'why_consent',
             'send_email:responsibility_notice',?,'unresolved')`,
    [actionId, P, RESP, effectId]);
  await query(
    `UPDATE outbound_actions SET status='failed',effect_certainty='not_attempted',
       provider_receipt_json=? WHERE id=?`,
    [JSON.stringify({ gateway_invocation_id: 'inv_1', phase, reason: 'PROVIDER SAID SOMETHING' }), actionId]);
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'why_c','o@example.com')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES (?,'Fold Street Dance',?)`, [P, OWNER]);
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES ('why_sig',?,'repository','development_need_observed','low','{}','seed')`, [P]);
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,'Every timetabled class has a teacher','operations','shadowing','signal_event:why_sig')`,
    [RESP, P]);
  await query(
    `INSERT INTO autonomy_consents
       (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
        responsibility_id,allowed_scope_json,consequence_boundary,expires_at)
     VALUES ('why_consent',?,?,'operations','suggest','act','v1',?,?, 'low',datetime('now','+1 day'))`,
    [OWNER, P, RESP, JSON.stringify(['send_email:responsibility_notice'])]);
  await moveResponsibilityTo(RESP, 'assisting',
    { productId: P, authorityRef: 'autonomy_consent:why_consent' });
});

describe('a send the gateway refused', () => {
  it('tells the founder which boundary stopped it, in words they can act on', async () => {
    await refusedAt('why_action_ks', 'why_effect_ks', 'kill_switch');
    const line = (await getFounderAssistingActivity(P))[0];
    expect(line.detail).not.toBe('no consequential action was verified');
    expect(line.detail).toContain('switched off');
    // Nothing it did not write itself.
    expect(line.detail).not.toContain('PROVIDER SAID SOMETHING');
  });

  it('says the cap, the classification and the missing handler apart', async () => {
    await refusedAt('why_action_bg', 'why_effect_bg', 'budget');
    await refusedAt('why_action_cl', 'why_effect_cl', 'classification');
    await refusedAt('why_action_nh', 'why_effect_nh', 'no_handler');
    const details = (await getFounderAssistingActivity(P)).map((a) => a.detail).join(' | ');
    expect(details).toContain('limit');
    expect(details).toContain('customer data');
    expect(details).toContain('no way to send');
  });

  it('still says the plain thing when it has no receipt to read', async () => {
    await refusedAt('why_action_none', 'why_effect_none', 'execution');
    await query("UPDATE outbound_actions SET provider_receipt_json=NULL WHERE id='why_action_none'");
    const line = (await getFounderAssistingActivity(P)).find((a) => a.state === 'failed')!;
    expect(line.detail.length).toBeGreaterThan(0);
  });
});
