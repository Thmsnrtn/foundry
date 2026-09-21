// =============================================================================
// AN EXCLUSION IS ABOUT A PERSON, NOT ABOUT A ROW.
//
// Two reviewers who had never seen the code found this independently, reading
// the owner's own recipients list. The same business sat on it twice — once as
// a public listing names it and once as the cohort names it, differing by an
// "LLC" — at the SAME email address. One row was struck for having no recorded
// grounds. The other was approved. The message went to the address that had
// just been excluded, and the activity feed showed the owner the exclusion as
// evidence that the promise had held.
//
// Every row was true. The promise on the page — "nobody excluded is ever
// written to" — was false as the person receiving it experiences it. And the
// control the owner is told is absolute ("exclude your employer and anything
// that could be a conflict") did not hold against a near-duplicate.
//
// It binds on the address, at the door, and fails closed.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { HANDS, advanceDays, asText, owner, ownerApp, runMorning, seedProductionShape } from '../helpers/world.js';

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
let X = '';
let providers: NonNullable<Awaited<ReturnType<typeof seedProductionShape>>['providers']>;

beforeAll(async () => {
  const seeded = await seedProductionShape({ settledBy: 'the world', unsettled: true });
  X = seeded.experimentId;
  providers = seeded.providers!;
  app = await ownerApp();
  me = owner(app);
});

describe('the same address on two rows', () => {
  it('production\'s own data holds one business twice, at one address, under two names', async () => {
    const dupes = (await query(
      `SELECT lower(trim(email)) AS address, COUNT(*) AS n, MIN(review_status) AS a, MAX(review_status) AS b
         FROM experiment_recipients WHERE experiment_id = ? AND email IS NOT NULL
        GROUP BY lower(trim(email)) HAVING COUNT(*) > 1`, [X]))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(dupes.length, 'this is the shape the reviewers found, and it ships in the seed data')
      .toBeGreaterThan(0);
    const split = dupes.find((d) => String(d.a) !== String(d.b));
    expect(split, 'one struck and one approved at the same address').toBeTruthy();
  });

  it('the door refuses to write to an address struck anywhere in the test', async () => {
    const split = (await query(
      `SELECT lower(trim(email)) AS address FROM experiment_recipients
        WHERE experiment_id = ? AND email IS NOT NULL AND review_status = 'struck'
          AND lower(trim(email)) IN (SELECT lower(trim(email)) FROM experiment_recipients
                                      WHERE experiment_id = ? AND review_status = 'approved')
        LIMIT 1`, [X, X])).rows[0] as Record<string, unknown> | undefined;
    expect(split, 'the fixture must contain the case or this proves nothing').toBeTruthy();
    const approved = (await query(
      `SELECT id, counterparty_ref FROM experiment_recipients
        WHERE experiment_id = ? AND review_status = 'approved' AND lower(trim(email)) = ?`,
      [X, String(split!.address)])).rows[0] as Record<string, unknown>;
    // It must not already have been written to, and it must refuse now.
    const sent = (await query(
      `SELECT COUNT(*) AS n FROM outbound_actions
        WHERE experiment_id = ? AND recipient_id = ?`, [X, String(approved.id)]))
      .rows[0] as Record<string, unknown>;
    expect(Number(sent.n), 'nothing was written to an address excluded on another line').toBe(0);
    const { planOffer } = await import('../../src/services/venture/hand.js');
    await expect(planOffer({ experimentId: X, recipientId: String(approved.id) }))
      .rejects.toThrow(/recipient_struck_at_this_address/);
  });

  it('and the list says so, rather than showing approved beside an address it will never write to', async () => {
    const page = asText(await me.page(`/foundry/experiments/${X}/recipients`));
    expect(page).toContain('excluded by address');
    expect(page).toMatch(/This address is excluded on another line of this list/);
    expect(page).toMatch(/an exclusion is about the person who would receive the message, not about the row/);
  });
});

describe('and the world runs without writing to it', () => {
  it('twenty-one rows are approved, and the struck address is never among what went out', async () => {
    const struck = (await query(
      `SELECT DISTINCT lower(trim(email)) AS address FROM experiment_recipients
        WHERE experiment_id = ? AND review_status = 'struck' AND email IS NOT NULL`, [X]))
      .rows as unknown as Array<Record<string, unknown>>;
    const forbidden = new Set(struck.map((r) => String(r.address)));
    expect(forbidden.size).toBeGreaterThan(0);

    for (let i = 0; i < 4; i += 1) { await advanceDays(1); await runMorning(HANDS); }
    expect(providers.state.sends.length, 'the test did write to people').toBeGreaterThan(0);

    const written = providers.state.sends.flatMap((m) => m.to.map((a) => a.trim().toLowerCase()));
    const breached = written.filter((a) => forbidden.has(a));
    expect(breached, 'an address excluded on any line of the list is written to on none of them').toEqual([]);
  });
});
