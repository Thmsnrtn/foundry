// =============================================================================
// A NULL DRAWN THROUGH A GAP IS NOT AN ANSWER.
//
// The institution already knew that a test can fail to measure: `validity` is
// not `verdict`, an invalid test is re-run rather than read, and
// `instrumentation_defect` has been one of the seven named kinds since the
// world began settling experiments. It had exactly one door into that state —
// a measurement-critical ACT of the test whose own prediction resolved
// surprised — and Experiment 001 walked past it, because every act succeeded.
// What failed was a path no act predicted about.
//
// So there is a second door, and its authority is the record rather than a
// caller: it goes and reads the day-by-day channel record itself, refuses when
// there is no gap, and refuses outright for a result that observed something.
// A payment that arrived is not un-observed by a later outage. A nobody-paid
// measured through days when nothing could have told us about a payment is not
// evidence about a market, and the institution now declines to file it as one.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { HANDS, OWNER, advanceDays, asText, owner, ownerApp, runMorning, seedProductionShape } from '../helpers/world.js';

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
let X = '';

beforeAll(async () => {
  const seeded = await seedProductionShape({ settledBy: 'the world', unsettled: true });
  X = seeded.experimentId;
  // Two mornings with everything working: the offers go out and reach people.
  for (let i = 0; i < 2; i += 1) { await advanceDays(1); await runMorning(HANDS); }
  // Then the endpoint that receives payment events goes away — somebody
  // rotates a signing secret, an endpoint is deleted — and for the rest of the
  // window a payment could happen and Foundry would never know.
  delete process.env.STRIPE_WEBHOOK_SECRET;
  for (let i = 0; i < 14; i += 1) {
    await advanceDays(1);
    await runMorning(HANDS);
    const e = (await query('SELECT ran_at, validity FROM venture_experiments WHERE id = ?', [X]))
      .rows[0] as Record<string, unknown>;
    if (e.ran_at != null || String(e.validity) === 'invalid') break;
  }
  app = await ownerApp();
  me = owner(app);
});

// The secret is the deployment's, not this file's: put it back so a suite that
// runs after this one is not quietly testing a deployment that cannot hear.
afterAll(() => { process.env.STRIPE_WEBHOOK_SECRET = 'whsec_world'; });

describe('the rule does not write a verdict the instrument could not have seen', () => {
  it('settles nothing, and says the test did not measure, naming the path and the days', async () => {
    const e = (await query(
      `SELECT validity, invalid_because, invalidated_by, ran_at, verdict FROM venture_experiments WHERE id = ?`, [X]))
      .rows[0] as Record<string, unknown>;
    expect(e.validity).toBe('invalid');
    expect(e.invalid_because).toBe('instrumentation_defect');
    // NOT AN ACT, AND NOT THE OWNER. The record itself.
    expect(e.invalidated_by).toBe('the record');
    // AND NO VERDICT AT ALL. "Not as predicted" was never written, because it
    // was never established: the rule did not run on a window it could not see.
    expect(e.ran_at, 'a test that did not measure is neither passed nor failed').toBeNull();
    expect(e.verdict).toBeNull();
  });

  it('the offer comes down, so nobody pays for a question that is no longer being asked', async () => {
    const x = (await query(
      `SELECT withdrawn_at FROM experiment_exposures WHERE experiment_id = ? ORDER BY rowid DESC LIMIT 1`, [X]))
      .rows[0] as Record<string, unknown> | undefined;
    expect(x?.withdrawn_at).not.toBeNull();
  });

  it('the owner reads it as a test that did not measure, not as a market that said no', async () => {
    const page = asText(await me.page(`/foundry/experiments/${X}`));
    expect(page).toMatch(/did not measure/);
    expect(page).not.toContain('Surprised');
    const { outcomeOf } = await import('../../src/services/founder/what-happened.js');
    const outcome = await outcomeOf(X);
    expect(outcome?.word).not.toBe('surprised');
  });
});

describe('the door cannot be walked through by asserting it', () => {
  it('refuses when the record shows no day an answer could not have reached us', async () => {
    const { invalidateByObservation } = await import('../../src/services/venture/outcome.js');
    // A window long before anything was recorded: no broken days in it.
    const r = await invalidateByObservation({
      experimentId: X, from: new Date('2020-01-01T00:00:00Z'), to: new Date('2020-01-08T00:00:00Z'), countedEvents: 0,
    });
    expect('refused' in r && r.refused).toMatch(/no day on which an answer could not have reached us/);
  });

  it('refuses for a result that observed something: a gap afterwards does not un-observe a payment', async () => {
    const { invalidateByObservation } = await import('../../src/services/venture/outcome.js');
    const r = await invalidateByObservation({
      experimentId: X, from: new Date(Date.now() - 86_400_000 * 20), to: new Date(), countedEvents: 1,
    });
    expect('refused' in r && r.refused).toMatch(/observed something/);
  });

  it('a day nobody watched is not counted against the test', async () => {
    const { measurementGapIn } = await import('../../src/services/venture/the-instrument.js');
    // A window of days with no readings at all: unknown, and unknown is not a gap.
    const gaps = await measurementGapIn(X, new Date('2019-06-01T00:00:00Z'), new Date('2019-06-30T00:00:00Z'));
    expect(gaps).toEqual([]);
  });
});
