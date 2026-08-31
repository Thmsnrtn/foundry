// =============================================================================
// Tests: the board packet told investors the company decided nothing
//
// The "Key Decisions This Quarter" section read `agent_decisions` — a table
// migration 083 created because three surfaces queried a table that did not
// exist, and whose own migration comment says plainly: "No writer yet — the tab
// renders empty until agents populate it."
//
// Nothing ever did. There is no INSERT into `agent_decisions` anywhere in the
// codebase. So the section has read "No recent decisions." for every company in
// every quarter since it shipped, however many decisions the company actually
// made — and the real ledger, `decisions`, sat one table away holding all of
// them.
//
// What made it invisible: the read sat in `catch { // agent_decisions may not
// exist }`, so a missing table and an empty result produced exactly the same
// sentence. And the sentence goes into an AI prompt, so the model then wrote an
// executive summary for INVESTORS about a quarter in which nothing was decided.
// Under-reporting to investors is not a neutral failure.
//
// The test asserts on the PROMPT the generator hands the model, because that is
// where the claim is made. A test that only checked which table was queried
// would prove the code reads a field, not that an investor is told the truth.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const prompts: string[] = [];
vi.mock('../../src/services/ai/client.js', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    callSonnet: vi.fn(async (_system: string, user: string) => {
      prompts.push(user);
      return {
        content: JSON.stringify({
          executive_summary: 's', key_metrics: [], highlights: [], lowlights: [],
          decisions_made: [], asks: [], next_quarter_focus: [],
        }),
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    }),
  };
});

const OWNER = 'bpd_owner';
const P = 'bpd_product';
let seq = 0;

async function decision(what: string, opts: { status?: string; chosen?: string } = {}): Promise<void> {
  await query(
    `INSERT INTO decisions (id, product_id, what, why_now, category, gate, status, chosen_option)
     VALUES (?, ?, ?, 'Because', 'strategic', 1, ?, ?)`,
    [nanoid(), P, what, opts.status ?? 'pending', opts.chosen ?? null]);
}

/** The generator refuses a second packet for the same quarter, so each case
 *  gets its own. */
function nextQuarter(): string {
  seq += 1;
  return `20${10 + seq}-Q1`;
}

async function promptFor(quarter: string): Promise<string> {
  const { generateBoardPacket } = await import('../../src/services/scp/investor/board-packet.js');
  prompts.length = 0;
  await generateBoardPacket(P, quarter);
  return prompts[0] ?? '';
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [OWNER, 'clerk_bpd', 'bpd@test.local']);
  await query(
    `INSERT INTO products (id, name, owner_id, status) VALUES (?, 'Packet Co', ?, 'active')`,
    [P, OWNER]);
});

beforeEach(async () => {
  await query('DELETE FROM decisions WHERE product_id = ?', [P]);
});

describe('what an investor is told about the quarter', () => {
  it('names the decisions the company actually made', async () => {
    await decision('Raise the price to $99');
    await decision('Hire a second engineer');

    const prompt = await promptFor(nextQuarter());
    expect(prompt).toContain('Raise the price to $99');
    expect(prompt).toContain('Hire a second engineer');
    expect(prompt).not.toContain('No recent decisions.');
  });

  it('says what was chosen, not merely that something was decided', async () => {
    await decision('Raise the price to $99', { status: 'approved', chosen: 'Raise to $79' });
    const prompt = await promptFor(nextQuarter());
    expect(prompt).toContain('Raise to $79');
  });

  it('still says so plainly when there genuinely were none', async () => {
    // The fix must not turn an honest empty into a fabricated one.
    const prompt = await promptFor(nextQuarter());
    expect(prompt).toContain('No recent decisions.');
  });

  it('does not count a deleted decision', async () => {
    await decision('Something withdrawn');
    await query(`UPDATE decisions SET deleted_at = datetime('now') WHERE product_id = ?`, [P]);
    const prompt = await promptFor(nextQuarter());
    expect(prompt).toContain('No recent decisions.');
  });

  it('does not read a table nothing writes', async () => {
    // `agent_decisions` has no INSERT anywhere in the codebase. Reading it was
    // not a wrong join — it was a source that can never have a row.
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      new URL('../../src/services/scp/investor/board-packet.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    expect(src).not.toMatch(/FROM agent_decisions/);
  });
});
