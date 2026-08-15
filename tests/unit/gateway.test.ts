// =============================================================================
// Tests: V3.1 Layer C — Tool Gateway
// Verifies the four pre-flight checks short-circuit on first refusal,
// dedup cache hit returns without calling the handler, full happy path
// writes audit + idempotency rows.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import {
  invoke,
  registerToolHandler,
  clearToolHandlers,
} from '../../src/services/outbound/gateway.js';
import { upsertPolicy } from '../../src/services/outbound/classification.js';
import { disableTool } from '../../src/services/outbound/kill-switch.js';

let founderId: string;
let productId: string;

const TEST_POLICY = {
  actor: 'test_gateway',
  surface: 'email_outbound', dataClass: 'customer',
  requireDedupKey: false, requireCustomerExternalId: false,
} as const;

async function setupSchema(): Promise<void> {
  await executeRaw(`
    CREATE TABLE IF NOT EXISTS founders (
      id TEXT PRIMARY KEY,
      clerk_user_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      tier TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES founders(id),
      status TEXT DEFAULT 'active',
      disabled_tools TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS agent_instances (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      status TEXT DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      gate INTEGER NOT NULL,
      trigger TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      input_context TEXT,
      output TEXT,
      outcome TEXT,
      confidence_score REAL,
      risk_state_at_action TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await executeRaw(
    readFileSync(
      resolve(__dirname, '../../src/db/migrations/065_idempotency_keys.sql'),
      'utf-8'
    )
  );
  await executeRaw(
    readFileSync(
      resolve(__dirname, '../../src/db/migrations/066_data_classifications.sql'),
      'utf-8'
    )
  );
  await executeRaw(
    readFileSync(
      resolve(__dirname, '../../src/db/migrations/067_communication_budgets.sql'),
      'utf-8'
    )
  );
}

beforeAll(async () => {
  await setupSchema();
});

beforeEach(async () => {
  founderId = nanoid();
  productId = nanoid();
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, tier) VALUES (?, ?, ?, ?)`,
    [founderId, `clerk_${founderId}`, `${founderId}@test.local`, 'growth']
  );
  await query(`INSERT INTO products (id, name, owner_id) VALUES (?, ?, ?)`, [
    productId,
    'Test',
    founderId,
  ]);
  // Reset all tables that persist across tests via CREATE TABLE IF NOT EXISTS
  await executeRaw(`DELETE FROM idempotency_keys`);
  await executeRaw(`DELETE FROM data_classifications`);
  await executeRaw(`DELETE FROM communication_budgets`);
  await executeRaw(`DELETE FROM agent_instances`);
  await executeRaw(`DELETE FROM audit_log`);
  clearToolHandlers();
});

function baseReq(overrides: Partial<Parameters<typeof invoke>[0]> = {}) {
  return {
    productId,
    tool: 'send_email',
    action: 'send onboarding email',
    params: { to: 'cust@example.com', subject: 'hi' },
    ...overrides,
  };
}

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('invoke: happy path', () => {
  it('runs all checks, dispatches handler, writes audit, caches result', async () => {
    const handler = vi.fn(async () => ({ id: 'em_1', accepted: true }));
    registerToolHandler('send_email', handler, TEST_POLICY);

    const r = await invoke(
      baseReq({
        dedupKey: 'msg-1',
        customerExternalId: 'cust@example.com',
        surface: 'email_outbound',
        dataClass: 'customer',
      })
    );

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cached).toBe(false);
      expect(r.result).toEqual({ id: 'em_1', accepted: true });
      expect(handler).toHaveBeenCalledOnce();
    }

    // Audit trail
    const audit = await query(
      `SELECT outcome, action_type FROM audit_log WHERE product_id = ?`,
      [productId]
    );
    expect(audit.rows.length).toBe(1);
    expect((audit.rows[0] as Record<string, string>).outcome).toBe('allowed');
    expect((audit.rows[0] as Record<string, string>).action_type).toBe('gateway:send_email');

    // Idempotency cache populated
    const idem = await query(
      `SELECT result_json FROM idempotency_keys WHERE product_id = ? AND dedup_key = ?`,
      [productId, 'msg-1']
    );
    expect(JSON.parse((idem.rows[0] as Record<string, string>).result_json)).toEqual({
      id: 'em_1',
      accepted: true,
    });

    // Budget incremented
    const budget = await query(
      `SELECT sent_count FROM communication_budgets WHERE product_id = ? AND customer_external_id = ?`,
      [productId, 'cust@example.com']
    );
    expect((budget.rows[0] as Record<string, number>).sent_count).toBe(1);
  });
});

// ─── Kill-switch refusal ──────────────────────────────────────────────────────

describe('invoke: kill-switch', () => {
  it('refuses when product is paused', async () => {
    await query(`UPDATE products SET status = 'paused' WHERE id = ?`, [productId]);
    const handler = vi.fn();
    registerToolHandler('send_email', handler, TEST_POLICY);

    const r = await invoke(baseReq());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.phase).toBe('kill_switch');
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses when tool is in disabled_tools', async () => {
    await disableTool(productId, 'send_email');
    registerToolHandler('send_email', vi.fn(), TEST_POLICY);

    const r = await invoke(baseReq());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.phase).toBe('kill_switch');
  });

  it('refuses when agent is paused', async () => {
    await query(
      `INSERT INTO agent_instances (id, product_id, agent_name, status) VALUES (?, ?, ?, ?)`,
      [nanoid(), productId, 'test_gateway', 'paused']
    );
    registerToolHandler('send_email', vi.fn(), TEST_POLICY);

    const r = await invoke(baseReq());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.phase).toBe('kill_switch');
  });
});

// ─── Classification refusal ───────────────────────────────────────────────────

describe('invoke: classification', () => {
  it('refuses when the server-owned classification is not allowed', async () => {
    await upsertPolicy(productId, 'email_outbound', { allowed_classes: ['general'] });
    registerToolHandler('send_email', vi.fn(), TEST_POLICY);
    const r = await invoke(baseReq());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.phase).toBe('classification');
  });

  it('passes classification when policy admits the registered dataClass', async () => {
    await upsertPolicy(productId, 'email_outbound', {
      allowed_classes: ['general', 'customer', 'pii_strict'],
    });
    registerToolHandler('send_email', vi.fn(async () => 'ok'), TEST_POLICY);
    const r = await invoke(baseReq());
    expect(r.ok).toBe(true);
  });

  it('still applies classification when caller fields are omitted', async () => {
    registerToolHandler('send_email', vi.fn(async () => 'ok'), TEST_POLICY);
    const r = await invoke(baseReq());
    expect(r.ok).toBe(true);
  });

  it('refuses a caller attempt to downgrade the registered surface and data class', async () => {
    const handler = vi.fn(async () => 'unsafe');
    registerToolHandler('send_email', handler, TEST_POLICY);
    const surface = await invoke(baseReq({ surface: 'public_landing' }));
    const dataClass = await invoke(baseReq({ dataClass: 'general' }));
    expect(surface.ok).toBe(false);
    expect(dataClass.ok).toBe(false);
    if (!surface.ok) expect(surface.phase).toBe('policy');
    if (!dataClass.ok) expect(dataClass.phase).toBe('policy');
    expect(handler).not.toHaveBeenCalled();
  });
});

// ─── Budget refusal ───────────────────────────────────────────────────────────

describe('invoke: budget', () => {
  it('refuses after the cap (3) is reached for the same customer-week', async () => {
    const handler = vi.fn(async () => 'ok');
    registerToolHandler('send_email', handler, TEST_POLICY);

    for (let i = 0; i < 3; i++) {
      const r = await invoke(baseReq({ customerExternalId: 'cust@example.com' }));
      expect(r.ok).toBe(true);
    }
    const blocked = await invoke(baseReq({ customerExternalId: 'cust@example.com' }));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.phase).toBe('budget');
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('skips budget entirely when customerExternalId is omitted', async () => {
    const handler = vi.fn(async () => 'ok');
    registerToolHandler('send_email', handler, TEST_POLICY);
    for (let i = 0; i < 5; i++) {
      const r = await invoke(baseReq()); // no customer key
      expect(r.ok).toBe(true);
    }
    expect(handler).toHaveBeenCalledTimes(5);
  });
});

// ─── Idempotency cache hit ────────────────────────────────────────────────────

describe('invoke: idempotency', () => {
  it('returns cached result on second call with same dedupKey, handler not re-invoked', async () => {
    const handler = vi.fn(async () => ({ id: 'em_xyz' }));
    registerToolHandler('send_email', handler, TEST_POLICY);

    const first = await invoke(baseReq({ dedupKey: 'k1' }));
    expect(first.ok).toBe(true);

    const second = await invoke(baseReq({ dedupKey: 'k1' }));
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.cached).toBe(true);
      expect(second.result).toEqual({ id: 'em_xyz' });
    }
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not allow request data to override the server-owned execution actor', async () => {
    registerToolHandler('send_email', vi.fn(async () => ({ stored: true })), TEST_POLICY);
    const malicious = { ...baseReq({ dedupKey: 'shared' }), agent: 'caller_selected' };
    const r = await invoke(malicious);
    expect(r.ok).toBe(true);
    const audit = await query(`SELECT trigger FROM audit_log WHERE product_id = ?`, [productId]);
    expect((audit.rows[0] as Record<string, string>).trigger).toContain('test_gateway');
    expect((audit.rows[0] as Record<string, string>).trigger).not.toContain('caller_selected');
  });
});

// ─── No handler ───────────────────────────────────────────────────────────────

describe('invoke: no handler', () => {
  it('fails closed when a tool has no trusted registration or policy', async () => {
    const r = await invoke(baseReq({ tool: 'create_pr' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.phase).toBe('policy');
  });
});

describe('invoke: required policy inputs', () => {
  const strict = { ...TEST_POLICY, requireDedupKey: true, requireCustomerExternalId: true };

  it('refuses missing dedup and customer facts before dispatch', async () => {
    const handler = vi.fn(async () => 'unsafe');
    registerToolHandler('send_email', handler, strict);
    const missingBoth = await invoke(baseReq());
    const missingCustomer = await invoke(baseReq({ dedupKey: 'decision-1' }));
    expect(missingBoth.ok).toBe(false);
    expect(missingCustomer.ok).toBe(false);
    if (!missingBoth.ok) expect(missingBoth.phase).toBe('policy');
    if (!missingCustomer.ok) expect(missingCustomer.phase).toBe('policy');
    expect(handler).not.toHaveBeenCalled();
  });
});

// ─── Execution failure ────────────────────────────────────────────────────────

describe('invoke: execution failure', () => {
  it('captures handler errors and audits as failed', async () => {
    registerToolHandler('send_email', async () => {
      throw new Error('upstream 500');
    }, TEST_POLICY);
    const r = await invoke(baseReq());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.phase).toBe('execution');
      expect(r.reason).toMatch(/upstream 500/);
    }

    const audit = await query(
      `SELECT outcome FROM audit_log WHERE product_id = ?`,
      [productId]
    );
    expect((audit.rows[0] as Record<string, string>).outcome).toBe('failed');
  });
});

// ─── Short-circuit order ──────────────────────────────────────────────────────

describe('invoke: short-circuit order', () => {
  it('kill-switch fires before classification, budget, or handler', async () => {
    await query(`UPDATE products SET status = 'paused' WHERE id = ?`, [productId]);
    const handler = vi.fn();
    registerToolHandler('send_email', handler, TEST_POLICY);
    await invoke(
      baseReq({
        surface: 'public_landing',
        dataClass: 'pii_strict', // would also fail classification
        customerExternalId: 'x@example.com',
      })
    );
    expect(handler).not.toHaveBeenCalled();
    // Only one audit row, and it should be from kill_switch
    const audit = await query(`SELECT reasoning FROM audit_log WHERE product_id = ?`, [productId]);
    expect(audit.rows.length).toBe(1);
    expect((audit.rows[0] as Record<string, string>).reasoning).toMatch(/kill_switch/);
  });

  it('classification fires before budget or handler', async () => {
    const handler = vi.fn();
    registerToolHandler('send_email', handler, TEST_POLICY);
    await invoke(
      baseReq({
        surface: 'public_landing',
        dataClass: 'pii_strict',
        customerExternalId: 'x@example.com',
      })
    );
    // Budget should not have been incremented
    const budget = await query(
      `SELECT COUNT(*) AS n FROM communication_budgets WHERE product_id = ?`,
      [productId]
    );
    expect(Number((budget.rows[0] as Record<string, number>).n)).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });
});
