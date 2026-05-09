// =============================================================================
// Eval: voice-gate verdict thresholds
// Pins down the deterministic verdict-from-score logic so prompt or model
// changes that move scores around produce a specific eval failure rather
// than silent drift.
// =============================================================================

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { nanoid } from 'nanoid';

import { defineEval, type EvalCase } from './_framework.js';
import { query, executeRaw } from '../../src/db/client.js';

// Mock the AI client so the LLM judge returns whatever score the case asks
// for. Deterministic — no real Sonnet call. The case's hasBannedWord flag
// flips a banned word into the draft content.
let mockScore = 80;
vi.mock('../../src/services/ai/client.js', () => ({
  callSonnet: vi.fn(async () => ({
    content: `{"score":${mockScore},"register":${mockScore},"rhythm":${mockScore},"lexical":${mockScore},"energy":${mockScore},"rationale":"eval"}`,
    usage: { input_tokens: 10, output_tokens: 10 },
  })),
}));

import {
  createDraftFingerprint,
  activateFingerprint,
} from '../../src/services/calibration/voice-fingerprint.js';
import { voiceGateDraft } from '../../src/services/calibration/voice-gate.js';

interface CaseInput {
  score: number;
  threshold: number;
  warnBand: number;
  hasBannedWord: boolean;
}

interface CaseExpected {
  verdict: 'pass' | 'warn' | 'block' | 'exempt' | 'no_fingerprint';
  suggested_action: 'ship' | 'review' | 'rewrite' | 'ignore';
  /** When a deterministic short-circuit forces score to a specific value. */
  scoreOverride?: number;
}

let founderId: string;
let productId: string;

async function setupSchema(): Promise<void> {
  await executeRaw(`
    CREATE TABLE IF NOT EXISTS founders (
      id TEXT PRIMARY KEY,
      clerk_user_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      tier TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES founders(id),
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await executeRaw(
    readFileSync(
      resolve(__dirname, '../../src/db/migrations/063_product_voice_fingerprints.sql'),
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
});

const cases: EvalCase<CaseInput, CaseExpected>[] = JSON.parse(
  readFileSync(resolve(__dirname, 'cases/voice-gate.json'), 'utf-8')
);

defineEval<CaseInput, CaseExpected>({
  title: 'voice-gate verdict from score',
  cases,
  matcher: (actual, expected, c) => {
    expect(actual.verdict, `case "${c.name}"`).toBe(expected.verdict);
    expect(actual.suggested_action, `case "${c.name}" suggested_action`).toBe(
      expected.suggested_action
    );
    if (expected.scoreOverride !== undefined) {
      // Banned-word path forces score to 0
      expect((actual as unknown as { score: number | null }).score).toBe(
        expected.scoreOverride
      );
    }
  },
  run: async (input) => {
    mockScore = input.score;
    const banned = input.hasBannedWord ? ['game-changer'] : [];
    const fp = await createDraftFingerprint(productId, {
      register: 'plainspoken',
      energy: 'measured',
      banned_words: banned,
      exemplar_sentences: ['One.', 'Two.', 'Three.', 'Four.', 'Five.'],
    });
    await activateFingerprint(fp.id);
    const content = input.hasBannedWord
      ? 'This is a game-changer for your business.'
      : 'A normal in-voice draft.';
    const result = await voiceGateDraft(
      productId,
      { artifact_type: 'email_draft', draft_content: content },
      { threshold: input.threshold, warnBand: input.warnBand }
    );
    return result as unknown as CaseExpected;
  },
});

// Sanity check the framework itself: a passing eval suite proves the JSON
// loaded and the matcher fired for every case.
describe('voice-gate eval suite shape', () => {
  it('loaded all 10 cases from the JSON file', () => {
    expect(cases.length).toBe(10);
  });
});
