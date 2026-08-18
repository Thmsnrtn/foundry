// =============================================================================
// Tests: an automation rule that did nothing counted itself as having fired
//
// `EventRule.action_type` declared five actions:
//
//   'notify_coo' | 'create_stressor' | 'create_decision' | 'trigger_sync' | 'run_analysis'
//
// The switch implemented two. The other three fell to `default: break`, which
// returns normally — so a rule set to create a decision, trigger a sync or run
// an analysis did nothing at all, was listed in the event's
// `cascades_triggered` as having fired, and incremented `times_fired`, the one
// number a founder reads to decide whether their automation is working.
//
// A type that names capabilities the code does not have is not documentation
// of an intention; it is the thing that stops anybody noticing the gap.
//
// Two more in the same twenty lines:
//
//   • the catch read `/* Continue processing other rules */` and did exactly
//     that and nothing else, so a rule that threw was invisible everywhere —
//     not in the cascades, not in the count, not in any log. Other rules
//     should still run. Silence was the mistake.
//
//   • `evaluateCondition` returned TRUE when the condition failed to parse:
//     "if condition parsing fails, allow the rule to fire". The condition is
//     the entire reason a rule is not unconditional, so a malformed one turned
//     a narrow rule into one that fires on every matching event — including
//     rules whose action messages the founder.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const F = 'er_f';
const P = 'er_p';

vi.mock('../../src/services/chat/coo.js', () => ({
  sendProactiveMessage: vi.fn(async () => undefined),
}));

async function rule(actionType: string, condition: string | null = null): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO event_rules
       (id, product_id, owner_id, name, trigger_event_type, condition, action_type, action_config, active)
     VALUES (?, ?, ?, 'r', 'metric.spike', ?, ?, '{}', 1)`,
    [id, P, F, condition, actionType]);
  return id;
}

async function firedCount(id: string): Promise<number> {
  const row = (await query(
    'SELECT times_fired FROM event_rules WHERE id = ?', [id]))
    .rows[0] as Record<string, unknown> | undefined;
  return Number(row?.times_fired ?? 0);
}

const spike = {
  source: 'test', event_type: 'metric.spike',
  severity: 'info' as const, payload: { value: 1 },
};

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'clerk_er', 'er@test.local']);
  await query(`INSERT INTO products (id, name, owner_id) VALUES (?,'Rules Co',?)`, [P, F]);
});

beforeEach(async () => {
  await query('DELETE FROM event_rules');
  await query('DELETE FROM event_stream');
  await query('DELETE FROM stressor_history');
});

describe('a rule only counts as fired if its action ran', () => {
  it('carries out an implemented action and counts it', async () => {
    const { ingestEvent } = await import('../../src/services/events/bus.js');
    const id = await rule('create_stressor');
    const result = await ingestEvent(P, spike);

    expect(result.cascades_triggered).toContain(`rule:${id}:create_stressor`);
    expect(await firedCount(id)).toBe(1);
    const stressors = await query(
      'SELECT COUNT(*) AS n FROM stressor_history WHERE product_id = ?', [P]);
    expect(Number((stressors.rows[0] as Record<string, unknown>).n),
      'and the thing it says it did, it did').toBe(1);
  });

  it('does not count an action type nothing implements', async () => {
    // Written straight into the table, because createEventRule now refuses it
    // — but rows like this already exist wherever one was created before.
    const { ingestEvent } = await import('../../src/services/events/bus.js');
    const id = await rule('run_analysis');
    const result = await ingestEvent(P, spike);

    expect(await firedCount(id),
      'times_fired is the number a founder trusts').toBe(0);
    expect(result.cascades_triggered,
      'and it is not listed as something the event caused')
      .not.toContain(`rule:${id}:run_analysis`);
    expect(result.cascades_triggered.some((c) => c.includes('unsupported_action')),
      'it is listed as something that did not happen, rather than omitted')
      .toBe(true);
  });

  it('refuses to create a rule whose action has no implementation', async () => {
    const { createEventRule } = await import('../../src/services/events/bus.js');
    await expect(createEventRule(P, F, {
      name: 'r', trigger_event_type: 'metric.spike',
      action_type: 'run_analysis' as never, action_config: {},
    })).rejects.toThrow(/unsupported rule action/);
  });

  it('creates one whose action exists', async () => {
    const { createEventRule } = await import('../../src/services/events/bus.js');
    const id = await createEventRule(P, F, {
      name: 'r', trigger_event_type: 'metric.spike',
      action_type: 'notify_coo', action_config: {},
    });
    expect(id).toBeTruthy();
  });
});

describe('a condition that cannot be read narrows to nothing', () => {
  it('does not fire a rule whose condition is malformed', async () => {
    // Fail closed. Returning true here turned a narrow rule into one that
    // fires on every matching event, and two of the five actions reach the
    // founder directly.
    const { ingestEvent } = await import('../../src/services/events/bus.js');
    const id = await rule('create_stressor', '{not json at all');
    await ingestEvent(P, spike);

    expect(await firedCount(id),
      'a broken condition must not remove the narrowing it exists to provide')
      .toBe(0);
    const stressors = await query(
      'SELECT COUNT(*) AS n FROM stressor_history WHERE product_id = ?', [P]);
    expect(Number((stressors.rows[0] as Record<string, unknown>).n)).toBe(0);
  });

  it('fires when a well-formed condition matches', async () => {
    const { ingestEvent } = await import('../../src/services/events/bus.js');
    const id = await rule('create_stressor', JSON.stringify({ value: 1 }));
    await ingestEvent(P, spike);
    expect(await firedCount(id)).toBe(1);
  });

  it('does not fire when a well-formed condition does not match', async () => {
    const { ingestEvent } = await import('../../src/services/events/bus.js');
    const id = await rule('create_stressor', JSON.stringify({ value: 999 }));
    await ingestEvent(P, spike);
    expect(await firedCount(id)).toBe(0);
  });
});
