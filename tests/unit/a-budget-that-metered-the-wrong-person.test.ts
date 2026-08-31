process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { invoke, registerToolHandler, clearToolHandlers } from '../../src/services/outbound/gateway.js';
import { OPERATOR_WEEKLY_CAP } from '../../src/services/outbound/budget.js';

// =============================================================================
// A BUDGET THAT METERED THE WRONG PERSON, AND NEVER GAVE ANYTHING BACK.
//
// The weekly cap of three exists so Foundry's agents cannot nag a company's
// CUSTOMER. Every founder-bound send passes the founder's own address as the
// recipient key — daily briefing, weekly digest, welcome sequence, billing
// account notice — so all of it drew on one budget of three. A founder on daily
// digests was over the cap by Wednesday, and the next thing refused was
// whatever came next, including "your card was declined and the account will be
// paused".
//
// The second half: the count is taken BEFORE the send, because the cap cannot
// hold under concurrency otherwise — so it is a HOLD. It used to be permanent.
// A provider outage, a missing sender of record, a handler that refused before
// touching the wire: each spent a message from a real person's weekly
// allowance, and none of them gave it back. Three failures and the customer
// could not be contacted that week, having received nothing.
//
// Which ceiling applies is answered by the DATABASE, not by the caller. This
// file's rule is that a caller cannot skip or downgrade a control by declaring
// a safer fact, and a bigger allowance is a downgrade.
// =============================================================================

const P = 'p_budget';
const OWNER_EMAIL = 'founder@example.com';
const CUSTOMER_EMAIL = 'customer@example.com';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    ['f_bud', 'c_bud', OWNER_EMAIL]);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_bud','active')", [P]);
});

let outcome: 'ok' | 'throw' | 'refuse' = 'ok';
let calls = 0;

beforeEach(async () => {
  await query('DELETE FROM communication_budgets');
  await query('DELETE FROM audit_log');
  outcome = 'ok';
  calls = 0;
  clearToolHandlers();
  registerToolHandler('send_email', async () => {
    calls++;
    if (outcome === 'throw') throw new Error('provider 503');
    if (outcome === 'refuse') {
      const err = new Error('no sender of record') as Error & { notAttempted?: boolean };
      err.notAttempted = true;
      throw err;
    }
    return { sent: true };
  }, {
    // A real agent name: `agent_instances.agent_name` is a closed vocabulary.
    actor: 'atlas',
    surface: 'email_outbound',
    dataClass: 'customer',
    requireDedupKey: false,
    requireCustomerExternalId: true,
  });
});

/** The same week key the gateway computes: Monday, UTC, as YYYY-MM-DD. */
function currentWeekStart(d: Date = new Date()): string {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = copy.getUTCDay();
  copy.setUTCDate(copy.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return copy.toISOString().slice(0, 10);
}

async function send(to: string, key: string) {
  return invoke({
    productId: P, tool: 'send_email', action: `mail to ${to}`,
    params: { to: [to] }, dedupKey: key, customerExternalId: to,
  });
}

describe('mail to a customer', () => {
  it('still stops at three in a week', async () => {
    for (const n of [1, 2, 3]) expect((await send(CUSTOMER_EMAIL, `k${n}`)).ok).toBe(true);
    const fourth = await send(CUSTOMER_EMAIL, 'k4');
    expect(fourth.ok).toBe(false);
    expect(fourth.phase).toBe('budget');
  });
});

describe('mail to the founder of the company', () => {
  it('is not metered against the customer ceiling', async () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const r = await send(OWNER_EMAIL, `f${n}`);
      expect(r.ok, `founder send ${n}`).toBe(true);
    }
  });

  it('is metered on its own row, under its own ceiling', async () => {
    // A fresh dedup key: a repeat of one used above returns the cached result
    // and never reaches the budget at all.
    await send(OWNER_EMAIL, 'own-row');
    const rows = await query(
      'SELECT customer_external_id, cap, sent_count FROM communication_budgets WHERE product_id = ?', [P]);
    const row = rows.rows[0] as unknown as { customer_external_id: string; cap: number; sent_count: number };
    expect(row.customer_external_id).toBe(`operator:${OWNER_EMAIL}`);
    expect(row.cap).toBe(OPERATOR_WEEKLY_CAP);
    expect(row.sent_count).toBe(1);
  });

  it('still has a ceiling', async () => {
    // One real send creates the row for the current week; then fill it.
    await send(OWNER_EMAIL, 'seed-ceiling');
    await query(
      'UPDATE communication_budgets SET sent_count = cap WHERE customer_external_id = ?',
      [`operator:${OWNER_EMAIL}`]);

    const refused = await send(OWNER_EMAIL, 'over-ceiling');
    expect(refused.ok).toBe(false);
    expect(refused.phase).toBe('budget');
  });

  it('a team member counts as an operator too', async () => {
    await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
      ['f_team', 'c_team', 'teammate@example.com']);
    await query(
      "INSERT INTO team_members (id, product_id, founder_id, role) VALUES ('tm_1', ?, 'f_team', 'co_founder')",
      [P]);

    await send('teammate@example.com', 't1');
    const rows = await query(
      "SELECT cap FROM communication_budgets WHERE customer_external_id = 'operator:teammate@example.com'");
    expect((rows.rows[0] as unknown as { cap: number }).cap).toBe(OPERATOR_WEEKLY_CAP);
  });
});

describe('a send that did not happen', () => {
  it('gives the hold back when the provider fails', async () => {
    outcome = 'throw';
    for (const n of [1, 2, 3, 4]) await send(CUSTOMER_EMAIL, `x${n}`);
    expect(calls).toBe(4);

    const rows = await query(
      'SELECT sent_count FROM communication_budgets WHERE customer_external_id = ?', [CUSTOMER_EMAIL]);
    expect((rows.rows[0] as unknown as { sent_count: number }).sent_count).toBe(0);
  });

  it('gives it back for a refusal that never reached the provider', async () => {
    outcome = 'refuse';
    const r = await send(CUSTOMER_EMAIL, 'r1');
    expect(r.phase).toBe('refused');

    const rows = await query(
      'SELECT sent_count FROM communication_budgets WHERE customer_external_id = ?', [CUSTOMER_EMAIL]);
    expect((rows.rows[0] as unknown as { sent_count: number }).sent_count).toBe(0);
  });

  it('leaves the customer contactable after three failures', async () => {
    outcome = 'throw';
    for (const n of [1, 2, 3]) await send(CUSTOMER_EMAIL, `y${n}`);
    outcome = 'ok';

    const fourth = await send(CUSTOMER_EMAIL, 'y4');
    expect(fourth.ok, 'nothing was received, so nothing was spent').toBe(true);
  });

  it('records no send time for an attempt', async () => {
    outcome = 'throw';
    await send(CUSTOMER_EMAIL, 'z1');
    const rows = await query(
      'SELECT last_sent_at FROM communication_budgets WHERE customer_external_id = ?', [CUSTOMER_EMAIL]);
    expect((rows.rows[0] as unknown as { last_sent_at: string | null }).last_sent_at).toBeNull();
  });

  it('records no send time on the second attempt either', async () => {
    // The first message of a week takes the INSERT path and the rest take the
    // UPDATE path, so an assertion that only ever sees the first proves nothing
    // about the second. A row already exists here, with a send time from long
    // ago, and a failed attempt must leave it exactly where it was.
    await query(
      `INSERT INTO communication_budgets
         (id, product_id, customer_external_id, week_starting, sent_count, cap, last_sent_at)
       VALUES ('cb_old', ?, ?, ?, 1, 3, '2000-01-01 00:00:00')`,
      [P, CUSTOMER_EMAIL, currentWeekStart()]);

    outcome = 'throw';
    await send(CUSTOMER_EMAIL, 'second-attempt');

    const rows = await query(
      'SELECT last_sent_at, sent_count FROM communication_budgets WHERE customer_external_id = ?',
      [CUSTOMER_EMAIL]);
    const row = rows.rows[0] as unknown as { last_sent_at: string; sent_count: number };
    expect(row.last_sent_at).toBe('2000-01-01 00:00:00');
    expect(row.sent_count, 'the hold came back').toBe(1);
  });

  it('records one for a send that happened', async () => {
    await send(CUSTOMER_EMAIL, 'z2');
    const rows = await query(
      'SELECT last_sent_at FROM communication_budgets WHERE customer_external_id = ?', [CUSTOMER_EMAIL]);
    expect((rows.rows[0] as unknown as { last_sent_at: string | null }).last_sent_at).not.toBeNull();
  });
});

describe('the department sweeps', () => {
  it('look at the budget without spending it', () => {
    for (const f of ['src/services/departments/success.ts', 'src/services/departments/outreach.ts']) {
      const src = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
      expect(src, `${f} must not take a hold for work it may not send`).not.toContain('checkAndIncrement');
      expect(src).toContain('remainingFor');
    }
  });
});
