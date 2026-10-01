// =============================================================================
// Tests: the second outward door was not checking the rule the first one was
//
// Foundry had two paths that produced outward effects:
//
//   outbound_actions   → services/outbound/gateway.ts → checkKillSwitch → send
//   action_executions  → services/scp/actions/executor.ts → send
//
// The second reached none of the checks the first one does, so an approval on
// it could dispatch an outward effect for a company whose subscription had
// lapsed, whose founder had paused it, or whose data had been erased. That was
// closed, and then the second door itself was deleted in Roadmap 2027 R10
// (PENDING 16, "Retire them") — so the cases that drove `approveAndExecute`
// went with it. What remains below is the same question asked of the outward
// paths that still exist.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const F = 'ae_f';
const P = 'ae_p';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'clerk_ae', 'ae@test.local']);
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status) VALUES (?,'Acting Co',?,'active','active')`,
    [P, F]);
});

beforeEach(async () => {
  await query(
    `UPDATE products SET status='active', scp_status='active', entitlement_paused_at=NULL WHERE id=?`,
    [P]);
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
