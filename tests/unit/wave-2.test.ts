// =============================================================================
// Tests: Wave 2 — rejection-streak
//
// Three of the four subjects are gone. `founder/feedback.ts` (NPS and rejection
// reasons) and `intelligence/shippability.ts` were reachable from no entry
// point and have been deleted, and the ten cases that called them went with
// them. The two below still have live services.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import {
  recordRejection,
  recordApproval,
  getStreak,
} from '../../src/services/founder/rejection-streak.js';

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

// ─── DNA AUTO-FILL, GONE WITH WHAT CALLED IT ─────────────────────────────────
//
// `services/wisdom/dna-autofill.ts` read a founder's GitHub README, landing
// page and Stripe product descriptions, asked a model to extract an ICP,
// positioning statement and primary objection from them, and pre-filled the
// Product DNA so nobody typed from blank. Its one caller was the onboarding
// wizard's audit step.
//
// That wizard is deleted — nine commercial routes, including the GitHub OAuth
// exchange and repository picker that supplied the README. The owner's instance
// holds no repositories and no competitors, so the module had no source
// material to read and nothing left to call it. `check-reachability` found it
// the moment its caller went, which is what that gate is for.
//
// The four checks here exercised the extractor directly, and the wiring test
// next door asserted the wizard still called it. Both went with the module. The
// rejection-streak checks above are untouched — a different faculty, still
// reachable, still running.
