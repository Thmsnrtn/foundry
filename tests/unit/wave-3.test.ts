// =============================================================================
// Tests: Wave 3 — peer signal / financial snapshot / referrals / briefing share
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import {
  computePeerSignal,
  decorateForDisplay,
  topPeerValidatedDecisionTypes,
} from '../../src/services/intelligence/peer-signal.js';
import { computeFinancialSnapshot } from '../../src/services/intelligence/financial-snapshot.js';
import {
  getOrCreateReferralLink,
  resolveReferralCode,
  recordReferralEvent,
} from '../../src/services/distribution/referrals.js';
import {
  createBriefingShare,
  resolveShare,
  revokeShare,
} from '../../src/services/distribution/briefing-share.js';

let founderId: string;
let productId: string;

async function setupSchema(): Promise<void> {
  await executeRaw(`
    CREATE TABLE IF NOT EXISTS founders (
      id TEXT PRIMARY KEY,
      clerk_user_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      tier TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES founders(id),
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS metric_snapshots (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      snapshot_date DATE NOT NULL,
      new_mrr_cents INTEGER,
      expansion_mrr_cents INTEGER DEFAULT 0,
      contraction_mrr_cents INTEGER DEFAULT 0,
      churned_mrr_cents INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, snapshot_date)
    );
    -- The real AI cost ledger. This fixture used to create ai_cost_log, a
    -- table no migration has ever created, with a cost_usd column and a
    -- timestamp clock — so the feature passed against a schema that existed
    -- only inside this file, while the query threw on every real call.
    CREATE TABLE IF NOT EXISTS ai_usage_log (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      model TEXT,
      call_type TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_cents INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      gate INTEGER,
      what TEXT NOT NULL,
      why_now TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      decided_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS action_drafts (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      action_type TEXT,
      title TEXT,
      draft_content TEXT,
      artifact_type TEXT,
      gate INTEGER,
      auto_executable INTEGER,
      status TEXT,
      executed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS scp_briefings (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      briefing_date DATE NOT NULL,
      signal_score INTEGER,
      headline TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS decision_patterns (
      id TEXT PRIMARY KEY,
      decision_type TEXT NOT NULL,
      product_lifecycle_stage TEXT NOT NULL,
      risk_state_at_decision TEXT NOT NULL,
      key_metrics_context TEXT NOT NULL,
      option_chosen_category TEXT NOT NULL,
      outcome_direction TEXT,
      outcome_magnitude TEXT,
      outcome_timeframe_days INTEGER,
      market_category TEXT,
      contributing_factors TEXT,
      scenario_accuracy_score REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await executeRaw(
    readFileSync(
      resolve(__dirname, '../../src/db/migrations/071_referrals_and_shares.sql'),
      'utf-8'
    )
  );
}

beforeAll(async () => {
  await setupSchema();
});

beforeEach(async () => {
  founderId = nanoid();
  productId = nanoid();
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, tier) VALUES (?, ?, ?, ?)`,
    [founderId, `clerk_${founderId}`, `${founderId}@test.local`, 'growth']
  );
  await query(
    `INSERT INTO products (id, name, owner_id) VALUES (?, ?, ?)`,
    [productId, 'Test', founderId]
  );
  await executeRaw('DELETE FROM decision_patterns');
  await executeRaw('DELETE FROM ai_usage_log');
  await executeRaw('DELETE FROM metric_snapshots');
  await executeRaw('DELETE FROM referral_links');
  await executeRaw('DELETE FROM referral_conversions');
  await executeRaw('DELETE FROM briefing_shares');
});

// ─── Peer signal ─────────────────────────────────────────────────────────────

describe('peer-signal', () => {
  it('returns null when no patterns match', async () => {
    const r = await computePeerSignal({
      decision_type: 'pricing_change',
      product_lifecycle_stage: 'growth',
    });
    expect(r).toBeNull();
  });

  it('aggregates positive_outcome_rate across matching rows', async () => {
    // 4 rows: 3 positive, 1 negative
    for (const dir of ['positive', 'positive', 'positive', 'negative']) {
      await query(
        `INSERT INTO decision_patterns
          (id, decision_type, product_lifecycle_stage, risk_state_at_decision,
           key_metrics_context, option_chosen_category, outcome_direction,
           outcome_timeframe_days)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [nanoid(), 'pricing_change', 'growth', 'green', '{}', 'increase', dir, 30]
      );
    }
    const r = await computePeerSignal({
      decision_type: 'pricing_change',
      product_lifecycle_stage: 'growth',
    });
    expect(r).not.toBeNull();
    expect(r!.sample_size).toBe(4);
    expect(r!.positive_outcome_rate).toBeCloseTo(0.75, 2);
  });

  it('decorateForDisplay flags worth_surfacing only when n >= 5', () => {
    const small = decorateForDisplay({
      decision_type: 'x',
      approval_rate: 1,
      positive_outcome_rate: 0.8,
      sample_size: 3,
      median_outcome_days: 10,
    });
    expect(small.worth_surfacing).toBe(false);

    const big = decorateForDisplay({
      decision_type: 'x',
      approval_rate: 1,
      positive_outcome_rate: 0.8,
      sample_size: 12,
      median_outcome_days: 10,
    });
    expect(big.worth_surfacing).toBe(true);
    expect(big.headline).toMatch(/80%/);
  });

  it('topPeerValidatedDecisionTypes filters by sample size and positive rate', async () => {
    // pricing_change: 6 rows, 5 positive, 1 negative → 83% (qualifies)
    for (const dir of ['positive', 'positive', 'positive', 'positive', 'positive', 'negative']) {
      await query(
        `INSERT INTO decision_patterns (id, decision_type, product_lifecycle_stage,
           risk_state_at_decision, key_metrics_context, option_chosen_category, outcome_direction)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [nanoid(), 'pricing_change', 'growth', 'green', '{}', 'inc', dir]
      );
    }
    // small_sample: 3 rows (under threshold)
    for (const dir of ['positive', 'positive', 'positive']) {
      await query(
        `INSERT INTO decision_patterns (id, decision_type, product_lifecycle_stage,
           risk_state_at_decision, key_metrics_context, option_chosen_category, outcome_direction)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [nanoid(), 'small_sample', 'growth', 'green', '{}', 'inc', dir]
      );
    }
    const top = await topPeerValidatedDecisionTypes('growth', 5);
    expect(top.length).toBe(1);
    expect(top[0].decision_type).toBe('pricing_change');
  });
});

// ─── Financial snapshot ──────────────────────────────────────────────────────

describe('financial-snapshot', () => {
  it('returns null mrr when no snapshots', async () => {
    const r = await computeFinancialSnapshot(productId);
    expect(r.mrr_cents).toBeNull();
    expect(r.arr_cents).toBeNull();
    expect(r.ai_cost_30d_usd).toBe(0);
  });

  it('computes net MRR + ARR + AI cost + operating margin', async () => {
    // Insert a snapshot: $5000 new, $200 expansion, $100 contraction, $50 churn
    await query(
      `INSERT INTO metric_snapshots
         (id, product_id, snapshot_date, new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churned_mrr_cents)
       VALUES (?, ?, date('now'), 500000, 20000, 10000, 5000)`,
      [nanoid(), productId]
    );
    // Insert AI cost: $20 in last 30 days
    await query(
      `INSERT INTO ai_usage_log (id, product_id, model, cost_cents, created_at)
       VALUES (?, ?, 'claude-sonnet', 2000, datetime('now', '-5 days'))`,
      [nanoid(), productId]
    );

    const r = await computeFinancialSnapshot(productId);
    // Net MRR = 500000 + 20000 - 10000 - 5000 = 505000 cents = $5050
    expect(r.mrr_cents).toBe(505000);
    expect(r.arr_cents).toBe(505000 * 12);
    expect(r.ai_cost_30d_usd).toBe(20);
    // Operating margin: 5050 - 20 = 5030
    expect(r.operating_margin_30d_usd).toBeCloseTo(5030, 1);
    // Margin pct: 5030 / 5050 ≈ 0.996
    expect(r.margin_pct_30d).toBeCloseTo(0.996, 2);
  });
});

// ─── Referrals ───────────────────────────────────────────────────────────────

describe('referrals', () => {
  it('creates and retrieves stable referral link', async () => {
    const a = await getOrCreateReferralLink(founderId);
    const b = await getOrCreateReferralLink(founderId);
    expect(a.code).toBe(b.code);
  });

  it('resolves code back to link', async () => {
    const link = await getOrCreateReferralLink(founderId);
    const resolved = await resolveReferralCode(link.code);
    expect(resolved?.id).toBe(link.id);
  });

  it('returns null for unknown code', async () => {
    const r = await resolveReferralCode('nope-not-a-real-code');
    expect(r).toBeNull();
  });

  it('records click/signup/paid events with counter increments', async () => {
    const link = await getOrCreateReferralLink(founderId);
    await recordReferralEvent(link.code, 'click');
    await recordReferralEvent(link.code, 'click');
    await recordReferralEvent(link.code, 'signup', { invited_founder_id: 'newbie' });
    await recordReferralEvent(link.code, 'paid', { invited_founder_id: 'newbie' });
    const after = await resolveReferralCode(link.code);
    expect(after?.click_count).toBe(2);
    expect(after?.signup_count).toBe(1);
    expect(after?.paid_count).toBe(1);
  });

  it('silently no-ops on unknown code', async () => {
    await expect(recordReferralEvent('unknown', 'click')).resolves.toBeUndefined();
  });
});

// ─── Briefing share ──────────────────────────────────────────────────────────

describe('briefing-share', () => {
  it('rejects share creation for non-owned product', async () => {
    const otherFounder = nanoid();
    await query(
      `INSERT INTO founders (id, clerk_user_id, email, tier) VALUES (?, ?, ?, ?)`,
      [otherFounder, `clerk_${otherFounder}`, `${otherFounder}@x.test`, 'solo']
    );
    await expect(
      createBriefingShare(otherFounder, productId, 'briefing-1')
    ).rejects.toThrow(/not your product/);
  });

  it('creates share, resolves it, increments view_count', async () => {
    // Pre-insert briefing record for the FK-ish JOIN
    await query(
      `INSERT INTO scp_briefings (id, product_id, briefing_date, signal_score, headline)
       VALUES (?, ?, date('now'), 80, 'Test headline')`,
      ['briefing-1', productId]
    );
    const code = await createBriefingShare(founderId, productId, 'briefing-1');
    const r1 = await resolveShare(code);
    expect(r1?.product_name).toBe('Test');
    expect(r1?.signal_score).toBe(80);
    // give the fire-and-forget view_count update a chance to land
    await new Promise((res) => setTimeout(res, 20));
    const dbR = await query('SELECT view_count FROM briefing_shares WHERE share_code = ?', [code]);
    expect(Number((dbR.rows[0] as Record<string, number>).view_count)).toBeGreaterThan(0);
  });

  it('revoke deletes only owner shares', async () => {
    await query(
      `INSERT INTO scp_briefings (id, product_id, briefing_date, signal_score, headline)
       VALUES (?, ?, date('now'), 80, 'Test')`,
      ['briefing-2', productId]
    );
    const code = await createBriefingShare(founderId, productId, 'briefing-2');
    const ok = await revokeShare(founderId, code);
    expect(ok).toBe(true);
    const r = await resolveShare(code);
    expect(r).toBeNull();
  });
});
