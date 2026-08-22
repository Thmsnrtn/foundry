process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// A CURRENCY NOBODY COULD REPORT.
//
// Migration 011 added `metric_snapshots.local_currency_mrr` and
// `exchange_rate`. Nothing has ever written either — no ingest field, no
// integration, no route, no job. A company had no way to tell Foundry what its
// local-currency revenue was.
//
// One reader existed, `detectCurrencyErosion`, served live on
// `GET /api/currency-health`. Because the columns are always NULL, its `?? 0`
// fallbacks were the ENTIRE INPUT: zero minus zero is a flat local trend, and a
// flat local trend against a declining USD one is exactly the erosion
// condition. So the endpoint reported currency erosion whenever the other series
// fell — and that series was `new_mrr_cents`, one period's new business,
// compared against what would have been a level.
//
// Three faults, each sufficient on its own: an input nothing can supply, a
// fallback standing in for it, and two quantities of different kinds compared.
//
// Retired on the owner decision at migration 157. If currency exposure is
// wanted it comes back whole — an ingest field a company can fill, a stored
// rate, and a comparison between series of the same kind.
// =============================================================================

beforeAll(async () => { await runMigrations(); });

describe('the columns nothing could write', () => {
  it('are gone from metric_snapshots', async () => {
    const cols = ((await query('PRAGMA table_info(metric_snapshots)')).rows as unknown as
      Array<Record<string, unknown>>).map((c) => String(c.name));
    expect(cols).not.toContain('local_currency_mrr');
    expect(cols).not.toContain('exchange_rate');
  });

  it('and no code still reads them', () => {
    const hits: string[] = [];
    for (const f of ['src/services/intelligence/global.ts', 'src/routes/api/tier2.ts']) {
      const code = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
      if (/local_currency_mrr|exchange_rate/.test(code)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });
});

describe('the detector that could not detect', () => {
  it('is gone, and so is its route', () => {
    const global_ = stripComments(
      readFileSync('src/services/intelligence/global.ts', 'utf8'), { lineComments: true });
    expect(global_).not.toMatch(/detectCurrencyErosion/);

    const tier2 = stripComments(
      readFileSync('src/routes/api/tier2.ts', 'utf8'), { lineComments: true });
    expect(tier2).not.toMatch(/currency-health/);
    expect(tier2).not.toMatch(/detectCurrencyErosion/);
  });

  it('and the account of why survives in the source', () => {
    // The reason has to outlive the code, or the next reader rebuilds it.
    const global_ = readFileSync('src/services/intelligence/global.ts', 'utf8');
    expect(global_).toMatch(/NOTHING CAN FILL THE CURRENCY COLUMNS/);
    expect(global_).toMatch(/SO THE FALLBACK WAS THE WHOLE INPUT/);
    expect(global_).toMatch(/AND THE USD SERIES WAS THE WRONG QUANTITY/);
  });

  it('leaves the rest of the module intact', async () => {
    const { scanGeopoliticalRisks } = await import('../../src/services/intelligence/global.js');
    expect(typeof scanGeopoliticalRisks).toBe('function');
  });
});
