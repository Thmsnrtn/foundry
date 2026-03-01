// =============================================================================
// FOUNDRY — Dynamic Contextual Hints
// Per-page guidance, intelligent empty states, and dimension tooltips.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';
import type { Founder, PageHint } from '../../types/index.js';

/**
 * Get contextual hints for a specific page based on current product state.
 */
export async function getPageHints(
  page: string,
  founder: Founder,
  productId: string,
  context: Record<string, unknown>,
): Promise<PageHint[]> {
  const hints: PageHint[] = [];

  if (page === 'dashboard') {
    if (context.metrics_count === 0) {
      hints.push({
        id: 'dashboard_no_metrics',
        type: 'empty_state',
        headline: 'Metrics power stressor detection and MRR decomposition.',
        body: 'Without a weekly snapshot, Foundry cannot detect forward-looking risk.',
        action_label: 'Submit first metrics →',
        action_url: `/products/${productId}/audit`,
        dismissible: true,
      });
    }
    if (context.stressor_count === 0 && (context.metrics_count as number) > 0) {
      hints.push({
        id: 'dashboard_no_stressors',
        type: 'tip',
        headline: 'No stressors detected.',
        body: 'Foundry\'s weekly synthesis found no forward-looking risks this week. This is the expected state.',
        dismissible: true,
      });
    }
    if (context.risk_state === 'red' && context.first_red === true) {
      hints.push({
        id: 'dashboard_first_red',
        type: 'warning',
        headline: 'Recovery mode activated.',
        body: 'Recovery mode means Foundry has escalated monitoring to daily cadence and generated a recovery protocol. Your job is to implement the stabilization plan.',
        dismissible: false,
      });
    }
  }

  if (page === 'audit') {
    if (context.is_first_audit === true) {
      hints.push({
        id: 'audit_first',
        type: 'contextual',
        headline: 'This is your baseline.',
        body: 'A 2.4 today and a 7.4 in three weeks is a more compelling story than a 6.0 that never moved. The score matters less than the trajectory.',
        dismissible: true,
      });
    }
    if ((context.composite as number) < 4) {
      hints.push({
        id: 'audit_low_composite',
        type: 'warning',
        headline: 'Below 4 indicates foundational issues.',
        body: 'Start with D5 Operational Readiness — it is the dimension that most directly enables improvement in others.',
        dismissible: true,
      });
    }
    if ((context.wisdom_required_count as number) > 0 && context.wisdom_active === false) {
      hints.push({
        id: 'audit_wisdom_needed',
        type: 'contextual',
        headline: `${context.wisdom_required_count} blocking issues waiting for Wisdom Layer.`,
        body: 'Complete Product DNA to at least 60% to unlock automated fixes for these.',
        action_label: 'Complete DNA →',
        action_url: `/products/${productId}/dna`,
        dismissible: true,
      });
    }
    if (context.verdict === 'READY') {
      hints.push({
        id: 'audit_ready',
        type: 'tip',
        headline: 'READY verdict.',
        body: 'Every dimension above 7, composite above 7. This is the threshold that matters for distribution credibility.',
        dismissible: true,
      });
    }
  }

  if (page === 'decisions') {
    if (context.decisions_count === 0) {
      hints.push({
        id: 'decisions_empty',
        type: 'empty_state',
        headline: 'Your decision queue is empty.',
        body: 'Foundry is operating autonomously. Decisions surface here when the intelligence layer detects something that requires your specific judgment — not data you could find yourself, but calls only you can make.',
        dismissible: false,
      });
    }
    if (context.has_overdue === true) {
      hints.push({
        id: 'decisions_overdue',
        type: 'warning',
        headline: 'Overdue decisions detected.',
        body: 'Overdue decisions degrade scenario model accuracy. The longer a decision waits, the less the 30/60/90-day projections reflect current conditions.',
        dismissible: false,
      });
    }
  }

  if (page === 'dna') {
    const sectionHints: Record<string, string> = {
      icp_description: 'Foundry uses your ICP description to evaluate D3 Trust Density and D4 Value Legibility against your specific buyer, not generic best practices.',
      voice_principles: 'Voice principles are injected into every D2 and D4 remediation fix. Without them, Foundry writes fixes in generic SaaS voice.',
      positioning_statement: 'Positioning informs how Foundry evaluates your marketing, messaging, and competitive differentiation.',
      retention_hypothesis: 'Retention hypotheses guide cohort analysis and stressor identification around churn patterns.',
    };
    const section = context.active_section as string | undefined;
    if (section && sectionHints[section]) {
      hints.push({
        id: `dna_${section}`,
        type: 'contextual',
        headline: `What "${section.replace(/_/g, ' ')}" unlocks`,
        body: sectionHints[section]!,
        dismissible: true,
      });
    }
    if ((context.completion_pct as number) < 60) {
      const sectionsNeeded = 6 - Math.floor((context.completion_pct as number) / 10);
      hints.push({
        id: 'dna_incomplete',
        type: 'warning',
        headline: 'Wisdom Layer inactive.',
        body: `D2, D3, D4 remediation is blocked until you reach 60%. ${sectionsNeeded} more section${sectionsNeeded !== 1 ? 's' : ''} needed.`,
        dismissible: false,
      });
    }
  }

  return hints;
}

/**
 * Generate AI-powered dimension-specific hints for an audit score.
 * Called asynchronously after audit completion — does not block.
 */
export async function generateDimensionHints(
  auditScoreId: string,
  productId: string,
): Promise<void> {
  try {
    // Fetch audit scores
    const auditResult = await query('SELECT * FROM audit_scores WHERE id = ?', [auditScoreId]);
    if (auditResult.rows.length === 0) return;
    const audit = auditResult.rows[0] as Record<string, unknown>;

    // Fetch product DNA for context
    const dnaResult = await query('SELECT * FROM product_dna WHERE product_id = ?', [productId]);
    const dna = dnaResult.rows[0] as Record<string, unknown> | undefined;

    const productResult = await query('SELECT name, market_category FROM products WHERE id = ?', [productId]);
    const product = productResult.rows[0] as Record<string, string> | undefined;

    const scores = {
      d1: audit.d1_score, d2: audit.d2_score, d3: audit.d3_score, d4: audit.d4_score,
      d5: audit.d5_score, d6: audit.d6_score, d7: audit.d7_score, d8: audit.d8_score,
      d9: audit.d9_score, d10: audit.d10_score,
    };

    const prompt = `Given this product's context and audit scores, write a one-sentence product-specific explanation of each score for a founder reviewing their audit. Do not be generic. Reference the specific product's situation. Return JSON with keys d1 through d10.

Product: ${product?.name ?? 'Unknown'}
Category: ${product?.market_category ?? 'SaaS'}
ICP: ${dna?.icp_description ?? 'Not specified'}
Positioning: ${dna?.positioning_statement ?? 'Not specified'}

Scores: ${JSON.stringify(scores)}
Composite: ${audit.composite}
Verdict: ${audit.verdict}`;

    const response = await callOpus(
      'You are Foundry\'s audit analyst. Generate brief, specific dimension explanations.',
      prompt,
      2048,
    );
    const hintsMap = parseJSONResponse<Record<string, string>>(response.content);

    // Insert all hints
    for (const [dim, text] of Object.entries(hintsMap)) {
      if (!text || typeof text !== 'string') continue;
      try {
        await query(
          `INSERT INTO dimension_hints (id, audit_score_id, dimension, hint_text)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (audit_score_id, dimension) DO UPDATE SET hint_text = ?`,
          [nanoid(), auditScoreId, dim, text, text],
        );
      } catch {
        // Ignore individual insert failures
      }
    }
  } catch (err) {
    console.error('[HINTS] Error generating dimension hints:', err);
  }
}

/**
 * Retrieve dimension hints as a map of dimension → hint_text.
 */
export async function getDimensionHints(
  auditScoreId: string,
): Promise<Record<string, string>> {
  const result = await query(
    'SELECT dimension, hint_text FROM dimension_hints WHERE audit_score_id = ?',
    [auditScoreId],
  );
  const map: Record<string, string> = {};
  for (const row of result.rows) {
    const r = row as Record<string, string>;
    map[r.dimension] = r.hint_text;
  }
  return map;
}
