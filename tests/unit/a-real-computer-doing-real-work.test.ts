process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  checkpoint, createWorkshop, destroy, grant, history, read, restore, run,
} from '../../src/services/workshop/index.js';
import { workshopDirectoryExists } from '../../src/services/workshop/local-process.js';

// =============================================================================
// A REAL COMPUTER DOING REAL WORK.
//
// The lifecycle had been proven against an in-process map, which proves the
// bookkeeping and nothing about running code. This is the same governed
// lifecycle against a real directory and real child processes:
//
//   real workspace → real capability → real non-consequential work →
//   verified output → an actual cost receipt → safe teardown and recovery.
//
// AND AN HONEST ACCOUNT OF WHICH COMPUTER. It runs on the machine Foundry runs
// on, so the database refuses to put generated venture work here, the
// environment is built from nothing rather than filtered, paths cannot leave
// the directory, and there is no command that reaches the world.
// =============================================================================

const OWNER = 'real_owner';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_real', 'owner@example.com', 'Owner']);
});

async function workshop(purpose: 'self_development' | 'venture_development' = 'self_development') {
  return createWorkshop({
    founderId: OWNER, purpose, ceiling: 'prepare', budgetCents: 500,
    substrate: 'local_process', createdBy: 'foundry', evidenceMode: 'reference' });
}

describe('a substrate that runs on our own host', () => {
  it('refuses to be given code Foundry did not write', async () => {
    // Migration 246, structural rather than a promise in a comment.
    await expect(workshop('venture_development'))
      .rejects.toThrow(/untrusted_code_needs_isolation/);
  });

  it('takes work the institution authored', async () => {
    const w = await workshop();
    expect(w.substrate).toBe('local_process');
    expect(w.externalRef).not.toBeNull();
    expect(workshopDirectoryExists(w.externalRef ?? '')).toBe(true);
  });
});

describe('real work, and output that is verified rather than reported', () => {
  it('writes a real file, runs a real program, and the answer is checked', async () => {
    const w = await workshop();
    await grant({ workshopId: w.id, capabilityKey: 'write_code_in_branch', grantedBy: 'foundry' });
    await grant({ workshopId: w.id, capabilityKey: 'run_tests', grantedBy: 'foundry' });

    const wrote = await run({ workshopId: w.id,
      step: 'use:write_code_in_branch write add.mjs export const add = (a, b) => a + b;' });
    expect(wrote.ok).toBe(true);

    const ran = await run({ workshopId: w.id,
      step: 'use:run_tests node --input-type=module -e '
        + '"import {add} from \'./add.mjs\'; if (add(2,2)!==4) process.exit(1); console.log(\'four\')"' });
    // THE OUTPUT IS THE PROOF. Not "the step succeeded" — the program ran, and
    // it said the thing only a working program says.
    expect(ran.ok).toBe(true);
    expect(ran.output).toContain('four');

    // And a real failure is a real failure, not a swallowed one.
    const failed = await run({ workshopId: w.id,
      step: 'use:run_tests node -e "process.exit(3)"' });
    expect(failed.ok).toBe(false);
  });

  it('refuses a capability it was not granted, before running anything', async () => {
    const w = await workshop();
    const refused = await run({ workshopId: w.id, step: 'use:run_tests node -e "console.log(1)"' });
    expect(refused.ok).toBe(false);
    expect(refused.output).toContain('not granted');
  });

  it('has no command that reaches the world', async () => {
    const w = await workshop();
    await grant({ workshopId: w.id, capabilityKey: 'run_shell', grantedBy: 'foundry' });
    for (const command of ['curl https://example.com', 'wget https://example.com',
      'ssh somewhere', 'git push']) {
      const out = await run({ workshopId: w.id, step: `use:run_shell ${command}` });
      expect(out.ok, command).toBe(false);
      expect(out.output).toContain('not something a workshop may run');
    }
  });

  it('cannot write outside its own directory', async () => {
    const w = await workshop();
    await grant({ workshopId: w.id, capabilityKey: 'write_code_in_branch', grantedBy: 'foundry' });
    await expect(run({ workshopId: w.id,
      step: 'use:write_code_in_branch write ../../escaped.txt nope' }))
      .rejects.toThrow(/outside the workshop/);
  });

  it('does not hand over the institution\'s secrets', async () => {
    const w = await workshop();
    await grant({ workshopId: w.id, capabilityKey: 'run_shell', grantedBy: 'foundry' });
    const out = await run({ workshopId: w.id,
      step: 'use:run_shell node -e "console.log(JSON.stringify(process.env))"' });
    expect(out.ok).toBe(true);
    // Built from nothing rather than filtered down, so what is absent is
    // absent because it was never put there.
    expect(out.output).not.toContain('ENCRYPTION_KEY');
    expect(out.output).not.toContain('TURSO_DATABASE_URL');
    expect(out.output).toContain('FOUNDRY_WORKSHOP');
  });
});

describe('an actual cost receipt', () => {
  it('charges what the work took, and the record says what it was', async () => {
    const w = await workshop();
    await grant({ workshopId: w.id, capabilityKey: 'run_tests', grantedBy: 'foundry' });
    await run({ workshopId: w.id, step: 'use:run_tests node -e "console.log(1)"' });
    const after = await read(w.id);
    expect(after.spentCents).toBeGreaterThan(0);
    const events = await history(w.id);
    const ran = events.find((e) => e.kind === 'ran');
    expect(ran?.costCents).toBeGreaterThan(0);
    expect(ran?.detail).toContain('node');
  });
});

describe('checkpoint, recovery and teardown', () => {
  it('really restores the directory it really copied', async () => {
    const w = await workshop();
    await grant({ workshopId: w.id, capabilityKey: 'write_code_in_branch', grantedBy: 'foundry' });
    await grant({ workshopId: w.id, capabilityKey: 'run_shell', grantedBy: 'foundry' });
    await run({ workshopId: w.id, step: 'use:write_code_in_branch write kept.txt first' });
    await checkpoint({ workshopId: w.id, label: 'before' });
    await run({ workshopId: w.id, step: 'use:write_code_in_branch write kept.txt second' });

    const changed = await run({ workshopId: w.id, step: 'use:run_shell read kept.txt' });
    expect(changed.output).toContain('second');
    await restore({ workshopId: w.id, checkpointRef: 'before' });
    const back = await run({ workshopId: w.id, step: 'use:run_shell read kept.txt' });
    expect(back.output).toContain('first');
  });

  it('leaves nothing on disk, and keeps what mattered', async () => {
    const w = await workshop();
    const dir = w.externalRef ?? '';
    await grant({ workshopId: w.id, capabilityKey: 'write_code_in_branch', grantedBy: 'foundry' });
    await run({ workshopId: w.id, step: 'use:write_code_in_branch write out.txt something' });
    expect(workshopDirectoryExists(dir)).toBe(true);

    await destroy({ workshopId: w.id, preserved: 'out.txt said something' });
    expect(workshopDirectoryExists(dir)).toBe(false);
    const gone = await read(w.id);
    expect(gone.destroyed).toBe(true);
    const events = await history(w.id);
    expect(events.at(-1)?.detail).toContain('out.txt said something');
  });
});
