process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async (_system: string, user: string) => {
    seenPrompts.push(user);
    return { content: 'a plan', tokensUsed: 1, costUsd: 0 };
  }),
}));

const seenPrompts: string[] = [];
const { assessMigrationReadiness } = await import('../../src/services/audit/intake-web.js');

// =============================================================================
// AN ASSESSMENT WHOSE COMPONENTS ALL FAILED TOWARDS A CLAIM.
//
//   Revenue    read as `new_mrr_cents + expansion_mrr_cents` — two ONE-PERIOD
//              MOVEMENT columns — instead of the level `mrr_cents`, each
//              coalesced to 0. A daily job writes a placeholder snapshot whose
//              movement columns are `INTEGER DEFAULT 0`, so a company at $80k
//              MRR was assessed at $0, told "revenue may not yet justify
//              migration costs", and had "MRR: $0" written into the prompt for
//              the migration plan.
//   Churn      `churnRate < 5` against a 0–1 FRACTION: the test was "is churn
//              under 500%", and 90% monthly churn collected the fifteen points
//              for "low churn suggests product-market fit".
//   NPS        `(m?.nps_score as number) ?? 0 >= 50` parses as
//              `nps_score ?? (0 >= 50)` — `>=` binds tighter than `??` — so the
//              comparison never ran on the score. An NPS of -40 was "High NPS
//              confirms value delivery".
//   Users      `?? 0`: a company reporting no user count was measured at zero.
//
// A threshold is a finding. It fires on a measured value or not at all.
// =============================================================================

const P = 'p_assess';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_as','c_as','as@example.com')");
  await query(
    "INSERT INTO products (id, name, owner_id, status, build_platform) VALUES (?,'Acme','f_as','active','bubble')",
    [P]);
});
beforeEach(async () => {
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM vendor_recommendations');
  seenPrompts.length = 0;
});

async function snapshot(cols: Record<string, number | null>): Promise<void> {
  const keys = Object.keys(cols);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date${keys.length ? ', ' + keys.join(', ') : ''})
     VALUES (?, ?, date('now')${keys.map(() => ', ?').join('')})`,
    ['ms_1', P, ...keys.map((k) => cols[k])]);
}

describe('a company at $80k MRR with a flat month', () => {
  it('is not assessed as having no revenue', async () => {
    // The placeholder snapshot shape: the level is reported, the movements are
    // the column default of 0 because nothing moved.
    await snapshot({ mrr_cents: 8_000_000, new_mrr_cents: 0, expansion_mrr_cents: 0 });

    const result = await assessMigrationReadiness(P);
    expect(result.reasons).toContain('Revenue ($5K+/mo) can justify development costs');
    expect(result.reasons).not.toContain('Revenue may not yet justify migration costs');
  });

  it('does not have $0 written into the plan the model is asked for', async () => {
    await snapshot({ mrr_cents: 8_000_000, active_users: 400, new_mrr_cents: 0 });
    await assessMigrationReadiness(P);

    expect(seenPrompts.length).toBeGreaterThan(0);
    expect(seenPrompts[0]).toContain('MRR: $80000');
  });
});

describe('churn', () => {
  it('at 90% a month is not product-market fit', async () => {
    await snapshot({ mrr_cents: 100, churn_rate: 0.9 });
    const result = await assessMigrationReadiness(P);
    expect(result.reasons).not.toContain('Low churn suggests product-market fit');
  });

  it('at 3% a month is', async () => {
    await snapshot({ mrr_cents: 100, churn_rate: 0.03 });
    const result = await assessMigrationReadiness(P);
    expect(result.reasons).toContain('Low churn suggests product-market fit');
  });
});

describe('NPS', () => {
  it('of -40 is not high', async () => {
    await snapshot({ mrr_cents: 100, nps_score: -40 });
    const result = await assessMigrationReadiness(P);
    expect(result.reasons).not.toContain('High NPS confirms value delivery');
  });

  it('of 62 is', async () => {
    await snapshot({ mrr_cents: 100, nps_score: 62 });
    const result = await assessMigrationReadiness(P);
    expect(result.reasons).toContain('High NPS confirms value delivery');
  });
});

describe('what was not reported', () => {
  it('is named rather than scored as a zero', async () => {
    await snapshot({ mrr_cents: null, active_users: null, churn_rate: null, nps_score: null });

    const result = await assessMigrationReadiness(P);
    expect(result.not_measured).toHaveLength(4);
    expect(result.not_measured.join(' ')).toContain('MRR is not reported');
    expect(result.reasons).not.toContain('Revenue may not yet justify migration costs');
  });

  it('leaves the verdict unsaid when it could still change the answer', async () => {
    await snapshot({ mrr_cents: null, active_users: null, churn_rate: null, nps_score: null });

    const result = await assessMigrationReadiness(P);
    // Only the migration-recommendation count (20 points) was measurable, and
    // 80 unmeasured points could carry this past 50 either way.
    expect(result.measurable).toBe(20);
    expect(result.ready).toBeNull();
  });

  it('says not ready only when the missing evidence could not reach the threshold', async () => {
    // Everything measured, and what it measured is thin.
    await snapshot({ mrr_cents: 1000, active_users: 3, churn_rate: 0.4, nps_score: 10 });

    const result = await assessMigrationReadiness(P);
    expect(result.measurable).toBe(100);
    expect(result.ready).toBe(false);
  });

  it('says ready when the evidence reaches it', async () => {
    await snapshot({ mrr_cents: 9_000_000, active_users: 900, churn_rate: 0.01, nps_score: 70 });

    const result = await assessMigrationReadiness(P);
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.ready).toBe(true);
  });
});

// =============================================================================
// AND A HARDCODED FALSE WEARING THE SHAPE OF A MEASUREMENT.
//
// `analyzeRoutes` built `middleware` as a list of PATHS and then destructured
// each path as if it were a `[path, content]` entry, so `c` was the second
// CHARACTER of a filename and `c.includes('auth')` was false for every
// repository ever audited. The scorer writes the answer into the prompt as
// "Auth protected: false", so every customer's repository was described to the
// model as having unprotected routes — by a line that never looked at anything.
// =============================================================================

describe('the repository audit', () => {
  it('sees auth in a middleware file', async () => {
    const { __analyzeRoutesForTest } = await import('../../src/services/audit/engine.js');
    const files = new Map<string, string>([
      ['src/middleware/auth.ts', 'export const requireAuth = () => {};'],
      ['src/routes/api.ts', "app.get('/api/x', h)"],
    ]);

    expect(__analyzeRoutesForTest([], files).auth_protected).toBe(true);
  });

  it('says no when a middleware file was read and mentions none', async () => {
    const { __analyzeRoutesForTest } = await import('../../src/services/audit/engine.js');
    const files = new Map<string, string>([
      ['src/middleware/logging.ts', 'export const log = () => {};'],
    ]);

    expect(__analyzeRoutesForTest([], files).auth_protected).toBe(false);
  });

  it('says nothing when there was no middleware file to read', async () => {
    const { __analyzeRoutesForTest } = await import('../../src/services/audit/engine.js');
    const files = new Map<string, string>([['src/routes/api.ts', "app.get('/api/x', h)"]]);

    // Not evidence that routes are unprotected. That is the claim this made
    // about every repository it ever saw.
    expect(__analyzeRoutesForTest([], files).auth_protected).toBeNull();
  });
});
