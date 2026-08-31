// =============================================================================
// Tests: a finished query leaves nothing behind.
//
// `query()` raced the database against a ten-second timeout and never cleared
// the timer. `Promise.race` abandons the loser; it does not cancel it. So every
// query this process ever ran left a live timer holding a rejection closure for
// ten seconds after the query had already returned.
//
// Two consequences, one ordinary and one that took a while to connect.
//
// Under load it is a retained closure per query — thousands of them in a busy
// minute, each pinned for ten seconds after it stopped meaning anything.
//
// At shutdown it is a queue of live timers keeping the event loop alive while a
// native database handle is still open beneath them. This suite intermittently
// died with a Rust panic out of the libsql binding — `PendingException` where
// `Ok` was expected — and aborted the whole run. An abort is not a test
// failure: it takes the run with it, so "validation green" becomes a claim that
// depends on whether the process survived long enough to say so.
//
// That is NOT proven to be the cause, and this file does not claim it. What is
// proven is the leak, which is a defect on its own terms and is fixed here.
// Whether the abort stops is a separate question the next runs answer.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';

import { describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

/** Live timers this process is holding. Node exposes the handle types keeping
 *  the loop alive, which is exactly the question: would this process exit? */
const timers = (): number =>
  (process.getActiveResourcesInfo?.() ?? []).filter((r) => r === 'Timeout').length;

describe('a query that has returned is finished', () => {
  it('holds no timer once it settles', async () => {
    await runMigrations();

    const before = timers();
    for (let i = 0; i < 25; i++) {
      await query('SELECT 1 AS n', []);
    }
    // Twenty-five queries used to leave twenty-five ten-second timers. The
    // count must not grow with the number of queries — that is the whole
    // property, and it fails loudly at 25 rather than subtly at 25,000.
    expect(timers(), 'each finished query is still holding a timer').toBeLessThanOrEqual(before);
  });

  it('holds no timer after a query that throws', async () => {
    // The failure path is the one that gets forgotten. A rejected query must
    // clear its timer too, or an error becomes a leak as well as an error.
    const before = timers();
    for (let i = 0; i < 10; i++) {
      await expect(query('SELECT * FROM a_table_that_does_not_exist', [])).rejects.toThrow();
    }
    expect(timers(), 'a failed query is still holding a timer').toBeLessThanOrEqual(before);
  });
});
