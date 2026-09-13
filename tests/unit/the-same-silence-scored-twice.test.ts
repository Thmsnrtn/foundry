process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { detectEngagementTrend, computeMotivationScore } from '../../src/services/intelligence/founder-health.js';

// =============================================================================
// THE SAME SILENCE, SCORED TWICE, DIFFERENTLY.
//
// THE VALUE DELIVERY HALF IS GONE. `intelligence/value-delivery.ts` — the index
// that substituted a different value for each component a company had not
// reported (zero for four of them, the worst for time-to-value, the BEST for
// support rate), the writer that stored those substitutions beside the honest
// nulls they contradicted, and the onboarding benchmark that called an
// unmeasured product "Excellent" — was reachable from no entry point and has
// been deleted. The twelve cases here that held it to its own arithmetic went
// with it; the arithmetic was never fixed, the file that did it is simply gone.
//
// WHAT REMAINS IS THE PERSON. `detectEngagementTrend` returned 'stable' when it had fewer
// than three snapshots, so a founder Foundry knew nothing about was reported as
// engagement-stable. A snapshot with no motivation score counted as 50, and
// with no older window to compare against the baseline was 50 again — a trend
// measured against a number nobody recorded.
//
// The consumers only branch on 'declining' and 'critical', so 'unknown' changes
// no behaviour. The change is to what the system SAYS about a person.
// =============================================================================

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_v','c_v','v@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('p_v','Acme','f_v','active')");
});
beforeEach(async () => {
  await query('DELETE FROM founder_health_snapshots');
});

describe('a founder nobody has observed', () => {
  async function snapshot(score: number | null, daysAgo: number) {
    await query(
      `INSERT INTO founder_health_snapshots (id, founder_id, snapshot_date, motivation_score)
       VALUES (?, 'f_v', date('now', ?), ?)`,
      [nanoid(), `-${daysAgo} days`, score]);
  }

  it('has an unknown engagement trend, not a stable one', async () => {
    expect(await detectEngagementTrend('f_v'),
      "'stable' is a claim about a person, from no observation of that person")
      .toBe('unknown');
  });

  it('stays unknown when the snapshots carry no scores', async () => {
    for (let i = 1; i <= 5; i++) await snapshot(null, i);
    expect(await detectEngagementTrend('f_v'), 'five nulls used to become five 50s')
      .toBe('unknown');
  });

  it('stays unknown with no older window to compare against', async () => {
    await snapshot(60, 1); await snapshot(60, 2); await snapshot(60, 3);
    expect(await detectEngagementTrend('f_v'),
      'the delta used to be measured against a baseline of 50').toBe('unknown');
  });

  it('reports a real decline', async () => {
    await snapshot(40, 1); await snapshot(41, 2); await snapshot(42, 3);
    await snapshot(70, 4); await snapshot(71, 5); await snapshot(72, 6);
    expect(await detectEngagementTrend('f_v')).toBe('declining');
  });

  it('reports critical from the recent window alone', async () => {
    await snapshot(20, 1); await snapshot(21, 2); await snapshot(22, 3);
    expect(await detectEngagementTrend('f_v')).toBe('critical');
  });

  it('has no motivation score when nothing moved the baseline', async () => {
    expect(await computeMotivationScore('f_v'),
      '50 is a baseline, and a baseline nothing moved is not a measurement')
      .toBeNull();
  });
});

describe('the substitutions are gone from the source', () => {
  it('no midpoint stands where a person was not observed', () => {
    for (const f of ['src/services/intelligence/founder-health.ts',
                     'src/services/intelligence/predictive.ts']) {
      const code = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
      expect(code, `${f} still substitutes 50 for an unrecorded motivation`)
        .not.toMatch(/motivation_score \?\? 50/);
    }
  });

  it('the ledger no longer invents a company budget', () => {
    const code = stripComments(
      readFileSync('src/services/scp/agents/ledger.ts', 'utf8'), { lineComments: true });
    expect(code, 'a company that set no budget was given one of $50/month')
      .not.toMatch(/operating_budget_monthly_usd\) \|\| 50/);
    expect(code, 'and null MRR movement was reported to the financial agent as zero')
      .not.toMatch(/Number\(row\.churned_mrr_cents\) \|\| 0/);
  });
});
