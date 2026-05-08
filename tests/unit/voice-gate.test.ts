// =============================================================================
// Tests: V3.1 Layer B — Voice Gate
// Verifies verdict logic across all four states: exempt, no_fingerprint,
// pass/warn/block based on score.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';

// Mock the AI client. We control the score returned to test all verdict branches.
let mockScore = 80;
vi.mock('../../src/services/ai/client.js', () => ({
  callSonnet: vi.fn(async () => ({
    content: `{"score":${mockScore},"register":${mockScore},"rhythm":${mockScore},"lexical":${mockScore},"energy":${mockScore},"rationale":"test"}`,
    usage: { input_tokens: 100, output_tokens: 50 },
  })),
}));

import {
  createDraftFingerprint,
  activateFingerprint,
} from '../../src/services/calibration/voice-fingerprint.js';
import {
  voiceGateDraft,
  isVoiceBearing,
  VOICE_BEARING_ARTIFACT_TYPES,
} from '../../src/services/calibration/voice-gate.js';

// ─── Setup ────────────────────────────────────────────────────────────────────

let founderId: string;
let productId: string;

async function createFounderAndProduct() {
  const fId = nanoid();
  const pId = nanoid();
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, tier) VALUES (?, ?, ?, ?)`,
    [fId, `clerk_${fId}`, `${fId}@test.local`, 'growth']
  );
  await query(
    `INSERT INTO products (id, name, owner_id) VALUES (?, ?, ?)`,
    [pId, 'Test', fId]
  );
  return { founderId: fId, productId: pId };
}

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
  await executeRaw(readFileSync(resolve(__dirname, '../../src/db/migrations/063_product_voice_fingerprints.sql'), 'utf-8'));
}

beforeAll(async () => {
  await setupSchema();
});

beforeEach(async () => {
  const { founderId: fId, productId: pId } = await createFounderAndProduct();
  founderId = fId;
  productId = pId;
  mockScore = 80;
});

async function activateFp(banned: string[] = []) {
  const fp = await createDraftFingerprint(productId, {
    register: 'plainspoken',
    energy: 'measured',
    banned_words: banned,
    exemplar_sentences: ['One.', 'Two.', 'Three.', 'Four.', 'Five.'],
  });
  await activateFingerprint(fp.id);
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe('VOICE_BEARING_ARTIFACT_TYPES', () => {
  it('includes the canonical user-facing artifact types', () => {
    expect(VOICE_BEARING_ARTIFACT_TYPES.has('email_draft')).toBe(true);
    expect(VOICE_BEARING_ARTIFACT_TYPES.has('landing_page_copy')).toBe(true);
    expect(VOICE_BEARING_ARTIFACT_TYPES.has('cs_message')).toBe(true);
    expect(VOICE_BEARING_ARTIFACT_TYPES.has('blog_draft')).toBe(true);
  });

  it('does not include internal/non-voice types', () => {
    expect(VOICE_BEARING_ARTIFACT_TYPES.has('internal_memo')).toBe(false);
    expect(VOICE_BEARING_ARTIFACT_TYPES.has('stripe_plan_config')).toBe(false);
    expect(VOICE_BEARING_ARTIFACT_TYPES.has('github_pr')).toBe(false);
  });
});

describe('isVoiceBearing', () => {
  it('returns true for voice-bearing types', () => {
    expect(isVoiceBearing('email_draft')).toBe(true);
  });
  it('returns false for non-voice types', () => {
    expect(isVoiceBearing('internal_memo')).toBe(false);
    expect(isVoiceBearing('unknown_type')).toBe(false);
  });
});

// ─── Verdict States ───────────────────────────────────────────────────────────

describe('voiceGateDraft: verdict states', () => {
  it('returns exempt when artifact_type is not voice-bearing', async () => {
    await activateFp();
    const result = await voiceGateDraft(productId, {
      artifact_type: 'internal_memo',
      draft_content: 'whatever',
    });
    expect(result.verdict).toBe('exempt');
    expect(result.suggested_action).toBe('ignore');
    expect(result.score).toBeNull();
  });

  it('returns no_fingerprint when no active fingerprint exists', async () => {
    const result = await voiceGateDraft(productId, {
      artifact_type: 'email_draft',
      draft_content: 'Hi',
    });
    expect(result.verdict).toBe('no_fingerprint');
    expect(result.suggested_action).toBe('ignore');
  });

  it('returns pass when score >= threshold', async () => {
    await activateFp();
    mockScore = 80;
    const result = await voiceGateDraft(productId, {
      artifact_type: 'email_draft',
      draft_content: 'In voice',
    });
    expect(result.verdict).toBe('pass');
    expect(result.suggested_action).toBe('ship');
    expect(result.score).toBe(80);
  });

  it('returns warn when score in [threshold-warnBand, threshold)', async () => {
    await activateFp();
    mockScore = 60; // threshold 70, warn band 15 → 55-69 is warn
    const result = await voiceGateDraft(productId, {
      artifact_type: 'email_draft',
      draft_content: 'borderline',
    });
    expect(result.verdict).toBe('warn');
    expect(result.suggested_action).toBe('review');
  });

  it('returns block when score < threshold - warnBand', async () => {
    await activateFp();
    mockScore = 30;
    const result = await voiceGateDraft(productId, {
      artifact_type: 'email_draft',
      draft_content: 'off voice',
    });
    expect(result.verdict).toBe('block');
    expect(result.suggested_action).toBe('rewrite');
  });

  it('respects custom threshold', async () => {
    await activateFp();
    mockScore = 75;
    const lenient = await voiceGateDraft(
      productId,
      { artifact_type: 'email_draft', draft_content: 'x' },
      { threshold: 60 }
    );
    expect(lenient.verdict).toBe('pass');

    mockScore = 50;
    const strict = await voiceGateDraft(
      productId,
      { artifact_type: 'email_draft', draft_content: 'x' },
      { threshold: 90 } // warn band 15 → block when score < 75
    );
    expect(strict.verdict).toBe('block');
  });

  it('blocks immediately on banned word (deterministic short-circuit)', async () => {
    await activateFp(['game-changer']);
    mockScore = 80; // would otherwise pass
    const result = await voiceGateDraft(productId, {
      artifact_type: 'email_draft',
      draft_content: 'This is a game-changer for your business.',
    });
    expect(result.verdict).toBe('block');
    expect(result.score).toBe(0);
  });
});
