process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  checkpoint, createWorkshop, destroy, grant, history, read, restore, run, sleep, wake,
} from '../../src/services/workshop/index.js';
import { referenceFiles } from '../../src/services/workshop/reference.js';
import { flyMachinesWorkshop } from '../../src/services/workshop/fly-machines.js';

// =============================================================================
// COMPUTERS ARE WORKSHOPS, NOT AUTHORITIES.
//
// No execution environment may possess more consequential authority than the
// task that created it. The ceiling is set at creation and immutable, every
// grant is checked against it by the database, the workshop never holds a
// secret, and a step that reaches past its grants is refused and recorded.
// The whole lifecycle is proven here on the in-process substrate; the real
// one is declared and refuses without a token.
// =============================================================================

const OWNER = 'ws_owner';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_ws', 'owner@example.com', 'Owner']);
});

describe('a workshop under a ceiling', () => {
  it('is created for a purpose, with a ceiling the owner\'s rungs can never be', async () => {
    await expect(query(
      `INSERT INTO workspaces (id, founder_id, purpose, substrate, ceiling, network, evidence_mode, created_by)
       VALUES ('ws_bad', ?, 'venture_development', 'reference_world', 'legal', 'none', 'reference', 'foundry')`,
      [OWNER])).rejects.toThrow(/ceiling_is_the_owners/);
    const w = await createWorkshop({
      founderId: OWNER, purpose: 'venture_development', ceiling: 'prepare',
      budgetCents: 10, substrate: 'reference_world', createdBy: 'foundry',
      evidenceMode: 'reference' });
    expect(w.ceiling).toBe('prepare');
    expect(w.externalRef).not.toBeNull();
  });

  it('refuses a grant above the ceiling, and records the refusal', async () => {
    const w = (await query("SELECT id FROM workspaces WHERE founder_id = ? LIMIT 1", [OWNER]))
      .rows[0] as Record<string, unknown>;
    const ok = await grant({ workshopId: String(w.id), capabilityKey: 'write_code_in_branch',
      grantedBy: 'foundry' });
    expect(ok.granted).toBe(true);
    // send_email is public; the ceiling is prepare. A workshop authorised to
    // build a prototype does not get a customer's inbox, from anybody.
    const no = await grant({ workshopId: String(w.id), capabilityKey: 'send_email',
      grantedBy: `founder:${OWNER}` });
    expect(no.granted).toBe(false);
    expect(no.because).toContain('more consequential than this workshop was made for');
    expect(no.because).toContain('a proposal to you');
    const events = await history(String(w.id));
    expect(events.some((e) => e.kind === 'refused' && e.detail.includes('send_email'))).toBe(true);
  });

  it('cannot have its ceiling raised afterwards', async () => {
    const w = (await query("SELECT id FROM workspaces WHERE founder_id = ? LIMIT 1", [OWNER]))
      .rows[0] as Record<string, unknown>;
    await expect(query("UPDATE workspaces SET ceiling = 'public' WHERE id = ?", [String(w.id)]))
      .rejects.toThrow(/ceiling_is_immutable/);
  });
});

describe('work inside it', () => {
  it('refuses a step that uses what it was not granted', async () => {
    const w = (await query("SELECT id FROM workspaces WHERE founder_id = ? LIMIT 1", [OWNER]))
      .rows[0] as Record<string, unknown>;
    const refused = await run({ workshopId: String(w.id), step: 'use:send_email write out.txt hello' });
    expect(refused.ok).toBe(false);
    expect(refused.output).toContain('not granted');
    const fine = await run({ workshopId: String(w.id), step: 'use:write_code_in_branch write src/a.ts export const a = 1' });
    expect(fine.ok).toBe(true);
  });

  it('checkpoints and restores, sleeps and wakes, and accounts for every step', async () => {
    const w = await read(String(((await query(
      "SELECT id FROM workspaces WHERE founder_id = ? LIMIT 1", [OWNER])).rows[0] as Record<string, unknown>).id));
    const ref = w.externalRef ?? '';
    await checkpoint({ workshopId: w.id, label: 'before' });
    await run({ workshopId: w.id, step: 'write src/a.ts export const a = 2' });
    expect(referenceFiles(ref).get('src/a.ts')).toBe('export const a = 2');
    await restore({ workshopId: w.id, checkpointRef: 'before' });
    expect(referenceFiles(ref).get('src/a.ts')).toBe('export const a = 1');
    await sleep(w.id);
    expect((await read(w.id)).asleep).toBe(true);
    await expect(run({ workshopId: w.id, step: 'write x y' })).rejects.toThrow(/asleep/);
    await wake(w.id);
    const after = await read(w.id);
    expect(after.asleep).toBe(false);
    expect(after.spentCents).toBeGreaterThan(0);
  });

  it('stops when the budget is spent', async () => {
    const w = await read(String(((await query(
      "SELECT id FROM workspaces WHERE founder_id = ? LIMIT 1", [OWNER])).rows[0] as Record<string, unknown>).id));
    for (let i = 0; i < 12; i += 1) {
      const r = await run({ workshopId: w.id, step: `write f${String(i)} x` });
      if (!r.ok) { expect(r.output).toContain('budget'); return; }
    }
    throw new Error('the budget never ran out');
  });

  it('is destroyed only with a record of what was kept', async () => {
    const w = await read(String(((await query(
      "SELECT id FROM workspaces WHERE founder_id = ? LIMIT 1", [OWNER])).rows[0] as Record<string, unknown>).id));
    await expect(query("UPDATE workspaces SET destroyed_at = datetime('now') WHERE id = ?", [w.id]))
      .rejects.toThrow(/destroy_without_preserving/);
    await destroy({ workshopId: w.id, preserved: 'src/a.ts and the test results' });
    expect((await read(w.id)).destroyed).toBe(true);
    // And nothing more can be granted into it.
    const no = await grant({ workshopId: w.id, capabilityKey: 'run_tests', grantedBy: 'foundry' });
    expect(no.granted).toBe(false);
  });
});

describe('the real substrate', () => {
  it('is declared, refuses without a token, and never pretends', async () => {
    delete process.env.FLY_API_TOKEN;
    await expect(flyMachinesWorkshop.create({
      purpose: 'venture_development', ceiling: 'prepare', network: 'none', budgetCents: 0, tooling: [] }))
      .rejects.toThrow(/declared, not available/);
    await expect(createWorkshop({
      founderId: OWNER, purpose: 'venture_development', ceiling: 'prepare',
      substrate: 'fly_machines', createdBy: 'foundry', evidenceMode: 'reference' }))
      .rejects.toThrow(/reference substrate is for reference work/);
  });
});
