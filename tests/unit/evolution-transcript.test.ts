// =============================================================================
// Tests: Evolution real-session transcript (Phase 2.5)
// The evolution engine now reasons over actual agent_sessions rows instead of
// synthetic one-liners.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { query, executeRaw } from '../../src/db/client.js';
import { buildRecentSessionsTranscript } from '../../src/services/scp/evolution.js';

beforeAll(async () => {
  await executeRaw(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      agent_name TEXT,
      status TEXT,
      observations TEXT,
      actions_taken TEXT,
      pending_decisions TEXT,
      briefing_contribution TEXT,
      completed_at TEXT
    );
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
    `INSERT INTO agent_sessions (id, product_id, agent_name, status, observations, actions_taken, pending_decisions, briefing_contribution, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
