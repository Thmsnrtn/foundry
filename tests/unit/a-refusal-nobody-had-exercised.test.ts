// =============================================================================
// Tests: the two policy refusals the consequential-effects path converges on.
//
// Every outward effect goes through one door, and two of that door's checks
// exist to stop an effect that is missing the facts its capability requires: an
// at-most-once identity, and the identity of the person it reaches. All five
// registered tools set both flags, so these refusals are what actually protects
// the path today — and nothing exercised either of them.
//
// A rule is not governance unless the real consequence path consumes it, and a
// consequence path nothing tests is a rule nobody has watched work. The second
// refusal matters twice over: `requireCustomerExternalId` is also what makes
// the do-not-contact check reachable, so an effect that slipped past it would
// skip a person's recorded refusal as well.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import {
  invoke, registerToolHandler, clearToolHandlers, type ToolPolicy,
} from '../../src/services/outbound/gateway.js';

let founderId: string;
let productId: string;

const POLICY: ToolPolicy = {
  actor: 'atlas', surface: 'email_outbound', dataClass: 'customer',
  requireDedupKey: true, requireCustomerExternalId: true,
};

beforeAll(async () => {
  await runMigrations();
  for (const m of ['065_idempotency_keys', '066_data_classifications', '067_communication_budgets']) {
    await executeRaw(readFileSync(resolve(__dirname, `../../src/db/migrations/${m}.sql`), 'utf-8'));
  }
});

beforeEach(async () => {
  founderId = nanoid();
  productId = nanoid();
  await query("INSERT INTO founders (id, clerk_user_id, email, tier) VALUES (?,?,?,'growth')",
    [founderId, `clerk_${founderId}`, `${founderId}@test.local`]);
  await query('INSERT INTO products (id, name, owner_id) VALUES (?,?,?)',
    [productId, 'Reachable Co', founderId]);
  await executeRaw('DELETE FROM idempotency_keys');
  await executeRaw('DELETE FROM data_classifications');
  await executeRaw('DELETE FROM audit_log');
  clearToolHandlers();
});

/** A tool that records whether the effect ever reached it. */
function stub(policy: ToolPolicy = POLICY): ReturnType<typeof vi.fn> {
  const handler = vi.fn(async () => ({ ok: true }));
  registerToolHandler('send_email', handler, policy);
  return handler;
}

const request = (over: Partial<Parameters<typeof invoke>[0]> = {}) => ({
  productId, tool: 'send_email', action: 'a message to a customer',
  params: { to: ['someone@example.com'] },
  dedupKey: 'effect_1', customerExternalId: 'someone@example.com', ...over,
});

describe('an effect missing what its capability requires', () => {
  it('sends when it carries both facts', async () => {
    const handler = stub();
    const result = await invoke(request());
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('is refused when it has decided not to dedup, and never reaches the tool', async () => {
    const handler = stub();
    // `null` is the caller saying so out loud — the type requires a decision
    // rather than permitting an omission. The policy still refuses it, which is
    // the point: saying it explicitly does not buy permission.
    const result = await invoke(request({ dedupKey: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe('policy');
      expect(result.reason).toContain('dedup key is required');
    }
    expect(handler, 'a refused effect must not reach the provider').not.toHaveBeenCalled();
  });

  it('is refused when it does not say who it reaches, and never reaches the tool', async () => {
    const handler = stub();
    const result = await invoke(request({ customerExternalId: undefined }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe('policy');
      expect(result.reason).toContain('customer external id is required');
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('records the refusal, so a blocked effect is not a silent one', async () => {
    stub();
    await invoke(request({ dedupKey: null }));
    const rows = await query(
      `SELECT outcome, reasoning FROM audit_log
        WHERE product_id=? AND action_type='gateway:send_email'`, [productId]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ outcome: 'refused' });
    expect(String((rows.rows[0] as Record<string, unknown>).reasoning)).toContain('dedup key is required');
  });

  it('does not invent a requirement a capability did not state', async () => {
    // The flags are properties of the REGISTERED capability. A tool that asks
    // for neither must not be refused for lacking them, or the check would be
    // the gateway deciding what a capability needs.
    const handler = stub({ ...POLICY, requireDedupKey: false, requireCustomerExternalId: false });
    const result = await invoke(request({ dedupKey: null, customerExternalId: undefined }));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
