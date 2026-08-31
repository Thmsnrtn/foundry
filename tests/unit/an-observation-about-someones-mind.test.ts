process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

let modelReply = '';
vi.mock('../../src/services/ai/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/ai/client.js')>()),
  callOpus: async () => ({
    content: modelReply, model: 'stub',
    usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: null,
  }),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { detectOvercorrection } = await import('../../src/services/intelligence/psychology.js');

// =============================================================================
// AN OBSERVATION ABOUT SOMEONE'S MIND.
//
// `detectOvercorrection` asks a model whether a founder is over-indexing
// against past failures, and every field of the answer had a fallback. A model
// that replied `{"detected": true}` and nothing else produced a stored insight:
//
//   description  "Overcorrection pattern detected"   (substituted)
//   confidence   0.5                                 (substituted)
//   evidence     []                                  (substituted)
//
// `GET /api/psychology-insights` returns that row verbatim. So a founder was
// shown an observation about their own psychology with no description of what
// was noticed, nothing it was noticed from, and a confidence at the exact
// middle of the scale — indistinguishable from a model that had actually said
// "half sure".
//
// The header of that file promises insights that are "non-judgmental,
// actionable and dismissable". An observation about a person with nothing
// behind it is a judgement they cannot act on or argue with.
//
// AND IT TRAVELS FURTHER THAN THE PAGE. `ai/calibration.ts` reads the
// pattern_type of active insights and changes how Foundry speaks to this
// founder. A substituted insight quietly re-tunes the whole relationship.
//
// The deterministic detectors in the same file are the counter-example and the
// standard: each states a real description, an evidence line derived from real
// counts, and a fixed prior it stands behind.
// =============================================================================

const P = 'p_psy';
const F = 'f_psy';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES ('${F}','c_psy','p@example.com')`);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme',?,'active')", [P, F]);
  // The detector needs at least two failure logs before it asks anything.
  for (let i = 0; i < 3; i++) {
    await query(
      `INSERT INTO failure_log (id, product_id, owner_id, category, what_was_tried, outcome)
       VALUES (?, ?, ?, 'onboarding', 'Rebuilt the signup flow', 'Activation unchanged')`,
      [nanoid(), P, F]);
  }
});

beforeEach(async () => {
  await query('DELETE FROM founder_psychology_insights WHERE product_id = ?', [P]);
});

async function stored(): Promise<Array<Record<string, unknown>>> {
  const r = await query('SELECT * FROM founder_psychology_insights WHERE product_id = ?', [P]);
  return r.rows as unknown as Array<Record<string, unknown>>;
}

describe('a model that says it found something and cannot say what', () => {
  it('produces no insight at all', async () => {
    modelReply = JSON.stringify({ detected: true });

    expect(await detectOvercorrection(F, P)).toBeNull();
    expect(await stored()).toEqual([]);
  });

  it('produces none when it describes but cannot say what from', async () => {
    modelReply = JSON.stringify({
      detected: true,
      description: 'You may be over-correcting against an earlier failure.',
      evidence: [],
    });

    expect(await detectOvercorrection(F, P)).toBeNull();
    expect(await stored()).toEqual([]);
  });

  it('produces none when its evidence is only whitespace', async () => {
    modelReply = JSON.stringify({
      detected: true, description: 'Over-correcting.', evidence: ['  ', ''],
    });

    expect(await detectOvercorrection(F, P)).toBeNull();
  });
});

describe('a model that says what it found', () => {
  it('records the insight, with the evidence it rested on', async () => {
    modelReply = JSON.stringify({
      detected: true,
      description: 'Three consecutive process failures preceded a change of approach each time.',
      confidence: 0.8,
      evidence: ['3 process failures in 90 days', 'each followed by a scope reduction'],
      suggestion: 'Ask whether the last change was a response to evidence or to the memory of it.',
    });

    const insight = await detectOvercorrection(F, P);

    expect(insight).not.toBeNull();
    expect(insight!.confidence).toBe(0.8);
    expect(insight!.evidence).toHaveLength(2);
    expect(await stored()).toHaveLength(1);
  });

  it('says the confidence was not stated rather than putting the middle of the scale', async () => {
    modelReply = JSON.stringify({
      detected: true,
      description: 'A pattern of retreating from commitments made after a setback.',
      evidence: ['2 reversals within a week of a failure log'],
    });

    const insight = await detectOvercorrection(F, P);

    // 0.5 read as "half sure" and was stored and served as one.
    expect(insight!.confidence).toBeNull();
    const row = (await stored())[0]!;
    expect(row.confidence).toBeNull();
  });

  it('still says nothing when the model found nothing', async () => {
    modelReply = JSON.stringify({ detected: false });

    expect(await detectOvercorrection(F, P)).toBeNull();
    expect(await stored()).toEqual([]);
  });
});
