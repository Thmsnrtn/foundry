process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordPredictionAccuracy } from '../../src/services/temporal/prediction-accuracy.js';

// =============================================================================
// A FORECAST FOR THE PATH NOT TAKEN, SCORED AS IF IT WERE.
//
// `scenario.ts` writes one scenario model PER OPTION — a decision with three
// options has three forecasts, one of which may be the ghost: what happens if
// you do nothing. The accuracy scorer read `WHERE decision_id = ? LIMIT 1` with
// no ORDER BY, so which forecast it graded was arbitrary. An outcome that
// followed the founder raising prices could be scored against the prediction
// for leaving them alone.
//
// It then wrote that arbitrary scenario's `option_label` into a column called
// `option_chosen`, so the record STATED it as the option the founder picked,
// and stamped `outcome_accuracy` on that scenario's row.
//
// Foundry scoring its own forecasts is the one place the institution is its own
// subject. `decisions.chosen_option` holds what was actually chosen and the job
// that calls this already selected it — one call short of the code that needed
// it.
// =============================================================================

const P = 'p_pa';
const D = 'd_pa';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_pa','c_pa','pa@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_pa','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM prediction_accuracy');
  await query('DELETE FROM scenario_models');
  await query('DELETE FROM decisions');
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, chosen_option)
     VALUES (?, ?, 'strategic', 2, 'Raise prices?', 'renewals', 'approved', 'Raise prices 20%')`,
    [D, P]);

  // Three forecasts, one per option. The ghost is deliberately first by
  // insertion order, which is what an unordered LIMIT 1 tends to return.
  const models: Array<[string, string, string]> = [
    ['sm_ghost', 'Do nothing', 'negative'],
    ['sm_raise', 'Raise prices 20%', 'positive'],
    ['sm_bundle', 'Bundle instead', 'neutral'],
  ];
  for (const [id, label, direction] of models) {
    await query(
      `INSERT INTO scenario_models
         (id, decision_id, product_id, option_label, best_case, base_case, stress_case, data_inputs_used)
       VALUES (?, ?, ?, ?, '{}', ?, '{}', '[]')`,
      [id, D, P, label, JSON.stringify({ outcome_direction: direction })]);
  }
});

const accuracyRow = async () => (await query(
  'SELECT scenario_model_id, option_chosen, predicted_outcome_direction, direction_correct FROM prediction_accuracy WHERE decision_id = ?',
  [D])).rows as unknown as Array<{
    scenario_model_id: string; option_chosen: string;
    predicted_outcome_direction: string; direction_correct: number | null;
  }>;

describe('scoring a decision', () => {
  it('grades the forecast for the option the founder chose', async () => {
    await recordPredictionAccuracy(P, D, 'positive', null, null, 'Raise prices 20%');

    const [row] = await accuracyRow();
    expect(row.scenario_model_id).toBe('sm_raise');
    expect(row.predicted_outcome_direction).toBe('positive');
    expect(row.direction_correct).toBe(1);
  });

  it('records the option the founder chose, not the one it happened to read', async () => {
    await recordPredictionAccuracy(P, D, 'positive', null, null, 'Raise prices 20%');

    const [row] = await accuracyRow();
    expect(row.option_chosen).toBe('Raise prices 20%');
  });

  it('does not grade the ghost when the founder acted', async () => {
    // The ghost predicted 'negative'; the outcome was positive. Grading against
    // it would record Foundry's forecast as wrong for a path nobody took.
    await recordPredictionAccuracy(P, D, 'positive', null, null, 'Raise prices 20%');

    const [row] = await accuracyRow();
    expect(row.scenario_model_id).not.toBe('sm_ghost');
    const ghost = (await query("SELECT outcome_accuracy FROM scenario_models WHERE id = 'sm_ghost'"))
      .rows[0] as unknown as { outcome_accuracy: string | null };
    expect(ghost.outcome_accuracy, 'the untaken forecast is not stamped').toBeNull();
  });

  it('matches the label whatever its case and spacing', async () => {
    await recordPredictionAccuracy(P, D, 'positive', null, null, '  raise PRICES 20%  ');
    const [row] = await accuracyRow();
    expect(row.scenario_model_id).toBe('sm_raise');
  });
});

describe('when there is nothing to grade', () => {
  it('records nothing when no option was chosen', async () => {
    await recordPredictionAccuracy(P, D, 'positive', null, null, null);
    expect(await accuracyRow()).toHaveLength(0);
  });

  it('records nothing when no forecast exists for the path taken', async () => {
    // Recording the nearest forecast instead is the defect this replaced.
    await recordPredictionAccuracy(P, D, 'positive', null, null, 'Something nobody modelled');
    expect(await accuracyRow()).toHaveLength(0);
  });
});
