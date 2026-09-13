process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { assessComplianceDebt } from '../../src/services/intelligence/regulatory.js';
import { getMRRIntelligence } from '../../src/services/founder/intelligence.js';

// =============================================================================
// FIVE NUMBERS THAT COULD NOT MOVE — THE TWO OF THEM THAT ARE STILL HERE.
//
//   Compliance debt  nothing in the repository writes
//                    `regulatory_profile.compliance_requirements`, so the score
//                    was 0 for every company — and 0 on that scale is the claim
//                    "nothing required is unmet", published to a customer.
//   Foundry's growth `mrr_30d_ago` was today's roster filtered by signup date,
//                    a strict SUBSET of today's payers, so `prior <= total`
//                    always held and the growth rate could not be negative.
//   Activation drop  a 0–1 fraction measured against a threshold of ten
//                    PERCENTAGE POINTS: the stressor could never fire.
//
// The other two — a lifetime streak counter described as "this week", and a
// mobile payload reading movement columns as a level — lived on Commercial
// Foundry routes and went with them. Value decline has now followed: it lived
// in `intelligence/value-delivery.ts`, which was reachable from no entry point
// and has been deleted, so the three cases that held it to the difference
// between a fall and a silence went with the file. The two above are services,
// and each is exercised here by calling it rather than by reading it.
// =============================================================================

const P = 'p_five';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_5','c_5','five@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_5','active')", [P]);
});

describe('compliance debt', () => {
  beforeEach(async () => { await query('DELETE FROM regulatory_profile'); });

  it('is unknown when no requirements are recorded', async () => {
    await query(
      `INSERT INTO regulatory_profile (id, product_id, owner_id, jurisdictions, regulatory_classifications)
       VALUES ('rp_1', ?, 'f_5', '[]', '[]')`, [P]);

    // Zero would say "nothing required is unmet". Nothing is required because
    // nothing has been recorded, which is a different sentence.
    expect(await assessComplianceDebt(P)).toBeNull();
  });

  it('is a score when there are requirements to score', async () => {
    await query(
      `INSERT INTO regulatory_profile (id, product_id, owner_id, jurisdictions, regulatory_classifications, compliance_requirements)
       VALUES ('rp_2', ?, 'f_5', '[]', '[]', ?)`,
      [P, JSON.stringify([
        { requirement: 'DPA', status: 'not_started' },
        { requirement: 'SOC2', status: 'met' },
      ])]);

    expect(await assessComplianceDebt(P)).toBe(50);
  });
});

describe("Foundry's own growth rate", () => {
  it('is not computed from a set that cannot shrink', async () => {
    const mrr = await getMRRIntelligence();
    expect(mrr.growth_rate_pct).toBeNull();
    expect(mrr.mrr_30d_ago).toBeNull();
    expect(mrr.mrr_trend).toBe('unknown');
    expect(mrr.forecast_3m).toBeNull();
  });

  it('still reports what it can measure', async () => {
    const mrr = await getMRRIntelligence();
    expect(typeof mrr.current_mrr).toBe('number');
  });
});

describe('the source', () => {
  it('no longer measures a fraction against a threshold in points', () => {
    const src = stripComments(readFileSync('src/services/intelligence/stressor.ts', 'utf8'),
      { lineComments: true });
    expect(src).toContain('dropPoints');
    expect(src).not.toMatch(/const drop = inputs\.priorMetrics\.activation_rate/);
  });
});
