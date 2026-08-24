process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { generateProactiveInsights } from '../../src/services/intelligence/predictions.js';

// =============================================================================
// "LAST PERIOD" WAS WHATEVER THE PREVIOUS ROW HAPPENED TO BE.
//
// `generateProactiveInsights` compares the two most recent `metric_snapshots`
// and every sentence it produces says "from last period" or "recently". The
// table is keyed by DATE and most companies report daily, so for them this is
// yesterday against the day before — and `signups_7d` and `support_volume_7d`
// are SEVEN-DAY ROLLING WINDOWS, so two adjacent days share six of their seven
// days. A 50% jump between overlapping windows is a different event from a 50%
// jump between periods, and the founder was told the second.
// =============================================================================

const P = 'p_ins';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_ins','c_ins','ins@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_ins','active')", [P]);
});

beforeEach(async () => { await query('DELETE FROM metric_snapshots'); });

async function snap(date: string, cols: Record<string, number>) {
  const keys = Object.keys(cols);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date${keys.map((k) => `, ${k}`).join('')})
     VALUES (?, ?, ?${keys.map(() => ', ?').join('')})`,
    [`ms_${date}`, P, date, ...keys.map((k) => cols[k])],
  );
}

describe('an insight about a change', () => {
  it('says the change was over one day when it was', async () => {
    await snap('2026-08-01', { churned_mrr_cents: 100_000 });
    await snap('2026-08-02', { churned_mrr_cents: 200_000 });

    const insights = await generateProactiveInsights(P);
    const churn = insights.find((i) => i.id.includes('churn-spike'));
    expect(churn).toBeTruthy();
    expect(churn!.body).toContain('over one day');
    expect(churn!.body, 'a day is not a period').not.toContain('from last period');
  });

  it('says how many days when the company reports monthly', async () => {
    await snap('2026-07-01', { churned_mrr_cents: 100_000 });
    await snap('2026-08-01', { churned_mrr_cents: 200_000 });

    const insights = await generateProactiveInsights(P);
    const churn = insights.find((i) => i.id.includes('churn-spike'));
    expect(churn!.body).toContain('over 31 days');
  });

  it('says that the seven-day figures overlap', async () => {
    await snap('2026-08-01', { support_volume_7d: 10 });
    await snap('2026-08-02', { support_volume_7d: 30 });

    const insights = await generateProactiveInsights(P);
    const support = insights.find((i) => i.id.includes('support-spike'));
    expect(support).toBeTruthy();
    expect(support!.body).toContain('seven-day');
    expect(support!.body).toContain('over one day');
  });
});
