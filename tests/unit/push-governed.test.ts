// =============================================================================
// Tests: push is a governed capability, and it is finally live
//
// `POST /api/push/register` and `/api/push/preferences` have been accepting
// device tokens and per-type preferences since the mobile API shipped. Nothing
// ever sent one: `sendPushNotification` had no callers anywhere in the tree. A
// founder could opt into "tell me when my risk state changes" and never hear
// from it — mounted, never live, the same shape the public API had.
//
// The owner's decision was to make it real THROUGH the gateway. That is the
// part worth testing, because this module used to reach the network on its own:
// no kill-switch, no pause, no budget, no dedup, no audit row. Routing it
// through the one door means the entitlement rule reaches phones for free,
// rather than being a fourth place someone has to remember to check.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import { invoke, registerToolHandler, clearToolHandlers } from '../../src/services/outbound/gateway.js';
import { SEND_PUSH_POLICY, notifyFounder } from '../../src/services/notifications/push.js';

let founderId: string;
let productId: string;

beforeAll(async () => {
  await executeRaw(`
    CREATE TABLE IF NOT EXISTS founders (
      id TEXT PRIMARY KEY, clerk_user_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL, name TEXT, tier TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES founders(id),
      status TEXT DEFAULT 'active',
      scp_status TEXT DEFAULT 'active'
        CHECK(scp_status IN ('provisioning','active','paused','archived')),
      entitlement_paused_at TEXT,
      disabled_tools TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS agent_instances (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL,
      agent_name TEXT NOT NULL, status TEXT DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL, founder_id TEXT NOT NULL,
      status TEXT DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY, founder_id TEXT NOT NULL, platform TEXT,
      endpoint TEXT, p256dh TEXT, auth TEXT,
      apns_device_token TEXT, apns_bundle_id TEXT,
      active INTEGER DEFAULT 1, failure_count INTEGER DEFAULT 0,
      last_delivered_at DATETIME,
      notify_risk_state_change INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS push_log (
      id TEXT PRIMARY KEY, founder_id TEXT, product_id TEXT, subscription_id TEXT,
      notification_type TEXT, title TEXT, body TEXT, data TEXT, status TEXT,
      sent_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL, action_type TEXT NOT NULL,
      gate INTEGER NOT NULL, trigger TEXT NOT NULL, reasoning TEXT NOT NULL,
      input_context TEXT, output TEXT, outcome TEXT, confidence_score REAL,
      risk_state_at_action TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  for (const m of ['065_idempotency_keys', '066_data_classifications', '067_communication_budgets']) {
    await executeRaw(readFileSync(resolve(__dirname, `../../src/db/migrations/${m}.sql`), 'utf-8'));
  }
});

beforeEach(async () => {
  founderId = nanoid();
  productId = nanoid();
  await query(`INSERT INTO founders (id, clerk_user_id, email, tier) VALUES (?,?,?,'growth')`,
    [founderId, `clerk_${founderId}`, `${founderId}@test.local`]);
  await query(`INSERT INTO products (id, name, owner_id) VALUES (?,?,?)`,
    [productId, 'Pushy Co', founderId]);
  await executeRaw(`DELETE FROM idempotency_keys`);
  await executeRaw(`DELETE FROM data_classifications`);
  await executeRaw(`DELETE FROM audit_log`);
  clearToolHandlers();
});

function stubTransport(): ReturnType<typeof vi.fn> {
  const handler = vi.fn(async () => ({ sent: 1, failed: 0 }));
  registerToolHandler('send_push', handler, SEND_PUSH_POLICY);
  return handler;
}

describe('push goes through the gateway', () => {
  it('delivers for an active company', async () => {
    const transport = stubTransport();
    const r = await notifyFounder({
      productId, founderId, notificationType: 'risk_state_change',
      payload: { title: 'Now RED', body: 'churn up' },
    });
    expect(r.sent).toBe(1);
    expect(transport).toHaveBeenCalledOnce();
  });

  it('sends nothing for a paused company, without the channel knowing about billing', async () => {
    await query(`UPDATE products SET scp_status='paused' WHERE id=?`, [productId]);
    const transport = stubTransport();
    const r = await notifyFounder({
      productId, founderId, notificationType: 'risk_state_change',
      payload: { title: 'Now RED', body: 'churn up' },
    });
    expect(r.sent).toBe(0);
    expect(transport, 'the pause reaches phones because the door is the same').not.toHaveBeenCalled();
  });

  it('notifies once when a job runs twice', async () => {
    const transport = stubTransport();
    const payload = { title: 'Now RED', body: 'churn up', tag: `risk:${productId}:red` };
    await notifyFounder({ productId, founderId, notificationType: 'risk_state_change', payload });
    await notifyFounder({ productId, founderId, notificationType: 'risk_state_change', payload });
    expect(transport).toHaveBeenCalledOnce();
  });

  it('records the send in the audit log like any other effect', async () => {
    stubTransport();
    await notifyFounder({
      productId, founderId, notificationType: 'risk_state_change',
      payload: { title: 'Now RED', body: 'churn up' },
    });
    const rows = await query(
      `SELECT action_type, outcome FROM audit_log WHERE product_id = ?`, [productId]);
    expect(rows.rows.length).toBe(1);
    expect((rows.rows[0] as Record<string, string>).action_type).toBe('gateway:send_push');
  });

  it('fails closed when there is no company to check the send against', async () => {
    const transport = stubTransport();
    const r = await notifyFounder({
      productId: null, founderId, notificationType: 'risk_state_change',
      payload: { title: 'x', body: 'y' },
    });
    expect(r.sent).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  });

  it('refuses a notification type it has no column for', async () => {
    const r = await invoke({
      productId, tool: 'send_push', action: 'push',
      params: { founder_id: founderId, notification_type: "x'; DROP TABLE founders; --", payload: {} },
      dedupKey: `p-${nanoid()}`,
    } as Parameters<typeof invoke>[0]);
    // The type names a COLUMN in the subscription query, so this is the
    // difference between an allow-list and an injection.
    expect(r.ok).toBe(false);
  });
});

describe('the channel is actually wired', () => {
  it('has a caller, so the registration routes stop promising nothing', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
      const p = join(dir, e);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
    const callers = walk(resolve(__dirname, '../../src'))
      .filter((f) => !f.endsWith('/notifications/push.ts'))
      .filter((f) => /notifyFounder\(|notifyProductTeam\(/.test(readFileSync(f, 'utf8')));
    expect(callers.length,
      'a registration route with no sender is a promise the product does not keep')
      .toBeGreaterThan(0);
  });

  it('does not reach the network around the gateway', () => {
    const source = readFileSync(
      resolve(__dirname, '../../src/services/notifications/push.ts'), 'utf8');
    // The transport is exported for the handler and for tests; the entry point
    // is notifyFounder. If a future caller imports the transport directly it
    // reaches the network with no kill-switch, so the name says so.
    expect(source).toMatch(/export async function deliverPushNotification/);
    expect(source, 'the old ungoverned entry point must not come back')
      .not.toMatch(/export async function sendPushNotification/);
    expect(source).toMatch(/registerToolHandler\('send_push'/);
  });
});

// =============================================================================
// §12: the capability's semantics, not the first consumer's. The gateway
// establishes the COMPANY; everything else about a push has to be checked
// against that, and a receipt has to describe what actually happened.
// =============================================================================

describe('a push goes to someone who belongs to the company', () => {
  it('refuses a recipient who is not the owner or a team member', async () => {
    const outsider = nanoid();
    await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
      [outsider, `clerk_${outsider}`, `${outsider}@elsewhere.test`]);
    // The REAL handler: the authority check is what is under test, and a stub
    // would prove only that the stub was called.
    const { pushHandler } = await import('../../src/services/notifications/push.js');
    registerToolHandler('send_push', pushHandler, SEND_PUSH_POLICY);

    const direct = await invoke({
      productId, tool: 'send_push', action: 'push',
      params: {
        founder_id: outsider, notification_type: 'risk_state_change',
        payload: { title: 'not yours', body: 'x' },
      },
      dedupKey: `p-${nanoid()}`,
    } as Parameters<typeof invoke>[0]);
    expect(direct.ok, 'company authority is not authority over any person').toBe(false);
  });

  it('allows an active team member', async () => {
    const mate = nanoid();
    await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
      [mate, `clerk_${mate}`, `${mate}@team.test`]);
    await query(
      `INSERT INTO team_members (id, product_id, founder_id, status) VALUES (?,?,?,'active')`,
      [nanoid(), productId, mate]);
    const { pushHandler } = await import('../../src/services/notifications/push.js');
    registerToolHandler('send_push', pushHandler, SEND_PUSH_POLICY);
    const r = await invoke({
      productId, tool: 'send_push', action: 'push',
      params: {
        founder_id: mate, notification_type: 'risk_state_change',
        payload: { title: 'yours', body: 'x' },
      },
      dedupKey: `p-${nanoid()}`,
    } as Parameters<typeof invoke>[0]);
    expect(r.ok ? 'ok' : `${r.phase}: ${r.reason}`).toBe('ok');
  });
});

describe('a receipt says what happened, not what was attempted', () => {
  it('does not count an unconfigured provider as a delivery', async () => {
    // No VAPID keys and no APNs keys in tests. Both senders used to return
    // quietly and the caller counted a delivery, then wrote a push_log row
    // saying 'sent' — a receipt for something that never left the building.
    const sub = nanoid();
    await query(
      `INSERT INTO push_subscriptions (id, founder_id, platform, endpoint, p256dh, auth)
       VALUES (?,?, 'web', 'https://push.example/x', 'k', 'a')`, [sub, founderId]);
    const { deliverPushNotification } = await import(
      '../../src/services/notifications/push.js');

    const result = await deliverPushNotification(
      founderId, productId, 'risk_state_change', { title: 'hi', body: 'there' });
    expect(result.sent, 'nothing was configured, so nothing was sent').toBe(0);

    const logged = await query(
      `SELECT status FROM push_log WHERE subscription_id = ?`, [sub]);
    expect((logged.rows[0] as Record<string, string>).status).toBe('not_configured');
  });
});
