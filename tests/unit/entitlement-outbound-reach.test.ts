// =============================================================================
// Tests: does the entitlement pause actually reach outward effects?
//
// Owner decision 6 made an unpaid account READ-ONLY: "no spend, no outward
// effects". The mechanism chosen was deliberately NOT a new one — the sweep
// writes the same `products.scp_status = 'paused'` that a cancelled Stripe
// subscription writes, so that "every check that already honours a cancellation
// honours a lapsed trial too".
//
// That sentence was an assumption about the rest of the codebase, and this file
// exists to falsify it. The SCP scheduler does honour `scp_status`. The tool
// gateway — the single door every outbound effect passes through — did not: its
// kill-switch read `products.status`, which is the ARCHIVE axis, and nothing
// else. So a paused account still sent its red-daily briefing, its yellow
// pulse, its DNA nudge, and every behavioural-trigger email, each one a real
// Resend call on an account that would never pay.
//
// The two states are different facts and both must block:
//   products.status      archived / deleted   — the record is gone
//   products.scp_status  paused               — the company is not acting
//
// 'provisioning' must NOT block: onboarding email runs before a product is ever
// marked active, and blocking it would break signup to fix billing.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw, getAllActiveProducts } from '../../src/db/client.js';
import { invoke, registerToolHandler, clearToolHandlers } from '../../src/services/outbound/gateway.js';

let founderId: string;
let productId: string;

const TEST_POLICY = {
  actor: 'test_entitlement',
  surface: 'email_outbound', dataClass: 'customer',
  requireDedupKey: false, requireCustomerExternalId: false,
} as const;

beforeAll(async () => {
  // The fixture carries `scp_status` because the real table does. A products
  // table without it would let every assertion below pass by accident.
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
      scp_status TEXT DEFAULT 'provisioning'
        CHECK(scp_status IN ('provisioning','active','paused','archived')),
      entitlement_paused_at TEXT,
      disabled_tools TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS agent_instances (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL,
      agent_name TEXT NOT NULL, status TEXT DEFAULT 'active'
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
  await query(`INSERT INTO founders (id, clerk_user_id, email, tier) VALUES (?,?,?,?)`,
    [founderId, `clerk_${founderId}`, `${founderId}@test.local`, null]);
  await query(`INSERT INTO products (id, name, owner_id, status, scp_status) VALUES (?,?,?,'active','active')`,
    [productId, 'Test', founderId]);
  await executeRaw(`DELETE FROM idempotency_keys`);
  await executeRaw(`DELETE FROM data_classifications`);
  await executeRaw(`DELETE FROM communication_budgets`);
  clearToolHandlers();
});

async function attemptSend(): Promise<Awaited<ReturnType<typeof invoke>> & { calls: number }> {
  const handler = vi.fn(async () => ({ id: 'em_1' }));
  registerToolHandler('send_email', handler, TEST_POLICY);
  const r = await invoke({
    productId, tool: 'send_email', action: 'weekly digest',
    params: { to: ['founder@example.com'], subject: 'digest' },
    dedupKey: `d-${nanoid()}`, customerExternalId: 'founder@example.com',
  });
  return Object.assign(r, { calls: handler.mock.calls.length });
}

describe('the entitlement pause reaches the outbound gateway', () => {
  it('refuses every outbound effect once the product is paused', async () => {
    await query(`UPDATE products SET scp_status='paused' WHERE id=?`, [productId]);
    const r = await attemptSend();
    expect(r.ok, 'a paused product must not reach the outside world').toBe(false);
    if (!r.ok) {
      expect(r.phase).toBe('kill_switch');
      expect(r.reason).toMatch(/paused/i);
    }
    expect(r.calls, 'the handler must never be reached, not merely fail').toBe(0);
  });

  it('refuses when the company is archived on the SCP axis', async () => {
    await query(`UPDATE products SET scp_status='archived' WHERE id=?`, [productId]);
    const r = await attemptSend();
    expect(r.ok).toBe(false);
  });

  it('still allows outbound while provisioning, so onboarding email survives', async () => {
    await query(`UPDATE products SET scp_status='provisioning' WHERE id=?`, [productId]);
    const r = await attemptSend();
    expect(r.ok, 'blocking provisioning would break signup to fix billing').toBe(true);
    expect(r.calls).toBe(1);
  });

  it('allows outbound for an active company', async () => {
    const r = await attemptSend();
    expect(r.ok).toBe(true);
    expect(r.calls).toBe(1);
  });

  it('records the refusal, so a silenced account is visible and not just quiet', async () => {
    await query(`UPDATE products SET scp_status='paused' WHERE id=?`, [productId]);
    await attemptSend();
    const audit = await query(
      `SELECT outcome, reasoning FROM audit_log WHERE product_id = ?`, [productId]);
    expect(audit.rows.length).toBeGreaterThan(0);
    expect((audit.rows[0] as Record<string, string>).outcome).toBe('refused');
  });
});

// The outbound gateway stops the EFFECT. It does not stop the WORK that
// produced it — and the work is where the money goes. `redDaily` generates an
// Opus narrative and then sends it; blocking only the send means Foundry pays
// for a briefing nobody receives. Thirty-four background jobs choose their work
// through one helper, and that helper filtered on the archive axis too.
describe('the pause reaches the work, not only the send', () => {
  it('drops a paused company from the background work list', async () => {
    await query(`UPDATE products SET scp_status='paused' WHERE id=?`, [productId]);
    const ids = (await getAllActiveProducts()).rows.map((r) => (r as Record<string, string>).id);
    expect(ids, 'a paused company must not be picked up by AI-spending jobs')
      .not.toContain(productId);
  });

  it('drops a company archived on the SCP axis', async () => {
    await query(`UPDATE products SET scp_status='archived' WHERE id=?`, [productId]);
    const ids = (await getAllActiveProducts()).rows.map((r) => (r as Record<string, string>).id);
    expect(ids).not.toContain(productId);
  });

  it('keeps provisioning and active companies, so onboarding work still runs', async () => {
    const other = nanoid();
    await query(`INSERT INTO products (id, name, owner_id, status, scp_status) VALUES (?,?,?,'active','provisioning')`,
      [other, 'Provisioning', founderId]);
    const ids = (await getAllActiveProducts()).rows.map((r) => (r as Record<string, string>).id);
    expect(ids).toContain(productId);
    expect(ids).toContain(other);
    await query(`DELETE FROM products WHERE id=?`, [other]);
  });

  it('still drops an archived record, whatever the SCP axis says', async () => {
    await query(`UPDATE products SET status='archived', scp_status='active' WHERE id=?`, [productId]);
    const ids = (await getAllActiveProducts()).rows.map((r) => (r as Record<string, string>).id);
    expect(ids).not.toContain(productId);
  });
});

describe('the pause is read from the database, not from the caller', () => {
  it('cannot be waived by anything in the request payload', async () => {
    await query(`UPDATE products SET scp_status='paused' WHERE id=?`, [productId]);
    const handler = vi.fn(async () => ({ id: 'em_1' }));
    registerToolHandler('send_email', handler, TEST_POLICY);
    const r = await invoke({
      productId, tool: 'send_email', action: 'digest',
      // Every field a caller controls, set to whatever it would take to look
      // entitled. Authority is a fact about the account, not a claim in a
      // payload — §4.
      params: { to: ['x@example.com'], subject: 'hi', scp_status: 'active', entitled: true },
      dedupKey: `d-${nanoid()}`, customerExternalId: 'x@example.com',
      surface: 'email_outbound', dataClass: 'customer',
    } as Parameters<typeof invoke>[0]);
    expect(r.ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});

// The gateway stops effects and the work-lists stop jobs, but an interactive
// dashboard request reaches a model directly — a founder clicking "generate my
// weekly plan" on a read-only account. "No spend" has to mean that too, so the
// rule is checked at the one place every model call passes through.
describe('the pause reaches model spend', () => {
  it('refuses to reserve spend for a paused company', async () => {
    await query(`UPDATE products SET scp_status='paused' WHERE id=?`, [productId]);
    const { callSonnet, NotEntitledError } = await import('../../src/services/ai/client.js');
    await expect(callSonnet('sys', 'user', 16, productId)).rejects.toThrow(NotEntitledError);
  });

  it('refuses for an archived record too', async () => {
    await query(`UPDATE products SET status='archived' WHERE id=?`, [productId]);
    const { callSonnet } = await import('../../src/services/ai/client.js');
    await expect(callSonnet('sys', 'user', 16, productId)).rejects.toThrow(/refused/i);
  });

  it('does not refuse an id that names no company', async () => {
    // An entitlement check, not an authorization check. Turning a missing row
    // into a refusal would make a bad id look like a billing decision.
    const { callSonnet, NotEntitledError } = await import('../../src/services/ai/client.js');
    await expect(callSonnet('sys', 'user', 16, 'no-such-product'))
      .rejects.not.toThrow(NotEntitledError);
  });
});

// §4: a model call is either work for one company or work for the institution.
// There is no third case and no "we did not say" — omission used to mean both
// "institutional" and "somebody forgot", and the two differ by an unbounded
// amount of money.
describe('a model call names its subject', () => {
  it('charges an institutional call to nobody, deliberately and with a reason', async () => {
    const { institutionSpend } = await import('../../src/services/ai/client.js');
    const declared = institutionSpend('cross-company aggregation has no single payer');
    expect(declared.institutionReason.length).toBeGreaterThan(20);
  });

  it('does not refuse an institutional call on entitlement grounds', async () => {
    // There is no company whose billing could stop it, so the entitlement
    // check must not invent one.
    await query(`UPDATE products SET scp_status='paused' WHERE id=?`, [productId]);
    const { callSonnet, institutionSpend, NotEntitledError } = await import(
      '../../src/services/ai/client.js');
    await expect(callSonnet('sys', 'user', 16,
      institutionSpend('platform-wide work with no company to charge')))
      .rejects.not.toThrow(NotEntitledError);
  });
});

// The same fragment-drift as the institutional authority read, in the spend
// gate: `companyMayIncurCost` read status and scp_status, and migration 145
// moved the billing pause to a third field. A cancelled subscription stopped
// being visible to the one check that enforces "no spend".
describe('the spend gate reads all three axes', () => {
  it('refuses model spend when the billing axis is paused', async () => {
    await query(
      `UPDATE products SET entitlement_paused_at = datetime('now') WHERE id=?`, [productId]);
    const { callSonnet, NotEntitledError } = await import('../../src/services/ai/client.js');
    await expect(callSonnet('sys', 'user', 16, productId)).rejects.toThrow(NotEntitledError);
  });

  it('and allows it again once the account is entitled', async () => {
    await query(`UPDATE products SET entitlement_paused_at = NULL WHERE id=?`, [productId]);
    const { callSonnet, NotEntitledError } = await import('../../src/services/ai/client.js');
    // No API key in tests, so the provider call fails — what matters is that it
    // got past the entitlement check to fail for that reason instead.
    await expect(callSonnet('sys', 'user', 16, productId))
      .rejects.not.toThrow(NotEntitledError);
  });
});
