process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getAICostData } from '../../src/services/founder/intelligence.js';

// =============================================================================
// AN ESTIMATE STANDING NEXT TO A LEDGER OF WHAT WAS ACTUALLY SPENT.
//
// The operator's "Cost (24h)" badge summed tokens from `chat_messages` — the
// founder-chat path only — and multiplied by a hardcoded blended rate:
//
//     const estimatedCost = totalTokens * 0.000005; // ~$5/M average
//
// while `cost_events` held the real amounts, written by the AI client that
// reserves against the spend ceilings before every dispatch.
//
// Two fields were worse than approximate. `avg_latency_ms: 0` and
// `calls_by_model: { 'claude-opus-4-8': 0, ... }` are not measurements: nothing
// records per-call latency, and NO CALLER RECORDS THE MODEL — `logCost` takes
// `details` and the agent runner passes `{tokens, session}`. The dashboard
// rendered the second as `Models: 3`, the key count of a hardcoded object,
// which would have read 3 whatever had run.
//
// The rule is this system's own, stated in `institutional-economics.ts`:
// MEASURED-AND-ZERO IS NOT THE SAME FACT AS NOT-MEASURED.
// =============================================================================

const P = 'aic_product';
const OWNER = 'aic_owner';

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query(`INSERT INTO founders (id,clerk_user_id,email,tier) VALUES (?,'aic_c','o@example.com','growth')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'CostCo',?,'active')`, [P, OWNER]);
});

beforeEach(async () => {
  await query('DELETE FROM cost_events');
  await query('DELETE FROM agent_cost_log');
  await query('DELETE FROM chat_messages');
});

describe('what the operator is told about spend', () => {
  it('is what was recorded, not a rate multiplied by a proxy', async () => {
    await query(
      `INSERT INTO cost_events (id, product_id, cost_type, amount_usd)
       VALUES ('ce1', ?, 'llm_tokens', 4.25), ('ce2', ?, 'email_send', 0.75)`, [P, P]);

    const cost = await getAICostData();
    expect(cost.total_cost_24h, 'the ledger says 5.00').toBe(5);
  });

  it('counts every kind of spend the ledger holds, not only model tokens', async () => {
    await query(
      `INSERT INTO cost_events (id, product_id, cost_type, amount_usd)
       VALUES ('ce1', ?, 'integration_api', 2.00)`, [P]);
    expect((await getAICostData()).total_cost_24h,
      'an API call is money the company spent').toBe(2);
  });

  it('does not count spend from before the window', async () => {
    await query(
      `INSERT INTO cost_events (id, product_id, cost_type, amount_usd, created_at)
       VALUES ('old', ?, 'llm_tokens', 99, datetime('now','-3 days'))`, [P]);
    expect((await getAICostData()).total_cost_24h).toBe(0);
  });

  it('adds the two token sources, which do not overlap', async () => {
    // Agent sessions log to `agent_cost_log`; founder chat to `chat_messages`.
    await query(
      `INSERT INTO agent_cost_log (id, product_id, agent_name, tokens_input, tokens_output)
       VALUES ('acl1', ?, 'harbor', 100, 50)`, [P]);
    await query(
      `INSERT INTO chat_sessions (id, founder_id, product_id) VALUES ('cs1', ?, ?)`, [OWNER, P]);
    await query(
      `INSERT INTO chat_messages (id, session_id, role, content, tokens_in, tokens_out)
       VALUES ('cm1','cs1','founder','hi', 10, 5)`);

    expect((await getAICostData()).total_tokens_24h).toBe(165);
  });
});

describe('what the operator is NOT told, and is told so', () => {
  it('reports latency as unmeasured rather than as zero', async () => {
    const cost = await getAICostData();
    expect(cost.avg_latency_ms, 'nothing records per-call latency').toBeNull();
    expect(cost.avg_latency_ms, 'and zero would read as a measurement').not.toBe(0);
  });

  it('reports the model breakdown as unrecorded rather than as three zeros', async () => {
    const cost = await getAICostData();
    expect(cost.calls_by_model).toBeNull();
  });

  it('no longer hardcodes a model list anywhere in the source', () => {
    // Stripped: the comment above the function quotes the old hardcoded object
    // on purpose, and a scan that read it would be checking the explanation.
    const src = stripComments(
      readFileSync('src/services/founder/intelligence.ts', 'utf8'), { lineComments: true });
    expect(src, 'a named model with a zero beside it is an invented measurement')
      .not.toMatch(/claude-[a-z0-9-]+'?\s*:\s*0/);
  });

  it('does not print a model count on the page when there is nothing to count', () => {
    const page = stripComments(
      readFileSync('src/routes/dashboard/founder-ops.ts', 'utf8'), { lineComments: true });
    expect(page, 'the badge said 3 whatever had run')
      .not.toMatch(/metricBadge\('Models',\s*Object\.keys\([^)]*\)\.length\)/);
    expect(page).toContain('not recorded');
  });
});
