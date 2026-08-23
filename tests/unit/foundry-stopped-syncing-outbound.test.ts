process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

const delivered: Array<{ title: string }> = [];
vi.mock('../../src/services/ux/interruption.js', () => ({
  deliver: async (_f: string, _p: string, item: { title: string }) => {
    delivered.push(item);
    return { delivered: true };
  },
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { syncProductIntegrations } = await import('../../src/services/integrations/sync.js');

// =============================================================================
// "FOUNDRY STOPPED SYNCING OUTBOUND."
//
// `integrations` is shared by writers that mean different things by `type`. The
// connect form and `sync.ts`'s own switch treat it as a PROVIDER KEY —
// 'stripe', 'posthog', 'intercom', 'linear'. `connections.ts` writes
// `type = 'outbound'` for an MCP server the founder connected so Foundry can
// CALL it. `stripe-sync.ts` writes `type = 'inbound'` as a direction.
//
// `syncProductIntegrations` selected every active row and dispatched on `type`,
// so an outbound MCP connection was pulled into the inbound metrics sync every
// cycle, fell through to the default branch, and was recorded as a FAILED sync:
// "Integration type 'outbound' not yet implemented", with `status` set to
// 'error' and `error_count` incremented.
//
// Five cycles later it crossed MAX_CONSECUTIVE_SYNC_FAILURES and the founder's
// phone received an action_needed interruption reading "Foundry stopped syncing
// outbound" — a sentence about a direction, announcing that Foundry had given
// up on something it was never supposed to be pulling from. The delivery path
// is careful and correct; it was being handed a subject that was not one.
//
// The default branch stays, because it is right for its own case: a real
// provider whose adapter is not written yet. What did not belong in the query
// is a row that is not a provider at all.
// =============================================================================

const P = 'p_out';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_o','c_o','o@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_o','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM integration_sync_log WHERE product_id = ?', [P]);
  await query('DELETE FROM integrations WHERE product_id = ?', [P]);
  delivered.length = 0;
});

/** Exactly what `POST /connections` writes for an MCP server. */
async function outboundConnection(label: string): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO integrations (id, product_id, owner_id, name, provider, type, direction, status, credentials, config)
     VALUES (?, ?, 'f_o', ?, 'mcp', 'outbound', 'outbound', 'active', ?, '{}')`,
    [id, P, label, 'ciphertext']);
  return id;
}

/** A provider with no adapter yet — the default branch's real case. */
async function unimplementedProvider(type: string): Promise<string> {
  const id = nanoid();
  await query(
    // A parseable payload, so the sync reaches the dispatch switch rather than
    // failing earlier on decryption — which is a different failure and would
    // have made this test pass for the wrong reason.
    // A DATA SOURCE, which is what this fixture means. Since migration 203 the
    // direction is its own column and the sync selects on it, so a row that
    // says nothing about which way it points is one the sync leaves alone —
    // deliberately, because a connection that might SEND is not something to
    // start pulling from on a guess. This fixture is a provider the founder
    // connected to pull FROM, and now it says so.
    `INSERT INTO integrations (id, product_id, name, provider, type, direction, status, credentials_json, config_json)
     VALUES (?, ?, ?, ?, ?, 'inbound', 'active', '{}', '{}')`,
    [id, P, type, type, type]);
  return id;
}

async function stateOf(id: string): Promise<{ status: string; error_count: number; last_error: string | null }> {
  const r = await query('SELECT status, COALESCE(error_count,0) AS error_count, last_error FROM integrations WHERE id = ?', [id]);
  return r.rows[0] as unknown as { status: string; error_count: number; last_error: string | null };
}

describe('a connection Foundry calls, not one it pulls from', () => {
  it('is left alone by the inbound sync', async () => {
    const id = await outboundConnection('my-mcp-server');

    await syncProductIntegrations(P);

    const after = await stateOf(id);
    expect(after.status).toBe('active');
    expect(after.error_count).toBe(0);
    expect(after.last_error).toBeNull();
  });

  it('records no failed sync attempt against itself', async () => {
    await outboundConnection('my-mcp-server');

    await syncProductIntegrations(P);

    const rows = await query('SELECT COUNT(*) AS n FROM integration_sync_log WHERE product_id = ?', [P]);
    expect((rows.rows[0] as unknown as { n: number }).n).toBe(0);
  });

  it('never reaches the founder as an integration Foundry gave up on', async () => {
    const id = await outboundConnection('my-mcp-server');

    // Five cycles is where the announcement used to fire.
    for (let i = 0; i < 6; i++) await syncProductIntegrations(P);

    expect(delivered).toEqual([]);
    expect((await stateOf(id)).error_count).toBe(0);
  });
});

describe('a provider whose adapter is not written yet', () => {
  it('is still recorded as a failed sync, which is what the default branch is for', async () => {
    const id = await unimplementedProvider('mixpanel');

    await syncProductIntegrations(P);

    const after = await stateOf(id);
    expect(after.status).toBe('error');
    expect(after.error_count).toBe(1);
    expect(after.last_error).toContain('mixpanel');
  });

  it('still tells the founder once when Foundry stops trying', async () => {
    await unimplementedProvider('amplitude');

    for (let i = 0; i < 8; i++) await syncProductIntegrations(P);

    // Announced on the crossing, exactly once.
    expect(delivered.length).toBe(1);
    expect(delivered[0]!.title).toContain('amplitude');
  });
});
