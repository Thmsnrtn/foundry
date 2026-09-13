// =============================================================================
// Tests: Wave 2 — rejection-streak / dna-autofill
//
// Two of the four subjects are gone. `founder/feedback.ts` (NPS and rejection
// reasons) and `intelligence/shippability.ts` were reachable from no entry
// point and have been deleted, and the ten cases that called them went with
// them. The two below still have live services.
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
import { runMigrations } from '../../src/db/migrate.js';
import {
  recordRejection,
  recordApproval,
  getStreak,
} from '../../src/services/founder/rejection-streak.js';
import { extractDNAFromAssets } from '../../src/services/wisdom/dna-autofill.js';

let founderId: string;
let productId: string;

beforeAll(async () => {
  // The migrations are the schema. Tables this file used to write by hand are
  // already here, in the shape the product actually has — including the NOT
  // NULL columns and foreign keys a hand-written stand-in leaves out.
  await runMigrations();
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
