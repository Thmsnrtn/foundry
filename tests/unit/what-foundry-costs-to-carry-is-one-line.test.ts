process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { foundryLine, hourValueOf, stateHourValue } from '../../src/services/economy/projection.js';
import { recordRecurringMinutes } from '../../src/services/venture/owner-minutes.js';

// =============================================================================
// WHAT FOUNDRY COSTS TO CARRY IS ONE LINE (Roadmap 2027 R6, 30 September 2026;
// OBJECTIVE §2, hold while v > λ·a; STRATEGY S13; ROADMAP D7).
//
// λ, what an hour of the owner's is worth, had never been stated, and `a`, the
// recurring minutes an asset or Foundry asks, could not be recorded: every
// minute had to belong to a test. Now the owner states λ as a range with its
// source, enters minutes against Foundry itself or an asset of theirs, and
// Money reads one line — what Foundry cost to carry and in time, against what
// came in — beside the simpler way to run the same thing: one listing and a
// spreadsheet, which costs only the venue's own fees.
// =============================================================================

const OWNER = 'f_line';
const today = new Date().toISOString().slice(0, 10);
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clk_line', 'owner@example.com', 'Owner']);
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', ['f_else', 'clk_else', 'else@example.com', 'Else']);
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_line','Line Co',?,'active','active','real')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_else','Else Co','f_else','active','active','real')`);
  const { moneyRoutes } = await import('../../src/routes/dashboard/money-place.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', moneyRoutes);
});

const form = (fields: Record<string, string>): RequestInit => ({
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(),
});

describe('what an hour is worth', () => {
  it('is not known until the owner says, and then it is their range with its source', async () => {
    expect(await hourValueOf(OWNER)).toBeNull();
    expect((await app.request('/foundry/money/hour', form({ low: '40', high: '90', source: 'what my other work pays' }))).status).toBe(302);
    expect(await hourValueOf(OWNER)).toMatchObject({ lowCents: 4000, highCents: 9000, source: 'what my other work pays' });
  });

  it('refuses a range upside down, a blank source, and anything not a number', async () => {
    await expect(stateHourValue(OWNER, 9000, 4000, 'x')).rejects.toThrow(/low end/);
    await expect(stateHourValue(OWNER, 4000, 9000, '  ')).rejects.toThrow(/where the number came from/);
    const r = await app.request('/foundry/money/hour', form({ low: 'lots', high: '90', source: 'x' }));
    expect(decodeURIComponent(r.headers.get('location') ?? '')).toContain('need to be a number');
  });

  it('is said, never edited: a new statement supersedes by being newer', async () => {
    await expect(query(`UPDATE owner_hour_values SET low_cents_per_hour = 1 WHERE founder_id = ?`, [OWNER])).rejects.toThrow(/said_is_said/);
    await stateHourValue(OWNER, 5000, 8000, 'thought again');
    expect(await hourValueOf(OWNER)).toMatchObject({ lowCents: 5000, highCents: 8000 });
  });
});

describe('minutes that are not a test\'s', () => {
  it('can belong to Foundry itself, or to an asset of the owner\'s, never to someone else\'s', async () => {
    await recordRecurringMinutes({ founderId: OWNER, productId: null, onDay: today, minutes: 30, what: 'the weekly read' });
    await recordRecurringMinutes({ founderId: OWNER, productId: 'p_line', onDay: today, minutes: 30, what: null });
    await expect(recordRecurringMinutes({ founderId: OWNER, productId: 'p_else', onDay: today, minutes: 5, what: null }))
      .rejects.toThrow(/only the owner of an asset/);
    // The table refuses it too, whatever a caller does.
    await expect(query(`INSERT INTO owner_minutes (id, founder_id, product_id, on_day, minutes) VALUES ('m_x',?, 'p_else', ?, 5)`, [OWNER, today]))
      .rejects.toThrow(/not_their_asset/);
    await expect(query(`INSERT INTO owner_minutes (id, founder_id, product_id, experiment_id, on_day, minutes) VALUES ('m_y',?, 'p_line', 'x', ?, 5)`, [OWNER, today]))
      .rejects.toThrow();
  });

  it('refuses a day not yet lived', async () => {
    await expect(recordRecurringMinutes({ founderId: OWNER, productId: null, onDay: '2999-01-01', minutes: 5, what: null }))
      .rejects.toThrow(/already lived/);
  });
});

describe('Foundry\'s own line', () => {
  it('prices the owner\'s time at their range, and says what came in', async () => {
    const line = await foundryLine(OWNER);
    expect(line.minutes30d).toBe(60);
    // Sixty minutes at $50 to $80 an hour.
    expect(line.attention).toEqual({ lowCents: 5000, highCents: 8000 });
    expect(line.contribution30d).toMatchObject({ cents: 0, quality: 'measured' });
    expect(line.sentence).toContain('60 minutes of your time, worth $50.00 to $80.00');
    expect(line.baseline).toContain('one listing and a spreadsheet');
  });

  it('never counts another owner\'s minutes', async () => {
    await recordRecurringMinutes({ founderId: 'f_else', productId: 'p_else', onDay: today, minutes: 600, what: null });
    expect((await foundryLine(OWNER)).minutes30d).toBe(60);
  });

  it('is on Money, beside the simpler way', async () => {
    const html = await (await app.request('/foundry/money')).text();
    expect(html).toContain('id="foundry-line"');
    expect(html).toContain('one listing and a spreadsheet');
    expect(html).toContain('You said an hour of yours is worth $50.00 to $80.00');
  });
});
