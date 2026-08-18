// =============================================================================
// FOUNDRY — SCP Temporal Intelligence
// Signal replay, trend analysis, pattern detection over time.
// Phase 3 (Investor-Ready tier) feature.
// =============================================================================

import { query } from '../../db/client.js';
import { callSonnet } from '../ai/client.js';
import type { AgentName } from './types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SignalTimelineEntry {
  date: string;
  signal_score: number;
  risk_state: string | null;
  health_score: number | null;
  briefing_headline: string | null;
  pending_decisions_count: number;
  overnight_actions_count: number;
  evolution_events: number;  // count of agent_evolution_versions on this day
  ai_cost_day: number;
}

export interface TemporalInsights {
  // Trend analysis
  trend_direction: 'improving' | 'stable' | 'declining';
  trend_description: string;

  // Best/worst periods
  best_week: { start_date: string; avg_signal: number };
  worst_week: { start_date: string; avg_signal: number };

  // Key inflection points
  inflection_points: Array<{
    date: string;
    type: 'signal_spike' | 'signal_drop' | 'evolution_burst' | 'recovery';
    description: string;
    signal_before: number;
    signal_after: number;
  }>;

  // Prediction accuracy notes
  prediction_notes: string;

  // Cost trend
  cost_trend: 'increasing' | 'stable' | 'decreasing';
  avg_daily_cost_usd: number;
}

// ─── getSignalTimeline ────────────────────────────────────────────────────────

export async function getSignalTimeline(
  productId: string,
  days = 90
): Promise<SignalTimelineEntry[]> {
  // 1. Signal history for last N days
  const signalResult = await query(
    `SELECT DATE(recorded_at) as day,
            AVG(score) as signal_score,
            MAX(risk_state) as risk_state
     FROM signal_history
     WHERE product_id = ?
       AND recorded_at >= datetime('now', ? )
     GROUP BY DATE(recorded_at)
     ORDER BY day ASC`,
    [productId, `-${days} days`]
  );

  // 2. Briefings for the same period
  const briefingsResult = await query(
    `SELECT briefing_date, headline, health_score,
            pending_decisions, overnight_actions
     FROM scp_briefings
     WHERE product_id = ?
       AND briefing_date >= date('now', ?)
     ORDER BY briefing_date ASC`,
    [productId, `-${days} days`]
  );

  // 3. Agent cost log aggregated by day
  const costResult = await query(
    `SELECT DATE(logged_at) as day, SUM(cost_usd) as total_cost
     FROM agent_cost_log
     WHERE product_id = ?
       AND logged_at >= datetime('now', ?)
     GROUP BY DATE(logged_at)`,
    [productId, `-${days} days`]
  );

  // 4. Evolution versions aggregated by day
  const evolutionResult = await query(
    `SELECT DATE(created_at) as day, COUNT(*) as evt_count
     FROM agent_evolution_versions
     WHERE product_id = ?
       AND created_at >= datetime('now', ?)
     GROUP BY DATE(created_at)`,
    [productId, `-${days} days`]
  );

  // Build lookup maps
  const briefingMap = new Map<string, Record<string, unknown>>();
  for (const row of briefingsResult.rows) {
    const r = row as Record<string, unknown>;
    briefingMap.set(r.briefing_date as string, r);
  }

  const costMap = new Map<string, number>();
  for (const row of costResult.rows) {
    const r = row as Record<string, unknown>;
    costMap.set(r.day as string, (r.total_cost as number) ?? 0);
  }

  const evolutionMap = new Map<string, number>();
  for (const row of evolutionResult.rows) {
    const r = row as Record<string, unknown>;
    evolutionMap.set(r.day as string, (r.evt_count as number) ?? 0);
  }

  // Assemble timeline entries
  const timeline: SignalTimelineEntry[] = [];

  for (const row of signalResult.rows) {
    const r = row as Record<string, unknown>;
    const date = r.day as string;
    const briefing = briefingMap.get(date);

    let pendingDecisionsCount = 0;
    let overnightActionsCount = 0;

    if (briefing) {
      try {
        const pendingArr = JSON.parse(briefing.pending_decisions as string ?? '[]') as unknown[];
        pendingDecisionsCount = pendingArr.length;
      } catch { /* empty */ }
      try {
        const actionsArr = JSON.parse(briefing.overnight_actions as string ?? '[]') as unknown[];
        overnightActionsCount = actionsArr.length;
      } catch { /* empty */ }
    }

    timeline.push({
      date,
      signal_score: Math.round((r.signal_score as number) ?? 0),
      risk_state: (r.risk_state as string) ?? null,
      health_score: briefing ? (briefing.health_score as number | null) : null,
      briefing_headline: briefing ? (briefing.headline as string | null) : null,
      pending_decisions_count: pendingDecisionsCount,
      overnight_actions_count: overnightActionsCount,
      evolution_events: evolutionMap.get(date) ?? 0,
      ai_cost_day: costMap.get(date) ?? 0,
    });
  }

  return timeline;
}

// ─── analyzeTemporalTrends ────────────────────────────────────────────────────

export async function analyzeTemporalTrends(
  productId: string,
  timeline: SignalTimelineEntry[]
): Promise<TemporalInsights> {
  // Minimum data guard
  if (timeline.length < 7) {
    return {
      trend_direction: 'stable',
      trend_description: 'Insufficient data for trend analysis (fewer than 7 days of signal history).',
      best_week: { start_date: timeline[0]?.date ?? '', avg_signal: timeline[0]?.signal_score ?? 0 },
      worst_week: { start_date: timeline[0]?.date ?? '', avg_signal: timeline[0]?.signal_score ?? 0 },
      inflection_points: [],
      prediction_notes: 'Not enough history to evaluate prediction accuracy.',
      cost_trend: 'stable',
      avg_daily_cost_usd: 0,
    };
  }

  const n = timeline.length;

  // 1. Trend direction: compare avg of first third vs last third
  const thirdSize = Math.floor(n / 3);
  const firstThird = timeline.slice(0, thirdSize);
  const lastThird = timeline.slice(n - thirdSize);

  const avgFirst = firstThird.reduce((s, e) => s + e.signal_score, 0) / firstThird.length;
  const avgLast = lastThird.reduce((s, e) => s + e.signal_score, 0) / lastThird.length;
  const delta = avgLast - avgFirst;

  let trend_direction: 'improving' | 'stable' | 'declining';
  if (delta >= 5) {
    trend_direction = 'improving';
  } else if (delta <= -5) {
    trend_direction = 'declining';
  } else {
    trend_direction = 'stable';
  }

  // 2. Best/worst week by averaging 7-day windows
  let bestWeekStart = timeline[0].date;
  let bestWeekAvg = 0;
  let worstWeekStart = timeline[0].date;
  let worstWeekAvg = Infinity;

  for (let i = 0; i <= n - 7; i++) {
    const week = timeline.slice(i, i + 7);
    const avg = week.reduce((s, e) => s + e.signal_score, 0) / 7;
    if (avg > bestWeekAvg) {
      bestWeekAvg = avg;
      bestWeekStart = week[0].date;
    }
    if (avg < worstWeekAvg) {
      worstWeekAvg = avg;
      worstWeekStart = week[0].date;
    }
  }

  // 3. Inflection points: score changes >= 10 vs previous day
  type InflectionType = 'signal_spike' | 'signal_drop' | 'evolution_burst' | 'recovery';

  const inflection_points: Array<{
    date: string;
    type: InflectionType;
    description: string;
    signal_before: number;
    signal_after: number;
  }> = [];

  for (let i = 1; i < n; i++) {
    const prev = timeline[i - 1];
    const curr = timeline[i];
    const diff = curr.signal_score - prev.signal_score;

    if (Math.abs(diff) >= 10 || curr.evolution_events >= 3) {
      let type: InflectionType;
      let description: string;

      if (curr.evolution_events >= 3) {
        type = 'evolution_burst';
        description = `${curr.evolution_events} agent evolution events — agents adapted significantly on this day.`;
      } else if (diff >= 10) {
        type = curr.signal_score >= 60 && prev.signal_score < 60 ? 'recovery' : 'signal_spike';
        description = `Signal rose ${diff} points (${prev.signal_score} → ${curr.signal_score}).${curr.briefing_headline ? ` "${curr.briefing_headline}"` : ''}`;
      } else {
        type = 'signal_drop';
        description = `Signal fell ${Math.abs(diff)} points (${prev.signal_score} → ${curr.signal_score}).${curr.briefing_headline ? ` "${curr.briefing_headline}"` : ''}`;
      }

      inflection_points.push({
        date: curr.date,
        type,
        description,
        signal_before: prev.signal_score,
        signal_after: curr.signal_score,
      });
    }
  }

  // Keep top 8 most significant inflections
  inflection_points.sort((a, b) => Math.abs(b.signal_after - b.signal_before) - Math.abs(a.signal_after - a.signal_before));
  const topInflections = inflection_points.slice(0, 8);

  // 4. Cost trend: compare first 30d vs last 30d
  const cost30Start = timeline.slice(0, Math.min(30, Math.floor(n / 2)));
  const cost30End = timeline.slice(Math.max(0, n - 30));
  const avgCostStart = cost30Start.reduce((s, e) => s + e.ai_cost_day, 0) / cost30Start.length;
  const avgCostEnd = cost30End.reduce((s, e) => s + e.ai_cost_day, 0) / cost30End.length;
  const costDelta = avgCostEnd - avgCostStart;

  let cost_trend: 'increasing' | 'stable' | 'decreasing';
  if (costDelta > 0.01) {
    cost_trend = 'increasing';
  } else if (costDelta < -0.01) {
    cost_trend = 'decreasing';
  } else {
    cost_trend = 'stable';
  }

  const avg_daily_cost_usd = timeline.reduce((s, e) => s + e.ai_cost_day, 0) / n;

  // 5. Call Claude for narrative summaries
  const summaryData = {
    trend_direction,
    signal_start: timeline[0].signal_score,
    signal_end: timeline[n - 1].signal_score,
    delta: Math.round(delta),
    days_of_data: n,
    best_week_signal: Math.round(bestWeekAvg),
    worst_week_signal: Math.round(worstWeekAvg === Infinity ? 0 : worstWeekAvg),
    inflection_count: topInflections.length,
    major_drops: topInflections.filter((p) => p.type === 'signal_drop').length,
    recoveries: topInflections.filter((p) => p.type === 'recovery').length,
    evolution_bursts: topInflections.filter((p) => p.type === 'evolution_burst').length,
    cost_trend,
    avg_daily_cost_usd: avg_daily_cost_usd.toFixed(4),
  };

  let trend_description = `Signal has been ${trend_direction} over the past ${n} days, moving from ${timeline[0].signal_score} to ${timeline[n - 1].signal_score} (${delta >= 0 ? '+' : ''}${Math.round(delta)} points).`;
  let prediction_notes = `${topInflections.length} inflection point(s) detected. AI costs are ${cost_trend} at $${avg_daily_cost_usd.toFixed(3)}/day average.`;

  try {
    const systemPrompt = `You analyze AI-powered company performance trends. Be concise, specific, and insightful. Return plain text only, no markdown.`;
    const userPrompt = `Analyze this company's AI operations trend over ${n} days:
${JSON.stringify(summaryData, null, 2)}

Write exactly 2-3 sentences describing: what's driving the trend, what it means for the company, and what to watch for.`;

    const trendResponse = await callSonnet(systemPrompt, userPrompt, 256, productId);
    trend_description = trendResponse.content.trim();
  } catch {
    // Use fallback description
  }

  try {
    const systemPrompt = `You evaluate AI agent prediction accuracy for business operations. Be direct and specific.`;
    const predInflections = topInflections.slice(0, 3).map((p) =>
      `${p.date} — ${p.type}: ${p.description}`
    ).join('\n');

    const userPrompt = `Given these key inflection points in AI operations over ${n} days:
${predInflections || 'No major inflection points detected.'}

Best signal week: ${Math.round(bestWeekAvg)}, worst: ${Math.round(worstWeekAvg === Infinity ? 0 : worstWeekAvg)}.

Write 2-3 sentences evaluating what these patterns suggest about prediction accuracy and system learning quality.`;

    const predResponse = await callSonnet(systemPrompt, userPrompt, 200, productId);
    prediction_notes = predResponse.content.trim();
  } catch {
    // Use fallback
  }

  return {
    trend_direction,
    trend_description,
    best_week: { start_date: bestWeekStart, avg_signal: Math.round(bestWeekAvg) },
    worst_week: { start_date: worstWeekStart, avg_signal: Math.round(worstWeekAvg === Infinity ? 0 : worstWeekAvg) },
    inflection_points: topInflections,
    prediction_notes,
    cost_trend,
    avg_daily_cost_usd,
  };
}

// ─── getAgentPerformanceOverTime ──────────────────────────────────────────────

export async function getAgentPerformanceOverTime(
  productId: string,
  agentName: AgentName,
  days = 30
): Promise<Array<{
  date: string;
  sessions_count: number;
  success_rate: number;
  /** Null: no per-session health score is recorded, so there is no daily
   * average. Distinct from a score of zero. */
  avg_health_score: number | null;
  decisions_proposed: number;
  evolution_events: number;
}>> {
  // Query agent_sessions grouped by day
  const sessionsResult = await query(
    `SELECT
       DATE(started_at) as day,
       COUNT(*) as sessions_count,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success_count,
       -- agent_sessions has never carried domain_health_score; the column is
       -- on agent_instances, one current value per agent, with no history to
       -- average. This raised on every call, so the whole activity timeline
       -- came back empty rather than missing one field.
       NULL as avg_health,
       SUM(
         CASE
           WHEN pending_decisions IS NOT NULL AND pending_decisions != '[]'
           THEN json_array_length(pending_decisions)
           ELSE 0
         END
       ) as decisions_proposed
     FROM agent_sessions
     WHERE product_id = ?
       AND agent_name = ?
       AND started_at >= datetime('now', ?)
     GROUP BY DATE(started_at)
     ORDER BY day ASC`,
    [productId, agentName, `-${days} days`]
  );

  // Evolution events per day for this agent
  const evolutionResult = await query(
    `SELECT DATE(created_at) as day, COUNT(*) as evt_count
     FROM agent_evolution_versions
     WHERE product_id = ?
       AND agent_name = ?
       AND created_at >= datetime('now', ?)
     GROUP BY DATE(created_at)`,
    [productId, agentName, `-${days} days`]
  );

  const evolutionMap = new Map<string, number>();
  for (const row of evolutionResult.rows) {
    const r = row as Record<string, unknown>;
    evolutionMap.set(r.day as string, (r.evt_count as number) ?? 0);
  }

  return sessionsResult.rows.map((row) => {
    const r = row as Record<string, unknown>;
    const date = r.day as string;
    const sessionsCount = (r.sessions_count as number) ?? 0;
    const successCount = (r.success_count as number) ?? 0;

    return {
      date,
      sessions_count: sessionsCount,
      success_rate: sessionsCount > 0 ? Math.round((successCount / sessionsCount) * 100) : 0,
      // Not recorded per session, so there is nothing to average. Zero would
      // read as "the agent scored zero"; this reads as "no score", which is
      // what it is.
      avg_health_score: r.avg_health == null ? null : Math.round(r.avg_health as number),
      decisions_proposed: (r.decisions_proposed as number) ?? 0,
      evolution_events: evolutionMap.get(date) ?? 0,
    };
  });
}
