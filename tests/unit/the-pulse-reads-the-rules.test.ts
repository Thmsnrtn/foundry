// =============================================================================
// LAW: THE HOURLY PULSE READS THE INSTITUTION'S OWN RULES BACK, AND SAYS SO.
//
// The twin's monitor checks its rules after every simulated day. Six of them
// need only the database and are cheap, so production reads them too
// (src/services/institution/watched-rules.ts): the pulse finishes its pass,
// then fails with what broke, the way every watched loop says when its work
// failed — and job_health and the Brief carry it. It writes nothing and
// repairs nothing. Each rule's own canary lives with the monitor
// (tests/simulation/invariant-canaries.test.ts); this proves the wiring.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '5'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { JOB_REGISTRY } from '../../src/jobs/index.js';
import { WATCHED_RULES, brokenRules } from '../../src/services/institution/watched-rules.js';

const OWNER = 'rules_owner';
async function withoutGuards(table: string, write: () => Promise<unknown>): Promise<void> {
  const guards = (await query(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?`, [table])).rows as unknown as Array<{ name: string; sql: string }>;
  for (const g of guards) await query(`DROP TRIGGER "${g.name}"`, []);
  try { await write(); } finally { for (const g of guards) await query(g.sql, []); }
}

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_rules', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES ('rules_foundry','Foundry',?,'active')`, [OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry','rules_foundry','the test')`, []);
});

describe('the pulse reads the rules', () => {
  it('a world that keeps every rule passes, and every rule was read', async () => {
    expect(await brokenRules(OWNER)).toEqual([]);
    expect(WATCHED_RULES.map((r) => r.id)).toEqual(['decided-inside-the-charter', 'owner-only-stays-owners', 'the-file-paid-for',
      'refunds-asked-are-made', 'found-nothing-is-not-support', 'thinking-within-the-allowance']);
    await expect(JOB_REGISTRY.institution_pulse_tick!.fn()).resolves.toBeUndefined();
  });

  it('a policy of the owner\'s set by the forge fails the pulse, naming the rule and the row, and nothing is changed', async () => {
    await withoutGuards('origination_policy', () => query(
      `INSERT INTO origination_policy (id, founder_id, requirement, treatment, value, why, set_by) VALUES ('rules_p', ?, 'make_printable_pdf', 'policy', 'yes', 'planted', 'forge')`, [OWNER]));
    await expect(JOB_REGISTRY.institution_pulse_tick!.fn()).rejects.toThrow(/the institution's own rules are broken: owner-only-stays-owners: the owner's policy "make_printable_pdf" was set by forge/);
    expect(((await query(`SELECT set_by FROM origination_policy WHERE id = 'rules_p'`, [])).rows[0] as Record<string, unknown>).set_by).toBe('forge');
  });
});
