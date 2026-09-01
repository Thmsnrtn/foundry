process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  HISTORY_DAYS, advanceReferenceWorld, establishReferenceCompany,
  referenceDayIndex, referenceLevel, referenceReadings, referenceWirePayload,
} from '../../src/services/reference/world.js';
import { REFERENCE_SCENARIOS, referenceScenario } from '../../src/services/reference/scenarios.js';

// =============================================================================
// THE REFERENCE WORLD.
//
// A company that does not exist, doing something worth watching, so the
// institution can be run end to end before a real company is entrusted to it.
//
// This file proves the two properties that make that honest. First, the world
// travels the SAME CODE a real company's provider travels — the public intake,
// its units, its derived ratio, its observation recorder — because a rehearsal
// on a private path rehearses nothing. Second, everything it produces stays
// structurally incapable of becoming owner truth, whatever it accumulates.
//
// And one property that makes it useful: it is deterministic. The same scenario
// is the same world on every machine and every rerun, so a claim about what the
// institution did with it is a claim somebody else can check.
// =============================================================================

const OWNER = 'rw_owner';
let established: { productId: string; ingestToken: string };

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_rw', 'owner@example.com', 'Owner']);
  const result = await establishReferenceCompany({
    scenarioKey: 'revenue_quietly_falling', ownerId: OWNER,
  });
  if (!result) throw new Error('the scenario did not resolve');
  established = { productId: result.productId, ingestToken: result.ingestToken };
});

describe('a world that is the same world twice', () => {
  it('derives every value from the scenario, the field and the day', () => {
    const scenario = referenceScenario('revenue_quietly_falling');
    if (!scenario) throw new Error('missing scenario');
    // No stored dataset, no seed to carry: called again, it is identical.
    expect(referenceReadings(scenario, 41)).toEqual(referenceReadings(scenario, 41));
    // And different days are genuinely different, so this is not a flat line
    // agreeing with itself.
    expect(referenceReadings(scenario, 41)).not.toEqual(referenceReadings(scenario, 42));
  });

  it('moves the way the scenario says it moves, through the noise', () => {
    const scenario = referenceScenario('revenue_quietly_falling');
    if (!scenario) throw new Error('missing scenario');
    const churn = scenario.metrics.find((m) => m.field === 'churned_mrr_cents');
    const newMrr = scenario.metrics.find((m) => m.field === 'new_mrr_cents');
    if (!churn || !newMrr) throw new Error('missing metric');
    // The scenario is a business coming apart quietly. Over ninety days that
    // has to be visible in the numbers, or the reference world is not the
    // situation it claims to be exercising.
    expect(referenceLevel(scenario.key, churn, 89))
      .toBeGreaterThan(referenceLevel(scenario.key, churn, 0));
    expect(referenceLevel(scenario.key, newMrr, 89))
      .toBeLessThan(referenceLevel(scenario.key, newMrr, 0));
  });

  it('keeps rates inside the range the intake accepts', () => {
    for (const scenario of REFERENCE_SCENARIOS) {
      for (const metric of scenario.metrics.filter((m) => m.precision === 'rate')) {
        for (const day of [0, 45, 89, 200, 400]) {
          const v = referenceLevel(scenario.key, metric, day);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('speaks the intake\'s public vocabulary, in its units', () => {
    const scenario = referenceScenario('revenue_quietly_falling');
    if (!scenario) throw new Error('missing scenario');
    const wire = referenceWirePayload(scenario, 10);
    const readings = referenceReadings(scenario, 10);
    // `new_mrr_cents` is the column; `new_mrr` in DOLLARS is what the endpoint
    // documents. A world posting column names would have its numbers filed
    // under custom_metrics and observe nothing at all.
    expect(wire).not.toHaveProperty('new_mrr_cents');
    expect(wire.new_mrr).toBeCloseTo(readings.new_mrr_cents / 100, 2);
    expect(wire.mrr).toBeCloseTo(readings.mrr_cents / 100, 2);
    // The intake derives this from new and churned. A world that posted its own
    // would be overriding the arithmetic it exists to test.
    expect(wire).not.toHaveProperty('mrr_health_ratio');
  });
});

describe('a company that arrives with a past', () => {
  it('says what it is and why, and cannot stop saying so', async () => {
    const row = (await query(
      `SELECT p.reality, p.name, r.scenario, r.purpose FROM products p
         JOIN reference_companies r ON r.product_id = p.id WHERE p.id = ?`,
      [established.productId])).rows[0] as Record<string, unknown>;
    expect(String(row.reality)).toBe('reference');
    expect(String(row.scenario)).toContain('revenue is falling');
    await expect(query('UPDATE products SET reality=? WHERE id=?',
      ['real', established.productId])).rejects.toThrow(/reality_immutable/);
  });

  it('has ninety days of history and not one observation of it', async () => {
    // THE LINE THAT MATTERS. History is seeded because importing a company's
    // past is what importing a past IS. Observations are not, because nobody
    // watched those movements happen — and an expectation resolved by a
    // fabricated observation would be the institution marking its own homework
    // with numbers it wrote itself.
    const snapshots = (await query(
      'SELECT COUNT(*) AS n FROM metric_snapshots WHERE product_id=?',
      [established.productId])).rows[0] as Record<string, unknown>;
    expect(Number(snapshots.n)).toBe(HISTORY_DAYS);

    const signals = (await query(
      'SELECT COUNT(*) AS n FROM signal_events WHERE product_id=?',
      [established.productId])).rows[0] as Record<string, unknown>;
    expect(Number(signals.n)).toBe(0);
  });

  it('knows which day of its own story it is on', async () => {
    expect(await referenceDayIndex(established.productId)).toBe(HISTORY_DAYS);
  });

  it('is established once, however many times it is asked for', async () => {
    const again = await establishReferenceCompany({
      scenarioKey: 'revenue_quietly_falling', ownerId: OWNER,
    });
    expect(again?.productId).toBe(established.productId);
    const n = (await query(
      `SELECT COUNT(*) AS n FROM products WHERE owner_id=? AND reality='reference'`,
      [OWNER])).rows[0] as Record<string, unknown>;
    expect(Number(n.n)).toBe(1);
  });

  it('refuses a scenario nobody declared', async () => {
    expect(await establishReferenceCompany({ scenarioKey: 'whatever', ownerId: OWNER }))
      .toBeNull();
  });
});

describe('the front door', () => {
  it('advances through the public intake, and the institution sees it', async () => {
    const result = await advanceReferenceWorld(established.productId);
    expect(result?.status).toBe(200);
    expect(result?.day).toBe(HISTORY_DAYS);

    // The endpoint's own unit conversion ran: dollars in, cents stored.
    const today = (await query(
      `SELECT new_mrr_cents, mrr_cents, mrr_health_ratio FROM metric_snapshots
        WHERE product_id=? AND snapshot_date=date('now')`,
      [established.productId])).rows[0] as Record<string, unknown>;
    expect(Number(today.new_mrr_cents))
      .toBe(Math.round((result?.posted.new_mrr ?? 0) * 100));
    expect(Number(today.mrr_cents)).toBe(Math.round((result?.posted.mrr ?? 0) * 100));
    // And the route's derived ratio, which the world deliberately did not post.
    expect(Number(today.mrr_health_ratio)).toBeGreaterThan(0);

    // The observation the institution can actually reason about — produced by
    // the production recorder, against yesterday's seeded history.
    const observed = (await query(
      `SELECT source, event_type FROM signal_events
        WHERE product_id=? AND source LIKE '%metric_ingest'`,
      [established.productId])).rows as unknown as Array<Record<string, unknown>>;
    expect(observed.length).toBeGreaterThan(0);
    for (const row of observed) {
      // MIGRATION 223. Never the world's channel, whatever it accumulates.
      expect(String(row.source)).toBe('reference_metric_ingest');
      expect(String(row.event_type)).toMatch(/^reference_metric:/);
    }
  });

  it('still cannot reach a person, or spend a real budget', async () => {
    // The rehearsal gets richer with every advance. None of it buys the one
    // thing that would make it dangerous.
    const { checkKillSwitch } = await import('../../src/services/outbound/kill-switch.js');
    expect((await checkKillSwitch(established.productId, 'send_email')).blocked).toBe(true);
    const { companyMayIncurCost } = await import('../../src/services/ai/client.js');
    expect(await companyMayIncurCost(established.productId)).toBe('a reference company');
  });

  it('is not one of the owner\'s companies', async () => {
    const { getProductsByOwner } = await import('../../src/db/client.js');
    const ids = ((await getProductsByOwner(OWNER)).rows as unknown as Array<Record<string, unknown>>)
      .map((r) => String(r.id));
    expect(ids).not.toContain(established.productId);
  });
});

describe('and it goes when the owner goes', () => {
  it('lets an erasure take the row it refuses to lose otherwise', async () => {
    // MIGRATION 224. A company nobody can delete is a company that blocks its
    // owner's erasure, and "immutable" was never meant to mean that. The
    // permitted case is exactly one: a company already marked for erasure.
    const scenario = 'a business that is doing fine, to test whether the institution can stay quiet';
    const doomed = await establishReferenceCompany({
      scenarioKey: 'steady_and_unremarkable', ownerId: OWNER,
    });
    if (!doomed) throw new Error('no reference company');
    expect((await query('SELECT scenario FROM reference_companies WHERE product_id=?',
      [doomed.productId])).rows[0]).toMatchObject({ scenario });

    // Refused while the company is still here.
    await expect(query('DELETE FROM reference_companies WHERE product_id=?', [doomed.productId]))
      .rejects.toThrow(/reference_company:immutable/);

    await query("UPDATE products SET erasure_scheduled_at=datetime('now') WHERE id=?",
      [doomed.productId]);
    await expect(query('DELETE FROM reference_companies WHERE product_id=?', [doomed.productId]))
      .resolves.toBeDefined();
  });
});
