// =============================================================================
// FOUNDRY — Calendar Time Allocation Intelligence
// Tracks how founders spend their time and surfaces misalignments with strategy.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { callSonnet } from '../ai/client.js';

// ─── Record Allocation ────────────────────────────────────────────────────────

/**
 * Upsert weekly time allocation records for a product.
 * Uses INSERT OR REPLACE to handle re-submissions for the same week+category.
 */
export async function recordWeekAllocation(
  productId: string,
  weekStart: string,
  allocations: Array<{
    category: string;
    hours: number;
    event_count?: number;
    notes?: string;
  }>,
): Promise<void> {
  for (const alloc of allocations) {
    if (alloc.hours < 0) continue;

    // Check if a record exists for this product+week+category
    const existing = await query(
      `SELECT id FROM calendar_allocations WHERE product_id = ? AND week_start = ? AND category = ?`,
      [productId, weekStart, alloc.category],
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0] as Record<string, unknown>;
      await query(
        `UPDATE calendar_allocations SET hours = ?, event_count = ?, notes = ?
         WHERE id = ?`,
        [alloc.hours, alloc.event_count ?? 0, alloc.notes ?? null, row.id as string],
      );
    } else {
      await query(
        `INSERT INTO calendar_allocations (id, product_id, week_start, category, hours, event_count, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [nanoid(), productId, weekStart, alloc.category, alloc.hours, alloc.event_count ?? 0, alloc.notes ?? null],
      );
    }
  }
}

// ─── Trends ───────────────────────────────────────────────────────────────────

/**
 * Return weekly time allocation trends for the last N weeks, newest first.
 * Each week includes category breakdown with hours and percentage of total.
 */
export async function getTimeAllocationTrends(
  productId: string,
  weeks = 8,
): Promise<Array<{
  week_start: string;
  allocations: Array<{ category: string; hours: number; pct: number }>;
  total_hours: number;
}>> {
  const result = await query(
    `SELECT week_start, category, hours
     FROM calendar_allocations
     WHERE product_id = ?
     ORDER BY week_start DESC, category ASC`,
    [productId],
  );

  // Group by week
  const weekMap = new Map<string, Array<{ category: string; hours: number }>>();
  for (const r of result.rows) {
    const row = r as Record<string, unknown>;
    const ws = row.week_start as string;
    if (!weekMap.has(ws)) weekMap.set(ws, []);
    weekMap.get(ws)!.push({ category: row.category as string, hours: row.hours as number });
  }

  // Take most recent N weeks
  const sortedWeeks = Array.from(weekMap.keys()).sort().reverse().slice(0, weeks);

  return sortedWeeks.map((week_start) => {
    const entries = weekMap.get(week_start) ?? [];
    const total_hours = entries.reduce((sum, e) => sum + e.hours, 0);
    const allocations = entries.map((e) => ({
      category: e.category,
      hours: e.hours,
      pct: total_hours > 0 ? parseFloat(((e.hours / total_hours) * 100).toFixed(1)) : 0,
    }));
    return { week_start, allocations, total_hours };
  });
}

// ─── Strategy Alignment ───────────────────────────────────────────────────────

/**
 * Compare current time allocation against strategic priorities.
 * Uses Claude to identify misalignments and recommend adjustments.
 */
export async function analyzeTimeVsStrategy(
  productId: string,
): Promise<{
  analysis: string;
  misalignments: Array<{ area: string; time_pct: number; recommended_pct: number; gap: string }>;
}> {
  const empty = { analysis: 'Insufficient data to analyze time allocation.', misalignments: [] };

  // Get recent 4 weeks of allocation
  const trends = await getTimeAllocationTrends(productId, 4);
  if (trends.length === 0) return empty;

  // Aggregate average % per category across recent weeks
  const categoryTotals = new Map<string, number[]>();
  for (const week of trends) {
    for (const alloc of week.allocations) {
      if (!categoryTotals.has(alloc.category)) categoryTotals.set(alloc.category, []);
      categoryTotals.get(alloc.category)!.push(alloc.pct);
    }
  }

  const avgByCategory = Array.from(categoryTotals.entries()).map(([category, pcts]) => ({
    category,
    avg_pct: parseFloat((pcts.reduce((a, b) => a + b, 0) / pcts.length).toFixed(1)),
  })).sort((a, b) => b.avg_pct - a.avg_pct);

  if (avgByCategory.length === 0) return empty;

  // Pull any lifecycle/strategy context
  const lifecycleResult = await query(
    `SELECT risk_state, risk_state_reason FROM lifecycle_state WHERE product_id = ? ORDER BY updated_at DESC LIMIT 1`,
    [productId],
  );
  const ls = lifecycleResult.rows[0] as Record<string, unknown> | undefined;
  const riskContext = ls
    ? `Current risk state: ${ls.risk_state}. Reason: ${ls.risk_state_reason ?? 'unknown'}.`
    : '';

  const allocationSummary = avgByCategory
    .map((c) => `${c.category}: ${c.avg_pct}% of time`)
    .join('\n');

  const systemPrompt = `You are a startup executive coach analyzing how a founder spends their time relative to strategic leverage. Return ONLY valid JSON.`;

  const userPrompt = `A founder's average weekly time allocation over the past 4 weeks:

${allocationSummary}

${riskContext}

Analyze this allocation and identify misalignments. Return a JSON object:
{
  "analysis": "<2-3 paragraph analysis of where time is well-spent and where it isn't, referencing the stage and risk state>",
  "misalignments": [
    {
      "area": "<category name>",
      "time_pct": <current average %>,
      "recommended_pct": <recommended % for this stage>,
      "gap": "<1-sentence explanation of the gap and why it matters>"
    }
  ]
}

Only include areas with meaningful misalignment (gap > 10 percentage points). Limit to 4 misalignments.`;

  try {
    const response = await callSonnet(systemPrompt, userPrompt, 1024, productId);

    // Parse JSON response
    let parsed: { analysis: string; misalignments: Array<{ area: string; time_pct: number; recommended_pct: number; gap: string }> };
    try {
      parsed = JSON.parse(response.content.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim());
    } catch {
      return { analysis: response.content.trim(), misalignments: [] };
    }

    return {
      analysis: parsed.analysis ?? '',
      misalignments: parsed.misalignments ?? [],
    };
  } catch (err) {
    console.error('[calendar-intel] analyzeTimeVsStrategy error:', err);
    return empty;
  }
}
