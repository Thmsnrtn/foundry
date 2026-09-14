process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { observeSelf } from '../../src/services/deployment/self-check.js';

// =============================================================================
// IS THIS DEPLOYMENT RUNNING, AND HOW WOULD ANYBODY KNOW.
//
// A scheduler that has stopped entirely produces no errors at all: every page
// is calm, every number is yesterday's, and nothing says the institution went
// quiet. Silence and health look identical from outside.
//
// THIS WAS FIRST WRITTEN AS A READING ABOUT "FOUNDRY THE COMPANY" — resolving
// which product row is Foundry so the estate reading could exempt that one from
// being called blind. `recursive-institution` refused the module, and was
// right: the institutional kernel must not be ABLE to ask whether it is
// operating Foundry, because a kernel that can ask will eventually answer by
// shortening a ladder or widening a grant. Foundry stays an ordinary company
// with nothing connected to it.
//
// What is not a company question is whether the machine is running. No product
// id is resolved below; these readings say the same thing on a deployment with
// no companies in it at all.
//
// THE TEST THAT MATTERS IS WHETHER IT CAN SAY "I CANNOT TELL". Monitoring
// theatre is what you build when you want the feeling of observability, and it
// is recognisable by having only two states. Every reading here has three.
// =============================================================================

beforeAll(async () => { await runMigrations(); });

beforeEach(async () => {
  await query('DELETE FROM job_health');
  await query('DELETE FROM ai_daily_spend');
});

describe('it reads itself from rows it already keeps', () => {
  it('needs no provider, no credential and no network', async () => {
    const seen = await observeSelf();
    expect(seen.signals.map((s) => s.key).sort())
      .toEqual(['blocked', 'copies', 'database', 'routines', 'thinking']);
  });

  it('knows the database answers, and how much is in it', async () => {
    const seen = await observeSelf();
    const db = seen.signals.find((s) => s.key === 'database');
    expect(db?.state).toBe('current');
    expect(db?.says).toContain('tables');
  });
});

describe('every reading can say it cannot tell', () => {
  it('says so when no routine has ever recorded a success', async () => {
    const seen = await observeSelf();
    const routines = seen.signals.find((s) => s.key === 'routines');
    expect(routines?.state).toBe('cannot_tell');
    expect(routines?.says).toContain('cannot tell');
  });

  it('says so when there is no copy of the institution at all', async () => {
    // The harness runs in memory, so there is genuinely nothing to copy — this
    // is the real answer here rather than a contrivance.
    const seen = await observeSelf();
    expect(seen.signals.find((s) => s.key === 'copies')?.state).toBe('cannot_tell');
  });

  it('says so when nothing has ever been spent thinking', async () => {
    const seen = await observeSelf();
    const thinking = seen.signals.find((s) => s.key === 'thinking');
    expect(thinking?.state).toBe('cannot_tell');
    expect(thinking?.says).toContain('nothing to read');
  });
});

describe('stale is not the same as broken, and it is not the same as fine', () => {
  it('calls the routines current when one ran within the last six hours', async () => {
    await query(
      `INSERT INTO job_health (job_name, last_success_at, consecutive_failures)
       VALUES ('a_routine', datetime('now', '-1 hour'), 0)`);
    expect((await observeSelf()).signals.find((s) => s.key === 'routines')?.state)
      .toBe('current');
  });

  it('calls them stale when the most recent success is a day old', async () => {
    // THE FAILURE THIS EXISTS TO CATCH. A scheduler that has stopped entirely
    // produces no errors at all: every page is calm, every number is the one
    // from yesterday, and nothing anywhere says the institution went quiet.
    await query(
      `INSERT INTO job_health (job_name, last_success_at, consecutive_failures)
       VALUES ('a_routine', datetime('now', '-25 hours'), 0)`);
    const routines = (await observeSelf()).signals.find((s) => s.key === 'routines');
    expect(routines?.state).toBe('stale');
    expect(routines?.ageHours).toBeGreaterThan(6);
  });

  it('calls the meter stale when it has stopped moving', async () => {
    // A meter that has stopped is as informative as one that is racing: it
    // means the institution has stopped doing anything.
    await query(
      `INSERT INTO ai_daily_spend (scope, scope_id, date, spent_cents, updated_at)
       VALUES ('global', '__global__', date('now', '-9 days'), 100, datetime('now'))`);
    const thinking = (await observeSelf()).signals.find((s) => s.key === 'thinking');
    expect(thinking?.state).toBe('stale');
    expect(thinking?.says).toContain('9 days ago');
  });

  it('calls it current when the meter moved today', async () => {
    await query(
      `INSERT INTO ai_daily_spend (scope, scope_id, date, spent_cents, updated_at)
       VALUES ('global', '__global__', date('now'), 100, datetime('now'))`);
    expect((await observeSelf()).signals.find((s) => s.key === 'thinking')?.state)
      .toBe('current');
  });
});

describe('the whole reading', () => {
  it('is a conjunction, not a score', async () => {
    // An institution whose database answers and whose routines have stopped is
    // not eighty per cent well. `allCurrent` is every signal or none of them.
    await query(
      `INSERT INTO job_health (job_name, last_success_at, consecutive_failures)
       VALUES ('a_routine', datetime('now', '-25 hours'), 0)`);
    const seen = await observeSelf();
    expect(seen.allCurrent).toBe(false);
    expect(seen.sentence).toContain('not what');
  });

  it('names what is wrong rather than reporting a colour', async () => {
    const seen = await observeSelf();
    for (const s of seen.signals.filter((x) => x.state !== 'current')) {
      expect(s.says.length).toBeGreaterThan(10);
    }
  });

  it('resolves no product, company or tenant at all', async () => {
    // THE STRUCTURAL INVARIANT, asserted from the source rather than promised.
    // Two earlier versions of this reading resolved `system_identities` to find
    // "which product row is Foundry". A reading that cannot ask the question
    // cannot answer it differently for one company.
    const src = readFileSync(
      resolve(import.meta.dirname, '../../src/services/deployment/self-check.ts'), 'utf8');
    expect(src).not.toMatch(/system_identities/);
    expect(src).not.toMatch(/product_id/);
    expect(Object.keys(await observeSelf())).not.toContain('productId');
  });
});
