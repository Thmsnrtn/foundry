// =============================================================================
// Tests: four features that spent money and then threw away the result
//
// `check-insert-columns` proves every column an INSERT NAMES exists. It cannot
// see the opposite defect: a column the INSERT does NOT name, which the table
// declares NOT NULL with no default. Four instances, all the same shape and all
// with the same cause — a later migration redefined a table with
// `CREATE TABLE IF NOT EXISTS`, which is a silent no-op on an existing table,
// and the code was written against the definition that never took effect:
//
//   board_packets       omitted period_start / period_end
//   investor_updates    omitted owner_id / period / subject / content
//   experiments         omitted hypothesis_id / type / control_description /
//                       treatment_description / success_metric
//   voice_sessions      omitted session_date
//   integration_sync_log omitted started_at
//
// Three of them made a PAID MODEL CALL FIRST. The founder pressed Generate, the
// money went, the narrative was written, and then the write raised. So the
// board-packet, investor-update and growth-experiment features never produced
// anything, for anybody, since they shipped — and the failure was invisible
// from outside because a button that does nothing looks like a button nobody
// pressed.
//
// FOUR OF THE FIVE WRITERS ARE NOW GONE. `investor_updates` went first, with
// the Commercial Foundry routes that were its only caller. `experiments/
// engine.ts` and `voice/processor.ts` have now followed as reachable from no
// entry point, and `scp/investor/board-packet.ts` with them — so the cases that
// proved those rows landed have no write left to assert. What remains is the
// sync log, whose writer is live, and it is asserted the same way: the ROW
// EXISTS afterwards. A test that only called the function and checked it did
// not throw would have passed against the old code on any fixture that built
// its own tables.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const OWNER = 'wn_owner';
const P = 'wn_product';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [OWNER, 'clerk_wn', 'wn@test.local']);
  await query(
    `INSERT INTO products (id, name, owner_id, status) VALUES (?, 'Landed Co', ?, 'active')`,
    [P, OWNER]);
});

describe('a sync is actually logged', () => {
  it('records the row a failed sync path would otherwise lose', async () => {
    // runSync's own failures are treated as unremarkable, so a log that has
    // never recorded anything looked like a quiet system rather than a broken
    // write. The integration below has no adapter, so the sync fails — and the
    // LOG of that failure is the thing under test.
    const integrationId = nanoid();
    await query(
      `INSERT INTO integrations (id, product_id, direction, provider, status, config)
       VALUES (?, ?, 'inbound', 'zz_no_adapter', 'active', '{}')`,
      [integrationId, P]);
    const { runSync } = await import('../../src/services/integrations/framework.js');
    await runSync(integrationId, 'scheduled').catch(() => undefined);

    const row = (await query(
      `SELECT started_at, completed_at FROM integration_sync_log WHERE integration_id = ?`,
      [integrationId])).rows[0] as Record<string, unknown> | undefined;
    expect(row, 'every sync log write raised on a NOT NULL column').toBeTruthy();
    expect(row!.started_at).toBeTruthy();
  });
});
