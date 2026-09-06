process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { produceSchemaDescription } from '../../src/services/institution/carrying.js';
import {
  acquisitionsAwaiting, decideAcquisition, recordAcquired, withdrawAcquisition,
} from '../../src/services/institution/acquisition.js';
import { createWorkshop } from '../../src/services/workshop/index.js';

// =============================================================================
// A SECRET IS NOT AN AUTHORITY.
//
// The gate on spending the owner's money at a paid provider was the presence of
// an environment variable. He could be shown the card, answer "not yet", and the
// next daily tick would still create a sprite in his account and bill it to his
// plan — because nothing between choosing a computer and calling the provider
// ever read his answer. His own screen told him "you said not yet, so I am
// leaving it" while the work ran.
//
// Every case below is a planted attack on that door, and each one asserts the
// only thing that matters: THE PROVIDER WAS NEVER CALLED. Asserting a refusal
// message would pass against code that refused after creating the sprite.
// =============================================================================

const OWNER = 'gate_owner';
let calls: string[] = [];
let realFetch: typeof fetch;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_gate', 'owner@example.com', 'Owner']);
});

beforeEach(() => {
  calls = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL, init?: { method?: string }) => {
    calls.push(`${init?.method ?? 'GET'} ${String(u)}`);
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  // THE SECRET IS PRESENT IN EVERY ONE OF THESE. That is the point: it must
  // never be what decides.
  process.env.SPRITES_TOKEN = 'a-real-looking-token';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.SPRITES_TOKEN;
});

const spriteCalls = (): string[] => calls.filter((c) => c.includes('sprites.dev'));

describe('the owner decision is the gate, and the secret is not', () => {
  it('makes no provider call at all when he has not answered', async () => {
    const made = await produceSchemaDescription({ founderId: OWNER, evidenceMode: 'real' });
    expect(spriteCalls()).toEqual([]);
    expect(made.workspaceId).toBeNull();
    expect(made.because).toContain('nothing you have decided authorises');
  });

  it('asks him, because a refusal for want of an answer he was never asked for '
    + 'would otherwise deadlock', async () => {
    // The approval gate sits in front of the credential refusal that used to
    // raise the card. If only the credential raised it he could never approve,
    // because he would never be asked.
    const open = (await acquisitionsAwaiting(OWNER))
      .filter((a) => a.capabilityKey === 'run_in_workspace');
    expect(open).toHaveLength(1);
  });

  it('makes no provider call when he said not yet', async () => {
    const [ask] = (await acquisitionsAwaiting(OWNER))
      .filter((a) => a.capabilityKey === 'run_in_workspace');
    await decideAcquisition({ id: ask!.id, decision: 'declined', by: `founder:${OWNER}` });

    const made = await produceSchemaDescription({ founderId: OWNER, evidenceMode: 'real' });
    expect(spriteCalls()).toEqual([]);
    expect(made.because).toContain('you said not yet');
    // AND HIS ANSWER STAYS ANSWERED. A refusal must not re-raise the card he
    // just declined.
    expect((await acquisitionsAwaiting(OWNER))
      .filter((a) => a.capabilityKey === 'run_in_workspace')).toEqual([]);
  });

  it('makes no provider call after he takes an approval back', async () => {
    const TAKER = 'took_it_back';
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
      [TAKER, 'clerk_taker', 'taker@example.com', 'Taker']);
    await produceSchemaDescription({ founderId: TAKER, evidenceMode: 'real' });
    const [ask] = (await acquisitionsAwaiting(TAKER))
      .filter((a) => a.capabilityKey === 'run_in_workspace');
    await decideAcquisition({ id: ask!.id, decision: 'approved', by: `founder:${TAKER}` });
    await recordAcquired({ id: ask!.id, evidence: 'the plan was taken',
      witnessedBy: `founder:${TAKER}` });
    await withdrawAcquisition({ id: ask!.id, reason: 'stopped it',
      by: `founder:${TAKER}` });

    calls = [];
    const made = await produceSchemaDescription({ founderId: TAKER, evidenceMode: 'real' });
    expect(spriteCalls()).toEqual([]);
    expect(made.workspaceId).toBeNull();
    expect(made.because).toMatch(/took back the workshop|no computer is both/);
  });
});

describe('a bound that can actually stop the work', () => {
  const SPENDER = 'ceiling_owner';

  beforeAll(async () => {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
      [SPENDER, 'clerk_ceiling', 'spend@example.com', 'Spender']);
    const { proposeAcquisition } = await import(
      '../../src/services/institution/acquisition.js');
    const id = await proposeAcquisition({
      founderId: SPENDER, capabilityKey: 'run_in_workspace', route: 'procure',
      provider: 'fly_sprites', how: 'workspace', costNote: '$20 a month',
      because: 'the work needs it', proposedBy: 'test',
      economics: [{ kind: 'variable_usage', label: 'Anything beyond the plan',
        amountCents: 40, period: 'month', note: 'I stop at 40 cents a month' }],
    });
    await decideAcquisition({ id, decision: 'approved', by: `founder:${SPENDER}` });
  });

  it('counts a workshop it cannot meter exactly by what it was allowed to spend',
    async () => {
      // RESERVATION, NOT REPORTED ZERO. The adapters returned zero for every
      // call, so the sum the ceiling compares against never moved and a
      // thousand sprites passed a ceiling that said twenty.
      for (let i = 0; i < 2; i += 1) {
        await createWorkshop({
          founderId: SPENDER, purpose: 'self_development', substrate: 'fly_sprites',
          ceiling: 'prepare', network: 'open', evidenceMode: 'real', budgetCents: 25,
          createdBy: 'test', produces: 'a change to software' });
      }
      const spent = (await query(
        `SELECT COALESCE(SUM(MAX(spent_cents, budget_cents)), 0) AS n FROM workspaces
          WHERE founder_id = ? AND evidence_mode = 'real'`, [SPENDER]))
        .rows[0] as Record<string, unknown>;
      expect(Number(spent.n)).toBeGreaterThanOrEqual(50);
    });

  it('refuses the next one BEFORE the provider is called', async () => {
    calls = [];
    await expect(createWorkshop({
      founderId: SPENDER, purpose: 'self_development', substrate: 'fly_sprites',
      ceiling: 'prepare', network: 'open', evidenceMode: 'real', budgetCents: 25,
      createdBy: 'test', produces: 'a change to software' }))
      .rejects.toThrow(/reached the ceiling you set/);
    // BEFORE, not after. A refusal that arrives after the sprite exists has
    // already spent the money it was meant to protect.
    expect(spriteCalls()).toEqual([]);
  });

  it('leaves no live workshop behind when the provider refuses', async () => {
    // Every tick without a credential used to leave another 'real' workspace
    // pointing at nothing, alive forever, counting against the ceiling for work
    // that never happened.
    delete process.env.SPRITES_TOKEN;
    const before = (await query(
      `SELECT COUNT(*) AS n FROM workspaces WHERE destroyed_at IS NULL`))
      .rows[0] as Record<string, unknown>;
    await expect(createWorkshop({
      founderId: OWNER, purpose: 'self_development', substrate: 'fly_sprites',
      ceiling: 'prepare', network: 'open', evidenceMode: 'reference',
      createdBy: 'test', produces: 'a change to software' })).rejects.toThrow();
    const after = (await query(
      `SELECT COUNT(*) AS n FROM workspaces WHERE destroyed_at IS NULL`))
      .rows[0] as Record<string, unknown>;
    expect(Number(after.n)).toBe(Number(before.n));
  });
});

describe('the record may not claim more isolation than the provider enforces', () => {
  it('refuses a network it cannot apply rather than recording one it did not', async () => {
    await expect(createWorkshop({
      founderId: OWNER, purpose: 'self_development', substrate: 'fly_sprites',
      ceiling: 'prepare', network: 'none', evidenceMode: 'reference',
      createdBy: 'test', produces: 'a change to software' }))
      .rejects.toThrow(/recorded as restricted and run unrestricted/);
    expect(spriteCalls()).toEqual([]);
  });

  it('says in its own record why it refuses, so the refusal can be checked', async () => {
    const found = (await query(
      `SELECT finding FROM substrate_evaluations
        WHERE substrate = 'fly_sprites' AND property = 'network at creation'`))
      .rows[0] as Record<string, unknown>;
    expect(String(found.finding)).toContain('DEFAULT EGRESS');
  });
});
