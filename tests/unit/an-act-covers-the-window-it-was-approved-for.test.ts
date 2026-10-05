// =============================================================================
// LAW (Roadmap 2027 R24): AN ACT COVERS THE WINDOW IT WAS APPROVED FOR, AND NO
// ACT OUTLIVES THE CHARTER THAT DECIDED IT.
//
// A Workshop test is read over thirty days, and every act that lets Foundry
// place it, deliver it and refund it lasted twenty-one. A buyer on day 25 paid
// into a window no act covered: the money moved, the brief could not go out,
// and the link could not be taken down at the end. Under a charter it was
// worse the other way: acts could outlive the term the owner signed, so a
// charter's yes reached past the charter.
//
// Now one pure function sizes both from the sealed rule and the charter row,
// never from a caller: the window is thirty days, or what the charter leaves
// less a margin (and less the stop's lead for a subscription); acts last the
// window plus that margin and never past the charter's end; a test that would
// get under fourteen days is not let in. The database refuses a charter-decided
// act that would outlive its charter. Placement refuses an act shorter than the
// window it would open.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'w'.repeat(64);

import { readFileSync } from 'fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { windowAndValidity, STOP_AHEAD_DAYS, placementActCoversTheWindow } from '../../src/services/venture/hand.js';

const DAY = 86_400_000;
const NOW = new Date('2026-10-05T12:00:00Z');
const days = (a: Date, b: Date): number => Math.round((b.getTime() - a.getTime()) / DAY);
const OWNER = 'win_owner';
const ASSET = 'win_asset';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'win_clk', 'win@example.com', 'Owner']);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES (?,'Apex Micro',?,'active','real')", [ASSET, OWNER]);
  const { setBoundary } = await import('../../src/services/institution/standing-intent.js');
  await setBoundary({ productId: ASSET, subject: 'publish', mode: 'ask_first', statement: 'Ask me before placing an offer anywhere' });
});

describe('one reading of how long a test runs and how long its acts last', () => {
  it('with no charter, a one-time test runs thirty days and its acts two more', () => {
    const w = windowAndValidity({ now: NOW, recurring: false, charterExpiresAt: null });
    if ('refused' in w) throw new Error(w.refused);
    expect(w.withinDays).toBe(30);
    expect(days(NOW, w.actsExpireAt)).toBe(32);
  });

  it('a weekly test keeps its acts until the stop can still be made after the window closes', () => {
    const w = windowAndValidity({ now: NOW, recurring: true, charterExpiresAt: null });
    if ('refused' in w) throw new Error(w.refused);
    expect(w.withinDays).toBe(30);
    // The stop is made STOP_AHEAD_DAYS before the act ends; it must not come before the window does.
    expect(days(NOW, w.actsExpireAt) - STOP_AHEAD_DAYS).toBeGreaterThanOrEqual(w.withinDays);
  });

  it('under a charter with thirty days left, the window shrinks so the acts end with the charter, never after', () => {
    const end = new Date(NOW.getTime() + 30 * DAY);
    const once = windowAndValidity({ now: NOW, recurring: false, charterExpiresAt: end.toISOString() });
    if ('refused' in once) throw new Error(once.refused);
    expect(once.withinDays).toBe(28);
    expect(once.actsExpireAt.getTime()).toBeLessThanOrEqual(end.getTime());
    const weekly = windowAndValidity({ now: NOW, recurring: true, charterExpiresAt: end.toISOString() });
    if ('refused' in weekly) throw new Error(weekly.refused);
    expect(weekly.withinDays).toBe(30 - 2 - STOP_AHEAD_DAYS);
    expect(weekly.actsExpireAt.getTime()).toBeLessThanOrEqual(end.getTime());
    expect(days(NOW, weekly.actsExpireAt) - STOP_AHEAD_DAYS).toBeGreaterThanOrEqual(weekly.withinDays);
  });

  it('a ninety-day charter signed today gives the full thirty days', () => {
    const w = windowAndValidity({ now: NOW, recurring: false, charterExpiresAt: new Date(NOW.getTime() + 90 * DAY).toISOString() });
    if ('refused' in w) throw new Error(w.refused);
    expect(w).toMatchObject({ withinDays: 30 });
    expect(days(NOW, w.actsExpireAt)).toBe(32);
  });

  it('a charter with too little left lets nothing in, and says why and what to do', () => {
    const w = windowAndValidity({ now: NOW, recurring: false, charterExpiresAt: new Date(NOW.getTime() + 10 * DAY).toISOString() });
    expect('refused' in w ? w.refused : '').toBe('only 10 days are left in the charter; a test needs at least 14 to be read, so renew the charter or allow it yourself');
    expect('refused' in windowAndValidity({ now: NOW, recurring: false, charterExpiresAt: new Date(NOW.getTime() + 16 * DAY).toISOString() })).toBe(false);
    expect('refused' in windowAndValidity({ now: NOW, recurring: false, charterExpiresAt: new Date(NOW.getTime() + 15 * DAY).toISOString() })).toBe(true);
  });

  it('a caller may shorten the acts, never lengthen them', () => {
    const longer = windowAndValidity({ now: NOW, recurring: false, charterExpiresAt: null, within: new Date(NOW.getTime() + 300 * DAY) });
    const shorter = windowAndValidity({ now: NOW, recurring: false, charterExpiresAt: null, within: new Date(NOW.getTime() + 5 * DAY) });
    if ('refused' in longer || 'refused' in shorter) throw new Error('refused');
    expect(days(NOW, longer.actsExpireAt)).toBe(32);
    expect(days(NOW, shorter.actsExpireAt)).toBe(5);
  });

  it('a placement act that ends before the window would close cannot open it', () => {
    expect(placementActCoversTheWindow({ now: NOW, actExpiresAt: new Date(NOW.getTime() + 21 * DAY).toISOString(), withinDays: 30 })).toMatch(/ends before the 30-day window/);
    expect(placementActCoversTheWindow({ now: NOW, actExpiresAt: new Date(NOW.getTime() + 32 * DAY).toISOString(), withinDays: 30 })).toBeNull();
  });
});

describe('an act clamped to its charter never ends after it', () => {
  it('the hours an act is proposed for are rounded down, so now + hours never passes the charter\'s end', async () => {
    const { actHoursUntil } = await import('../../src/services/venture/act-window.js');
    for (const ms of [1, 999, 59_999, 3_599_999, 7 * DAY - 1]) {
      const end = new Date(NOW.getTime() + 30 * DAY - ms);
      const w = windowAndValidity({ now: NOW, recurring: false, charterExpiresAt: end.toISOString() });
      if ('refused' in w) throw new Error(w.refused);
      expect(NOW.getTime() + actHoursUntil(w.actsExpireAt, NOW) * 3_600_000).toBeLessThanOrEqual(end.getTime());
    }
  });
});

describe('the charter reads the same window', () => {
  it('a charter with ten days left is not inside, with the reason, and nothing is carved', async () => {
    const { signCharter, chartered } = await import('../../src/services/institution/charter.js');
    await signCharter({ founderId: OWNER, testsTotalCents: 10_000, probesInFlight: 3, cognitionCentsPerDay: 300, days: 10, publicVoice: 'Apex Micro', statement: 'A short term.' });
    const c = await chartered({ founderId: OWNER, experimentId: 'win_x', costCents: 100, rungs: ['public', 'financial'] });
    expect(c.inside).toBe(false);
    expect(c.because.join(' ')).toMatch(/a test needs at least 14 to be read/);
    expect((await query('SELECT COUNT(*) AS n FROM portfolio_envelope_carves', [])).rows[0]!.n).toBe(0);
  });
});

describe('the database refuses an act that outlives the charter that decided it', () => {
  const propose = async (id: string, hours: number) => query(
    `INSERT INTO proposed_acts (id, product_id, subject, action_type, params_fingerprint, summary, why, expected_effect, risk, consequence, rung, cost_cents, proposed_by, expires_at)
     VALUES (?,?,'publish','stripe_create_payment_link','fp','s','w','e','r','low','public',0,'institution:hand', datetime('now', ?))`, [id, ASSET, `+${String(hours)} hours`]);

  it('a charter may decide an act that ends inside its term, and may not decide one that ends after it', async () => {
    const { liveCharter, charterPrincipal } = await import('../../src/services/institution/charter.js');
    const charter = (await liveCharter(OWNER))!;
    await propose('win_inside', 24 * 5);
    await query(`UPDATE proposed_acts SET decision = 'approved', decided_by = ?, decided_at = datetime('now') WHERE id = 'win_inside'`, [charterPrincipal(charter.id)]);
    await propose('win_outside', 24 * 40);
    await expect(query(`UPDATE proposed_acts SET decision = 'approved', decided_by = ?, decided_at = datetime('now') WHERE id = 'win_outside'`, [charterPrincipal(charter.id)]))
      .rejects.toThrow(/proposed_act:outlives_its_charter/);
  });

  it('the owner may decide that same act; their yes is not bounded by a charter', async () => {
    await query(`UPDATE proposed_acts SET decision = 'approved', decided_by = ?, decided_at = datetime('now') WHERE id = 'win_outside'`, [`founder:${OWNER}`]);
    expect((await query(`SELECT decision FROM proposed_acts WHERE id = 'win_outside'`, [])).rows[0]!.decision).toBe('approved');
  });
});

describe('the window is read the way it is written', () => {
  it('the overdue reading reads within_days, the key the rule is sealed with', async () => {
    const { settlementRuleJson } = await import('../../src/services/venture/outcome.js');
    const rule = settlementRuleJson({ event: 'payment', atLeast: 1, withinDays: 7 });
    expect((await query(`SELECT json_extract(?, '$.within_days') AS d`, [rule])).rows[0]!.d).toBe(7);
    expect(readFileSync('src/services/founder/health.ts', 'utf8')).toContain("json_extract(e.settles_when, '$.within_days')");
  });

  it('no twenty-one-day default is left for an act', () => {
    expect(readFileSync('src/services/venture/hand.ts', 'utf8')).not.toMatch(/21 \* 86_400_000/);
  });
});
