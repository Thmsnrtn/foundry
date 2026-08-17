// =============================================================================
// Tests: briefing → decision telemetry (Wave 1, Action 1)
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import {
  recordBriefingView,
  recordDecisionActed,
  getBriefingOutcome,
} from '../../src/services/intelligence/briefing-telemetry.js';

let founderId: string;
let productId: string;

async function setupSchema(): Promise<void> {
  await executeRaw(`
    CREATE TABLE IF NOT EXISTS founders (
      id TEXT PRIMARY KEY,
      clerk_user_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      tier TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES founders(id),
      status TEXT DEFAULT 'active',
      scp_status TEXT DEFAULT 'active',
      entitlement_paused_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await executeRaw(
    readFileSync(
      resolve(__dirname, '../../src/db/migrations/069_briefing_decision_telemetry.sql'),
      'utf-8'
    )
  );
}

beforeAll(async () => {
  await setupSchema();
});

beforeEach(async () => {
  founderId = nanoid();
  productId = nanoid();
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, tier) VALUES (?, ?, ?, ?)`,
    [founderId, `clerk_${founderId}`, `${founderId}@test.local`, 'growth']
  );
  await query(`INSERT INTO products (id, name, owner_id) VALUES (?, ?, ?)`, [
    productId,
    'Test',
    founderId,
  ]);
  await executeRaw('DELETE FROM briefing_decision_links');
});

describe('recordBriefingView', () => {
  it('records a fresh view', async () => {
    const id = await recordBriefingView(founderId, productId, 'briefing-1');
    expect(id).toBeTruthy();
    const r = await query(
      'SELECT briefing_id, founder_id FROM briefing_decision_links WHERE id = ?',
      [id]
    );
    const row = r.rows[0] as Record<string, string>;
    expect(row.briefing_id).toBe('briefing-1');
    expect(row.founder_id).toBe(founderId);
  });

  it('dedups within the 5-minute window', async () => {
    const a = await recordBriefingView(founderId, productId, 'briefing-1');
    const b = await recordBriefingView(founderId, productId, 'briefing-1');
    expect(a).toBe(b);
  });

  it('does not dedup across different briefings', async () => {
    const a = await recordBriefingView(founderId, productId, 'briefing-1');
    const b = await recordBriefingView(founderId, productId, 'briefing-2');
    expect(a).not.toBe(b);
  });
});

describe('recordDecisionActed', () => {
  it('attributes an action to the most recent unattributed view', async () => {
    await recordBriefingView(founderId, productId, 'briefing-1');
    await recordDecisionActed(founderId, productId, 'draft-1', 'dec-1', 'approved');

    const r = await query(
      'SELECT briefing_id, draft_id, outcome, latency_ms FROM briefing_decision_links WHERE founder_id = ?',
      [founderId]
    );
    expect(r.rows.length).toBe(1);
    const row = r.rows[0] as Record<string, unknown>;
    expect(row.briefing_id).toBe('briefing-1');
    expect(row.draft_id).toBe('draft-1');
    expect(row.outcome).toBe('approved');
    expect(Number(row.latency_ms)).toBeGreaterThanOrEqual(0);
  });

  it('records unattributed when no view in trailing 60 minutes', async () => {
    await recordDecisionActed(founderId, productId, 'draft-2', 'dec-2', 'rejected');

    const r = await query(
      `SELECT briefing_id, draft_id, outcome FROM briefing_decision_links
        WHERE founder_id = ? AND draft_id = 'draft-2'`,
      [founderId]
    );
    const row = r.rows[0] as Record<string, unknown>;
    expect(row.briefing_id).toBe('__unattributed__');
    expect(row.outcome).toBe('rejected');
  });

  it('does not double-attribute: a second action does not consume the same view', async () => {
    await recordBriefingView(founderId, productId, 'briefing-1');
    await recordDecisionActed(founderId, productId, 'draft-1', null, 'approved');
    await recordDecisionActed(founderId, productId, 'draft-2', null, 'approved');

    const r = await query(
      `SELECT briefing_id FROM briefing_decision_links
        WHERE founder_id = ? ORDER BY created_at ASC`,
      [founderId]
    );
    // First: attributed (briefing-1). Second: unattributed.
    expect(r.rows.length).toBe(2);
    const briefings = r.rows.map((row) => (row as Record<string, string>).briefing_id);
    expect(briefings).toContain('briefing-1');
    expect(briefings).toContain('__unattributed__');
  });
});

describe('getBriefingOutcome', () => {
  it('returns zeros on an empty product', async () => {
    const r = await getBriefingOutcome(productId);
    expect(r.decisions_actioned_after_briefing_7d).toBe(0);
    expect(r.decisions_actioned_unattributed_7d).toBe(0);
    expect(r.median_latency_ms_7d).toBeNull();
    expect(r.fast_actions_7d).toBe(0);
  });

  it('counts attributed and unattributed actions separately', async () => {
    await recordBriefingView(founderId, productId, 'briefing-1');
    await recordDecisionActed(founderId, productId, 'draft-1', null, 'approved');
    await recordDecisionActed(founderId, productId, 'draft-2', null, 'approved'); // unattributed

    const r = await getBriefingOutcome(productId);
    expect(r.decisions_actioned_after_briefing_7d).toBe(1);
    expect(r.decisions_actioned_unattributed_7d).toBe(1);
  });

  it('counts fast_actions when latency < 5 minutes', async () => {
    await recordBriefingView(founderId, productId, 'briefing-fast');
    await recordDecisionActed(founderId, productId, 'draft-fast', null, 'approved');
    const r = await getBriefingOutcome(productId);
    expect(r.fast_actions_7d).toBe(1);
  });
});
