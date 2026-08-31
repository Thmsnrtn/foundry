process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { evaluateConditions, PROMPT_ORDER, promptIndex } from '../../src/services/lifecycle/monitor.js';
import { lifecycleBandForPrompt } from '../../src/services/benchmarking/pool.js';

// =============================================================================
// A LIFECYCLE THAT NEVER ADVANCED.
//
// `current_prompt` was written once — by the INSERT that creates the row — and
// never again. `evaluateConditions` computed which phases had all their
// conditions met, wrote an audit-log line saying so, and returned the list; the
// daily job logged it and moved on. So every company that has ever run sat at
// `prompt_1` for as long as it existed, and:
//
//   the Lifecycle page told a company operating for months to "Run your first
//   audit", with all nine phases drawn as not started;
//   the weekly digest reported that stage to the founder;
//   the Compass agent was told it in its prompt;
//   and `lifecycleBandForPrompt` banded EVERY company as `pre_revenue`, so the
//   cross-company benchmark pool compared a scaled company against companies
//   with no revenue and called them a segment.
//
// The mechanism existed and was not connected.
// =============================================================================

const P = 'p_life';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_life','c_life','life@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status, created_at) VALUES (?,'Acme','f_life','active', datetime('now','-400 days'))", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM lifecycle_state');
  await query('DELETE FROM lifecycle_conditions');
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM audit_log');
  await query("INSERT INTO lifecycle_state (product_id, current_prompt, risk_state) VALUES (?, 'prompt_1', 'green')", [P]);
});

describe('the order of the phases', () => {
  it('puts Remediation after Hypothesis Formation', () => {
    // `parseInt('2_5')` is 2, so both sat at position 2 and the page drew a
    // completed phase as not started.
    expect(promptIndex('prompt_2_5')).toBeGreaterThan(promptIndex('prompt_2'));
    expect(promptIndex('prompt_3')).toBeGreaterThan(promptIndex('prompt_2_5'));
    expect(PROMPT_ORDER).toHaveLength(10);
  });

  it('says it does not recognise a value it does not define', () => {
    expect(promptIndex('prompt_42')).toBe(-1);
    expect(promptIndex(null)).toBe(-1);
  });
});

describe('a company whose conditions are met', () => {
  it('advances, instead of logging that it could have', async () => {
    // prompt_4: live 14+ days (the product is 400 days old) and 50+ signups.
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, signups_7d)
       VALUES ('ms_1', ?, date('now','-3 days'), 60)`, [P]);

    const activated = await evaluateConditions(P);
    expect(activated).toContain('prompt_4');

    const ls = (await query('SELECT current_prompt, prompt_4_status FROM lifecycle_state WHERE product_id=?', [P]))
      .rows[0] as unknown as Record<string, unknown>;
    expect(ls.current_prompt).toBe('prompt_4');
    expect(ls.prompt_4_status).toBe('in_progress');
  });

  it('is banded by where it actually is', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, signups_7d)
       VALUES ('ms_1', ?, date('now','-3 days'), 60)`, [P]);
    await evaluateConditions(P);
    const ls = (await query('SELECT current_prompt FROM lifecycle_state WHERE product_id=?', [P]))
      .rows[0] as unknown as Record<string, unknown>;
    expect(lifecycleBandForPrompt(String(ls.current_prompt))).toBe('early');
    // Every company used to band here, whatever it had done.
    expect(lifecycleBandForPrompt('prompt_1')).toBe('pre_revenue');
  });

  it('records the advance where a founder can read it', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, signups_7d)
       VALUES ('ms_1', ?, date('now','-3 days'), 60)`, [P]);
    await evaluateConditions(P);
    const rows = (await query(
      "SELECT action_type, reasoning FROM audit_log WHERE product_id=? AND action_type='lifecycle_advanced'",
      [P])).rows as unknown as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(String(rows[0].reasoning)).toContain('prompt_1');
    expect(String(rows[0].reasoning)).toContain('prompt_4');
  });
});

describe('a company whose conditions are not met', () => {
  it('stays where it is', async () => {
    const activated = await evaluateConditions(P);
    expect(activated).toEqual([]);
    const ls = (await query('SELECT current_prompt FROM lifecycle_state WHERE product_id=?', [P]))
      .rows[0] as unknown as Record<string, unknown>;
    expect(ls.current_prompt).toBe('prompt_1');
  });
});

describe('a company that has already advanced', () => {
  it('does not move backwards when a condition stops being true', async () => {
    await query("UPDATE lifecycle_state SET current_prompt='prompt_6' WHERE product_id=?", [P]);
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, signups_7d)
       VALUES ('ms_1', ?, date('now','-3 days'), 60)`, [P]);

    await evaluateConditions(P);
    const ls = (await query('SELECT current_prompt FROM lifecycle_state WHERE product_id=?', [P]))
      .rows[0] as unknown as Record<string, unknown>;
    expect(ls.current_prompt, 'a met condition for an earlier phase must not pull it back').toBe('prompt_6');
  });

  it('and does not re-announce a phase it already reached', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, signups_7d)
       VALUES ('ms_1', ?, date('now','-3 days'), 60)`, [P]);
    const first = await evaluateConditions(P);
    expect(first).toContain('prompt_4');
    const second = await evaluateConditions(P);
    expect(second).not.toContain('prompt_4');
  });
});
