// =============================================================================
// Tests: Resend send_email through tool gateway
// Verifies that executeEmailSend goes through gateway pre-flights:
//   - happy path → handler called, audit row, idempotency cache
//   - kill-switch refusal → action marked refused, no Resend call
//   - budget refusal at cap → action marked refused, no Resend call
//   - idempotent re-call → handler not re-invoked, cached result returned
//   - logged-only mode (no API key) → success without HTTP
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';

// Importing resend.ts has the side-effect of registering the gateway
// handler at module load — that's what we're testing. The handler is
// also exported so tests can re-register on a warm module cache when
// gateway.test.ts has cleared the registry earlier in the same worker.
import { executeEmailSend, sendEmailHandler } from '../../src/services/integration/resend.js';
import { disableTool } from '../../src/services/outbound/kill-switch.js';
import { registerToolHandler } from '../../src/services/outbound/gateway.js';

let founderId: string;
let productId: string;

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
    CREATE TABLE IF NOT EXISTS outbound_actions (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      integration_name TEXT NOT NULL,
      action_type TEXT NOT NULL,
      authority_level INTEGER NOT NULL DEFAULT 2,
      status TEXT NOT NULL DEFAULT 'pending_approval',
      parameters_json TEXT,
      preview_text TEXT,
      rationale TEXT,
      confidence REAL,
      approved_by TEXT,
      approved_at TEXT,
      executed_at TEXT,
      result_json TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT,
      status TEXT,
      credentials_json TEXT,
      config_json TEXT,
      authorized_agents TEXT,
      last_error TEXT,
      total_outbound_actions INTEGER DEFAULT 0,
      error_count_trailing_7d INTEGER DEFAULT 0,
      cost_trailing_30d_usd REAL DEFAULT 0.0,
      total_inbound_events INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
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
  // Reset cross-test state.
  await executeRaw(`DELETE FROM idempotency_keys`);
  await executeRaw(`DELETE FROM data_classifications`);
  await executeRaw(`DELETE FROM communication_budgets`);
  await executeRaw(`DELETE FROM agent_instances`);
  await executeRaw(`DELETE FROM audit_log`);
  await executeRaw(`DELETE FROM outbound_actions`);

  // Defensive re-registration: gateway.test.ts calls clearToolHandlers()
  // in its own beforeEach. If both files share a vitest worker / module
  // cache, the module-load registration in resend.ts has been wiped by
  // the time we run. Re-register the exported handler so this suite is
  // order-independent.
  registerToolHandler('send_email', sendEmailHandler);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function insertAction(opts: {
  to?: string;
  subject?: string;
  agentName?: string;
}): Promise<string> {
  const id = nanoid();
  const params = {
    to: [opts.to ?? 'cust@example.com'],
    subject: opts.subject ?? 'Hi',
    html: '<p>hello</p>',
  };
  await query(
    `INSERT INTO outbound_actions (id, product_id, agent_name, integration_name, action_type, authority_level, status, parameters_json, preview_text, rationale, confidence)
     VALUES (?, ?, ?, 'resend', 'send_email', 0, 'approved', ?, ?, ?, 0.9)`,
    [id, productId, opts.agentName ?? 'beacon', JSON.stringify(params), 'preview', 'because']
  );
  return id;
}

// ─── Happy path: logged-only mode (no API key) ────────────────────────────────

describe('executeEmailSend: logged-only mode (no API key)', () => {
  it('marks executed and writes a gateway audit row when API key is absent', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    delete process.env.RESEND_API_KEY;

    const actionId = await insertAction({});
    const r = await executeEmailSend(actionId);
    expect(r.success).toBe(true);

    const row = await query('SELECT status, result_json FROM outbound_actions WHERE id = ?', [actionId]);
    const r2 = row.rows[0] as Record<string, unknown>;
    expect(r2.status).toBe('executed');
    expect(String(r2.result_json)).toMatch(/logged/);

    // Gateway audit
    const audit = await query(
      `SELECT outcome, action_type FROM audit_log WHERE product_id = ?`,
      [productId]
    );
    expect(audit.rows.length).toBe(1);
    expect((audit.rows[0] as Record<string, string>).outcome).toBe('allowed');
    expect((audit.rows[0] as Record<string, string>).action_type).toBe('gateway:send_email');
  });
});

// ─── Real-API path stubbed via global fetch ──────────────────────────────────

describe('executeEmailSend: real send (mocked fetch)', () => {
  it('happy path: handler called, message_id persisted, idempotency cache populated', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test_key');
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'em_xyz' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchSpy);

    const actionId = await insertAction({ to: 'cust@example.com' });
    const r = await executeEmailSend(actionId);
    expect(r.success).toBe(true);
    expect(r.message_id).toBe('em_xyz');
    expect(fetchSpy).toHaveBeenCalledOnce();

    // Cached result in idempotency_keys
    const idem = await query(
      `SELECT result_json FROM idempotency_keys WHERE product_id = ? AND dedup_key = ?`,
      [productId, actionId]
    );
    expect(idem.rows.length).toBe(1);
    expect(JSON.parse((idem.rows[0] as Record<string, string>).result_json)).toMatchObject({
      message_id: 'em_xyz',
    });

    // Budget incremented
    const budget = await query(
      `SELECT sent_count FROM communication_budgets WHERE product_id = ?`,
      [productId]
    );
    expect((budget.rows[0] as Record<string, number>).sent_count).toBe(1);
  });

  it('idempotent re-call: same actionId does not re-invoke handler', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test_key');
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'em_first' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchSpy);

    const actionId = await insertAction({});
    await executeEmailSend(actionId);
    await executeEmailSend(actionId); // second call

    expect(fetchSpy).toHaveBeenCalledOnce(); // handler not re-invoked
  });

  it('refuses when product is paused (kill-switch)', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test_key');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await query(`UPDATE products SET status = 'paused' WHERE id = ?`, [productId]);

    const actionId = await insertAction({});
    const r = await executeEmailSend(actionId);
    expect(r.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    const row = await query('SELECT status FROM outbound_actions WHERE id = ?', [actionId]);
    expect((row.rows[0] as Record<string, string>).status).toBe('refused');
  });

  it('refuses when send_email is in disabled_tools', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test_key');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await disableTool(productId, 'send_email');

    const actionId = await insertAction({});
    const r = await executeEmailSend(actionId);
    expect(r.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses at communication budget cap', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test_key');
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'em_ok' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchSpy);

    // Default cap is 3 per (product, customer, week). Send 3, then a
    // distinct 4th must refuse.
    for (let i = 0; i < 3; i++) {
      const id = await insertAction({ to: 'same@example.com' });
      await executeEmailSend(id);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const fourthId = await insertAction({ to: 'same@example.com' });
    const r = await executeEmailSend(fourthId);
    expect(r.success).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // not re-called

    const row = await query('SELECT status FROM outbound_actions WHERE id = ?', [fourthId]);
    expect((row.rows[0] as Record<string, string>).status).toBe('refused');
  });
});

