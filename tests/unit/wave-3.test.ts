// =============================================================================
// Tests: Wave 3 — referrals
//
// Three of the four subjects are gone. `financial-snapshot` went first (no
// caller, and its AI-cost figure came from a table nothing wrote).
// `intelligence/peer-signal.ts` and `distribution/briefing-share.ts` have now
// followed as reachable from no entry point, and the five cases that exercised
// them went with the modules they were reading — including the one that pinned
// the peer reader to counting COMPANIES rather than rows, which is a rule that
// now has no code to bind.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import {
  getOrCreateReferralLink,
  resolveReferralCode,
  recordReferralEvent,
} from '../../src/services/distribution/referrals.js';

let founderId: string;
let productId: string;

async function setupSchema(): Promise<void> {
  await executeRaw(`
    -- The real AI cost ledger. This fixture used to create ai_cost_log, a
    -- table no migration has ever created, with a cost_usd column and a
    -- timestamp clock — so the feature passed against a schema that existed
    -- only inside this file, while the query threw on every real call.
  `);
  await executeRaw(
    readFileSync(
      resolve(__dirname, '../../src/db/migrations/071_referrals_and_shares.sql'),
      'utf-8'
    )
  );
}

beforeAll(async () => {
  // The migrations are the schema. Tables this file used to write by hand are
  // already here, in the shape the product actually has — including the NOT
  // NULL columns and foreign keys a hand-written stand-in leaves out.
  await runMigrations();
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
  await executeRaw('DELETE FROM metric_snapshots');
  await executeRaw('DELETE FROM referral_links');
  await executeRaw('DELETE FROM referral_conversions');
  await executeRaw('DELETE FROM briefing_shares');
});

// ─── Financial snapshot ──────────────────────────────────────────────────────

// `financial-snapshot` was deleted in this batch. It had no callers anywhere,
// and its AI-cost figure came from `ai_usage_log`, a table nothing in
// production ever wrote to — so the case removed from here INSERTED rows into
// that table itself to make the assertion pass. A test that manufactures the
// evidence for its own subject proves the function computes, not that the
// company's operating margin was ever known. The real per-company AI cost is
// in `ai_daily_spend`, which the spend ceiling maintains.

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
