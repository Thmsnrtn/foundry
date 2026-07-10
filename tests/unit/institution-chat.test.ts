// =============================================================================
// Tests: institution chat (Trust Plane phase 3) — conversation IS capture
// A stated decision lands in the ledger with its premise monitored; a question
// captures nothing; the model sees the real ledgers in context; threads persist.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

import { describe, it, expect, beforeAll, vi } from 'vitest';

let lastUserPrompt = '';
let nextResponse: Record<string, unknown> = { reply: 'ok', capture: null };
vi.mock('../../src/services/ai/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/ai/client.js')>();
  return {
    ...actual,
    callSonnet: vi.fn(async (_sys: string, userPrompt: string) => {
      lastUserPrompt = userPrompt;
      return {
        content: JSON.stringify(nextResponse),
        model: 'sonnet',
        usage: { input_tokens: 200, output_tokens: 150 },
      };
    }),
  };
});

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { handleUtterance } from '../../src/services/chat/institution.js';

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('ic_f','clk_ic','i@t.co')", []);
  await query("INSERT INTO products (id, name, owner_id) VALUES ('ic_p','ChatCo','ic_f')", []);
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, recommendation, status)
     VALUES ('ic_d1', 'ic_p', 'marketing', 2, 'Launch newsletter', 'reach', 'Do it monthly', 'pending')`,
    [],
  );
});

describe('institution chat', () => {
  it('a stated decision is captured into the ledger with its premise monitored', async () => {
    nextResponse = {
      reply: 'Recorded. I will watch churn against 5%.',
      capture: {
        kind: 'decision', title: 'Raise prices to $99',
        decision: 'Raise Solo to $99 next month', rationale: 'margin',
        premise: 'churn stays under 5%', premise_metric: 'churn_rate',
        premise_comparator: '<', premise_threshold: 0.05,
      },
    };
    const turn = await handleUtterance('ic_p', 'ic_f', "We're raising prices — churn has been fine");
    expect(turn.captured?.kind).toBe('decision');
    expect(turn.captured?.premiseRecorded).toBe(true);

    const d = await query("SELECT decision_title FROM strategic_decisions_log WHERE id = ?", [turn.captured!.decisionId]);
    expect((d.rows[0] as Record<string, unknown>).decision_title).toBe('Raise prices to $99');
    const p = await query("SELECT metric_key, status FROM decision_premises WHERE decision_id = ?", [turn.captured!.decisionId]);
    expect((p.rows[0] as Record<string, unknown>).metric_key).toBe('churn_rate');
    expect((p.rows[0] as Record<string, unknown>).status).toBe('holding');
  });

  it('the model sees the real ledgers: pending decisions + recommendation in context', async () => {
    nextResponse = { reply: 'You have a gate-2 marketing decision pending.', capture: null };
    await handleUtterance('ic_p', 'ic_f', 'What needs my attention?');
    expect(lastUserPrompt).toContain('Launch newsletter');
    expect(lastUserPrompt).toContain('Do it monthly');
    expect(lastUserPrompt).toContain('BELIEF LEDGER');
  });

  it('a question captures nothing', async () => {
    nextResponse = { reply: 'Churn is 4% on the latest snapshot.', capture: null };
    const before = await query("SELECT COUNT(*) AS n FROM strategic_decisions_log WHERE product_id='ic_p'", []);
    const turn = await handleUtterance('ic_p', 'ic_f', 'How is churn trending?');
    expect(turn.captured).toBeNull();
    const after = await query("SELECT COUNT(*) AS n FROM strategic_decisions_log WHERE product_id='ic_p'", []);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('threads persist and accumulate both sides of the conversation', async () => {
    nextResponse = { reply: 'first', capture: null };
    const t1 = await handleUtterance('ic_p', 'ic_f', 'hello');
    nextResponse = { reply: 'second', capture: null };
    const t2 = await handleUtterance('ic_p', 'ic_f', 'again', t1.threadId);
    expect(t2.threadId).toBe(t1.threadId);
    const msgs = await query('SELECT role FROM conversation_messages WHERE thread_id = ?', [t1.threadId]);
    expect(msgs.rows.length).toBe(4); // 2 user + 2 assistant
    // And the second call's context carried the first exchange.
    expect(lastUserPrompt).toContain('hello');
  });

  it('a belief (not a decision) still lands as a monitored ledger entry', async () => {
    nextResponse = {
      reply: 'Noted — I will hold you to that.',
      capture: { kind: 'belief', title: 'Users will not pay more', premise: 'nps stays above 40', premise_metric: 'nps_score', premise_comparator: '>', premise_threshold: 40 },
    };
    const turn = await handleUtterance('ic_p', 'ic_f', 'Honestly I think our users just will not pay more');
    expect(turn.captured?.kind).toBe('belief');
    const d = await query('SELECT decision_title FROM strategic_decisions_log WHERE id = ?', [turn.captured!.decisionId]);
    expect(String((d.rows[0] as Record<string, unknown>).decision_title)).toContain('Belief:');
  });
});
