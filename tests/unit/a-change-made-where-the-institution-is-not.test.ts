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
// went wrong.
//
// AND IT PROVES THE CONTRACT, NOT THE ISOLATION. Every property below is a
// property of this institution's own code: material in, artifact out, compared
// rather than trusted, budget refused before spend, cost including teardown,
// teardown occurring, publication never reached, real work correctly refusing
// when no real isolated substrate is available.
//
// The isolation property is a claim about an implementation somewhere else —
// that work really ran on a computer this institution is not, that a real
// provider really billed for it, that a real workspace really came back or
// really went away. The host cannot answer that, because here the work ran
// exactly where it must not. So nothing in this file may be read as the
// isolation being proven, and the record must not say `reality_proven` until a
// real external substrate has said it.
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

describe('the contract, proven in rehearsal — which is not the isolation', () => {
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
    expect(real.because).toContain('SPRITES_TOKEN');
    expect(real.because).toContain('declared, not available');
  });

  it('has not promoted the isolated substrate on the strength of any of this',
    async () => {
      // THE VOCABULARY IS THE POINT. A chain that ran cleanly on the host is
      // easy to describe as the whole thing working. The record must go on
      // saying what is actually true: nothing has run on a real isolated
      // computer, so the substrate that would do it is still a claim about
      // code. `reality_proven` is what this must NOT say.
      const p = (await query(
        `SELECT maturity FROM capability_providers
          WHERE capability_key = 'run_in_workspace' AND provider = 'fly_sprites'`))
        .rows[0] as Record<string, unknown>;
      expect(String(p.maturity)).toBe('declared');

      const claims = (await query(
        `SELECT COUNT(*) AS n FROM capability_maturity_changes c
           JOIN capability_providers p ON p.id = c.provider_id
          WHERE p.provider = 'fly_sprites'
            AND c.to_maturity IN ('reality_proven','reliable')`))
        .rows[0] as Record<string, unknown>;
      expect(Number(claims.n)).toBe(0);
    });

  it('says in its own record what a rehearsal here can and cannot settle', async () => {
    const finding = (await query(
      `SELECT finding FROM substrate_evaluations
        WHERE substrate = 'local_process' AND property = 'what a rehearsal here proves'`))
      .rows[0] as Record<string, unknown>;
    expect(String(finding.finding)).toContain('THE CONTRACT, NOT THE ISOLATION');
    expect(String(finding.finding)).toContain('reality-proven only by a real external');
  });
});
