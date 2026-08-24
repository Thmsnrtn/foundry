process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// ELEVEN TABLES NOTHING EVER WROTE.
//
// Not written-and-unread — never written at all. Each was created by a
// migration and then referenced by nothing in `src/`: no INSERT, no SELECT, no
// service, no route, no job. Schema describing an intention nobody carried out,
// and empty in every environment because no code path could put a row in one.
//
// The owner's rule from migration 157 applies unchanged — remove the consuming
// halves rather than build the producing ones, and anything genuinely wanted
// comes back as a whole feature. Here there was not even a consuming half.
// =============================================================================

const DROPPED = [
  'agent_message_threads',
  'competitor_feature_tracking',
  'competitor_pricing_snapshots',
  'custom_webhook_sources',
  'experiment_holdouts',
  'experiment_results_timeline',
  'idea_validations',
  'investor_annotations',
  'playbook_exports',
  'sector_remediation_templates',
  'strategic_plans',
];

beforeAll(async () => { await runMigrations(); });

describe('the tables nothing ever wrote are gone', () => {
  it('none of the eleven survives the migration', async () => {
    const existing = await query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${DROPPED.map(() => '?').join(',')})`,
      DROPPED,
    );
    expect((existing.rows as unknown as Array<{ name: string }>).map((r) => r.name)).toEqual([]);
  });

  it('their indexes went with them', async () => {
    const idx = await query(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN (${DROPPED.map(() => '?').join(',')})`,
      DROPPED,
    );
    expect(idx.rows).toHaveLength(0);
  });

  it('the tables the same migrations built and the code does use are untouched', async () => {
    // 029 also created the competitor surface the weekly scan actually writes;
    // 035 the experiments the engine reads. Dropping neighbours would be the
    // other defect.
    for (const table of ['competitors', 'competitive_signals', 'experiments', 'playbooks',
      'sector_scoring_overrides', 'agent_messages', 'product_webhooks']) {
      const r = await query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [table]);
      expect(r.rows, `${table} should still exist`).toHaveLength(1);
    }
  });

  it('the ratchet that found them is at zero and can only stay there', () => {
    const baseline = readFileSync('docs/db/unreferenced-tables-baseline.txt', 'utf-8').trim();
    expect(baseline).toBe('');
  });

  it('no dropped table is left claiming to be non-personal data', () => {
    const consent = readFileSync('src/services/privacy/consent.ts', 'utf-8');
    for (const table of DROPPED) {
      expect(consent, `${table} should not appear in the erasure map`).not.toContain(`${table}:`);
    }
  });
});
