// =============================================================================
// HIS MINUTES ARE HIS TO ENTER, AND AN UNENTERED DAY IS NOT A FREE ONE.
//
// Roadmap D6. Proof 3 asks what a findable listing cost the owner in his own
// time, and nothing recorded it: every figure Foundry gives about a test is
// money, and the one cost it cannot see is the one he pays himself. So he can
// enter the minutes he spent on a test, on the day he spent them. It is
// optional, and what has not been entered is said as not entered — never as
// zero, because a month with nothing typed in is not a month that cost nothing.
//
//   · only the person whose test it is can enter time on it, as himself;
//   · a day in the future, a minute count that is not a whole number from 1 to
//     a day's worth, or a day that is not a date, is refused;
//   · an entry is kept as entered; a mistaken one is withdrawn, once, and a
//     withdrawn entry stops counting without disappearing;
//   · the test's page says the total, over how many days, and that days
//     without an entry are unknown.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '5'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'mm@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { approveListing, seedProof2 } from '../../src/services/venture/proof-2.js';

const OWNER = 'mm_owner';
const OTHER = 'mm_other';
let X = '';
let app: Hono;
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const post = (path: string, fields: Record<string, string>) => app.request(`https://f.test${path}`,
  { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
const page = async () => (await (await app.request(`https://f.test/foundry/experiments/${X}`)).text())
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

beforeAll(async () => {
  await runMigrations();
  for (const [id, email] of [[OWNER, 'mm@example.com'], [OTHER, 'other@example.com']]) {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [id, `clerk_${id}`, email, id]);
  }
  X = (await seedProof2(OWNER)).experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  const { experimentRoutes } = await import('../../src/routes/dashboard/experiments-place.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'mm@example.com' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', experimentRoutes);
});

describe('before anything is entered', () => {
  it('is not entered, never zero', async () => {
    const { minutesOn } = await import('../../src/services/venture/owner-minutes.js');
    expect(await minutesOn(X)).toBeNull();
    const text = await page();
    expect(text).toMatch(/Your time on this/);
    expect(text).toMatch(/You have not entered any time on this test/);
    expect(text).not.toMatch(/0 minutes/);
  });
});

describe('he enters his time', () => {
  it('records it, and the page sums it and says what is unknown', async () => {
    const r = await post(`/foundry/experiments/${X}/minutes`, { on_day: yesterday, minutes: '25', what: 'uploaded the file and set the price' });
    expect(r.headers.get('location')).toContain('done=minutes');
    const { recordOwnerMinutes, minutesOn } = await import('../../src/services/venture/owner-minutes.js');
    await recordOwnerMinutes({ founderId: OWNER, experimentId: X, onDay: today, minutes: 10, what: null });
    const m = (await minutesOn(X))!;
    expect(m.total).toBe(35);
    expect(m.days).toBe(2);
    expect(m.firstDay).toBe(yesterday);
    expect(m.lastDay).toBe(today);
    const text = await page();
    expect(text).toMatch(/35 minutes over 2 days/);
    expect(text).toMatch(/A day without an entry is unknown, not zero/);
    expect(text).toMatch(/uploaded the file and set the price/);
  });
});

describe('what is refused', () => {
  it('somebody else\'s test', async () => {
    const { recordOwnerMinutes } = await import('../../src/services/venture/owner-minutes.js');
    await expect(recordOwnerMinutes({ founderId: OTHER, experimentId: X, onDay: today, minutes: 5, what: null }))
      .rejects.toThrow(/not_yours/);
  });

  it('a day not yet lived, a day that is not a date, and a count that is not a day\'s minutes', async () => {
    const { recordOwnerMinutes } = await import('../../src/services/venture/owner-minutes.js');
    for (const [onDay, minutes, why] of [
      [tomorrow, 5, /future/], ['last tuesday', 5, /date/], [today, 0, /minutes/],
      [today, 1441, /minutes/], [today, 2.5, /minutes/], [today, -3, /minutes/],
    ] as Array<[string, number, RegExp]>) {
      await expect(recordOwnerMinutes({ founderId: OWNER, experimentId: X, onDay, minutes, what: null })).rejects.toThrow(why);
    }
    const r = await post(`/foundry/experiments/${X}/minutes`, { on_day: tomorrow, minutes: '5' });
    expect(r.headers.get('location')).toContain('error=');
  });

  it('an entry for somebody else\'s test, at the table itself', async () => {
    await expect(query(`INSERT INTO owner_minutes (id, founder_id, experiment_id, on_day, minutes)
      VALUES ('forged', ?, ?, ?, 5)`, [OTHER, X, today])).rejects.toThrow(/not_his_test/);
  });
});

describe('what is kept', () => {
  it('nothing rewrites an entry', async () => {
    await expect(query(`UPDATE owner_minutes SET minutes = 500 WHERE experiment_id = ?`, [X])).rejects.toThrow(/entered_is_entered/);
  });

  it('a mistaken entry is withdrawn once, stops counting, and stays on record', async () => {
    const { minutesOn, withdrawOwnerMinutes } = await import('../../src/services/venture/owner-minutes.js');
    const ten = (await minutesOn(X))!.entries.find((e) => e.minutes === 10)!;
    await withdrawOwnerMinutes({ founderId: OWNER, entryId: ten.id });
    expect((await minutesOn(X))!.total).toBe(25);
    await expect(withdrawOwnerMinutes({ founderId: OWNER, entryId: ten.id })).rejects.toThrow(/already/);
    await expect(withdrawOwnerMinutes({ founderId: OTHER, entryId: ten.id })).rejects.toThrow(/not_yours/);
    const kept = Number(((await query(`SELECT COUNT(*) AS n FROM owner_minutes WHERE experiment_id = ?`, [X])).rows[0] as Record<string, unknown>).n);
    expect(kept).toBe(2);
  });
});
