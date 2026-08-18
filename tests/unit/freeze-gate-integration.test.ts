// =============================================================================
// Tests: V3.1 Layer A — Freeze gate wired into SCP evolution + provisioner
// Verifies the classifier mapping and the gate's queue-on-block behavior.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

import { classifyEvolutionChange } from '../../src/services/scp/evolution.js';
import {
  startFreeze,
  isBlocked,
} from '../../src/services/discipline/freeze-periods.js';
import {
  queueProposal,
  listQueued,
} from '../../src/services/discipline/proposals-queue.js';

// ─── Setup ────────────────────────────────────────────────────────────────────

let productId: string;


beforeAll(async () => {
  // The migrations are the schema. Tables this file used to write by hand are
  // already here, in the shape the product actually has — including the NOT
  // NULL columns and foreign keys a hand-written stand-in leaves out.
  await runMigrations();
});

beforeEach(async () => {
  const fId = nanoid();
  productId = nanoid();
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, tier) VALUES (?, ?, ?, ?)`,
    [fId, `clerk_${fId}`, `${fId}@test.local`, 'growth']
  );
  await query(
    `INSERT INTO products (id, name, owner_id) VALUES (?, ?, ?)`,
    [productId, 'Test', fId]
  );
});

// ─── classifyEvolutionChange ──────────────────────────────────────────────────

describe('classifyEvolutionChange: freeze category mapping', () => {
  it('founder corrections always map to correction', () => {
    expect(classifyEvolutionChange('system_prompt', true)).toBe('correction');
    expect(classifyEvolutionChange('behavioral_constraints', true)).toBe('correction');
    expect(classifyEvolutionChange('domain_context', true)).toBe('correction');
  });

  it('behavioral_constraints maps to tightening', () => {
    expect(classifyEvolutionChange('behavioral_constraints', false)).toBe('tightening');
  });

  it('every other configType maps to prompt_refinement', () => {
    expect(classifyEvolutionChange('system_prompt', false)).toBe('prompt_refinement');
    expect(classifyEvolutionChange('system_prompt_core', false)).toBe('prompt_refinement');
    expect(classifyEvolutionChange('domain_context', false)).toBe('prompt_refinement');
    expect(classifyEvolutionChange('decision_framework', false)).toBe('prompt_refinement');
    expect(classifyEvolutionChange('any_future_type', false)).toBe('prompt_refinement');
  });
});

// ─── Integration: classifier + freeze + queue ─────────────────────────────────

describe('freeze gate end-to-end: classify → check → queue', () => {
  it('does not block when no freeze is active (any category)', async () => {
    const cat = classifyEvolutionChange('system_prompt', false);
    const r = await isBlocked(productId, cat);
    expect(r.blocked).toBe(false);
  });

  it('blocks prompt_refinement when freeze is active', async () => {
    await startFreeze(productId, { reason: 'discipline window' });
    const cat = classifyEvolutionChange('system_prompt', false);
    const r = await isBlocked(productId, cat);
    expect(r.blocked).toBe(true);
    expect(r.freeze).not.toBeNull();
  });

  it('does not block tightening even during freeze', async () => {
    await startFreeze(productId, { reason: 'discipline window' });
    const cat = classifyEvolutionChange('behavioral_constraints', false);
    const r = await isBlocked(productId, cat);
    expect(r.blocked).toBe(false);
  });

  it('does not block founder corrections even during freeze', async () => {
    await startFreeze(productId, { reason: 'discipline window' });
    const cat = classifyEvolutionChange('system_prompt', true); // isCorrection=true
    const r = await isBlocked(productId, cat);
    expect(r.blocked).toBe(false);
  });

  it('queues a proposal when blocked, with correct linkage', async () => {
    const fp = await startFreeze(productId, { reason: 'window' });
    const cat = classifyEvolutionChange('system_prompt', false);
    const { blocked, freeze } = await isBlocked(productId, cat);
    expect(blocked).toBe(true);

    // Simulate the wire-in: when blocked, evolution.ts queues a proposal
    await queueProposal(productId, {
      source_type: 'evolution',
      source_id: 'session-abc',
      proposed_change: 'atlas/system_prompt: refine clarity rule',
      proposed_by: 'atlas',
      rationale: 'observed ambiguous outputs',
      blocked_during_freeze_id: freeze?.id ?? null,
    });

    const queued = await listQueued(productId);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.source_type).toBe('evolution');
    expect(queued[0]!.blocked_during_freeze_id).toBe(fp.id);
  });

  it('blocks agent_provision under architecture_class freeze', async () => {
    await startFreeze(productId, { reason: 'window' });
    const r = await isBlocked(productId, 'agent_provision');
    expect(r.blocked).toBe(true);
  });
});
