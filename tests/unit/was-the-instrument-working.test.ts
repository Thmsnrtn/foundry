// =============================================================================
// WAS THE INSTRUMENT WORKING WHEN THE WORLD WAS ASKED?
//
// The worst defect this campaign found, and a returning owner found it by
// using the product: nineteen cold emails went to strangers inviting a reply,
// the Workshop's reply path was not routed, and seven days later the sealed
// rule settled the test SURPRISED and the institution filed that as evidence
// about a market. No rule was broken. A null result is only evidence about the
// world if the world could have answered.
//
// This runs on the world's own path — Experiment 001 carried by the hand —
// because a test that supplies its own result cannot show a defect in the
// instrument that produced one.
//
// THE SCENARIO IS NO LONGER PRODUCTION'S EXACTLY, and the difference is the
// point. Production wrote to nineteen people through a path that was never
// routed; the institution now refuses to write through a path that cannot
// carry the answer, so that morning could not happen again and cannot be
// staged. What is staged instead is the case that survives the refusal and is
// the harder one: a path that WAS working when the offers went out and failed
// while the window was still open. The offers are real, the days are real, and
// the result still means less than it appears to.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { HANDS, OWNER, advanceDays, asText, owner, ownerApp, runMorning, seedProductionShape } from '../helpers/world.js';

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
let X = '';

beforeAll(async () => {
  const seeded = await seedProductionShape({ settledBy: 'the world', unsettled: true });
  X = seeded.experimentId;
  const providers = seeded.providers!;
  // Two mornings with the reply path open: the offers go out and reach people.
  for (let i = 0; i < 2; i += 1) { await advanceDays(1); await runMorning(HANDS); }
  // Then the route fails, and stays failed for the rest of the window. Nothing
  // further is written — the hand refuses that now — but what was already sent
  // was sent, and the people who got it can no longer answer.
  providers.state.cf.routing.enabled = false;
  for (let i = 0; i < 14; i += 1) {
    await advanceDays(1);
    await runMorning(HANDS);
    const e = (await query('SELECT ran_at FROM venture_experiments WHERE id = ?', [X])).rows[0] as Record<string, unknown> | undefined;
    if (e?.ran_at != null) break;
  }
  app = await ownerApp();
  me = owner(app);
});

describe('a null result on a channel that may not have carried a reply says less', () => {
  it('the settled page says what was wrong with the instrument and what the result therefore does not establish', async () => {
    const { doubtsAboutTheInstrument } = await import('../../src/services/venture/the-instrument.js');
    // The Workshop's reply path is not routed, as production's was not.
    await query(`UPDATE public_workshop SET health_json = ?, health_at = datetime('now') WHERE founder_id = ?`,
      [JSON.stringify({ site: { status: 'healthy', detail: '' }, sending: { status: 'healthy', detail: '' },
        replyInbox: { status: 'needs_attention', detail: 'mail routing is not enabled on the zone' } }), OWNER]);
    const doubts = await doubtsAboutTheInstrument(X);
    expect(doubts).toHaveLength(1);
    expect(doubts[0].channel).toBe('reply');
    expect(doubts[0].sentence).toMatch(/messages went out under this test asking people to reply/);
    expect(doubts[0].sentence).toMatch(/mail routing is not enabled/);
    // AND ON THE WORLD'S OWN RUN IT IS A FACT, not a caveat: the morning pass
    // read the reply path on each day of the window and recorded what it saw
    // (migration 327), and on this run the path was never routed.
    expect(doubts[0].daysBroken).toBeGreaterThan(0);
    expect(doubts[0].sentence).toMatch(/not working on \d+ of the \d+ days the test was asking/);
    expect(doubts[0].doesNotEstablish).toMatch(/silence on a channel that may not have carried a reply/);
    const page = asText(await me.page(`/foundry/experiments/${X}`));
    expect(page).toContain('About the instrument');
    expect(page).toContain('mail routing is not enabled');
    // THE VERDICT IS NOT TOUCHED. A sealed rule counted what it said it would;
    // what the institution CLAIMS the result establishes is its own to correct.
    expect(page).toContain('Surprised');
    const { outcomeOf } = await import('../../src/services/founder/what-happened.js');
    expect((await outcomeOf(X))!.word).toBe('surprised');
  });

  it('the Inbox says what went out and that silence is not an answer while the path is down', async () => {
    const inbox = asText(await me.page('/foundry/inbox'));
    expect(inbox).toMatch(/messages have gone out under your tests, each inviting a reply/);
    expect(inbox).toContain('The reply path needs you');
    expect(inbox).toContain('silence here is not an answer from anybody');
    expect(inbox).not.toContain('Nothing has been sent, so nothing has come back');
  });

  it('a path healthy now does not erase the days it was not: history stands over the snapshot', async () => {
    await query(`UPDATE public_workshop SET health_json = ? WHERE founder_id = ?`,
      [JSON.stringify({ replyInbox: { status: 'healthy', detail: 'routing is enabled' } }), OWNER]);
    const { doubtsAboutTheInstrument } = await import('../../src/services/venture/the-instrument.js');
    const doubts = await doubtsAboutTheInstrument(X);
    expect(doubts).toHaveLength(1);
    expect(doubts[0].sentence).toContain('though it is working now');
    expect(doubts[0].daysBroken).toBeGreaterThan(0);
  });

  it('a path that was well every day of the window, and is well now, raises nothing', async () => {
    await query(`UPDATE public_channel_days SET worst_status = 'healthy', detail = NULL WHERE founder_id = ? AND channel = 'replyInbox'`, [OWNER])
      .catch(async () => {
        // The day guard refuses to make a bad day good, which is the point of
        // it; a clean record is written rather than edited.
        await query(`DELETE FROM public_channel_days WHERE founder_id = ? AND channel = 'replyInbox'`, [OWNER]);
      });
    await query(`DELETE FROM public_channel_days WHERE founder_id = ? AND channel = 'replyInbox' AND worst_status <> 'healthy'`, [OWNER]);
    const w = (await query(
      `SELECT date(MIN(o.executed_at)) AS from_day, date(MAX(e.ran_at)) AS to_day
         FROM outbound_actions o JOIN venture_experiments e ON e.id = o.experiment_id
        WHERE o.experiment_id = ? AND o.experiment_act = 'offer' AND o.status = 'executed'`, [X]))
      .rows[0] as Record<string, unknown>;
    const { recordWorkshopHealth } = await import('../../src/services/public-workshop/settings.js');
    for (let d = new Date(String(w.from_day) + 'T00:00:00Z'); d <= new Date(String(w.to_day) + 'T00:00:00Z'); d = new Date(d.getTime() + 86_400_000)) {
      await recordWorkshopHealth(OWNER, { replyInbox: { status: 'healthy', detail: 'routing is enabled' } }, d);
    }
    const { doubtsAboutTheInstrument } = await import('../../src/services/venture/the-instrument.js');
    expect(await doubtsAboutTheInstrument(X)).toEqual([]);
    expect(asText(await me.page(`/foundry/experiments/${X}`))).not.toContain('About the instrument');
  });
});

describe('where there is no day record, the receipts may still know', () => {
  it('a route that already existed before the window is never reported as made too late', async () => {
    // EXPERIMENT 001'S WINDOW PREDATES THE DAY RECORD ENTIRELY, which is why
    // the honest sentence stopped at "I cannot say". The route that carries a
    // reply is made through the governed door like everything else, and the
    // door keeps a receipt with a date on it: a route made AFTER a test closed
    // was not carrying anything during it, and that is a fact rather than an
    // inference. That is the branch production's own records will take.
    //
    // It cannot be staged here in the direction that fires. The world stands
    // the Workshop's ears up before it writes to anybody — the institution as
    // it must now be — so its route receipt predates every window, and a
    // receipt can never be deleted or moved (the trigger refuses, and should).
    // What IS held here is the dangerous direction: a route that was already
    // there must never be reported as having come too late.
    await query(`DELETE FROM public_channel_days WHERE founder_id = ? AND channel = 'replyInbox'`, [OWNER]);
    await query(`UPDATE public_workshop SET health_json = ? WHERE founder_id = ?`,
      [JSON.stringify({ replyInbox: { status: 'needs_attention', detail: 'mail routing is not enabled on the zone' } }), OWNER]);
    const made = (await query(
      `SELECT COUNT(*) AS n FROM cloudflare_mutations
        WHERE tool = 'cloudflare_email_route_upsert' AND outcome = 'applied'`, []))
      .rows[0] as Record<string, unknown>;
    expect(Number(made.n), 'the world routed its replies before it wrote to anybody').toBeGreaterThan(0);
    const { doubtsAboutTheInstrument } = await import('../../src/services/venture/the-instrument.js');
    const doubts = await doubtsAboutTheInstrument(X);
    expect(doubts[0].sentence).not.toMatch(/was not made until/);
    expect(doubts[0].sentence).toMatch(/no day-by-day record/);
  });
});

describe('the channel keeps its own record, so the doubt becomes a fact', () => {
  it('says on how many of the test\'s own days the path was not working, from the day-by-day record', async () => {
    const { doubtsAboutTheInstrument } = await import('../../src/services/venture/the-instrument.js');
    const w = (await query(
      `SELECT date(MIN(o.executed_at)) AS from_day, date(MAX(e.ran_at)) AS to_day
         FROM outbound_actions o JOIN venture_experiments e ON e.id = o.experiment_id
        WHERE o.experiment_id = ? AND o.experiment_act = 'offer' AND o.status = 'executed'`, [X]))
      .rows[0] as Record<string, unknown>;
    // The pass read the path on each day of the window: broken on two of them.
    const from = new Date(String(w.from_day) + 'T00:00:00Z');
    const to = new Date(String(w.to_day) + 'T00:00:00Z');
    const { recordWorkshopHealth } = await import('../../src/services/public-workshop/settings.js');
    let broken = 0;
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86_400_000)) {
      const bad = broken < 2;
      await recordWorkshopHealth(OWNER, {
        replyInbox: bad ? { status: 'needs_attention', detail: 'mail routing is not enabled on the zone' } : { status: 'healthy', detail: 'routing is enabled' },
      }, d);
      if (bad) broken += 1;
    }
    const doubts = await doubtsAboutTheInstrument(X);
    expect(doubts).toHaveLength(1);
    expect(doubts[0].daysBroken).toBe(2);
    expect(doubts[0].daysUnrecorded).toBe(0);
    expect(doubts[0].sentence).toMatch(/not working on 2 of the \d+ days the test was asking/);
    expect(doubts[0].sentence).toContain('mail routing is not enabled');
    expect(asText(await me.page(`/foundry/experiments/${X}`))).toMatch(/not working on 2 of the \d+ days/);
  });

  it('a day does not get better after the fact: a healthy reading later does not un-say the failure', async () => {
    const day = (await query(`SELECT day FROM public_channel_days WHERE founder_id = ? AND channel = 'replyInbox' AND worst_status = 'needs_attention' ORDER BY day LIMIT 1`, [OWNER])).rows[0] as Record<string, unknown>;
    const { recordWorkshopHealth } = await import('../../src/services/public-workshop/settings.js');
    await recordWorkshopHealth(OWNER, { replyInbox: { status: 'healthy', detail: 'routing is enabled' } }, new Date(String(day.day) + 'T23:00:00Z'));
    const row = (await query(`SELECT worst_status, readings FROM public_channel_days WHERE founder_id = ? AND channel = 'replyInbox' AND day = ?`, [OWNER, String(day.day)])).rows[0] as Record<string, unknown>;
    expect(row.worst_status).toBe('needs_attention');
    expect(Number(row.readings)).toBeGreaterThan(1);
    // A message sent in the hour the path was down was not carried by a path
    // that came back at eleven; the day's worst reading is the day's truth.
    const { doubtsAboutTheInstrument } = await import('../../src/services/venture/the-instrument.js');
    expect((await doubtsAboutTheInstrument(X))[0].daysBroken).toBe(2);
  });
});
