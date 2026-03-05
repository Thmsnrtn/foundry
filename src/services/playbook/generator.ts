// =============================================================================
// FOUNDRY — Playbook Crystallization Engine
// Auto-generates founder playbooks from accumulated wisdom:
// decision history, judgment patterns, failure log, and product DNA.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus } from '../ai/client.js';
import { buildWisdomContext, getProductDNA } from '../wisdom/dna.js';
import { getRelevantPatterns } from '../wisdom/patterns.js';
import { getRelevantFailures } from '../wisdom/failures.js';
import { nanoid } from 'nanoid';
import type { Playbook, PlaybookType, PlaybookEvidence } from '../../types/index.js';

// ─── Playbook Type Definitions ────────────────────────────────────────────────

const PLAYBOOK_CONFIGS: Record<PlaybookType, {
  title: string;
  description: string;
  sourceCategories: string[];
  sections: string[];
}> = {
  operating_principles: {
    title: 'The [Product] Way: Operating Principles',
    description: 'Decision heuristics derived from your complete decision history and judgment patterns.',
    sourceCategories: ['strategic', 'product', 'marketing', 'urgent'],
    sections: ['core_principles', 'decision_framework', 'anti_patterns', 'when_to_escalate'],
  },
  onboarding_kit: {
    title: 'First Hire Onboarding Kit',
    description: 'Everything a new team member needs to understand how this business operates.',
    sourceCategories: ['strategic', 'product'],
    sections: ['product_context', 'icp_and_positioning', 'decision_authority', 'key_metrics', 'anti_patterns'],
  },
  pricing_framework: {
    title: 'Pricing Philosophy & Framework',
    description: 'How this company thinks about and changes pricing — derived from pricing decisions and market signals.',
    sourceCategories: ['strategic', 'marketing'],
    sections: ['pricing_principles', 'when_to_change_price', 'how_to_communicate_changes', 'anti_patterns'],
  },
  churn_response: {
    title: 'Churn Response Playbook',
    description: 'What to do when churn spikes — the proven response protocol based on past stressors and outcomes.',
    sourceCategories: ['urgent', 'strategic'],
    sections: ['detection_signals', 'immediate_actions', 'root_cause_analysis', 'recovery_steps', 'anti_patterns'],
  },
  activation_playbook: {
    title: 'Activation Improvement Playbook',
    description: 'Proven tactics for improving activation rate based on product DNA, cohort data, and past decisions.',
    sourceCategories: ['product', 'marketing'],
    sections: ['current_activation_state', 'activation_hypothesis', 'proven_improvements', 'experiments_to_run', 'anti_patterns'],
  },
  fundraising_narrative: {
    title: 'Fundraising Narrative',
    description: 'The company story for investors — built from Signal history, milestones, and strategic decisions.',
    sourceCategories: ['strategic'],
    sections: ['the_thesis', 'market_context', 'traction_evidence', 'decision_quality', 'what_capital_unlocks'],
  },
  competitive_response: {
    title: 'Competitive Response Framework',
    description: 'How to respond to competitive threats — derived from competitive signals and past competitive decisions.',
    sourceCategories: ['strategic', 'marketing'],
    sections: ['competitive_positioning', 'when_to_respond', 'response_tactics', 'when_to_ignore', 'anti_patterns'],
  },
  recovery_protocol: {
    title: 'RED State Recovery Protocol',
    description: 'What to do when Signal enters RED — the systematic recovery approach with proven actions.',
    sourceCategories: ['urgent', 'strategic'],
    sections: ['diagnostic_questions', 'immediate_actions', 'recovery_milestones', 'green_state_criteria', 'prevention'],
  },
};

// ─── Generate Playbook ────────────────────────────────────────────────────────

export async function generatePlaybook(
  productId: string,
  type: PlaybookType,
): Promise<Playbook> {
  const config = PLAYBOOK_CONFIGS[type];

  // ── Load all sources ───────────────────────────────────────────────────────
  const [wisdom, dna, decisions, stressors, patterns, failures, product] = await Promise.all([
    buildWisdomContext(productId, config.sourceCategories[0]),
    getProductDNA(productId),
    query(
      `SELECT what, chosen_option, outcome, outcome_valence, category, decided_at
       FROM decisions WHERE product_id = ?
         AND status IN ('approved','executed','rejected')
         AND category IN (${config.sourceCategories.map(() => '?').join(',')})
       ORDER BY decided_at DESC LIMIT 20`,
      [productId, ...config.sourceCategories],
    ),
    query(
      `SELECT stressor_name, severity, resolution_notes, status
       FROM stressor_history WHERE product_id = ?
       ORDER BY identified_at DESC LIMIT 10`,
      [productId],
    ),
    getRelevantPatterns(productId, config.sourceCategories[0]).catch(() => []),
    getRelevantFailures(productId, config.sourceCategories[0]).catch(() => []),
    query('SELECT name, market_category FROM products WHERE id = ?', [productId]),
  ]);

  const productName = (product.rows[0] as Record<string, string>)?.name ?? 'this product';

  // ── Build evidence array ───────────────────────────────────────────────────
  const evidence: PlaybookEvidence[] = [];
  const decisionRows = decisions.rows as Array<Record<string, unknown>>;

  for (const d of decisionRows.slice(0, 10)) {
    evidence.push({
      description: `Decision: "${d.what}" → chose ${d.chosen_option ?? 'N/A'}${d.outcome ? ` | outcome: ${d.outcome}` : ''}`,
      decision_id: d.id as string,
      date: d.decided_at as string,
    });
  }

  // ── Build context for Claude ───────────────────────────────────────────────
  const contextParts = [
    `Product: ${productName}`,
    `Playbook type: ${type}`,
    '',
    wisdom.dna_context,
    '',
    `DECISION HISTORY (${decisionRows.length} decisions):`,
    ...decisionRows.slice(0, 10).map((d) =>
      `- "${d.what}" (${d.category}) → ${d.chosen_option ?? 'N/A'}${d.outcome ? ` | ${d.outcome}` : ''} [valence: ${d.outcome_valence ?? 'unknown'}]`
    ),
    '',
  ];

  const stressorRows = stressors.rows as Array<Record<string, string>>;
  if (stressorRows.length > 0) {
    contextParts.push('STRESSOR HISTORY:');
    for (const s of stressorRows) {
      contextParts.push(`- [${s.severity}] ${s.stressor_name}${s.resolution_notes ? ` → resolved: ${s.resolution_notes}` : ''}`);
    }
    contextParts.push('');
  }

  if (patterns.length > 0) {
    contextParts.push('JUDGMENT PATTERNS:');
    for (const p of patterns) {
      contextParts.push(`- ${p.pattern_description}`);
    }
    contextParts.push('');
  }

  if (failures.length > 0) {
    contextParts.push('WHAT HAS FAILED:');
    for (const f of failures) {
      contextParts.push(`- tried: ${f.what_was_tried} | outcome: ${f.outcome}`);
    }
    contextParts.push('');
  }

  const context = contextParts.join('\n');

  // ── Generate playbook sections ─────────────────────────────────────────────
  const title = config.title.replace('[Product]', productName);

  const systemPrompt = `You are writing a practical operational playbook for a SaaS founder.
Use the specific history and patterns provided. Be concrete and actionable.
Write in first-person plural ("we", "our") as if this is an internal document.
Each section should be 3-6 paragraphs or bullet points.
Reference specific past decisions and outcomes where relevant.
The goal: a new team member or returning founder can pick this up and act on it immediately.`;

  const [execSummary, principles, body, antiPatterns] = await Promise.all([
    callOpus(systemPrompt, `${context}\n\nWrite a 2-3 sentence executive summary for this ${type.replace('_', ' ')} playbook. What problem does it solve, and what does it contain?`, 256)
      .then((r) => r.content.trim()).catch(() => ''),
    callOpus(systemPrompt, `${context}\n\nWrite the core principles section of this ${type.replace('_', ' ')} playbook.\nDerive 3-5 actionable principles from the decision history and judgment patterns above.\nFor each principle: state it clearly, explain the reasoning, and cite a specific past example from the data.`, 1024)
      .then((r) => r.content.trim()).catch(() => ''),
    callOpus(systemPrompt, `${context}\n\nWrite the main playbook body for this ${type.replace('_', ' ')} playbook.\nCover: ${config.sections.join(', ')}.\nBe specific, reference actual data from the context, and provide concrete steps.`, 2048)
      .then((r) => r.content.trim()).catch(() => ''),
    callOpus(systemPrompt, `${context}\n\nWrite the anti-patterns section: 3-5 things this company should never do in this area, based on what has failed and the judgment patterns above. Be direct about what went wrong.`, 512)
      .then((r) => r.content.trim()).catch(() => ''),
  ]);

  // ── Persist ────────────────────────────────────────────────────────────────

  // Mark any existing current playbook of this type as non-current
  await query(
    `UPDATE playbooks SET is_current = FALSE WHERE product_id = ? AND type = ? AND is_current = TRUE`,
    [productId, type],
  );

  // Get next version number
  const versionResult = await query(
    `SELECT MAX(version) as max_version FROM playbooks WHERE product_id = ? AND type = ?`,
    [productId, type],
  );
  const nextVersion = ((versionResult.rows[0] as Record<string, number | null>)?.max_version ?? 0) + 1;

  const id = nanoid();
  await query(
    `INSERT INTO playbooks
     (id, product_id, type, title, version, executive_summary, core_principles,
      playbook_body, anti_patterns, evidence, source_decisions, source_patterns,
      source_failures, dna_sections_used, is_current)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
    [
      id, productId, type, title, nextVersion,
      execSummary, principles, body, antiPatterns,
      JSON.stringify(evidence),
      decisionRows.length, patterns.length, failures.length,
      JSON.stringify(wisdom.meta.dna_sections_complete > 0 ? ['dna'] : []),
    ],
  );

  return {
    id, product_id: productId, type, title, version: nextVersion,
    executive_summary: execSummary || null,
    core_principles: principles || null,
    playbook_body: body || null,
    anti_patterns: antiPatterns || null,
    evidence,
    source_decisions: decisionRows.length,
    source_patterns: patterns.length,
    source_failures: failures.length,
    dna_sections_used: null,
    is_current: true,
    generated_at: new Date().toISOString(),
    last_updated_at: new Date().toISOString(),
    notion_page_id: null,
    linear_doc_id: null,
    exported_at: null,
  };
}

// ─── List Playbooks ───────────────────────────────────────────────────────────

export async function getPlaybooks(productId: string): Promise<Playbook[]> {
  const result = await query(
    `SELECT * FROM playbooks WHERE product_id = ? AND is_current = TRUE ORDER BY generated_at DESC`,
    [productId],
  );
  return result.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      ...row,
      evidence: row.evidence ? JSON.parse(row.evidence as string) as PlaybookEvidence[] : null,
      dna_sections_used: row.dna_sections_used ? JSON.parse(row.dna_sections_used as string) as string[] : null,
    } as Playbook;
  });
}
