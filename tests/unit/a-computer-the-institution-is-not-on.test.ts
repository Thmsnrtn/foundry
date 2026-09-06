process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { flySpritesWorkshop } from '../../src/services/workshop/fly-sprites.js';

// =============================================================================
// A COMPUTER THE INSTITUTION IS NOT ON.
//
// The first substrate that could carry a real change to Foundry's own software.
// `local_process` runs where the institution lives and is refused for it;
// `fly_machines` is isolated and its run() throws by design because the exec
// semantics were never settled. Sprites publish an exec endpoint, which is the
// whole difference.
//
// WHAT IS TESTED HERE is the adapter's discipline, not Fly's API. No network
// call is made. The properties that matter are the ones the institution is
// responsible for: it refuses without a credential, it never puts a reusable
// secret inside the sandbox, it checks the capability grant before the computer
// sees the step, and it refuses the operations whose contract has not been read
// rather than guessing a URL for them.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
afterEach(() => { delete process.env.SPRITE_TOKEN; vi.restoreAllMocks(); });

describe('what it will not do', () => {
  it('refuses without a credential, and says it is declared rather than available',
    async () => {
      await expect(flySpritesWorkshop.create({
        purpose: 'self_development', ceiling: 'prepare', network: 'none',
        budgetCents: 0, tooling: [] }))
        .rejects.toThrow(/declared, not available/);
    });

  it('refuses every network it cannot actually apply, not only the allowlist',
    async () => {
      process.env.SPRITES_TOKEN = 'test-token';
      // 'none' USED TO BE ACCEPTED SILENTLY. No policy was applied, the sprite
      // got its vendor's default egress, and the ledger recorded a workspace
      // with no network — then ran generated code on it. A claim of restriction
      // the world does not honour is worse than no claim, because everything
      // downstream trusts the record instead of the world.
      for (const network of ['none', 'allowlist'] as const) {
        await expect(flySpritesWorkshop.create({
          purpose: 'self_development', ceiling: 'prepare', network,
          budgetCents: 0, tooling: [] }))
          .rejects.toThrow(/would be recorded as restricted and run unrestricted/);
      }
      delete process.env.SPRITES_TOKEN;
    });

  it('charges for the time it was active, so a bound can actually bind', async () => {
    // ZERO WAS THE MOST FLATTERING LIE THIS ADAPTER COULD TELL. spent_cents
    // never moved, so the per-workshop budget could not trip and the owner's
    // monthly ceiling could not be reached. Estimated rather than metered, with
    // a floor: work that takes a moment must still cost something, or a fast
    // runaway is free.
    process.env.SPRITES_TOKEN = 'test-token';
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string | URL, init?: { method?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${String(u)}`);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const made = await flySpritesWorkshop.create({
        purpose: 'self_development', ceiling: 'prepare', network: 'open',
        budgetCents: 0, tooling: [] });
      expect(made.costCents).toBeGreaterThanOrEqual(1);
      const gone = await flySpritesWorkshop.destroy(made.externalRef);
      expect(gone.costCents).toBeGreaterThanOrEqual(1);
      expect(calls.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.SPRITES_TOKEN;
    }
  });

  it('refuses checkpoint and restore rather than guessing their endpoints', async () => {
    // Guessing a path for an operation whose job is to contain damage is the
    // exact failure this substrate exists to prevent.
    await expect(flySpritesWorkshop.checkpoint('x', 'before'))
      .rejects.toThrow(/has not been read/);
    await expect(flySpritesWorkshop.restore('x', 'y'))
      .rejects.toThrow(/has not been read/);
  });
});

describe('the grant is checked before the computer sees the step', () => {
  it('refuses a step naming a capability the workshop was not granted', async () => {
    process.env.SPRITE_TOKEN = 'test-token';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await flySpritesWorkshop.run('sprite-1',
      'use:send_email node send.js', ['read_repository']);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('send_email was not granted');
    // AND IT NEVER REACHED THE COMPUTER. The check belongs to the institution,
    // not to whichever substrate happens to be carrying the work.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an empty step instead of sending an argument-less exec', async () => {
    process.env.SPRITE_TOKEN = 'test-token';
    const result = await flySpritesWorkshop.run('sprite-1', '   ', []);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('nothing to run');
  });
});

describe('what it sends, when it does send', () => {
  it('sends what the vendor publishes, not what would be nicer to send',
    async () => {
      // THIS TEST USED TO ASSERT THE WRONG API. It checked for a repeated `cmd`
      // query parameter per argument, on the reasoning that an argv cannot be
      // split apart by a filename with a space in it — good reasoning about an
      // API this is not. The published shape is a single `command` string in
      // the body, and a test written from the same assumption as the code is
      // not a check on it.
      process.env.SPRITES_TOKEN = 'test-token';
      let asked = '';
      let sent = '';
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
        asked = String(url);
        sent = String(init?.body ?? '');
        return new Response('ok', { status: 200 });
      });
      await flySpritesWorkshop.run('sprite-1', 'node -e "print two words"', []);
      expect(asked).toBe('https://api.sprites.dev/v1/sprites/sprite-1/exec');
      expect(asked).not.toContain('?');
      expect(JSON.parse(sent)).toEqual({ command: 'node -e "print two words"' });
    });

  it('creates by name with a PUT, which is also not what it first did', async () => {
    process.env.SPRITES_TOKEN = 'test-token';
    let asked = '';
    let method = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      asked = String(url);
      method = String(init?.method ?? '');
      return new Response('{}', { status: 200 });
    });
    const made = await flySpritesWorkshop.create({ purpose: 'self_development',
      ceiling: 'prepare', network: 'open', budgetCents: 0, tooling: [] });
    expect(method).toBe('PUT');
    expect(asked).toBe(`https://api.sprites.dev/v1/sprites/${made.externalRef}`);
  });

  it('reads the credential under the name the vendor uses for it', async () => {
    // A near-miss on a secret's name costs somebody an afternoon for no reason.
    delete process.env.SPRITES_TOKEN;
    delete process.env.SPRITE_TOKEN;
    await expect(flySpritesWorkshop.create({ purpose: 'self_development',
      ceiling: 'prepare', network: 'open', budgetCents: 0, tooling: [] }))
      .rejects.toThrow(/SPRITES_TOKEN/);
  });

  it('never puts a reusable secret inside the sandbox', async () => {
    process.env.SPRITE_TOKEN = 'test-token';
    let sentBody = '';
    let sentHeaders: Record<string, string> = {};
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u: any, init: any) => {
      sentBody = String(init?.body ?? '');
      sentHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify({ name: 'x' }), { status: 200 });
    });
    await flySpritesWorkshop.create({ purpose: 'self_development',
      ceiling: 'prepare', network: 'open', budgetCents: 0, tooling: [] });

    // The token authenticates FOUNDRY to the provider. It is never handed to
    // the computer as configuration, and neither is anything else reusable.
    // The vendor pages do not describe credential isolation; this adapter does
    // not need them to, because it puts no credential inside.
    expect(sentHeaders.authorization).toContain('test-token');
    expect(sentBody).not.toContain('test-token');
    expect(sentBody.toLowerCase()).not.toContain('env');
    expect(sentBody.toLowerCase()).not.toContain('secret');
  });
});

describe('the capability vocabulary knows the difference', () => {
  it('separates having a computer from running work in one', async () => {
    const both = ((await query(
      `SELECT capability_key FROM capabilities
        WHERE capability_key IN ('create_workspace','run_in_workspace')
        ORDER BY capability_key`)).rows as unknown as Array<Record<string, unknown>>)
      .map((r) => String(r.capability_key));
    expect(both).toEqual(['create_workspace', 'run_in_workspace']);
  });

  it('carries a change to software through the workspace, not through the host',
    async () => {
      // The mechanism that keeps a substrate's vocabulary out of the
      // capabilities above it: `write_code_in_branch` does not know what a
      // sprite is, and must not learn.
      const route = (await query(
        `SELECT through_capability, why FROM capability_fulfilled_through
          WHERE capability_key = 'write_code_in_branch'`))
        .rows[0] as Record<string, unknown>;
      expect(String(route.through_capability)).toBe('run_in_workspace');
      expect(String(route.why)).toContain('somewhere the institution is not');
    });

  it('refuses a fulfilment route that loops back on itself', async () => {
    await expect(query(
      `INSERT INTO capability_fulfilled_through (capability_key, through_capability, why)
       VALUES ('run_in_workspace','write_code_in_branch','convenient')`))
      .rejects.toThrow(/circular/);
  });
});
