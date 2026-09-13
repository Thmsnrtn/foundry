process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// ONE ANSWER TO "HOW FAR ALONG IS THIS".
//
// TWO OKR SERVICES, AND THE ONE WITH THE RULES WAS THE ONE NOTHING COULD CALL.
// `src/services/scp/okr.ts` held the doctrine — status mapping, progress
// recalculation, archiving — and nothing imported it. It sat on the
// unreachable-modules baseline.
//
// The consequence was concrete. `company_okrs.progress_pct` was a stored column
// whose ONLY writer was `updateKeyResult` in that unreachable module — and that
// function had no caller either. The column was never written after insert, so
// every reader of the stored number got zero progress for every objective of
// every company, forever, while the surface that derived it showed the real
// figure. Two answers to one question, and the stored one was permanently
// wrong.
//
// The module went and the column went with it. What is left is a ratchet, and
// it is deliberately a ratchet rather than a rendering test: a derived quantity
// may not acquire a stored copy, and an unreachable module holding the rules for
// a live table may not come back. Both are conditions on the repository and the
// schema, so both stay checkable no matter which surface reads these tables.
//
// THE PAGE THIS FILE WAS WRITTEN AGAINST IS GONE. `routes/dashboard/agents-okr.ts`
// was the OKR feature people used: it rendered the change history out of
// `okr_progress_updates`, it derived progress in SQL from `current_value` and
// `target_value`, and it was the one door that created an objective. It was part
// of the Commercial Foundry surface and has been removed, so the assertions
// about what it rendered, what it created and who it refused went with it —
// there is no live page left to make them of, and the surviving readers of
// `company_okrs` (Compass's context, the target forecaster) read status and
// targets rather than progress.
// =============================================================================

beforeAll(async () => {
  await runMigrations();
});

describe('there is no second, stored answer to disagree with', () => {
  it('the unreachable service is gone', () => {
    expect(existsSync('src/services/scp/okr.ts')).toBe(false);
    expect(readFileSync('docs/db/unreachable-modules-baseline.txt', 'utf8'))
      .not.toMatch(/scp\/okr\.ts/);
  });

  // AND THE TWO COLUMN RATCHETS WENT WITH THEIR TABLES.
  //
  // One asserted `company_okrs` no longer carries `progress_pct`, the stored
  // copy of a derived number; the other asserted `key_results` still carries
  // `start_value`, `current_value` and `target_value`, because deleting the
  // stored copy is only safe while the inputs it was derived from remain.
  //
  // Migration 309 dropped both tables. The last readers of `company_okrs` were
  // the Compass agent and the target forecaster, and both were deleted with the
  // Commercial Foundry surface that was their only reachable caller — leaving
  // the OKR tables with neither a writer nor a reader. A `PRAGMA table_info` on
  // a table that does not exist returns no rows, so restating either assertion
  // here would be a check that passes by describing nothing.
  //
  // The ratchet above survives both of them, and is the one that mattered: an
  // unreachable module holding the rules for a live table may not come back.
});
