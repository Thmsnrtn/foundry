process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { ratePoints } from '../../src/services/ai/measured.js';

// =============================================================================
// A FRACTION COMPARED AGAINST A PERCENTAGE.
//
// `activation_rate`, `churn_rate`, `day_30_retention` and `mrr_health_ratio`
// are stored as 0–1 fractions. The ingest endpoint validates that range and
// `ux/fluency.ts` names them as fractions in so many words. Five readers
// treated them as percentage points.
//
// The failure is silent in a particular way, and that is the part worth
// carrying: every "higher is better" test fails (`0.68 >= 40`) and every "lower
// is better" test passes (`0.02 <= 3`). So a company scored ZERO for excellent
// retention and FULL MARKS for catastrophic churn, and nothing looked broken
// from either side.
//
// Concretely, in `scp/investor/fundraising-readiness.ts`: six of the ten points
// in `scoreTraction` were unreachable by any company — growth, customers and
// retention — while churn always awarded its two whatever the number. And two
// of those three were unreachable for a second reason: `mrr_growth_pct` and
// `customer_count` ARE NOT COLUMNS on `metric_snapshots`, read off a `SELECT *`
// row and `undefined` forever. `d30_retention` is not a column either; the real
// one is `day_30_retention`, sitting there with the data in it.
//
// In `network/failure-library.ts`, `match_criteria: { churn_rate_gt: 8 }` means
// eight per cent, so no failure pattern keyed on churn could match for any
// company — the library kept matching on its other criteria and simply never
// fired on that one.
//
// And in the briefings, a company churning 2% a month was told, in writing,
// that its churn was 0.0%. The investor update said the same thing in the same
// way and is no longer here to say it — see the note in "what a person is
// shown" below.
//
// THE READINESS SCORER ITSELF IS GONE. `scp/investor/fundraising-readiness.ts`
// was deleted as production-dead, so the cases that scored a real company
// through it went with it, and so did the one that pinned how it computed
// growth and customers. The paragraph about it is kept because the SCHEMA check
// below is what stops the next reader repeating it, and because it is the
// clearest statement of why the failure was silent from both sides.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

describe('the convention, stated once', () => {
  it('converts a stored fraction to percentage points', () => {
    expect(ratePoints(0.68)).toBeCloseTo(68, 6);
    expect(ratePoints(0.02)).toBeCloseTo(2, 6);
    expect(ratePoints(0), 'a recorded zero is zero per cent').toBe(0);
  });

  it('keeps unknown unknown', () => {
    expect(ratePoints(null)).toBeNull();
    expect(ratePoints(undefined)).toBeNull();
    expect(ratePoints('not a number')).toBeNull();
  });
});

describe('the columns that were never there', () => {
  const columnsOf = (table: string): Set<string> => {
    const db = `/tmp/_units_${process.pid}.db`;
    execSync(`rm -f ${db}`);
    const files = execSync('ls src/db/migrations/*.sql | sort').toString().trim().split('\n');
    for (const f of files) {
      try { execSync(`sqlite3 ${db} < ${f} 2>/dev/null`); } catch { /* later migrations may not apply standalone */ }
    }
    const out = execSync(`sqlite3 ${db} "PRAGMA table_info('${table}')"`).toString();
    execSync(`rm -f ${db}`);
    return new Set(out.trim().split('\n').map((l) => l.split('|')[1]).filter(Boolean));
  };

  it('confirms mrr_growth_pct, customer_count and d30_retention do not exist', () => {
    const cols = columnsOf('metric_snapshots');
    expect(cols.size, 'the schema built at all').toBeGreaterThan(10);
    for (const ghost of ['mrr_growth_pct', 'customer_count', 'd30_retention']) {
      expect(cols.has(ghost), `${ghost} was read off a SELECT * row`).toBe(false);
    }
    expect(cols.has('day_30_retention'), 'the real one, with the data in it').toBe(true);
  });

  // The second case here read the three phantom columns off
  // `scp/investor/fundraising-readiness.ts` and pinned how growth and customers
  // are computed instead. That module was deleted as production-dead, and the
  // describe that followed — a strong seed profile scored end to end through
  // `assessFundraisingReadiness` — went with it. The schema check above is what
  // is left, and it is the half that survives any consumer: the ghost columns
  // must stay absent so the next reader cannot read them.
});

describe('what a person is shown', () => {
  it('renders a fraction as the percentage it is', () => {
    // `scp/briefing/email-digest.ts` was the second renderer held to this and
    // was deleted as production-dead, so the compressed briefing is the one
    // live renderer left carrying the rule.
    for (const f of ['src/services/scp/briefing/compressed.ts']) {
      const src = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
      expect(src, `${f}: 2% churn was reaching a founder as "0.0%"`)
        .toMatch(/churn_rate as number\) \* 100/);
      expect(src).toMatch(/activation_rate as number\) \* 100/);
    }
  });

  // THE INVESTOR UPDATE THAT SAID 0.0% CHURN IS GONE, NOT FIXED TWICE.
  // `scp/investor/investor-update.ts` read the same two fractions and printed
  // them unscaled, and it was checked here beside the briefings. Its only
  // callers were Commercial Foundry routes; when they went it had none, so the
  // module and `investor_updates` were removed. The rule it was held to is the
  // one above, and the one live renderer left still carries it.
});

describe('a failure pattern keyed on churn can fire', () => {
  it('compares points against points', () => {
    const src = stripComments(
      readFileSync('src/services/network/failure-library.ts', 'utf8'), { lineComments: true });
    expect(src, 'churn_rate_gt: 8 means eight per cent').toMatch(/ratePoints\(latest\?\.churn_rate\)/);
    expect(src).toMatch(/ratePoints\(latest\?\.activation_rate\)/);
    expect(src, 'nps runs -100..100 already and must not be scaled')
      .toMatch(/nps_score: \(latest\?\.nps_score as number \| null\) \?\? null/);
  });
});
