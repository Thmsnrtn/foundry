// =============================================================================
// Tests: V3.1 Layer B — Voice gate wired into action_drafts pipeline
// Verifies the four behaviors at the generateActionDraft boundary:
//   no fingerprint     → unchanged (auto_executable preserved)
//   exempt artifact    → unchanged
//   pass               → unchanged
//   block              → auto_executable forced false + description tagged
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

// Mock the AI client. callSonnet is invoked twice in the wired flow:
//   1. Action-draft generation — returns title/description/draft_content/execution_notes
//   2. Voice score (only when an active fingerprint exists) — returns voice JSON
// We dispatch on the system prompt: voice judge prompt starts with "You are a
// voice-and-tone judge"; action prompt starts with "You are a COO".
let mockVoiceScore = 80;
vi.mock('../../src/services/ai/client.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/ai/client.js')>(
    '../../src/services/ai/client.js'
  );
  return {
    ...actual,
    callSonnet: vi.fn(async (system: string) => {
      if (system.includes('voice-and-tone judge')) {
        return {
          content: `{"score":${mockVoiceScore},"register":${mockVoiceScore},"rhythm":${mockVoiceScore},"lexical":${mockVoiceScore},"energy":${mockVoiceScore},"rationale":"test"}`,
          usage: { input_tokens: 10, output_tokens: 10 },
        };
      }
      return {
        content: JSON.stringify({
          title: 'Reach out to dormant trial',
          description: 'Send a brief check-in email to a dormant trial user.',
          draft_content: 'Hi there — wanted to check in.',
          execution_notes: 'Queued for delivery on approve.',
        }),
        usage: { input_tokens: 10, output_tokens: 10 },
      };
    }),
    callOpus: vi.fn(async () => ({
      content: JSON.stringify({
        title: 'Strategic move',
        description: 'High-stakes artifact.',
        draft_content: 'Stakes content.',
        execution_notes: 'On approve.',
      }),
      usage: { input_tokens: 10, output_tokens: 10 },
    })),
    parseJSONResponse: actual.parseJSONResponse,
  };
});

import { generateActionDraft } from '../../src/services/decisions/actions.js';
import {
  createDraftFingerprint,
  activateFingerprint,
} from '../../src/services/calibration/voice-fingerprint.js';

// ─── Setup ────────────────────────────────────────────────────────────────────

let founderId: string;
let productId: string;

async function setupSchema(): Promise<void> {
  await executeRaw(
    readFileSync(
      resolve(__dirname, '../../src/db/migrations/063_product_voice_fingerprints.sql'),
      'utf-8'
    )
  );
}

async function createFounderAndProduct() {
  const fId = nanoid();
  const pId = nanoid();
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, tier) VALUES (?, ?, ?, ?)`,
    [fId, `clerk_${fId}`, `${fId}@test.local`, 'growth']
  );
  await query(`INSERT INTO products (id, name, owner_id) VALUES (?, ?, ?)`, [pId, 'Test', fId]);
  return { founderId: fId, productId: pId };
}

async function insertDecision(
  pId: string,
  what: string,
  category: 'urgent' | 'strategic' | 'product' | 'marketing' | 'informational',
  gate: number
): Promise<string> {
  const dId = nanoid();
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now) VALUES (?, ?, ?, ?, ?, ?)`,
    [dId, pId, category, gate, what, 'because reasons']
  );
  return dId;
}

async function activateFp(productId: string) {
  const fp = await createDraftFingerprint(productId, {
    register: 'plainspoken',
    energy: 'measured',
    exemplar_sentences: ['One.', 'Two.', 'Three.', 'Four.', 'Five.'],
  });
  await activateFingerprint(fp.id);
}

beforeAll(async () => {
  // The migrations are the schema. Tables this file used to write by hand are
  // already here, in the shape the product actually has — including the NOT
  // NULL columns and foreign keys a hand-written stand-in leaves out.
  await runMigrations();
  await setupSchema();
});

beforeEach(async () => {
  const { founderId: fId, productId: pId } = await createFounderAndProduct();
  founderId = fId;
  productId = pId;
  mockVoiceScore = 80;
});

// ─── Behavior at each verdict ─────────────────────────────────────────────────

describe('generateActionDraft + voice gate', () => {
  it('no_fingerprint: voice-bearing artifact draft is unchanged when no fingerprint exists', async () => {
    // gate=1 email decision, no active fingerprint → wire-in must not modify
    const dId = await insertDecision(productId, 'send email to dormant user', 'marketing', 1);
    const draft = await generateActionDraft(dId, productId, founderId);

    expect(draft.artifact_type).toBe('email_draft');
    expect(draft.auto_executable).toBe(false); // gate=1, not gate=0
    // Description should NOT carry a [voice:...] tag
    expect(draft.description.startsWith('[voice:')).toBe(false);
  });

  it('exempt: non-voice-bearing artifact (internal_memo) is unchanged even with fingerprint', async () => {
    await activateFp(productId);
    mockVoiceScore = 0; // would block IF scored — must not be scored
    const dId = await insertDecision(productId, 'log strategic notes', 'informational', 1);
    const draft = await generateActionDraft(dId, productId, founderId);

    expect(draft.artifact_type).toBe('internal_memo');
    expect(draft.description.startsWith('[voice:')).toBe(false);
  });

  it('pass: voice-bearing artifact with high score is unchanged', async () => {
    await activateFp(productId);
    mockVoiceScore = 85;
    const dId = await insertDecision(productId, 'send email to lapsed customer', 'marketing', 1);
    const draft = await generateActionDraft(dId, productId, founderId);

    expect(draft.artifact_type).toBe('email_draft');
    expect(draft.description.startsWith('[voice:')).toBe(false);
  });

  it('block: voice-bearing artifact with low score gets tagged + auto_executable forced false', async () => {
    await activateFp(productId);
    mockVoiceScore = 30; // threshold 70, warn band 15 → block
    // Use gate=0 so auto_executable would otherwise be true; verify it's overridden.
    const dId = await insertDecision(productId, 'send email to trial user', 'marketing', 0);
    const draft = await generateActionDraft(dId, productId, founderId);

    expect(draft.artifact_type).toBe('email_draft');
    expect(draft.auto_executable).toBe(false);
    expect(draft.status).toBe('draft');
    expect(draft.description.startsWith('[voice:block 30]')).toBe(true);

    // Persisted row reflects the override
    const row = await query('SELECT auto_executable, status, description FROM action_drafts WHERE id = ?', [draft.id]);
    const r = row.rows[0] as Record<string, unknown>;
    expect(r.auto_executable).toBe(0);
    expect(r.status).toBe('draft');
    expect(String(r.description).startsWith('[voice:block 30]')).toBe(true);
  });

  it('warn: voice-bearing artifact with mid score gets tagged + auto_executable forced false', async () => {
    await activateFp(productId);
    mockVoiceScore = 60; // threshold 70, warn band 15 → warn (in [55, 70))
    const dId = await insertDecision(productId, 'send email to inactive user', 'marketing', 0);
    const draft = await generateActionDraft(dId, productId, founderId);

    expect(draft.auto_executable).toBe(false);
    expect(draft.description.startsWith('[voice:warn 60]')).toBe(true);
  });
});
