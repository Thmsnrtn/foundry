// =============================================================================
// Tests: Evolution real-session transcript (Phase 2.5)
// The evolution engine now reasons over actual agent_sessions rows instead of
// synthetic one-liners.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { query, executeRaw } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { buildRecentSessionsTranscript } from '../../src/services/scp/evolution.js';

beforeAll(async () => {
  // The migrations are the schema. Anything this file used to create by hand
  // is already here, in the shape the product actually has — a fixture that
  // disagrees with the schema proves nothing about the product.
  await runMigrations();
  // The real schema has foreign keys. The hand-written stand-in did not, so a
  // session could name a company that does not exist and nothing objected.
  await query(
    `INSERT OR IGNORE INTO founders (id, clerk_user_id, email) VALUES ('f1','clerk_f1','f1@test.local')`);
  for (const p of ['p1', 'p2']) {
    await query(`INSERT OR IGNORE INTO products (id, name, owner_id) VALUES (?, ?, 'f1')`,
      [p, `Company ${p}`]);
  }
  await executeRaw(`
  `);
});

beforeEach(async () => {
  await executeRaw('DELETE FROM agent_sessions');
});

async function insertSession(id: string, opts: Partial<{
  product_id: string; agent_name: string; status: string;
  observations: string; actions_taken: string; pending_decisions: string;
  briefing_contribution: string; completed_at: string;
}>): Promise<void> {
  await query(
    `INSERT INTO agent_sessions (id, product_id, agent_name, agent_version, status, observations, actions_taken, pending_decisions, briefing_contribution, completed_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    [
      id, opts.product_id ?? 'p1', opts.agent_name ?? 'atlas', opts.status ?? 'completed',
      opts.observations ?? '[]', opts.actions_taken ?? '[]', opts.pending_decisions ?? '[]',
      opts.briefing_contribution ?? null, opts.completed_at ?? '2026-07-01T00:00:00Z',
    ],
  );
}

describe('buildRecentSessionsTranscript', () => {
  it('formats observations, actions, and object-valued decisions from a session', async () => {
    await insertSession('s1', {
      observations: JSON.stringify(['Churn rising in SMB cohort']),
      actions_taken: JSON.stringify(['Flagged to Harbor']),
      pending_decisions: JSON.stringify([{ title: 'Cut SMB ad spend', gate: 2 }]),
      briefing_contribution: 'SMB churn is the week\'s top risk.',
    });
    const out = await buildRecentSessionsTranscript('p1', 'atlas', 5, 's1');
    expect(out).toContain('Churn rising in SMB cohort');
    expect(out).toContain('Flagged to Harbor');
    expect(out).toContain('Cut SMB ad spend');       // object decision serialized
    expect(out).toContain('SMB churn is the week');
  });

  it('returns empty string when there are no matching sessions', async () => {
    expect(await buildRecentSessionsTranscript('nope', 'atlas', 5)).toBe('');
  });

  it('only includes completed sessions for the given product+agent', async () => {
    await insertSession('done', { observations: JSON.stringify(['visible']), status: 'completed' });
    await insertSession('running', { observations: JSON.stringify(['hidden']), status: 'running' });
    await insertSession('other', { agent_name: 'forge', observations: JSON.stringify(['elsewhere']) });
    const out = await buildRecentSessionsTranscript('p1', 'atlas', 5);
    expect(out).toContain('visible');
    expect(out).not.toContain('hidden');
    expect(out).not.toContain('elsewhere');
  });
});
