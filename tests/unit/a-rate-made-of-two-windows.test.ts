process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { syncPostHogMetrics } from '../../src/services/integrations/posthog.js';

// =============================================================================
// A RATE MADE OF TWO DIFFERENT WINDOWS.
//
// `activation_rate` was computed as activations over THIRTY days divided by
// signups over SEVEN, with `Math.max(signups, activated)` in the denominator so
// the answer could not exceed 1.
//
// For any company with steady growth the thirty-day numerator is larger than the
// seven-day denominator. The max fires, the two cancel, and the rate is EXACTLY
// 1.0000 — a hundred percent activation, recorded for essentially every healthy
// company, and read from there by the board deck, the value delivery index and
// the portfolio benchmark percentiles.
//
// THE CLAMP IS WHAT HID IT. Without it the number would have been 3.2 and
// somebody would have asked. A guard that keeps a value inside its declared
// range is not the same as a value that belongs there, and this one turned a
// windowing mistake into the best possible score.
//
// Both counts are over thirty days now. It is a PERIOD RATIO, not a cohort rate
// — the people who activated are not necessarily the people who signed up in the
// window — and that is the closest honest thing these two counts can say. A
// ratio above 1 is real and means the two events are not in the relationship
// this column assumes, so nothing is written rather than a hundred percent.
// =============================================================================

const P = 'p_ph';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_ph','c_ph','ph@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_ph','active')", [P]);
  await query(
    `INSERT INTO integrations (id, product_id, type, status) VALUES ('int_ph', ?, 'posthog', 'active')`, [P]);
});
beforeEach(async () => { await query('DELETE FROM metric_snapshots'); });
afterEach(() => { vi.unstubAllGlobals(); });

/**
 * PostHog answers with a count per window. `counts` is keyed by
 * `${event}:${days}` so a test can make the two windows disagree on purpose.
 */
function postHogSays(counts: Record<string, number>): void {
  vi.stubGlobal('fetch', async (url: string) => {
    const u = new URL(String(url));
    const event = JSON.parse(u.searchParams.get('events') ?? '[]')[0]?.id ?? '';
    const from = u.searchParams.get('date_from') ?? '';
    const days = Math.round(
      (Date.now() - new Date(from).getTime()) / 86_400_000);
    const window = days >= 20 ? 30 : 7;
    const value = counts[`${event}:${window}`];
    return {
      ok: true, status: 200,
      json: async () => ({ result: [{ count: value ?? 0, data: [] }] }),
      text: async () => '{}',
    };
  });
}

async function snapshot(): Promise<Record<string, unknown> | undefined> {
  return (await query('SELECT * FROM metric_snapshots WHERE product_id = ?', [P]))
    .rows[0] as Record<string, unknown> | undefined;
}

describe('activation rate', () => {
  it('divides thirty days by thirty days', async () => {
    postHogSays({ '$identify:7': 25, '$identify:30': 100, 'activated:30': 40 });
    await syncPostHogMetrics(P, 'int_ph',
      { api_key: 'k', project_id: '1' }, { activation_event: 'activated' });

    const row = await snapshot();
    expect(Number(row?.activation_rate),
      '40 of 100 over the same window — it used to be 40/25 clamped to 1.0').toBe(0.4);
    expect(Number(row?.signups_7d), 'and the seven-day count keeps its own meaning').toBe(25);
  });

  it('no longer reports a hundred percent for a growing company', async () => {
    // The shape that produced 1.0000 every time: more activations in thirty days
    // than signups in seven.
    postHogSays({ '$identify:7': 25, '$identify:30': 100, 'activated:30': 80 });
    await syncPostHogMetrics(P, 'int_ph',
      { api_key: 'k', project_id: '1' }, { activation_event: 'activated' });

    expect(Number((await snapshot())?.activation_rate)).toBe(0.8);
  });

  it('writes nothing when more activated than signed up in the same window', async () => {
    postHogSays({ '$identify:7': 5, '$identify:30': 10, 'activated:30': 30 });
    await syncPostHogMetrics(P, 'int_ph',
      { api_key: 'k', project_id: '1' }, { activation_event: 'activated' });

    const row = await snapshot();
    expect(row?.activation_rate,
      'the two events are not in the relationship this column assumes').toBeNull();
    expect(Number(row?.signups_7d), 'and the rest of the sync still lands').toBe(5);
  });

  it('writes nothing when nobody signed up', async () => {
    postHogSays({ '$identify:7': 0, '$identify:30': 0, 'activated:30': 0 });
    await syncPostHogMetrics(P, 'int_ph',
      { api_key: 'k', project_id: '1' }, { activation_event: 'activated' });
    expect((await snapshot())?.activation_rate ?? null).toBeNull();
  });
});

describe('the clamp is gone', () => {
  it('no denominator picks itself', () => {
    const code = stripComments(
      readFileSync('src/services/integrations/posthog.ts', 'utf8'), { lineComments: true });
    expect(code, 'Math.max in a denominator turns a mismatch into a perfect score')
      .not.toMatch(/Math\.max\(signups, activated\)/);
    expect(code).toMatch(/activated \/ signups30/);
  });

  it('and the signup count is fetched for both windows', () => {
    const code = stripComments(
      readFileSync('src/services/integrations/posthog.ts', 'utf8'), { lineComments: true });
    expect(code).toMatch(/'\$identify', sevenDaysAgo, today/);
    expect(code).toMatch(/'\$identify', thirtyDaysAgo, today/);
  });
});
