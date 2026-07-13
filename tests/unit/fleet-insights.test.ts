// =============================================================================
// Tests: Cross-Company Insight Reader (Option B fleet slice, 2026-07-13)
// Reads anonymized decision_patterns for the founder's OPEN decisions.
// Honesty Law: abstains below 5 peers — the card never pads.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getFleetInsights } from '../../src/services/fleet/insights.js';

const seedPattern = (type: string, stage: string, option: string, outcome: string) => query(
  `INSERT INTO decision_patterns
     (id, decision_type, product_lifecycle_stage, risk_state_at_decision,
      key_metrics_context, option_chosen_category, outcome_direction)
   VALUES (?, ?, ?, 'green', '{}', ?, ?)`,
  [nanoid(), type, stage, option, outcome],
);

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('fi_f','clk_fi','fi@t.co')", []);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('fi_p1','AlphaCo','fi_f','active')", []);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('fi_p2','BetaCo','fi_f','active')", []);
  await query("INSERT INTO lifecycle_state (product_id, current_prompt) VALUES ('fi_p1','prompt_2')", []);

  // Open decisions: one with rich peer history, one without.
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status)
     VALUES ('fi_d1', 'fi_p1', 'strategic', 2, 'Raise prices 20%', 'margin', 'pending'),
            ('fi_d2', 'fi_p2', 'urgent', 1, 'Fix checkout bug', 'errors', 'pending')`,
    [],
  );

  // 6 anonymized peers faced a 'strategic' decision at prompt_2; 5 chose
  // 'raise_prices', 4 of those went positive. Only 2 peers match fi_d2's cell.
  for (let i = 0; i < 4; i++) await seedPattern('strategic', 'prompt_2', 'raise_prices', 'positive');
  await seedPattern('strategic', 'prompt_2', 'raise_prices', 'negative');
  await seedPattern('strategic', 'prompt_2', 'hold_prices', 'neutral');
  await seedPattern('urgent', 'prompt_1', 'hotfix', 'positive');
  await seedPattern('urgent', 'prompt_1', 'hotfix', 'positive');
});

describe('the cross-company reader', () => {
  it('surfaces peer outcomes for open decisions with enough history', async () => {
    const insights = await getFleetInsights('fi_f');
    expect(insights.length).toBe(1); // fi_d2's cell abstains (2 < 5 peers)

    const ins = insights[0];
    expect(ins.decisionId).toBe('fi_d1');
    expect(ins.productName).toBe('AlphaCo');
    expect(ins.summary).toContain('5 founders at your stage');
    expect(ins.summary).toContain('raise prices');
    expect(ins.summary).toContain('80%'); // 4/5 positive
    expect(ins.sampleSize).toBe(6);
  });

  it('abstains entirely for a founder with no matching peer cells', async () => {
    await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('fi_f2','clk_fi2','fi2@t.co')", []);
    await query("INSERT INTO products (id, name, owner_id, status) VALUES ('fi_p3','LonelyCo','fi_f2','active')", []);
    await query(
      `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status)
       VALUES ('fi_d3', 'fi_p3', 'marketing', 1, 'Try ads', 'growth', 'pending')`, [],
    );
    expect(await getFleetInsights('fi_f2')).toEqual([]); // silence, not padding
  });
});
