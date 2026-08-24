process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// A DAILY RATE SCORED AGAINST A MONTHLY THRESHOLD.
//
// Three more consumers took the two most recent `metric_snapshots`, divided
// them, and treated the result as a monthly figure. The table is keyed by DATE
// and most companies report daily.
//
//   `fundraising-readiness`  scores growth against 15%/month and prints
//                            "growth: X%/mo" in an investor-readiness
//                            assessment — so a company growing 0.5% a day
//                            (about 16% a month) scored zero of two points.
//   `briefing.ts`            reports `mrr_growth_pct` to the founder as the
//                            company's growth.
//   `briefing/compressed.ts` named the older row `lastWeekMetrics` and built
//                            every delta in the compressed briefing from it.
// =============================================================================

const seen: { prompt: string } = { prompt: '' };

vi.mock('../../src/services/ai/client.js', async (orig) => {
  const actual = await orig<typeof import('../../src/services/ai/client.js')>();
  return {
    ...actual,
    callSonnet: async (_system: string, user: string) => {
      seen.prompt = user;
      return { content: '{"gaps":[]}', input_tokens: 1, output_tokens: 1 };
    },
  };
});

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { assessFundraisingReadiness } = await import('../../src/services/scp/investor/fundraising-readiness.js');

const P = 'p_rate';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_rate','c_rate','r@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_rate','active')", [P]);
});

beforeEach(async () => { await query('DELETE FROM metric_snapshots'); });

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function snap(offset: number, mrrCents: number) {
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents)
     VALUES (?, ?, ?, ?)`,
    [`ms_${offset}`, P, daysAgo(offset), mrrCents],
  );
}

describe('the growth rate in an investor readiness assessment', () => {
  it('reads a daily reporter’s 0.5%-a-day as about 16% a month', async () => {
    await snap(1, 10_000_000);
    await snap(0, 10_050_000);   // +0.5% in one day

    await assessFundraisingReadiness(P, 'seed');
    // The rate reaches the model — and the founder, through its narrative — in
    // the traction line of this prompt.
    expect(seen.prompt).toMatch(/growth: 1[5-7](\.\d+)?%\/mo/);
    expect(seen.prompt, 'a daily rate was being stated as a monthly one')
      .not.toMatch(/growth: 0\.5%\/mo/);
  });

  it('reads a monthly reporter unchanged', async () => {
    await snap(30, 10_000_000);
    await snap(0, 11_500_000);   // +15% in a month

    await assessFundraisingReadiness(P, 'seed');
    expect(seen.prompt).toMatch(/growth: 1[4-6](\.\d+)?%\/mo/);
  });

  it('says nothing when there is only one snapshot', async () => {
    await snap(0, 10_000_000);
    await assessFundraisingReadiness(P, 'seed');
    expect(seen.prompt).toContain('growth: N/A%/mo');
  });
});

describe('the compressed briefing', () => {
  it('does not call the previous snapshot last week', async () => {
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('../../scripts/lib/strip-comments.mjs');
    const src = stripComments(readFileSync('src/services/scp/briefing/compressed.ts', 'utf8'));
    expect(src).not.toContain('lastWeekMetrics');
    expect(src).toContain('over_days');
  });
});
