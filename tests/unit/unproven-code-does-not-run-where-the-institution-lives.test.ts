process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { createWorkshop } from '../../src/services/workshop/index.js';
import { whichComputersCouldWork } from '../../src/services/institution/carrying.js';

// =============================================================================
// UNPROVEN CODE DOES NOT RUN WHERE THE INSTITUTION LIVES.
//
// The older rule was about authorship: code Foundry did not write may not run
// on the trusted host. Right instinct, wrong test. A change this institution
// generates for its own software has been run by nobody and verified by
// nothing, and is exactly as capable of destroying the machine it runs on as
// anything a stranger wrote.
//
// The test is the code's STANDING, not its author. And this was not
// hypothetical: `write_code_in_branch` was 'available' through `local_process`,
// whose recorded isolation is `same_host` — a real directory and real commands
// on the machine Foundry itself runs on. The institution believed it could
// build its own next version in its own living room.
// =============================================================================

const OWNER = 'iso_owner';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_iso', 'owner@example.com', 'Owner']);
});

describe('where a real change to software may be produced', () => {
  it('refuses the machine the institution itself runs on', async () => {
    await expect(createWorkshop({
      founderId: OWNER, purpose: 'self_development',
      substrate: 'local_process', ceiling: 'prepare', evidenceMode: 'real',
      createdBy: `founder:${OWNER}`, produces: 'a change to software',
    })).rejects.toThrow(/may not be produced on local_process/);
  });

  it('refuses the substrate that executes nothing, for the opposite reason', async () => {
    await expect(createWorkshop({
      founderId: OWNER, purpose: 'self_development',
      substrate: 'reference_world', ceiling: 'prepare', evidenceMode: 'real',
      createdBy: `founder:${OWNER}`, produces: 'a change to software',
    })).rejects.toThrow();
  });

  it('still allows a rehearsal change on the host, which is how the lifecycle earns its reality',
    async () => {
      const w = await createWorkshop({
        founderId: OWNER, purpose: 'reference_scenario',
        substrate: 'local_process', ceiling: 'prepare', evidenceMode: 'reference',
        createdBy: `founder:${OWNER}`, produces: 'a change to software',
      });
      expect(w.substrate).toBe('local_process');
    });

  it('does not restrict work that is not producing a change', async () => {
    const w = await createWorkshop({
      founderId: OWNER, purpose: 'research',
      substrate: 'local_process', ceiling: 'observe', evidenceMode: 'real',
      createdBy: `founder:${OWNER}`,
    });
    expect(w.substrate).toBe('local_process');
  });

  it('says so constitutionally, and the rule cannot be edited at runtime', async () => {
    const rules = (await query(
      'SELECT isolation, may_produce FROM change_production_isolation ORDER BY isolation'))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(rules.map((r) => `${String(r.isolation)}:${String(r.may_produce)}`))
      .toEqual(['executes_nothing:0', 'isolated:1', 'same_host:0']);
    await expect(query(
      "UPDATE change_production_isolation SET may_produce = 1 WHERE isolation = 'same_host'"))
      .rejects.toThrow(/constitutional/);
  });
});

describe('which computers could actually work', () => {
  it('keeps isolation and adapter as two separate facts', async () => {
    // Confusing them is how a capability comes to be believed available when
    // nothing can run on it. `fly_machines` passes isolation and fails the
    // adapter: its run() throws by design.
    const all = await whichComputersCouldWork();
    const machines = all.find((s) => s.substrate === 'fly_machines');
    expect(machines?.mayProduceChanges).toBe(true);
    expect(machines?.canRunAStep).toBe(false);

    const local = all.find((s) => s.substrate === 'local_process');
    expect(local?.mayProduceChanges).toBe(false);
    expect(local?.canRunAStep).toBe(true);
  });

  it('carries findings with a source, so the evaluation can be checked', async () => {
    const all = await whichComputersCouldWork();
    const sprites = all.find((s) => s.substrate === 'fly_sprites');
    expect(sprites?.findings.length).toBeGreaterThan(4);
    expect(sprites?.findings.every((f) => f.source.length > 0)).toBe(true);
    const net = sprites?.findings.find((f) => f.property === 'network policy');
    expect(net?.finding).toContain('never change it');
  });

  it('keeps the correction, and how it came to be believed, in the record', async () => {
    // This finding once said the property was NOT ADDRESSED. That was true of
    // the pages read and false about the product — a finding recorded as an
    // absence looks like knowledge and is really the shape of where somebody
    // stopped reading. The correction is written into the finding rather than
    // replacing it quietly, because how the institution came to believe
    // something is part of what it knows.
    const all = await whichComputersCouldWork();
    const sprites = all.find((s) => s.substrate === 'fly_sprites');
    const cred = sprites?.findings.find((f) => f.property === 'credential isolation');
    expect(cred?.finding).toContain('ADDRESSED');
    expect(cred?.finding).toContain('previously said otherwise');
    expect(cred?.finding).toContain('never lands in the sandbox');
  });

  it('has closed the missing link in code, and the last gap is an account fact',
    async () => {
      // The chain used to break at the workspace itself: nothing was both
      // isolated enough to produce a change and able to run a step. An adapter
      // now exists, so exactly one substrate carries both — and what remains
      // is not something this repository can write. There is no credential and
      // no plan, which is the owner's decision to make and nobody else's.
      const all = await whichComputersCouldWork();
      const usable = all.filter((s) => s.mayProduceChanges && s.canRunAStep);
      expect(usable.map((s) => s.substrate)).toEqual(['fly_sprites']);

      const sprites = usable[0];
      const runs = sprites.findings.find((f) => f.property === 'can run a step');
      expect(runs?.finding).toContain('never run against the real service');
      expect(sprites.findings.find((f) => f.property === 'plan required')).toBeDefined();
    });
});
