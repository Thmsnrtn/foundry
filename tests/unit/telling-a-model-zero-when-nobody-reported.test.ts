process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import {
  pctOfFraction, measured, money, rate, UNKNOWN,
} from '../../src/services/ai/measured.js';

// =============================================================================
// TELLING A MODEL ZERO WHEN NOBODY REPORTED.
//
// Four agents read a company's `metric_snapshots` and put the numbers into a
// prompt. When the company had reported nothing, all four wrote the same line:
//
//     const churnRate = metrics ? (Number(metrics.churn_rate) || 0) * 100 : 0;
//
// and the prompt read `Churn rate: 0.0%. NPS: 0.0.` — not an absence of data,
// a claim of excellent retention and a mediocre NPS. Harbor's system prompt
// then says, in these words, "You do not hedge when customer data is clear",
// and asks for named accounts and specific dollar amounts.
//
// So this was never only about a reader misreading a zero. A model was handed
// fabricated facts under an instruction to be confident, and its output reaches
// a founder as advice about their own company.
//
// It also crossed a threshold. `if (activationRate < 30)` fired a founder-
// facing "Low activation rate (0.0%) — acquisition quality concern" message at
// companies that had reported no metrics at all.
//
// THE RULE ALREADY EXISTED. `jobs/index.ts` writes
// `m.activation_rate != null ? … : 'unknown'` for the same columns, from the
// same table, for the same reader. One rule, two implementations, and the
// wrong one was in four files. `ai/measured.ts` states it once.
// =============================================================================

describe('the one place the rule is stated', () => {
  it('says unknown for a fraction nobody reported', () => {
    expect(pctOfFraction(null)).toBe(UNKNOWN);
    expect(pctOfFraction(undefined)).toBe(UNKNOWN);
    expect(pctOfFraction('')).toBe(UNKNOWN);
  });

  it('says zero for a fraction somebody reported as zero', () => {
    expect(pctOfFraction(0), 'a recorded zero is a finding').toBe('0.0%');
    expect(pctOfFraction(0.125)).toBe('12.5%');
    expect(pctOfFraction(0.125, 0)).toBe('13%');
  });

  it('distinguishes an unrecorded score from a bad one', () => {
    expect(measured(null), 'never audited').toBe(UNKNOWN);
    expect(measured(0), 'audited, scored zero').toBe('0');
    expect(measured(-42), 'NPS runs to -100; zero is not its floor').toBe('-42');
    expect(measured(0.5, 2)).toBe('0.50');
  });

  it('distinguishes no amount from no money', () => {
    expect(money(null)).toBe(UNKNOWN);
    expect(money(0)).toBe('$0.00');
    expect(money(12345)).toBe('$123.45');
  });

  it('refuses a rate over an empty denominator rather than picking a digit', () => {
    expect(rate(0, 0), 'every inline version of this chose 0 or 100').toBe(UNKNOWN);
    expect(rate(5, -1)).toBe(UNKNOWN);
    expect(rate(3, 4)).toBe('75.0%');
  });

  it('does not mistake a non-numeric value for zero', () => {
    expect(pctOfFraction('not a number')).toBe(UNKNOWN);
    expect(measured(NaN)).toBe(UNKNOWN);
  });
});

function agentSources(): string[] {
  const dir = 'src/services/scp/agents';
  return readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => join(dir, f));
}

describe('no agent turns an unreported metric into a number', () => {
  it('holds no `|| 0` coercion of a rate anywhere', () => {
    const offenders = agentSources().filter((f) =>
      /\|\|\s*0\)\s*\*\s*100/.test(stripComments(readFileSync(f, 'utf8'), { lineComments: true })));
    expect(offenders, 'the exact shape that put 0.0% into fourteen prompts').toEqual([]);
  });

  it('holds no `|| 0` on the metric columns that carry null', () => {
    const columns = ['activation_rate', 'day_30_retention', 'churn_rate', 'nps_score',
      'mrr_health_ratio', 'avg_activation'];
    const offenders: string[] = [];
    for (const f of agentSources()) {
      const src = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
      for (const col of columns) {
        if (new RegExp(`${col}\\s*\\)?\\s*\\|\\|\\s*0`).test(src)) offenders.push(`${f}:${col}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reaches the shared helper rather than restating the rule', () => {
    const users = agentSources().filter((f) =>
      /from '\.\.\/\.\.\/ai\/measured\.js'/.test(readFileSync(f, 'utf8')));
    expect(users.length, 'harbor, beacon, prism, oracle, forge').toBeGreaterThanOrEqual(5);
  });

  it('does not let an unknown health ratio read as perfect revenue health', () => {
    const forge = stripComments(
      readFileSync('src/services/scp/agents/forge.ts', 'utf8'), { lineComments: true });
    // Migration 001: mrr_health_ratio is "null if new is 0". The prompt calls
    // >1.0 critical, so 0.00 was the most favourable reading available.
    expect(forge).not.toMatch(/Number\(latest\.mrr_health_ratio\) \|\| 0/);
    expect(forge).toMatch(/healthRatio !== null && healthRatio > 1\.2/);
    expect(forge, 'a founder with no tier is not a founder on the cheapest one')
      .not.toMatch(/\.tier as string\) \?\? 'solo'/);
  });
});

describe('an unknown rate raises nothing', () => {
  it('guards every threshold that used to fire on the fabricated zero', () => {
    const harbor = stripComments(
      readFileSync('src/services/scp/agents/harbor.ts', 'utf8'), { lineComments: true });
    expect(harbor, 'a company with no metrics is not a company with 0% activation')
      .not.toMatch(/if \(activationRate < 30\)/);
    expect(harbor).toMatch(/activationRate !== null && activationRate < 30/);
    expect(harbor).toMatch(/churnRate !== null && churnRate > 5/);
  });

  it('puts the helper, not a formatted number, into the prompts', () => {
    const harbor = readFileSync('src/services/scp/agents/harbor.ts', 'utf8');
    expect(harbor).toMatch(/Churn rate: \$\{pctOfFraction\(metrics\?\.churn_rate\)\}/);
    expect(harbor).toMatch(/NPS: \$\{measured\(metrics\?\.nps_score, 1\)\}/);

    const oracle = readFileSync('src/services/scp/agents/oracle.ts', 'utf8');
    expect(oracle, 'a column a company stopped reporting became a run of zeros')
      .toMatch(/activation=\$\{activation\}/);
  });
});
