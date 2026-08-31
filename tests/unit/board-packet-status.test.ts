// =============================================================================
// Tests: the founder's "Mark Reviewed" button did nothing, for as long as it
//        has existed
//
// `board_packets` was created by migration 011 with the vocabulary
// draft / finalized / shared. Migration 039 then wrote
//
//   CREATE TABLE IF NOT EXISTS board_packets ( ... CHECK (status IN
//     ('draft','reviewed','published')) )
//
// and because the table already existed, that definition was a silent no-op.
// The service and the page were both written against the version that never
// took effect, so:
//
//   • UPDATE board_packets SET status='reviewed' raised, every time
//   • the route caught it with `// Non-fatal` and redirected
//   • the badge checked for 'reviewed', so every packet read "Draft" forever
//   • the button checked `status !== 'reviewed'`, so it never went away
//
// Nothing anywhere reported a failure. A founder clicked a button, the page
// reloaded unchanged, and the only record of it was an exception nobody saw.
//
// `finalized` is the live value, and migration 011's own comment on the column
// next to it says what it means: "when founder marks it ready to share".
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const OWNER = 'bp_owner';
const OTHER = 'bp_other';
const MINE = 'bp_mine';
const THEIRS = 'bp_theirs';

let quarterSeq = 0;

async function packet(id: string, productId: string): Promise<void> {
  // One packet per product per quarter is a real constraint, so each fixture
  // gets its own quarter rather than colliding with the previous test's.
  quarterSeq += 1;
  await query(
    `INSERT INTO board_packets (id, product_id, quarter, period_start, period_end, status)
     VALUES (?, ?, ?, '2026-01-01', '2026-03-31', 'draft')`,
    [id, productId, `2026-Q${quarterSeq}`]);
}

async function statusOf(id: string): Promise<Record<string, unknown>> {
  return (await query(
    'SELECT status, finalized_at FROM board_packets WHERE id = ?', [id]))
    .rows[0] as Record<string, unknown>;
}

beforeAll(async () => {
  await runMigrations();
  for (const [f, p, name] of [[OWNER, MINE, 'Mine'], [OTHER, THEIRS, 'Theirs']]) {
    await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
      [f, `clerk_${f}`, `${f}@test.local`]);
    await query(`INSERT INTO products (id, name, owner_id) VALUES (?,?,?)`, [p, name, f]);
  }
});

describe('marking a packet ready to share', () => {
  it('writes a status the table accepts, and says it changed something', async () => {
    const { markPacketFinalized } = await import(
      '../../src/services/scp/investor/board-packet.js');
    const id = nanoid();
    await packet(id, MINE);

    expect(await markPacketFinalized(id, OWNER),
      'the whole defect was that this raised instead').toBe(true);

    const row = await statusOf(id);
    expect(row.status).toBe('finalized');
    expect(row.finalized_at, 'the column beside it exists for exactly this moment')
      .not.toBeNull();
  });

  it('refuses a packet belonging to another founder, and says nothing changed', async () => {
    const { markPacketFinalized } = await import(
      '../../src/services/scp/investor/board-packet.js');
    const id = nanoid();
    await packet(id, THEIRS);

    expect(await markPacketFinalized(id, OWNER)).toBe(false);
    expect((await statusOf(id)).status, 'and left it alone').toBe('draft');
  });

  it('reports nothing changed for a packet that does not exist', async () => {
    // Returning void made "no such packet" and "done" the same outcome, so the
    // route could not tell the founder anything either way.
    const { markPacketFinalized } = await import(
      '../../src/services/scp/investor/board-packet.js');
    expect(await markPacketFinalized('bp_nonexistent', OWNER)).toBe(false);
  });

  it('is what the live schema actually permits', async () => {
    // Named directly, because the whole failure was a vocabulary nobody
    // checked against the database.
    const id = nanoid();
    await packet(id, MINE);
    // check-vocabulary:expected-refusal
    await expect(query(
      `UPDATE board_packets SET status = 'reviewed' WHERE id = ?`, [id]))
      .rejects.toThrow();
    await query(`UPDATE board_packets SET status = 'shared' WHERE id = ?`, [id]);
    expect((await statusOf(id)).status).toBe('shared');
  });
});
