// =============================================================================
// Tests: a paid model call whose answer nobody reads.
//
// `scenarioAccuracy` asked Opus, once per decision and up to twenty per pass,
// to classify an outcome as positive/neutral/negative and score how close the
// base case had been. It wrote that answer to `scenario_models.outcome_accuracy`
// — a column no SELECT in this repository reads.
//
// The direction it was paying to infer is already a recorded fact:
// `decisions.outcome_valence`, which the prediction-accuracy job beside it
// reads deterministically and files in `prediction_accuracy`, a table that IS
// read. So the model was asked for something the database already knew, and
// the answer was filed where nobody looks.
//
// USE DETERMINISTIC SYSTEMS WHEN THE TRUTH IS DETERMINISTIC. Cognition pays
// rent or it goes.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir = 'src', out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const jobs = readFileSync('src/jobs/index.ts', 'utf8');
const scenarioJob = jobs.slice(
  jobs.indexOf('export async function scenarioAccuracy'),
  jobs.indexOf("logger.info('scenario_accuracy complete'"));

describe('the scenario accuracy pass buys nothing', () => {
  it('makes no model call', () => {
    expect(scenarioJob, 'a paid call in a job whose output nothing reads')
      .not.toMatch(/call(Opus|Sonnet|Haiku|Claude)\s*\(/);
  });

  it('reads the direction the founder already recorded', () => {
    expect(scenarioJob).toContain('outcome_valence');
  });

  it('does not invent a score to replace the one it stopped buying', () => {
    // Fabricating an accuracy figure to fill the same field would be worse
    // than the model call was: the call at least looked at something.
    expect(scenarioJob).toContain('scenarioAccuracyScore: null');
  });

  it('still contributes the outcome to the cross-company pool', () => {
    // What the job is FOR. Deleting the paid call must not delete the purpose.
    expect(scenarioJob).toContain('generatePatternFromOutcome');
  });
});

describe('the column it wrote to is genuinely unread', () => {
  it('has no reader anywhere in the source', () => {
    // The premise of the deletion, asserted rather than assumed. If a consumer
    // is ever built, this fails and the decision gets remade with evidence.
    const readers = sourceFiles().filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /SELECT[^;]*outcome_accuracy/i.test(src);
    });
    expect(readers, `outcome_accuracy is read by ${readers.join(', ')}`).toEqual([]);
  });
});
