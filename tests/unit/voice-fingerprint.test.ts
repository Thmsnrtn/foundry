// =============================================================================
// Tests: V3.1 Layer B — Voice Fingerprint Service
// Verifies CRUD, activation gate (≥5 exemplars), single-active invariant,
// and deterministic-check short-circuits in scoring.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

// Mock the AI client BEFORE importing the service. We do not want real
// LLM calls in tests; the deterministic checks (banned words, anti-exemplars)
// short-circuit before ever consulting the judge in the cases we test.
vi.mock('../../src/services/ai/client.js', () => ({
  callSonnet: vi.fn(async () => ({
    content: '{"score":80,"register":80,"rhythm":80,"lexical":80,"energy":80,"rationale":"In voice"}',
    usage: { input_tokens: 100, output_tokens: 50 },
  })),
}));

import {
  createDraftFingerprint,
  updateDraftFingerprint,
  activateFingerprint,
  archiveFingerprint,
  getActiveFingerprint,
  getFingerprint,
  listFingerprintHistory,
  scoreArtifactAgainstVoice,
} from '../../src/services/calibration/voice-fingerprint.js';

// ─── Setup ────────────────────────────────────────────────────────────────────

let founderId: string;
let productId: string;

async function createFounderAndProduct(): Promise<{ founderId: string; productId: string }> {
  const fId = nanoid();
  const pId = nanoid();
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, name, tier)
     VALUES (?, ?, ?, ?, ?)`,
    [fId, `clerk_${fId}`, `${fId}@test.local`, 'Test', 'growth']
  );
  await query(
    `INSERT INTO products (id, name, owner_id) VALUES (?, ?, ?)`,
    [pId, 'Test Product', fId]
  );
  return { founderId: fId, productId: pId };
}

async function setupSchema(): Promise<void> {
  await executeRaw(`
  `);
  await executeRaw(readFileSync(resolve(__dirname, '../../src/db/migrations/063_product_voice_fingerprints.sql'), 'utf-8'));
}

beforeAll(async () => {
  // The migrations are the schema. Anything this file used to create by hand
  // is already here, in the shape the product actually has — a fixture that
  // disagrees with the schema proves nothing about the product.
  await runMigrations();
  await setupSchema();
});

beforeEach(async () => {
  const { founderId: fId, productId: pId } = await createFounderAndProduct();
  founderId = fId;
  productId = pId;
});

// ─── CRUD ─────────────────────────────────────────────────────────────────────

describe('voice-fingerprint: createDraftFingerprint', () => {
  it('creates first version with status draft', async () => {
    const fp = await createDraftFingerprint(productId, {
      register: 'plainspoken',
      energy: 'measured',
      pov: 'we',
    });
    expect(fp.version).toBe(1);
    expect(fp.status).toBe('draft');
    expect(fp.register).toBe('plainspoken');
  });

  it('increments version per product', async () => {
    const v1 = await createDraftFingerprint(productId);
    const v2 = await createDraftFingerprint(productId);
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
  });

  it('persists list fields as JSON arrays', async () => {
    const fp = await createDraftFingerprint(productId, {
      lexical_preferences: ['Signal', 'frame', 'destination'],
      banned_words: ['game-changer', 'synergize'],
      anti_exemplars: ['Unlock unprecedented growth opportunities'],
      exemplar_sentences: ['One. Two. Three.'],
    });
    expect(fp.lexical_preferences).toEqual(['Signal', 'frame', 'destination']);
    expect(fp.banned_words).toEqual(['game-changer', 'synergize']);
    expect(fp.anti_exemplars).toEqual(['Unlock unprecedented growth opportunities']);
    expect(fp.exemplar_sentences).toEqual(['One. Two. Three.']);
  });
});

describe('voice-fingerprint: updateDraftFingerprint', () => {
  it('updates only provided fields', async () => {
    const fp = await createDraftFingerprint(productId, {
      register: 'plainspoken',
      energy: 'measured',
    });
    const updated = await updateDraftFingerprint(fp.id, { register: 'irreverent' });
    expect(updated.register).toBe('irreverent');
    expect(updated.energy).toBe('measured');
  });

  it('refuses to update an active fingerprint', async () => {
    const fp = await createDraftFingerprint(productId, {
      exemplar_sentences: ['a', 'b', 'c', 'd', 'e'],
    });
    await activateFingerprint(fp.id);
    await expect(
      updateDraftFingerprint(fp.id, { register: 'irreverent' })
    ).rejects.toThrow(/not draft/);
  });
});

// ─── Activation Rules ─────────────────────────────────────────────────────────

describe('voice-fingerprint: activateFingerprint', () => {
  it('refuses activation when exemplar count < 5', async () => {
    const fp = await createDraftFingerprint(productId, {
      exemplar_sentences: ['a', 'b'],
    });
    await expect(activateFingerprint(fp.id)).rejects.toThrow(/at least 5/);
  });

  it('activates draft when exemplar count >= 5', async () => {
    const fp = await createDraftFingerprint(productId, {
      exemplar_sentences: ['a', 'b', 'c', 'd', 'e'],
    });
    const activated = await activateFingerprint(fp.id);
    expect(activated.status).toBe('active');
    expect(activated.activated_at).toBeTruthy();
  });

  it('archives prior active fingerprint when a new one activates', async () => {
    const fp1 = await createDraftFingerprint(productId, {
      exemplar_sentences: ['a', 'b', 'c', 'd', 'e'],
    });
    await activateFingerprint(fp1.id);
    const fp2 = await createDraftFingerprint(productId, {
      exemplar_sentences: ['x', 'y', 'z', 'q', 'r'],
    });
    await activateFingerprint(fp2.id);

    const after1 = await getFingerprint(fp1.id);
    expect(after1?.status).toBe('archived');
    const active = await getActiveFingerprint(productId);
    expect(active?.id).toBe(fp2.id);
  });

  it('refuses to re-activate an archived fingerprint', async () => {
    const fp = await createDraftFingerprint(productId, {
      exemplar_sentences: ['a', 'b', 'c', 'd', 'e'],
    });
    await activateFingerprint(fp.id);
    await archiveFingerprint(fp.id);
    await expect(activateFingerprint(fp.id)).rejects.toThrow(/cannot activate archived/);
  });

  it('is idempotent on already-active fingerprint', async () => {
    const fp = await createDraftFingerprint(productId, {
      exemplar_sentences: ['a', 'b', 'c', 'd', 'e'],
    });
    await activateFingerprint(fp.id);
    const again = await activateFingerprint(fp.id);
    expect(again.status).toBe('active');
  });

  it('listFingerprintHistory returns all versions newest-first', async () => {
    await createDraftFingerprint(productId);
    await createDraftFingerprint(productId);
    await createDraftFingerprint(productId);
    const history = await listFingerprintHistory(productId);
    expect(history.map(f => f.version)).toEqual([3, 2, 1]);
  });
});

// ─── Scoring ──────────────────────────────────────────────────────────────────

describe('voice-fingerprint: scoreArtifactAgainstVoice', () => {
  it('returns null when no active fingerprint exists', async () => {
    const result = await scoreArtifactAgainstVoice(productId, 'any text');
    expect(result).toBeNull();
  });

  it('short-circuits to score=0 when banned word is present', async () => {
    const fp = await createDraftFingerprint(productId, {
      banned_words: ['synergize'],
      exemplar_sentences: ['a', 'b', 'c', 'd', 'e'],
    });
    await activateFingerprint(fp.id);
    const result = await scoreArtifactAgainstVoice(
      productId,
      'We will Synergize across the platform.'
    );
    expect(result?.score).toBe(0);
    expect(result?.in_voice).toBe(false);
    expect(result?.breakdown.avoids_banned_words).toBe(false);
    expect(result?.rationale).toContain('synergize');
  });

  it('short-circuits to score=0 on anti-exemplar echo', async () => {
    const fp = await createDraftFingerprint(productId, {
      anti_exemplars: ['Unlock unprecedented growth opportunities'],
      exemplar_sentences: ['a', 'b', 'c', 'd', 'e'],
    });
    await activateFingerprint(fp.id);
    const result = await scoreArtifactAgainstVoice(
      productId,
      'Try our solution to unlock unprecedented growth opportunities today.'
    );
    expect(result?.score).toBe(0);
    expect(result?.breakdown.avoids_anti_exemplars).toBe(false);
  });

  it('calls LLM judge when deterministic checks pass', async () => {
    const fp = await createDraftFingerprint(productId, {
      exemplar_sentences: ['One.', 'Two.', 'Three.', 'Four.', 'Five.'],
    });
    await activateFingerprint(fp.id);
    const result = await scoreArtifactAgainstVoice(productId, 'Some clean draft text.');
    // Mock returns score 80
    expect(result?.score).toBe(80);
    expect(result?.in_voice).toBe(true);
  });

  it('respects custom threshold for in_voice flag', async () => {
    const fp = await createDraftFingerprint(productId, {
      exemplar_sentences: ['One.', 'Two.', 'Three.', 'Four.', 'Five.'],
    });
    await activateFingerprint(fp.id);
    const lenient = await scoreArtifactAgainstVoice(productId, 'draft', { threshold: 60 });
    const strict = await scoreArtifactAgainstVoice(productId, 'draft', { threshold: 90 });
    expect(lenient?.in_voice).toBe(true);
    expect(strict?.in_voice).toBe(false);
  });
});
