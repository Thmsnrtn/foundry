process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { JOB_REGISTRY } from '../../src/jobs/index.js';

// =============================================================================
// A ROW OF ZEROS CANNOT SAY THAT NOTHING WAS REPORTED.
//
// A daily job inserted an EMPTY `metric_snapshots` row for every active product
// at midnight UTC, "to ensure daily snapshots exist". Nothing needed them to
// exist, and their existence was read as measurement across the codebase: the
// MRR decomposition read the latest row and returned a confident zero to ten
// importers; `/v1/metrics/health` computed `is_stale` from the EXISTENCE of a
// row, so every company was fresh forever; the migration assessment found a
// company with no revenue.
//
// Four separate repairs in this campaign were workarounds for this one writer.
// The two ingest paths that genuinely needed the row now upsert, and the Stripe
// webhook always created its own. So the job is gone, and the absence of a row
// says the thing a row of zeros could not: this company reported nothing that
// day.
// =============================================================================

beforeAll(async () => { await runMigrations(); });

describe('the daily placeholder', () => {
  it('is not a scheduled job any more', () => {
    expect(JOB_REGISTRY.metric_snapshot).toBeUndefined();
  });

  it('has no writer left in the codebase', () => {
    // Comments stripped: the paragraph explaining the removal names the job.
    const src = stripComments(readFileSync('src/jobs/index.ts', 'utf8'), { lineComments: true });
    expect(src).not.toMatch(/export async function metricSnapshot/);
    expect(src).not.toMatch(/INSERT INTO metric_snapshots \(id, product_id, snapshot_date\) VALUES/);
  });

  it('leaves the registry otherwise intact', () => {
    // A registry that lost more than it should is a different defect.
    expect(Object.keys(JOB_REGISTRY).length).toBeGreaterThan(30);
    expect(JOB_REGISTRY.lifecycle_check).toBeTruthy();
  });
});

describe('what a company that reported nothing looks like', () => {
  it('has no snapshot at all, rather than a snapshot of zeros', async () => {
    await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_ph','c_ph','ph@example.com')");
    await query("INSERT INTO products (id, name, owner_id, status) VALUES ('p_ph','Quiet','f_ph','active')");

    const rows = await query('SELECT COUNT(*) AS n FROM metric_snapshots WHERE product_id = ?', ['p_ph']);
    expect((rows.rows[0] as unknown as { n: number }).n).toBe(0);
  });
});
