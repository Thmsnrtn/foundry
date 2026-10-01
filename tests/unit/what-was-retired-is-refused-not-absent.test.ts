process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '3'.repeat(64);

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { JOB_REGISTRY, RETIRED_LOOPS, retiredLoopRefusal } from '../../src/jobs/index.js';

// =============================================================================
// WHAT WAS RETIRED IS REFUSED, NOT ABSENT (Roadmap 2027 R4 and R9, 1 October
// 2026; PENDING 16, decided by the owner on 30 September: "Retire them").
//
// Twelve agents across three companies ran for a fortnight under twenty-seven
// scheduled loops: ninety sessions, eleven proposals, none ever approved, and
// nothing the owner could open read any of it. Their schedules stopped first,
// with the code kept while the owner decided. The owner decided, and the code
// is gone: the agents, their loops, every module only those loops reached, the
// public API that served their briefings, the boot-time provisioner, two jobs
// that measured them, and thirty-six tables nothing could touch afterwards,
// every row of which is kept in `retired_rows`.
//
// "Gone" is not "never existed". A retired loop's name is refused with what it
// was, so nobody re-creates one believing it was never there, and no name is
// both retired and scheduled.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const DROPPED = [
  'agent_accuracy_scores', 'agent_config_history', 'agent_configs', 'agent_cost_log',
  'agent_evolution_versions', 'agent_initiative_queue', 'agent_predictions', 'agent_remediations',
  'agent_scratchpad', 'agent_sessions', 'competitor_profiles', 'debate_sessions', 'decision_outcomes',
  'evolved_prompts', 'execution_playbooks', 'failure_patterns', 'founder_behavioral_signals',
  'founder_state_assessments', 'freeze_periods', 'golden_suite', 'integration_sync_log',
  'intelligence_benchmarks', 'lifecycle_rule_triggers', 'outbound_rate_limits', 'outcome_trees',
  'pattern_matches', 'phase_beta_proposals', 'playbook_trigger_log', 'priority_actions',
  'revenue_attributions', 'scp_briefings', 'scp_constitutions', 'strategic_syntheses',
  'team_health_metrics', 'weekly_compressed_briefs', 'wisdom_patterns',
];

describe('a retired loop is refused by name', () => {
  it('lists every loop that was retired, each with what it did', () => {
    // The twenty-six society loops (scp_benchmark_refresh went earlier, in
    // Private S7), the two weekly jobs that measured the society (R9), and
    // R10's five: the four department sweeps and action_verify_sweep, deleted
    // in Roadmap 2027 R10 with the last legacy executor, and R11's eight: the
    // jobs whose model output nothing read, deleted in Roadmap 2027 R11.
    expect(Object.keys(RETIRED_LOOPS)).toHaveLength(41);
    for (const [name, was] of Object.entries(RETIRED_LOOPS)) {
      expect(was.length, name).toBeGreaterThan(10);
    }
    expect(RETIRED_LOOPS).toHaveProperty('team_health_aggregate');
    expect(RETIRED_LOOPS).toHaveProperty('outcome_tree_health');
  });

  it('never lists a name as both retired and scheduled', () => {
    for (const name of Object.keys(RETIRED_LOOPS)) expect(JOB_REGISTRY).not.toHaveProperty(name);
    const scheduled = Object.keys(JOB_REGISTRY).filter((k) => k.startsWith('scp_')).sort();
    // Two remain, and neither is cognition: one expires overdue rows in
    // `decisions`, which the Decisions door reads; one deletes webhook delivery
    // records over thirty days old.
    expect(scheduled).toEqual(['scp_expire_overdue_decisions', 'scp_webhook_delivery_cleanup']);
  });

  it('answers a retired name with what it was, and only a retired name', () => {
    expect(retiredLoopRefusal('scp_agent_runner')).toMatch(/retired by the owner's decision of 30 September 2026/);
    expect(retiredLoopRefusal('scp_agent_runner')).toContain(RETIRED_LOOPS.scp_agent_runner);
    expect(retiredLoopRefusal('the_week')).toBeNull();
    expect(retiredLoopRefusal('no_such_job')).toBeNull();
  });

  it('is asked before the registry, so job:run refuses rather than calling it unknown', () => {
    const cli = read('src/cli/index.ts');
    const refusal = cli.indexOf('retiredLoopRefusal(name)');
    const lookup = cli.indexOf('JOB_REGISTRY[name]');
    expect(refusal).toBeGreaterThan(0);
    expect(lookup).toBeGreaterThan(refusal);
  });
});

describe('the code is gone', () => {
  it('has no agents, no dispatcher to them, and no legacy outbound executor', () => {
    expect(existsSync(join(ROOT, 'src/services/scp/agents'))).toBe(false);
    for (const gone of [
      'src/services/scp/events/dispatcher.ts', 'src/services/scp/provisioner.ts', 'src/services/scp/scheduler.ts',
      'src/services/outbound/executor.ts', 'src/api/v1/agents.ts', 'src/api/v1/briefings.ts',
      'src/services/financial/economics.ts', 'src/services/scp/actions/executor.ts',
    ]) expect(existsSync(join(ROOT, gone)), gone).toBe(false);
    // What is left of the old SCP tree is not the society: the runway forecast
    // and shared types. The department sweeps' execute path went in R10.
    const left = readdirSync(join(ROOT, 'src/services/scp'), { recursive: true }).map(String).filter((f) => f.endsWith('.ts')).sort();
    expect(left).toEqual(['forecasting/runway.ts', 'types.ts']);
  });

  it('starts nothing for the society at boot, and serves nothing of it on the API', () => {
    expect(read('src/index.ts')).not.toMatch(/scp\/provisioner|ensureProvisioned/);
    const api = read('src/api/v1/index.ts');
    expect(api).not.toMatch(/agentsApi|briefingsApi/);
  });

  it('keeps the one door into discovery, without the agent routing it once carried', () => {
    const signals = read('src/services/institution/signals.ts');
    expect(signals).toContain('export async function emitSignalEvent(');
    expect(signals).not.toMatch(/relevant_agents_json|import\(`\.\.\/agents/);
    expect(read('src/services/founder/company-report.ts')).toContain("from '../institution/signals.js'");
  });
});

describe('the tables are gone, and every row is kept', () => {
  beforeAll(async () => { await runMigrations(); });

  it('drops each table nothing could touch', async () => {
    const present = (await query(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${DROPPED.map(() => '?').join(',')})`, DROPPED)).rows;
    expect(present).toEqual([]);
  });

  it('copies each into retired_rows before dropping it', () => {
    const migration = read('src/db/migrations/375_what_the_society_left_behind.sql');
    for (const t of DROPPED) {
      const copied = migration.indexOf(`SELECT '${t}', `);
      const dropped = migration.indexOf(`DROP TABLE IF EXISTS ${t};`);
      expect(copied, t).toBeGreaterThan(0);
      expect(dropped, t).toBeGreaterThan(copied);
      expect(migration.slice(copied, dropped)).toContain(`FROM ${t};`);
    }
  });

  it('keeps a retired row as it was', async () => {
    await query(`INSERT INTO retired_rows (table_name, product_id, row_json) VALUES ('agent_sessions', 'p_x', '{}')`);
    await expect(query(`UPDATE retired_rows SET row_json = '{"x":1}' WHERE table_name = 'agent_sessions'`))
      .rejects.toThrow(/kept as they were/);
  });
});

describe('the reason is written down beside the names', () => {
  const jobs = read('src/jobs/index.ts');
  const note = jobs.slice(jobs.indexOf('THE SOCIETY IS NO LONGER ON A TIMER'), jobs.indexOf('export const RETIRED_LOOPS'));

  it('says what the fortnight actually produced', () => {
    expect(note).toMatch(/ninety sessions/i);
    expect(note.replace(/\n\s*\/\/\s*/g, ' ')).toMatch(/eleven proposals/i);
    expect(note).toMatch(/approved_at. is null/i);
    expect(note).toMatch(/nothing the owner can see depends/i);
  });

  it('says who decided, and where the code before it is', () => {
    expect(note).toMatch(/PENDING 16, "Retire them"/);
    expect(note).toContain('1864d6dc');
    expect(note).toContain('scp_expire_overdue_decisions');
    expect(note).toContain('scp_webhook_delivery_cleanup');
  });

  it('records the decision where the owner asked it', () => {
    expect(read('docs/foundry-institution/OWNER_DECISIONS_PENDING.md'))
      .toMatch(/## PENDING 16 — [^\n]*\*\*DECIDED 2026-09-30\*\*\n\n\*\*The owner decided it: "Retire them\."\*\*/);
  });
});
