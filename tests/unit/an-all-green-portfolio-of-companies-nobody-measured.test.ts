process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// AN ALL-GREEN PORTFOLIO OF COMPANIES NOBODY MEASURED.
//
// Every number in the portfolio overview was a placeholder or the wrong
// quantity, and the whole of it is served to an investor through the portfolio
// API.
//
//   `risk_state ?? 'green'`  a company with no lifecycle state at all was
//                            counted GREEN. A portfolio of companies Foundry
//                            knows nothing about rendered as a healthy one.
//   `total_mrr`              summed `new_mrr_cents + expansion_mrr_cents` — one
//                            period's MOVEMENT, not the level. A company at
//                            $50k MRR with a flat month contributed nothing.
//   `growth: 0`              beside the comment "Would compute from historical
//                            data". Every company grew 0%.
//   `avg_growth_rate: 0`     the same, at portfolio level.
//   `median_mrr: 0`          in the weekly snapshot, beside "Would compute
//                            median".
//   `avg_mrr`                divided by every member, including the ones that
//                            have never reported anything.
//
// AND THE LOWEST CHURN IN THE PORTFOLIO WAS TOLD TO PRIORITISE RETENTION.
// `product_percentile` was the share of peers with a LOWER VALUE, and the
// recommendations read a low percentile as poor performance. For every metric
// where higher is better that is right. For `churn_rate` it is exactly
// backwards: the company with the least churn scored 0 and was told its churn
// was in the bottom quartile.
//
// A metric the company had not reported was read as 0 — for churn the best
// possible value, for NPS among the worst. The same silence scored as excellent
// or dreadful depending on the column.
//
// Roadmap 2027 R12 deleted `portfolio/manager.ts` with the snapshot job that
// was its last caller, so the overview, snapshot and benchmark checks went with
// it. What stays is that the halves with nothing at the other end stay gone.
// =============================================================================

beforeAll(async () => { await runMigrations(); });

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return e.isFile() && p.endsWith('.ts') ? [p] : [];
  });
}

describe('the halves with nothing at the other end are gone', () => {
  it('portfolio_alerts', async () => {
    expect((await query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_alerts'")).rows.length).toBe(0);
    // `portfolio/manager.ts` was deleted in Roadmap 2027 R12; nothing in the
    // tree may name the writer now.
    const writers = sourceFiles('src').filter((f) =>
      /createPortfolioAlert/.test(stripComments(readFileSync(f, 'utf8'), { lineComments: true })));
    expect(writers).toEqual([]);
  });

  it('expansion_analysis, and the zero that was typed into it', async () => {
    expect((await query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='expansion_analysis'")).rows.length).toBe(0);
    // The zero was typed into `intelligence/expansion.ts`, which used to be
    // read here for the `INSERT INTO expansion_analysis` and the
    // `tam_penetration_rate` it wrote. That module was deleted as
    // production-dead, so the check is now that NOTHING in the tree names
    // either — a stronger statement than one file not naming them, and one that
    // does not have to be repointed the next time a writer moves.
    const namers = sourceFiles('src').filter((f) => {
      const src = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
      return /expansion_analysis|tam_penetration_rate/.test(src);
    });
    expect(namers, 'a writer for a table that is gone').toEqual([]);
  });
});
