// =============================================================================
// Tests: V3.1 Layer A — Discipline (Freeze Periods + Proposals Queue)
// Verifies Ambros's freeze rules: blocks expansion, permits tightening,
// always permits founder corrections.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

import {
  startFreeze,
  endFreeze,
  endActiveFreeze,
  getActiveFreeze,
  listFreezeHistory,
  isBlocked,
  isEvolutionBlocked,
} from '../../src/services/discipline/freeze-periods.js';
import {
  queueProposal,
  listQueued,
  getProposal,
  listForFreeze,
  reviewProposal,
} from '../../src/services/discipline/proposals-queue.js';

// ─── Test Setup ──────────────────────────────────────────────────────────────

let founderId: string;
let productId: string;

async function createFounderAndProduct(): Promise<{ founderId: string; productId: string }> {
  const fId = nanoid();
  const pId = nanoid();
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, name, tier)
     VALUES (?, ?, ?, ?, ?)`,
    [fId, `clerk_${fId}`, `${fId}@test.local`, 'Test Founder', 'growth']
  );
  await query(
    `INSERT INTO products (id, name, owner_id) VALUES (?, ?, ?)`,
    [pId, 'Test Product', fId]
  );
  return { founderId: fId, productId: pId };
}


beforeAll(async () => {
  // The migrations are the schema. Tables this file used to write by hand are
  // already here, in the shape the product actually has — including the NOT
  // NULL columns and foreign keys a hand-written stand-in leaves out.
  await runMigrations();
});

beforeEach(async () => {
  const { founderId: fId, productId: pId } = await createFounderAndProduct();
  founderId = fId;
  productId = pId;
});

// ─── Freeze Lifecycle ─────────────────────────────────────────────────────────

describe('freeze_periods: lifecycle', () => {
  it('starts with no active freeze', async () => {
    expect(await getActiveFreeze(productId)).toBeNull();
  });

  it('startFreeze creates an active freeze with default scope', async () => {
    const fp = await startFreeze(productId, { reason: 'collect operational data' });
    expect(fp.scope).toBe('architecture_class');
    expect(fp.ended_at).toBeNull();
    expect(fp.expected_end_at).toBeTruthy();
    expect(await getActiveFreeze(productId)).not.toBeNull();
  });

  it('startFreeze respects custom scope and duration', async () => {
    const fp = await startFreeze(productId, {
      scope: 'all_evolution',
      duration_days: 30,
      reason: 'tight discipline',
    });
    expect(fp.scope).toBe('all_evolution');
  });

  it('refuses second freeze while one is already active', async () => {
    await startFreeze(productId, { reason: 'first' });
    await expect(
      startFreeze(productId, { reason: 'second' })
    ).rejects.toThrow(/already active/);
  });

  it('endActiveFreeze sets ended_at and ended_by', async () => {
    await startFreeze(productId, { reason: 'collect data' });
    const ended = await endActiveFreeze(productId, 'founder');
    expect(ended).toBe(true);
    expect(await getActiveFreeze(productId)).toBeNull();
    const history = await listFreezeHistory(productId);
    expect(history[0]!.ended_by).toBe('founder');
    expect(history[0]!.ended_at).toBeTruthy();
  });

  it('endActiveFreeze returns false when no freeze is active', async () => {
    expect(await endActiveFreeze(productId, 'founder')).toBe(false);
  });

  it('listFreezeHistory returns most-recent-first', async () => {
    const fp1 = await startFreeze(productId, { reason: 'first' });
    await endFreeze(fp1.id, 'founder');
    const fp2 = await startFreeze(productId, { reason: 'second' });
    await endFreeze(fp2.id, 'expired');
    const history = await listFreezeHistory(productId);
    expect(history).toHaveLength(2);
    expect(history[0]!.reason).toBe('second');
  });
});

// ─── isBlocked: scope semantics ───────────────────────────────────────────────

describe('isBlocked: no active freeze', () => {
  it('never blocks when no freeze is active', async () => {
    expect((await isBlocked(productId, 'schema_change')).blocked).toBe(false);
    expect((await isBlocked(productId, 'authority_expansion')).blocked).toBe(false);
    expect((await isBlocked(productId, 'agent_provision')).blocked).toBe(false);
  });
});

describe('isBlocked: architecture_class scope (default)', () => {
  beforeEach(async () => {
    await startFreeze(productId, { reason: 'discipline window' });
  });

  it.each([
    ['routine_operation'],
    ['tightening'],
    ['correction'],
  ] as const)('always allows %s', async (cat) => {
    const r = await isBlocked(productId, cat);
    expect(r.blocked).toBe(false);
  });

  it.each([
    ['authority_expansion'],
    ['prompt_refinement'],
    ['agent_provision'],
    ['schema_change'],
    ['cron_addition'],
    ['integration_addition'],
    ['architecture_decision'],
  ] as const)('blocks %s', async (cat) => {
    const r = await isBlocked(productId, cat);
    expect(r.blocked).toBe(true);
    expect(r.freeze).not.toBeNull();
  });
});

describe('isBlocked: process_only scope', () => {
  beforeEach(async () => {
    await startFreeze(productId, {
      scope: 'process_only',
      reason: 'narrow discipline',
    });
  });

  it('blocks cron_addition', async () => {
    expect((await isBlocked(productId, 'cron_addition')).blocked).toBe(true);
  });
  it('blocks integration_addition', async () => {
    expect((await isBlocked(productId, 'integration_addition')).blocked).toBe(true);
  });
  it('does NOT block schema_change under process_only', async () => {
    expect((await isBlocked(productId, 'schema_change')).blocked).toBe(false);
  });
  it('does NOT block authority_expansion under process_only', async () => {
    expect((await isBlocked(productId, 'authority_expansion')).blocked).toBe(false);
  });
});

// ─── isEvolutionBlocked: SCP change_type mapping ──────────────────────────────

describe('isEvolutionBlocked: SCP change_type mapping', () => {
  beforeEach(async () => {
    await startFreeze(productId, { reason: 'discipline window' });
  });

  it('allows golden_lesson during freeze', async () => {
    const r = await isEvolutionBlocked(productId, 'golden_lesson');
    expect(r.blocked).toBe(false);
    expect(r.mappedTo).toBe('tightening');
  });

  it('allows constraint_added during freeze', async () => {
    const r = await isEvolutionBlocked(productId, 'constraint_added');
    expect(r.blocked).toBe(false);
    expect(r.mappedTo).toBe('tightening');
  });

  it('always allows founder_correction', async () => {
    const r = await isEvolutionBlocked(productId, 'founder_correction');
    expect(r.blocked).toBe(false);
    expect(r.mappedTo).toBe('correction');
  });

  it('allows authority_change toward restriction', async () => {
    const r = await isEvolutionBlocked(productId, 'authority_change', {
      authorityDirection: 'restriction',
    });
    expect(r.blocked).toBe(false);
    expect(r.mappedTo).toBe('tightening');
  });

  it('blocks authority_change toward expansion', async () => {
    const r = await isEvolutionBlocked(productId, 'authority_change', {
      authorityDirection: 'expansion',
    });
    expect(r.blocked).toBe(true);
    expect(r.mappedTo).toBe('authority_expansion');
  });

  it('blocks prompt_refinement when not correction-linked', async () => {
    const r = await isEvolutionBlocked(productId, 'prompt_refinement');
    expect(r.blocked).toBe(true);
    expect(r.mappedTo).toBe('prompt_refinement');
  });

  it('allows prompt_refinement when correction-linked', async () => {
    const r = await isEvolutionBlocked(productId, 'prompt_refinement', {
      correctionLinked: true,
    });
    expect(r.blocked).toBe(false);
    expect(r.mappedTo).toBe('correction');
  });

  it('blocks initial_provision', async () => {
    const r = await isEvolutionBlocked(productId, 'initial_provision');
    expect(r.blocked).toBe(true);
    expect(r.mappedTo).toBe('agent_provision');
  });

  it('treats unknown change_type as architecture_decision (conservative)', async () => {
    const r = await isEvolutionBlocked(productId, 'unknown_future_type');
    expect(r.blocked).toBe(true);
    expect(r.mappedTo).toBe('architecture_decision');
  });
});

// ─── Phase Beta Proposals Queue ───────────────────────────────────────────────

describe('phase_beta_proposals: queue + review', () => {
  it('queues a proposal with all fields', async () => {
    const fp = await startFreeze(productId, { reason: 'window' });
    const p = await queueProposal(productId, {
      source_type: 'evolution',
      source_id: 'evo-123',
      proposed_change: 'expand atlas authority 2→1',
      proposed_by: 'atlas',
      rationale: 'high prediction accuracy',
      blocked_during_freeze_id: fp.id,
    });
    expect(p.status).toBe('queued');
    expect(p.proposed_change).toContain('atlas');
    expect(p.blocked_during_freeze_id).toBe(fp.id);
  });

  it('listQueued returns only queued proposals', async () => {
    const p1 = await queueProposal(productId, {
      source_type: 'decision',
      proposed_change: 'p1',
      proposed_by: 'system',
    });
    await queueProposal(productId, {
      source_type: 'decision',
      proposed_change: 'p2',
      proposed_by: 'system',
    });
    await reviewProposal(p1.id, 'rejected', 'founder', 'no');
    const queued = await listQueued(productId);
    expect(queued.map(p => p.proposed_change)).toEqual(['p2']);
  });

  it('listForFreeze returns proposals blocked during a specific freeze', async () => {
    const fp1 = await startFreeze(productId, { reason: 'first' });
    await queueProposal(productId, {
      source_type: 'decision',
      proposed_change: 'in fp1',
      proposed_by: 'system',
      blocked_during_freeze_id: fp1.id,
    });
    await endFreeze(fp1.id, 'founder');
    const fp2 = await startFreeze(productId, { reason: 'second' });
    await queueProposal(productId, {
      source_type: 'decision',
      proposed_change: 'in fp2',
      proposed_by: 'system',
      blocked_during_freeze_id: fp2.id,
    });
    const forFp1 = await listForFreeze(fp1.id);
    expect(forFp1.map(p => p.proposed_change)).toEqual(['in fp1']);
  });

  it('reviewProposal sets status, reviewer, notes', async () => {
    const p = await queueProposal(productId, {
      source_type: 'decision',
      proposed_change: 'a',
      proposed_by: 'system',
    });
    await reviewProposal(p.id, 'approved', 'thomas', 'looks good');
    const after = await getProposal(p.id);
    expect(after?.status).toBe('approved');
    expect(after?.reviewed_by).toBe('thomas');
    expect(after?.review_notes).toBe('looks good');
  });

  it('reviewProposal does not change non-queued proposals', async () => {
    const p = await queueProposal(productId, {
      source_type: 'decision',
      proposed_change: 'a',
      proposed_by: 'system',
    });
    await reviewProposal(p.id, 'approved', 'thomas');
    // Second review attempt — should be no-op since status is no longer 'queued'
    await reviewProposal(p.id, 'rejected', 'thomas', 'changed mind');
    const after = await getProposal(p.id);
    expect(after?.status).toBe('approved');
  });
});
