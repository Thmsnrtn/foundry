process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  ENOUGH_TO_HAVE_A_RATE, awaitingAnswer, howOftenRight, resolvePrediction,
} from '../../src/services/institution/calibration.js';

// =============================================================================
// A PREDICTION THAT IS NEVER GRADED TEACHES NOTHING.
//
// The institution seals what it expects and what would disprove it, with real
// discipline, and never went back to look. `recordResult` — which writes the
// verdict and files a surprise as evidence CONTRADICTING the claim — had no
// caller outside tests. `misread_if` had no reader outside display. There was
// not one aggregate across judgments anywhere.
//
// The consequence is not that Foundry cannot report a hit rate. It is that
// every card he sees is the first card it has ever produced, so agreeing costs
// him nothing and means nothing — and that authority meant to be EARNED by
// demonstrated judgment had no record to be earned against.
// =============================================================================

const OWNER = 'cal_owner';
const before = '2026-01-01 00:00:00';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_cal', 'owner@example.com', 'Owner']);
});

describe('a grade names what settled it', () => {
  it('records a comparison and can never record it twice', async () => {
    const first = await resolvePrediction({
      founderId: OWNER, kind: 'venture_experiment', predictionId: 'x1',
      resolvedBy: 'experiment_result', evidenceRef: 'venture_experiment:x1',
      verdict: 'as_predicted', because: 'the page converted at the rate said',
      predictedAt: before });
    expect('id' in first).toBe(true);

    // A prediction that can be graded twice is one that can be graded until it
    // passes. Refused rather than thrown: two paths noticing the same answer is
    // not an error and must not stop a job mid-sweep.
    const again = await resolvePrediction({
      founderId: OWNER, kind: 'venture_experiment', predictionId: 'x1',
      resolvedBy: 'owner', evidenceRef: 'owner', verdict: 'surprised',
      because: 'on reflection', predictedAt: before });
    expect('refused' in again).toBe(true);
  });

  it('refuses evidence that predates the prediction', async () => {
    // Something already true when the prediction was made cannot be what
    // confirmed it. Same-second is refused as ambiguous rather than given the
    // benefit of the doubt.
    await expect(query(
      `INSERT INTO prediction_resolutions
         (id, founder_id, kind, prediction_id, resolved_by, evidence_ref, verdict,
          because, predicted_at, resolved_at)
       VALUES ('bad',?, 'venture_experiment','x2','later_observation','o:1',
               'as_predicted','it was already true','2026-02-01 00:00:00',
               '2026-01-01 00:00:00')`, [OWNER]))
      .rejects.toThrow(/not_after_the_prediction/);
  });

  it('refuses a grade with nothing to look at', async () => {
    await expect(query(
      `INSERT INTO prediction_resolutions
         (id, founder_id, kind, prediction_id, resolved_by, evidence_ref, verdict,
          because, predicted_at)
       VALUES ('bad2',?, 'venture_experiment','x3','owner','','as_predicted',
               'because I say so',?)`, [OWNER, before]))
      .rejects.toThrow(/needs_a_reason/);
  });

  it('will not let a grade be rewritten', async () => {
    await expect(query(
      "UPDATE prediction_resolutions SET verdict = 'as_predicted' WHERE prediction_id = 'x1'"))
      .rejects.toThrow(/prediction_resolution:final/);
  });

  it('has no way to say the model decided it had been right', async () => {
    await expect(query(
      `INSERT INTO prediction_resolutions
         (id, founder_id, kind, prediction_id, resolved_by, evidence_ref, verdict,
          because, predicted_at)
       -- check-vocabulary:expected-refusal
       VALUES ('bad3',?, 'venture_experiment','x4','the_model_concluded_so','r',
               'as_predicted','I reviewed my own reasoning',?)`, [OWNER, before]))
      .rejects.toThrow();
  });
});

describe('a rate is silence until it means something', () => {
  it('says it has no record rather than implying one', async () => {
    const fresh = await howOftenRight('nobody');
    expect(fresh.graded).toBe(0);
    expect(fresh.rate).toBeNull();
    expect(fresh.sentence).toContain('no reason to take my word');
  });

  it('reports a count and refuses a rate below the floor', async () => {
    const some = await howOftenRight(OWNER);
    expect(some.graded).toBeLessThan(ENOUGH_TO_HAVE_A_RATE);
    expect(some.rate).toBeNull();
    expect(some.sentence).toContain('not enough to tell you a rate');
  });

  it('gives a rate once there is enough to swing on', async () => {
    for (let i = 0; i < ENOUGH_TO_HAVE_A_RATE; i += 1) {
      await resolvePrediction({
        founderId: OWNER, kind: 'proposed_act', predictionId: `act_${String(i)}`,
        resolvedBy: 'business_outcome', evidenceRef: `outcome:${String(i)}`,
        verdict: i % 4 === 0 ? 'surprised' : 'as_predicted',
        because: 'what the numbers did afterwards', predictedAt: before });
    }
    const acts = await howOftenRight(OWNER, 'proposed_act');
    expect(acts.graded).toBe(ENOUGH_TO_HAVE_A_RATE);
    expect(acts.rate).not.toBeNull();
    expect(acts.sentence).toMatch(/I was right \d+ of \d+ times/);
    // And the surprises are counted, not quietly dropped.
    expect(acts.surprised).toBeGreaterThan(0);
    expect(acts.asPredicted + acts.partly + acts.surprised).toBe(acts.graded);
  });
});

describe('what was promised and not yet accounted for', () => {
  it('is empty when nothing is owed', async () => {
    expect(await awaitingAnswer(OWNER)).toEqual([]);
  });

  it('never asks him about a rehearsal', async () => {
    // A rehearsal experiment is a rehearsal of grading too. It may not consume
    // his attention, and it may not move a hit rate he will later rely on.
    const seeded = await query(
      "SELECT COUNT(*) AS n FROM prediction_resolutions WHERE founder_id = ?", [OWNER]);
    expect(Number((seeded.rows[0] as Record<string, unknown>).n))
      .toBe(ENOUGH_TO_HAVE_A_RATE + 1);
  });
});

describe('a record graded by his own opinion is a record of agreement', () => {
  it('separates what the world settled from what he settled', async () => {
    // The invariant is that internal activity does not prove market value. A
    // hit rate assembled from his own retrospective judgment is internal
    // activity wearing a number, so the two are counted apart.
    const acts = await howOftenRight(OWNER, 'proposed_act');
    expect(acts.settledByTheWorld).toBe(acts.graded);
    expect(acts.sentence).toContain('settled by what actually happened');

    for (let i = 0; i < ENOUGH_TO_HAVE_A_RATE; i += 1) {
      await resolvePrediction({
        founderId: OWNER, kind: 'institutional_judgment',
        predictionId: `j_${String(i)}`, resolvedBy: 'owner', evidenceRef: 'owner',
        verdict: 'as_predicted', because: 'he said it had been right',
        predictedAt: before });
    }
    const mine = await howOftenRight(OWNER, 'institutional_judgment');
    expect(mine.graded).toBe(ENOUGH_TO_HAVE_A_RATE);
    expect(mine.settledByTheWorld).toBe(0);
    expect(mine.sentence).toContain('0 of them settled by what actually happened');
  });

  it('knows how long its predictions wait for an answer', async () => {
    const acts = await howOftenRight(OWNER, 'proposed_act');
    expect(acts.daysToAnswer).not.toBeNull();
    expect(acts.daysToAnswer ?? 0).toBeGreaterThan(0);
  });
});
