// =============================================================================
// Tests: three facts, three fields, three writers
//
// A product has three independent facts, and two fields were carrying all
// three:
//
//   LIFECYCLE              does this record exist        products.status
//   OPERATING PERMISSION   may Foundry carry work now    products.scp_status
//   COMMERCIAL ENTITLEMENT is the account paid up        nowhere
//
// Entitlement had no field of its own, so the hourly billing sweep wrote into
// `scp_status` — the same field a founder writes when pausing their own
// company. The sweep's comment claimed "a product paused for any OTHER reason
// is left alone". It could not have been: a field does not record which of
// three subjects wrote it. The only reason the sweep did not resume a
// founder-paused company was an accident — the founder's pause ALSO wrote
// `status='paused'`, and the sweep's selection filtered on `status='active'`.
//
// That accident was itself the second defect. `status` is read by the paths
// that ADMINISTER the relationship rather than operate the company: the
// entitlement sweep, account mail, export, erasure. Pausing a company removed
// it from all of them, so a founder who paused and then had a card declined was
// told nothing about it.
//
// This is the batch's lens exactly: the rule existed, the rule fired, and the
// rule was bound to the wrong subject.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import {
  getAllActiveProducts, operatingProduct, productRecordLives, query,
} from '../../src/db/client.js';

const F = 'ax_founder';
/** A fresh product per case. Cases leave audit rows and idempotency keys
 * behind, and deleting the product row would fail on their foreign keys. */
let P: string;

beforeAll(async () => {
  await runMigrations();
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, tier) VALUES (?,?,?,'growth')`,
    [F, 'ax_clerk', 'axes@example.com']);
});

beforeEach(async () => {
  P = `ax_${nanoid(8)}`;
  await query("UPDATE founders SET tier = 'growth', trial_ends_at = NULL WHERE id = ?", [F]);
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status)
     VALUES (?, 'Axes Co', ?, 'active', 'active')`, [P, F]);
});

async function operating(): Promise<boolean> {
  const r = await query(
    `SELECT id FROM products WHERE id = ? AND ${operatingProduct()}`, [P]);
  return r.rows.length === 1;
}

async function recordLives(): Promise<boolean> {
  const r = await query(
    `SELECT id FROM products WHERE id = ? AND ${productRecordLives()}`, [P]);
  return r.rows.length === 1;
}

describe('the lifecycle axis carries only lifecycle', () => {
  it('refuses to record a pause as a lifecycle state', async () => {
    await expect(query(
      "UPDATE products SET status = 'paused' WHERE id = ?", [P]))
      .rejects.toThrow(/product_axis/);
  });

  it('refuses it on insert too', async () => {
    await expect(query(
      `INSERT INTO products (id, name, owner_id, status) VALUES (?,'X',?, 'paused')`,
      [`ax_${nanoid(8)}`, F]))
      .rejects.toThrow(/product_axis/);
  });

  it('still allows archiving', async () => {
    await query("UPDATE products SET status = 'archived' WHERE id = ?", [P]);
    expect(await recordLives()).toBe(false);
    expect(await operating()).toBe(false);
  });
});

describe('each axis stops the institution acting on its own', () => {
  it('an operating pause stops it', async () => {
    await query("UPDATE products SET scp_status = 'paused' WHERE id = ?", [P]);
    expect(await operating()).toBe(false);
  });

  it('a billing pause stops it', async () => {
    await query("UPDATE products SET entitlement_paused_at = datetime('now') WHERE id = ?", [P]);
    expect(await operating()).toBe(false);
  });

  it('and neither removes the record from administration', async () => {
    await query(
      `UPDATE products SET scp_status='paused', entitlement_paused_at=datetime('now')
        WHERE id = ?`, [P]);
    expect(await recordLives(),
      'a paused company still has an owner, data, and an account to administer')
      .toBe(true);
  });

  it('the background work list honours both', async () => {
    await query("UPDATE products SET entitlement_paused_at = datetime('now') WHERE id = ?", [P]);
    const ids = (await getAllActiveProducts()).rows.map((r) => (r as Record<string, string>).id);
    expect(ids).not.toContain(P);
  });
});

describe('the billing sweep writes only the commercial axis', () => {
  it('does not resume a company its founder deliberately paused', async () => {
    // The founder stops their company. They are fully paid up, so the hourly
    // sweep sees an entitled account — and used to write scp_status='active'
    // over the top of a decision it had no part in.
    await query("UPDATE products SET scp_status = 'paused' WHERE id = ?", [P]);
    const { sweepEntitlements } = await import('../../src/services/billing/entitlement.js');
    await sweepEntitlements();

    const row = (await query('SELECT scp_status FROM products WHERE id = ?', [P]))
      .rows[0] as Record<string, string>;
    expect(row.scp_status, 'the sweep must not undo a founder pause').toBe('paused');
  });

  it('pauses and lifts its own axis, leaving the founder axis alone', async () => {
    const { sweepEntitlements } = await import('../../src/services/billing/entitlement.js');

    // Unpaid: no tier, no trial, no paid-through.
    await query("UPDATE founders SET tier = NULL, trial_ends_at = NULL WHERE id = ?", [F]);
    await sweepEntitlements();
    let row = (await query(
      'SELECT scp_status, entitlement_paused_at FROM products WHERE id = ?', [P]))
      .rows[0] as Record<string, string | null>;
    expect(row.entitlement_paused_at).not.toBeNull();
    expect(row.scp_status, 'the operating axis is not the sweep to write').toBe('active');

    // They subscribe again.
    await query("UPDATE founders SET tier = 'growth' WHERE id = ?", [F]);
    await sweepEntitlements();
    row = (await query(
      'SELECT scp_status, entitlement_paused_at FROM products WHERE id = ?', [P]))
      .rows[0] as Record<string, string | null>;
    expect(row.entitlement_paused_at).toBeNull();
  });

  it('sweeps a founder-paused company rather than skipping it', async () => {
    // Selected on the RECORD, not on operation. Previously a paused company was
    // invisible to the sweep, so an unpaid one could be resumed by its founder
    // and act for an hour before anything noticed.
    await query("UPDATE products SET scp_status = 'paused' WHERE id = ?", [P]);
    await query("UPDATE founders SET tier = NULL, trial_ends_at = NULL WHERE id = ?", [F]);
    const { sweepEntitlements } = await import('../../src/services/billing/entitlement.js');
    await sweepEntitlements();
    const row = (await query(
      'SELECT entitlement_paused_at FROM products WHERE id = ?', [P]))
      .rows[0] as Record<string, string | null>;
    expect(row.entitlement_paused_at,
      'a paused company can still stop being paid for').not.toBeNull();
  });
});
