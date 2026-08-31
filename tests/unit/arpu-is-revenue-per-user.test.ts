process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// ARPU IS REVENUE PER USER, AND THIS WAS NEITHER.
//
// `estimateTAMCeiling` tells a model the company's "Current ARPU" and asks it to
// size the market from it. The number was:
//
//     (new_mrr_cents ?? 0) / Math.max(1, active_users ?? 1) / 100
//
//   new_mrr_cents   the NEW BUSINESS won this period, not the MRR level. A
//                   company at $50k MRR with a flat month had an ARPU of $0.
//   Math.max(1, …)  a company with no reported active users got a denominator
//                   of ONE, so its ARPU became its entire monthly revenue.
//   the ?? 0 / : 0  no metrics at all produced "Current ARPU: $0/mo", stated as
//                   a fact to a model that was then asked to size a market.
//
// THIS ONE IS ONLY FIXABLE NOW BECAUSE OF THE COMMIT BEFORE IT. `mrr_cents` —
// the level — had no integration writing it until this cycle, so reaching for
// it here would have swapped one absent number for another. Fixing the writer
// is what made the reader worth fixing.
//
// The prompt says "not known" when either input is missing, and gives the reason
// so it is not trimmed as boilerplate. A TAM estimate from an acknowledged gap
// is worth more than one from a fabricated ARPU: the model can say what it
// cannot know, and could not before.
// =============================================================================

const P = 'p_arpu';
let lastPrompt = '';

vi.mock('../../src/services/ai/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/ai/client.js')>()),
  callOpus: async (_system: string, prompt: string) => {
    lastPrompt = prompt;
    return {
      content: JSON.stringify({ tam_estimate_usd: 1_000_000, methodology: 'stub' }),
      model: 'stub', usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: null,
    };
  },
}));

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_a','c_a','a@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_a','active')", [P]);
});
beforeEach(async () => {
  await query('DELETE FROM metric_snapshots');
  lastPrompt = '';
});

async function snapshot(cols: Record<string, number>) {
  const keys = Object.keys(cols);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, ${keys.join(', ')})
     VALUES (?, ?, date('now'), ${keys.map(() => '?').join(', ')})`,
    [nanoid(), P, ...keys.map((k) => cols[k]!)]);
}

async function estimate(): Promise<void> {
  const { estimateTAMCeiling } = await import('../../src/services/intelligence/expansion.js');
  await estimateTAMCeiling(P);
}

describe('the ARPU a model is told', () => {
  it('is the level over the users', async () => {
    await snapshot({ mrr_cents: 5_000_000, active_users: 200, new_mrr_cents: 0 });
    await estimate();
    expect(lastPrompt, '$50,000/mo over 200 users').toMatch(/Current ARPU: \$250\/mo/);
  });

  it('does not become zero because the month was flat', async () => {
    await snapshot({ mrr_cents: 5_000_000, active_users: 200, new_mrr_cents: 0 });
    await estimate();
    expect(lastPrompt).not.toMatch(/Current ARPU: \$0\/mo/);
  });

  it('is not the whole company when no users were reported', async () => {
    await snapshot({ mrr_cents: 5_000_000 });
    await estimate();
    expect(lastPrompt, 'the max(1, …) made one user worth the entire revenue')
      .not.toMatch(/Current ARPU: \$50000\/mo/);
    expect(lastPrompt).toMatch(/Current ARPU: not known/);
  });

  it('says it is not known when nothing was reported at all', async () => {
    await estimate();
    expect(lastPrompt).toMatch(/Current ARPU: not known/);
    expect(lastPrompt, 'and says why, so it is not trimmed as boilerplate')
      .toMatch(/no MRR level or no active-user count has been reported/);
  });

  it('says it is not known rather than dividing by zero users', async () => {
    await snapshot({ mrr_cents: 5_000_000, active_users: 0 });
    await estimate();
    expect(lastPrompt).toMatch(/Current ARPU: not known/);
  });
});

describe('the old arithmetic is gone', () => {
  it('no movement column, no clamped denominator', () => {
    const code = stripComments(
      readFileSync('src/services/intelligence/expansion.ts', 'utf8'), { lineComments: true });
    const fn = code.slice(code.indexOf('export async function estimateTAMCeiling'),
                          code.indexOf('Return JSON: {"tam_estimate_usd"'));
    expect(fn).not.toMatch(/new_mrr_cents/);
    expect(fn).not.toMatch(/Math\.max\(1,/);
    expect(fn).toMatch(/mrrLevel \/ activeUsers/);
  });
});
