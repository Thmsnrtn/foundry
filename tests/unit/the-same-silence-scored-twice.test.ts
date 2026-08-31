process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  assessTimeToFirstValue, computeValueDeliveryIndex, reportValueDeliveryMetrics,
  valueDeliveryIndexOf,
} from '../../src/services/intelligence/value-delivery.js';
import { detectEngagementTrend, computeMotivationScore } from '../../src/services/intelligence/founder-health.js';

// =============================================================================
// THE SAME SILENCE, SCORED TWICE, DIFFERENTLY.
//
// THE VALUE DELIVERY INDEX substituted a value for every component the company
// had not reported, and the substitutions disagreed with each other:
//
//   core_workflow_completion_rate ?? 0    unreported → 0
//   feature_utilization_breadth   ?? 0    unreported → 0
//   time_to_first_value_hours     ?? 100  100 - 100 = 0, the worst
//   engagement_depth_score        ?? 0    unreported → 0
//   support_ticket_rate           ?? 0    100 - 0 = 100, the BEST
//
// A company reporting nothing scored 15/100 — fifteen points of perfect support
// performance and zero for everything else. `if (!m) return 0` gave a company
// with no snapshot at all a flat zero on "how effectively the product delivers
// value". And `identifyValueDeliveryStressors` read the SAME missing breadth as
// 100, so one absence was worthless in the index and excellent in the stressor
// check, eighty lines apart in one file.
//
// `assessTimeToFirstValue` read a missing measurement as 0 hours, and 0 hours
// falls in its first branch: a product that had never measured onboarding was
// told it was "Excellent — users get value within minutes".
//
// ONE ROW TELLING THE TRUTH IN FIVE COLUMNS AND A LIE IN THE SIXTH.
// `reportValueDeliveryMetrics` stored null for every component the caller did
// not supply — correctly — and computed the stored `value_delivery_index` from
// those same absences coerced to 0 and 100.
//
// AND A PERSON. `detectEngagementTrend` returned 'stable' when it had fewer
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
  await query('DELETE FROM value_delivery_metrics');
  await query('DELETE FROM founder_health_snapshots');
});

describe('the value delivery index', () => {
  it('is null when the company has never reported', async () => {
    const vdi = await computeValueDeliveryIndex('p_v');
    expect(vdi.index, 'a flat 0 on "how effectively the product delivers value"').toBeNull();
    expect(vdi.coverage).toBeNull();
    expect(vdi.components_reported).toEqual([]);
  });

  it('is null when a snapshot exists with no components in it', () => {
    expect(valueDeliveryIndexOf({}).index).toBeNull();
  });

  it('averages over what was reported rather than over what was not', () => {
    const only = valueDeliveryIndexOf({ core_workflow_completion_rate: 80 });
    expect(only.index, 'the old weighting gave 80 * 0.30 = 24').toBe(80);
    expect(only.components_reported).toEqual(['core_workflow_completion_rate']);
    expect(only.coverage).toBeCloseTo(0.30, 5);
  });

  it('does not hand out the best score for an unreported support rate', () => {
    // 100 - 0 * 10 = 100 at weight 0.15 was fifteen free points.
    const v = valueDeliveryIndexOf({ core_workflow_completion_rate: 0 });
    expect(v.index).toBe(0);
  });

  it('does not hand out the worst score for an unreported time to value', () => {
    const v = valueDeliveryIndexOf({ support_ticket_rate: 0 });
    expect(v.index, '100 - 100 used to drag the index down by twenty points').toBe(100);
  });

  it('says how much of the weighting it actually saw', () => {
    const v = valueDeliveryIndexOf({ core_workflow_completion_rate: 80, engagement_depth_score: 60 });
    expect(v.coverage).toBeCloseTo(0.50, 5);
    expect(v.index, 'an index from half the weighting is not the same claim as a full one')
      .toBe(Math.round((80 * 0.30 + 60 * 0.20) / 0.50));
  });

  it('weights the components it does have', () => {
    const v = valueDeliveryIndexOf({
      core_workflow_completion_rate: 100, feature_utilization_breadth: 100,
      time_to_first_value_hours: 0, engagement_depth_score: 100, support_ticket_rate: 0,
    });
    expect(v.index).toBe(100);
    expect(v.coverage).toBeCloseTo(1, 5);
  });
});

describe('the stored index matches the stored components', () => {
  it('is null when the caller supplied nothing to compute it from', async () => {
    await reportValueDeliveryMetrics('p_v', 'f_v', {});
    const row = (await query('SELECT * FROM value_delivery_metrics')).rows[0] as Record<string, unknown>;
    expect(row.core_workflow_completion_rate).toBeNull();
    expect(row.value_delivery_index,
      'the row told the truth in five columns and a lie in the sixth').toBeNull();
  });

  it('is computed from what was supplied', async () => {
    await reportValueDeliveryMetrics('p_v', 'f_v', { core_workflow_completion_rate: 80 });
    const row = (await query('SELECT * FROM value_delivery_metrics')).rows[0] as Record<string, unknown>;
    expect(Number(row.value_delivery_index)).toBe(80);
  });
});

describe('time to first value', () => {
  it('does not call an unmeasured onboarding excellent', async () => {
    const ttfv = await assessTimeToFirstValue('p_v');
    expect(ttfv.hours).toBeNull();
    expect(ttfv.benchmark).toMatch(/Not measured/);
    expect(ttfv.benchmark).not.toMatch(/Excellent/);
    expect(ttfv.recommendation).toBeNull();
  });

  it('still judges a measured one', async () => {
    await query(
      `INSERT INTO value_delivery_metrics (id, product_id, owner_id, snapshot_date, time_to_first_value_hours)
       VALUES (?, 'p_v', 'f_v', date('now'), 0.2)`, [nanoid()]);
    expect((await assessTimeToFirstValue('p_v')).benchmark).toMatch(/Excellent/);
  });
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

  it("and psychology no longer reads an unknown motivation as the maximum", () => {
    const code = stripComments(
      readFileSync('src/services/intelligence/psychology.ts', 'utf8'), { lineComments: true });
    expect(code).not.toMatch(/motivation_score as number\) \?\? 100/);
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
