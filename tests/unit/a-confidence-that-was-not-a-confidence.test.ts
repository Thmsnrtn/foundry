process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { analyzeExperiment, twoSidedConfidence } from '../../src/services/experiments/engine.js';

// =============================================================================
// A CONFIDENCE THAT WAS NOT A CONFIDENCE.
//
// This is the function that tells a founder "X wins with 95% confidence. Roll
// out to 100%." The number in that sentence was computed like this:
//
//     confidence = z >= 2.58 ? 0.99 : z >= 1.96 ? 0.95 : z >= 1.65 ? 0.90
//               : z / 1.96 * 0.95;
//
// The last branch is a straight line through the origin. It has nothing to do
// with a normal distribution: at z = 1 it reported 48%, where the true
// two-sided confidence is 68.3%. The bands above it are no better — everything
// between z = 1.96 and z = 2.58 was printed as exactly 95%, so a result at
// z = 2.5, genuinely 98.8%, was reported as scraping the threshold.
//
// A number labelled "% confidence" beside an instruction to roll a change out
// to every customer has to be the number it is labelled as.
//
// AND EVERY REASON THE TEST COULD NOT RUN REPORTED "0% confidence", which reads
// as a measured absence of effect rather than the absence of a test. Three of
// them are ordinary:
//
//   • Not exactly two variants. The test is two-proportion, so a three-arm
//     experiment was NEVER analysed — and said "Not yet significant (0%). Need
//     more data." however much data arrived. More data would not have helped.
//   • Fewer than thirty exposures in an arm. Genuinely too thin.
//   • A standard error of zero, which happens when both arms convert at
//     IDENTICAL rates, including both at zero. That is a finding — the variants
//     do not differ — and the message asked for more data.
//
// EVERY LOOK IS A TEST. `analyzeExperiment` completes the experiment the first
// time it sees significance, and a founder can call it as often as they like,
// so a single test's 5% false-positive rate is the floor rather than the
// figure. Sequential correction is a design decision; saying so where the
// winner is declared is not, and a caveat the founder can read beats a number
// that quietly assumes they looked once.
// =============================================================================

const P = 'p_exp';

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_e','c_e','e@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_e','active')", [P]);
  await query(
    `INSERT INTO hypotheses (id, product_id, proposed_by, statement, status)
     VALUES ('h_exp', ?, 'oracle', 'Shorter onboarding converts better', 'active')`, [P]);
});

beforeEach(async () => {
  await query('DELETE FROM experiment_events');
  await query('DELETE FROM experiments WHERE product_id = ?', [P]);
});

async function experiment(id: string, variants: string[]): Promise<void> {
  await query(
    `INSERT INTO experiments
       (id, product_id, hypothesis_id, owner_id, name, hypothesis, type,
        control_description, treatment_description, success_metric,
        experiment_type, status, variants, primary_metric)
     VALUES (?, ?, 'h_exp', 'f_e', 'Onboarding', 'Shorter converts', 'ab_test',
             'long', 'short', 'signup', 'onboarding', 'running', ?, 'signup')`,
    [id, P, JSON.stringify(variants.map((name) => ({ name, description: name })))]);
}

async function exposures(id: string, variant: string, n: number, conversions: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await query(
      `INSERT INTO experiment_events (id, experiment_id, variant, event_type, value)
       VALUES (?, ?, ?, 'exposure', 1)`, [nanoid(), id, variant]);
  }
  for (let i = 0; i < conversions; i++) {
    await query(
      `INSERT INTO experiment_events (id, experiment_id, variant, event_type, value)
       VALUES (?, ?, ?, 'signup', 1)`, [nanoid(), id, variant]);
  }
}

describe('the confidence number means what it is labelled', () => {
  it('matches the textbook two-sided values at the classic z-scores', () => {
    expect(twoSidedConfidence(1.959964)).toBeCloseTo(0.95, 4);
    expect(twoSidedConfidence(2.575829)).toBeCloseTo(0.99, 4);
    expect(twoSidedConfidence(1.644854)).toBeCloseTo(0.90, 4);
    expect(twoSidedConfidence(0)).toBeCloseTo(0, 6);
  });

  it('does not report a z of 1 as 48%, which the straight line did', () => {
    // The true two-sided confidence at z = 1 is 68.27%.
    expect(twoSidedConfidence(1)).toBeCloseTo(0.6827, 3);
    expect(twoSidedConfidence(1)).not.toBeCloseTo(1 / 1.96 * 0.95, 2);
  });

  it('is symmetric and bounded, whatever sign or size it is handed', () => {
    expect(twoSidedConfidence(-2.5)).toBeCloseTo(twoSidedConfidence(2.5), 10);
    expect(twoSidedConfidence(50)).toBe(1);
  });
});

describe('an experiment that cannot be tested says so', () => {
  it('does not report a three-arm experiment as 0% confident forever', async () => {
    await experiment('e_three', ['a', 'b', 'c']);
    for (const v of ['a', 'b', 'c']) await exposures('e_three', v, 500, 100);

    const r = await analyzeExperiment('e_three');

    // Five hundred exposures per arm. "Need more data" was never the problem.
    expect(r.confidence_level).toBeNull();
    expect(r.significant).toBe(false);
    expect(r.recommendation).toContain('two variants');
    expect(r.recommendation).not.toContain('0.0%');
  });

  it('says the arms are too thin when they are, and how thin', async () => {
    await experiment('e_thin', ['a', 'b']);
    await exposures('e_thin', 'a', 10, 3);
    await exposures('e_thin', 'b', 10, 6);

    const r = await analyzeExperiment('e_thin');

    expect(r.confidence_level).toBeNull();
    expect(r.recommendation).toContain('30 in each arm');
  });

  it('calls two identical arms a finding, not a shortage of data', async () => {
    await experiment('e_same', ['a', 'b']);
    await exposures('e_same', 'a', 500, 0);
    await exposures('e_same', 'b', 500, 0);

    const r = await analyzeExperiment('e_same');

    expect(r.confidence_level).toBeNull();
    expect(r.recommendation).toContain('same rate');
    expect(r.recommendation).not.toContain('more data');
  });

  it('reports no conversion rate for an arm nobody was exposed to', async () => {
    await experiment('e_none', ['a', 'b']);
    await exposures('e_none', 'a', 40, 10);

    const r = await analyzeExperiment('e_none');

    // Zero is a conversion rate. No exposures is not one.
    expect(r.variant_metrics.b?.conversion).toBeNull();
    expect(r.variant_metrics.a?.conversion).toBeCloseTo(0.25, 6);
  });
});

describe('an experiment that can be tested', () => {
  it('reports a real confidence and names the peeking problem when it declares a winner', async () => {
    await experiment('e_win', ['a', 'b']);
    await exposures('e_win', 'a', 1000, 100);   // 10%
    await exposures('e_win', 'b', 1000, 160);   // 16%

    const r = await analyzeExperiment('e_win');

    expect(r.significant).toBe(true);
    expect(r.winner).toBe('b');
    expect(r.confidence_level).not.toBeNull();
    expect(r.confidence_level!).toBeGreaterThan(0.99);
    // Not a band. The old code would have printed exactly 99% for anything
    // above z = 2.58.
    expect(r.confidence_level!).not.toBe(0.99);
    expect(r.recommendation).toContain('Checking repeatedly');

    // AND THE WRITE SUCCEEDS, which is the part that used to throw.
    // `experiments.winner` is CHECK(winner IN ('control','treatment',
    // 'inconclusive')) and this wrote the VARIANT NAME, so the CHECK refused
    // the UPDATE and the whole request errored — the success path was the
    // broken one. An experiment that never reached significance returned fine.
    const row = (await query(
      "SELECT status, winner, results_json, confidence_level FROM experiments WHERE id = 'e_win'"))
      .rows[0] as unknown as {
        status: string; winner: string; results_json: string | null; confidence_level: number };
    expect(row.status).toBe('completed');
    // The stored value speaks the vocabulary every other reader speaks —
    // scp/experiments.ts branches on 'control' and selects WHERE winner =
    // 'treatment'; the board packet renders 'inconclusive'.
    expect(row.winner).toBe('treatment');
    // While the RESULT keeps the variant's own name, because that is what a
    // founder reads. The two are different things.
    expect(r.winner).toBe('b');
    // results_json, not results: every other reader on this table uses it.
    expect(row.results_json).not.toBeNull();
    expect(row.confidence_level).toBeGreaterThan(0.99);
  });

  it('reports a measured near-tie as measured, not as missing', async () => {
    await experiment('e_close', ['a', 'b']);
    await exposures('e_close', 'a', 500, 100);
    await exposures('e_close', 'b', 500, 105);

    const r = await analyzeExperiment('e_close');

    expect(r.significant).toBe(false);
    expect(r.confidence_level).not.toBeNull();
    expect(r.recommendation).toContain('Measured');
  });
});
