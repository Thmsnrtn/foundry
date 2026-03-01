// =============================================================================
// FOUNDRY — Wisdom Layer: Product DNA
// Accumulates product-specific context that makes every judgment more precise.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { captureArtifact } from '../story/engine.js';
import { getRelevantPatterns } from './patterns.js';
import { getRelevantFailures } from './failures.js';
import type { ProductDNA, PositioningHistoryEntry, VoicePrinciple, WisdomContext, FounderJudgmentPattern, FailureLog } from '../../types/index.js';

// The 10 tracked fields that each contribute 10% to completion
const DNA_TRACKED_FIELDS = [
  'icp_description', 'icp_pain', 'icp_trigger',
  'positioning_statement', 'what_we_are_not',
  'primary_objection', 'objection_response',
  'voice_principles', 'market_insight', 'retention_hypothesis',
] as const;

// What each section enables / blocks when missing
const SECTION_CAPABILITIES: Record<string, string> = {
  icp_description: 'D2/D3/D4 remediation — Foundry cannot tailor fixes to your users without knowing who they are',
  icp_pain: 'Value messaging scoring — pain-aware scoring of D4 Value Legibility',
  icp_trigger: 'Urgency calibration in stressor reports',
  positioning_statement: 'D4 remediation — automated fixes for positioning and messaging issues',
  what_we_are_not: 'Competitive differentiation scoring and D8 remediation',
  primary_objection: 'Trust density scoring — D3 remediation for objection handling',
  objection_response: 'Trust density scoring — D3 remediation for objection handling',
  voice_principles: 'D2 Experience Coherence remediation — tone and voice consistency',
  market_insight: 'Scenario modeling — market-aware projections',
  retention_hypothesis: 'Cohort analysis calibration and churn stressor context',
};

/**
 * Retrieve Product DNA record, or null if not yet created.
 */
export async function getProductDNA(productId: string): Promise<ProductDNA | null> {
  const result = await query('SELECT * FROM product_dna WHERE product_id = ?', [productId]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as Record<string, unknown>;
  return deserializeDNA(row);
}

/**
 * Create or update Product DNA. Recalculates completion_pct.
 * When completion first reaches 60%, activates wisdom layer and creates story artifact.
 */
export async function upsertProductDNA(
  productId: string,
  ownerId: string,
  updates: Partial<Record<string, unknown>>,
): Promise<ProductDNA> {
  const existing = await getProductDNA(productId);
  const now = new Date().toISOString();

  // Serialize JSON fields
  if (updates.positioning_history && typeof updates.positioning_history !== 'string') {
    updates.positioning_history = JSON.stringify(updates.positioning_history);
  }
  if (updates.voice_principles && typeof updates.voice_principles !== 'string') {
    updates.voice_principles = JSON.stringify(updates.voice_principles);
  }

  if (!existing) {
    const id = nanoid();
    const fields = ['id', 'product_id', 'created_at', 'updated_at'];
    const placeholders = ['?', '?', '?', '?'];
    const values: unknown[] = [id, productId, now, now];

    for (const [key, val] of Object.entries(updates)) {
      if (val !== undefined) {
        fields.push(key);
        placeholders.push('?');
        values.push(val);
      }
    }

    await query(
      `INSERT INTO product_dna (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`,
      values,
    );
  } else {
    const setClauses: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];
    for (const [key, val] of Object.entries(updates)) {
      if (val !== undefined) {
        setClauses.push(`${key} = ?`);
        values.push(val);
      }
    }
    values.push(productId);
    await query(
      `UPDATE product_dna SET ${setClauses.join(', ')} WHERE product_id = ?`,
      values,
    );
  }

  // Recalculate completion
  const dna = (await getProductDNA(productId))!;
  const completedSections: string[] = [];
  for (const field of DNA_TRACKED_FIELDS) {
    const val = dna[field as keyof ProductDNA];
    if (val !== null && val !== undefined && String(val).trim().length > 0) {
      completedSections.push(field);
    }
  }
  const completionPct = completedSections.length * 10;

  await query(
    `UPDATE product_dna SET sections_completed = ?, completion_pct = ? WHERE product_id = ?`,
    [JSON.stringify(completedSections), completionPct, productId],
  );
  await query(
    `UPDATE lifecycle_state SET dna_completion_pct = ? WHERE product_id = ?`,
    [completionPct, productId],
  );

  // Check wisdom activation milestone
  const lsResult = await query('SELECT wisdom_layer_active FROM lifecycle_state WHERE product_id = ?', [productId]);
  const wasActive = (lsResult.rows[0] as Record<string, unknown>)?.wisdom_layer_active;

  if (completionPct >= 60 && !wasActive) {
    await query(
      `UPDATE lifecycle_state SET wisdom_layer_active = TRUE WHERE product_id = ?`,
      [productId],
    );
    await captureArtifact({
      productId,
      phase: 'operational',
      artifactType: 'milestone',
      title: 'Wisdom layer activated — Foundry now knows this product.',
      content: `Wisdom layer activated at ${completionPct}% DNA completion.\n\nComplete sections: ${completedSections.join(', ')}.\n\nFoundry will now use product-specific context for:\n${completedSections.map((s) => `- ${s}: ${SECTION_CAPABILITIES[s] ?? ''}`).join('\n')}`,
    });
  }

  return (await getProductDNA(productId))!;
}

/**
 * Returns which DNA sections are complete/empty and what each missing section blocks.
 */
export function getDNACompletionStatus(dna: ProductDNA | null): {
  complete: string[];
  empty: string[];
  capabilities: Record<string, string>;
} {
  const complete: string[] = [];
  const empty: string[] = [];

  for (const field of DNA_TRACKED_FIELDS) {
    const val = dna?.[field as keyof ProductDNA];
    if (val !== null && val !== undefined && String(val).trim().length > 0) {
      complete.push(field);
    } else {
      empty.push(field);
    }
  }

  const capabilities: Record<string, string> = {};
  for (const field of empty) {
    capabilities[field] = SECTION_CAPABILITIES[field] ?? '';
  }

  return { complete, empty, capabilities };
}

/**
 * Assemble the full wisdom context package for injection into AI calls.
 */
export async function buildWisdomContext(
  productId: string,
  decisionCategory?: string,
): Promise<WisdomContext> {
  const lsResult = await query('SELECT wisdom_layer_active, dna_completion_pct FROM lifecycle_state WHERE product_id = ?', [productId]);
  const ls = lsResult.rows[0] as Record<string, unknown> | undefined;
  const wisdomActive = !!ls?.wisdom_layer_active;
  const completionPct = (ls?.dna_completion_pct as number) ?? 0;

  if (!wisdomActive) {
    return {
      wisdom_active: false,
      dna_completion_pct: completionPct,
      dna_context: `=== PRODUCT WISDOM ===\nWisdom layer not yet active. DNA ${completionPct}% complete. Judgments based on methodology\nstandards rather than product-specific context.\n=== END PRODUCT WISDOM ===`,
      judgment_patterns: '',
      failure_context: '',
      completeness_warnings: [],
      meta: { patterns_injected: 0, failures_injected: 0, dna_sections_complete: Math.floor(completionPct / 10), dna_sections_total: 10 },
    };
  }

  const dna = await getProductDNA(productId);
  const category = decisionCategory ?? '';
  const patterns = await getRelevantPatterns(productId, category);
  const failures = await getRelevantFailures(productId, category);
  const { complete, empty } = getDNACompletionStatus(dna);

  // Build dna_context string
  const parts: string[] = ['=== PRODUCT WISDOM ===', '', 'PRODUCT DNA:'];
  if (dna?.icp_description) parts.push(`ICP: ${dna.icp_description}`);
  if (dna?.icp_pain) parts.push(`Their pain: ${dna.icp_pain}`);
  if (dna?.icp_trigger) parts.push(`Trigger to act now: ${dna.icp_trigger}`);
  if (dna?.icp_sophistication) parts.push(`Sophistication level: ${dna.icp_sophistication}`);

  parts.push('', 'POSITIONING:');
  if (dna?.positioning_statement) parts.push(`Current: ${dna.positioning_statement}`);
  if (dna?.what_we_are_not) parts.push(`What this is NOT: ${dna.what_we_are_not}`);
  if (dna?.primary_objection) parts.push(`Primary objection: ${dna.primary_objection}`);
  if (dna?.objection_response) parts.push(`Current response: ${dna.objection_response}`);

  if (dna?.positioning_history && dna.positioning_history.length > 0) {
    parts.push('', 'TRIED AND ABANDONED:');
    for (const entry of dna.positioning_history) {
      parts.push(`"${entry.statement}" — abandoned because: ${entry.reason_abandoned} (${entry.date})`);
    }
  }

  if (dna?.voice_principles && dna.voice_principles.length > 0) {
    parts.push('', 'VOICE PRINCIPLES:');
    for (const vp of dna.voice_principles) {
      parts.push(`DO: ${vp.do} / DON'T: ${vp.dont}`);
    }
  }

  parts.push('', 'FOUNDER BELIEFS:');
  if (dna?.market_insight) parts.push(`Market insight: ${dna.market_insight}`);
  if (dna?.retention_hypothesis) parts.push(`Retention hypothesis: ${dna.retention_hypothesis}`);
  if (dna?.growth_hypothesis) parts.push(`Growth hypothesis: ${dna.growth_hypothesis}`);

  // Judgment patterns
  let patternsStr = '';
  if (patterns.length > 0) {
    parts.push('', 'HOW THIS FOUNDER DECIDES:');
    for (const p of patterns) {
      const level = p.confidence > 0.7 ? 'HIGH' : 'MEDIUM';
      parts.push(`[${level}] ${p.pattern_description}`);
    }
    patternsStr = patterns.map((p) => `[${p.confidence > 0.7 ? 'HIGH' : 'MEDIUM'}] ${p.pattern_description}`).join('\n');
  }

  // Failure context
  let failureStr = '';
  if (failures.length > 0) {
    parts.push('', 'WHAT FAILED IN THIS CATEGORY:');
    for (const f of failures) {
      parts.push(`tried: ${f.what_was_tried} / outcome: ${f.outcome}${f.founder_hypothesis ? ` / hypothesis: ${f.founder_hypothesis}` : ''}`);
    }
    failureStr = failures.map((f) => `tried: ${f.what_was_tried} / outcome: ${f.outcome}`).join('\n');
  }

  // Completeness warnings
  const warnings: string[] = [];
  if (empty.length > 0) {
    const warningStr = `CALIBRATION NOTE: The following sections are incomplete — judgments may be less precise: ${empty.join(', ')}`;
    parts.push('', warningStr);
    warnings.push(...empty);
  }

  parts.push('', '=== END PRODUCT WISDOM ===');

  return {
    wisdom_active: true,
    dna_completion_pct: completionPct,
    dna_context: parts.join('\n'),
    judgment_patterns: patternsStr,
    failure_context: failureStr,
    completeness_warnings: warnings,
    meta: {
      patterns_injected: patterns.length,
      failures_injected: failures.length,
      dna_sections_complete: complete.length,
      dna_sections_total: 10,
    },
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function deserializeDNA(row: Record<string, unknown>): ProductDNA {
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    icp_description: row.icp_description as string | null,
    icp_pain: row.icp_pain as string | null,
    icp_trigger: row.icp_trigger as string | null,
    icp_sophistication: row.icp_sophistication as string | null,
    positioning_statement: row.positioning_statement as string | null,
    positioning_history: row.positioning_history ? JSON.parse(row.positioning_history as string) as PositioningHistoryEntry[] : null,
    what_we_are_not: row.what_we_are_not as string | null,
    primary_objection: row.primary_objection as string | null,
    objection_response: row.objection_response as string | null,
    voice_principles: row.voice_principles ? JSON.parse(row.voice_principles as string) as VoicePrinciple[] : null,
    market_insight: row.market_insight as string | null,
    retention_hypothesis: row.retention_hypothesis as string | null,
    growth_hypothesis: row.growth_hypothesis as string | null,
    sections_completed: row.sections_completed ? JSON.parse(row.sections_completed as string) as string[] : [],
    completion_pct: (row.completion_pct as number) ?? 0,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
