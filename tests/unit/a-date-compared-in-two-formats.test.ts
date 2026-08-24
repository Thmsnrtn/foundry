process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { computeWeeklyOutcome } from '../../src/services/intelligence/weekly-outcome.js';
import { resolveDecision, recordOutcome } from '../../src/services/decisions/queue.js';

// =============================================================================
// A DATE COMPARED IN TWO FORMATS.
//
// SQLite has no date type: a timestamp is TEXT, and two conventions are in use.
// `datetime('now')` and CURRENT_TIMESTAMP write 'YYYY-MM-DD HH:MM:SS'; a
// JavaScript `toISOString()` writes 'YYYY-MM-DDTHH:MM:SS.sssZ'. Compared as
// text, index 10 decides: a space (0x20) sorts before 'T' (0x54).
//
// So a bound built in JavaScript, compared against a column SQLite wrote,
// excludes EVERY row from the boundary DATE whatever its clock time — a
// "trailing seven days" window that counts six and a bit. And a column written
// BOTH ways cannot be ordered or ranged at all: which format a row carries
// depends on which code path wrote it.
//
// Three windows and one column, found by scanning for bound comparisons on
// columns whose values come from SQLite. The tracker's windows were checked and
// cleared: they bind date-only strings, which sort correctly against both.
// =============================================================================

const P = 'p_fmt';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_fmt','c_fmt','fmt@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_fmt','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM decisions');
  await query('DELETE FROM action_drafts');
});

async function decision(id: string, opts: { createdAt?: string; gate?: number } = {}) {
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, created_at)
     VALUES (?, ?, 'strategic', ?, 'a thing', 'now', 'pending', COALESCE(?, datetime('now')))`,
    [id, P, opts.gate ?? 1, opts.createdAt ?? null],
  );
}

describe('the founder’s weekly outcome card', () => {
  it('counts a decision recorded on the oldest day of the window', async () => {
    // Seven days back, late in the day: inside a seven-day window by any
    // reading. The ISO bound excluded the whole of that date.
    const boundaryDate = (await query("SELECT date('now', '-7 days') AS d"))
      .rows[0] as unknown as Record<string, unknown>;
    await decision('d_edge', { createdAt: `${String(boundaryDate.d)} 23:59:59` });

    const outcome = await computeWeeklyOutcome(P);
    expect(outcome.surfaced_7d).toBe(1);
  });

  it('still excludes what is genuinely outside the window', async () => {
    await decision('d_old', { createdAt: '2020-01-01 12:00:00' });
    const outcome = await computeWeeklyOutcome(P);
    expect(outcome.surfaced_7d).toBe(0);
  });

  it('counts a decision the founder approved on the boundary date', async () => {
    const boundaryDate = (await query("SELECT date('now', '-7 days') AS d"))
      .rows[0] as unknown as Record<string, unknown>;
    await decision('d_acted', { createdAt: `${String(boundaryDate.d)} 09:00:00` });
    await query(
      `UPDATE decisions SET status='approved', decided_at=?, decided_by='founder' WHERE id='d_acted'`,
      [`${String(boundaryDate.d)} 23:00:00`],
    );

    const outcome = await computeWeeklyOutcome(P);
    expect(outcome.acted_on_7d).toBe(1);
    expect(outcome.percent_acted).toBe(100);
  });
});

describe('the column that was written two ways', () => {
  it('stores one format whichever path resolved the decision', async () => {
    await decision('d_a');
    await decision('d_b');

    // The queue's approve path used to write an ISO string here...
    await resolveDecision('d_a', P, 'do the thing', 'founder');
    // ...while the execution path writes datetime('now').
    await query(
      `UPDATE decisions SET status='executed', decided_at=datetime('now') WHERE id='d_b'`);

    const rows = (await query(
      'SELECT id, decided_at FROM decisions WHERE decided_at IS NOT NULL ORDER BY id',
    )).rows as unknown as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(String(r.decided_at), `${r.id} carries the wrong clock`).not.toContain('T');
      expect(String(r.decided_at)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
  });

  it('does the same for the outcome timestamp', async () => {
    await decision('d_c');
    await recordOutcome('d_c', P, 'it worked', 1);
    const row = (await query("SELECT outcome_measured_at FROM decisions WHERE id='d_c'"))
      .rows[0] as unknown as Record<string, unknown>;
    expect(String(row.outcome_measured_at)).not.toContain('T');
  });

  it('and migration 210 repaired the rows already written', async () => {
    const migration = readFileSync(
      'src/db/migrations/210_one_column_two_clocks.sql', 'utf8');
    // The file opens with a comment block, so the first chunk carries it:
    // select the statements by what they contain, then trim to the statement.
    const updates = migration.split(';')
      .filter((x) => x.includes('UPDATE decisions'))
      .map((x) => x.slice(x.indexOf('UPDATE decisions')).trim());
    expect(updates).toHaveLength(2);

    await decision('d_iso');
    await query(
      `UPDATE decisions SET decided_at='2026-03-04T10:11:12.345Z',
              outcome_measured_at='2026-03-05T01:02:03.000Z' WHERE id='d_iso'`);
    // A row already in the other format must be left exactly as it is.
    await decision('d_sql');
    await query(
      `UPDATE decisions SET decided_at='2026-03-04 10:11:12' WHERE id='d_sql'`);

    for (const stmt of updates) await query(stmt);

    const rows = (await query(
      'SELECT id, decided_at, outcome_measured_at FROM decisions ORDER BY id',
    )).rows as unknown as Array<Record<string, unknown>>;
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.d_iso.decided_at).toBe('2026-03-04 10:11:12');
    expect(by.d_iso.outcome_measured_at).toBe('2026-03-05 01:02:03');
    expect(by.d_sql.decided_at).toBe('2026-03-04 10:11:12');
  });
});

describe('the playbook weekly execution budget', () => {
  it('counts a trigger recorded on the oldest day of its week', async () => {
    // `execution_budget_weekly` is a control on how often Foundry may act on a
    // company's behalf. The ISO bound made the window six days and a bit, so
    // the budget systematically undercounted its own executions.
    const src = stripComments(
      readFileSync('src/services/scp/playbooks/execution-engine.ts', 'utf8'));
    expect(src).toContain("triggered_at > datetime('now', '-7 days')");
    expect(src).not.toMatch(/triggered_at > \?/);

    await query(
      `INSERT INTO execution_playbooks
         (id, product_id, name, trigger_type, trigger_config_json, action_type, action_config_json)
       VALUES ('pb_1', ?, 'a playbook', 'metric_threshold', '{}', 'email', '{}')`,
      [P]);
    await query(
      `INSERT INTO playbook_trigger_log
         (id, playbook_id, product_id, evaluation_result, condition_snapshot_json, triggered_at)
       VALUES ('ptl_1', 'pb_1', ?, 'triggered', '{}', datetime('now', '-7 days', '+1 hour'))`,
      [P]);
    const { getWeeklyExecutionCounts } =
      await import('../../src/services/scp/playbooks/execution-engine.js');
    const counts = await getWeeklyExecutionCounts(P);
    expect(counts.pb_1).toBe(1);
  });
});

describe('the windows that were checked and cleared', () => {
  it('bind date-only strings, which sort correctly against either format', () => {
    const src = stripComments(
      readFileSync('src/services/scp/accuracy/tracker.ts', 'utf8'));
    // 'YYYY-MM-DD' is a prefix of both conventions, so it includes the whole
    // boundary day either way. Recorded so the next reader does not re-derive it.
    expect(src).toMatch(/toISOString\(\)\.slice\(0, 10\)/);
  });
});
