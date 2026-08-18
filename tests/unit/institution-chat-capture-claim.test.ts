// =============================================================================
// Tests: the institution told a founder it had recorded a decision it had not
//
// The system prompt for the institution chat says:
//
//   "Tell the founder what you captured, in one short sentence at the end of
//    the reply."
//
// The model writes that sentence into its reply BEFORE any write happens. The
// write that follows was wrapped in `catch { /* ledger capture is best-effort
// */ }`, so when it failed the founder was left holding a message saying their
// decision had gone into the ledger, with nothing anywhere contradicting it.
// The page appends a small 📒 when the capture succeeded; the absence of an
// icon is not a retraction of a sentence.
//
// Best-effort is the right posture for the WRITE — a ledger failure must not
// eat the conversation. It was never the right posture for the CLAIM.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const F = 'icc_f';
const P = 'icc_p';

const reply = 'Raising prices is reasonable. I have recorded that decision.';

let modelJson = '';

vi.mock('../../src/services/ai/client.js', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    callSonnet: vi.fn(async () => ({
      content: modelJson,
      usage: { input_tokens: 10, output_tokens: 10 },
    })),
  };
});

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'clerk_icc', 'icc@test.local']);
  await query(`INSERT INTO products (id, name, owner_id) VALUES (?,'Chat Co',?)`, [P, F]);
});

beforeEach(async () => {
  await query('DELETE FROM conversation_messages');
  await query('DELETE FROM conversation_threads');
  await query('DELETE FROM strategic_decisions_log');
  modelJson = JSON.stringify({
    reply,
    capture: { kind: 'decision', title: 'Raise prices', decision: 'Raise prices 20%' },
  });
});

async function lastAssistantMessage(): Promise<string> {
  const rows = await query(
    `SELECT content FROM conversation_messages WHERE role='assistant'
      ORDER BY rowid DESC LIMIT 1`);
  return String((rows.rows[0] as Record<string, unknown> | undefined)?.content ?? '');
}

describe('a capture that succeeded', () => {
  it('records the decision and leaves the reply alone', async () => {
    const { handleUtterance } = await import('../../src/services/chat/institution.js');
    const turn = await handleUtterance(P, F, 'we are raising prices 20%');

    expect(turn.captured?.kind).toBe('decision');
    expect(turn.reply, 'nothing to correct, so nothing is added').toBe(reply);

    const rows = await query(
      `SELECT COUNT(*) AS n FROM strategic_decisions_log WHERE product_id = ?`, [P]);
    expect(Number((rows.rows[0] as Record<string, unknown>).n)).toBe(1);
    expect(await lastAssistantMessage()).toBe(reply);
  });
});

describe('a capture that failed', () => {
  it('tells the founder it was not recorded', async () => {
    // The ledger write refuses. Everything else about the turn still works —
    // which is the point of best-effort, and exactly why the false claim
    // survived for so long.
    await query(`
      CREATE TRIGGER icc_refuse BEFORE INSERT ON strategic_decisions_log
      BEGIN SELECT RAISE(ABORT, 'test:ledger_unavailable'); END`);
    try {
      const { handleUtterance } = await import('../../src/services/chat/institution.js');
      const turn = await handleUtterance(P, F, 'we are raising prices 20%');

      expect(turn.captured, 'nothing was captured').toBeNull();
      expect(turn.reply, 'and the founder is told so, in the reply itself')
        .toMatch(/not recorded/i);
      expect(turn.reply).toContain(reply);

      const rows = await query(
        `SELECT COUNT(*) AS n FROM strategic_decisions_log WHERE product_id = ?`, [P]);
      expect(Number((rows.rows[0] as Record<string, unknown>).n)).toBe(0);

      // A founder scrolling back must see what they were told at the time,
      // not the uncorrected sentence.
      const stored = await lastAssistantMessage();
      expect(stored).toMatch(/not recorded/i);

      // And the answer still came — a ledger failure does not eat the
      // conversation, which is the whole reason best-effort was right for the
      // write and wrong for the claim.
      expect(stored).toContain('Raising prices is reasonable.');
    } finally {
      await query('DROP TRIGGER icc_refuse');
    }
  });
});
