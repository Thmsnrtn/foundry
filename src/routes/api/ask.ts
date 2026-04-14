// =============================================================================
// FOUNDRY — Ask Foundry (Conversational AI)
// Natural language questions about your product's health, metrics, and strategy.
// "How's my product doing?" "Should I raise prices?" "Why is churn increasing?"
// =============================================================================

import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner, getLatestAudit, getLatestMetrics, getActiveStressors, getPendingDecisions } from '../../db/client.js';
import { getMRRDecomposition, computeHealthRatio } from '../../services/intelligence/revenue.js';
import { getLatestCohortSummary } from '../../services/intelligence/cohort.js';
import { callSonnet } from '../../services/ai/client.js';
import { buildWisdomContext } from '../../services/wisdom/dna.js';
import { trackUsage } from '../../lib/usage-tracking.js';
import { log } from '../../lib/logger.js';
import { z } from 'zod';
import { validate } from '../../lib/validation.js';
import type { RiskStateValue } from '../../types/index.js';

const askSchema = z.object({
  question: z.string().min(3).max(1000),
  product_id: z.string().min(1),
});

export const askRoutes = new Hono<AuthEnv>();

askRoutes.post('/api/ask', async (c) => {
  const founder = c.get('founder');
  const body = validate(askSchema, await c.req.json());

  const prodResult = await getProductByOwner(body.product_id, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Product not found' }, 404);

  const product = prodResult.rows[0] as Record<string, unknown>;
  const productId = body.product_id;

  // Gather context in parallel
  const [audit, metrics, stressors, decisions, mrr, cohort, lsResult, wisdom] = await Promise.all([
    getLatestAudit(productId),
    getLatestMetrics(productId),
    getActiveStressors(productId),
    getPendingDecisions(productId),
    getMRRDecomposition(productId),
    getLatestCohortSummary(productId),
    query('SELECT * FROM lifecycle_state WHERE product_id = ?', [productId]),
    buildWisdomContext(productId),
  ]);

  const ls = lsResult.rows[0] as Record<string, unknown> | undefined;
  const riskState = (ls?.risk_state as RiskStateValue) ?? 'green';
  const auditRow = audit.rows[0] as Record<string, unknown> | undefined;
  const metricsRow = metrics.rows[0] as Record<string, unknown> | undefined;
  const mrrHealth = mrr ? computeHealthRatio(mrr) : null;

  // Build context summary for Claude
  const context = [
    `Product: ${product.name}`,
    `Lifecycle: ${ls?.current_prompt ?? 'prompt_1'}`,
    `Risk State: ${riskState}${ls?.risk_state_reason ? ` (${ls.risk_state_reason})` : ''}`,
    auditRow ? `Audit Score: ${auditRow.composite}/10 — ${auditRow.verdict}` : 'No audit run yet',
    mrr ? `MRR: $${(mrr.total_cents / 100).toFixed(0)} (new: $${(mrr.new_cents / 100).toFixed(0)}, churned: $${(mrr.churned_cents / 100).toFixed(0)}, health ratio: ${mrrHealth?.value.toFixed(2) ?? 'N/A'})` : 'No revenue data',
    metricsRow ? `Metrics: ${metricsRow.active_users ?? '?'} active users, ${metricsRow.signups_7d ?? '?'} signups/7d, ${((metricsRow.activation_rate as number) * 100)?.toFixed(0) ?? '?'}% activation, ${((metricsRow.day_30_retention as number) * 100)?.toFixed(0) ?? '?'}% D30 retention` : 'No metrics recorded',
    `Active Stressors: ${stressors.rows.length > 0 ? stressors.rows.map((s) => (s as Record<string, string>).stressor_name).join(', ') : 'None'}`,
    `Pending Decisions: ${decisions.rows.length}`,
    cohort ? `Latest Cohort: ${cohort.period} — D14 retention ${cohort.retention_day_14.toFixed(1)}% (${cohort.vs_historical_average_14 >= 0 ? '+' : ''}${cohort.vs_historical_average_14.toFixed(1)}pp vs avg)` : 'No cohort data',
    wisdom.wisdom_active ? `Wisdom Layer: Active (${wisdom.dna_completion_pct}% DNA)` : `Wisdom Layer: Inactive (${wisdom.dna_completion_pct}% DNA)`,
  ].join('\n');

  const systemPrompt = `You are Foundry, an AI business advisor for SaaS founders. You have deep context about this founder's product and answer questions concisely and directly.

Rules:
- Be specific to their data. Reference actual numbers.
- If you don't have enough data to answer, say so and explain what data would help.
- Give actionable advice, not generic platitudes.
- Keep responses under 200 words unless the question requires more.
- If they ask about a feature they haven't set up yet, guide them to set it up.
- Use their product name, not "your product."

${wisdom.wisdom_active ? wisdom.dna_context : ''}

CURRENT STATE:
${context}`;

  try {
    const response = await callSonnet(systemPrompt, body.question, 1024);

    // Track usage
    trackUsage(productId, response, 'ask_foundry').catch(() => {});

    return c.json({
      answer: response.content,
      context_used: {
        risk_state: riskState,
        audit_score: auditRow?.composite ?? null,
        wisdom_active: wisdom.wisdom_active,
      },
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    });
  } catch (err) {
    log.error('Ask Foundry failed', err, { productId, founderId: founder.id });
    return c.json({
      answer: 'I wasn\'t able to process your question right now. This could be a temporary issue with the AI service. Please try again in a moment.',
      error: true,
    }, 503);
  }
});
