process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { proposeAction } from '../../src/services/outbound/executor.js';

// =============================================================================
// AN AGENT THAT GRANTED ITSELF PERMISSION.
//
// Every agent prompt asks the model for `"authority_level": 0 | 1 | 2` and none
// of them says what the numbers mean. The answer was passed straight through:
// agent → `proposeAction` → a branch that treats 0 as "execute immediately".
// Nothing on the way read the level the FOUNDER set on `agent_instances`, so a
// model's uninstructed number decided whether a real outward action needed a
// person. Atlas ships at 2, commented "Code changes always need approval".
//
// The second half is what the record then said. `executeAction` switches on
// `integration_name`, and agent-originated actions carry the agent's name
// there — never 'resend' — so every one of them fell to a default branch that
// set status 'executed' and returned success while its own stored message read
// "no executor registered yet". The founder's inbox, the actions page and the
// Letter all read `status`.
// =============================================================================

const OWNER = 'f_auth';
const P = 'p_auth';

beforeAll(async () => { await runMigrations(); });

beforeEach(async () => {
  await query('DELETE FROM outbound_actions');
  await query('DELETE FROM agent_instances');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [OWNER, 'c_auth', 'auth@example.com']);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
    [P, 'Acme', OWNER, 'active']);
});

async function configureAgent(name: string, level: number): Promise<void> {
  await query(
    `INSERT INTO agent_instances (id, product_id, agent_name, display_name, status, authority_level)
     VALUES (?, ?, ?, ?, 'active', ?)`,
    [`ai_${name}`, P, name, name, level]);
}

function propose(agentName: string, authorityLevel: 0 | 1 | 2) {
  return proposeAction({
    productId: P,
    agentName,
    integrationName: agentName, // what base.ts passes: the agent, not a provider
    actionType: 'architecture_proposal',
    authorityLevel,
    parameters: { title: 'refactor the billing module' },
    rationale: 'r',
    previewText: 'p',
  });
}

describe('a proposal cannot lower the authority its founder set', () => {
  it('does not execute a level-0 proposal from an agent configured at 2', async () => {
    await configureAgent('atlas', 2);

    const res = await propose('atlas', 0);

    const row = (await query(
      'SELECT status, authority_level FROM outbound_actions WHERE id = ?', [res.action_id]
    )).rows[0] as Record<string, unknown>;

    // The stored level is the binding one, not the proposed one — otherwise the
    // row would still tell every later reader that 0 was authorised.
    expect(Number(row.authority_level),
      'the founder set 2; a model asking for 0 must not overwrite it').toBe(2);
    expect(String(row.status),
      'a level-0 proposal from a level-2 agent must wait for a person').toBe('pending_approval');
    expect(res.status).not.toBe('executed');
  });

  it('lets a proposal be more cautious than its configuration, never less', async () => {
    await configureAgent('oracle', 0); // configured fully autonomous

    const res = await propose('oracle', 2);

    const row = (await query(
      'SELECT status, authority_level FROM outbound_actions WHERE id = ?', [res.action_id]
    )).rows[0] as Record<string, unknown>;
    expect(Number(row.authority_level),
      'a model that asks for a person is allowed to be right').toBe(2);
    expect(String(row.status)).toBe('pending_approval');
  });

  it('treats a name with no instance row as unknown, not as permitted', async () => {
    // No configureAgent call: nothing on this product has granted this name
    // anything. Absence of a grant is a reason to ask, not a reason to proceed.
    const res = await propose('beacon', 0);

    const row = (await query(
      'SELECT status, authority_level FROM outbound_actions WHERE id = ?', [res.action_id]
    )).rows[0] as Record<string, unknown>;
    expect(Number(row.authority_level)).toBe(2);
    expect(String(row.status)).toBe('pending_approval');
  });
});

describe('an action nothing executed is not recorded as executed', () => {
  it('refuses rather than claiming success when no executor is registered', async () => {
    // Configured 0, so this takes the immediate-execution branch and reaches
    // the dispatch. There is no executor for integration_name 'oracle'.
    await configureAgent('oracle', 0);

    const res = await propose('oracle', 0);

    const row = (await query(
      'SELECT status, result_json, executed_at FROM outbound_actions WHERE id = ?', [res.action_id]
    )).rows[0] as Record<string, unknown>;

    expect(String(row.status),
      'nothing carried this out, so the row must not say it was executed').toBe('failed');
    expect(row.executed_at,
      'an executed_at timestamp for an execution that did not happen').toBeNull();
    expect(String(row.result_json)).toContain('No executor registered');
    expect(res.status).toBe('failed');
  });
});
