// =============================================================================
// FOUNDRY — Taste Journal Service (V3.1 Layer B)
// Per-product per-agent founder ratings of artifacts. Three anchors:
// feels_right | feels_off | missing_something.
//
// Ratings accumulate calibration data the agents can use as ground truth.
// Distinct from ai_output_feedback (per-founder generic 1-5 + dimensional
// flags); the journal is structured for in-voice/out-of-voice classification.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TasteRating = 'feels_right' | 'feels_off' | 'missing_something';

export interface TasteEntry {
  id: string;
  product_id: string;
  agent_name: string;
  artifact_type: string;
  artifact_excerpt: string;
  artifact_full_id: string | null;
  rating: TasteRating;
  rating_dimensions: Record<string, boolean>;
  founder_notes: string | null;
  rated_at: string;
  rated_in_session_id: string | null;
}

export interface RecordRatingInput {
  artifact_type: string;
  artifact_excerpt: string;
  artifact_full_id?: string | null;
  rating: TasteRating;
  rating_dimensions?: Record<string, boolean>;
  founder_notes?: string | null;
  rated_in_session_id?: string | null;
}

export interface CalibrationSession {
  session_id: string;
  product_id: string;
  agent_name: string;
  started_at: string;
  recent_ratings_summary: {
    feels_right_count: number;
    feels_off_count: number;
    missing_count: number;
    total_in_window: number;
  };
}

export interface PromptDistillation {
  product_id: string;
  agent_name: string;
  feels_right_count: number;
  feels_off_count: number;
  missing_count: number;
  /**
   * Compact text block for prompt injection. Empty string when no ratings.
   */
  prompt_block: string;
  representative_notes: {
    feels_right: string[];
    feels_off: string[];
    missing: string[];
  };
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function parseDimensions(value: unknown): Record<string, boolean> {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(parsed)) out[k] = Boolean(v);
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function rowToEntry(r: Record<string, unknown>): TasteEntry {
  return {
    id: r.id as string,
    product_id: r.product_id as string,
    agent_name: r.agent_name as string,
    artifact_type: r.artifact_type as string,
    artifact_excerpt: r.artifact_excerpt as string,
    artifact_full_id: (r.artifact_full_id as string | null) ?? null,
    rating: (r.rating as TasteRating) ?? 'feels_off',
    rating_dimensions: parseDimensions(r.rating_dimensions),
    founder_notes: (r.founder_notes as string | null) ?? null,
    rated_at: r.rated_at as string,
    rated_in_session_id: (r.rated_in_session_id as string | null) ?? null,
  };
}

// ─── Writes ───────────────────────────────────────────────────────────────────

const VALID_RATINGS: TasteRating[] = ['feels_right', 'feels_off', 'missing_something'];

export async function recordRating(
  productId: string,
  agentName: string,
  input: RecordRatingInput
): Promise<TasteEntry> {
  if (!VALID_RATINGS.includes(input.rating)) {
    throw new Error(
      `invalid rating "${input.rating}"; expected one of ${VALID_RATINGS.join('|')}`
    );
  }
  if (!input.artifact_excerpt || input.artifact_excerpt.trim().length === 0) {
    throw new Error('artifact_excerpt is required');
  }

  const id = nanoid();
  await query(
    `INSERT INTO taste_journals
       (id, product_id, agent_name, artifact_type, artifact_excerpt,
        artifact_full_id, rating, rating_dimensions, founder_notes,
        rated_in_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      productId,
      agentName,
      input.artifact_type,
      input.artifact_excerpt,
      input.artifact_full_id ?? null,
      input.rating,
      JSON.stringify(input.rating_dimensions ?? {}),
      input.founder_notes ?? null,
      input.rated_in_session_id ?? null,
    ]
  );

  const result = await query(`SELECT * FROM taste_journals WHERE id = ?`, [id]);
  return rowToEntry(result.rows[0] as Record<string, unknown>);
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function listRatings(
  productId: string,
  options?: { agent_name?: string; limit?: number }
): Promise<TasteEntry[]> {
  const limit = options?.limit ?? 50;
  if (options?.agent_name) {
    const result = await query(
      `SELECT * FROM taste_journals
       WHERE product_id = ? AND agent_name = ?
       ORDER BY rated_at DESC LIMIT ?`,
      [productId, options.agent_name, limit]
    );
    return (result.rows as Record<string, unknown>[]).map(rowToEntry);
  }
  const result = await query(
    `SELECT * FROM taste_journals
     WHERE product_id = ?
     ORDER BY rated_at DESC LIMIT ?`,
    [productId, limit]
  );
  return (result.rows as Record<string, unknown>[]).map(rowToEntry);
}

export async function getRatingsSince(
  productId: string,
  agentName: string,
  sinceIso: string
): Promise<TasteEntry[]> {
  const result = await query(
    `SELECT * FROM taste_journals
     WHERE product_id = ? AND agent_name = ?
       AND rated_at >= ?
     ORDER BY rated_at DESC`,
    [productId, agentName, sinceIso]
  );
  return (result.rows as Record<string, unknown>[]).map(rowToEntry);
}

export async function getSessionRatings(
  sessionId: string
): Promise<TasteEntry[]> {
  const result = await query(
    `SELECT * FROM taste_journals
     WHERE rated_in_session_id = ?
     ORDER BY rated_at ASC`,
    [sessionId]
  );
  return (result.rows as Record<string, unknown>[]).map(rowToEntry);
}

// ─── Calibration Session ──────────────────────────────────────────────────────

/**
 * Begin a calibration session for a product+agent. Returns a session_id
 * the caller passes to recordRating's `rated_in_session_id` for grouping.
 *
 * Includes a summary of ratings within a default 30-day window so the UI
 * can show "you've rated 8 things this month" context.
 */
export async function startCalibrationSession(
  productId: string,
  agentName: string,
  windowDays: number = 30
): Promise<CalibrationSession> {
  const sinceIso = `datetime('now', '-${windowDays} days')`;
  const summaryQ = await query(
    `SELECT
       SUM(CASE WHEN rating = 'feels_right' THEN 1 ELSE 0 END) AS feels_right_count,
       SUM(CASE WHEN rating = 'feels_off' THEN 1 ELSE 0 END) AS feels_off_count,
       SUM(CASE WHEN rating = 'missing_something' THEN 1 ELSE 0 END) AS missing_count,
       COUNT(*) AS total
     FROM taste_journals
     WHERE product_id = ? AND agent_name = ?
       AND rated_at >= ${sinceIso}`,
    [productId, agentName]
  );
  const r = summaryQ.rows[0] as Record<string, unknown> | undefined;

  return {
    session_id: nanoid(),
    product_id: productId,
    agent_name: agentName,
    started_at: new Date().toISOString(),
    recent_ratings_summary: {
      feels_right_count: Number(r?.feels_right_count ?? 0),
      feels_off_count: Number(r?.feels_off_count ?? 0),
      missing_count: Number(r?.missing_count ?? 0),
      total_in_window: Number(r?.total ?? 0),
    },
  };
}

// ─── Prompt Distillation ──────────────────────────────────────────────────────

/**
 * Distill recent ratings into a compact prompt block for agent system
 * prompt injection. Deterministic — no LLM call. Returns empty
 * prompt_block when there are zero ratings.
 *
 * Pulls up to `maxNotesPerCategory` representative founder_notes per
 * rating category, preferring the most recent.
 */
export async function summarizeForPrompt(
  productId: string,
  agentName: string,
  options?: { windowDays?: number; maxNotesPerCategory?: number }
): Promise<PromptDistillation> {
  const windowDays = options?.windowDays ?? 60;
  const maxPer = options?.maxNotesPerCategory ?? 3;
  const sinceIso = `datetime('now', '-${windowDays} days')`;

  const counts = await query(
    `SELECT
       SUM(CASE WHEN rating = 'feels_right' THEN 1 ELSE 0 END) AS feels_right_count,
       SUM(CASE WHEN rating = 'feels_off' THEN 1 ELSE 0 END) AS feels_off_count,
       SUM(CASE WHEN rating = 'missing_something' THEN 1 ELSE 0 END) AS missing_count
     FROM taste_journals
     WHERE product_id = ? AND agent_name = ?
       AND rated_at >= ${sinceIso}`,
    [productId, agentName]
  );
  const c = counts.rows[0] as Record<string, unknown> | undefined;
  const feelsRight = Number(c?.feels_right_count ?? 0);
  const feelsOff = Number(c?.feels_off_count ?? 0);
  const missing = Number(c?.missing_count ?? 0);

  const repNotes = {
    feels_right: await pickNotes(productId, agentName, 'feels_right', maxPer, sinceIso),
    feels_off: await pickNotes(productId, agentName, 'feels_off', maxPer, sinceIso),
    missing: await pickNotes(productId, agentName, 'missing_something', maxPer, sinceIso),
  };

  const promptBlock = buildPromptBlock(agentName, {
    feelsRight,
    feelsOff,
    missing,
    notes: repNotes,
  });

  return {
    product_id: productId,
    agent_name: agentName,
    feels_right_count: feelsRight,
    feels_off_count: feelsOff,
    missing_count: missing,
    prompt_block: promptBlock,
    representative_notes: repNotes,
  };
}

async function pickNotes(
  productId: string,
  agentName: string,
  rating: TasteRating,
  limit: number,
  sinceIso: string
): Promise<string[]> {
  const result = await query(
    `SELECT founder_notes FROM taste_journals
     WHERE product_id = ? AND agent_name = ? AND rating = ?
       AND founder_notes IS NOT NULL AND TRIM(founder_notes) != ''
       AND rated_at >= ${sinceIso}
     ORDER BY rated_at DESC LIMIT ?`,
    [productId, agentName, rating, limit]
  );
  return (result.rows as Record<string, unknown>[])
    .map(r => r.founder_notes as string)
    .filter(s => typeof s === 'string' && s.trim().length > 0);
}

function buildPromptBlock(
  agentName: string,
  parts: {
    feelsRight: number;
    feelsOff: number;
    missing: number;
    notes: PromptDistillation['representative_notes'];
  }
): string {
  const total = parts.feelsRight + parts.feelsOff + parts.missing;
  if (total === 0) return '';

  const lines: string[] = [];
  lines.push(`Taste calibration for ${agentName} (last 60 days, ${total} ratings):`);

  if (parts.feelsRight > 0) {
    lines.push(`Feels right (${parts.feelsRight}):`);
    for (const n of parts.notes.feels_right) lines.push(`  · ${n}`);
  }
  if (parts.feelsOff > 0) {
    lines.push(`Feels off (${parts.feelsOff}):`);
    for (const n of parts.notes.feels_off) lines.push(`  · ${n}`);
  }
  if (parts.missing > 0) {
    lines.push(`Missing something (${parts.missing}):`);
    for (const n of parts.notes.missing) lines.push(`  · ${n}`);
  }

  return lines.join('\n');
}
