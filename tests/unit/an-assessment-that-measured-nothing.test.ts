import { describe, expect, it } from 'vitest';

// =============================================================================
// AN ASSESSMENT WHOSE COMPONENTS ALL FAILED TOWARDS A CLAIM — AND IS NOW GONE.
//
// `audit/intake-web.ts` scored a company's readiness to migrate off a no-code
// platform. Revenue was read from two one-period MOVEMENT columns instead of
// the level, so a company at $80k MRR was assessed at $0 and had "MRR: $0"
// written into the prompt for its migration plan. Churn compared a 0-1 fraction
// against `< 5`. The NPS test parsed as `nps_score ?? (0 >= 50)`, so the
// comparison never ran. A missing user count was measured as zero.
//
// The module was reachable from no entry point and has been deleted, and the
// eleven cases that called `assessMigrationReadiness` went with it. The rule
// they were written for — a threshold is a finding, and it fires on a measured
// value or not at all — outlives them in the tests of the readers that remain.
//
// What is still live is the second defect recorded in this file, in
// `audit/engine.ts`, which the repository audit still uses.
// =============================================================================

// =============================================================================
// A HARDCODED FALSE WEARING THE SHAPE OF A MEASUREMENT.
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
