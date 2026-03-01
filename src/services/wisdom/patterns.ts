// =============================================================================
// FOUNDRY — Wisdom Layer: Founder Judgment Patterns
// Synthesizes how this founder decides from resolved Gate 3 decisions.
// =============================================================================

import { query, insertAuditLog } from '../../db/client.js';
import { callOpus, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';
import type { FounderJudgmentPattern } from '../../types/index.js';

interface SynthesizedPattern {
  pattern_description: string;
  confidence: number;
  evidence_decision_ids: string[];
}

/**
 * Retrieve top non-invalidated patterns for a product/category, ordered by confidence.
 */
export async function getRelevantPatterns(
  productId: string,
  category: string,
): Promise<FounderJudgmentPattern[]> {
  const sql = category
    ? `SELECT * FROM founder_judgment_patterns WHERE product_id = ? AND category = ? AND invalidated = FALSE ORDER BY confidence DESC LIMIT 5`
    : `SELECT * FROM founder_judgment_patterns WHERE product_id = ? AND invalidated = FALSE ORDER BY confidence DESC LIMIT 5`;
  const args = category ? [productId, category] : [productId];
  const result = await query(sql, args);
  return result.rows.map(deserializePattern);
}

/**
 * Synthesize judgment patterns from resolved Gate 3 decisions with reasoning.
 * Groups by category; for categories with 3+ decisions, calls Opus.
 */
export async function synthesizeJudgmentPatterns(
  productId: string,
  ownerId: string,
): Promise<number> {
  const result = await query(
    `SELECT * FROM decisions
     WHERE product_id = ? AND gate = 3 AND status IN ('approved','rejected','executed')
       AND resolution_reasoning IS NOT NULL AND resolution_reasoning != ''
       AND decided_at > datetime('now', '-90 days')
     ORDER BY decided_at DESC`,
    [productId],
  );

  if (result.rows.length < 3) return 0;

  // Group by category
  const byCategory = new Map<string, Array<Record<string, unknown>>>();
  for (const row of result.rows) {
    const d = row as Record<string, unknown>;
    const cat = (d.category as string) ?? 'general';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(d);
  }

  let patternsCreated = 0;

  for (const [category, decisions] of byCategory) {
    if (decisions.length < 3) continue;

    const decisionSummaries = decisions.map((d) => ({
      id: d.id,
      what: d.what,
      chosen_option: d.chosen_option,
      resolution_reasoning: d.resolution_reasoning,
      options: d.options ? JSON.parse(d.options as string) : [],
    }));

    const systemPrompt = `You analyze founder decision patterns. Given a set of resolved decisions with the founder's reasoning, identify consistent patterns in how this founder decides.

Return JSON array:
[{
  "pattern_description": "Clear description of the pattern",
  "confidence": 0.0-1.0,
  "evidence_decision_ids": ["id1", "id2"]
}]

Rules:
- Only identify patterns supported by at least 2 decisions
- Confidence reflects how consistently the pattern appears
- Be specific: "Prioritizes user retention over new feature development" not "Makes good decisions"
- Maximum 5 patterns per category`;

    const userPrompt = `Category: ${category}\nDecisions:\n${JSON.stringify(decisionSummaries, null, 2)}`;

    try {
      const response = await callOpus(systemPrompt, userPrompt, 4096);
      const synthesized = parseJSONResponse<SynthesizedPattern[]>(response.content);

      for (const pattern of synthesized) {
        // Check if a similar pattern already exists
        const existing = await query(
          `SELECT * FROM founder_judgment_patterns
           WHERE product_id = ? AND category = ? AND invalidated = FALSE
           AND pattern_description = ?`,
          [productId, category, pattern.pattern_description],
        );

        if (existing.rows.length > 0) {
          // Update confidence and evidence
          const ex = existing.rows[0] as Record<string, unknown>;
          const existingIds: string[] = ex.evidence_decision_ids ? JSON.parse(ex.evidence_decision_ids as string) : [];
          const mergedIds = [...new Set([...existingIds, ...pattern.evidence_decision_ids])];
          const newConfidence = Math.min(1.0, ((ex.confidence as number) + pattern.confidence) / 2 + 0.05);

          await query(
            `UPDATE founder_judgment_patterns
             SET confidence = ?, times_observed = times_observed + 1, evidence_decision_ids = ?, updated_at = ?
             WHERE id = ?`,
            [newConfidence, JSON.stringify(mergedIds), new Date().toISOString(), ex.id],
          );
        } else {
          await query(
            `INSERT INTO founder_judgment_patterns (id, product_id, owner_id, category, pattern_description, evidence_decision_ids, confidence, times_observed)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
            [nanoid(), productId, ownerId, category, pattern.pattern_description, JSON.stringify(pattern.evidence_decision_ids), pattern.confidence],
          );
          patternsCreated++;
        }
      }

      // Decrease confidence for existing patterns NOT reinforced
      const allExisting = await query(
        `SELECT id, confidence FROM founder_judgment_patterns
         WHERE product_id = ? AND category = ? AND invalidated = FALSE`,
        [productId, category],
      );
      const reinforcedDescs = new Set(synthesized.map((p) => p.pattern_description));
      for (const row of allExisting.rows) {
        const ex = row as Record<string, unknown>;
        // Check if this pattern was part of the synthesis output
        const fullRow = await query('SELECT pattern_description FROM founder_judgment_patterns WHERE id = ?', [ex.id]);
        const desc = (fullRow.rows[0] as Record<string, string>)?.pattern_description;
        if (!reinforcedDescs.has(desc)) {
          const newConf = (ex.confidence as number) - 0.1;
          if (newConf < 0.3) {
            await query('DELETE FROM founder_judgment_patterns WHERE id = ?', [ex.id]);
          } else {
            await query(
              'UPDATE founder_judgment_patterns SET confidence = ?, updated_at = ? WHERE id = ?',
              [newConf, new Date().toISOString(), ex.id],
            );
          }
        }
      }
    } catch (err) {
      console.error(`[WISDOM] Pattern synthesis failed for ${productId}/${category}:`, err);
    }
  }

  await insertAuditLog({
    id: nanoid(),
    product_id: productId,
    action_type: 'wisdom_pattern_synthesis',
    gate: 1,
    trigger: 'pattern_synthesis',
    reasoning: `Synthesized patterns from ${result.rows.length} decisions across ${byCategory.size} categories. ${patternsCreated} new patterns created.`,
  });

  return patternsCreated;
}

/**
 * Mark a pattern as invalidated when the founder says it's wrong.
 */
export async function invalidatePattern(
  patternId: string,
  founderId: string,
): Promise<void> {
  const result = await query('SELECT * FROM founder_judgment_patterns WHERE id = ?', [patternId]);
  if (result.rows.length === 0) return;
  const pattern = result.rows[0] as Record<string, unknown>;

  await query(
    'UPDATE founder_judgment_patterns SET invalidated = TRUE, updated_at = ? WHERE id = ?',
    [new Date().toISOString(), patternId],
  );

  await insertAuditLog({
    id: nanoid(),
    product_id: pattern.product_id as string,
    action_type: 'wisdom_pattern_invalidated',
    gate: 3,
    trigger: 'founder_correction',
    reasoning: `Founder invalidated pattern: "${pattern.pattern_description}". Pattern had confidence ${pattern.confidence}.`,
  });
}

// ─── Internal ────────────────────────────────────────────────────────────────

function deserializePattern(row: unknown): FounderJudgmentPattern {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    product_id: r.product_id as string,
    owner_id: r.owner_id as string,
    category: r.category as string,
    pattern_description: r.pattern_description as string,
    evidence_decision_ids: r.evidence_decision_ids ? JSON.parse(r.evidence_decision_ids as string) : [],
    confidence: (r.confidence as number) ?? 0,
    times_observed: (r.times_observed as number) ?? 1,
    invalidated: !!r.invalidated,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}
