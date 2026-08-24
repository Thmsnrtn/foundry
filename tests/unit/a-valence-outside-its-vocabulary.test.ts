process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordOutcome } from '../../src/services/decisions/queue.js';
import { getTrustLedger } from '../../src/services/trust/ledger.js';

// =============================================================================
// A VALENCE OUTSIDE ITS VOCABULARY.
//
// `decisions.outcome_valence` is three values to every reader: 1 positive, -1
// negative, anything else neutral. The trust ledger counts `= 1` as positive
// and everything else as decided — which is how a category earns a gate. The
// board packet averages it and maps the mean through `((avg + 1) / 2) * 100`,
// so one valence of 5 would print a decision score of 300%.
//
// The founder's form offers exactly three radio buttons. The route took
// `Number(body.valence)` with no check and the column had no constraint, so a
// second door — or a typo — could store anything.
// =============================================================================

const P = 'p_val';
const OWNER = 'f_val';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_val','c_val','v@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_val','active')", [P]);

  const { decisionRoutes } = await import('../../src/routes/dashboard/decisions.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: OWNER } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', decisionRoutes);
});

beforeEach(async () => { await query('DELETE FROM decisions'); });

async function decision(id: string) {
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status)
     VALUES (?, ?, 'strategic', 2, 'a thing', 'now', 'approved')`, [id, P]);
}

describe('the database', () => {
  it('accepts the three values the readers understand', async () => {
    for (const [i, v] of [-1, 0, 1].entries()) {
      await decision(`d_${i}`);
      await recordOutcome(`d_${i}`, P, 'it happened', v);
    }
    const rows = (await query('SELECT outcome_valence FROM decisions ORDER BY id'))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(rows.map((r) => Number(r.outcome_valence))).toEqual([-1, 0, 1]);
  });

  it('refuses one outside them, whichever door it comes through', async () => {
    await decision('d_bad');
    await expect(recordOutcome('d_bad', P, 'it happened', 5))
      .rejects.toThrow(/outcome_valence:not_in_vocabulary/);
  });

  it('refuses it on an insert too', async () => {
    await expect(query(
      `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, outcome_valence)
       VALUES ('d_ins', ?, 'strategic', 2, 'a thing', 'now', 'approved', 2)`, [P],
    )).rejects.toThrow(/outcome_valence:not_in_vocabulary/);
  });

  it('still allows an unmeasured outcome', async () => {
    await decision('d_null');
    await recordOutcome('d_null', P, 'we do not know yet', null);
    const row = (await query("SELECT outcome_valence FROM decisions WHERE id='d_null'"))
      .rows[0] as unknown as Record<string, unknown>;
    expect(row.outcome_valence).toBeNull();
  });
});

describe('the trust ledger', () => {
  it('counts a positive outcome as positive', async () => {
    // The ledger only counts decisions that tested FOUNDRY's judgement: it
    // recommended an option and the founder took that one.
    for (let i = 0; i < 8; i++) {
      await query(
        `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status,
           decided_by, recommendation, chosen_option, outcome, outcome_valence)
         VALUES (?, ?, 'product', 2, 'a thing', 'now', 'approved',
           'founder', 'Ship it', 'Ship it', 'worked', 1)`,
        [`t_${i}`, P]);
    }
    const ledger = await getTrustLedger(P);
    const product = ledger.categories.find((c) => c.category === 'product');
    expect(product?.decided).toBe(8);
    expect(product?.positive).toBe(8);
  });
});

describe('the door', () => {
  const post = (id: string, body: unknown) =>
    app.request(`/decisions/${id}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('answers 400 rather than letting the database raise', async () => {
    await decision('d_door');
    const res = await post('d_door', { outcome: 'it happened', valence: 5 });
    expect(res.status, 'a caller deserves to be told what is wrong').toBe(400);
    expect((await res.json() as { error: string }).error).toContain('-1, 0 or 1');
  });

  it('records one inside the vocabulary', async () => {
    await decision('d_ok');
    const res = await post('d_ok', { outcome: 'it worked', valence: 1 });
    expect(res.status).toBe(200);
    const row = (await query("SELECT outcome_valence FROM decisions WHERE id='d_ok'"))
      .rows[0] as unknown as Record<string, unknown>;
    expect(Number(row.outcome_valence)).toBe(1);
  });
});
