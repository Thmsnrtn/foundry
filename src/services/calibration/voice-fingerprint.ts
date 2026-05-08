// =============================================================================
// FOUNDRY — Product Voice Fingerprint Service (V3.1 Layer B)
// Per-product writing-voice signature. Uses LLM-as-judge to score artifacts
// against a founder-curated exemplar corpus + register/energy/pov rules.
//
// Distinct from:
//   - founder_voice (founder's communication style across all products)
//   - src/services/voice/* (audio briefings)
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { callSonnet } from '../ai/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FingerprintStatus = 'draft' | 'active' | 'archived';
export type FingerprintSource = 'founder' | 'llm_distilled' | 'mixed';

export interface VoiceFingerprint {
  id: string;
  product_id: string;
  version: number;
  status: FingerprintStatus;
  sentence_rhythm: string | null;
  lexical_preferences: string[];
  banned_words: string[];
  register: string | null;
  energy: string | null;
  pov: string | null;
  anti_exemplars: string[];
  exemplar_sentences: string[];
  source: FingerprintSource;
  notes: string | null;
  activated_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDraftInput {
  sentence_rhythm?: string | null;
  lexical_preferences?: string[];
  banned_words?: string[];
  register?: string | null;
  energy?: string | null;
  pov?: string | null;
  anti_exemplars?: string[];
  exemplar_sentences?: string[];
  source?: FingerprintSource;
  notes?: string | null;
}

export interface UpdateDraftInput extends CreateDraftInput {}

export interface VoiceScore {
  score: number;                // 0-100
  in_voice: boolean;            // score >= 70 by default
  threshold: number;
  breakdown: {
    register_match: number;     // 0-100
    rhythm_match: number;       // 0-100
    lexical_match: number;      // 0-100
    energy_match: number;       // 0-100
    avoids_banned_words: boolean;
    avoids_anti_exemplars: boolean;
  };
  rationale: string;
}

// Minimum exemplar count required to activate a fingerprint. Below this,
// LLM-as-judge has insufficient ground truth.
const MIN_EXEMPLARS_FOR_ACTIVE = 5;
const DEFAULT_VOICE_THRESHOLD = 70;

// ─── Mapper ───────────────────────────────────────────────────────────────────

function parseList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
    return [];
  } catch {
    return [];
  }
}

function rowToFingerprint(r: Record<string, unknown>): VoiceFingerprint {
  return {
    id: r.id as string,
    product_id: r.product_id as string,
    version: Number(r.version ?? 1),
    status: (r.status as FingerprintStatus) ?? 'draft',
    sentence_rhythm: (r.sentence_rhythm as string | null) ?? null,
    lexical_preferences: parseList(r.lexical_preferences),
    banned_words: parseList(r.banned_words),
    register: (r.register as string | null) ?? null,
    energy: (r.energy as string | null) ?? null,
    pov: (r.pov as string | null) ?? null,
    anti_exemplars: parseList(r.anti_exemplars),
    exemplar_sentences: parseList(r.exemplar_sentences),
    source: (r.source as FingerprintSource) ?? 'founder',
    notes: (r.notes as string | null) ?? null,
    activated_at: (r.activated_at as string | null) ?? null,
    archived_at: (r.archived_at as string | null) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function getActiveFingerprint(productId: string): Promise<VoiceFingerprint | null> {
  const result = await query(
    `SELECT * FROM product_voice_fingerprints
     WHERE product_id = ? AND status = 'active'
     LIMIT 1`,
    [productId]
  );
  if (result.rows.length === 0) return null;
  return rowToFingerprint(result.rows[0] as Record<string, unknown>);
}

export async function getFingerprint(id: string): Promise<VoiceFingerprint | null> {
  const result = await query(
    `SELECT * FROM product_voice_fingerprints WHERE id = ?`,
    [id]
  );
  if (result.rows.length === 0) return null;
  return rowToFingerprint(result.rows[0] as Record<string, unknown>);
}

export async function listFingerprintHistory(
  productId: string,
  limit: number = 20
): Promise<VoiceFingerprint[]> {
  const result = await query(
    `SELECT * FROM product_voice_fingerprints
     WHERE product_id = ?
     ORDER BY version DESC LIMIT ?`,
    [productId, limit]
  );
  return (result.rows as Record<string, unknown>[]).map(rowToFingerprint);
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function createDraftFingerprint(
  productId: string,
  input: CreateDraftInput = {}
): Promise<VoiceFingerprint> {
  // Determine next version number
  const versionResult = await query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
     FROM product_voice_fingerprints WHERE product_id = ?`,
    [productId]
  );
  const nextVersion = Number(
    (versionResult.rows[0] as Record<string, unknown> | undefined)?.next_version ?? 1
  );

  const id = nanoid();
  await query(
    `INSERT INTO product_voice_fingerprints
       (id, product_id, version, status, sentence_rhythm, lexical_preferences,
        banned_words, register, energy, pov, anti_exemplars, exemplar_sentences,
        source, notes)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      productId,
      nextVersion,
      input.sentence_rhythm ?? null,
      JSON.stringify(input.lexical_preferences ?? []),
      JSON.stringify(input.banned_words ?? []),
      input.register ?? null,
      input.energy ?? null,
      input.pov ?? null,
      JSON.stringify(input.anti_exemplars ?? []),
      JSON.stringify(input.exemplar_sentences ?? []),
      input.source ?? 'founder',
      input.notes ?? null,
    ]
  );

  const created = await getFingerprint(id);
  if (!created) throw new Error(`failed to create voice fingerprint ${id}`);
  return created;
}

export async function updateDraftFingerprint(
  id: string,
  input: UpdateDraftInput
): Promise<VoiceFingerprint> {
  const existing = await getFingerprint(id);
  if (!existing) throw new Error(`fingerprint ${id} not found`);
  if (existing.status !== 'draft') {
    throw new Error(
      `fingerprint ${id} is ${existing.status}, not draft; ` +
      `create a new draft to make changes`
    );
  }

  const sets: string[] = [];
  const args: unknown[] = [];
  const fieldsScalar: Array<keyof UpdateDraftInput> = [
    'sentence_rhythm',
    'register',
    'energy',
    'pov',
    'source',
    'notes',
  ];
  for (const f of fieldsScalar) {
    if (Object.prototype.hasOwnProperty.call(input, f)) {
      sets.push(`${f} = ?`);
      args.push((input as Record<string, unknown>)[f] ?? null);
    }
  }
  const fieldsArray: Array<keyof UpdateDraftInput> = [
    'lexical_preferences',
    'banned_words',
    'anti_exemplars',
    'exemplar_sentences',
  ];
  for (const f of fieldsArray) {
    if (Object.prototype.hasOwnProperty.call(input, f)) {
      sets.push(`${f} = ?`);
      args.push(JSON.stringify((input as Record<string, unknown>)[f] ?? []));
    }
  }
  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  args.push(id);
  await query(
    `UPDATE product_voice_fingerprints SET ${sets.join(', ')} WHERE id = ?`,
    args
  );
  const updated = await getFingerprint(id);
  if (!updated) throw new Error(`fingerprint ${id} disappeared after update`);
  return updated;
}

/**
 * Activate a draft fingerprint. Refuses if exemplar count is below the
 * minimum (LLM-as-judge has insufficient ground truth). Archives any
 * currently-active fingerprint as a side effect.
 */
export async function activateFingerprint(id: string): Promise<VoiceFingerprint> {
  const fp = await getFingerprint(id);
  if (!fp) throw new Error(`fingerprint ${id} not found`);
  if (fp.status === 'active') return fp;
  if (fp.status === 'archived') {
    throw new Error(`cannot activate archived fingerprint ${id}; create a new draft`);
  }
  if (fp.exemplar_sentences.length < MIN_EXEMPLARS_FOR_ACTIVE) {
    throw new Error(
      `fingerprint ${id} has ${fp.exemplar_sentences.length} exemplars; ` +
      `at least ${MIN_EXEMPLARS_FOR_ACTIVE} are required to activate`
    );
  }

  // Archive existing active fingerprint (if any)
  await query(
    `UPDATE product_voice_fingerprints
     SET status = 'archived', archived_at = datetime('now'),
         updated_at = datetime('now')
     WHERE product_id = ? AND status = 'active'`,
    [fp.product_id]
  );

  // Activate this one
  await query(
    `UPDATE product_voice_fingerprints
     SET status = 'active', activated_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ?`,
    [id]
  );

  const updated = await getFingerprint(id);
  if (!updated) throw new Error(`fingerprint ${id} disappeared after activation`);
  return updated;
}

export async function archiveFingerprint(id: string): Promise<void> {
  await query(
    `UPDATE product_voice_fingerprints
     SET status = 'archived', archived_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ? AND status != 'archived'`,
    [id]
  );
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Score a draft artifact against the active fingerprint for a product.
 * Returns null when no active fingerprint exists (caller should treat as
 * "no opinion" rather than "fail").
 *
 * Uses Sonnet as judge with the fingerprint's exemplars + rules. The
 * deterministic checks (banned_words, anti_exemplars) run client-side
 * and short-circuit when they match, so the LLM is only consulted when
 * fast checks pass.
 */
export async function scoreArtifactAgainstVoice(
  productId: string,
  draftText: string,
  options?: { threshold?: number }
): Promise<VoiceScore | null> {
  const fp = await getActiveFingerprint(productId);
  if (!fp) return null;

  const threshold = options?.threshold ?? DEFAULT_VOICE_THRESHOLD;

  // Deterministic checks first
  const lower = draftText.toLowerCase();
  const bannedHit = fp.banned_words.find(w => lower.includes(w.toLowerCase()));
  if (bannedHit) {
    return {
      score: 0,
      in_voice: false,
      threshold,
      breakdown: {
        register_match: 0,
        rhythm_match: 0,
        lexical_match: 0,
        energy_match: 0,
        avoids_banned_words: false,
        avoids_anti_exemplars: true,
      },
      rationale: `Contains banned word/phrase: "${bannedHit}"`,
    };
  }
  const antiHit = fp.anti_exemplars.find(a =>
    a.length > 4 && lower.includes(a.toLowerCase())
  );
  if (antiHit) {
    return {
      score: 0,
      in_voice: false,
      threshold,
      breakdown: {
        register_match: 0,
        rhythm_match: 0,
        lexical_match: 0,
        energy_match: 0,
        avoids_banned_words: true,
        avoids_anti_exemplars: false,
      },
      rationale: `Echoes anti-exemplar: "${antiHit}"`,
    };
  }

  // LLM judge
  const systemPrompt = buildJudgeSystemPrompt(fp);
  const userPrompt = buildJudgeUserPrompt(fp, draftText);

  let response;
  try {
    response = await callSonnet(systemPrompt, userPrompt, 600, productId);
  } catch (err) {
    // On LLM failure, return neutral non-blocking score with rationale
    return {
      score: threshold, // borderline — caller can treat as "uncertain"
      in_voice: true,
      threshold,
      breakdown: {
        register_match: threshold,
        rhythm_match: threshold,
        lexical_match: threshold,
        energy_match: threshold,
        avoids_banned_words: true,
        avoids_anti_exemplars: true,
      },
      rationale: `Voice judge unavailable: ${(err as Error).message}; defaulted to threshold`,
    };
  }

  const parsed = parseJudgeResponse(response.content);
  return {
    score: parsed.score,
    in_voice: parsed.score >= threshold,
    threshold,
    breakdown: {
      register_match: parsed.register,
      rhythm_match: parsed.rhythm,
      lexical_match: parsed.lexical,
      energy_match: parsed.energy,
      avoids_banned_words: true,
      avoids_anti_exemplars: true,
    },
    rationale: parsed.rationale,
  };
}

// ─── Judge Prompts ────────────────────────────────────────────────────────────

function buildJudgeSystemPrompt(fp: VoiceFingerprint): string {
  return [
    'You are a voice-and-tone judge. You score draft text against a defined product voice fingerprint.',
    'Return JSON only. No prose outside JSON.',
    'Required JSON shape: {"score":0-100,"register":0-100,"rhythm":0-100,"lexical":0-100,"energy":0-100,"rationale":"<one sentence>"}',
    'Be strict. Generic SaaS-median copy should score ≤55. In-voice copy should score ≥75.',
  ].join('\n');
}

function buildJudgeUserPrompt(fp: VoiceFingerprint, draftText: string): string {
  const exemplars = fp.exemplar_sentences
    .map((s, i) => `${i + 1}. ${s}`)
    .join('\n');
  const lexical = fp.lexical_preferences.join(', ') || '(none specified)';
  const lines = [
    `Voice fingerprint:`,
    `- register: ${fp.register ?? '(unspecified)'}`,
    `- energy: ${fp.energy ?? '(unspecified)'}`,
    `- pov: ${fp.pov ?? '(unspecified)'}`,
    `- sentence rhythm: ${fp.sentence_rhythm ?? '(unspecified)'}`,
    `- lexical preferences: ${lexical}`,
    '',
    `Exemplar sentences (in-voice ground truth):`,
    exemplars,
    '',
    `Draft to score:`,
    '"""',
    draftText,
    '"""',
    '',
    `Return JSON only.`,
  ];
  return lines.join('\n');
}

function parseJudgeResponse(text: string): {
  score: number;
  register: number;
  rhythm: number;
  lexical: number;
  energy: number;
  rationale: string;
} {
  // Defensive parse — tolerate prose around JSON
  const match = text.match(/\{[\s\S]*\}/);
  const fallback = {
    score: 50,
    register: 50,
    rhythm: 50,
    lexical: 50,
    energy: 50,
    rationale: 'Could not parse judge response',
  };
  if (!match) return fallback;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    return {
      score: clampPct(parsed.score),
      register: clampPct(parsed.register),
      rhythm: clampPct(parsed.rhythm),
      lexical: clampPct(parsed.lexical),
      energy: clampPct(parsed.energy),
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
    };
  } catch {
    return fallback;
  }
}

function clampPct(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}
