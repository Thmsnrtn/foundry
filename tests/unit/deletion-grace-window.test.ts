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
import { readFileSync } from 'node:fs';

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

  it('refuses the API write surface, and names the erasure as the reason', async () => {
    // THIS TEST USED TO ASSERT THE OPPOSITE, on the reasoning that the window
    // exists so the founder can change their mind and refusing their writes
    // for a month punishes a reversible click. The reasoning is right; the
    // exemption did not serve it. The write that changes their mind is
    // `POST /privacy/delete/cancel` on the dashboard, which this middleware
    // never sees — see the test below. What the exemption reached was the v1
    // surface: new customers, new metrics, new experiments, agent runs, and
    // approving an action for execution through the voice webhook. None of
    // those reverse an erasure and all of them add to a company being deleted.
    const { companyMayBeChanged } = await import('../../src/api/middleware/entitlement.js');
    await scheduleDataDeletion(P, 30, OWNER);
    const verdict = await companyMayBeChanged(P);
    expect(verdict.allowed).toBe(false);
    // §7: three different facts, three different answers. A caller that has to
    // tell the founder why cannot do it from a collapsed status.
    expect(verdict.allowed === false && verdict.axis).toBe('erasure');
  });

  it('leaves changing your mind on a surface this never guards', async () => {
    // The claim above is only honest if the cancel route really is out of
    // reach of this middleware. `requireOperatingForWrites` is mounted on the
    // v1 API alone; the reversal is a dashboard POST behind `requireOwner()`.
    const dashboard = readFileSync('src/routes/dashboard/privacy.ts', 'utf8');
    expect(dashboard).toContain("privacySettings.post('/privacy/delete/cancel'");
    expect(dashboard, 'the reversal must not be behind the gate that refuses erasing companies')
      .not.toContain('requireOperatingForWrites');
    const mounted = readFileSync('src/api/v1/index.ts', 'utf8');
    expect(mounted).toContain('requireOperatingForWrites');
  });

  it('keeps a reduction available all the way to the end', async () => {
    // §8's permitted purposes are not empty. Disconnecting an outbound webhook
    // reduces what Foundry can do to the outside world, and a company being
    // deleted should never be made to wait thirty days for it.
    const { ERASURE_PERMITTED_REDUCTIONS } = await import(
      '../../src/api/middleware/entitlement.js');
    const webhook = ERASURE_PERMITTED_REDUCTIONS.find(
      (r) => r.method === 'DELETE' && r.path.test('/v1/webhooks/wh_123'));
    expect(webhook, 'disconnecting must stay reachable while an erasure is pending')
      .toBeDefined();
    // And the door is narrow: it is not open to writes that ADD.
    for (const r of ERASURE_PERMITTED_REDUCTIONS) {
      expect(r.method, 'a permitted purpose that creates data is not a reduction')
        .not.toBe('POST');
      expect(r.purpose.length, `${r.method} ${r.path} must say why it is permitted`)
        .toBeGreaterThan(20);
    }
    expect(ERASURE_PERMITTED_REDUCTIONS.some((r) => r.path.test('/v1/customers')),
      'creating a customer is not a reduction').toBe(false);
  });

  it('still refuses writes when something ELSE is also wrong', async () => {
    // A company that is also unpaid answers on the entitlement axis, not the
    // erasure one — the axes stay distinguishable when they overlap.
    const { companyMayBeChanged } = await import('../../src/api/middleware/entitlement.js');
    await scheduleDataDeletion(P, 30, OWNER);
    await query(
      `UPDATE products SET entitlement_paused_at = datetime('now') WHERE id = ?`, [P]);
    const verdict = await companyMayBeChanged(P);
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.axis).toBe('entitlement');
    await query(`UPDATE products SET entitlement_paused_at = NULL WHERE id = ?`, [P]);
  });

  it('leaves a door open when an account erasure half-fails', async () => {
    // THE FROZEN COMPANY. `eraseFounderAccount` pauses each product before
    // erasing it. If the erasure then throws, the pause stays — and the
    // immediate path wrote no ledger row, so `pendingDeletion` found nothing,
    // `cancelDataDeletion` refused, and the company was left not operating
    // with no reachable way back. Not hypothetical: the identity provider's
    // webhook is the only caller of this path, and it retries.
    //
    // Its own founder and company: a half-erasure deliberately leaves children
    // behind, which would break the shared fixture's teardown.
    const F2 = 'dg_halfowner';
    const P2 = 'dg_halfproduct';
    await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
      [F2, 'clerk_dg_half', 'half@test.local']);
    await query(
      `INSERT INTO products (id, name, owner_id, status) VALUES (?, 'Half Co', ?, 'active')`,
      [P2, F2]);
    // The failure is planted rather than imagined — a trigger that refuses one
    // delete in the plan, which is what a real constraint violation looks like.
    await query(
      `CREATE TRIGGER dg_break_erasure BEFORE DELETE ON metric_snapshots
       BEGIN SELECT RAISE(ABORT, 'planted:refuse'); END`);
    try {
      await query(
        `INSERT INTO metric_snapshots (id, product_id, snapshot_date, nps_score)
         VALUES ('dg_snap', ?, date('now'), 40)`, [P2]);
      const { eraseFounderAccount } = await import('../../src/services/privacy/consent.js');
      const outcome = await eraseFounderAccount(F2);
      expect(outcome.failed.length, 'the planted failure did not fire').toBeGreaterThan(0);

      const paused = ((await query(
        `SELECT erasure_scheduled_at FROM products WHERE id = ?`, [P2]))
        .rows[0] as Record<string, unknown>).erasure_scheduled_at;
      expect(paused, 'a half-erased company should still be paused').not.toBeNull();
      expect(await pendingDeletion(P2),
        'the company is paused and nothing says why, so nothing can undo it')
        .not.toBeNull();
      expect(await cancelDataDeletion(P2, F2),
        'the only way out of a frozen company must actually work').toBe(true);
    } finally {
      await query('DROP TRIGGER IF EXISTS dg_break_erasure');
    }
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

describe('a malformed record must not remove the founder\'s exit', () => {
  it('never throws, whatever the audit row says', async () => {
    // `pendingDeletion` is the only reader that tells a founder a deletion is
    // coming, and the page carrying it is the only place they can stop it. It
    // computed `new Date(scheduledAt).getTime() + Number(days) * 86_400_000`
    // and called `.toISOString()` on the result — so a row with an unparseable
    // `delete_after_days` produced NaN and threw a RangeError, taking the
    // countdown AND the cancel door with it.
    //
    // Found because a test called `scheduleDataDeletion(P, OWNER)` and put a
    // founder id where the day count goes. A caller can be wrong; the reader
    // that stands between somebody and their data being deleted should still
    // answer.
    await cancelDataDeletion(P, OWNER).catch(() => false);
    await scheduleDataDeletion(P, 30, OWNER);
    for (const broken of [
      JSON.stringify({ delete_after_days: 'not a number', scheduled_at: 'whenever' }),
      JSON.stringify({ delete_after_days: -5 }),
      'not json at all',
      '{}',
      // A NULL metadata_json is deliberately not in this list: the column is
      // NOT NULL, so the schema already makes that case impossible and the
      // database refused the fixture that tried to build it.
    ]) {
      await query(
        `UPDATE agent_audit_log SET metadata_json = ?
          WHERE event_type='data_deletion_scheduled' AND target_id = ?`, [broken, P]);
      const pending = await pendingDeletion(P);
      expect(pending, `a ${String(broken).slice(0, 20)} row still reports a pending deletion`)
        .not.toBeNull();
      // The fallback is the documented promise, not an invented number.
      expect(pending!.deleteAfterDays).toBe(30);
      expect(Number.isFinite(Date.parse(pending!.deletesOn)),
        'and the date it gives is a date').toBe(true);
    }
    await cancelDataDeletion(P, OWNER);
  });
});

describe('the sign is on the page the founder actually opens', () => {
  it('says a deletion is coming on The Letter, with a way to stop it', async () => {
    // The door was built and then put somewhere a founder has to already
    // suspect something to find. `consent.ts` states the case in the comment
    // beside the cancel path: "a founder who clicked by accident, or whose
    // co-founder clicked, could do nothing but watch, and nothing on the page
    // even told them it was coming." The Letter is the page they open daily.
    const { Hono } = await import('hono');
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never, { id: OWNER, email: 'dg@test.local', preferences: {} } as never);
      c.set('csrfToken' as never, 't' as never);
      await next();
    });
    app.route('/', letterRoutes);

    // Nothing scheduled: the letter must not invent a countdown.
    await cancelDataDeletion(P, OWNER).catch(() => false);
    const quiet = await (await app.request('/letter')).text();
    expect(quiet).not.toContain('This company is being deleted');

    await scheduleDataDeletion(P, 30, OWNER);
    const warned = await (await app.request('/letter')).text();
    expect(warned, 'the biggest fact about the company must be on the page')
      .toContain('This company is being deleted');
    expect(warned, 'and it must not read as somebody else\'s decision')
      .toContain('it does not have to be you who asked for it');
    expect(warned, 'with the door, not just the news').toContain('/privacy');

    // Cancelling takes the notice away, so the page never outlives the fact.
    await cancelDataDeletion(P, OWNER);
    expect(await (await app.request('/letter')).text())
      .not.toContain('This company is being deleted');
  });
});
