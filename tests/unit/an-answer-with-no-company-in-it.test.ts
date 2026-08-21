process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// AN ANSWER WITH NO COMPANY IN IT.
//
// Four functions behind the `investor_layer` tier were given a product's NAME
// and SECTOR, asked a model for numbers, and returned those numbers as analysis
// to a paying endpoint. A moat strength of 62. An erosion rate of 4%/month. A
// switching-cost ratio. About a company from which the model had seen not one
// figure.
//
// The numbers are not removed — an estimate is a legitimate thing to sell. What
// is removed is the silence about what they are made of. Each now carries
// `estimated_from`, in the same shape and with the same word as
// `Forecast.projected_from`: what went in, and whether any of it was measured.
//
// THE NOT-FOUND BRANCHES WERE THE WORST OF IT. A product that could not be
// found got `risk_score: 0` (no platform risk), `moat_strength: 0`,
// `probability: 0` (the incumbent will certainly not respond), and a
// switching-cost ratio of exactly 1 with portability and depth of 50.
// Reassurance and midpoints, invented about nothing.
//
// A RATIO OVER NOTHING. When the model returned zero for the incumbent's cost,
// `switching_cost_ratio` became exactly 1 — "leaving us costs a customer
// precisely what leaving the incumbent costs them", a striking claim produced by
// a zero denominator.
//
// A DETECTION THAT DETECTED NOTHING. `detectMarketMigration` returned
// `migration_detected`, and the strategy brief passed `'None detected'` to a
// second model when it came back false — turning "we asked nothing that could
// find out" into a negative finding. It is `assessMarketShift` /
// `shift_indicated` now, and the brief says the line is judged from the
// category alone.
//
// I first recorded that function as having no caller and was wrong: the
// strategy brief calls it. It was corrected rather than removed.
// =============================================================================

const SRC = readFileSync('src/services/intelligence/competitive-v2.ts', 'utf8');
// The comments in that file explain what the old names were, so an assertion
// that a name is gone has to look at the code and not at the account of it.
// Same rule the scanners use.
const CODE = stripComments(SRC, { lineComments: true });

beforeAll(async () => { await runMigrations(); });

describe('the estimates say what they are made of', () => {
  it('every estimating function returns an evidence basis', () => {
    for (const fn of ['assessPlatformDependency', 'assessTechnologyMoat',
                      'analyzeSwitchingCosts', 'assessMarketShift',
                      'modelIncumbentResponse']) {
      const body = SRC.slice(SRC.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 1200), `${fn} does not declare estimated_from`)
        .toMatch(/estimated_from: EstimateBasis;/);
    }
  });

  it('uses the vocabulary the codebase already has', () => {
    // `Forecast.projected_from` in services/founder/intelligence.ts carries
    // `{ ..., measured: boolean }`. One word, one meaning, not a second
    // parallel scheme for the same idea.
    expect(SRC).toMatch(/measured: boolean;/);
    expect(readFileSync('src/services/founder/intelligence.ts', 'utf8'))
      .toMatch(/projected_from: \{ monthly_growth_pct: number; measured: boolean \}/);
  });

  it('never claims a company figure reached a category estimate', () => {
    expect(SRC).toMatch(/const FROM_DESCRIPTION_ONLY = \(fields: string\[\]\): EstimateBasis => \(\{\s*inputs: fields, measured: false,/);
  });
});

describe('nothing is invented about a company we cannot find', () => {
  it('returns null rather than a reassuring zero', () => {
    for (const bad of [
      /return \{ risk_score: 0, dependencies: \[\] \}/,
      /moat_strength: 0, erosion_rate: 0/,
      /probability: 0, timeline_months: 0/,
      /data_portability_score: 50, integration_depth_score: 50/,
    ]) {
      expect(SRC, `a not-found branch still answers with ${bad}`).not.toMatch(bad);
    }
    expect(SRC).toMatch(/risk_score: null/);
    expect(SRC).toMatch(/moat_strength: null/);
    expect(SRC).toMatch(/probability: null/);
  });

  it('does not divide by a zero it invented', () => {
    expect(SRC).toMatch(/result\.cost_to_leave_incumbent > 0\s*\?\s*result\.cost_to_leave_us \/ result\.cost_to_leave_incumbent\s*:\s*null;/);
    expect(SRC, 'a ratio of 1 is a claim, not an absence').not.toMatch(/cost_to_leave_incumbent\s*\n?\s*:\s*1;/);
  });
});

describe('the brief does not launder estimates into facts', () => {
  it('tells the second model which lines were measured and which were not', () => {
    const brief = SRC.slice(SRC.indexOf('export async function generateCompetitiveStrategyBrief'));
    expect(brief).toMatch(/No figure from this company went into them/);
    expect(brief).toMatch(/do not restate them as measurements/);
    expect(brief, 'and which lines ARE observed').toMatch(/The competitors and signals above ARE observed/);
  });

  it('no longer reports "None detected" for a question nobody asked', () => {
    expect(CODE).not.toMatch(/None detected/);
    expect(SRC).toMatch(/nothing was measured either way/);
  });

  it('renders a null estimate through the one place that decides unknown', () => {
    const brief = SRC.slice(SRC.indexOf('export async function generateCompetitiveStrategyBrief'));
    expect(brief).toMatch(/const \{ measured, ratePoints \} = await import\('\.\.\/ai\/measured\.js'\)/);
    expect(brief).toMatch(/\$\{measured\(moat\.moat_strength\)\}/);
    expect(brief, 'an erosion rate is a fraction and the slide wants points')
      .toMatch(/ratePoints\(moat\.erosion_rate\)/);
  });
});

describe('detection is not claimed where nothing was observed', () => {
  it('the word is gone from the function and the field', () => {
    expect(CODE).not.toMatch(/detectMarketMigration/);
    expect(CODE).not.toMatch(/migration_detected/);
    expect(SRC).toMatch(/export async function assessMarketShift/);
    expect(SRC).toMatch(/shift_indicated: boolean;/);
  });

  it('and the model is told it is reasoning from the category alone', () => {
    expect(SRC).toMatch(/No data about this company or its\s*\n?\s*market has been given to you/);
  });
});

describe('the unread row is retired', () => {
  it('switching_cost_analysis no longer exists', async () => {
    const rows = await query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='switching_cost_analysis'");
    expect(rows.rows.length).toBe(0);
  });

  it('and nothing still writes to it', () => {
    expect(SRC).not.toMatch(/INSERT INTO switching_cost_analysis/);
  });

  it('left the baseline shorter', () => {
    expect(readFileSync('docs/db/unread-tables-baseline.txt', 'utf8'))
      .not.toMatch(/switching_cost_analysis/);
  });
});
