process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  recordPredictionAccuracy,
  getPredictionAccuracySummary,
} from '../../src/services/temporal/replay.js';

// =============================================================================
// A FORECAST SCORED AGAINST WHAT IT COULD NOT MEASURE.
//
// This is Foundry grading its own forecasts. It is the one place in the system
// where the institution is its own subject, so a self-score that is inflated or
// deflated is worse here than anywhere else: every other number describes a
// company, and this one describes whether Foundry's numbers can be believed.
//
// `composite_accuracy` weighted direction 0.5, magnitude 0.3, timeframe 0.2 —
// and when a component could not be scored it contributed ZERO rather than
// dropping out. Two consequences, both of them the same bug:
//
//   1. A forecast that got the direction exactly right, with no magnitude or
//      timeframe in the scenario to compare against, scored 0.5. So did a
//      forecast that got the direction right and was completely wrong on both
//      of the others. The best possible outcome and a two-thirds miss recorded
//      the same number.
//
//   2. `undefined === 'positive'` is false, so a scenario that predicted no
//      direction at all was recorded as having predicted it WRONG — a zero at
//      the heaviest weight of the three, for a prediction never made.
//
// The row was otherwise honest. `magnitude_accuracy` and `timeframe_accuracy`
// store NULL when unmeasured; only the aggregate over them lied. That is the
// same shape as the value-delivery row that told the truth in five columns and
// a lie in the sixth, and the rule is the one this campaign keeps arriving at:
// A COMPOSITE RESTS ONLY ON WHAT IT MEASURED. Components contribute only when
// measured, the weights renormalise over those, and the composite is NULL when
// nothing was measured at all.
//
// The reporting half had the matching defect. `AVG` over zero scored rows is
// NULL, and the summary returned `?? 0` — Foundry reporting 0% direction
// accuracy, that it has never once been right, for a company whose forecasts
// have never been scored. A zero looks like an answer; a null asks a question.
// =============================================================================

const P = 'p_fx';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_fx','c_fx','fx@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_fx','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM prediction_accuracy');
  await query('DELETE FROM scenario_models');
  await query('DELETE FROM decisions');
});

/** A decision with one scenario model whose base case is exactly `baseCase`. */
async function decisionForecasting(id: string, baseCase: Record<string, unknown>): Promise<void> {
  await query(
    `INSERT INTO decisions (id, product_id, what, why_now, category, decided_by)
     VALUES (?, ?, 'Ship the thing', 'The window is open', 'product', 'second_self')`,
    [id, P],
  );
  await query(
    `INSERT INTO scenario_models
       (id, decision_id, product_id, option_label, best_case, base_case, stress_case, data_inputs_used)
     VALUES (?, ?, ?, 'ship', '{}', ?, '{}', '[]')`,
    [`sm_${id}`, id, P, JSON.stringify(baseCase)],
  );
}

async function scoredRow(): Promise<Record<string, number | null>> {
  const r = await query('SELECT * FROM prediction_accuracy');
  expect(r.rows.length).toBe(1);
  return r.rows[0] as unknown as Record<string, number | null>;
}

describe('a composite scored over what it actually measured', () => {
  it('scores a direction-only forecast that was right as fully right, not half right', async () => {
    await decisionForecasting('d_dir', { outcome_direction: 'positive' });

    await recordPredictionAccuracy(P, 'd_dir', 'positive', null, null);

    const row = await scoredRow();
    expect(row.magnitude_accuracy).toBeNull();
    expect(row.timeframe_accuracy).toBeNull();
    // The one thing this forecast committed to, it got right. 0.5 would be the
    // old arithmetic charging it for two components nobody could score.
    expect(row.composite_accuracy).toBe(1);
  });

  it('scores a direction-only forecast that was wrong as fully wrong', async () => {
    await decisionForecasting('d_wrong', { outcome_direction: 'positive' });

    await recordPredictionAccuracy(P, 'd_wrong', 'negative', null, null);

    const row = await scoredRow();
    expect(row.direction_correct).toBe(0);
    expect(row.composite_accuracy).toBe(0);
  });

  it('weights the components it could measure and renormalises over them', async () => {
    // Direction right (1.0 @ 0.5) and timeframe exact (1.0 @ 0.2). No magnitude
    // to score. Renormalised over 0.7 of weight, that is 1.0 — not 0.7.
    await decisionForecasting('d_two', { outcome_direction: 'positive', timeframe_days: 30 });

    await recordPredictionAccuracy(P, 'd_two', 'positive', null, 30);

    const row = await scoredRow();
    expect(row.magnitude_accuracy).toBeNull();
    expect(row.timeframe_accuracy).toBe(1);
    expect(row.composite_accuracy).toBe(1);
  });

  it('still weights all three when all three were measured', async () => {
    // Direction right (1.0 @ 0.5), magnitude off by half (0.5 @ 0.3),
    // timeframe off by half (0.5 @ 0.2) => 0.5 + 0.15 + 0.1 = 0.75.
    await decisionForecasting('d_all', {
      outcome_direction: 'positive', mrr_delta_pct: 10, timeframe_days: 30,
    });

    await recordPredictionAccuracy(P, 'd_all', 'positive', 15, 45);

    const row = await scoredRow();
    expect(row.magnitude_accuracy).toBeCloseTo(0.5, 10);
    expect(row.timeframe_accuracy).toBeCloseTo(0.5, 10);
    expect(row.composite_accuracy).toBeCloseTo(0.75, 10);
  });

  it('records no direction prediction as unscored, not as a wrong one', async () => {
    // The scenario forecast a magnitude and nothing else. It never claimed a
    // direction, so it cannot have got the direction wrong.
    await decisionForecasting('d_nodir', { mrr_delta_pct: 10 });

    await recordPredictionAccuracy(P, 'd_nodir', 'positive', 10, null);

    const row = await scoredRow();
    expect(row.direction_correct).toBeNull();
    expect(row.magnitude_accuracy).toBe(1);
    // Magnitude alone, renormalised, and it was exact.
    expect(row.composite_accuracy).toBe(1);
  });

  it('leaves the composite null when nothing in the forecast could be scored', async () => {
    await decisionForecasting('d_none', { rationale: 'vibes' });

    await recordPredictionAccuracy(P, 'd_none', 'positive', null, null);

    const row = await scoredRow();
    expect(row.direction_correct).toBeNull();
    expect(row.composite_accuracy).toBeNull();
    // And the scenario model's own copy of the verdict says the same thing.
    const sm = await query('SELECT outcome_accuracy FROM scenario_models WHERE id = ?', ['sm_d_none']);
    const verdict = JSON.parse((sm.rows[0] as unknown as { outcome_accuracy: string }).outcome_accuracy);
    expect(verdict.direction_correct).toBeNull();
    expect(verdict.composite_accuracy).toBeNull();
  });
});

describe('reporting how accurate Foundry has been', () => {
  it('reports null, not zero, when no forecast has ever been scored', async () => {
    const summary = await getPredictionAccuracySummary(P);

    expect(summary.total_predictions).toBe(0);
    // Zero here would be Foundry claiming it has never once been right.
    expect(summary.direction_accuracy).toBeNull();
    expect(summary.avg_composite_accuracy).toBeNull();
  });

  it('reports zero when forecasts were scored and none of them were right', async () => {
    await decisionForecasting('d_r1', { outcome_direction: 'positive' });
    await recordPredictionAccuracy(P, 'd_r1', 'negative', null, null);

    const summary = await getPredictionAccuracySummary(P);

    expect(summary.total_predictions).toBe(1);
    expect(summary.direction_accuracy).toBe(0);
    expect(summary.avg_composite_accuracy).toBe(0);
  });

  it('averages the direction rate over predictions that made one', async () => {
    await decisionForecasting('d_r2', { outcome_direction: 'positive' });
    await recordPredictionAccuracy(P, 'd_r2', 'positive', null, null);
    // This one never predicted a direction. It must not drag the rate down.
    await decisionForecasting('d_r3', { mrr_delta_pct: 10 });
    await recordPredictionAccuracy(P, 'd_r3', 'positive', 10, null);

    const summary = await getPredictionAccuracySummary(P);

    expect(summary.total_predictions).toBe(2);
    expect(summary.direction_accuracy).toBe(1);
  });
});
