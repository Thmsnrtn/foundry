// =============================================================================
// Tests: Weekly outcome metric — Andy Grove's founder-facing number
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { query, executeRaw } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { computeWeeklyOutcome } from '../../src/services/intelligence/weekly-outcome.js';

let founderId: string;
let productId: string;

async function setupSchema(): Promise<void> {
}

beforeAll(async () => {
  // The migrations are the schema. Tables this file used to write by hand are
  // already here, in the shape the product actually has — including the NOT
  // NULL columns and foreign keys a hand-written stand-in leaves out.
  await runMigrations();
  await setupSchema();
});

// NOTE: ids get interpolated into raw SQL below, and executeRaw strips
// `--`-style comments — a nanoid containing `--` truncates the statement
// mid-string (a real observed flake: "unrecognized token"). Use deterministic
// counter ids for anything that flows into executeRaw.
let idSeq = 0;
const nextId = (prefix: string): string => `${prefix}${++idSeq}_${Date.now().toString(36)}`;

beforeEach(async () => {
  founderId = nextId('f');
  productId = nextId('p');
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, tier) VALUES (?, ?, ?, ?)`,
    [founderId, `clerk_${founderId}`, `${founderId}@test.local`, 'growth']
  );
  await query(`INSERT INTO products (id, name, owner_id) VALUES (?, ?, ?)`, [
    productId,
    'Test',
    founderId,
  ]);
  await executeRaw(`DELETE FROM decisions`);
  await executeRaw(`DELETE FROM action_drafts`);
});

async function insertDecision(opts: {
  gate: number;
  status: string;
  decidedBy?: string | null;
  createdDaysAgo?: number;
  decidedDaysAgo?: number | null;
}): Promise<void> {
  const created = `datetime('now', '-${opts.createdDaysAgo ?? 1} days')`;
  const decided = opts.decidedDaysAgo === null || opts.decidedDaysAgo === undefined
    ? 'NULL'
    : `datetime('now', '-${opts.decidedDaysAgo} days')`;
  await executeRaw(
    `INSERT INTO decisions (id, product_id, gate, what, why_now, status, decided_by, created_at, decided_at)
     VALUES ('${nextId('d')}', '${productId}', ${opts.gate}, 'x', 'y', '${opts.status}', ${opts.decidedBy === null ? 'NULL' : `'${opts.decidedBy ?? 'founder'}'`}, ${created}, ${decided})`
  );
}

async function insertActionDraft(opts: { status: string; executedDaysAgo?: number }): Promise<void> {
  const executed = opts.executedDaysAgo === undefined
    ? 'NULL'
    : `datetime('now', '-${opts.executedDaysAgo} days')`;
  await executeRaw(
    `INSERT INTO action_drafts (id, product_id, owner_id, action_type, title, draft_content, artifact_type, gate, auto_executable, status, executed_at)
     VALUES ('${nextId('a')}', '${productId}', '${founderId}', 'cat', 'Title', 'Content', 'email_draft', 0, 1, '${opts.status}', ${executed})`
  );
}

// ─── Empty product ────────────────────────────────────────────────────────────

describe('computeWeeklyOutcome: empty product', () => {
  it('returns zeros and null percent when no decisions exist', async () => {
    const r = await computeWeeklyOutcome(productId);
    expect(r.surfaced_7d).toBe(0);
    expect(r.acted_on_7d).toBe(0);
    expect(r.expired_7d).toBe(0);
    expect(r.percent_acted).toBeNull();
    expect(r.agent_actions_7d).toBe(0);
  });
});

// ─── Surfaced count ───────────────────────────────────────────────────────────

describe('computeWeeklyOutcome: surfaced count', () => {
  it('counts gate>=1 decisions created in the last 7 days', async () => {
    await insertDecision({ gate: 0, status: 'executed', createdDaysAgo: 1 }); // not surfaced (gate 0)
    await insertDecision({ gate: 1, status: 'pending', createdDaysAgo: 1 });
    await insertDecision({ gate: 2, status: 'pending', createdDaysAgo: 6 });
    await insertDecision({ gate: 3, status: 'pending', createdDaysAgo: 8 }); // outside window

    const r = await computeWeeklyOutcome(productId);
    expect(r.surfaced_7d).toBe(2);
  });
});

// ─── Acted-on count ───────────────────────────────────────────────────────────

describe('computeWeeklyOutcome: acted_on count', () => {
  it('counts only decisions explicitly approved or rejected by the founder this week', async () => {
    await insertDecision({ gate: 1, status: 'approved', decidedBy: 'founder', createdDaysAgo: 4, decidedDaysAgo: 2 });
    await insertDecision({ gate: 2, status: 'rejected', decidedBy: 'founder', createdDaysAgo: 5, decidedDaysAgo: 1 });
    // System-decided: NOT counted
    await insertDecision({ gate: 0, status: 'executed', decidedBy: 'system_gate_0', createdDaysAgo: 1, decidedDaysAgo: 1 });
    // Outside window
    await insertDecision({ gate: 1, status: 'approved', decidedBy: 'founder', createdDaysAgo: 12, decidedDaysAgo: 10 });

    const r = await computeWeeklyOutcome(productId);
    expect(r.acted_on_7d).toBe(2);
  });

  it('percent_acted is acted/surfaced rounded to whole percent', async () => {
    // 4 surfaced this week, 3 acted on
    await insertDecision({ gate: 1, status: 'approved', decidedBy: 'founder', createdDaysAgo: 4, decidedDaysAgo: 2 });
    await insertDecision({ gate: 1, status: 'approved', decidedBy: 'founder', createdDaysAgo: 4, decidedDaysAgo: 2 });
    await insertDecision({ gate: 1, status: 'rejected', decidedBy: 'founder', createdDaysAgo: 4, decidedDaysAgo: 1 });
    await insertDecision({ gate: 1, status: 'pending', createdDaysAgo: 1 });

    const r = await computeWeeklyOutcome(productId);
    expect(r.surfaced_7d).toBe(4);
    expect(r.acted_on_7d).toBe(3);
    expect(r.percent_acted).toBe(75);
  });
});

// ─── Expired count ────────────────────────────────────────────────────────────

describe('computeWeeklyOutcome: expired count', () => {
  it('flags decisions that aged out without action', async () => {
    await insertDecision({ gate: 1, status: 'expired', createdDaysAgo: 4 });
    await insertDecision({ gate: 1, status: 'expired', createdDaysAgo: 6 });
    await insertDecision({ gate: 1, status: 'pending', createdDaysAgo: 1 });

    const r = await computeWeeklyOutcome(productId);
    expect(r.expired_7d).toBe(2);
  });
});

// ─── Agent actions ────────────────────────────────────────────────────────────

describe('computeWeeklyOutcome: agent_actions_7d', () => {
  it('counts executed action_drafts in the trailing window', async () => {
    await insertActionDraft({ status: 'executed', executedDaysAgo: 1 });
    await insertActionDraft({ status: 'executed', executedDaysAgo: 5 });
    await insertActionDraft({ status: 'draft', executedDaysAgo: 1 }); // not executed
    await insertActionDraft({ status: 'executed', executedDaysAgo: 10 }); // outside window

    const r = await computeWeeklyOutcome(productId);
    expect(r.agent_actions_7d).toBe(2);
  });
});
