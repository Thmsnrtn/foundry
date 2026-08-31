// =============================================================================
// Tests: V3.1 Layer A — Team Health Metrics (Ambros's six metrics)
// Verifies recursive yield score logic and defensive computation against
// missing source tables.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { nanoid } from 'nanoid';

import { query } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

import {
  computeAndStoreHealth,
  computeYieldScore,
  getHealth,
  getHealthHistory,
} from '../../src/services/discipline/team-health.js';

// ─── Test Setup ──────────────────────────────────────────────────────────────

let founderId: string;
let productId: string;

async function createFounderAndProduct(): Promise<{ founderId: string; productId: string }> {
  const fId = nanoid();
  const pId = nanoid();
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, name, tier)
     VALUES (?, ?, ?, ?, ?)`,
    [fId, `clerk_${fId}`, `${fId}@test.local`, 'Test Founder', 'growth']
  );
  await query(
    `INSERT INTO products (id, name, owner_id) VALUES (?, ?, ?)`,
    [pId, 'Test Product', fId]
  );
  return { founderId: fId, productId: pId };
}

// THIS TEST USED TO BUILD ITS OWN SCHEMA.
//
// Eight tables, hand-written in this file, "just enough of those tables to
// test the computation path". Two of them were wrong: `agent_messages` was
// given a `message_type` column (the real one is `type`) and
// `agent_predictions` a `measured_at` (the real one is `outcome_measured_at`).
// The service read exactly those names, the test agreed with it, and both were
// wrong about the product. Every assertion here passed against a database that
// does not exist anywhere else.
//
// A test that constructs its own reality verifies the code against that
// reality. The migrations are the schema; this runs them.
async function setupSchema(): Promise<void> {
  await runMigrations();
}

beforeAll(async () => {
  await setupSchema();
});

beforeEach(async () => {
  const { founderId: fId, productId: pId } = await createFounderAndProduct();
  founderId = fId;
  productId = pId;
});

// ─── Yield Score (Ambros Round 5) ────────────────────────────────────────────

describe('computeYieldScore: recursive critique yield', () => {
  it('returns null for empty input', () => {
    expect(computeYieldScore([])).toBeNull();
  });

  it('returns 1.0 when every promotion is a real-signal type', () => {
    const score = computeYieldScore([
      { change_type: 'golden_lesson' },
      { change_type: 'founder_correction' },
      { change_type: 'constraint_added' },
    ]);
    expect(score).toBe(1.0);
  });

  it('returns 0.0 when no promotions are real-signal types', () => {
    const score = computeYieldScore([
      { change_type: 'prompt_refinement' },
      { change_type: 'authority_change' },
    ]);
    expect(score).toBe(0.0);
  });

  it('returns proportion when mixed', () => {
    const score = computeYieldScore([
      { change_type: 'golden_lesson' },
      { change_type: 'prompt_refinement' },
      { change_type: 'constraint_added' },
      { change_type: 'authority_change' },
    ]);
    expect(score).toBe(0.5);
  });
});

// ─── Compute & Store ──────────────────────────────────────────────────────────

describe('computeAndStoreHealth: end-to-end', () => {
  const week = '2026-05-04'; // Monday
  const within = '2026-05-05 12:00:00';
  const after = '2026-05-12 12:00:00';

  it('writes a row with all-null metrics when sources are empty', async () => {
    const m = await computeAndStoreHealth({ product_id: productId, week_starting: week });
    expect(m.id).toBeTruthy();
    expect(m.week_starting).toBe(week);
    expect(m.critique_pass_rate_pct).toBeNull();
    expect(m.override_rate_pct).toBeNull();
    expect(m.recursive_yield_score).toBeNull();
    expect(m.action_accuracy_pct).toBeNull();
    expect(m.decisions_queued).toBe(0);
    expect(m.decisions_resolved).toBe(0);
  });

  it('counts queued and resolved decisions', async () => {
    await query(
      `INSERT INTO decisions (id, product_id, what, why_now, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nanoid(), productId, 'a', 'b', 'pending', within]
    );
    await query(
      `INSERT INTO decisions (id, product_id, what, why_now, status, created_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nanoid(), productId, 'a', 'b', 'approved', within, within]
    );
    const m = await computeAndStoreHealth({ product_id: productId, week_starting: week });
    expect(m.decisions_queued).toBe(2);
    expect(m.decisions_resolved).toBe(1);
  });

  it('computes override rate correctly', async () => {
    // 3 resolved, 1 founder-rejected
    for (let i = 0; i < 3; i++) {
      await query(
        `INSERT INTO decisions (id, product_id, what, why_now, status, created_at, decided_at, decided_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [nanoid(), productId, 'a', 'b', i === 0 ? 'rejected' : 'approved', within, within, 'founder']
      );
    }
    const m = await computeAndStoreHealth({ product_id: productId, week_starting: week });
    expect(m.total_decisions_resolved).toBe(3);
    expect(m.decisions_overridden).toBe(1);
    expect(Math.round(m.override_rate_pct ?? 0)).toBe(33);
  });

  it('computes yield score from promoted evolutions', async () => {
    await query(
      `INSERT INTO agent_evolution_versions
         (id, product_id, agent_name, version, change_type, change_description,
          new_config, promoted_at)
       VALUES (?, ?, 'oracle', 1, ?, 'learned something', '{}', ?)`,
      [nanoid(), productId, 'golden_lesson', within]
    );
    await query(
      `INSERT INTO agent_evolution_versions
         (id, product_id, agent_name, version, change_type, change_description,
          new_config, promoted_at)
       VALUES (?, ?, 'oracle', 2, ?, 'reworded a prompt', '{}', ?)`,
      [nanoid(), productId, 'prompt_refinement', within]
    );
    const m = await computeAndStoreHealth({ product_id: productId, week_starting: week });
    expect(m.evolutions_promoted_count).toBe(2);
    expect(m.recursive_yield_score).toBe(0.5);
  });

  it('computes action accuracy from agent_predictions', async () => {
    await query(
      `INSERT INTO agent_predictions
         (id, product_id, agent_name, session_id, prediction_type, prediction_text,
          confidence, measure_by_date, outcome_criteria, accuracy_score, outcome_measured_at)
       VALUES (?, ?, 'oracle', 'sess', 'metric', 'mrr will rise',
               0.8, '2030-01-01', 'mrr > x', ?, ?)`,
      [nanoid(), productId, 0.8, within]
    );
    await query(
      `INSERT INTO agent_predictions
         (id, product_id, agent_name, session_id, prediction_type, prediction_text,
          confidence, measure_by_date, outcome_criteria, accuracy_score, outcome_measured_at)
       VALUES (?, ?, 'oracle', 'sess', 'metric', 'mrr will rise',
               0.8, '2030-01-01', 'mrr > x', ?, ?)`,
      [nanoid(), productId, 0.6, within]
    );
    const m = await computeAndStoreHealth({ product_id: productId, week_starting: week });
    expect(Math.round(m.action_accuracy_pct ?? 0)).toBe(70);
  });

  it('excludes events outside the window', async () => {
    await query(
      `INSERT INTO decisions (id, product_id, what, why_now, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nanoid(), productId, 'a', 'b', 'pending', after] // after the window
    );
    const m = await computeAndStoreHealth({ product_id: productId, week_starting: week });
    expect(m.decisions_queued).toBe(0);
  });

  it('upsert: re-running for same week overwrites prior row', async () => {
    await computeAndStoreHealth({ product_id: productId, week_starting: week });
    await query(
      `INSERT INTO decisions (id, product_id, what, why_now, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nanoid(), productId, 'a', 'b', 'pending', within]
    );
    const second = await computeAndStoreHealth({ product_id: productId, week_starting: week });
    expect(second.decisions_queued).toBe(1);
    // Only one row should exist
    const all = await getHealthHistory(productId, 100);
    const sameWeek = all.filter(m => m.week_starting === week);
    expect(sameWeek).toHaveLength(1);
  });

  it('computes median time-to-action correctly with even-length list', async () => {
    // create 4 decisions with hour gaps 1, 3, 5, 7 → median = 4
    const startBase = '2026-05-05';
    const offsets = [1, 3, 5, 7];
    for (const h of offsets) {
      await query(
        `INSERT INTO decisions (id, product_id, what, why_now, status, created_at, decided_at, decided_by)
         VALUES (?, ?, ?, ?, ?, ?, datetime(?, ?), ?)`,
        [
          nanoid(), productId, 'a', 'b', 'approved',
          `${startBase} 00:00:00`,
          `${startBase} 00:00:00`, `+${h} hours`,
          'founder'
        ]
      );
    }
    const m = await computeAndStoreHealth({ product_id: productId, week_starting: week });
    expect(m.median_time_to_action_hours).toBeCloseTo(4, 1);
  });
});

// ─── History reads ────────────────────────────────────────────────────────────

describe('getHealthHistory', () => {
  it('returns rows in week-desc order, capped by limit', async () => {
    await computeAndStoreHealth({ product_id: productId, week_starting: '2026-04-13' });
    await computeAndStoreHealth({ product_id: productId, week_starting: '2026-04-20' });
    await computeAndStoreHealth({ product_id: productId, week_starting: '2026-04-27' });
    const history = await getHealthHistory(productId, 2);
    expect(history.map(h => h.week_starting)).toEqual(['2026-04-27', '2026-04-20']);
  });

  it('getHealth returns null for absent week', async () => {
    expect(await getHealth(productId, '2099-12-31')).toBeNull();
  });
});
