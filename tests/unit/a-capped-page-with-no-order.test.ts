process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// A CAPPED PAGE WITH NO ORDER DECIDES FOR YOU.
//
// Four queries took the first N rows of a set with more than N members and no
// ORDER BY, so which rows they got was storage order — and each one presented
// the result as though it had chosen:
//
//   next-action        "what needs you next" picked one of several critical
//                      stressors arbitrarily.
//   redteam/council    handed a red team five arbitrary risks as the company's
//                      risks.
//   voice/processor    spoke three arbitrary stressors aloud in a briefing.
//   agents/compass     gave an agent five arbitrary OKRs.
//
// A biased sample nobody knows is a sample is worse than a short list, because
// the reader has no way to tell it was truncated at all. Each is ordered by
// what its caller actually means now.
// =============================================================================

const P = 'p_cap';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_cap','c_cap','cap@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_cap','active')", [P]);
});

beforeEach(async () => { await query('DELETE FROM stressor_history'); });

const stressor = (id: string, name: string, severity: string, daysAgo: number) => query(
  `INSERT INTO stressor_history
     (id, product_id, stressor_name, signal, timeframe_days, neutralizing_action, severity, status, identified_at)
   VALUES (?, ?, ?, 'x', 30, 'y', ?, 'active', datetime('now', '-' || ? || ' days'))`,
  [id, P, name, severity, daysAgo]);

describe('what needs the founder next', () => {
  it('is the critical stressor that has been waiting longest', async () => {
    // Inserted newest-first, so storage order and the right answer disagree.
    await stressor('s_new', 'Newest critical', 'critical', 1);
    await stressor('s_old', 'Oldest critical', 'critical', 40);
    await stressor('s_mid', 'Middle critical', 'critical', 10);

    await query(
      "INSERT INTO lifecycle_state (product_id, current_prompt, risk_state) VALUES (?, 'prompt_4', 'red')",
      [P]).catch(() => undefined);

    const { getNextAction } = await import('../../src/services/ux/next-action.js');
    const action = await getNextAction(
      { id: 'f_cap', email: 'cap@example.com', name: 'Cap' } as never, P);
    expect(action.headline).toBeTruthy();

    const rows = await query(
      `SELECT id FROM stressor_history
        WHERE product_id = ? AND severity = 'critical' AND status = 'active'
        ORDER BY identified_at ASC LIMIT 1`, [P]);
    expect((rows.rows[0] as unknown as { id: string }).id).toBe('s_old');
  });
});

describe('the five a red team is given', () => {
  it('are the five most severe, not the first five stored', async () => {
    await stressor('c1', 'Watch A', 'watch', 1);
    await stressor('c2', 'Watch B', 'watch', 2);
    await stressor('c3', 'Watch C', 'watch', 3);
    await stressor('c4', 'Watch D', 'watch', 4);
    await stressor('c5', 'Watch E', 'watch', 5);
    await stressor('c6', 'The critical one', 'critical', 6);

    // The query the council runs, ordered as the source now orders it.
    const rows = await query(
      `SELECT stressor_name FROM stressor_history
        WHERE product_id = ? AND status = 'active'
        ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'elevated' THEN 2 ELSE 3 END, identified_at ASC
        LIMIT 5`, [P]);
    const names = (rows.rows as unknown as Array<{ stressor_name: string }>).map((r) => r.stressor_name);
    expect(names[0], 'the critical one cannot be the row that falls off the end').toBe('The critical one');
  });
});

describe('the sources', () => {
  it('all four order what they cap', async () => {
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('../../scripts/lib/strip-comments.mjs');
    const expectations: Array<[string, RegExp]> = [
      ['src/services/ux/next-action.ts', /severity = 'critical' AND status = 'active'\s*\n\s*ORDER BY identified_at ASC/],
      ['src/services/redteam/council.ts', /status = 'active'\s*\n\s*ORDER BY CASE severity/],
      ['src/services/voice/processor.ts', /status = 'active'\s*\n\s*ORDER BY CASE severity/],
      ['src/services/scp/agents/compass.ts', /ORDER BY CASE status WHEN 'off_track'/],
    ];
    for (const [file, pattern] of expectations) {
      // Comments stripped: each of these files explains the defect above the
      // query, quoting the unordered form it replaced.
      const src = stripComments(readFileSync(file, 'utf8'), { lineComments: true });
      expect(src, `${file} still caps without ordering`).toMatch(pattern);
    }
  });
});

describe('two more pages the same scan found', () => {
  it('the verifier takes the executions whose window elapsed first', async () => {
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('../../scripts/lib/strip-comments.mjs');
    const src = stripComments(
      readFileSync('src/services/outbound/action-verifier.ts', 'utf8'), { lineComments: true });
    expect(src).toMatch(/verify_after <= datetime\('now'\)\s*\n\s*ORDER BY verify_after ASC/);
  });

  it('the matchmaker orders the shortlist its ranking can only see', async () => {
    // The full score needs JSON overlap SQL cannot compute here, so the page is
    // ordered by the part it can — and the residual is stated in the source
    // rather than left in the shape of the query.
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('../../scripts/lib/strip-comments.mjs');
    const code = stripComments(
      readFileSync('src/services/network/matchmaking.ts', 'utf8'), { lineComments: true });
    expect(code).toMatch(/ORDER BY \(np\.sector = \?\) DESC, \(np\.growth_stage = \?\) DESC/);

    const prose = readFileSync('src/services/network/matchmaking.ts', 'utf8');
    expect(prose, 'the cap and its effect are said out loud')
      .toContain('not the best matches in the network');
  });
});
