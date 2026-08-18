// =============================================================================
// Tests: erasing the PERSON, not just their companies.
//
// `eraseFounderAccount` erased every company the founder owned, redacted the
// `founders` row, and stopped. The fifteen tables that belong to the founder
// rather than to a product were listed — with a sentence each explaining why
// they survive erasing ONE OF TWO COMPANIES — and nothing ever ran against
// them when the person themselves was erased. Being out of scope for a product
// erasure had been read as having been decided about.
//
// The end-to-end sweep in erasure-leaves-no-trace proves the ids are gone.
// This file proves the three cases where "gone" is the WRONG answer and the
// disposition has to be more careful than a delete:
//
//   • an introduction names a SECOND FOUNDER who did not ask for anything;
//   • a referral conversion is the REFERRER'S attribution, not the invitee's;
//   • the global daily spend ceiling belongs to the institution and must not
//     shrink because a company left.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  eraseFounderAccount,
  FOUNDER_SCOPED_DISPOSITIONS,
} from '../../src/services/privacy/consent.js';

const GONE = 'ad_gone';        // the founder being erased
const STAYS = 'ad_stays';      // the other person in every one of these records

async function one(sql: string, args: unknown[] = []): Promise<Record<string, unknown> | undefined> {
  return (await query(sql, args as never[])).rows[0] as unknown as Record<string, unknown> | undefined;
}

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  for (const t of ['introductions', 'referral_conversions', 'referral_links',
    'ai_daily_spend', 'ai_spend_reservations', 'products', 'founders']) {
    await query(`DELETE FROM ${t}`);
  }
  for (const [id, email] of [[GONE, 'gone@example.com'], [STAYS, 'stays@example.com']]) {
    await query(`INSERT INTO founders (id, clerk_user_id, email, name) VALUES (?,?,?,?)`,
      [id, `clerk_${id}`, email, 'A Founder']);
  }
});

describe('every founder-scoped table has an op, and it is the op that runs', () => {
  it('leaves none of them merely explained', () => {
    // The old shape was a reason with no op. A reason is not a decision about
    // what happens to the rows.
    for (const [table, d] of Object.entries(FOUNDER_SCOPED_DISPOSITIONS)) {
      expect(d.onAccountErasure?.op, `${table} says why it survives a product erasure and not what happens to it when the person goes`)
        .toMatch(/^(delete|redact|sever)$/);
      expect(d.reason.length, `${table} must still say why it is founder-scoped`).toBeGreaterThan(15);
    }
  });

  it('severs exactly the tables that hold a second person, and deletes the rest', () => {
    // Which tables sever is the whole judgement in this change: sever one too
    // few and a second founder's record is destroyed; sever one too many and
    // the erased person's own data survives under a marker.
    const severed = Object.entries(FOUNDER_SCOPED_DISPOSITIONS)
      .filter(([, d]) => d.onAccountErasure.op === 'sever').map(([t]) => t).sort();
    expect(severed).toEqual(['introductions', 'referral_conversions']);
  });
});

describe('an introduction belongs to two people', () => {
  it('cuts the erased founder loose without deleting the other one\'s record', async () => {
    const id = nanoid();
    await query(
      `INSERT INTO introductions (id, founder_a_id, founder_b_id, match_reason, status, feedback_a, feedback_b)
       VALUES (?, ?, ?, 'similar stage', 'accepted', 'what GONE thought', 'what STAYS thought')`,
      [id, GONE, STAYS]);

    await eraseFounderAccount(GONE);

    const row = await one(`SELECT * FROM introductions WHERE id = ?`, [id]);
    expect(row, 'deleting this would erase a second founder who never asked for anything')
      .toBeDefined();
    expect(row!.founder_a_id, 'the erased founder is still named').not.toBe(GONE);
    expect(row!.feedback_a, 'the erased founder\'s own words survived').toBeNull();
    // And the other person keeps everything that is theirs.
    expect(row!.founder_b_id).toBe(STAYS);
    expect(row!.feedback_b).toBe('what STAYS thought');
  });

  it('does the same when the erased founder is the second party', async () => {
    // The sever runs per party column. Handling only `founder_a_id` would
    // leave every introduction where this person was the one being introduced
    // TO still naming them, which is half the rows.
    const id = nanoid();
    await query(
      `INSERT INTO introductions (id, founder_a_id, founder_b_id, match_reason, status, feedback_a, feedback_b)
       VALUES (?, ?, ?, 'similar stage', 'accepted', 'what STAYS thought', 'what GONE thought')`,
      [id, STAYS, GONE]);

    await eraseFounderAccount(GONE);

    const row = await one(`SELECT * FROM introductions WHERE id = ?`, [id]);
    expect(row!.founder_b_id).not.toBe(GONE);
    expect(row!.feedback_b).toBeNull();
    expect(row!.founder_a_id).toBe(STAYS);
    expect(row!.feedback_a).toBe('what STAYS thought');
  });
});

describe('a referral conversion is the referrer\'s attribution', () => {
  it('keeps that somebody was referred and stops saying who', async () => {
    const link = nanoid();
    const conv = nanoid();
    await query(
      `INSERT INTO referral_links (id, founder_id, code) VALUES (?, ?, 'STAYSCODE')`,
      [link, STAYS]);
    await query(
      `INSERT INTO referral_conversions (id, referral_link_id, event_type, invited_founder_id)
       VALUES (?, ?, 'paid', ?)`, [conv, link, GONE]);

    await eraseFounderAccount(GONE);

    const row = await one(`SELECT * FROM referral_conversions WHERE id = ?`, [conv]);
    expect(row, 'the referrer may be owed for this conversion').toBeDefined();
    expect(row!.event_type).toBe('paid');
    expect(row!.invited_founder_id, 'who it was is not part of the referrer\'s fact')
      .toBeNull();
  });

  it('takes the erased founder\'s own link and its conversions with them', async () => {
    // Their own referral history is theirs, and cascades off the link.
    const link = nanoid();
    await query(
      `INSERT INTO referral_links (id, founder_id, code) VALUES (?, ?, 'GONECODE')`,
      [link, GONE]);
    await query(
      `INSERT INTO referral_conversions (id, referral_link_id, event_type, invited_founder_id)
       VALUES (?, ?, 'signup', ?)`, [nanoid(), link, STAYS]);

    await eraseFounderAccount(GONE);

    expect(await one(`SELECT id FROM referral_links WHERE id = ?`, [link])).toBeUndefined();
    expect(await one(`SELECT id FROM referral_conversions WHERE referral_link_id = ?`, [link]))
      .toBeUndefined();
  });
});

describe('the daily spend rollup carries the company and the person under one column', () => {
  it('erases both scopes and leaves the institution\'s total alone', async () => {
    // `scope_id` is a product id when scope='product' and a founder id when
    // scope='founder'. The table had been classified as naming nobody, on the
    // stated grounds that it is "keyed by scope, not by company row" — which
    // is how a company's per-day activity trace survived its own erasure.
    const product = 'ad_product';
    await query(
      `INSERT INTO products (id, name, owner_id, status, scp_status)
       VALUES (?, 'Doomed Co', ?, 'active', 'active')`, [product, GONE]);
    const day = '2024-03-01';
    for (const [scope, scopeId] of [
      ['product', product], ['founder', GONE], ['global', '__global__'],
    ]) {
      await query(
        `INSERT INTO ai_daily_spend (scope, scope_id, date, spent_cents, updated_at)
         VALUES (?, ?, ?, 500, datetime('now'))`, [scope, scopeId, day]);
    }

    await eraseFounderAccount(GONE);

    expect(await one(
      `SELECT scope_id FROM ai_daily_spend WHERE scope='product' AND scope_id=?`, [product]),
      'the company\'s per-day spend trace survived its erasure').toBeUndefined();
    expect(await one(
      `SELECT scope_id FROM ai_daily_spend WHERE scope='founder' AND scope_id=?`, [GONE]),
      'the person\'s per-day spend trace survived their erasure').toBeUndefined();

    const global = await one(
      `SELECT spent_cents FROM ai_daily_spend WHERE scope='global' AND scope_id='__global__'`);
    expect(global, 'the institution\'s own daily ceiling is not a customer\'s data')
      .toBeDefined();
    expect(Number(global!.spent_cents),
      'an erasure that lowers the global spend total hands back budget that was really spent')
      .toBe(500);
  });

  it('does not take another company\'s rollup with it', async () => {
    const mine = 'ad_mine';
    const theirs = 'ad_theirs';
    await query(
      `INSERT INTO products (id, name, owner_id, status, scp_status)
       VALUES (?, 'Mine', ?, 'active', 'active')`, [mine, GONE]);
    await query(
      `INSERT INTO products (id, name, owner_id, status, scp_status)
       VALUES (?, 'Theirs', ?, 'active', 'active')`, [theirs, STAYS]);
    for (const id of [mine, theirs]) {
      await query(
        `INSERT INTO ai_daily_spend (scope, scope_id, date, spent_cents, updated_at)
         VALUES ('product', ?, '2024-03-02', 100, datetime('now'))`, [id]);
    }

    await eraseFounderAccount(GONE);

    expect(await one(`SELECT scope_id FROM ai_daily_spend WHERE scope_id=?`, [mine]))
      .toBeUndefined();
    expect(await one(`SELECT scope_id FROM ai_daily_spend WHERE scope_id=?`, [theirs]),
      'the `where` narrowed the delete by scope and must not widen it across companies')
      .toBeDefined();
  });
});
