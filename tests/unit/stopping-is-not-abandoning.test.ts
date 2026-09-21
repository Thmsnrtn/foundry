// =============================================================================
// STOPPING IS NOT ABANDONING.
//
// The owner has three commands that are genuinely distinct in code: a
// reversible operating pause, a withdrawal of spending authority, and retiring
// an asset. The fourth — "stop the institution" — had no in-code act at all,
// and the obvious version of it would be the worst thing this repository could
// build. An institution that can be switched off mid-obligation is one whose
// owner can be made, by a single button, into somebody who took money and
// vanished.
//
// So the fourth command is a WIND-DOWN, and the mechanism was already here: the
// hand gates new exposure and nothing else, and carries what is owed on both
// passes whatever the pause says. What was missing was the ANSWER — the owner
// could order the stop and could not ask, first, what stopping would leave on
// his desk.
//
// THE UNCOMFORTABLE HALF LEADS. A wind-down summary that said "all clear"
// because it counted only what Foundry can finish by itself would be the most
// dangerous page in the institution.
//
// Nobody real is written to; every provider is stubbed at the network edge.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';

import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { HANDS, OWNER, aBuyerIsOwedARefund, runMorning, seedProductionShape } from '../helpers/world.js';

beforeAll(async () => {
  await seedProductionShape({
    charter: true, searching: true, eyes: true, settledBy: 'the world', earsOpen: true,
  });
});

describe('what stopping would leave', () => {
  it('says nothing is outstanding when nobody is owed anything', async () => {
    const { howThisWouldEnd } = await import('../../src/services/institution/winding-down.js');
    const end = await howThisWouldEnd(OWNER);
    expect(end.itCannotSettle).toHaveLength(0);
    expect(end.sentence).toContain('Nobody is owed anything');
  });

  it('separates what it would finish alone from what would be yours', async () => {
    await aBuyerIsOwedARefund(OWNER);
    const { howThisWouldEnd } = await import('../../src/services/institution/winding-down.js');
    const end = await howThisWouldEnd(OWNER);

    // A failed delivery two days old, with the money still held and the door
    // refusing the refund, is the owner's. It is not something a later pass
    // fixes, and it must not be counted among the things Foundry would finish.
    expect(end.itWillFinish).toHaveLength(0);
    expect(end.itCannotSettle).toHaveLength(1);
    expect(end.itCannotSettle[0]?.whose).toBe('you');
    expect(end.itCannotSettle[0]?.amountCents).toBe(2900);
    expect(end.itCannotSettle[0]?.what).toContain('refund owed after a failed delivery');
    expect(end.itCannotSettle[0]?.because).toContain('issued by hand');
  });

  it('leads with the part that needs a person, when there is one', async () => {
    // The door refuses the refund when the money tools are off, and the owner
    // has to issue it himself. That is exactly the case a reassuring summary
    // would bury.
    const before = process.env.FOUNDRY_ENABLE_MONEY_TOOLS;
    process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'false';
    try {
      const { howThisWouldEnd } = await import('../../src/services/institution/winding-down.js');
      const end = await howThisWouldEnd(OWNER);
      expect(end.itCannotSettle).toHaveLength(1);
      expect(end.itCannotSettle[0]?.because).toContain('money tools are switched off');
      expect(end.sentence).toMatch(/^1 thing worth \$29\.00 would be left for you/);
      expect(end.sentence).toContain('nothing I do on a later pass changes that');
      expect(end.sentence).toContain('Nothing else is outstanding.');
    } finally {
      process.env.FOUNDRY_ENABLE_MONEY_TOOLS = before;
    }
  });

  it('reads, and changes nothing', async () => {
    const { howThisWouldEnd } = await import('../../src/services/institution/winding-down.js');
    const paused = async () => (await query(
      'SELECT economic_pause_at FROM public_workshop WHERE founder_id = ?', [OWNER]))
      .rows[0] as Record<string, unknown> | undefined;
    const before = (await paused())?.economic_pause_at ?? null;
    await howThisWouldEnd(OWNER);
    expect((await paused())?.economic_pause_at ?? null).toBe(before);
  });
});

describe('a pause stops new exposure and does not stop discharge', () => {
  it('keeps carrying what is owed across a pause', async () => {
    const { pauseNewEconomicActivity } = await import('../../src/services/public-workshop/settings.js');
    await pauseNewEconomicActivity({ founderId: OWNER, reason: 'winding down for the proof' });

    const sendsBefore = (await query(
      'SELECT COUNT(*) AS n FROM experiment_exposures WHERE founder_id = ?', [OWNER]))
      .rows[0] as Record<string, unknown>;
    await runMorning(HANDS);
    const sendsAfter = (await query(
      'SELECT COUNT(*) AS n FROM experiment_exposures WHERE founder_id = ?', [OWNER]))
      .rows[0] as Record<string, unknown>;

    // NOTHING NEW REACHES ANYBODY.
    expect(Number(sendsAfter.n)).toBe(Number(sendsBefore.n));

    // AND THE WIND-DOWN READING KNOWS THE PAUSE IS ON, so the owner is not
    // asked to order something that is already in force.
    const { howThisWouldEnd } = await import('../../src/services/institution/winding-down.js');
    const end = await howThisWouldEnd(OWNER);
    expect(end.newExposureStopped).toBe(true);

    // AND THE BUYER GOT THEIR MONEY BACK, DURING THE PAUSE. This is the whole
    // claim in one row: the morning placed nothing new and still discharged
    // what was owed. A pause that stopped this would be an abandonment with a
    // gentler name.
    const back = (await query(
      `SELECT status, refund_ref FROM experiment_fulfilments WHERE id = 'ful_harness_1'`))
      .rows[0] as Record<string, unknown>;
    expect(back.refund_ref).not.toBeNull();
    // AND THE DELIVERY IS STILL RECORDED AS HAVING FAILED. The money going
    // back closes what is owed; it does not un-fail the delivery, and a row
    // that read 'refunded' here would have quietly erased that the goods never
    // arrived. Two facts, two columns.
    expect(String(back.status)).toBe('failed');
    expect(end.itCannotSettle).toHaveLength(0);
    expect(end.sentence).toContain('Nobody is owed anything');
  });
});

describe('what may happen without him, by kind of act', () => {
  it('reads the seven rungs from the ladder the door actually gates on', async () => {
    const { autonomyAcross } = await import('../../src/services/founder/autonomy-map.js');
    const map = await autonomyAcross(OWNER);
    expect(map.byConsequence.map((b) => b.rung)).toEqual([
      'observe', 'prepare', 'reversible', 'public', 'financial', 'legal', 'destructive',
    ]);
  });

  it('says never for the rungs no policy may ever pre-authorise', async () => {
    const { autonomyAcross } = await import('../../src/services/founder/autonomy-map.js');
    const map = await autonomyAcross(OWNER);
    const never = map.byConsequence.filter((b) => b.standing === 'never').map((b) => b.rung);
    expect(never.sort()).toEqual(['destructive', 'legal']);
    for (const b of map.byConsequence.filter((x) => x.standing === 'never')) {
      // A PROPERTY OF THE LADDER, NOT OF TODAY. It says the same thing whatever
      // the owner has allowed elsewhere, because no grant can change it.
      expect(b.sentence).toContain('Never without asking you');
      expect(b.sentence).toContain('whatever you have allowed');
    }
  });

  it('does not let a loose corner speak for every kind of act', async () => {
    const { autonomyAcross } = await import('../../src/services/founder/autonomy-map.js');
    const map = await autonomyAcross(OWNER);
    // The estate-wide sentence is one answer; the per-rung reading is another,
    // and the whole point is that they can differ. Whatever the estate says,
    // the two constitutional rungs never widen with it.
    expect(map.byConsequence.filter((b) => b.standing === 'never')).toHaveLength(2);
    expect(map.sentence.length).toBeGreaterThan(0);
  });
});

describe('how long it could be gone before anybody noticed', () => {
  it('refuses to treat its own staleness bound as a detection guarantee', async () => {
    const { howLongCouldItBeGone } = await import('../../src/services/deployment/self-check.js');
    const gone = await howLongCouldItBeGone(OWNER);
    expect(gone.tightestBoundHours).toBeGreaterThan(0);
    // THE SENTENCE THAT MATTERS. A reading written by the process that stopped
    // is not a reading anybody will get.
    expect(gone.sentence).toContain('nothing outside it would say so');
    expect(gone.sentence).toContain('a process that is gone produces no reading at all');
    expect(gone.sentence).toContain('until you look');
  });

  it('sizes the silence against what is owed while it is silent', async () => {
    const { howLongCouldItBeGone } = await import('../../src/services/deployment/self-check.js');
    // By now the paused morning has refunded the one buyer, so the honest
    // answer is that the silence costs nothing today — and it says that rather
    // than omitting the clause, because "how long could it be gone" means
    // something different when the answer is nobody.
    const gone = await howLongCouldItBeGone(OWNER);
    expect(gone.owedCount).toBe(0);
    expect(gone.sentence).toContain('the silence costs nothing today');
  });
});
