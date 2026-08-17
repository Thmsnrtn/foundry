// =============================================================================
// Tests: V3.1 Layer B — Taste Journal Service
// Verifies CRUD, calibration session grouping, and prompt distillation.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';

import {
  recordRating,
  listRatings,
  getRatingsSince,
  getSessionRatings,
  startCalibrationSession,
  summarizeForPrompt,
} from '../../src/services/calibration/taste-journal.js';

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
  `);
  await executeRaw(readFileSync(resolve(__dirname, '../../src/db/migrations/064_taste_journals.sql'), 'utf-8'));
}

beforeAll(async () => {
  await setupSchema();
});

beforeEach(async () => {
  const { founderId: fId, productId: pId } = await createFounderAndProduct();
  founderId = fId;
  productId = pId;
});

// ─── recordRating ─────────────────────────────────────────────────────────────

describe('taste-journal: recordRating', () => {
  it('persists a basic rating', async () => {
    const entry = await recordRating(productId, 'beacon', {
      artifact_type: 'email_draft',
      artifact_excerpt: 'Welcome to our product, you will love it.',
      rating: 'feels_off',
      founder_notes: 'too generic',
    });
    expect(entry.rating).toBe('feels_off');
    expect(entry.agent_name).toBe('beacon');
    expect(entry.founder_notes).toBe('too generic');
  });

  it('rejects an invalid rating', async () => {
    await expect(
      recordRating(productId, 'beacon', {
        artifact_type: 'email_draft',
        artifact_excerpt: 'x',
        rating: 'meh' as 'feels_right',
      })
    ).rejects.toThrow(/invalid rating/);
  });

  it('rejects empty artifact_excerpt', async () => {
    await expect(
      recordRating(productId, 'beacon', {
        artifact_type: 'email_draft',
        artifact_excerpt: '   ',
        rating: 'feels_off',
      })
    ).rejects.toThrow(/artifact_excerpt is required/);
  });

  it('persists rating_dimensions as parsed JSON', async () => {
    const entry = await recordRating(productId, 'scribe', {
      artifact_type: 'blog_draft',
      artifact_excerpt: 'In this post we explore...',
      rating: 'feels_off',
      rating_dimensions: { tone_off: true, jargon_creep: true, claim_too_strong: false },
    });
    expect(entry.rating_dimensions).toEqual({
      tone_off: true,
      jargon_creep: true,
      claim_too_strong: false,
    });
  });
});

// ─── listRatings / getRatingsSince ────────────────────────────────────────────

describe('taste-journal: reads', () => {
  beforeEach(async () => {
    await recordRating(productId, 'beacon', {
      artifact_type: 'email_draft',
      artifact_excerpt: 'a',
      rating: 'feels_right',
    });
    await recordRating(productId, 'beacon', {
      artifact_type: 'email_draft',
      artifact_excerpt: 'b',
      rating: 'feels_off',
    });
    await recordRating(productId, 'scribe', {
      artifact_type: 'blog_draft',
      artifact_excerpt: 'c',
      rating: 'missing_something',
    });
  });

  it('listRatings returns all when no agent_name filter', async () => {
    const all = await listRatings(productId);
    expect(all.length).toBe(3);
  });

  it('listRatings filters by agent_name', async () => {
    const beacon = await listRatings(productId, { agent_name: 'beacon' });
    expect(beacon.length).toBe(2);
    expect(beacon.every(r => r.agent_name === 'beacon')).toBe(true);
  });

  it('listRatings respects limit', async () => {
    const limited = await listRatings(productId, { limit: 1 });
    expect(limited.length).toBe(1);
  });

  it('getRatingsSince filters by timestamp', async () => {
    // Use a future date — should return zero
    const future = await getRatingsSince(productId, 'beacon', '2099-01-01T00:00:00.000Z');
    expect(future.length).toBe(0);
    // Past date — should return both beacon ratings
    const past = await getRatingsSince(productId, 'beacon', '2000-01-01T00:00:00.000Z');
    expect(past.length).toBe(2);
  });
});

// ─── Calibration Session ──────────────────────────────────────────────────────

describe('taste-journal: startCalibrationSession', () => {
  it('returns a session_id and zero summary when no prior ratings', async () => {
    const sess = await startCalibrationSession(productId, 'beacon');
    expect(sess.session_id).toBeTruthy();
    expect(sess.recent_ratings_summary).toEqual({
      feels_right_count: 0,
      feels_off_count: 0,
      missing_count: 0,
      total_in_window: 0,
    });
  });

  it('summarizes ratings within the window', async () => {
    for (let i = 0; i < 3; i++) {
      await recordRating(productId, 'beacon', {
        artifact_type: 'email_draft',
        artifact_excerpt: `a${i}`,
        rating: 'feels_right',
      });
    }
    await recordRating(productId, 'beacon', {
      artifact_type: 'email_draft',
      artifact_excerpt: 'off',
      rating: 'feels_off',
    });
    const sess = await startCalibrationSession(productId, 'beacon');
    expect(sess.recent_ratings_summary.feels_right_count).toBe(3);
    expect(sess.recent_ratings_summary.feels_off_count).toBe(1);
    expect(sess.recent_ratings_summary.total_in_window).toBe(4);
  });

  it('groups ratings by session_id when passed through recordRating', async () => {
    const sess = await startCalibrationSession(productId, 'beacon');
    await recordRating(productId, 'beacon', {
      artifact_type: 'email_draft',
      artifact_excerpt: 'a',
      rating: 'feels_right',
      rated_in_session_id: sess.session_id,
    });
    await recordRating(productId, 'beacon', {
      artifact_type: 'email_draft',
      artifact_excerpt: 'b',
      rating: 'feels_off',
      rated_in_session_id: sess.session_id,
    });
    // Unrelated rating without session id
    await recordRating(productId, 'beacon', {
      artifact_type: 'email_draft',
      artifact_excerpt: 'c',
      rating: 'feels_right',
    });
    const grouped = await getSessionRatings(sess.session_id);
    expect(grouped.length).toBe(2);
    expect(grouped.map(r => r.artifact_excerpt).sort()).toEqual(['a', 'b']);
  });
});

// ─── Prompt Distillation ──────────────────────────────────────────────────────

describe('taste-journal: summarizeForPrompt', () => {
  it('returns empty prompt_block when no ratings', async () => {
    const dist = await summarizeForPrompt(productId, 'beacon');
    expect(dist.feels_right_count).toBe(0);
    expect(dist.prompt_block).toBe('');
  });

  it('includes representative notes per category', async () => {
    await recordRating(productId, 'beacon', {
      artifact_type: 'email',
      artifact_excerpt: 'a',
      rating: 'feels_right',
      founder_notes: 'short and direct',
    });
    await recordRating(productId, 'beacon', {
      artifact_type: 'email',
      artifact_excerpt: 'b',
      rating: 'feels_off',
      founder_notes: 'too jargony',
    });
    await recordRating(productId, 'beacon', {
      artifact_type: 'email',
      artifact_excerpt: 'c',
      rating: 'missing_something',
      founder_notes: 'no concrete example',
    });
    const dist = await summarizeForPrompt(productId, 'beacon');
    expect(dist.prompt_block).toContain('Taste calibration for beacon');
    expect(dist.prompt_block).toContain('short and direct');
    expect(dist.prompt_block).toContain('too jargony');
    expect(dist.prompt_block).toContain('no concrete example');
  });

  it('caps notes per category at maxNotesPerCategory', async () => {
    for (let i = 0; i < 5; i++) {
      await recordRating(productId, 'beacon', {
        artifact_type: 'email',
        artifact_excerpt: `a${i}`,
        rating: 'feels_right',
        founder_notes: `note ${i}`,
      });
    }
    const dist = await summarizeForPrompt(productId, 'beacon', {
      maxNotesPerCategory: 2,
    });
    expect(dist.representative_notes.feels_right.length).toBe(2);
  });

  it('omits empty/null founder_notes from representative samples', async () => {
    await recordRating(productId, 'beacon', {
      artifact_type: 'email',
      artifact_excerpt: 'a',
      rating: 'feels_right',
      founder_notes: 'has note',
    });
    await recordRating(productId, 'beacon', {
      artifact_type: 'email',
      artifact_excerpt: 'b',
      rating: 'feels_right',
      // no founder_notes
    });
    const dist = await summarizeForPrompt(productId, 'beacon');
    // Only 1 representative note despite 2 ratings
    expect(dist.representative_notes.feels_right).toEqual(['has note']);
    // But the count is still 2
    expect(dist.feels_right_count).toBe(2);
  });
});
