process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { produceSchemaDescription } from '../../src/services/institution/carrying.js';
import {
  acquisitionsAwaiting, acquisitionsHeld, decideAcquisition, recordAcquired,
  withdrawAcquisition,
} from '../../src/services/institution/acquisition.js';

// =============================================================================
// THE ONE DECISION THE WORK RAN INTO.
//
// A card the owner is asked to answer is only legitimate when a YES makes
// something possible. Everything on either side of a workspace now exists —
// the isolation rule, the substrate evaluation, the adapter, the lifecycle, the
// verification, the teardown, the receipt — and the chain stops at one thing
// this repository cannot write: an account.
//
// So the card is RAISED BY THE WORK HITTING THE WALL, not written into a
// migration in advance. A card manufactured before anything could use it asks
// the owner to fund a hope; a card raised by real work arrives with the
// responsibility that needed it attached, and disappears on its own if the
// responsibility ever stops needing it.
//
// AND IT IS PHRASED AS THE RESPONSIBILITY. Not "enter a token", not "may I call
// this vendor". He is not being asked to operate anything or to hand anything
// over. He is being asked whether this institution may hold a computer of its
// own so it can look after its own software without becoming the machine that
// software runs on.
// =============================================================================

const OWNER = 'card_owner';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_card', 'owner@example.com', 'Owner']);
});

describe('the wall the real work runs into', () => {
  it('stops for a reason that names something he could change', async () => {
    const made = await produceSchemaDescription({ founderId: OWNER, evidenceMode: 'real' });
    expect(made.substrate).toBe('fly_sprites');
    expect(made.workspaceId).toBeNull();
    expect(made.because).toContain('declared, not available');
    expect(made.published).toBe(false);
  });

  it('turns that stop into exactly one decision, and not a second one', async () => {
    // ONE OPEN PROPOSAL PER CAPABILITY. Asking twice for the same thing is how
    // an owner learns to stop reading. The work will run into this wall on
    // every attempt; he hears about it once.
    await produceSchemaDescription({ founderId: OWNER, evidenceMode: 'real' });
    const open = await acquisitionsAwaiting(OWNER);
    const mine = open.filter((a) => a.capabilityKey === 'run_in_workspace');
    expect(mine).toHaveLength(1);
  });

  it('asks as the responsibility, never as a credential or a vendor', async () => {
    const [ask] = (await acquisitionsAwaiting(OWNER))
      .filter((a) => a.capabilityKey === 'run_in_workspace');
    expect(ask?.because).toContain('description of my own database true');
    expect(ask?.because).toContain('may not be produced on the machine I run on');
    expect(ask?.route).toBe('procure');
    // The words the owner ruled out. A reusable secret pasted into a screen is
    // a secret in that screen's history, a log and a backup.
    expect(`${ask?.because} ${ask?.sentence}`).not.toContain('SPRITE_TOKEN');
    expect(`${ask?.because} ${ask?.sentence}`.toLowerCase()).not.toContain('token');
  });

  it('states the cost from what was actually read, not from a number typed here',
    async () => {
      const [ask] = (await acquisitionsAwaiting(OWNER))
        .filter((a) => a.capabilityKey === 'run_in_workspace');
      expect(ask?.costNote).toContain('$20/month');
      expect(ask?.costNote).toContain('usage');
      // The trial credit is stated WITH its limit, because an unqualified "$30
      // free" would be the sentence that made him say yes and the one that was
      // not true of his account.
      expect(ask?.costNote).toContain('applies to');
      expect(ask?.costNote).toContain('cannot be read from here');
    });

  it('does not say yes on its own, however much the work wants it', async () => {
    const [ask] = (await acquisitionsAwaiting(OWNER))
      .filter((a) => a.capabilityKey === 'run_in_workspace');
    expect(ask?.decision).toBeNull();
    expect(ask?.acquired).toBe(false);
    const provider = (await query(
      `SELECT maturity FROM capability_providers
        WHERE capability_key = 'run_in_workspace' AND provider = 'fly_sprites'`))
      .rows[0] as Record<string, unknown>;
    expect(String(provider.maturity)).toBe('declared');
  });
});

describe('a yes he can take back', () => {
  it('does not make a second row for a provider it already describes', async () => {
    const [ask] = (await acquisitionsAwaiting(OWNER))
      .filter((a) => a.capabilityKey === 'run_in_workspace');
    await decideAcquisition({ id: ask!.id, decision: 'approved', by: `founder:${OWNER}` });
    await recordAcquired({
      id: ask!.id, evidence: 'the plan was taken and the secret set in their own store',
      witnessedBy: `founder:${OWNER}` });

    const rows = (await query(
      `SELECT id, maturity FROM capability_providers
        WHERE capability_key = 'run_in_workspace' AND provider = 'fly_sprites'`))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.maturity)).toBe('available');
  });

  it('shows him what he is carrying, so stopping it is somewhere he can find it',
    async () => {
      const held = await acquisitionsHeld(OWNER);
      expect(held.map((h) => h.capabilityKey)).toContain('run_in_workspace');
    });

  it('stops the institution using it, and says nothing about his money', async () => {
    const [held] = (await acquisitionsHeld(OWNER))
      .filter((a) => a.capabilityKey === 'run_in_workspace');
    await withdrawAcquisition({
      id: held!.id, reason: 'you stopped this from your controls', by: `founder:${OWNER}` });

    expect((await acquisitionsHeld(OWNER)).map((h) => h.capabilityKey))
      .not.toContain('run_in_workspace');
    const provider = (await query(
      `SELECT maturity FROM capability_providers
        WHERE capability_key = 'run_in_workspace' AND provider = 'fly_sprites'`))
      .rows[0] as Record<string, unknown>;
    expect(String(provider.maturity)).toBe('unavailable');
  });

  it('does not send the work back into a wall he has already stopped', async () => {
    // `unavailable` is what a withdrawal sets, and it is the one maturity that
    // means DO NOT USE THIS. Choosing the provider anyway would put the work
    // straight back into the refusal that raised the card in the first place.
    const { chooseAWorkspace } = await import('../../src/services/institution/carrying.js');
    const choice = await chooseAWorkspace(true);
    expect(choice.substrate).toBeNull();
    expect(choice.because).toContain('no computer is both');
  });

  it('does not ask him again the day after he answered', async () => {
    // Asking once is a decision; asking every time the work hits the same wall
    // is nagging, and asking again after he stopped it tells him his answer did
    // not take.
    await produceSchemaDescription({ founderId: OWNER, evidenceMode: 'real' });
    const open = (await acquisitionsAwaiting(OWNER))
      .filter((a) => a.capabilityKey === 'run_in_workspace');
    expect(open).toEqual([]);
  });

  it('refuses to withdraw something that was never approved', async () => {
    const id = (await query(
      `INSERT INTO capability_acquisitions
         (id, founder_id, capability_key, route, provider, how, cost_note, because, proposed_by)
       VALUES ('never_said_yes', ?, 'create_workspace', 'procure', 'somebody', 'workspace',
               'nothing', 'nothing needed it', 'test') RETURNING id`, [OWNER]))
      .rows[0] as Record<string, unknown>;
    await expect(withdrawAcquisition({
      id: String(id.id), reason: 'no', by: `founder:${OWNER}` }))
      .rejects.toThrow(/nothing_to_withdraw/);
  });
});
