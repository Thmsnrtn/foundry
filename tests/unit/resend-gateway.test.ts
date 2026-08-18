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
import { runMigrations } from '../../src/db/migrate.js';

// Importing resend.ts has the side-effect of registering the gateway
// handler at module load — that's what we're testing. The handler is
// also exported so tests can re-register on a warm module cache when
// gateway.test.ts has cleared the registry earlier in the same worker.
import { executeEmailSend, sendEmailHandler, SEND_EMAIL_POLICY } from '../../src/services/integration/resend.js';
import { disableTool } from '../../src/services/outbound/kill-switch.js';
import { registerToolHandler } from '../../src/services/outbound/gateway.js';

let founderId: string;
let productId: string;

async function setupSchema(): Promise<void> {
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
  // The migrations are the schema. Tables this file used to write by hand are
  // already here, in the shape the product actually has — including the NOT
  // NULL columns and foreign keys a hand-written stand-in leaves out.
  await runMigrations();
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
  registerToolHandler('send_email', sendEmailHandler, SEND_EMAIL_POLICY);
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
    expect(fetchSpy.mock.calls[0][1]?.headers).toMatchObject({ 'Idempotency-Key': actionId });

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
    // `scp_status`, not `status`. This used to set `status='paused'`, which the
    // real schema forbids outright (migration 145's axis trigger) — so the
    // test was proving the ARCHIVE branch of the kill-switch while its name
    // claimed the pause branch, and the fabricated fixture hid the difference.
    await query(`UPDATE products SET scp_status = 'paused' WHERE id = ?`, [productId]);

    const actionId = await insertAction({});
    const r = await executeEmailSend(actionId);
    expect(r.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    const row = await query('SELECT status FROM outbound_actions WHERE id = ?', [actionId]);
    // 'rejected' with effect_certainty 'not_attempted', not 'refused' —
    // which the schema has never permitted. This assertion passed only
    // because this file built its own outbound_actions with no CHECK.
    expect((row.rows[0] as Record<string, string>).status).toBe('rejected');
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
    // 'rejected' with effect_certainty 'not_attempted', not 'refused' —
    // which the schema has never permitted. This assertion passed only
    // because this file built its own outbound_actions with no CHECK.
    expect((row.rows[0] as Record<string, string>).status).toBe('rejected');
  });
});

describe('send_email provider routing', () => {
  it('uses the server-owned SendGrid fallback without caller provider selection', async () => {
    delete process.env.RESEND_API_KEY;
    vi.stubEnv('SENDGRID_API_KEY', 'sg_test');
    const fetchSpy = vi.fn(async () => new Response('', {
      status: 202, headers: { 'x-message-id': 'sg_1' },
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const result = await sendEmailHandler({
      productId: 'p1', agent: 'system', tool: 'send_email', action: 'digest',
      params: { to: ['founder@example.com'], subject: 'Weekly', html: '<p>Hi</p>', text: 'Hi' },
      dedupKey: 'weekly:p1:2026-08-14', customerExternalId: 'founder@example.com',
    });
    expect(result).toMatchObject({ message_id: 'sg_1' });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('sendgrid.com');
  });
});
