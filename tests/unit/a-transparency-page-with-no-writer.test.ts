process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getAgentCostSummary, getRecentRuns, getAgentRunHistory, getRunDetails,
  getAgentCurrentHealth,
} from '../../src/services/scp/transparency/run-history.js';

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
// drops the empty table and these reads go where the rows are.
// =============================================================================

const P = 'p_tr';
const OTHER = 'p_other';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_tr','c_tr','tr@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_tr','active')", [P]);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Rival','f_tr','active')", [OTHER]);
});

beforeEach(async () => {
  await query('DELETE FROM agent_sessions');
  await query('DELETE FROM agent_instances');
});

async function session(opts: {
  id: string; product?: string; agent?: string; status?: string;
  cost?: number; tokens?: number; started?: string; completed?: string | null;
  observations?: string[]; actions?: unknown[]; decisions?: unknown[];
  headline?: string; error?: string | null;
}) {
  await query(
    `INSERT INTO agent_sessions
       (id, product_id, agent_name, agent_version, status, observations,
        actions_taken, pending_decisions, briefing_contribution, tokens_used,
        cost_usd, error_message, started_at, completed_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id, opts.product ?? P, opts.agent ?? 'compass', opts.status ?? 'completed',
      JSON.stringify(opts.observations ?? []), JSON.stringify(opts.actions ?? []),
      JSON.stringify(opts.decisions ?? []), opts.headline ?? null,
      opts.tokens ?? 0, opts.cost ?? 0, opts.error ?? null,
      opts.started ?? '2026-08-01 09:00:00',
      opts.completed === undefined ? '2026-08-01 09:00:12' : opts.completed,
    ],
  );
}

describe('the cost summary', () => {
  it('reports the runs that were actually recorded', async () => {
    await session({ id: 's1', cost: 0.02, tokens: 4000 });
    await session({ id: 's2', cost: 0.04, tokens: 6000 });

    const [row] = await getAgentCostSummary(P, 3650);
    expect(row.agent_name).toBe('compass');
    expect(row.total_runs).toBe(2);
    expect(row.total_cost_usd).toBeCloseTo(0.06, 6);
    expect(row.total_tokens).toBe(10_000);
    expect(row.avg_latency_ms).toBe(12_000);
  });

  it('averages cost over completed runs, not over runs that recorded none', async () => {
    // `base.ts` records a failure without a cost, so a failed run holds the 0
    // default. Dividing by every run mixed a real numerator with a denominator
    // that includes runs which recorded nothing.
    await session({ id: 's1', cost: 0.06 });
    await session({ id: 's2', status: 'failed', cost: 0, error: 'model unavailable' });

    const [row] = await getAgentCostSummary(P, 3650);
    expect(row.total_runs).toBe(2);
    expect(row.completed_runs).toBe(1);
    expect(row.avg_cost_per_completed_run).toBeCloseTo(0.06, 6);
    expect(row.avg_cost_per_completed_run).not.toBeCloseTo(0.03, 6);
  });

  it('says not-measured rather than zero when nothing completed', async () => {
    await session({ id: 's1', status: 'failed', cost: 0 });
    const [row] = await getAgentCostSummary(P, 3650);
    expect(row.completed_runs).toBe(0);
    expect(row.avg_cost_per_completed_run).toBeNull();
  });

  it('honours the window', async () => {
    await session({ id: 'old', started: '2020-01-01 09:00:00', completed: '2020-01-01 09:00:05' });
    expect(await getAgentCostSummary(P, 30)).toHaveLength(0);
    expect(await getAgentCostSummary(P, 3650)).toHaveLength(1);
  });

  it('does not count another company’s runs', async () => {
    await session({ id: 's1', cost: 0.02 });
    await session({ id: 's2', product: OTHER, cost: 9.99 });
    const [row] = await getAgentCostSummary(P, 3650);
    expect(row.total_runs).toBe(1);
    expect(row.total_cost_usd).toBeCloseTo(0.02, 6);
  });
});

describe('the run lists', () => {
  it('count decisions and actions from what the run stored', async () => {
    await session({
      id: 's1', headline: 'Compass reviewed positioning.',
      actions: [{ a: 1 }, { a: 2 }, { a: 3 }], decisions: [{ d: 1 }],
    });
    const [run] = await getRecentRuns(P);
    expect(run.headline).toBe('Compass reviewed positioning.');
    expect(run.actions_count).toBe(3);
    expect(run.decisions_count).toBe(1);
    expect(run.latency_ms).toBe(12_000);
  });

  it('leave latency unmeasured while a run is still going', async () => {
    await session({ id: 's1', status: 'running', completed: null });
    const [run] = await getRecentRuns(P);
    expect(run.latency_ms).toBeNull();
  });

  it('are newest first, with insertion order breaking a tie', async () => {
    await session({ id: 'a', started: '2026-08-01 09:00:00' });
    await session({ id: 'b', started: '2026-08-01 09:00:00' });
    await session({ id: 'c', started: '2026-08-02 09:00:00' });
    expect((await getRecentRuns(P)).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('separate one agent’s history from another’s', async () => {
    await session({ id: 's1', agent: 'compass' });
    await session({ id: 's2', agent: 'sentinel' });
    const history = await getAgentRunHistory(P, 'compass');
    expect(history.map((r) => r.id)).toEqual(['s1']);
  });
});

describe('the run detail', () => {
  it('returns the observations the run recorded', async () => {
    await session({
      id: 's1', observations: ['Churn rose in the SMB cohort.', 'Two integrations went stale.'],
    });
    const detail = await getRunDetails(P, 's1');
    expect(detail?.observations).toEqual([
      'Churn rose in the SMB cohort.', 'Two integrations went stale.',
    ]);
  });

  it('cannot be opened by another company holding the id', async () => {
    // The read took a run id alone: `SELECT * FROM agent_run_details WHERE id=?`.
    // A founder with an id could open another company's run, prompt previews
    // included. Unexploitable only because the table was never written to.
    await session({ id: 's_secret', product: OTHER, observations: ['Rival internals.'] });
    expect(await getRunDetails(P, 's_secret')).toBeNull();
    expect(await getRunDetails(OTHER, 's_secret')).not.toBeNull();
  });

  it('survives a row whose JSON columns are not arrays', async () => {
    await query(
      `INSERT INTO agent_sessions (id, product_id, agent_name, agent_version, status,
         observations, actions_taken, pending_decisions, started_at)
       VALUES ('s_bad', ?, 'compass', 1, 'completed', 'not json', '{}', NULL, '2026-08-01 09:00:00')`,
      [P],
    );
    const detail = await getRunDetails(P, 's_bad');
    expect(detail?.observations).toEqual([]);
    expect(detail?.actions_count).toBe(0);
    expect(detail?.decisions_count).toBe(0);
  });
});

describe('domain health', () => {
  it('is the agent’s current score, and null when it has not scored', async () => {
    await query(
      `INSERT INTO agent_instances (id, product_id, agent_name, display_name, version,
         authority_level, activation_cadence_hours, status, domain_health_score)
       VALUES ('ai_1', ?, 'compass', 'Compass', 1, 1, 24, 'active', 72)`,
      [P],
    );
    await query(
      `INSERT INTO agent_instances (id, product_id, agent_name, display_name, version,
         authority_level, activation_cadence_hours, status, domain_health_score)
       VALUES ('ai_2', ?, 'sentinel', 'Sentinel', 1, 1, 24, 'active', NULL)`,
      [P],
    );
    expect(await getAgentCurrentHealth(P, 'compass')).toBe(72);
    expect(await getAgentCurrentHealth(P, 'sentinel')).toBeNull();
    expect(await getAgentCurrentHealth(P, 'harbor')).toBeNull();
  });
});

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
