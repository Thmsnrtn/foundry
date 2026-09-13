process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// AN ANSWER WITH NO COMPANY IN IT — AND THE TABLE IT LEFT BEHIND.
//
// Four functions behind the `investor_layer` tier were given a product's NAME
// and SECTOR, asked a model for numbers, and returned those numbers as analysis
// to a paying endpoint: a moat strength of 62, an erosion rate of 4%/month, a
// switching-cost ratio — about a company from which the model had seen not one
// figure. The repair was not to remove the estimates but to make each carry
// `estimated_from`: what went in, and whether any of it was measured. Alongside
// it went the reassuring not-found branches (`risk_score: 0`, `probability: 0`,
// a switching-cost ratio of exactly 1 over a zero denominator) and a
// `detectMarketMigration` whose false answer the strategy brief passed on as
// "None detected".
//
// `intelligence/competitive-v2.ts` IS NOW GONE — reachable from no entry point
// — and the eleven cases that read it went with the file they were reading.
// None of them can be restated without it: every one asserted on that source.
//
// What outlives it is the retirement it triggered. `switching_cost_analysis`
// was the table it wrote and nothing read, and a table stays retired only if
// something keeps checking.
// =============================================================================

beforeAll(async () => { await runMigrations(); });

describe('the unread row is retired', () => {
  it('switching_cost_analysis no longer exists', async () => {
    const rows = await query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='switching_cost_analysis'");
    expect(rows.rows.length).toBe(0);
  });

  // The case that read `competitive-v2.ts` for a surviving INSERT went with
  // that file: the only writer the table ever had was inside it.

  it('left the baseline shorter', () => {
    expect(readFileSync('docs/db/unread-tables-baseline.txt', 'utf8'))
      .not.toMatch(/switching_cost_analysis/);
  });
});
