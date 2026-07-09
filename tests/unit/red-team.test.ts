// =============================================================================
// Tests: Red Team council (Ascent B2 / Dissent Law)
//
// Drives the full dissent loop against a real migrated DB with a mocked model:
// pre-mortem persists → objections are anti-premises → overruling records their
// inverses in the Memory Kernel → telemetry falsifying one VINDICATES the
// review (the calibration point). This is the constitution's key unification,
// tested end to end.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

import { describe, it, expect, beforeAll, vi } from 'vitest';

// Mock ONLY the model call; parseJSONResponse and everything else stay real.
const CANNED_VERDICT = {
  verdict: 'do_not_proceed',
  strongest_objection: 'Raising prices now bets against your own churn trend.',
  confidence: 0.72,
  objections: [
    {
      lens: 'downside',
      claim: 'Churn will breach 7% within 90 days as grandfathered users lapse',
      severity: 'fatal',
      metric_key: 'churn_rate',
      comparator: '>',
      threshold: 0.07,
      mitigation: 'Grandfather existing users for 12 months',
    },
    { lens: 'competitor', claim: 'Competitor undercuts within a quarter', severity: 'serious' },
    { lens: 'capacity', claim: 'Solo founder cannot handle the support wave', severity: 'note' },
  ],
};
vi.mock('../../src/services/ai/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/ai/client.js')>();
  return {
    ...actual,
    callSonnet: vi.fn(async () => ({
      content: JSON.stringify(CANNED_VERDICT),
      model: 'sonnet',
      usage: { input_tokens: 500, output_tokens: 300 },
    })),
  };
});

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  runPreMortem, getReviewForDecision, recordOverruledDissent, getDissentRecord,
} from '../../src/services/redteam/council.js';
import { checkPremises } from '../../src/services/memory/kernel.js';

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO products (id, name, owner_id) VALUES ('p_rt','RtCo','o1')", []);
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status)
     VALUES ('dec_rt', 'p_rt', 'strategic', 3, 'Raise Solo price to $99', 'Margin pressure', 'pending')`,
    [],
  );
});

describe('Red Team council', () => {
  it('runs a pre-mortem and persists the structured review', async () => {
    const res = await runPreMortem('dec_rt', 'p_rt');
    expect(res).toBeTruthy();
    expect(res!.review.verdict).toBe('do_not_proceed');
    expect(res!.objections.length).toBe(3);
    expect(res!.review.strongest_objection).toContain('churn');
  });

  it('is idempotent — a second run returns the existing review, no second model call', async () => {
    const { callSonnet } = await import('../../src/services/ai/client.js');
    const callsBefore = (callSonnet as ReturnType<typeof vi.fn>).mock.calls.length;
    const res = await runPreMortem('dec_rt', 'p_rt');
    expect(res!.review.id).toBe((await getReviewForDecision('dec_rt'))!.id);
    expect((callSonnet as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
  });

  it('overruling records each falsifiable objection\'s INVERSE as a red_team premise', async () => {
    const recorded = await recordOverruledDissent('dec_rt', 'p_rt');
    expect(recorded).toBe(1); // only the churn objection is falsifiable
    const r = await query(
      "SELECT * FROM decision_premises WHERE decision_id = 'dec_rt' AND origin = 'red_team'", [],
    );
    const p = r.rows[0] as Record<string, unknown>;
    expect(p.metric_key).toBe('churn_rate');
    expect(p.comparator).toBe('<='); // inverse of the failure condition '>'
    expect(Number(p.threshold)).toBe(0.07);
    expect(p.review_id).toBeTruthy();
  });

  it('falsification of the overruled premise VINDICATES the review (calibration point)', async () => {
    // Telemetry proves the Red Team right: churn breaches 7%.
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, churn_rate) VALUES ('ms_rt','p_rt','2026-02-01', 0.09)`,
      [],
    );
    const res = await checkPremises('p_rt');
    expect(res.falsified).toBe(1);

    const review = await getReviewForDecision('dec_rt');
    expect(review!.resolved_outcome).toBe('vindicated');

    const record = await getDissentRecord('p_rt');
    expect(record.vindicated).toBe(1);
  });

  it('returns null for a decision that does not exist / is not tenant-owned', async () => {
    expect(await runPreMortem('nope', 'p_rt')).toBeNull();
  });
});
