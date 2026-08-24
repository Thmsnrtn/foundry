process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { upsertCustomer } from '../../src/services/customers/intelligence.js';
import { disconnectIntegration } from '../../src/services/integration/fabric.js';
import { recordIntegrationEvent } from '../../src/services/integrations/health-monitor.js';

// =============================================================================
// ONE COLUMN, ONE CLOCK.
//
// SQLite stores a timestamp as TEXT. `datetime('now')` and CURRENT_TIMESTAMP
// write 'YYYY-MM-DD HH:MM:SS'; a JavaScript `toISOString()` writes
// 'YYYY-MM-DDTHH:MM:SS.sssZ'. Eleven columns were being written BOTH ways by
// different code paths, and text comparison puts a space before 'T' — so
// ordering by such a column interleaves the two paths wrongly, MAX() prefers
// whichever row JavaScript wrote, and every range comparison splits on which
// path happened to write the row.
//
// The rule this file holds: a timestamp reaches the database in the database's
// format. Where the value is Foundry's own "now", that means `datetime('now')`;
// where it is a caller's — a company reporting when its customer was last
// active — it means `datetime(?)`, which converts what arrives and leaves NULL
// as NULL.
// =============================================================================

const SQL_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const P = 'p_clock';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_clock','c_clock','clock@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_clock','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM customers');
  await query('DELETE FROM integrations');
  await query('DELETE FROM integration_health');
  await query('DELETE FROM outbound_actions');
});

describe('a timestamp a company reports about its own customer', () => {
  it('is stored in the database’s format whatever format it arrives in', async () => {
    const id = await upsertCustomer(P, 'f_clock', {
      external_id: 'ext_1',
      name: 'Acme Ltd',
      signed_up_at: '2026-01-02T03:04:05.678Z',
      last_active_at: '2026-06-07T08:09:10.111Z',
    });

    const row = (await query(
      'SELECT signed_up_at, last_active_at FROM customers WHERE id=?', [id],
    )).rows[0] as unknown as Record<string, unknown>;
    expect(String(row.signed_up_at)).toMatch(SQL_TIME);
    expect(String(row.last_active_at)).toMatch(SQL_TIME);
    // The same instant, not a reformatted guess.
    expect(row.signed_up_at).toBe('2026-01-02 03:04:05');
  });

  it('leaves an unreported timestamp null rather than inventing one', async () => {
    const id = await upsertCustomer(P, 'f_clock', { external_id: 'ext_2', name: 'Quiet Ltd' });
    const row = (await query(
      'SELECT signed_up_at, last_active_at FROM customers WHERE id=?', [id],
    )).rows[0] as unknown as Record<string, unknown>;
    expect(row.signed_up_at).toBeNull();
    expect(row.last_active_at).toBeNull();
  });

  it('does not overwrite a stored timestamp when the update omits it', async () => {
    const id = await upsertCustomer(P, 'f_clock', {
      external_id: 'ext_3', last_active_at: '2026-06-07T08:09:10.111Z',
    });
    await upsertCustomer(P, 'f_clock', { external_id: 'ext_3', name: 'Renamed Ltd' });
    const row = (await query(
      'SELECT name, last_active_at FROM customers WHERE id=?', [id],
    )).rows[0] as unknown as Record<string, unknown>;
    expect(row.name).toBe('Renamed Ltd');
    expect(row.last_active_at).toBe('2026-06-07 08:09:10');
  });
});

describe('the integrations table', () => {
  it('stamps updated_at the same way from every path', async () => {
    await query(
      `INSERT INTO integrations (id, product_id, name, provider, direction, status, updated_at)
       VALUES ('i_1', ?, 'resend', 'resend', 'outbound', 'active', datetime('now'))`, [P]);

    // The disconnect path wrote an ISO string; every other writer on this
    // column uses datetime('now').
    await disconnectIntegration(P, 'resend');

    const row = (await query(
      "SELECT status, updated_at FROM integrations WHERE id='i_1'"))
      .rows[0] as unknown as Record<string, unknown>;
    expect(row.status).toBe('disconnected');
    expect(String(row.updated_at)).toMatch(SQL_TIME);
  });
});

describe('integration health', () => {
  it('records both its timestamps in one format', async () => {
    await recordIntegrationEvent(P, 'stripe', true);
    const row = (await query(
      'SELECT last_event_at, last_successful_sync, updated_at FROM integration_health WHERE product_id=?',
      [P])).rows[0] as unknown as Record<string, unknown>;
    for (const k of ['last_event_at', 'last_successful_sync', 'updated_at']) {
      expect(String(row[k]), `${k} carries the wrong clock`).toMatch(SQL_TIME);
    }

    // And on the update branch, which was a second copy of the same statement.
    await recordIntegrationEvent(P, 'stripe', false, 'it broke');
    const after = (await query(
      'SELECT last_event_at, updated_at, consecutive_failures FROM integration_health WHERE product_id=?',
      [P])).rows[0] as unknown as Record<string, unknown>;
    expect(after.consecutive_failures).toBe(1);
    expect(String(after.last_event_at)).toMatch(SQL_TIME);
    expect(String(after.updated_at)).toMatch(SQL_TIME);
  });
});

describe('an outbound action’s approval', () => {
  it('is stamped in one format whether it was approved or rejected', async () => {
    const { approveAction, rejectAction } =
      await import('../../src/services/outbound/executor.js');

    for (const [id, kind] of [['oa_1', 'approve'], ['oa_2', 'reject']] as const) {
      await query(
        `INSERT INTO outbound_actions
           (id, product_id, agent_name, integration_name, action_type, parameters_json,
            preview_text, rationale, status, authority_level)
         VALUES (?, ?, 'ledger', 'resend', 'send_email', '{}', 'a preview', 'a reason', 'pending_approval', 2)`, [id, P]);
      if (kind === 'approve') await approveAction(id, 'founder:f_clock').catch(() => {});
      else await rejectAction(id, 'founder:f_clock', 'not now').catch(() => {});
    }

    const rows = (await query(
      'SELECT id, approved_at FROM outbound_actions WHERE approved_at IS NOT NULL ORDER BY id',
    )).rows as unknown as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(String(r.approved_at), `${r.id} carries the wrong clock`).toMatch(SQL_TIME);
    }
  });
});
