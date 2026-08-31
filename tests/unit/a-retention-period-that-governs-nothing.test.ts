process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { runRetentionPolicy } from '../../src/services/maintenance/retention.js';

// =============================================================================
// A FOUNDER SET A RETENTION PERIOD AND IT GOVERNED NOTHING.
//
// The privacy page offers "Data Retention Period — how long Foundry retains
// your product data" and "Agent Log Retention — agent activity logs older than
// this are automatically deleted". Both wrote `data_residency_settings`, both
// were read back by the same page to render the dropdown, and no job ever
// consulted either. The retention sweep ran fixed per-table horizons.
//
// SHORTER IS HONOURED; LONGER IS NOT, and that asymmetry is the point rather
// than a limitation. A company that set this did so to keep LESS — the same
// reasoning already applied to the deployment-wide `DATA_RETENTION_DAYS` cap.
// Keeping data longer than Foundry's own horizon is the question already with
// counsel (`OWNER_DECISIONS_PENDING` §9, §11), and software does not answer a
// legal question by reading a dropdown.
// =============================================================================

const OLD = 120;   // days: older than a 30-day company setting, inside the 180-day platform horizon
const P_SHORT = 'ret_short';
const P_LONG = 'ret_long';
const P_NONE = 'ret_none';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

async function company(id: string, retentionDays: number | null): Promise<void> {
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)`,
    [`f_${id}`, `c_${id}`, `${id}@example.com`]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,'active')`,
    [id, `Co ${id}`, `f_${id}`]);
  if (retentionDays !== null) {
    await query(
      `INSERT INTO data_residency_settings (id, product_id, data_retention_days)
       VALUES (?, ?, ?)`, [`drs_${id}`, id, retentionDays]);
  }
}

beforeAll(async () => {
  await runMigrations();
  await company(P_SHORT, 30);
  await company(P_LONG, 3650);
  await company(P_NONE, null);
});

beforeEach(async () => {
  await query('DELETE FROM audit_log');
  for (const p of [P_SHORT, P_LONG, P_NONE]) {
    await query(
      `INSERT INTO audit_log (id, product_id, action_type, gate, trigger, reasoning, created_at)
       VALUES (?, ?, 'test', 0, 'test', 'a row about this company', ?)`,
      [`al_${p}`, p, daysAgo(OLD)]);
  }
});

const survivors = async (): Promise<string[]> => (await query(
  'SELECT product_id FROM audit_log ORDER BY product_id',
)).rows.map((r) => String((r as Record<string, unknown>).product_id));

describe('a company that asked Foundry to keep less', () => {
  it('has its rows deleted at its own period, not Foundry’s', async () => {
    expect(await survivors()).toEqual([P_LONG, P_NONE, P_SHORT]);
    await runRetentionPolicy();
    expect(await survivors(), 'the 30-day company loses a 120-day-old row')
      .toEqual([P_LONG, P_NONE]);
  });

  it('is reported separately from the platform sweep', async () => {
    const results = await runRetentionPolicy();
    const auditLog = results.find((r) => r.table === 'audit_log');
    expect(auditLog?.deleted_by_company_setting,
      'the setting is observable rather than asserted').toBe(1);
    expect(auditLog?.deleted).toBe(1);
  });
});

describe('a company that asked Foundry to keep more', () => {
  it('does not get more', async () => {
    // 3,650 days is longer than the 180-day platform horizon. The row here is
    // 120 days old so neither horizon has reached it yet — what this asserts is
    // that the company sweep does not SPARE anything, which is the direction
    // that would need counsel rather than a dropdown.
    await runRetentionPolicy();
    expect(await survivors()).toContain(P_LONG);

    await query(`UPDATE audit_log SET created_at = ? WHERE product_id = ?`,
      [daysAgo(400), P_LONG]);
    await runRetentionPolicy();
    expect(await survivors(), 'the platform horizon still applies to it')
      .not.toContain(P_LONG);
  });
});

describe('the financial record', () => {
  it('is not shortened by a company setting', async () => {
    // `ai_cost_log` carries no product_id, and a financial record is also the
    // one place a company's shorter preference should not silently win. Stated
    // in the policy table rather than left to whether a column happens to exist.
    const { POLICY_TABLE_HORIZONS } = await import('../../src/services/maintenance/retention.js');
    expect(POLICY_TABLE_HORIZONS.ai_cost_log).toEqual([]);
    expect(POLICY_TABLE_HORIZONS.audit_log).toContain('data_retention_days');
    expect(POLICY_TABLE_HORIZONS.agent_messages,
      'agent chatter answers to both dropdowns; the shorter one wins')
      .toEqual(['data_retention_days', 'delete_agent_logs_after_days']);
  });
});
