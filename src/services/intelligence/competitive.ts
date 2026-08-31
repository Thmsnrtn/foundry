// =============================================================================
// FOUNDRY — Competitive Intelligence
// Weekly scan via Claude Sonnet. Signal routing by significance.
// =============================================================================

import { callSonnet, parseJSONResponse } from '../ai/client.js';
import { query, insertAuditLog } from '../../db/client.js';
import { nanoid } from 'nanoid';
import type { CompetitiveSignal, CompetitiveSignalType, CompetitiveSignificance } from '../../types/index.js';
import type { CompetitorRow } from '../../types/database.js';
import { wrapDataBlock, dataBlockInstruction } from '../ai/sanitize.js';

interface ScanResult {
  competitor_name: string;
  signal_type: CompetitiveSignalType;
  signal_summary: string;
  significance: CompetitiveSignificance;
}

/**
 * Run competitive scan for a product. Called by weekly scheduled job (Sunday).
 */
export async function runCompetitiveScan(productId: string): Promise<CompetitiveSignal[]> {
  const compResult = await query(
    'SELECT * FROM competitors WHERE product_id = ? AND monitoring_active = 1',
    [productId]
  );
  const competitors = compResult.rows as unknown as CompetitorRow[];
  if (competitors.length === 0) return [];

  // Get product positioning for context
  const prodResult = await query('SELECT * FROM products WHERE id = ?', [productId]);
  const product = prodResult.rows[0] as Record<string, unknown> | undefined;
  if (!product) return [];

  const systemPrompt = `You are a competitive intelligence scanner. Given a product and its competitors, identify any significant changes since the last check.

For each significant change, output:
- competitor_name: which competitor
- signal_type: one of pricing_change, feature_launch, positioning_shift, new_entrant, market_exit, funding, acquisition
- signal_summary: one paragraph description
- significance: low, medium, or high

If no significant changes detected, return an empty array.
Respond in JSON: array of signal objects.`;

  // A COMPETITOR'S NAME IS TYPED BY SOMEBODY AND READ BY A MODEL. These four
  // fields per competitor, and the product's own name and category, were
  // interpolated straight into the prompt — so an onboarding form was a way to
  // put text at the instruction boundary of a weekly scan whose output becomes
  // signals and STRESSORS in the founder's queue. They are company-scoped, so
  // this is not a cross-tenant path; it is a person writing into their own
  // company's prompts, which still deserves a boundary rather than trust.
  const competitorContext = competitors.map((c) =>
    `${c.name} (${c.website ?? 'no website'}): ${c.positioning ?? 'unknown positioning'}, `
    + `pricing: ${c.pricing_model ?? 'unknown'}`
  ).join('\n');

  const userPrompt = `${wrapDataBlock('product', `${product.name as string}\nMarket category: ${product.market_category as string ?? 'SaaS'}`)}

${wrapDataBlock('competitors', competitorContext)}

Identify any competitive changes worth noting. Be conservative — only flag genuine signal.`;

  const response = await callSonnet(
    `${systemPrompt}\n\n${dataBlockInstruction('product')} ${dataBlockInstruction('competitors')}`,
    userPrompt, 4096, productId);
  const signals = parseJSONResponse<ScanResult[]>(response.content);

  const persisted: CompetitiveSignal[] = [];
  for (const signal of signals) {
    const id = nanoid();
    await query(
      `INSERT INTO competitive_signals (id, product_id, competitor_name, signal_type, signal_summary, significance)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, productId, signal.competitor_name, signal.signal_type, signal.signal_summary, signal.significance]
    );

    // High significance: create stressor immediately
    if (signal.significance === 'high') {
      const stressorId = nanoid();
      await query(
        `INSERT INTO stressor_history (id, product_id, stressor_name, signal, timeframe_days, neutralizing_action, severity, status)
         VALUES (?, ?, ?, ?, ?, ?, 'elevated', 'active')`,
        [stressorId, productId, `Competitive threat: ${signal.competitor_name}`,
         signal.signal_summary, 60, 'Evaluate competitive response options']
      );

      // Link competitive signal to stressor
      await query('UPDATE competitive_signals SET linked_stressor_id = ? WHERE id = ?', [stressorId, id]);
    }

    // Update last_checked for competitor
    await query('UPDATE competitors SET last_checked = ? WHERE product_id = ? AND name = ?',
      [new Date().toISOString(), productId, signal.competitor_name]);

    persisted.push({
      id, product_id: productId, competitor_name: signal.competitor_name,
      signal_type: signal.signal_type, signal_summary: signal.signal_summary,
      signal_detail: null, significance: signal.significance,
      detected_at: new Date().toISOString(), reviewed: false, linked_stressor_id: null,
    });
  }

  await insertAuditLog({
    id: nanoid(), product_id: productId,
    action_type: 'competitive_scan', gate: 0,
    trigger: 'scheduled_job', reasoning: `Scanned ${competitors.length} competitors, found ${signals.length} signals`,
    output: JSON.stringify({ signals_found: signals.length }), risk_state_at_action: undefined,
  });

  return persisted;
}
