process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
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
// One reader existed, `detectCurrencyErosion` in the intelligence service.
// Because the columns are always NULL, its `?? 0` fallbacks were the ENTIRE
// INPUT: zero minus zero is a flat local trend, and a flat local trend against a
// declining USD one is exactly the erosion condition. So it reported currency
// erosion whenever the other series fell — and that series was `new_mrr_cents`,
// one period's new business, compared against what would have been a level.
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

  // The one module that read them, `intelligence/global.ts`, was deleted in
  // Roadmap 2027 R11, and the detector's cases went with it.
});
