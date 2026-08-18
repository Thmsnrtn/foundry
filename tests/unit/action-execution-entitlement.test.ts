// =============================================================================
// Tests: the second outward door was not checking the rule the first one was
//
// Foundry has two paths that produce outward effects:
//
//   outbound_actions   → services/outbound/gateway.ts → checkKillSwitch → send
//   action_executions  → services/scp/actions/executor.ts → send
//
// The second posts to Slack, files Linear tickets and calls customer webhooks,
// and it reached none of the checks the first one does. `checkKillSwitch` had
// exactly one caller in the entire system: the gateway.
//
// So an approval on this path dispatched an outward effect for a company whose
// subscription had lapsed, whose founder had paused it, or whose data had just
// been erased and whose product row was archived. The owner's decision is
// explicit — an unpaid account is read-only, no spend and no outward effects —
// and it was being enforced at one of the two doors.
//
// This is the same shape as the pause-axis findings, one level up: not a guard
// bound to the wrong subject, but a second subject nobody bound a guard to.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const F = 'ae_f';
const P = 'ae_p';

const slackSpy = vi.fn(async () => ({
  certainty: 'provider_acknowledged' as const, providerMessageTs: '1.0',
}));

vi.mock('../../src/services/integration/slack.js', () => ({
  sendSlackNotification: slackSpy,
}));

async function execution(): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO action_executions
       (id, product_id, action_type, integration, payload_json, status)
     VALUES (?, ?, 'post_slack', 'slack', ?, 'pending')`,
    [id, P, JSON.stringify({ action_type: 'post_slack', text: 'hello', channel: '#general' })]);
  return id;
}

async function statusOf(id: string): Promise<Record<string, unknown>> {
  return (await query(
    'SELECT status, error_message FROM action_executions WHERE id = ?', [id]))
    .rows[0] as Record<string, unknown>;
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'clerk_ae', 'ae@test.local']);
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status) VALUES (?,'Acting Co',?,'active','active')`,
    [P, F]);
});

beforeEach(async () => {
  slackSpy.mockClear();
  await query(
    `UPDATE products SET status='active', scp_status='active', entitlement_paused_at=NULL WHERE id=?`,
    [P]);
});

describe('an approved action still asks whether the company may act', () => {
  it('refuses when the founder has paused the company', async () => {
    const { approveAndExecute } = await import('../../src/services/scp/actions/executor.js');
    const id = await execution();
    await query(`UPDATE products SET scp_status='paused' WHERE id=?`, [P]);

    const result = await approveAndExecute(id, 'founder', { ownerId: F });
    expect(result.success).toBe(false);
    expect(slackSpy, 'nothing may leave the building').not.toHaveBeenCalled();

    const row = await statusOf(id);
    expect(row.status).toBe('cancelled');
    expect(String(row.error_message)).toMatch(/refused before dispatch/);
  });

  it('refuses when the subscription has lapsed', async () => {
    // The owner's decision, in the words it was given: an unpaid account is
    // read-only. No spend, no outward effects.
    const { approveAndExecute } = await import('../../src/services/scp/actions/executor.js');
    const id = await execution();
    await query(
      `UPDATE products SET entitlement_paused_at=datetime('now') WHERE id=?`, [P]);

    expect((await approveAndExecute(id, 'founder', { ownerId: F })).success).toBe(false);
    expect(slackSpy).not.toHaveBeenCalled();
  });

  it('refuses when the company has been erased', async () => {
    const { approveAndExecute } = await import('../../src/services/scp/actions/executor.js');
    const id = await execution();
    await query(
      `UPDATE products SET status='archived', scp_status='archived' WHERE id=?`, [P]);

    expect((await approveAndExecute(id, 'founder', { ownerId: F })).success).toBe(false);
    expect(slackSpy).not.toHaveBeenCalled();
  });

  it('carries out the action for a company that is operating', async () => {
    // A guard that refuses the legitimate case is not extra secure. It is
    // broken, and this half of the test is the half that says so.
    const { approveAndExecute } = await import('../../src/services/scp/actions/executor.js');
    const id = await execution();

    const result = await approveAndExecute(id, 'founder', { ownerId: F });
    expect(result.success, 'an operating company may still act').toBe(true);
    expect(slackSpy).toHaveBeenCalledTimes(1);
    expect((await statusOf(id)).status).toBe('completed');
  });

  it('leaves a refused execution able to run later', async () => {
    // Refusing must not consume the approval: when the subscription resumes,
    // the founder should not have to recreate the action... but nor should a
    // cancelled one silently re-fire. Cancelled is the honest terminal state,
    // and the test says which one this is rather than leaving it to be found.
    const { approveAndExecute } = await import('../../src/services/scp/actions/executor.js');
    const id = await execution();
    await query(`UPDATE products SET scp_status='paused' WHERE id=?`, [P]);
    await approveAndExecute(id, 'founder', { ownerId: F });

    await query(`UPDATE products SET scp_status='active' WHERE id=?`, [P]);
    const second = await approveAndExecute(id, 'founder', { ownerId: F });
    expect(second.success, 'a cancelled execution is finished, not queued').toBe(false);
    expect(slackSpy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// The same door, twice more.
//
// `checkKillSwitch` had one caller. Finding the second outward path made the
// question worth asking of every other one, and two more turned up:
//
//   • `lib/webhooks.ts` — the CUSTOMER-facing webhook fan-out, fired on
//     risk-state changes, metric syncs and decision resolutions. There are two
//     webhook paths in this system and only the other one went through the
//     gateway.
//   • the Slack daily-briefing push in `scp/scheduler.ts`. A briefing is
//     product work, not account mail, so the narrow deliverable-while-paused
//     exemption does not reach it.
// =============================================================================

describe('the other outward paths ask the same question', () => {
  it('does not fire customer webhooks for a company that is paused', async () => {
    const { dispatchWebhook } = await import('../../src/lib/webhooks.js');
    const fetchSpy = vi.fn(async () => new Response('', { status: 202 }));
    vi.stubGlobal('fetch', fetchSpy);
    const { encrypt } = await import('../../src/services/encryption.js');
    await query(
      `INSERT OR REPLACE INTO webhooks (id, founder_id, product_id, url, events, secret)
       VALUES ('ae_w1', ?, ?, 'https://example.com/hook', '["risk_state.changed"]', ?)`,
      [F, P, encrypt('whsec_x')]);

    await query(`UPDATE products SET scp_status='paused' WHERE id=?`, [P]);
    const receipts = await dispatchWebhook(P, F, 'risk_state.changed', { x: 1 });

    expect(receipts, 'nothing was delivered').toEqual([]);
    expect(fetchSpy, 'and nothing was attempted').not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('fires them for a company that is operating', async () => {
    const { dispatchWebhook } = await import('../../src/lib/webhooks.js');
    const fetchSpy = vi.fn(async () => new Response('', { status: 202 }));
    vi.stubGlobal('fetch', fetchSpy);

    const receipts = await dispatchWebhook(P, F, 'risk_state.changed', { x: 1 });
    expect(receipts.length, 'a guard that refuses the legitimate case is broken')
      .toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
