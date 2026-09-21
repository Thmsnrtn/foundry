// =============================================================================
// THE INSTRUMENT IS DECLARED BEFORE THE WORLD IS ASKED.
//
// Experiment 001 executed correctly and settled correctly, and nineteen people
// were invited to reply to an address that was not routed. Every internal
// state was right; the external path the offer depended on was not there.
//
// This is the third time this institution has drawn the same distinction, each
// time one level further out:
//
//   run-state.ts       "it ran without throwing" is not "it did what it was for"
//   the-instrument.ts  "it did what it was for" is not "the result means what
//                      it appears to mean"
//   here               neither is "the path required to obtain or observe the
//                      outcome was working while the question was open"
//
// So the proofs below run the world's own path — Experiment 001 carried by the
// hand — and break the reply route before the hand writes to anybody. What
// must happen is that nobody is written to at all.
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
let providers: NonNullable<Awaited<ReturnType<typeof seedProductionShape>>['providers']>;

beforeAll(async () => {
  const seeded = await seedProductionShape({ settledBy: 'the world', unsettled: true });
  X = seeded.experimentId;
  providers = seeded.providers!;
  app = await ownerApp();
  me = owner(app);
});

describe('a test states what it depends on, derived from its own design', () => {
  it('declares the reply path as an invitation, because a message with a From line can be answered', async () => {
    const { pathsRequiredBy } = await import('../../src/services/venture/the-instrument.js');
    const paths = await pathsRequiredBy(X);
    const reply = paths.find((p) => p.kind === 'reply');
    expect(reply, 'a test that writes to people depends on a way for them to answer').toBeTruthy();
    // THE DISTINCTION THAT WOULD HAVE CAUGHT IT. Experiment 001's sealed rule
    // counted payments, not replies, so the reply path was never part of its
    // MEASUREMENT — and that is exactly why nothing noticed. It is part of its
    // INVITATION: nineteen people were asked to use it.
    expect(reply!.bearsOn).toBe('invitation');
    expect(reply!.essential).toBe(true);
    // WHERE A PATH BEARS ON BOTH, THE MEASUREMENT IS WHAT IS SAID: this
    // test's rule counts offers delivered, so the way messages reach people is
    // part of how it measures and not only of how it asks. Losing it is the
    // larger loss, and the sentence an owner reads should say so.
    expect(paths.find((p) => p.kind === 'sending')?.bearsOn).toBe('measurement');
    expect(paths.find((p) => p.kind === 'payment_observation')?.bearsOn).toBe('measurement');
  });

  it('will not have its dependencies argued down, and will not have the reason rewritten', async () => {
    const { declareInstrument } = await import('../../src/services/venture/the-instrument.js');
    await declareInstrument(X);
    await expect(query(
      `UPDATE experiment_paths SET essential = 0 WHERE experiment_id = ? AND kind = 'reply'`, [X]))
      .rejects.toThrow(/essential_does_not_fall/);
    await expect(query(
      `UPDATE experiment_paths SET why = 'it turns out we did not need it' WHERE experiment_id = ? AND kind = 'reply'`, [X]))
      .rejects.toThrow(/immutable/);
  });
});

describe('the world is not asked through an instrument that is not working', () => {
  it('sends nothing to anybody while the reply path is unrouted, and says which path and why', async () => {
    // Production's own failure, reproduced at its source: routing was never
    // enabled on the zone.
    providers.state.cf.routing.enabled = false;
    await advanceDays(1);
    // THE MORNING ITSELF REPORTS IT. An authorised test that could not
    // proceed is not a clean pass, and the job says which test and which path
    // rather than returning quietly — the distinction `run-state.ts` was
    // written for, now reaching one level further out.
    const ran = await runMorning(HANDS);
    const hand = ran.find((r) => r.job === 'experiment_hand_tick')!;
    expect(hand.ok).toBe(false);
    expect(hand.error).toMatch(/could not proceed/);
    expect(hand.error).toMatch(/the way a person answers is not working/);

    expect(providers.state.sends, 'nobody is written to through an instrument that cannot carry the answer').toHaveLength(0);
    const sent = (await query(
      `SELECT COUNT(*) AS n FROM outbound_actions WHERE experiment_id = ? AND experiment_act = 'offer'`, [X]))
      .rows[0] as Record<string, unknown>;
    expect(Number(sent.n)).toBe(0);

    // BLOCKED, NOT FAILED AND NOT IDLE. An authorised test that moved nothing
    // because something it depends on is down is stopped, and somebody is owed
    // a sentence about it.
    const { runStateOf } = await import('../../src/services/venture/run-state.js');
    const state = await runStateOf(X);
    expect(state!.state).toBe('blocked');
    expect(state!.because).toMatch(/the way a person answers is not working/);
    expect(state!.because).toMatch(/mail routing is not enabled on the zone/);
    expect(state!.dependency).toBe('the way a person answers');
  });

  it('records the interval the path was down, so a later reading is a fact rather than a guess', async () => {
    const path = (await query(
      `SELECT verified_status, broken_since, broken_detail FROM experiment_paths WHERE experiment_id = ? AND kind = 'reply'`, [X]))
      .rows[0] as Record<string, unknown>;
    expect(path.verified_status).toBe('not_working');
    expect(path.broken_since).not.toBeNull();
    expect(String(path.broken_detail)).toMatch(/routing is not enabled/);
  });

  it('the owner reads it on the test, in the words the health reading used', async () => {
    const page = asText(await me.page(`/foundry/experiments/${X}`));
    expect(page).toMatch(/mail routing is not enabled on the zone/);
  });

  it('writes again the morning the path comes back, without being asked twice', async () => {
    // The owner puts the route back, which is what putting it back means:
    // routing enabled on the zone and a rule that reaches the program that
    // hears. Re-running the stand-up is the same door he would use.
    providers.state.cf.routing.enabled = true;
    const { standUpWorkshop } = await import('../../src/services/public-workshop/infrastructure.js');
    await standUpWorkshop(OWNER, providers.fetch as unknown as typeof fetch);
    await advanceDays(1);
    await runMorning(HANDS);
    expect(providers.state.sends.length, 'the offers go out once the world can answer').toBeGreaterThan(0);
    const path = (await query(
      `SELECT verified_status, broken_since FROM experiment_paths WHERE experiment_id = ? AND kind = 'reply'`, [X]))
      .rows[0] as Record<string, unknown>;
    expect(path.verified_status).toBe('working');
    expect(path.broken_since, 'a path that is working is not also broken').toBeNull();
  });
});

describe('what is not known is not treated as what is broken', () => {
  it('a path nobody could read does not stop the test', async () => {
    const { instrumentAgainst, pathsNotWorking } = await import('../../src/services/venture/the-instrument.js');
    // No health reading at all: every path with a channel reads unknown.
    const readings = await instrumentAgainst(X, null);
    expect(readings.length).toBeGreaterThan(0);
    expect(readings.every((r) => r.status === 'unknown' || r.kind === 'payment' || r.kind === 'refund' || r.kind === 'payment_observation')).toBe(true);
    expect(pathsNotWorking(readings).filter((r) => r.bearsOn !== 'obligation'),
      'unknown is not broken: a deployment that cannot read a path must not be stopped by it').toHaveLength(0);
  });

  it('the payment observation path answers unknown until a provider has actually reached this deployment', async () => {
    const { paymentObservationPath } = await import('../../src/services/venture/the-instrument.js');
    const before = await paymentObservationPath();
    expect(before.status).toBe('unknown');
    expect(before.detail).toMatch(/none ever has been/);
    // A LIVE event proves the live route. A test-mode one proves the
    // machinery and is reported as unknown, which
    // `a-payment-nobody-told-us-about` holds on its own.
    await query(`INSERT INTO stripe_webhook_events (event_id, event_type, processed_at, livemode) VALUES (?,?,datetime('now'),1)`,
      ['evt_world', 'payment_intent.succeeded']);
    expect((await paymentObservationPath()).status).toBe('working');
  });
});
