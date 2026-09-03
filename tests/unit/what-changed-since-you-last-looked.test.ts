process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { markVisit, whatChangedSince } from '../../src/services/founder/what-changed.js';

// =============================================================================
// WHAT CHANGED SINCE YOU LAST LOOKED.
//
// The last of the five questions the first screen is supposed to answer. It
// could say whether everything was okay, whether anything needed him, what it
// was doing and how to speak to it — and it had no way at all to say what had
// happened while he was gone, because nothing anywhere recorded that he had
// ever been here.
//
// WHAT THIS IS NOT: an activity feed. Foundry runs ninety-five routines and
// none of them are news. "I checked your dependencies" is work, not change, and
// a screen reporting its own diligence is asking to be admired.
// =============================================================================

const OWNER = 'changed_owner';
let app: Hono;

async function firstScreen(): Promise<string> {
  return (await app.request('/foundry')).text();
}

/** Move the marker back, the way a real absence would. */
async function comeBackTomorrow(): Promise<void> {
  await query("UPDATE owner_visits SET looked_at = datetime('now','-1 day'), "
    + "since = datetime('now','-1 day') WHERE founder_id = ?", [OWNER]);
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_changed', 'owner@example.com', 'Thomas Norton']);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', foundryShellRoutes);
});

describe('the line everything is measured from', () => {
  it('has nothing to measure from on a first visit', async () => {
    // "Everything that has ever happened" is not what the question means.
    expect(await markVisit(OWNER)).toBeNull();
    const body = await firstScreen();
    expect(body).not.toContain('While you were away');
  });

  it('holds still while he is here, so a refresh does not erase it', async () => {
    const first = await markVisit(OWNER);
    const second = await markVisit(OWNER);
    expect(second).toBe(first);
  });

  it('moves once he has actually been away', async () => {
    await comeBackTomorrow();
    const since = await markVisit(OWNER);
    expect(since).not.toBeNull();
    // And it never runs ahead of the visit itself.
    const row = (await query('SELECT looked_at, since FROM owner_visits WHERE founder_id = ?',
      [OWNER])).rows[0] as Record<string, unknown>;
    expect(String(row.since) <= String(row.looked_at)).toBe(true);
  });
});

describe('what it tells him happened', () => {
  it('says a search started, in his register rather than the schema\'s', async () => {
    await comeBackTomorrow();
    await app.request('/foundry/ask', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ said:
        'Make the river stronger by finding another small digital income stream.' }).toString() });
    await comeBackTomorrow();
    const body = await firstScreen();
    expect(body).toContain('While you were away');
    expect(body).toContain('I started looking for another way to make money');
  });

  it('says when a way of looking goes dark', async () => {
    // The change most likely to make everything else quietly wrong, and the one
    // that would otherwise only ever appear in a log.
    await comeBackTomorrow();
    const provider = (await query(
      "SELECT id, maturity FROM capability_providers WHERE provider = 'hn_algolia'"))
      .rows[0] as Record<string, unknown>;
    // The database refuses a change whose starting point is not where the
    // provider actually is, which is why this reads the current rung rather
    // than asserting one.
    await query(
      `INSERT INTO capability_maturity_changes
         (id, provider_id, from_maturity, to_maturity, evidence, evidence_mode, witnessed_by)
       VALUES ('mc1', ?, ?, 'degraded', 'it stopped answering', 'real',
         'sense_check_tick')`, [String(provider.id), String(provider.maturity)]);
    const { changes } = await whatChangedSince(OWNER,
      String(((await query('SELECT since FROM owner_visits WHERE founder_id = ?', [OWNER]))
        .rows[0] as Record<string, unknown>).since));
    expect(changes.some((ch) => ch.said.includes('lost a way of looking'))).toBe(true);
  });

  it('never reports its own diligence as news', async () => {
    await comeBackTomorrow();
    const body = await firstScreen();
    // Routine runs, checks performed, jobs ticked. None of it is change.
    expect(body).not.toMatch(/I checked|I ran|routine/i);
  });

  it('says how many rather than listing everything', async () => {
    const since = '2000-01-01 00:00:00';
    for (let i = 0; i < 7; i += 1) {
      await query(
        `INSERT INTO posture_changes (id, product_id, founder_id, from_posture, to_posture,
           said, changed_by) VALUES (?, NULL, ?, 'grow', 'hold', 'leave it', ?)`,
        [`pc${String(i)}`, OWNER, OWNER]).catch(() => undefined);
    }
    const out = await whatChangedSince(OWNER, since, 2);
    expect(out.changes.length).toBeLessThanOrEqual(2);
  });
});
