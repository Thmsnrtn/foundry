// =============================================================================
// A FAILED CHANGE KEEPS THE OLD RULE.
//
// Integrated plan §8, Controls: "Preview a changed rule and confirm the
// durable effective value. An insert failure must retain the prior
// enforceable rule."
//
// Every standing rule the owner can change is replaced the same way: the live
// one is retired, then the new one is written. Those were two statements. When
// the second was refused — a boundary with no words, a budget of nothing, a
// direction with nothing in it — the first had already happened, and the owner
// was left with NO rule: "ask me before contacting anyone" gone, and nothing
// in its place, because he tried to change it and the change did not take.
// A stricter rule failing to save must never leave a looser one than before.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '5'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  boundariesFor, objectiveFor, setAllowance, setBoundary, setObjective,
} from '../../src/services/institution/standing-intent.js';

const OWNER = 'fc_owner';
const P = 'fc_co';

const liveAllowance = async () => (await query(
  'SELECT amount_cents FROM owner_allowances WHERE product_id = ? AND withdrawn_at IS NULL', [P]))
  .rows as unknown as Array<Record<string, unknown>>;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_fc', 'fc@example.com', 'Owner']);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Apex Micro',?,'active')", [P, OWNER]);
});

describe('a boundary', () => {
  it('stays in force when the change that would replace it is refused', async () => {
    await setBoundary({ productId: P, subject: 'contact_people', statement: 'ask me before contacting anyone', mode: 'ask_first' });
    await expect(setBoundary({ productId: P, subject: 'contact_people', statement: '   ', mode: 'never' }))
      .rejects.toThrow(/statement_required/);
    const live = (await boundariesFor(P)).filter((b) => b.subject === 'contact_people');
    expect(live).toHaveLength(1);
    expect(live[0].mode).toBe('ask_first');
    expect(live[0].statement).toBe('ask me before contacting anyone');
  });

  it('is replaced, once, when the change is good — the old one kept as history', async () => {
    await setBoundary({ productId: P, subject: 'contact_people', statement: 'never contact anyone', mode: 'never' });
    const live = (await boundariesFor(P)).filter((b) => b.subject === 'contact_people');
    expect(live.map((b) => b.mode)).toEqual(['never']);
    const lifted = (await query(
      `SELECT COUNT(*) AS n FROM owner_boundaries WHERE product_id = ? AND subject = 'contact_people' AND lifted_at IS NOT NULL`, [P]))
      .rows[0] as Record<string, unknown>;
    expect(Number(lifted.n)).toBe(1);
  });
});

describe('an allowance', () => {
  it('stays in force when the change that would replace it is refused', async () => {
    await setAllowance({ productId: P, statement: 'up to $40 on this', amountCents: 4000, purpose: 'the test' });
    await expect(setAllowance({ productId: P, statement: 'nothing', amountCents: 0, purpose: 'the test' })).rejects.toThrow();
    expect((await liveAllowance()).map((r) => Number(r.amount_cents))).toEqual([4000]);
  });

  it('is replaced when the change is good', async () => {
    await setAllowance({ productId: P, statement: 'up to $25 on this', amountCents: 2500, purpose: 'the test' });
    expect((await liveAllowance()).map((r) => Number(r.amount_cents))).toEqual([2500]);
  });
});

describe('a direction', () => {
  it('stays in force when the change that would replace it is refused', async () => {
    await setObjective({ productId: P, statement: 'find buyers who track bids by hand', channels: ['etsy'] });
    await expect(query('SELECT 1')).resolves.toBeDefined();
    // A direction with nothing in it is refused by the table; the one before stands.
    await setObjective({ productId: P, statement: '   ', channels: [] }).catch(() => undefined);
    const live = await objectiveFor(P);
    expect(live?.statement.trim().length).toBeGreaterThan(0);
  });
});

describe('the charter', () => {
  it('stays signed when a new signature the row refuses would replace it', async () => {
    const { liveCharter, signCharter } = await import('../../src/services/institution/charter.js');
    const first = await signCharter({ founderId: OWNER, testsTotalCents: 10_000, probesInFlight: 2,
      cognitionCentsPerDay: 200, days: 30, publicVoice: 'Apex Micro', statement: 'A river of nickels.' });
    await expect(signCharter({ founderId: OWNER, testsTotalCents: 90_000, probesInFlight: 9,
      cognitionCentsPerDay: 900, days: 30, publicVoice: 'Apex Micro', statement: '   ' })).rejects.toThrow(/incomplete/);
    const live = await liveCharter(OWNER);
    expect(live?.id).toBe(first);
    // And a good signature still replaces it, once.
    const second = await signCharter({ founderId: OWNER, testsTotalCents: 5_000, probesInFlight: 1,
      cognitionCentsPerDay: 100, days: 30, publicVoice: 'Apex Micro', statement: 'Smaller, for a month.' });
    expect((await liveCharter(OWNER))?.id).toBe(second);
  });
});
