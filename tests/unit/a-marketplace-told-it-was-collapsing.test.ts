process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  assessDisintermediationRisk, computeLiquidityScore, computeMarketplaceHealth,
  identifyMarketplaceStressors,
} from '../../src/services/intelligence/marketplace.js';

// =============================================================================
// A MARKETPLACE THAT REPORTED NOTHING WAS TOLD IT WAS COLLAPSING.
//
// Every input fell back to 0, and three of the four stressor thresholds fire
// BELOW a number. So a company that had never posted marketplace metrics or run
// a trust audit came back with `liquidity_collapse` (severity: critical),
// `trust_deficit` and `supply_imbalance` at once, and an overall health near
// zero — served through the tier2 marketplace endpoint.
//
// AND THE SAME FILE FELL THE OTHER WAY ON THE SAME ABSENCE.
// `assessDisintermediationRisk` returned 0 for no data, and 0 there means NO
// RISK. One absence, two opposite readings, in one file — the same shape the
// Value Delivery Index had, and the reason to look at every fallback in a file
// together rather than one at a time.
//
// `timeToMatch ?? 999` was its own small version: it landed in the slowest
// branch and still awarded five points for a measurement nobody had taken.
// =============================================================================

const P = 'p_mk';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_mk','c_mk','m@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Bazaar','f_mk','active')", [P]);
});
beforeEach(async () => {
  await query('DELETE FROM marketplace_metrics');
  await query('DELETE FROM marketplace_trust_audit');
});

async function metrics(cols: Record<string, number>) {
  const keys = Object.keys(cols);
  await query(
    `INSERT INTO marketplace_metrics (id, product_id, owner_id, snapshot_date, ${keys.join(', ')})
     VALUES (?, ?, 'f_mk', date('now'), ${keys.map(() => '?').join(', ')})`,
    [nanoid(), P, ...keys.map((k) => cols[k]!)]);
}

describe('a marketplace that has reported nothing', () => {
  it('raises no stressors at all', async () => {
    expect(await identifyMarketplaceStressors(P),
      'it used to raise three, one of them critical').toEqual([]);
  });

  it('has no health score, and says what it could not look at', async () => {
    const h = await computeMarketplaceHealth(P);
    expect(h.overall_health).toBeNull();
    expect(h.coverage).toBeNull();
    expect(h.not_measured).toEqual(
      ['liquidity', 'trust', 'supply/demand balance', 'unit economics']);
  });

  it('has no liquidity score rather than a zero', async () => {
    expect(await computeLiquidityScore(P)).toBeNull();
  });

  it('has no disintermediation risk rather than none', async () => {
    expect(await assessDisintermediationRisk(P),
      'zero here means NO RISK — the opposite direction from the zeros above')
      .toBeNull();
  });
});

describe('a marketplace that has reported some of it', () => {
  it('scores liquidity over the bands it reported', async () => {
    // Only match rate: 80 * 0.4 = 32 of a possible 40 → 80/100.
    await metrics({ match_rate: 80 });
    expect(await computeLiquidityScore(P)).toBe(80);
  });

  it('does not award points for a time-to-match nobody measured', async () => {
    // `?? 999` used to add five points here on top of the match-rate band.
    await metrics({ match_rate: 100 });
    expect(await computeLiquidityScore(P), '40/40 reported, so full marks').toBe(100);
  });

  it('weights the overall score over what was measured', async () => {
    await metrics({ match_rate: 100 });
    const h = await computeMarketplaceHealth(P);
    expect(h.liquidity_score).toBe(100);
    expect(h.overall_health, 'liquidity alone, renormalised').toBe(100);
    expect(h.coverage).toBeCloseTo(0.35, 5);
    expect(h.not_measured).toEqual(['trust', 'supply/demand balance', 'unit economics']);
  });

  it('still raises a real stressor when a measured value is bad', async () => {
    await metrics({ match_rate: 10, time_to_match_hours: 200 });
    const names = (await identifyMarketplaceStressors(P)).map((s) => s.name);
    expect(names).toContain('Marketplace liquidity collapse');
  });

  it('and a real disintermediation risk when one was reported', async () => {
    await metrics({ match_rate: 90, disintermediation_risk: 80 });
    const names = (await identifyMarketplaceStressors(P)).map((s) => s.name);
    expect(names).toContain('Disintermediation risk elevated');
  });
});

describe('critical mass', () => {
  it('is not estimated for a company that reported neither input', async () => {
    const { modelCriticalMass } = await import('../../src/services/intelligence/marketplace.js');
    const c = await modelCriticalMass(P);
    expect(c.current_density, 'a density of 0 was invented').toBeNull();
    expect(c.estimated_critical_mass, 'and a critical mass of 50').toBeNull();
    expect(c.at_critical_mass, 'and `false` is a verdict').toBeNull();
  });

  it('is estimated when both were reported', async () => {
    await metrics({ supply_count: 200, match_rate: 25 });
    const { modelCriticalMass } = await import('../../src/services/intelligence/marketplace.js');
    const c = await modelCriticalMass(P);
    expect(c.current_density).toBe(200);
    expect(c.estimated_critical_mass).toBe(400);
    expect(c.at_critical_mass).toBe(false);
  });
});
