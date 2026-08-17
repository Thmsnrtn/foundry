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
      scp_status TEXT DEFAULT 'active',
      entitlement_paused_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      category TEXT,
      gate INTEGER,
      what TEXT NOT NULL,
      why_now TEXT NOT NULL,
      recommendation TEXT,
      status TEXT DEFAULT 'pending',
      decided_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS action_drafts (
      id TEXT PRIMARY KEY,
      decision_id TEXT,
      product_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      draft_content TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      metadata TEXT,
      gate INTEGER NOT NULL,
      auto_executable INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      approved_at TEXT,
      executed_at TEXT,
      execution_result TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS auto_execution_log (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      action_draft_id TEXT,
      action_type TEXT NOT NULL,
      trigger TEXT NOT NULL,
      input_context TEXT,
      output TEXT,
      success INTEGER,
      error TEXT,
      executed_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS lifecycle_state (
      product_id TEXT PRIMARY KEY,
      wisdom_layer_active INTEGER DEFAULT 0,
      dna_completion_pct INTEGER DEFAULT 0
    );
  `);
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
