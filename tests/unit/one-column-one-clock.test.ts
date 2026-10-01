process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { upsertCustomer } from '../../src/services/customers/intelligence.js';
import { disconnectIntegration } from '../../src/services/integration/fabric.js';

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
// One of the eleven was `integration_health`, written by
// `integrations/health-monitor.ts`. That module was reachable from no entry
// point and has been deleted, so the case that held its two timestamps to one
// clock went with it — the column is no longer written by anything.
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

// The outbound-action approval case went with `outbound/executor.ts`, deleted in
// Roadmap 2027 R9.
