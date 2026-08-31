process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

let lastPrompt = '';

vi.mock('../../src/services/ai/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/ai/client.js')>()),
  // (systemPrompt, userPrompt, …) — the metrics are in the second.
  callOpus: async (_system: string, userPrompt: string) => {
    lastPrompt = userPrompt;
    return { content: 'A quiet week.', model: 'stub', usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: null };
  },
  callSonnet: async (_system: string, userPrompt: string) => {
    lastPrompt = userPrompt;
    return { content: 'A quiet week.', model: 'stub', usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: null };
  },
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { generateDigest } = await import('../../src/services/digest/generator.js');
const { getLatestCompressedBrief } = await import('../../src/services/scp/briefing/compressed.js');

// =============================================================================
// ONE NULL, READ AS TWO OPPOSITE FACTS.
//
// `metric_snapshots.activation_rate`, `.day_30_retention`, `.churn_rate` and
// `.nps_score` are nullable REAL columns with no default, and the daily job
// writes a placeholder snapshot carrying nothing but (id, product_id,
// snapshot_date). `getLatestMetrics` returns that row as the latest one. So on
// the ordinary weekly path every one of those columns is NULL — and the digest
// generator wrote `?? 0` across all of them, in one object literal:
//
//   churn_rate: 0          → flawless retention. The best possible news.
//   activation_rate: 0     → nobody activates. The worst possible news.
//   day_30_retention: 0    → nobody comes back. The worst possible news.
//
// The same absence, read as the best and the worst thing that could be true,
// in adjacent lines. The object then went to a model as ground truth to write
// the COO narrative, and to the founder's inbox as "Activation: 0.0%".
//
// `services/ai/measured.ts` exists because four agents did this with these
// exact columns. Its header says so, in these words: "the prompt read
// `Churn rate: 0.0%. NPS: 0.0.` — which is not an absence of data, it is a
// claim of excellent retention and a mediocre NPS." The digest was a fifth
// reader, and the only one whose output is emailed.
//
// TWO MORE READERS UNDID THEIR OWN WRITERS' NULLS.
//
// `computeHealthRatio` was deliberately changed to return
// `{ value: null, indicator: 'unknown' }` because "a company with no new MRR to
// divide by got a ratio of 0 and an indicator of GREEN — the most reassuring
// answer available, for the absence of the measurement." The digest's call site
// handed back green/0 anyway when there was no decomposition at all, restoring
// the defect one level up and making the email's own `value === null` branch
// unreachable.
//
// `getLatestCompressedBrief` returned `?? 50` for a NULL health score —
// resurrecting the exact invented number that migration 190, the writer's
// comment and the route were all changed to eliminate. The route at
// `weekly-brief.ts` is written for the null and says "not scored"; that branch
// could never execute, because the reader substituted 50 first, and 50 renders
// amber. A company nothing had assessed was painted the same colour as a
// measured mediocre one.
// =============================================================================

const P = 'p_null2';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_n2','c_n2','n2@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_n2','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM metric_snapshots WHERE product_id = ?', [P]);
  await query('DELETE FROM weekly_compressed_briefs WHERE product_id = ?', [P]);
  lastPrompt = '';
});

/** What the daily job writes: a row carrying only a date. */
async function placeholderSnapshot(): Promise<void> {
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date) VALUES (?, ?, date('now'))`,
    [nanoid(), P]);
}

describe('a week nobody measured', () => {
  it('does not report flawless churn and total activation failure from one null', async () => {
    await placeholderSnapshot();

    const digest = await generateDigest(P, 'green', 'weekly');

    expect(digest.metrics.churn_rate).toBeNull();
    expect(digest.metrics.activation_rate).toBeNull();
    expect(digest.metrics.day_30_retention).toBeNull();
    expect(digest.metrics.nps_score).toBeNull();
  });

  it('tells the model "unknown" rather than handing it fabricated facts', async () => {
    await placeholderSnapshot();

    await generateDigest(P, 'green', 'weekly');

    expect(lastPrompt).toContain('churn unknown');
    expect(lastPrompt).toContain('activation unknown');
    expect(lastPrompt).toContain('NPS unknown');
    // The shape the measured.ts header quotes as the thing it exists to stop.
    expect(lastPrompt).not.toContain('churn 0.0%');
  });

  it('reports a real zero as a real zero', async () => {
    // A reported 0 is a finding and must still read like one. This is the line
    // between "not measured" and "measured, and it was nothing".
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, churn_rate, activation_rate)
       VALUES (?, ?, date('now'), 0, 0)`, [nanoid(), P]);

    const digest = await generateDigest(P, 'green', 'weekly');

    expect(digest.metrics.churn_rate).toBe(0);
    expect(lastPrompt).toContain('churn 0.0%');
  });

  it('does not call a company with no revenue data healthy', async () => {
    // NO SNAPSHOT AT ALL, which is what makes getMRRDecomposition return null
    // and sends the digest down its own fallback branch — the one that handed
    // back green/0 regardless of what computeHealthRatio would have said.
    const digest = await generateDigest(P, 'green', 'weekly');

    // Green was the most reassuring answer available, for the absence of the
    // measurement — which is the phrase computeHealthRatio was fixed under.
    expect(digest.mrr_health.indicator).toBe('unknown');
    expect(digest.mrr_health.value).toBeNull();
  });
});

describe('a company no agent has scored', () => {
  it('reports no health score rather than the invented middle of the scale', async () => {
    await query(
      `INSERT INTO weekly_compressed_briefs
         (id, product_id, week_of, health_score, health_trend, one_sentence_status)
       VALUES (?, ?, date('now'), NULL, 'stable', 'Quiet week.')`, [nanoid(), P]);

    const brief = await getLatestCompressedBrief(P);

    // 50 is the middle of every bar the product draws, and it renders amber.
    expect(brief?.health_score).toBeNull();
  });

  it('still reports a score that was actually computed', async () => {
    await query(
      `INSERT INTO weekly_compressed_briefs
         (id, product_id, week_of, health_score, health_trend, one_sentence_status)
       VALUES (?, ?, date('now'), 50, 'stable', 'Quiet week.')`, [nanoid(), P]);

    const brief = await getLatestCompressedBrief(P);

    // A measured 50 is a real finding and must survive the fix untouched.
    expect(brief?.health_score).toBe(50);
  });
});
