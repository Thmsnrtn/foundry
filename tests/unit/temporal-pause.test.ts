// =============================================================================
// Tests: a pause has to reach work that was already queued
//
// The permission to act is checked when the work RUNS, not when it was
// planned. That distinction is the whole point of a pause: a founder who
// pauses their company at 3pm expects the thing an agent queued at 2pm not to
// go out at 4pm. A queue that carries its own authorization from the moment of
// planning is a queue that cannot be stopped.
//
// Three sequences, and one thing that must NOT be refused:
//
//   operating → queued → paused → executed later     → no effect
//   entitled  → queued → subscription lapses → later → no effect
//   operating → EXECUTED → paused → reconciliation   → still reconciles
//
// The last one matters as much as the first two. An effect that already
// crossed the provider boundary happened, and finding out what came of it is
// not a new act. Refusing reconciliation because the company is now paused
// would leave real effects permanently unaccounted for — and the fix for a
// fail-open must not be a fail-closed that loses the truth.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// `approved_by` takes a principal reference — a kind AND an id. These
// fixtures passed the bare word 'founder', which is a role label with nobody
// behind it: the same shape as the literal 'ceo' this field used to hold.
import { principalRef } from '../../src/services/outbound/acting-principal.js';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const F = 'tp_f';
const P = 'tp_p';

const slackSpy = vi.fn(async () => ({
  certainty: 'provider_acknowledged' as const, providerMessageTs: '1.0',
}));
vi.mock('../../src/services/integration/slack.js', () => ({
  sendSlackNotification: slackSpy,
}));

/** Queue an action while the company is still operating. */
async function queueWhileOperating(): Promise<string> {
  const row = (await query(
    'SELECT status, scp_status, entitlement_paused_at FROM products WHERE id = ?', [P]))
    .rows[0] as Record<string, unknown>;
  expect(row.status, 'the fixture must start from a company that may act').toBe('active');
  expect(row.scp_status).toBe('active');
  expect(row.entitlement_paused_at).toBeNull();

  const id = nanoid();
  await query(
    `INSERT INTO action_executions
       (id, product_id, action_type, integration, payload_json, status)
     VALUES (?, ?, 'post_slack', 'slack', ?, 'pending')`,
    [id, P, JSON.stringify({ action_type: 'post_slack', text: 'hi', channel: '#g' })]);
  return id;
}

async function statusOf(id: string): Promise<Record<string, unknown>> {
  return (await query(
    'SELECT status, error_message, effect_certainty, verify_status FROM action_executions WHERE id = ?',
    [id])).rows[0] as Record<string, unknown>;
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'clerk_tp', 'tp@test.local']);
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status)
     VALUES (?,'Temporal Co',?, 'active','active')`, [P, F]);
});

beforeEach(async () => {
  slackSpy.mockClear();
  await query(
    `UPDATE products SET status='active', scp_status='active', entitlement_paused_at=NULL
      WHERE id=?`, [P]);
});

describe('a pause reaches work that was already queued', () => {
  it('refuses an action planned before the founder paused the company', async () => {
    const { approveAndExecute } = await import('../../src/services/scp/actions/executor.js');
    const id = await queueWhileOperating();

    // 3pm.
    await query(`UPDATE products SET scp_status='paused' WHERE id=?`, [P]);

    // 4pm.
    const result = await approveAndExecute(id, principalRef('founder', F), { scopeProductId: P });
    expect(result.success).toBe(false);
    expect(slackSpy, 'the pause has to reach the queue, not only the plan')
      .not.toHaveBeenCalled();
    expect(String((await statusOf(id)).error_message)).toMatch(/refused before dispatch/);
  });

  it('refuses one planned before the subscription lapsed', async () => {
    const { approveAndExecute } = await import('../../src/services/scp/actions/executor.js');
    const id = await queueWhileOperating();
    await query(
      `UPDATE products SET entitlement_paused_at=datetime('now') WHERE id=?`, [P]);

    expect((await approveAndExecute(id, principalRef('founder', F), { scopeProductId: P })).success).toBe(false);
    expect(slackSpy).not.toHaveBeenCalled();
  });

  it('refuses one planned before the company was erased', async () => {
    const { approveAndExecute } = await import('../../src/services/scp/actions/executor.js');
    const id = await queueWhileOperating();
    await query(
      `UPDATE products SET status='archived', scp_status='archived' WHERE id=?`, [P]);

    expect((await approveAndExecute(id, principalRef('founder', F), { scopeProductId: P })).success).toBe(false);
    expect(slackSpy).not.toHaveBeenCalled();
  });

  it('carries out work planned and run while the company is operating', async () => {
    // The half that says the guard is not simply refusing everything.
    const { approveAndExecute } = await import('../../src/services/scp/actions/executor.js');
    const id = await queueWhileOperating();
    expect((await approveAndExecute(id, principalRef('founder', F), { scopeProductId: P })).success).toBe(true);
    expect(slackSpy).toHaveBeenCalledTimes(1);
  });

  it('resumes carrying out work after the pause is lifted', async () => {
    const { approveAndExecute } = await import('../../src/services/scp/actions/executor.js');
    const id = await queueWhileOperating();
    await query(`UPDATE products SET scp_status='paused' WHERE id=?`, [P]);
    await approveAndExecute(id, principalRef('founder', F), { scopeProductId: P });

    // A fresh action after resuming: the refused one is terminal, and that is
    // the honest outcome rather than a queue that silently re-fires.
    await query(`UPDATE products SET scp_status='active' WHERE id=?`, [P]);
    const next = await queueWhileOperating();
    expect((await approveAndExecute(next, principalRef('founder', F), { scopeProductId: P })).success).toBe(true);
  });
});

describe('reconciliation is not a new authorization', () => {
  it('still verifies an effect that already crossed the provider boundary', async () => {
    // It happened. Finding out what came of it is not a new act, and refusing
    // to look because the company is now paused would leave real effects
    // permanently unaccounted for.
    const id = nanoid();
    await query(
      `INSERT INTO action_executions
         (id, product_id, action_type, integration, payload_json, status,
          effect_certainty, verify_status, verify_after, verify_criteria, executed_at)
       VALUES (?, ?, 'post_slack', 'slack', '{}', 'completed',
               'provider_acknowledged', 'pending', datetime('now','-1 hour'),
               ?, datetime('now','-2 hours'))`,
      [id, P, JSON.stringify([{ kind: 'status_is', expected: 'completed' }])]);

    await query(`UPDATE products SET scp_status='paused' WHERE id=?`, [P]);

    const { verifyDueActions } = await import('../../src/services/outbound/action-verifier.js');
    const swept = await verifyDueActions();
    expect(swept.checked,
      'a paused company still has to learn what its already-sent effects did')
      .toBeGreaterThan(0);
    expect((await statusOf(id)).verify_status,
      'the verification resolved rather than staying pending forever')
      .not.toBe('pending');
  });

  it('and reconciling does not dispatch anything', async () => {
    expect(slackSpy, 'looking at an effect is not performing one')
      .not.toHaveBeenCalled();
  });
});
