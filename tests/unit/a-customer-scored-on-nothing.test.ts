process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { computeCustomerHealth, upsertCustomer } from '../../src/services/customers/intelligence.js';
import { addAgentNote } from '../../src/services/customer/intelligence.js';

// =============================================================================
// A CUSTOMER SCORED ON NOTHING, AND AN UPSERT THAT NEVER UPSERTED.
//
// `computeCustomerHealth` weights four components: usage 0.30, support 0.15,
// payment 0.20, engagement 0.35. Three of them read `customer_events`, a table
// with exactly one writer in the whole system, behind a session route. So for a
// company that has not wired it, the SAME NOTHING was read as CATASTROPHIC on
// usage (0) and PERFECT on support and payment (100 each) — opposite directions
// for one absence, inside one function. The composite reduced to
// 35 + 0.35 x engagement: a number about nothing, written back to
// `customers.health_score` and inserted into `customer_health_snapshots` as a
// dated measurement, which `getFallingCustomers` later reads to tell a founder
// a customer is "falling".
//
// ENGAGEMENT WAS WORSE, because the substitution was ORDERED WRONG. A null
// `last_active_at` scored 50 — the 7-to-14-day band — while a customer whose
// inactivity was actually measured at 14 days scored 25 and at 30 days scored
// 10. A customer never once recorded active therefore outranked one last seen a
// month ago, and landed on the safe side of the churn-risk line that decides
// who `runSuccessSweep` drafts a check-in for and, in 'act' mode with consent,
// emails.
//
// The discriminator is whether the product records these events AT ALL. Zero
// support tickets this month is a real finding when the channel is wired, and
// no finding at all when it is not.
//
// A NOTE IS NOT A CONTACT. `addAgentNote` stamped `last_contacted_at` and
// `last_contacted_by` — columns filed under "Communication" — for a function
// whose entire body reads and rewrites `agent_notes`. Nothing is sent. So a
// model forming a private opinion marked the customer as having been written
// to, by a named agent, on a date; and `GET /api/v1/customers/:customerId`
// serves that row to an external integrator likely syncing it into a CRM.
//
// AND `upsertCustomer` WAS AN UNCONDITIONAL INSERT with a fresh id, on a table
// with no uniqueness constraint to catch it. The name and the docstring promise
// idempotence, which is exactly what a caller syncing from a billing system
// relies on. `detectRevenueConcentration` sums over every row and fires "Top
// customer is N% of MRR. Losing them would be devastating." on the inflated
// denominator.
// =============================================================================

const P = 'p_cust';

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_c','c_c','c@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_c','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM customer_events WHERE product_id = ?', [P]);
  await query('DELETE FROM customers WHERE product_id = ?', [P]);
  await query('DELETE FROM customer_health_snapshots WHERE product_id = ?', [P]);
});

async function customer(opts: { lastActive?: string | null } = {}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO customers (id, product_id, owner_id, external_id, name, last_active_at)
     VALUES (?, ?, 'f_c', ?, 'Acme Co', ?)`,
    [id, P, `cus_${id}`, opts.lastActive ?? null]);
  return id;
}

async function event(customerId: string, type: string, daysAgo = 1): Promise<void> {
  await query(
    `INSERT INTO customer_events (id, customer_id, product_id, event_type, created_at)
     VALUES (?, ?, ?, ?, datetime('now', ?))`,
    [nanoid(), customerId, P, type, `-${daysAgo} days`]);
}

describe('a company that has not wired customer events', () => {
  it('scores nothing rather than scoring the absence twice, in two directions', async () => {
    const id = await customer({ lastActive: null });

    const health = await computeCustomerHealth(id);

    expect(health.components.usage).toBeNull();
    expect(health.components.support).toBeNull();
    expect(health.components.payment).toBeNull();
    expect(health.components.engagement).toBeNull();
    // 35 + 0.35 x 50 = 52.5 was the old answer, stored as a measurement.
    expect(health.health_score).toBeNull();
    expect(health.churn_risk).toBeNull();
    expect(health.expansion_potential).toBeNull();
  });

  it('still scores engagement when the company reports activity another way', async () => {
    const id = await customer({ lastActive: new Date().toISOString() });

    const health = await computeCustomerHealth(id);

    // The one thing measured, renormalised to stand alone.
    expect(health.components.engagement).toBe(100);
    expect(health.components.usage).toBeNull();
    expect(health.health_score).toBe(100);
    expect(health.churn_risk).toBe(0);
  });

  it('writes null to the customer row and the snapshot, not a number', async () => {
    const id = await customer({ lastActive: null });

    await computeCustomerHealth(id);

    const row = (await query('SELECT health_score, churn_risk FROM customers WHERE id = ?', [id]))
      .rows[0] as unknown as { health_score: number | null; churn_risk: number | null };
    expect(row.health_score).toBeNull();
    expect(row.churn_risk).toBeNull();

    const snap = (await query('SELECT health_score FROM customer_health_snapshots WHERE customer_id = ?', [id]))
      .rows[0] as unknown as { health_score: number | null };
    expect(snap.health_score).toBeNull();
  });

  it('leaves an unscored customer out of the at-risk line rather than under it', async () => {
    const unknown = await customer({ lastActive: null });
    await computeCustomerHealth(unknown);

    // `churn_risk > 0.6` is the line that selects who gets written to. NULL is
    // not greater than 0.6, so an unmeasured customer is simply not selected —
    // where the old 0.47 put them confidently on the safe side of it.
    const selected = await query(
      'SELECT id FROM customers WHERE product_id = ? AND churn_risk > 0.6', [P]);
    expect(selected.rows.length).toBe(0);
  });
});

describe('a company that has wired customer events', () => {
  it('reads a quiet month as the finding it is', async () => {
    const id = await customer({ lastActive: new Date().toISOString() });
    // The channel is live for this product; this customer simply did nothing.
    const other = await customer();
    await event(other, 'login');

    const health = await computeCustomerHealth(id);

    expect(health.components.usage).toBe(0);      // measured, and it was zero
    expect(health.components.support).toBe(100);  // no tickets is genuinely good
    expect(health.components.payment).toBe(100);
    expect(health.health_score).not.toBeNull();
  });

  it('ranks a never-active customer below one last seen a month ago', async () => {
    const seenAMonthAgo = await customer({
      lastActive: new Date(Date.now() - 31 * 86400000).toISOString(),
    });
    const neverSeen = await customer({ lastActive: null });
    await event(seenAMonthAgo, 'login');

    const stale = await computeCustomerHealth(seenAMonthAgo);
    const unknown = await computeCustomerHealth(neverSeen);

    // The old arithmetic gave the never-seen customer 50 and the month-stale one
    // 10, so the one Foundry knew nothing about looked healthier.
    expect(stale.components.engagement).toBe(10);
    expect(unknown.components.engagement).toBeNull();
  });
});

describe('an internal note', () => {
  it('does not record that the customer was contacted', async () => {
    const id = nanoid();
    await query(
      `INSERT INTO customer_intelligence (id, product_id, external_customer_id, account_name)
       VALUES (?, ?, 'cus_note', 'Acme Co')`, [id, P]);

    await addAgentNote(id, 'harbor', 'Looks shaky on usage.');

    const row = (await query(
      'SELECT agent_notes, last_contacted_at, last_contacted_by FROM customer_intelligence WHERE id = ?',
      [id])).rows[0] as unknown as {
        agent_notes: string; last_contacted_at: string | null; last_contacted_by: string | null };

    expect(JSON.parse(row.agent_notes)[0].note).toBe('Looks shaky on usage.');
    expect(row.last_contacted_at).toBeNull();
    expect(row.last_contacted_by).toBeNull();
  });
});

describe('upserting a customer', () => {
  it('updates the existing row instead of creating a second one', async () => {
    const first = await upsertCustomer(P, 'f_c', { external_id: 'cus_1', name: 'Acme', mrr_cents: 10_000 });
    const second = await upsertCustomer(P, 'f_c', { external_id: 'cus_1', name: 'Acme Inc', mrr_cents: 20_000 });

    expect(second).toBe(first);
    const rows = await query('SELECT name, mrr_cents FROM customers WHERE product_id = ?', [P]);
    expect(rows.rows.length).toBe(1);
    expect((rows.rows[0] as unknown as { name: string }).name).toBe('Acme Inc');
    expect((rows.rows[0] as unknown as { mrr_cents: number }).mrr_cents).toBe(20_000);
  });

  it('leaves fields a partial report did not mention alone', async () => {
    await upsertCustomer(P, 'f_c', { external_id: 'cus_2', name: 'Beta', email: 'b@example.com' });
    await upsertCustomer(P, 'f_c', { external_id: 'cus_2', mrr_cents: 5_000 });

    const row = (await query(
      'SELECT name, email, mrr_cents FROM customers WHERE product_id = ? AND external_id = ?',
      [P, 'cus_2'])).rows[0] as unknown as { name: string; email: string; mrr_cents: number };
    expect(row.name).toBe('Beta');
    expect(row.email).toBe('b@example.com');
    expect(row.mrr_cents).toBe(5_000);
  });

  it('still creates separate rows for customers with no external id', async () => {
    // Nothing identifies them, so nothing says they are the same customer.
    const a = await upsertCustomer(P, 'f_c', { name: 'Walk-in' });
    const b = await upsertCustomer(P, 'f_c', { name: 'Walk-in' });

    expect(b).not.toBe(a);
    const rows = await query('SELECT id FROM customers WHERE product_id = ?', [P]);
    expect(rows.rows.length).toBe(2);
  });
});
