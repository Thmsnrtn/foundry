process.env.TURSO_DATABASE_URL='file::memory:';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getFounderAssistingActivity } from '../../src/services/institution/responsibility-assisted-email.js';
import { moveResponsibilityTo } from '../fixtures/responsibility-state.js';

// =============================================================================
// FOUNDRY MAY NOT PROMISE A RECONCILIATION IT HAS NO MECHANISM FOR.
//
// When the gateway fails during execution, whether the provider took the
// message is genuinely unknown. Foundry records `effect_certainty='ambiguous'`,
// writes `reconcile_after` fifteen minutes out, and told the founder "dispatch
// is ambiguous and needs reconciliation".
//
// Nothing reconciles it. `reconcile_after` is written by three paths and read
// by nothing anywhere in `src/` — it survived the write-only ratchet only
// because a `SELECT *` in the outbound executor masks it. So the sentence
// described a mechanism that does not exist, on the one line a founder reads
// to find out whether their company said something to somebody.
//
// The honest sentence says what is true: it is not known whether this went out,
// Foundry has not sent it again because sending twice is worse than not
// knowing, and the founder is the one who can find out.
//
// Resolving it properly means asking the provider whether it took the message —
// which is a fact about the provider, not a claim about the outcome, and is
// legitimate. It needs a real provider call, so it is recorded as missing
// rather than faked.
// =============================================================================

const P = 'amb_product';
const OWNER = 'amb_owner';
const RESP = 'amb_resp';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'amb_c','o@example.com')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES (?,'Fold Street Dance',?)`, [P, OWNER]);
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES ('amb_sig',?,'repository','development_need_observed','low','{}','seed')`, [P]);
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,'Every timetabled class has a teacher','operations','shadowing','signal_event:amb_sig')`,
    [RESP, P]);
  await query(
    `INSERT INTO autonomy_consents
       (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
        responsibility_id,allowed_scope_json,consequence_boundary,expires_at)
     VALUES ('amb_consent',?,?,'operations','suggest','act','v1',?,?, 'low',datetime('now','+1 day'))`,
    [OWNER, P, RESP, JSON.stringify(['send_email:responsibility_notice'])]);
  await moveResponsibilityTo(RESP, 'assisting',
    { productId: P, authorityRef: 'autonomy_consent:amb_consent' });
  await query(
    `INSERT INTO outbound_actions
       (id,product_id,agent_name,integration_name,action_type,status,parameters_json,rationale,
        preview_text,responsibility_id,authority_consent_id,authority_scope,effect_id,outcome_status)
     VALUES ('amb_action',?,'institution:assisting','resend','send_email','approved','{}','r',
             'Send bounded responsibility notice to ines@example.com',?,'amb_consent',
             'send_email:responsibility_notice','amb_effect','unresolved')`,
    [P, RESP]);
  // The gateway failed mid-execution: whether the provider took it is unknown.
  await query(
    `UPDATE outbound_actions SET status='failed',effect_certainty='ambiguous',
       reconcile_after=datetime('now','+15 minutes') WHERE id='amb_action'`);
});

describe('an assisted send whose fate is unknown', () => {
  it('says it is unknown, and does not promise a reconciliation', async () => {
    const line = (await getFounderAssistingActivity(P))[0];
    expect(line.detail).not.toContain('needs reconciliation');
    // What is actually true, in the founder's terms.
    expect(line.detail).toContain('I do not know whether this went out');
    expect(line.detail).toContain('not sent it again');
  });

  it('has no reader for the retry time it writes, and says so where it is written', () => {
    const service = readFileSync(
      resolve(__dirname, '../../src/services/institution/responsibility-assisted-email.ts'), 'utf8');
    // If somebody wires a real dispatch reconciliation, this note is what they
    // should be deleting.
    expect(service).toContain('NOTHING READS `reconcile_after`');
  });
});
