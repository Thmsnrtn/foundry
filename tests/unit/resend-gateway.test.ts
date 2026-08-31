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
  // This file's sends go to 'cust@example.com' — a customer, not the founder —
  // so the company needs a sender of its own. Before migration 150 these went
  // out under 'Foundry <noreply@foundry.app>', which is the thing
  // sender-of-record.ts has always forbidden. What follows exercises the
  // gateway machinery; the sender rule itself is proved in
  // sender-of-record-reach.test.ts.
  const { setSendingIdentity } = await import('../../src/services/outbound/sending-identity.js');
  await setSendingIdentity({
    productId, provider: 'resend', credential: 're_company_key',
    fromEmail: 'hello@testco.example', fromName: 'Test Co',
  });
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
  approvedBy?: string;
  /** Stored verbatim, so a test can seed a row that is malformed on purpose. */
  rawParams?: Record<string, unknown>;
}): Promise<string> {
  const id = nanoid();
  const params: Record<string, unknown> = opts.rawParams ?? {
    to: [opts.to ?? 'cust@example.com'],
    subject: opts.subject ?? 'Hi',
    html: '<p>hello</p>',
  };
  // BORN WAITING, THEN APPROVED BY SOMEBODY. This inserted an approved row
  // directly, which migration 173 now refuses for an integration that can
  // actually do something: an outbound action that is approved from birth,
  // names no responsibility, and points at a real integration is authority the
  // caller asserted. Production reaches this state the way a person does — the
  // row waits, and an owner approves it — so the fixture does too.
  await query(
    `INSERT INTO outbound_actions (id, product_id, agent_name, integration_name, action_type, authority_level, status, parameters_json, preview_text, rationale, confidence)
     VALUES (?, ?, ?, 'resend', 'send_email', 2, 'pending_approval', ?, ?, ?, 0.9)`,
    [id, productId, opts.agentName ?? 'beacon', JSON.stringify(params), 'preview', 'because']
  );
  await query(
    `UPDATE outbound_actions SET status='approved', approved_by=?, approved_at=datetime('now') WHERE id=?`,
    [opts.approvedBy ?? 'rg_owner', id]);
  return id;
}

// ─── Happy path: logged-only mode (no API key) ────────────────────────────────

describe('executeEmailSend: logged-only mode (no API key)', () => {
  it('marks executed and writes a gateway audit row when API key is absent', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    delete process.env.RESEND_API_KEY;

    // ADDRESSED TO THE FOUNDER. Logged-only is the dev path for FOUNDRY having
    // no provider key — it is about Foundry's own mail. A message to a
    // customer goes through the COMPANY's key, which is connected above, so
    // "no key" is not a state that message can be in. Pointing this at a
    // customer would have tested a scenario that cannot happen.
    const actionId = await insertAction({ to: `${founderId}@test.local` });
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

// ─── A result the caller does not recognise ──────────────────────────────────

describe('executeEmailSend: unrecognised gateway result', () => {
  it('records unknown rather than sent, and does not blame the API key', async () => {
    // Logged-mode and "no idea what came back" used to share one branch and one
    // explanation: status 'executed' with the message "No RESEND_API_KEY set —
    // email logged only". The first is true and deliberate. The second was a
    // guess presented as a cause — a send whose outcome is unknown, filed as a
    // completed one, blaming an environment variable that may well be set.
    //
    // A key IS set here, precisely so a failure to distinguish the two shows
    // up as the false explanation it is.
    vi.stubEnv('RESEND_API_KEY', 'test_key');
    registerToolHandler(
      'send_email',
      // A shape this module knows nothing about: no message_id, not logged.
      async () => ({ queued: 'maybe' }) as unknown as { logged: true },
      SEND_EMAIL_POLICY,
    );

    const actionId = await insertAction({ to: `${founderId}@test.local` });
    const r = await executeEmailSend(actionId);
    expect(r.success, 'nothing confirmed a send, so this is not a success').toBe(false);

    const row = (await query(
      'SELECT status, result_json FROM outbound_actions WHERE id = ?', [actionId]
    )).rows[0] as Record<string, unknown>;
    expect(String(row.status),
      'an email whose fate is unknown must not be recorded as sent').toBe('failed');
    expect(String(row.result_json)).toContain('unknown');
    expect(String(row.result_json),
      'the API key is set — naming it would be a fabricated cause')
      .not.toContain('No RESEND_API_KEY');
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
    // ALSO FOUNDER MAIL. The SendGrid fallback is FOUNDRY's account, so it is
    // deliberately unavailable to a company's own mail: falling back would put
    // the founder's From through Foundry's provider, which is the exact
    // substitution sender-of-record exists to prevent. The fallback is for
    // Foundry's own messages, and that is what this proves.
    delete process.env.RESEND_API_KEY;
    vi.stubEnv('SENDGRID_API_KEY', 'sg_test');
    const fetchSpy = vi.fn(async () => new Response('', {
      status: 202, headers: { 'x-message-id': 'sg_1' },
    }));
    vi.stubGlobal('fetch', fetchSpy);
    // The real product and the real founder. 'p1' names no company here, and
    // a message to a company that does not exist has no founder to be
    // addressed to — so it would be third-party mail with no sender, which is
    // a different test than this one.
    const founderEmail = `${founderId}@test.local`;
    const result = await sendEmailHandler({
      productId, agent: 'system', tool: 'send_email', action: 'digest',
      params: { to: [founderEmail], subject: 'Weekly', html: '<p>Hi</p>', text: 'Hi' },
      dedupKey: `weekly:${productId}:2026-08-14`, customerExternalId: founderEmail,
    });
    expect(result).toMatchObject({ message_id: 'sg_1' });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('sendgrid.com');
  });
});


// ─── A coercion that manufactured a recipient ────────────────────────────────
//
// `[String(parameters.to)]` turned an ABSENT `to` into the one-element list
// `["undefined"]`, and the gateway's `requireCustomerExternalId` is satisfied by
// any non-empty string. So a row whose `parameters_json` PARSED but carried no
// recipient reached the provider as an attempted send to the address
// "undefined" — burning the dedup key and marking the action executed or
// failed, rather than refusing it as malformed.
//
// The parse-FAILURE path was already safe, because it produces `to: []`. Valid
// JSON missing a field was the gap, and it is the more likely of the two: a
// caller that writes the row wrongly, rather than a row that is corrupt.

describe('executeEmailSend: a row with no recipient', () => {
  it('is refused rather than sent to the address "undefined"', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test_key');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const id = await insertAction({ rawParams: { subject: 'Hi', html: '<p>hi</p>' } });
    await executeEmailSend(id).catch(() => undefined);

    expect(fetchSpy, 'no provider call may be attempted for a malformed row')
      .not.toHaveBeenCalled();

    const row = (await query('SELECT status FROM outbound_actions WHERE id = ?', [id]))
      .rows[0] as Record<string, unknown>;
    expect(String(row.status), 'executed or failed would both claim an attempt was made')
      .not.toBe('executed');
  });

  it('is refused when every recipient is blank', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test_key');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const id = await insertAction({ rawParams: { to: ['', '   '], subject: 'Hi', html: 'x' } });
    await executeEmailSend(id).catch(() => undefined);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // No positive control here on purpose: the happy-path describes above already
  // prove a well-formed row sends, and repeating it at the end of the file
  // would couple this describe to whatever kill-switch state they leave behind.
});
