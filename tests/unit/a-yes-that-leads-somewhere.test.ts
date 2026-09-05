process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { produceSchemaDescription } from '../../src/services/institution/carrying.js';
import {
  acquisitionsAwaiting, decideAcquisition, withdrawAcquisition,
} from '../../src/services/institution/acquisition.js';
import {
  checkTheWorkshop, workshopStanding,
} from '../../src/services/institution/workshop-standing.js';
import { createWorkshop } from '../../src/services/workshop/index.js';

// =============================================================================
// A YES THAT LEADS SOMEWHERE.
//
// A decision that costs money has a life after the tap, and most of it happens
// where this institution cannot see: he takes a plan, issues a key, sets it
// where the deployment reads secrets, comes back. Every one of those can
// half-happen, so the state is READ rather than believed — he should never have
// to tell an application whether the thing he just did worked.
//
// AND AUTHORISED IS NOT CONNECTED IS NOT PROVEN. A plan purchased is money
// spent. A credential accepted means the provider will talk to us. Neither is
// anything having run. The gap between them is exactly where a product would
// like to congratulate itself, and the words the owner sees keep them apart.
// =============================================================================

const OWNER = 'journey_owner';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_journey', 'owner@example.com', 'Owner']);
  // The work runs into the wall, which is what raises the decision at all.
  await produceSchemaDescription({ founderId: OWNER, evidenceMode: 'real' });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SPRITES_TOKEN;
  delete process.env.SPRITE_TOKEN;
});

async function theAsk() {
  const [a] = (await acquisitionsAwaiting(OWNER))
    .filter((x) => x.capabilityKey === 'run_in_workspace');
  return a;
}

describe('before he answers', () => {
  it('says it is waiting, and offers him nothing to configure', async () => {
    const s = await workshopStanding(OWNER);
    expect(s.state).toBe('waiting_on_you');
    expect(s.says).not.toContain('TOKEN');
  });

  it('will not check a connection for a decision that has not been made', async () => {
    const result = await checkTheWorkshop({ founderId: OWNER, by: `founder:${OWNER}` });
    expect(result.reachable).toBe(false);
  });
});

describe('a yes is two grants, not one', () => {
  it('writes the ceiling on metered spend at the same time as the plan', async () => {
    // THE SECOND GRANT IS WHY A YES TO A PLAN IS NOT A YES TO UNLIMITED
    // COMPUTING. Recording only the subscription would make the ceiling a
    // sentence he was shown, which is worse than not showing it at all.
    const ask = await theAsk();
    await decideAcquisition({ id: ask!.id, decision: 'approved', by: `founder:${OWNER}` });
    const ceiling = (await query(
      'SELECT cents_per_month, acquisition_id FROM workshop_spend_ceiling WHERE founder_id = ?',
      [OWNER])).rows[0] as Record<string, unknown>;
    expect(Number(ceiling.cents_per_month)).toBe(500);
    expect(String(ceiling.acquisition_id)).toBe(ask!.id);
  });

  it('stops real work once the month has reached that ceiling', async () => {
    // A limit nothing checks is a sentence, not a limit. This one is read where
    // workspaces are made, because the per-workspace budget resets every time a
    // new workspace is made and would stop nothing.
    await query(
      `INSERT INTO workspaces (id, founder_id, purpose, substrate, ceiling, network,
         budget_cents, spent_cents, evidence_mode, created_by)
       VALUES ('spent_it', ?, 'self_development', 'local_process', 'prepare', 'none',
               1000, 900, 'real', 'test')`, [OWNER]);
    await expect(createWorkshop({
      founderId: OWNER, purpose: 'research', substrate: 'local_process',
      ceiling: 'observe', evidenceMode: 'real', createdBy: 'test',
    })).rejects.toThrow(/reached the ceiling you set/);
  });

  it('leaves rehearsals alone, because they cost him nothing', async () => {
    const w = await createWorkshop({
      founderId: OWNER, purpose: 'reference_scenario', substrate: 'local_process',
      ceiling: 'observe', evidenceMode: 'reference', createdBy: 'test',
    });
    expect(w.substrate).toBe('local_process');
  });
});

describe('after he says yes, and before anything works', () => {
  it('says a step is left at their end rather than claiming it is done', async () => {
    const s = await workshopStanding(OWNER);
    expect(s.state).toBe('authorized');
    expect(s.says).toContain('step left at their end');
    expect(s.next?.href).toBe('/foundry/workshop');
  });

  it('tells the three failures apart, because they need different things of him',
    async () => {
      // Collapsing these into "not connected" is how somebody spends an evening
      // re-doing a step that was already right.
      const nothing = await checkTheWorkshop({ founderId: OWNER, by: `founder:${OWNER}` });
      expect(nothing.reachable).toBe(false);
      expect(nothing.says).toContain('never want the key itself');

      process.env.SPRITES_TOKEN = 'stale';
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 401 }));
      const refused = await checkTheWorkshop({ founderId: OWNER, by: `founder:${OWNER}` });
      expect(refused.reachable).toBe(false);
      expect(refused.says).toContain('refusing it');
      expect(refused.says).toContain('nothing you decided is lost');
    });

  it('does not promote anything on the strength of his decision', async () => {
    const p = (await query(
      `SELECT maturity FROM capability_providers
        WHERE capability_key = 'run_in_workspace' AND provider = 'fly_sprites'`))
      .rows[0] as Record<string, unknown>;
    expect(String(p.maturity)).toBe('declared');
  });
});

describe('when the provider finally answers', () => {
  it('promotes on what the provider said, not on what he did', async () => {
    process.env.SPRITES_TOKEN = 'good';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[]', { status: 200 }));
    const ok = await checkTheWorkshop({ founderId: OWNER, by: `founder:${OWNER}` });
    expect(ok.reachable).toBe(true);

    const change = (await query(
      `SELECT c.to_maturity, c.evidence FROM capability_maturity_changes c
         JOIN capability_providers p ON p.id = c.provider_id
        WHERE p.provider = 'fly_sprites' ORDER BY c.changed_at DESC LIMIT 1`))
      .rows[0] as Record<string, unknown>;
    expect(String(change.to_maturity)).toBe('available');
    expect(String(change.evidence)).toContain('authenticated read reached the provider');
  });

  it('refuses to call answering the phone a proof', async () => {
    // A provider that will talk to us has not run anything. This is the exact
    // point where a product congratulates itself, and it must not.
    const s = await workshopStanding(OWNER);
    expect(s.state).toBe('reachable');
    expect(s.says).toContain('Nothing has run in it yet');

    const claims = (await query(
      `SELECT COUNT(*) AS n FROM capability_maturity_changes c
         JOIN capability_providers p ON p.id = c.provider_id
        WHERE p.provider = 'fly_sprites'
          AND c.to_maturity IN ('reality_proven','reliable')`))
      .rows[0] as Record<string, unknown>;
    expect(Number(claims.n)).toBe(0);
  });
});

describe('and if he changes his mind', () => {
  it('takes the spending ceiling back with the decision', async () => {
    const [held] = (await query(
      `SELECT id FROM capability_acquisitions
        WHERE founder_id = ? AND capability_key = 'run_in_workspace'`, [OWNER]))
      .rows as unknown as Array<Record<string, unknown>>;
    await withdrawAcquisition({
      id: String(held.id), reason: 'stopped from controls', by: `founder:${OWNER}` });

    const left = (await query(
      'SELECT COUNT(*) AS n FROM workshop_spend_ceiling WHERE founder_id = ?',
      [OWNER])).rows[0] as Record<string, unknown>;
    expect(Number(left.n)).toBe(0);

    const s = await workshopStanding(OWNER);
    expect(s.state).toBe('not_needed');
  });
});
