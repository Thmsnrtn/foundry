// =============================================================================
// Tests: the grace period had no door
//
// "Deletion scheduled. Product data will be removed after 30 days." The page
// says the thirty days mean something. They did not:
//
//   • nothing cancelled a scheduled deletion — the only exits were the
//     processor completing it or the row never being read;
//   • the page showed a banner once and then looked exactly as it had before,
//     for a month, with no sign anything was coming;
//   • the same page said both "after a 30-day grace period" and "this action
//     cannot be undone", which cannot both be true;
//   • and the record said `actor_type='system', actor_id='system'` — on the
//     one trail where WHO ASKED is the entire point.
//
// A grace period nobody can see and nobody can act in is a countdown.
//
// The cancellation is an EVENT, not a deleted row: the request happened, and an
// erasure trail that erases its own history is not a trail. Which means it has
// to be ordered — a cancellation annuls the schedule it FOLLOWS, so a founder
// who cancels and later schedules again is not ignored forever.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  cancelDataDeletion, pendingDeletion, processScheduledDeletions, scheduleDataDeletion,
} from '../../src/services/privacy/consent.js';

const OWNER = 'dg_owner';
const P = 'dg_product';

/** Backdate the newest schedule so the processor considers it due. */
async function backdateSchedule(days: number): Promise<void> {
  const row = (await query(
    `SELECT id, metadata_json FROM agent_audit_log
      WHERE event_type = 'data_deletion_scheduled' AND target_id = ?
      ORDER BY created_at DESC LIMIT 1`, [P])).rows[0] as Record<string, unknown>;
  const meta = JSON.parse(String(row.metadata_json));
  meta.scheduled_at = new Date(Date.now() - days * 86_400_000).toISOString();
  await query(`UPDATE agent_audit_log SET metadata_json = ? WHERE id = ?`,
    [JSON.stringify(meta), String(row.id)]);
}

async function events(): Promise<string[]> {
  return ((await query(
    `SELECT event_type FROM agent_audit_log WHERE target_id = ?
      ORDER BY created_at, rowid`, [P])).rows as unknown as Array<{ event_type: string }>)
    .map((r) => r.event_type);
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [OWNER, 'clerk_dg', 'dg@test.local']);
});

beforeEach(async () => {
  await query(`DELETE FROM agent_audit_log WHERE target_id = ?`, [P]);
  await query(`DELETE FROM products WHERE id = ?`, [P]);
  await query(
    `INSERT INTO products (id, name, owner_id, status) VALUES (?, 'Grace Co', ?, 'active')`,
    [P, OWNER]);
});

describe('what is pending is visible', () => {
  it('reports nothing when nothing is scheduled', async () => {
    expect(await pendingDeletion(P)).toBeNull();
  });

  it('names the date and the person who asked', async () => {
    await scheduleDataDeletion(P, 30, OWNER);
    const pending = await pendingDeletion(P);
    expect(pending).not.toBeNull();
    expect(pending!.deleteAfterDays).toBe(30);
    expect(pending!.requestedBy, 'the erasure trail is where WHO ASKED matters most')
      .toBe(OWNER);
    const days = (new Date(pending!.deletesOn).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it('reports nothing once the deletion has run', async () => {
    await scheduleDataDeletion(P, 30, OWNER);
    await backdateSchedule(31);
    await processScheduledDeletions();
    expect(await pendingDeletion(P)).toBeNull();
  });
});

describe('the window can actually be used', () => {
  it('stops a scheduled deletion', async () => {
    await scheduleDataDeletion(P, 30, OWNER);
    expect(await cancelDataDeletion(P, OWNER)).toBe(true);
    expect(await pendingDeletion(P)).toBeNull();
  });

  it('and the processor honours it when the day comes', async () => {
    await scheduleDataDeletion(P, 30, OWNER);
    await backdateSchedule(31);
    await cancelDataDeletion(P, OWNER);

    const outcome = await processScheduledDeletions();
    expect(outcome.completed).toBe(0);
    expect(await events(), 'a cancelled deletion is not a delayed one')
      .toEqual(['data_deletion_scheduled', 'data_deletion_cancelled']);
  });

  it('keeps the request on the record rather than deleting the row', async () => {
    await scheduleDataDeletion(P, 30, OWNER);
    await cancelDataDeletion(P, OWNER);
    expect(await events()).toEqual(['data_deletion_scheduled', 'data_deletion_cancelled']);
  });

  it('refuses to cancel what was never scheduled', async () => {
    expect(await cancelDataDeletion(P, OWNER)).toBe(false);
    expect(await events()).toEqual([]);
  });

  it('cannot cancel a deletion that has already run', async () => {
    await scheduleDataDeletion(P, 30, OWNER);
    await backdateSchedule(31);
    await processScheduledDeletions();
    expect(await cancelDataDeletion(P, OWNER),
      'the data is gone; saying "cancelled" would be a lie').toBe(false);
  });
});

describe('a cancellation annuls the schedule it follows, and no other', () => {
  it('lets a founder change their mind twice', async () => {
    // The blanket version of this — "has this product ever been cancelled?" —
    // would ignore every future request forever, which is a compliance failure
    // wearing the shape of a safety feature.
    await scheduleDataDeletion(P, 30, OWNER);
    await cancelDataDeletion(P, OWNER);
    await new Promise((r) => setTimeout(r, 1100)); // created_at has 1s resolution
    await scheduleDataDeletion(P, 30, OWNER);

    expect(await pendingDeletion(P), 'the second request stands').not.toBeNull();
    await backdateSchedule(31);
    const outcome = await processScheduledDeletions();
    expect(outcome.completed).toBe(1);
    expect(await events()).toContain('data_deletion_completed');
  });
});

// ── the window is a wind-down, not just a countdown ─────────────────────────

describe('a company on its way out stops acting', () => {
  it('is not an operating company while a deletion is scheduled', async () => {
    const { operatingProduct } = await import('../../src/db/client.js');
    const operating = async (): Promise<boolean> => Number(((await query(
      `SELECT CASE WHEN ${operatingProduct()} THEN 1 ELSE 0 END AS ok
         FROM products WHERE id = ?`, [P])).rows[0] as Record<string, unknown>).ok) === 1;

    expect(await operating()).toBe(true);
    await scheduleDataDeletion(P, 30, OWNER);
    expect(await operating(),
      'agents, mail and AI spend all hang off this one predicate').toBe(false);
    await cancelDataDeletion(P, OWNER);
    expect(await operating(), 'cancelling restores everything').toBe(true);
  });

  it('refuses an outward effect, and says which pause it is', async () => {
    const { checkKillSwitch } = await import('../../src/services/outbound/kill-switch.js');
    expect((await checkKillSwitch(P, 'send_email')).blocked).toBe(false);
    await scheduleDataDeletion(P, 30, OWNER);
    const gate = await checkKillSwitch(P, 'send_email');
    expect(gate.blocked).toBe(true);
    expect(gate.reason).toContain('scheduled for deletion');
  });

  it('does not exempt even the capabilities a paused company still delivers', async () => {
    // Account mail is exempt from the billing pause, because a founder whose
    // card was declined needs to hear it. A company being deleted is different:
    // there is no case for continuing to reach anybody on its behalf.
    const { checkKillSwitch } = await import('../../src/services/outbound/kill-switch.js');
    await scheduleDataDeletion(P, 30, OWNER);
    const gate = await checkKillSwitch(P, 'send_email', null, { deliverableWhilePaused: true });
    expect(gate.blocked).toBe(true);
  });

  it('does not lock the founder out of writing to their own account', async () => {
    // The window exists so they can change their mind. Refusing their API
    // writes for a month is a punishment for a reversible click.
    const { companyMayBeChanged } = await import('../../src/api/middleware/entitlement.js');
    await scheduleDataDeletion(P, 30, OWNER);
    expect((await companyMayBeChanged(P)).allowed).toBe(true);
  });

  it('still refuses writes when something ELSE is also wrong', async () => {
    // The exemption is for the erasure axis alone. A company that is also
    // unpaid stays read-only, exactly as before.
    const { companyMayBeChanged } = await import('../../src/api/middleware/entitlement.js');
    await scheduleDataDeletion(P, 30, OWNER);
    await query(
      `UPDATE products SET entitlement_paused_at = datetime('now') WHERE id = ?`, [P]);
    expect((await companyMayBeChanged(P)).allowed).toBe(false);
    await query(`UPDATE products SET entitlement_paused_at = NULL WHERE id = ?`, [P]);
  });

  it('keeps the column and the ledger telling the same story', async () => {
    // Two records of one fact is a drift risk taken deliberately: the hot paths
    // read a column, the audit trail keeps the events. They must not disagree.
    const columnSet = async (): Promise<boolean> => ((await query(
      `SELECT erasure_scheduled_at FROM products WHERE id = ?`, [P]))
      .rows[0] as Record<string, unknown>).erasure_scheduled_at != null;

    expect(columnSet()).resolves.toBe(await pendingDeletion(P) != null);
    await scheduleDataDeletion(P, 30, OWNER);
    expect(await columnSet()).toBe(true);
    expect(await pendingDeletion(P)).not.toBeNull();
    await cancelDataDeletion(P, OWNER);
    expect(await columnSet()).toBe(false);
    expect(await pendingDeletion(P)).toBeNull();
  });
});
