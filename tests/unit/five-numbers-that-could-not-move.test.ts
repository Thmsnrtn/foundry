process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { detectValueDecline } from '../../src/services/intelligence/value-delivery.js';
import { assessComplianceDebt } from '../../src/services/intelligence/regulatory.js';
import { getMRRIntelligence } from '../../src/services/founder/intelligence.js';

// =============================================================================
// FIVE NUMBERS THAT COULD NOT MOVE.
//
//   Value decline    every unreported component read as 0, so the same silence
//                    was a decline in one line and no problem in the next —
//                    latest missing against a prior of 60 gave `0 < 55`, and
//                    prior missing against a latest of 60 gave `60 < -5`.
//   Compliance debt  nothing in the repository writes
//                    `regulatory_profile.compliance_requirements`, so the score
//                    was 0 for every company — and 0 on that scale is the claim
//                    "nothing required is unmet", published to a customer.
//   Foundry's growth `mrr_30d_ago` was today's roster filtered by signup date,
//                    a strict SUBSET of today's payers, so `prior <= total`
//                    always held and the growth rate could not be negative.
//   Activation drop  a 0–1 fraction measured against a threshold of ten
//                    PERCENTAGE POINTS: the stressor could never fire.
//   The streak card  a lifetime counter with no date predicate anywhere, stated
//                    as "your agents have been off-target this week".
// =============================================================================

const P = 'p_five';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_5','c_5','five@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_5','active')", [P]);
});

describe('value delivery decline', () => {
  beforeEach(async () => { await query('DELETE FROM value_delivery_metrics'); });

  const snap = (id: string, date: string, cols: Record<string, number | null>) => {
    const keys = Object.keys(cols);
    return query(
      `INSERT INTO value_delivery_metrics (id, product_id, owner_id, snapshot_date${keys.length ? ', ' + keys.join(', ') : ''})
       VALUES (?, ?, 'f_5', ?${keys.map(() => ', ?').join('')})`,
      [id, P, date, ...keys.map((k) => cols[k])]);
  };

  it('does not read an unreported component as a collapse to zero', async () => {
    await snap('v1', '2026-08-01', { core_workflow_completion_rate: 60, value_delivery_index: 70 });
    await snap('v2', '2026-08-08', { core_workflow_completion_rate: null, value_delivery_index: 70 });

    const result = await detectValueDecline(P);
    expect(result.affected_components).not.toContain('core_workflow_completion');
    expect(result.unassessable_components).toContain('core_workflow_completion');
  });

  it('reads a real fall as a real fall', async () => {
    await snap('v3', '2026-08-01', { core_workflow_completion_rate: 60, value_delivery_index: 70 });
    await snap('v4', '2026-08-08', { core_workflow_completion_rate: 40, value_delivery_index: 70 });

    const result = await detectValueDecline(P);
    expect(result.affected_components).toContain('core_workflow_completion');
  });

  it('says nothing about the index when a snapshot did not report one', async () => {
    await snap('v5', '2026-08-01', { value_delivery_index: 72 });
    await snap('v6', '2026-08-08', { value_delivery_index: null });

    const result = await detectValueDecline(P);
    // "VDI declined from 72 to 0" was the old sentence.
    expect(result.declining).toBeNull();
    expect(result.trend_description).not.toContain('to 0');
  });
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

  it('no longer tells a founder a lifetime streak happened this week', () => {
    const src = stripComments(readFileSync('src/routes/dashboard/index.ts', 'utf8'),
      { lineComments: true });
    expect(src).not.toContain('off-target this week');
    expect(src).toContain('streakDays');
  });

  it('no longer reads the movement columns for the mobile dashboard', () => {
    const src = stripComments(readFileSync('src/routes/api/mobile.ts', 'utf8'),
      { lineComments: true });
    expect(src).toContain('getMRRDecomposition');
    // The dashboard payload's own query is gone; what remains is the briefing's
    // 'New MRR' line, which is labelled as the movement it reads.
    expect(src).not.toMatch(/SELECT new_mrr_cents, churned_mrr_cents/);
  });
});
