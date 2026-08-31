process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let opusCalls = 0;
let nextOverall = 80;

vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callOpus: vi.fn(async () => {
    opusCalls++;
    return {
      content: JSON.stringify({
        overall_alignment: nextOverall,
        vision_alignment: 70,
        priority_alignment: 60,
        risk_alignment: 50,
        divergence_axis: 'speed-vs-quality',
        recommendations: ['talk about pace'],
      }),
      tokensUsed: 1,
      costUsd: 0,
    };
  }),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { getAlignmentScore } = await import('../../src/services/wisdom/cofounder.js');

// =============================================================================
// A SCORE RECOMPUTED ON EVERY LOOK, AND NEVER READ BACK.
//
// `getAlignmentScore` ran Opus and appended a row to
// `cofounder_alignment_scores` on every call — and nothing in the product ever
// read that table. So `GET /api/products/:id/alignment-score` charged a model
// call per page load, and two looks at the same unchanged co-founder responses
// could disagree with each other while the disagreement piled up in a table
// with no reader.
//
// The responses are the entire input. If the newest one predates the newest
// stored score, that score still describes them, and the stored answer is the
// answer. A same-second tie is not evidence of order, so it re-scores.
// =============================================================================

const P = 'p_align';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_al1','c_al1','al1@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Alpha','f_al1','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM cofounder_dna_responses');
  await query('DELETE FROM cofounder_alignment_scores');
  opusCalls = 0;
  nextOverall = 80;
});

async function respond(founderId: string, field: string, answer: string, at?: string): Promise<void> {
  await query(
    `INSERT INTO cofounder_dna_responses (id, product_id, founder_id, dna_field, response, responded_at)
     VALUES (?,?,?,?,?, COALESCE(?, datetime('now')))`,
    [`r_${founderId}_${field}`, P, founderId, field, answer, at ?? null],
  );
}

describe('an alignment score is not recomputed while its inputs stand still', () => {
  it('scores once, then answers from the record', async () => {
    await respond('a', 'icp', 'small teams', '2026-01-01 09:00:00');
    await respond('b', 'icp', 'enterprise', '2026-01-01 09:00:00');

    const first = await getAlignmentScore(P);
    expect(opusCalls).toBe(1);
    expect(first.overall_alignment).toBe(80);
    expect(first.respondents).toBe(2);

    // If the model were asked again it would answer differently — so a second
    // call returning 80 is evidence the stored row was read, not re-derived.
    nextOverall = 5;
    const second = await getAlignmentScore(P);
    expect(opusCalls).toBe(1);
    expect(second.overall_alignment).toBe(80);
    expect(second.divergence_axis).toBe('speed-vs-quality');
    expect(second.recommendations).toEqual(['talk about pace']);
    expect(second.respondents).toBe(2);

    const rows = await query('SELECT COUNT(*) AS n FROM cofounder_alignment_scores WHERE product_id = ?', [P]);
    expect(Number((rows.rows[0] as unknown as { n: number }).n)).toBe(1);
  });

  it('a new answer from a co-founder makes the stored score stale', async () => {
    await respond('a', 'icp', 'small teams', '2026-01-01 09:00:00');
    await respond('b', 'icp', 'enterprise', '2026-01-01 09:00:00');
    await getAlignmentScore(P);
    expect(opusCalls).toBe(1);

    nextOverall = 30;
    await respond('b', 'positioning', 'top-down', '2099-01-01 09:00:00');

    const after = await getAlignmentScore(P);
    expect(opusCalls).toBe(2);
    expect(after.overall_alignment).toBe(30);
  });

  it('a response written in the same second as the score is not assumed to be older', async () => {
    await respond('a', 'icp', 'small teams');
    await respond('b', 'icp', 'enterprise');
    await getAlignmentScore(P);
    expect(opusCalls).toBe(1);

    const stored = await query(
      'SELECT created_at FROM cofounder_alignment_scores WHERE product_id = ? LIMIT 1', [P],
    );
    const scoredAt = String((stored.rows[0] as unknown as { created_at: string }).created_at);
    await respond('b', 'risk', 'cautious', scoredAt);

    await getAlignmentScore(P);
    expect(opusCalls).toBe(2);
  });

  it('one respondent is still refused an alignment score, and stores nothing', async () => {
    await respond('a', 'icp', 'small teams');
    const only = await getAlignmentScore(P);
    expect(opusCalls).toBe(0);
    expect(only.overall_alignment).toBeNull();
    expect(only.respondents).toBe(1);

    const rows = await query('SELECT COUNT(*) AS n FROM cofounder_alignment_scores WHERE product_id = ?', [P]);
    expect(Number((rows.rows[0] as unknown as { n: number }).n)).toBe(0);
  });
});
