process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// THE TRANSPARENCY PAGE READ A TABLE NOTHING HAS EVER WRITTEN.
//
// `agent_run_details` had three writers — `startRunRecord`, `completeRunRecord`
// and `failRunRecord` — and no caller for any of them. Every cost table, run
// list and run detail on the Agent Transparency pages was therefore empty for
// every company, forever, under a header that said the page shows exactly what
// each agent sees, thinks and costs per run. The empty state read "No run data
// yet. Agents will appear here once they complete their first run"; the agents
// run daily.
//
// The runs are in `agent_sessions`, written by `agents/base.ts`. Migration 209
// drops the empty table and these reads went where the rows are.
//
// AND THEN THE READS WENT TOO. `scp/transparency/run-history.ts` was deleted as
// production-dead — the Agent Transparency pages had already gone — so the five
// describes that drove `getAgentCostSummary`, `getRecentRuns`,
// `getAgentRunHistory`, `getRunDetails` and `getAgentCurrentHealth` over real
// `agent_sessions` rows went with it.
//
// WHAT IS KEPT IS THE ONE THING A NEW PAGE COULD GET WRONG AGAIN: the table
// must stay dropped and unnamed. If `agent_run_details` comes back into the
// schema or into the source, somebody has written a reader against a table
// nothing has ever written — which is the whole finding, and it does not need
// the reader that provoked it to still exist.
// =============================================================================

beforeAll(async () => { await runMigrations(); });

describe('the table that had no writer', () => {
  it('is gone from the schema', async () => {
    const res = await query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_run_details'",
    );
    expect(res.rows).toHaveLength(0);
  });

  it('is gone from the source', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
      const p = join(dir, e);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
    // Comments stripped first: this file's own explanation of what was removed
    // names the table, and so does the page's.
    const offenders = walk('src')
      .filter((f) => stripComments(readFileSync(f, 'utf8')).includes('agent_run_details'));
    expect(offenders).toEqual([]);
  });
});
