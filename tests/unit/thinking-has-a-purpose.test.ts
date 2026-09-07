// =============================================================================
// THINKING HAS A PURPOSE
//
// Every model call was priced to the cent and attributed to a company, a
// founder, a model and a day — and to nothing it was FOR. Now a call may name
// its purpose in the same (kind, id) shape prediction_resolutions uses, so
// what a question cost to reason about can be read beside what it cost to
// test. This proves the purpose lands on the reservation, that half a purpose
// is refused by the schema, and that a call without one is unchanged.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const caps = { global: 100_000, product: 10_000, founder: 50_000 };

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    ['purpose_owner', 'clerk_purpose', 'purpose@example.com', 'Owner']);
  await query(`INSERT INTO products (id, name, owner_id) VALUES ('p_purpose', 'Purpose Co', 'purpose_owner')`);
});

describe('a reservation names what the thinking was for', () => {
  it('carries the purpose, and a call without one is unchanged', async () => {
    const { reserveSpend } = await import('../../src/services/ai/spend-ledger.js');
    const named = await reserveSpend({ productId: 'p_purpose', founderId: 'purpose_owner', model: 'sonnet',
      amountCents: 3, caps, purpose: { kind: 'experiment', id: 'exp_1' } });
    const plain = await reserveSpend({ productId: 'p_purpose', founderId: 'purpose_owner', model: 'sonnet',
      amountCents: 3, caps });
    const rows = (await query(`SELECT id, purpose_kind, purpose_id FROM ai_spend_reservations WHERE id IN (?, ?) ORDER BY purpose_kind`,
      [named.id, plain.id])).rows as unknown as Array<Record<string, unknown>>;
    expect(rows.find((r) => r.id === named.id)).toMatchObject({ purpose_kind: 'experiment', purpose_id: 'exp_1' });
    expect(rows.find((r) => r.id === plain.id)).toMatchObject({ purpose_kind: null, purpose_id: null });
  });

  it('half a purpose is refused by the schema, and so is a kind nobody named', async () => {
    await expect(query(
      `INSERT INTO ai_spend_reservations (id, model, reserved_cents, global_cap_cents, status, created_at, updated_at, expires_at, purpose_kind)
       VALUES ('r_half', 'sonnet', 1, 100, 'reserved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'experiment')`))
      .rejects.toThrow(/purpose_needs_kind_and_id/);
    await expect(query(
      `INSERT INTO ai_spend_reservations (id, model, reserved_cents, global_cap_cents, status, created_at, updated_at, expires_at, purpose_kind, purpose_id)
       VALUES ('r_kind', 'sonnet', 1, 100, 'reserved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'vibes', 'x')`))
      .rejects.toThrow(/CHECK|constraint/i);
  });

  it('the subject helpers name a purpose for a company or the institution, and read it back', async () => {
    const { companySpend, institutionSpend, subjectPurpose } = await import('../../src/services/ai/client.js');
    expect(subjectPurpose('p_purpose')).toBeNull();
    expect(subjectPurpose(institutionSpend('reading the market'))).toBeNull();
    expect(subjectPurpose(institutionSpend('reading one signal', { kind: 'observation', id: 'obs_1' })))
      .toEqual({ kind: 'observation', id: 'obs_1' });
    expect(subjectPurpose(companySpend('p_purpose', { kind: 'undertaking', id: 'u_1' })))
      .toEqual({ kind: 'undertaking', id: 'u_1' });
  });

  it('cost by purpose is one query over rows that already exist', async () => {
    const { reserveSpend, finishReservation } = await import('../../src/services/ai/spend-ledger.js');
    const r = await reserveSpend({ productId: 'p_purpose', founderId: 'purpose_owner', model: 'sonnet',
      amountCents: 9, caps, purpose: { kind: 'unknown', id: 'u_q1' } });
    await finishReservation(r, { kind: 'settled', actualCents: 7 });
    const spent = (await query(
      `SELECT purpose_kind, purpose_id, SUM(actual_cents) AS cents FROM ai_spend_reservations
        WHERE purpose_kind = 'unknown' AND purpose_id = 'u_q1' AND status = 'settled' GROUP BY purpose_kind, purpose_id`))
      .rows[0] as Record<string, unknown>;
    expect(Number(spent.cents)).toBe(7);
  });
});
