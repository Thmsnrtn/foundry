// =============================================================================
// Tests: Wave 3 — peer signal / financial snapshot / referrals / briefing share
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import {
  topPeerValidatedDecisionTypes,
} from '../../src/services/intelligence/peer-signal.js';
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

// ─── Peer signal ─────────────────────────────────────────────────────────────

describe('peer-signal', () => {
  it('has one implementation, and it is the one that counts companies', async () => {
    // `computePeerSignal` and `decorateForDisplay` were deleted with the tests
    // that pinned them. They counted ROWS — no contributor floor, and rows with
    // no `contributor_hash` (the seed writes one) counted too — and then said
    // "Founders like you who acted on this saw positive outcomes 75% of the
    // time (n=4)" about what could be one company deciding four times. The test
    // here asserted `sample_size === 4` on four unattributed rows: the defect,
    // recorded as the expected behaviour.
    //
    // Neither had a production caller. The correct reader is below.
    const { stripComments } = await import('../../scripts/lib/strip-comments.mjs');
    const { readFileSync } = await import('node:fs');
    const src = stripComments(
      readFileSync('src/services/intelligence/peer-signal.ts', 'utf8'), { lineComments: true });
    expect(src).not.toMatch(/export async function computePeerSignal/);
    expect(src).toContain('COUNT(DISTINCT contributor_hash)');
    // `decorateForDisplay` survives — its only caller counts companies — and
    // its floor is now the shared constant rather than a second literal 5.
    expect(src).toContain('signal.sample_size >= PEER_SIGNAL_MIN_SAMPLE');
  });

  it('topPeerValidatedDecisionTypes counts COMPANIES, not rows', async () => {
    // This case used to insert six rows with no contributor and expect them to
    // qualify, because the reader counted rows. "n=5 founders like you" then
    // meant five DECISIONS, which one company satisfies on its own — and the
    // sentence went to that company's competitor. The reader now counts
    // distinct contributors, so the fixture says which company each row is.
    //
    // pricing_change: six different companies, five positive → 83% (qualifies)
    const dirs = ['positive', 'positive', 'positive', 'positive', 'positive', 'negative'];
    for (const [i, dir] of dirs.entries()) {
      await query(
        `INSERT INTO decision_patterns (id, decision_type, product_lifecycle_stage,
           risk_state_at_decision, key_metrics_context, option_chosen_category, outcome_direction,
           contributor_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [nanoid(), 'pricing_change', 'growth', 'green', '{}', 'inc', dir, `peer_co_${i}`]
      );
    }
    // small_sample: three companies (under the floor)
    for (const [i, dir] of ['positive', 'positive', 'positive'].entries()) {
      await query(
        `INSERT INTO decision_patterns (id, decision_type, product_lifecycle_stage,
           risk_state_at_decision, key_metrics_context, option_chosen_category, outcome_direction,
           contributor_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [nanoid(), 'small_sample', 'growth', 'green', '{}', 'inc', dir, `small_co_${i}`]
      );
    }
    // one_company_many_times: eight rows, one company. Qualified before.
    for (let i = 0; i < 8; i += 1) {
      await query(
        `INSERT INTO decision_patterns (id, decision_type, product_lifecycle_stage,
           risk_state_at_decision, key_metrics_context, option_chosen_category, outcome_direction,
           contributor_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [nanoid(), 'one_company_many_times', 'growth', 'green', '{}', 'inc', 'positive', 'busy_co']
      );
    }
    const top = await topPeerValidatedDecisionTypes('growth', 5);
    expect(top.map((t) => t.decision_type)).toEqual(['pricing_change']);
    expect(top[0].sample_size).toBe(6);
  });
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
      `INSERT INTO scp_briefings (id, product_id, briefing_date, signal_score, headline, full_briefing)
       VALUES (?, ?, date('now'), 80, 'Test headline', 'The whole briefing.')`,
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
      `INSERT INTO scp_briefings (id, product_id, briefing_date, signal_score, headline, full_briefing)
       VALUES (?, ?, date('now'), 80, 'Test', 'The whole briefing.')`,
      ['briefing-2', productId]
    );
    const code = await createBriefingShare(founderId, productId, 'briefing-2');
    const ok = await revokeShare(founderId, code);
    expect(ok).toBe(true);
    const r = await resolveShare(code);
    expect(r).toBeNull();
  });
});
