process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  chooseAWorkspace, produceSchemaDescription,
} from '../../src/services/institution/carrying.js';

// =============================================================================
// A CHANGE MADE WHERE THE INSTITUTION IS NOT.
//
// The factory, and only the factory. Material goes in, work happens somewhere
// else, an artifact comes back, and the institution stays outside. Nothing
// publishes: that is a separate hand, deliberately not called, because the
// property worth proving is that
//
//   THE WORKSHOP CAN PRODUCE A CHANGE WITHOUT THE AUTHORITY TO PUBLISH IT.
//
// The rehearsal runs on the host on purpose. That is how the lifecycle earns
// its own reality — files really written, a step really run, cost really
// recorded, teardown really removing it — on work that could not matter if it
// went wrong. The only thing standing between this and the same chain against
// real software is a computer the institution is not on.
// =============================================================================

const OWNER = 'made_owner';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_made', 'owner@example.com', 'Owner']);
});

describe('choosing a computer by what it is, not what it is called', () => {
  it('picks the isolated computer that can run a step, unproven though it is',
    async () => {
      // MATURITY IS EARNED BY THE FIRST ATTEMPT, NOT REQUIRED BEFORE IT.
      // Refusing a substrate for being 'declared' when the work is real is a
      // deadlock: a substrate earns anything better only by carrying real work,
      // so nothing could ever make the first attempt. The institution's own
      // precedent settles it — read_package_registry was declared, was used,
      // and was promoted by what was witnessed.
      const forReal = await chooseAWorkspace(true);
      expect(forReal.substrate).toBe('fly_sprites');
      expect(forReal.because).toContain('isolated');
    });

  it('will carry a rehearsal on the host, which is how the lifecycle proves itself',
    async () => {
      const rehearsal = await chooseAWorkspace(false);
      expect(rehearsal.substrate).toBe('local_process');
      expect(rehearsal.because).toContain('same_host');
    });
});

describe('the chain, proven end to end in rehearsal', () => {
  it('takes material in, runs the work elsewhere, and reads the artifact back',
    async () => {
      const made = await produceSchemaDescription({
        founderId: OWNER, evidenceMode: 'reference' });
      expect(made.substrate).toBe('local_process');
      expect(made.workspaceId).not.toBeNull();
      expect(made.artifact?.verified).toBe(true);
      expect(made.artifact?.because).toContain('what came back begins with what went in');
      // It produced something substantial — this schema is not three lines.
      expect(made.artifact?.bytes ?? 0).toBeGreaterThan(1000);
    }, 60_000);

  it('publishes nothing, and that is a property rather than an outcome', async () => {
    const made = await produceSchemaDescription({
      founderId: OWNER, evidenceMode: 'reference' });
    expect(made.published).toBe(false);
    // No hand was reached for. Nothing was attempted against a repository.
    const acts = (await query(
      `SELECT COUNT(*) AS n FROM act_classifications
        WHERE tool LIKE 'github%'`)).rows[0] as Record<string, unknown>;
    expect(Number(acts.n)).toBe(0);
  }, 60_000);

  it('tears the workspace down whether or not the work succeeded', async () => {
    const made = await produceSchemaDescription({
      founderId: OWNER, evidenceMode: 'reference' });
    const w = (await query(
      'SELECT destroyed_at FROM workspaces WHERE id = ?', [String(made.workspaceId)]))
      .rows[0] as Record<string, unknown>;
    // A workspace left running because a step failed is how an isolation cost
    // becomes a billing one.
    expect(w.destroyed_at).not.toBeNull();
  }, 60_000);

  it('records what it cost from the ledger rather than from its own arithmetic',
    async () => {
      const made = await produceSchemaDescription({
        founderId: OWNER, evidenceMode: 'reference' });
      const w = (await query(
        'SELECT spent_cents FROM workspaces WHERE id = ?', [String(made.workspaceId)]))
        .rows[0] as Record<string, unknown>;
      expect(made.costCents).toBe(Number(w.spent_cents));
    }, 60_000);

  it('stops for real work at the one thing that is actually missing', async () => {
    // Not "no computer is suitable" — a suitable one was chosen. The stop is
    // that it cannot be reached, and the sentence names what would change that.
    // That is the difference between a capability gap and a decision.
    const real = await produceSchemaDescription({
      founderId: OWNER, evidenceMode: 'real' });
    expect(real.substrate).toBe('fly_sprites');
    expect(real.workspaceId).toBeNull();
    expect(real.artifact).toBeNull();
    expect(real.because).toContain('SPRITE_TOKEN');
    expect(real.because).toContain('declared, not available');
  });
});
