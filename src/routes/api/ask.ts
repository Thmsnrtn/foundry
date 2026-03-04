// =============================================================================
// FOUNDRY — Conversational Query API
// POST /api/ask — Ask anything about your business in natural language.
// =============================================================================

import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import {
  query,
  getProductByOwner,
  getActiveStressors,
  getLatestMetrics,
  getPendingDecisions,
  getLifecycleState,
} from '../../db/client.js';
import { getMRRDecomposition } from '../../services/intelligence/revenue.js';
import { callSonnet } from '../../services/ai/client.js';

export const apiAskRoutes = new Hono<AuthEnv>();

interface DataPoint {
  label: string;
  value: string;
}

interface AskResponse {
  answer: string;
  data_points: DataPoint[];
}

apiAskRoutes.post('/api/ask', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as { question?: string; product_id?: string };

  if (!body.question?.trim()) {
    return c.json({ error: 'question is required' }, 400);
  }
  if (!body.product_id) {
    return c.json({ error: 'product_id is required' }, 400);
  }

  // Verify ownership
  const productResult = await getProductByOwner(body.product_id, founder.id);
  if (productResult.rows.length === 0) {
    return c.json({ error: 'Not found' }, 404);
  }
  const product = productResult.rows[0] as Record<string, unknown>;

  // Load context data in parallel
  const [stressors, metrics, decisions, lifecycle, mrr] = await Promise.all([
    getActiveStressors(body.product_id),
    getLatestMetrics(body.product_id),
    getPendingDecisions(body.product_id),
    getLifecycleState(body.product_id),
    getMRRDecomposition(body.product_id),
  ]);

  const metricsRow = (metrics.rows[0] ?? {}) as Record<string, unknown>;
  const lifecycleRow = (lifecycle.rows[0] ?? {}) as Record<string, unknown>;
  const stressorRows = stressors.rows as Array<Record<string, string>>;

  // Build data points for UI display
  const dataPoints: DataPoint[] = [];

  if (metricsRow.mrr_health_ratio !== null && metricsRow.mrr_health_ratio !== undefined) {
    dataPoints.push({ label: 'MRR Health', value: String((metricsRow.mrr_health_ratio as number).toFixed(2)) });
  }
  if (metricsRow.churn_rate !== null && metricsRow.churn_rate !== undefined) {
    dataPoints.push({ label: 'Churn Rate', value: `${((metricsRow.churn_rate as number) * 100).toFixed(1)}%` });
  }
  if (metricsRow.activation_rate !== null && metricsRow.activation_rate !== undefined) {
    dataPoints.push({ label: 'Activation', value: `${((metricsRow.activation_rate as number) * 100).toFixed(1)}%` });
  }
  if (stressorRows.length > 0) {
    dataPoints.push({ label: 'Stressors', value: `${stressorRows.length} active` });
  }
  if (decisions.rows.length > 0) {
    dataPoints.push({ label: 'Decisions', value: `${decisions.rows.length} pending` });
  }

  // Assemble context for the AI
  const contextLines: string[] = [
    `Product: ${product.name as string}`,
    `Stage: ${(lifecycleRow.current_prompt as string) ?? 'prompt_1'} of 9`,
    `Risk State: ${(lifecycleRow.risk_state as string) ?? 'green'}`,
    '',
    'Current Metrics:',
  ];

  if (metricsRow.new_mrr_cents) contextLines.push(`  New MRR: $${Math.round((metricsRow.new_mrr_cents as number) / 100)}`);
  if (metricsRow.churned_mrr_cents) contextLines.push(`  Churned MRR: $${Math.round((metricsRow.churned_mrr_cents as number) / 100)}`);
  if (metricsRow.mrr_health_ratio !== undefined && metricsRow.mrr_health_ratio !== null) {
    contextLines.push(`  MRR Health Ratio: ${(metricsRow.mrr_health_ratio as number).toFixed(2)}`);
  }
  if (metricsRow.activation_rate !== undefined && metricsRow.activation_rate !== null) {
    contextLines.push(`  Activation Rate: ${((metricsRow.activation_rate as number) * 100).toFixed(1)}%`);
  }
  if (metricsRow.day_30_retention !== undefined && metricsRow.day_30_retention !== null) {
    contextLines.push(`  Day 30 Retention: ${((metricsRow.day_30_retention as number) * 100).toFixed(1)}%`);
  }
  if (metricsRow.churn_rate !== undefined && metricsRow.churn_rate !== null) {
    contextLines.push(`  Churn Rate: ${((metricsRow.churn_rate as number) * 100).toFixed(1)}%`);
  }
  if (metricsRow.nps_score !== undefined && metricsRow.nps_score !== null) {
    contextLines.push(`  NPS: ${metricsRow.nps_score}`);
  }

  if (mrr) {
    contextLines.push(`  Total MRR: $${Math.round(mrr.total_cents / 100)}`);
  }

  if (stressorRows.length > 0) {
    contextLines.push('', 'Active Stressors:');
    stressorRows.forEach((s) => {
      contextLines.push(`  [${s.severity}] ${s.stressor_name}: ${s.signal}`);
    });
  }

  if (decisions.rows.length > 0) {
    contextLines.push('', `Pending Decisions: ${decisions.rows.length}`);
    const decRows = decisions.rows as Array<Record<string, unknown>>;
    decRows.slice(0, 3).forEach((d) => {
      contextLines.push(`  - ${d.what as string} (${d.category as string})`);
    });
  }

  const systemPrompt = `You are the AI analyst for Foundry, a business intelligence platform for SaaS founders. You answer questions about business data directly and honestly. No hedging. Give specific, actionable answers based on the data provided. Keep your answer to 2-4 sentences. Be direct.`;

  const userPrompt = `Business context:\n${contextLines.join('\n')}\n\nFounder's question: ${body.question.trim()}`;

  try {
    const response = await callSonnet(systemPrompt, userPrompt, 400);
    const result: AskResponse = {
      answer: response.content.trim(),
      data_points: dataPoints,
    };
    return c.json(result);
  } catch (err) {
    console.error('[/api/ask] AI call failed:', err);
    return c.json({ error: 'Unable to answer right now. Try again shortly.' }, 503);
  }
});
