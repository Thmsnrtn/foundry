// =============================================================================
// Tests: "we could not tell" is not "we proved it false"
//
// `experiments.winner` already had three values — control, treatment,
// inconclusive — because an experiment can end without separating its arms.
// `hypotheses.status` had six and none of them meant that, so the write that
// records a result had nowhere to put the commonest outcome:
//
//     const newStatus = results.significant ? 'completed' : 'disproven';
//
// Every experiment that failed to detect an effect marked its hypothesis
// disproven. That is the record the next agent reads before proposing again,
// so an untested idea looked closed — and `disproven_evidence`, the column the
// schema created to hold WHY, stayed NULL, because there was no why.
//
// Two further things were wrong in the same function, and both were invisible
// for the same reason: nothing calls it yet.
//
//   • it wrote `WHERE id = ?` with no product scope, in a file where every
//     reachable sibling takes a `scopeProductId` and uses it. So did
//     `validateHypothesis`. An unreachable cross-tenant write is a
//     cross-tenant write with a date on it.
//   • a significant result where CONTROL won was recorded as 'completed' —
//     the hypothesis succeeded — when control winning is the one outcome that
//     actually contradicts it.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const F = 'exo_founder';
const MINE = 'exo_mine';
const THEIRS = 'exo_theirs';

async function seedExperiment(id: string, productId: string): Promise<string> {
  const hypId = `${id}_hyp`;
  await query(
    `INSERT INTO hypotheses (id, product_id, proposed_by, statement, status)
     VALUES (?, ?, 'oracle', 'Day-3 email lifts conversion.', 'active')`,
    [hypId, productId]);
  await query(
    `INSERT INTO experiments
       (id, product_id, hypothesis_id, name, type, control_description,
        treatment_description, success_metric, status)
     VALUES (?, ?, ?, 'Day-3 email', 'ab_test', 'no email', 'email',
             'trial_to_paid', 'running')`,
    [id, productId, hypId]);
  return hypId;
}

async function statusOf(hypId: string): Promise<Record<string, unknown>> {
  return (await query(
    'SELECT status, disproven_evidence FROM hypotheses WHERE id = ?', [hypId]))
    .rows[0] as Record<string, unknown>;
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'exo_clerk', 'exo@example.com']);
  for (const [id, name] of [[MINE, 'Mine'], [THEIRS, 'Theirs']]) {
    await query(
      `INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?, 'active')`,
      [id, name, F]);
  }
});

beforeEach(async () => {
  await query(`DELETE FROM experiments`);
  await query(`DELETE FROM hypotheses`);
});

describe('the schema has a name for an inconclusive result', () => {
  it('accepts it', async () => {
    await query(
      `INSERT INTO hypotheses (id, product_id, proposed_by, statement, status)
       VALUES ('exo_inc', ?, 'oracle', 'x', 'inconclusive')`, [MINE]);
    expect((await statusOf('exo_inc')).status).toBe('inconclusive');
  });

  it('and still refuses a status nobody defined', async () => {
    // The rebuild must not have dropped the constraint on the way past. A
    // CHECK quietly widened to "anything" is how vocabularies rot.
    await expect(query(
      `INSERT INTO hypotheses (id, product_id, proposed_by, statement, status)
       VALUES ('exo_bad', ?, 'oracle', 'x', 'probably_true')`, [MINE]))
      .rejects.toThrow();
  });
});

describe('the outcome recorded is the outcome observed', () => {
  it('records an undetectable effect as inconclusive, not disproven', async () => {
    const { updateResults } = await import('../../src/services/scp/experiments.js');
    const hyp = await seedExperiment('exo_e1', MINE);
    await updateResults('exo_e1', {
      control_mean: 0.10, treatment_mean: 0.11, p_value: 0.42,
      effect_size: 0.01, significant: false,
    }, MINE);

    const row = await statusOf(hyp);
    expect(row.status, 'failing to detect an effect is not establishing its absence')
      .toBe('inconclusive');
    expect(row.disproven_evidence, 'and nothing was disproven, so there is no evidence')
      .toBeNull();
  });

  it('records the experiment itself as completed with no winner', async () => {
    const { updateResults } = await import('../../src/services/scp/experiments.js');
    await seedExperiment('exo_e2', MINE);
    await updateResults('exo_e2', {
      control_mean: 0.10, treatment_mean: 0.11, p_value: 0.42,
      effect_size: 0.01, significant: false,
    }, MINE);
    const exp = (await query(
      'SELECT status, winner FROM experiments WHERE id = ?', ['exo_e2']))
      .rows[0] as Record<string, unknown>;
    expect(exp.status, 'the experiment ran to completion — that much is true')
      .toBe('completed');
    expect(exp.winner).toBe('inconclusive');
  });

  it('records a treatment win as completed', async () => {
    const { updateResults } = await import('../../src/services/scp/experiments.js');
    const hyp = await seedExperiment('exo_e3', MINE);
    await updateResults('exo_e3', {
      control_mean: 0.10, treatment_mean: 0.19, p_value: 0.01,
      effect_size: 0.09, significant: true,
    }, MINE);
    expect((await statusOf(hyp)).status).toBe('completed');
  });

  it('records a control win as disproven, and says what disproved it', async () => {
    // This is the one case that genuinely contradicts the hypothesis, and it
    // used to be filed as a success because `significant` was true.
    const { updateResults } = await import('../../src/services/scp/experiments.js');
    const hyp = await seedExperiment('exo_e4', MINE);
    await updateResults('exo_e4', {
      control_mean: 0.19, treatment_mean: 0.10, p_value: 0.01,
      effect_size: -0.09, significant: true,
    }, MINE);

    const row = await statusOf(hyp);
    expect(row.status, 'the treatment lost — the statement was contradicted')
      .toBe('disproven');
    expect(String(row.disproven_evidence ?? ''),
      'a claim of contradiction has to carry what contradicted it')
      .toMatch(/control/i);
    expect(String(row.disproven_evidence ?? '')).toMatch(/0\.19/);
  });
});

describe('a result may only be written by the company that owns the experiment', () => {
  it('refuses an experiment belonging to another product', async () => {
    const { updateResults } = await import('../../src/services/scp/experiments.js');
    const hyp = await seedExperiment('exo_e5', THEIRS);
    await expect(updateResults('exo_e5', {
      control_mean: 0.1, treatment_mean: 0.2, p_value: 0.01,
      effect_size: 0.1, significant: true,
    }, MINE)).rejects.toThrow(/not found/);

    const exp = (await query(
      'SELECT status FROM experiments WHERE id = ?', ['exo_e5']))
      .rows[0] as Record<string, unknown>;
    expect(exp.status, 'the other company’s experiment must be untouched').toBe('running');
    expect((await statusOf(hyp)).status).toBe('active');
  });

  it('refuses a hypothesis belonging to another product', async () => {
    const { validateHypothesis } = await import('../../src/services/scp/experiments.js');
    const hyp = await seedExperiment('exo_e6', THEIRS);
    await validateHypothesis(hyp, {
      validatedBy: 'oracle', nullHypothesis: 'no effect',
      minimumDetectableEffect: 0.05, requiredSampleSize: 500,
      estimatedDurationDays: 14,
    }, MINE);

    const row = (await query(
      'SELECT validated_by, null_hypothesis FROM hypotheses WHERE id = ?', [hyp]))
      .rows[0] as Record<string, unknown>;
    expect(row.validated_by, 'a foreign hypothesis id must reach nothing').toBeNull();
    expect(row.null_hypothesis).toBeNull();
  });

  it('lets the owner do both', async () => {
    const { updateResults, validateHypothesis } = await import(
      '../../src/services/scp/experiments.js');
    const hyp = await seedExperiment('exo_e7', MINE);
    await validateHypothesis(hyp, {
      validatedBy: 'oracle', nullHypothesis: 'no effect',
      minimumDetectableEffect: 0.05, requiredSampleSize: 500,
      estimatedDurationDays: 14,
    }, MINE);
    expect((await query(
      'SELECT validated_by FROM hypotheses WHERE id = ?', [hyp]))
      .rows[0] as Record<string, unknown>).toMatchObject({ validated_by: 'oracle' });

    await updateResults('exo_e7', {
      control_mean: 0.1, treatment_mean: 0.2, p_value: 0.01,
      effect_size: 0.1, significant: true,
    }, MINE);
    expect((await statusOf(hyp)).status).toBe('completed');
    // A guard that refuses the legitimate caller is not extra secure.
  });
});

describe('no write in this file escapes the product scope', () => {
  // The two that drifted were the two nothing called. A static gate catches the
  // third before it has a caller either.
  const source = readFileSync(
    resolve(__dirname, '../../src/services/scp/experiments.ts'), 'utf8');

  it('every UPDATE of an experiment or hypothesis names product_id', () => {
    const offenders: string[] = [];
    for (const m of source.matchAll(
      /UPDATE\s+(experiments|hypotheses)\s+SET[\s\S]*?WHERE[^`]*/gi)) {
      if (!/product_id\s*=\s*\?/i.test(m[0])) {
        offenders.push(m[0].split('\n')[0].trim());
      }
    }
    expect(offenders, 'an unscoped write is one caller away from a cross-tenant write')
      .toEqual([]);
  });

  it('every mutator takes the scope as an argument', () => {
    for (const fn of ['validateHypothesis', 'updateResults', 'startExperiment',
      'stopEarlyExperiment', 'approveAndCreateExperiment']) {
      const decl = source.slice(source.indexOf(`export async function ${fn}(`));
      expect(decl.slice(0, decl.indexOf('): Promise')),
        `${fn} decides on behalf of a company and must be told which`)
        .toMatch(/scopeProductId: string/);
    }
  });
});
