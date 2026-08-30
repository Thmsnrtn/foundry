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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyEvolutionChange } from '../../src/services/scp/evolution.js';
import { CONFIG_TYPES } from '../../src/services/scp/agent-config.js';
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
  // THIS BLOCK USED TO EXERCISE A VOCABULARY THAT DOES NOT EXIST.
  //
  // Every value it passed — 'system_prompt', 'behavioral_constraints',
  // 'domain_context', 'system_prompt_core', 'decision_framework',
  // 'any_future_type' — is outside `agent_configs.config_type`, whose CHECK
  // permits exactly the six in CONFIG_TYPES. Not one real config type appeared
  // here, so the mapping was proven over values no row can hold while the six
  // that can went untested.
  //
  // It mattered most where it looked most reassuring: the test asserting
  // 'behavioral_constraints' maps to 'tightening' was defending the branch that
  // let a model-supplied word take a category the freeze gate never blocks.

  it('every storable config type maps to prompt_refinement, and none to tightening', () => {
    for (const t of CONFIG_TYPES) {
      expect(classifyEvolutionChange(t, false),
        `${t} must not buy a freeze exemption — a config type names WHICH part of `
        + 'a configuration changed, never which direction').toBe('prompt_refinement');
    }
  });

  it('a founder correction is a correction, whatever it touches', () => {
    for (const t of CONFIG_TYPES) {
      expect(classifyEvolutionChange(t, true)).toBe('correction');
    }
  });

  it('covers the whole vocabulary the column will accept', () => {
    // A shrunken CONFIG_TYPES would make the loops above pass while checking
    // less, so the list is pinned to the CHECK the database enforces.
    const migration = readFileSync(
      resolve(import.meta.dirname, '../../src/db/migrations/020_evolution_v2.sql'), 'utf8');
    const check = /config_type\s+TEXT[^,]*?CHECK\(\s*config_type\s+IN\s*\(([^)]*)\)/is.exec(migration);
    expect(check, 'the config_type CHECK is no longer where this expects it').not.toBeNull();
    const allowed = check![1].split(',').map((w) => w.trim().replace(/'/g, '')).filter(Boolean).sort();
    expect([...CONFIG_TYPES].sort()).toEqual(allowed);
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
    // The category, not a config type that claims to be one. A freeze still
    // never blocks a genuine tightening; what changed is that no word from a
    // model can select this category any more.
    const r = await isBlocked(productId, 'tightening');
    expect(r.blocked).toBe(false);
  });

  it('does block an evolution config change during freeze', async () => {
    // The other half, and the one the old test hid: a config change is a
    // prompt_refinement, and a freeze is supposed to stop those.
    await startFreeze(productId, { reason: 'discipline window' });
    const cat = classifyEvolutionChange('domain_knowledge', false);
    const r = await isBlocked(productId, cat);
    expect(r.blocked, 'a freeze that lets ordinary evolution through is not a freeze').toBe(true);
  });

  it('does not block founder corrections even during freeze', async () => {
    await startFreeze(productId, { reason: 'discipline window' });
    const cat = classifyEvolutionChange('persona', true); // isCorrection=true
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
