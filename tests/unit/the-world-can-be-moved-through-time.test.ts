// =============================================================================
// THE WORLD CAN BE MOVED THROUGH TIME.
//
// Ownership happens over weeks. A proof that runs in one second sees the day
// the owner gave a direction and never the day he came back, so the
// laboratory needs a way to be N days later — and the SQL is the clock, so
// the way is to move every timestamp N days into the past in the format its
// writer used, and read again. This proves the move: the columns come from
// the live schema, the formats survive, the readers agree it is later, and
// two moves compose.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, advanceDays, asText, owner, ownerApp, seedProductionShape, timeColumns } from '../helpers/world.js';

let app: Awaited<ReturnType<typeof ownerApp>>;
const one = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows[0] as Record<string, unknown>;

beforeAll(async () => {
  await seedProductionShape({ charter: true, searching: true, eyes: true });
  app = await ownerApp();
});

describe('the columns', () => {
  it('are read from the live schema, and cover the tables the loop and the money readers join', async () => {
    const cols = await timeColumns();
    const has = (t: string, c: string) => cols.some((x) => x.table === t && x.column === c);
    for (const [t, c] of [
      ['owner_allowances', 'set_at'], ['owner_allowances', 'until'], ['ai_daily_spend', 'date'],
      ['portfolio_envelopes', 'signed_at'], ['portfolio_envelopes', 'expires_at'], ['portfolio_envelope_carves', 'carved_at'],
      ['venture_mandates', 'opened_at'], ['venture_mandates', 'closed_at'], ['venture_guidance', 'given_at'],
      ['venture_experiments', 'proposed_at'], ['venture_experiments', 'ran_at'], ['job_health', 'last_success_at'],
      ['research_sources', 'connected_at'], ['outbound_actions', 'executed_at'], ['experiment_exposures', 'placed_at'],
    ] as const) {
      expect(has(t, c), `${t}.${c}`).toBe(true);
    }
    // And never a number that happens to end in _at.
    expect(cols.some((x) => x.column === 'amount_cents')).toBe(false);
  });
});

describe('a week passes', () => {
  let signedBefore = '';
  let untilBefore = '';
  let lastPassBefore = '';

  it('every reader agrees it is seven days later, in the format each column was written in', async () => {
    signedBefore = String((await one(`SELECT signed_at FROM portfolio_envelopes WHERE founder_id = ? AND withdrawn_at IS NULL`, [OWNER])).signed_at);
    untilBefore = String((await one(`SELECT until FROM owner_allowances ORDER BY rowid LIMIT 1`)).until);
    lastPassBefore = String((await one(`SELECT MAX(last_success_at) AS at FROM job_health`)).at);
    const { liveCharter } = await import('../../src/services/institution/charter.js');
    const daysLeftBefore = (await liveCharter(OWNER))!.daysLeft;

    const moved = await advanceDays(7);
    expect(moved.shifted).toBeGreaterThan(20);
    // What refused to move is a fact, not a failure — but the columns above must not be among them.
    for (const r of moved.refused) expect(['portfolio_envelopes', 'owner_allowances', 'job_health', 'venture_mandates']).not.toContain(r.table);

    const signedAfter = String((await one(`SELECT signed_at FROM portfolio_envelopes WHERE founder_id = ? AND withdrawn_at IS NULL`, [OWNER])).signed_at);
    const untilAfter = String((await one(`SELECT until FROM owner_allowances ORDER BY rowid LIMIT 1`)).until);
    const lastPassAfter = String((await one(`SELECT MAX(last_success_at) AS at FROM job_health`)).at);
    const daysBetween = (a: string, b: string) => Math.round((Date.parse(a.replace(' ', 'T') + (a.includes('Z') ? '' : 'Z')) - Date.parse(b.replace(' ', 'T') + (b.includes('Z') ? '' : 'Z'))) / 86_400_000);
    expect(daysBetween(signedBefore, signedAfter)).toBe(7);
    expect(daysBetween(untilBefore, untilAfter)).toBe(7);
    expect(daysBetween(lastPassBefore, lastPassAfter)).toBe(7);
    // Formats survived: SQL columns keep the space, ISO columns keep T and Z.
    expect(signedAfter.includes(' ') || signedAfter.includes('T')).toBe(true);
    expect(signedAfter.includes('T')).toBe(signedBefore.includes('T'));
    expect((await liveCharter(OWNER))!.daysLeft).toBe(daysLeftBefore - 7);
  });

  it('the owner surface reads the same later day: the pulse says the routines have not run for a week', async () => {
    const home = asText(await owner(app).page('/foundry'));
    // Seven days without a pass is a stoppage to the loop list, said first.
    expect(home).toMatch(/stopped|has not run|Stopped/);
  });

  it('two moves compose', async () => {
    const before = String((await one(`SELECT opened_at FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL`, [OWNER])).opened_at);
    await advanceDays(3);
    await advanceDays(4);
    const after = String((await one(`SELECT opened_at FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL`, [OWNER])).opened_at);
    const days = Math.round((Date.parse(before.replace(' ', 'T') + 'Z') - Date.parse(after.replace(' ', 'T') + 'Z')) / 86_400_000);
    expect(days).toBe(7);
  });
});
