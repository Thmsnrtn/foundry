// =============================================================================
// Tests: four features that spent money and then threw away the result
//
// `check-insert-columns` proves every column an INSERT NAMES exists. It cannot
// see the opposite defect: a column the INSERT does NOT name, which the table
// declares NOT NULL with no default. Four instances, all the same shape and all
// with the same cause — a later migration redefined a table with
// `CREATE TABLE IF NOT EXISTS`, which is a silent no-op on an existing table,
// and the code was written against the definition that never took effect:
//
//   board_packets       omitted period_start / period_end
//   investor_updates    omitted owner_id / period / subject / content
//   experiments         omitted hypothesis_id / type / control_description /
//                       treatment_description / success_metric
//   voice_sessions      omitted session_date
//   integration_sync_log omitted started_at
//
// Three of them make a PAID MODEL CALL FIRST. The founder pressed Generate, the
// money went, the narrative was written, and then the write raised. So the
// board-packet, investor-update and growth-experiment features have never
// produced anything, for anybody, since they shipped — and the failure is
// invisible from outside because a button that does nothing looks like a button
// nobody pressed.
//
// These tests assert the ROW EXISTS afterwards. A test that only called the
// function and checked it did not throw would have passed against the old code
// on any fixture that built its own tables.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

vi.mock('../../src/services/ai/client.js', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    callSonnet: vi.fn(async () => ({
      content: '## Update\n\nThings happened.',
      usage: { input_tokens: 1, output_tokens: 1 },
    })),
  };
});

const OWNER = 'wn_owner';
const P = 'wn_product';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [OWNER, 'clerk_wn', 'wn@test.local']);
  await query(
    `INSERT INTO products (id, name, owner_id, status) VALUES (?, 'Landed Co', ?, 'active')`,
    [P, OWNER]);
});

describe('a growth experiment is actually created', () => {
  it('writes the experiment and the hypothesis it tests', async () => {
    const { createExperiment } = await import('../../src/services/experiments/engine.js');
    const id = await createExperiment(P, OWNER, {
      name: 'Annual plan pricing',
      hypothesis: 'Annual billing lifts conversion',
      experiment_type: 'pricing',
      variants: [
        { name: 'control', description: 'Monthly only', config: {} },
        { name: 'variant_b', description: 'Monthly and annual', config: {} },
      ],
      primary_metric: 'conversion_rate',
      secondary_metrics: ['activation_rate'],
      traffic_split: { control: 50, variant_b: 50 },
      sample_size_target: 100,
    } as never);

    const row = (await query(
      `SELECT hypothesis_id, type, control_description, treatment_description,
              success_metric, experiment_type, status
         FROM experiments WHERE id = ?`, [id])).rows[0] as Record<string, unknown>;
    expect(row, 'the growth experiment feature has never created an experiment').toBeTruthy();

    // The study design and the subject are two different axes with confusingly
    // close names. `type` is a closed vocabulary; `experiment_type` is not.
    expect(row.type).toBe('ab_test');
    expect(row.experiment_type).toBe('pricing');
    expect(row.control_description).toBe('Monthly only');
    expect(row.treatment_description).toBe('Monthly and annual');

    const hypothesis = (await query(
      `SELECT statement, proposed_by FROM hypotheses WHERE id = ?`, [row.hypothesis_id]))
      .rows[0] as Record<string, unknown>;
    expect(hypothesis, 'every experiment cites a hypothesis').toBeTruthy();
    expect(hypothesis.statement).toBe('Annual billing lifts conversion');
  });
});

describe('an investor update is actually created', () => {
  it('writes both generations of the same columns', async () => {
    const { generateInvestorUpdate } = await import(
      '../../src/services/scp/investor/investor-update.js');
    const id = await generateInvestorUpdate(P, '2026-03');

    const row = (await query(
      `SELECT owner_id, period, subject, content, month, draft_text, status
         FROM investor_updates WHERE id = ?`, [id])).rows[0] as Record<string, unknown>;
    expect(row, 'the money was spent before the write that raised').toBeTruthy();
    expect(row.owner_id).toBe(OWNER);
    expect(row.period).toBe('2026-03');
    expect(String(row.subject)).toContain('2026-03');
    // The table carries two names for the same fact because a redefinition was
    // a no-op. Writing one and not the other would leave half the readers blind.
    expect(row.content).toBe(row.draft_text);
    expect(row.month).toBe(row.period);
  });
});

describe('a voice session is actually started', () => {
  it('writes the session with the date the table requires', async () => {
    const { startVoiceSession } = await import('../../src/services/voice/processor.js');
    const { voice_session_id } = await startVoiceSession(OWNER, P);
    const row = (await query(
      `SELECT session_date, chat_session_id FROM voice_sessions WHERE id = ?`,
      [voice_session_id])).rows[0] as Record<string, unknown>;
    expect(row, 'starting a voice session raised before a word was recorded').toBeTruthy();
    expect(String(row.session_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('a sync is actually logged', () => {
  it('records the row a failed sync path would otherwise lose', async () => {
    // runSync's own failures are treated as unremarkable, so a log that has
    // never recorded anything looked like a quiet system rather than a broken
    // write. The integration below has no adapter, so the sync fails — and the
    // LOG of that failure is the thing under test.
    const integrationId = nanoid();
    await query(
      `INSERT INTO integrations (id, product_id, direction, provider, status, config)
       VALUES (?, ?, 'inbound', 'zz_no_adapter', 'active', '{}')`,
      [integrationId, P]);
    const { runSync } = await import('../../src/services/integrations/framework.js');
    await runSync(integrationId, 'scheduled').catch(() => undefined);

    const row = (await query(
      `SELECT started_at, completed_at FROM integration_sync_log WHERE integration_id = ?`,
      [integrationId])).rows[0] as Record<string, unknown> | undefined;
    expect(row, 'every sync log write raised on a NOT NULL column').toBeTruthy();
    expect(row!.started_at).toBeTruthy();
  });
});
