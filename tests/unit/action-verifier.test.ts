// =============================================================================
// Tests: Action Verifier (Jarvis evolution axis 1 — verified ACTION)
// Success criteria declared BEFORE acting; an independent sweep checks after;
// failure logs a defect AND demotes the acting category one rung. Bad acts
// cost autonomy — that's what makes granting autonomy safe.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { createExecution } from '../../src/services/scp/actions/executor.js';
import { declareCriteria, verifyDueActions } from '../../src/services/outbound/action-verifier.js';
import { setPolicy, getPolicy } from '../../src/services/autopilot/policy.js';

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('av_f','clk_av','av@t.co')", []);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('av_p','VerCo','av_f','active')", []);
  await query(
    `INSERT INTO customers (id, product_id, owner_id, name, email, health_score)
     VALUES ('av_c1', 'av_p', 'av_f', 'Hale', 'hale@c.co', 0.8)`, [],
  );
});

describe('declared success, independently checked', () => {
  it('a completed act with healthy criteria passes and is verified on the record', async () => {
    const execId = await createExecution('av_p', null, {
      action_type: 'send_email', integration: 'resend', to_email: 'hale@c.co',
      subject: 's', body: 'b', cs_customer: 'av_c1',
    });
    await query("UPDATE action_executions SET status='completed' WHERE id=?", [execId]);
    await declareCriteria(execId, [
      { kind: 'provider_accepted' },
      { kind: 'no_error_recorded' },
      { kind: 'customer_health_not_worse', customer_id: 'av_c1', baseline_health: 0.75 },
    ], 0);

    const res = await verifyDueActions();
    expect(res.passed).toBeGreaterThanOrEqual(1);
    const row = (await query('SELECT verify_status FROM action_executions WHERE id=?', [execId]))
      .rows[0] as Record<string, string>;
    expect(row.verify_status).toBe('passed');
  });

  it('a failed act logs a defect AND demotes the acting autopilot category', async () => {
    await setPolicy('av_p', 'customer_success', 'act', 'av_f'); // founder had granted act
    const execId = await createExecution('av_p', null, {
      action_type: 'send_email', integration: 'resend', to_email: 'x@c.co', subject: 's', body: 'b',
    });
    await query(
      "UPDATE action_executions SET status='failed', error_message='provider bounced', approved_by='autopilot:customer_success' WHERE id=?",
      [execId],
    );
    await declareCriteria(execId, [{ kind: 'provider_accepted' }, { kind: 'no_error_recorded' }], 0);

    const res = await verifyDueActions();
    expect(res.failed).toBeGreaterThanOrEqual(1);

    const defect = await query(
      "SELECT reasoning FROM audit_log WHERE action_type='action:verifier' AND outcome='refused'", [],
    );
    expect(defect.rows.length).toBeGreaterThan(0); // "what did you do that didn't work?" answerable

    const policy = await getPolicy('av_p', 'customer_success');
    expect(policy.mode).toBe('suggest'); // act → suggest: bad acts cost autonomy
    const row = (await query(
      "SELECT last_demotion_reason FROM autopilot_policies WHERE product_id='av_p' AND category='customer_success'", [],
    )).rows[0] as Record<string, string>;
    expect(row.last_demotion_reason).toContain('failed verification');
  });

  it('health regression fails the act; missing data abstains rather than failing', async () => {
    await query("UPDATE customers SET health_score = 0.4 WHERE id='av_c1'", []); // regressed
    const bad = await createExecution('av_p', null, {
      action_type: 'send_email', integration: 'resend', to_email: 'hale@c.co', subject: 's', body: 'b',
    });
    await query("UPDATE action_executions SET status='completed' WHERE id=?", [bad]);
    await declareCriteria(bad, [
      { kind: 'customer_health_not_worse', customer_id: 'av_c1', baseline_health: 0.8 },
    ], 0);

    const noData = await createExecution('av_p', null, {
      action_type: 'send_email', integration: 'resend', to_email: 'g@c.co', subject: 's', body: 'b',
    });
    await query("UPDATE action_executions SET status='completed' WHERE id=?", [noData]);
    await declareCriteria(noData, [
      { kind: 'customer_health_not_worse', customer_id: 'av_missing', baseline_health: 0.8 },
    ], 0);

    await verifyDueActions();
    const badRow = (await query('SELECT verify_status FROM action_executions WHERE id=?', [bad])).rows[0] as Record<string, string>;
    const noDataRow = (await query('SELECT verify_status FROM action_executions WHERE id=?', [noData])).rows[0] as Record<string, string>;
    expect(badRow.verify_status).toBe('failed');    // regression is a real failure
    expect(noDataRow.verify_status).toBe('passed'); // absence of data is an abstention, not a failure
  });

  it('an act with no checkable criteria is itself a defect', async () => {
    const execId = await createExecution('av_p', null, {
      action_type: 'send_email', integration: 'resend', to_email: 'y@c.co', subject: 's', body: 'b',
    });
    await query("UPDATE action_executions SET status='completed' WHERE id=?", [execId]);
    await query("UPDATE action_executions SET verify_criteria='[]', verify_status='pending', verify_after=datetime('now','-1 hour') WHERE id=?", [execId]);
    await verifyDueActions();
    const row = (await query('SELECT verify_status FROM action_executions WHERE id=?', [execId])).rows[0] as Record<string, string>;
    expect(row.verify_status).toBe('failed');
  });
});

describe('a proposal is not an act, and declares nothing', () => {
  it('customer-success is held at the platform ceiling, so nothing is verified', async () => {
    // THIS USED TO ASSERT THAT IT ACTED AND CARRIED CRITERIA. `customer_success`
    // is now capped at 'suggest' — it reaches third parties by the same post as
    // outreach, and its absence from the cap table was an omission rather than
    // a decision. What a send costs the founder is the reason, not anything
    // about how the churn score is computed: it is deterministic. So the founder's 'act' produces a proposal, and a proposal
    // has no outcome to declare success criteria for: declaring them would be
    // asserting that something happened.
    //
    // What an act DOES declare is asserted in
    // `attribution-under-a-lifted-ceiling.test.ts`, against the real branch.
    await query(
      `INSERT INTO customers (id, product_id, owner_id, name, email, churn_risk, health_score, last_active_at)
       VALUES ('av_c2', 'av_p', 'av_f', 'Risk', 'risk@c.co', 0.9, 0.3, ?)`,
      [new Date(Date.now() - 20 * 86_400_000).toISOString()],
    );
    await setPolicy('av_p', 'customer_success', 'act', 'av_f');
    const { runSuccessSweep } = await import('../../src/services/departments/success.js');
    const res = await runSuccessSweep('av_p');
    expect(res.sent).toBe(0);
    expect(res.proposed).toBe(1);

    const exec = (await query(
      "SELECT status, verify_criteria, verify_status FROM action_executions WHERE product_id='av_p' AND payload_json LIKE '%av_c2%'", [],
    )).rows[0] as Record<string, string>;
    expect(exec.status).toBe('pending');
    expect(exec.verify_status, 'nothing happened, so nothing is awaiting verification')
      .toBeFalsy();
    expect(exec.verify_criteria).toBeFalsy();
  });
});
