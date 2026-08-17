// =============================================================================
// Tests: Wave 2 — feedback / rejection-streak / shippability / dna-autofill
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

// Mock the AI client so dna-autofill tests don't hit the network.
let mockResponse = JSON.stringify({
  icp_description: 'Solo SaaS founders running 1-5 products',
  icp_pain: 'Operating-task drain consumes hours per week',
  icp_trigger: 'Adding a second product without doubling workload',
  positioning_statement: 'Autonomous AI operations layer for solo SaaS founders',
  what_we_are_not: 'Not a fleet control plane',
  primary_objection: 'Another tool to learn',
  objection_response: 'Foundry runs in the background; daily 90-second briefing only',
  market_insight: 'AI commoditizes; per-founder calibration is the moat',
});
vi.mock('../../src/services/ai/client.js', () => ({
  callSonnet: vi.fn(async () => ({ content: mockResponse, usage: { input_tokens: 10, output_tokens: 10 } })),
  parseJSONResponse: <T>(s: string): T => JSON.parse(s) as T,
}));

import { query, executeRaw } from '../../src/db/client.js';
import {
  submitNps,
  submitRejectionReason,
  isDueForNps,
  getNpsAggregate,
} from '../../src/services/founder/feedback.js';
import {
  recordRejection,
  recordApproval,
  getStreak,
} from '../../src/services/founder/rejection-streak.js';
import { computeShippability } from '../../src/services/intelligence/shippability.js';
import { extractDNAFromAssets } from '../../src/services/wisdom/dna-autofill.js';

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
      scp_status TEXT DEFAULT 'active',
      entitlement_paused_at TEXT,
      growth_stage TEXT,
      market_category TEXT,
      sector_profile TEXT,
      github_repo_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS product_dna (
      product_id TEXT PRIMARY KEY,
      icp_description TEXT,
      positioning_statement TEXT,
      primary_objection TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_scores (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      composite REAL,
      verdict TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      status TEXT
    );
    CREATE TABLE IF NOT EXISTS competitors (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL
    );
  `);
  await executeRaw(
    readFileSync(
      resolve(__dirname, '../../src/db/migrations/070_weekend_mode_and_feedback.sql'),
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
    `INSERT INTO products (id, name, owner_id, growth_stage) VALUES (?, ?, ?, ?)`,
    [productId, 'Test', founderId, 'pre_launch']
  );
  await executeRaw('DELETE FROM founder_feedback');
  await executeRaw('DELETE FROM rejection_streaks');
  await executeRaw('DELETE FROM product_dna');
  await executeRaw('DELETE FROM audit_scores');
  await executeRaw('DELETE FROM integrations');
  await executeRaw('DELETE FROM competitors');
});

// ─── NPS feedback ─────────────────────────────────────────────────────────────

describe('feedback / NPS', () => {
  it('classifies score 9-10 as promoter, 7-8 passive, 0-6 detractor', async () => {
    const a = await submitNps(founderId, productId, 9);
    const b = await submitNps(founderId, productId, 7);
    const c = await submitNps(founderId, productId, 4);
    expect(a.category).toBe('promoter');
    expect(b.category).toBe('passive');
    expect(c.category).toBe('detractor');
  });

  it('clamps out-of-range scores into 0-10', async () => {
    const a = await submitNps(founderId, productId, 99);
    const b = await submitNps(founderId, productId, -3);
    expect(a.score).toBe(10);
    expect(b.score).toBe(0);
  });

  it('isDueForNps is true when no NPS recorded', async () => {
    expect(await isDueForNps(founderId)).toBe(true);
  });

  it('isDueForNps is false right after submitting', async () => {
    await submitNps(founderId, productId, 9);
    expect(await isDueForNps(founderId)).toBe(false);
  });

  it('aggregate computes NPS correctly', async () => {
    // 2 promoters, 1 passive, 1 detractor → NPS = (2-1)/4 * 100 = 25
    await submitNps(nanoid(), null, 10);
    await submitNps(nanoid(), null, 9);
    await submitNps(nanoid(), null, 7);
    await submitNps(nanoid(), null, 3);
    const r = await getNpsAggregate();
    expect(r.responses).toBe(4);
    expect(r.nps).toBe(25);
  });

  it('rejection_reason feedback persists with context', async () => {
    await submitRejectionReason(founderId, productId, 'draft-1', 'beacon', 'tone is off');
    const r = await query(
      `SELECT comment, context_json FROM founder_feedback
        WHERE founder_id = ? AND feedback_type = 'rejection_reason'`,
      [founderId]
    );
    const row = r.rows[0] as Record<string, string>;
    expect(row.comment).toBe('tone is off');
    const ctx = JSON.parse(row.context_json);
    expect(ctx.draftId).toBe('draft-1');
    expect(ctx.agentName).toBe('beacon');
  });
});

// ─── Rejection streak ────────────────────────────────────────────────────────

describe('rejection-streak', () => {
  it('does not prompt before threshold', async () => {
    const r1 = await recordRejection(founderId, productId, null);
    const r2 = await recordRejection(founderId, productId, null);
    expect(r1.shouldPrompt).toBe(false);
    expect(r2.shouldPrompt).toBe(false);
    expect(r2.consecutive).toBe(2);
  });

  it('prompts at threshold (3 consecutive rejections)', async () => {
    await recordRejection(founderId, productId, null);
    await recordRejection(founderId, productId, null);
    const r = await recordRejection(founderId, productId, null);
    expect(r.shouldPrompt).toBe(true);
    expect(r.consecutive).toBe(3);
  });

  it('approval resets the streak', async () => {
    await recordRejection(founderId, productId, null);
    await recordRejection(founderId, productId, null);
    await recordApproval(founderId, productId, null);
    const s = await getStreak(founderId, productId);
    expect(s.consecutive).toBe(0);
  });

  it('does not re-prompt within cooldown', async () => {
    await recordRejection(founderId, productId, null);
    await recordRejection(founderId, productId, null);
    const first = await recordRejection(founderId, productId, null);
    expect(first.shouldPrompt).toBe(true);
    // A 4th rejection within the cooldown window should NOT re-prompt.
    const second = await recordRejection(founderId, productId, null);
    expect(second.shouldPrompt).toBe(false);
  });
});

// ─── Shippability ────────────────────────────────────────────────────────────

describe('shippability', () => {
  it('returns null for non-pre-launch products', async () => {
    await query(`UPDATE products SET growth_stage = 'growth' WHERE id = ?`, [productId]);
    const r = await computeShippability(productId);
    expect(r).toBeNull();
  });

  it('zeros out for an empty pre-launch product', async () => {
    const r = await computeShippability(productId);
    expect(r).not.toBeNull();
    expect(r!.score).toBe(0);
    expect(r!.ready_to_launch).toBe(false);
    expect(r!.next_action).toMatch(/repository connected/i);
  });

  it('credits criteria as they are satisfied', async () => {
    await query(
      `UPDATE products SET github_repo_url = ? WHERE id = ?`,
      ['https://github.com/x/y', productId]
    );
    await query(
      `INSERT INTO product_dna (product_id, icp_description, positioning_statement, primary_objection)
       VALUES (?, ?, ?, ?)`,
      [
        productId,
        'Solo SaaS founders running 1-5 products who lack operational support',
        'Autonomous AI operations layer for SaaS founders',
        'Another tool to learn and integrate',
      ]
    );
    await query(
      `INSERT INTO audit_scores (id, product_id, composite, verdict)
       VALUES (?, ?, 7.4, 'READY_WITH_CONDITIONS')`,
      [nanoid(), productId]
    );
    await query(
      `INSERT INTO competitors (id, product_id) VALUES (?, ?), (?, ?)`,
      [nanoid(), productId, nanoid(), productId]
    );
    await query(
      `INSERT INTO integrations (id, product_id, status) VALUES (?, ?, 'active')`,
      [nanoid(), productId]
    );

    const r = await computeShippability(productId);
    expect(r!.score).toBeGreaterThanOrEqual(80);
    expect(r!.ready_to_launch).toBe(true);
  });
});

// ─── DNA auto-fill ────────────────────────────────────────────────────────────

describe('dna-autofill', () => {
  it('returns empty draft when no source material', async () => {
    const r = await extractDNAFromAssets({}, productId);
    expect(r.icp_description).toBeNull();
    expect(r.positioning_statement).toBeNull();
  });

  it('extracts and clamps fields from source material', async () => {
    const r = await extractDNAFromAssets(
      { readme: 'Foundry helps solo SaaS founders.' },
      productId
    );
    expect(r.icp_description).toBeTruthy();
    expect(r.positioning_statement).toBeTruthy();
    // 250-char clamp
    expect((r.icp_description ?? '').length).toBeLessThanOrEqual(250);
  });

  it('returns nulls when LLM returns invalid JSON', async () => {
    mockResponse = 'not-json';
    const r = await extractDNAFromAssets(
      { readme: 'something' },
      productId
    );
    expect(r.icp_description).toBeNull();
    // Reset for other tests
    mockResponse = JSON.stringify({
      icp_description: 'X',
      positioning_statement: 'Y',
      icp_pain: null, icp_trigger: null,
      what_we_are_not: null, primary_objection: null,
      objection_response: null, market_insight: null,
    });
  });
});
