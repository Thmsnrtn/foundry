// =============================================================================
// FOUNDRY — Temporal Intelligence: Signal Replay + Event Recording
// Builds the enriched event timeline for Signal history replay.
// Records temporal events as they occur throughout the system.
// =============================================================================

import { query } from '../../db/client.js';
import { getSignalHistory } from '../signal.js';
import { nanoid } from 'nanoid';
import type { TemporalEvent, TemporalEventType } from '../../types/index.js';

// ─── Record a Temporal Event ──────────────────────────────────────────────────

/**
 * Record a significant event in the temporal timeline.
 * Called throughout the system whenever something noteworthy happens.
 */
export async function recordTemporalEvent(
  productId: string,
  eventType: TemporalEventType,
  title: string,
  options: {
    description?: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    // Get current Signal for context
    const signalResult = await query(
      `SELECT score FROM signal_history WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1`,
      [productId],
    );
    const signalAtEvent = (signalResult.rows[0] as Record<string, number> | undefined)?.score ?? null;

    // Compute delta from previous day
    const prevResult = await query(
      `SELECT score FROM signal_history WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1 OFFSET 1`,
      [productId],
    );
    const prevScore = (prevResult.rows[0] as Record<string, number> | undefined)?.score ?? null;
    const signalDelta = (signalAtEvent !== null && prevScore !== null) ? signalAtEvent - prevScore : null;

    const today = new Date().toISOString().slice(0, 10);

    await query(
      `INSERT INTO temporal_events
       (id, product_id, event_date, event_type, title, description,
        entity_type, entity_id, signal_at_event, signal_delta, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nanoid(),
        productId,
        today,
        eventType,
        title.slice(0, 120),
        options.description ?? null,
        options.entityType ?? null,
        options.entityId ?? null,
        signalAtEvent,
        signalDelta,
        options.metadata ? JSON.stringify(options.metadata) : null,
      ],
    );
  } catch (err) {
    // Non-critical: don't break the caller
    console.error('[temporal] recordTemporalEvent failed:', err);
  }
}

// ─── Build Replay Timeline ────────────────────────────────────────────────────

export interface ReplayFrame {
  date: string;
  signal: number;
  tier: string;
  riskState: string;
  events: Array<{
    id: string;
    type: TemporalEventType;
    title: string;
    description: string | null;
    entity_type: string | null;
    entity_id: string | null;
    metadata: Record<string, unknown> | null;
  }>;
}

/**
 * Build a day-by-day replay of the business timeline.
 * Returns Signal history enriched with events at each date.
 */
export async function buildReplayTimeline(
  productId: string,
  days = 90,
): Promise<ReplayFrame[]> {
  const [history, events] = await Promise.all([
    getSignalHistory(productId, days),
    query(
      `SELECT * FROM temporal_events
       WHERE product_id = ? AND event_date >= date('now', ?)
       ORDER BY event_date ASC`,
      [productId, `-${days} days`],
    ),
  ]);

  // Index events by date
  const eventsByDate = new Map<string, TemporalEvent[]>();
  for (const row of events.rows) {
    const event = row as unknown as TemporalEvent;
    const eventWithParsedMeta: TemporalEvent = {
      ...event,
      metadata: event.metadata ? (typeof event.metadata === 'string' ? JSON.parse(event.metadata as unknown as string) : event.metadata) : null,
    };
    if (!eventsByDate.has(event.event_date)) {
      eventsByDate.set(event.event_date, []);
    }
    eventsByDate.get(event.event_date)!.push(eventWithParsedMeta);
  }

  return history.map((h) => ({
    date: h.snapshot_date,
    signal: h.score,
    tier: h.tier,
    riskState: h.risk_state,
    events: (eventsByDate.get(h.snapshot_date) ?? []).map((e) => ({
      id: e.id,
      type: e.event_type,
      title: e.title,
      description: e.description,
      entity_type: e.entity_type,
      entity_id: e.entity_id,
      metadata: e.metadata,
    })),
  }));
}

// ─── Prediction Accuracy Tracking ────────────────────────────────────────────

/**
 * After a decision outcome is recorded, compare it to the scenario model prediction.
 * Computes direction accuracy, magnitude accuracy, and composite score.
 */
export async function recordPredictionAccuracy(
  productId: string,
  decisionId: string,
  actualOutcomeDirection: 'positive' | 'neutral' | 'negative',
  actualMrrDeltaPct: number | null,
  actualTimeframeDays: number | null,
): Promise<void> {
  // Get the scenario model for this decision
  const scenarioResult = await query(
    `SELECT id, option_label, base_case FROM scenario_models
     WHERE decision_id = ? LIMIT 1`,
    [decisionId],
  );
  if (scenarioResult.rows.length === 0) return;

  const scenario = scenarioResult.rows[0] as Record<string, string>;
  let baseCase: Record<string, unknown> = {};
  try {
    baseCase = JSON.parse(scenario.base_case) as Record<string, unknown>;
  } catch { return; }

  const predictedDirection = baseCase.outcome_direction as string | undefined;
  const predictedMrrDelta = baseCase.mrr_delta_pct as number | undefined;
  const predictedTimeframe = baseCase.timeframe_days as number | undefined;

  const directionCorrect = predictedDirection === actualOutcomeDirection;

  let magnitudeAccuracy: number | null = null;
  if (predictedMrrDelta !== undefined && actualMrrDeltaPct !== null) {
    const diff = Math.abs(predictedMrrDelta - actualMrrDeltaPct);
    magnitudeAccuracy = Math.max(0, 1 - diff / Math.max(Math.abs(predictedMrrDelta), 0.01));
  }

  let timeframeAccuracy: number | null = null;
  if (predictedTimeframe !== undefined && actualTimeframeDays !== null) {
    const diff = Math.abs(predictedTimeframe - actualTimeframeDays);
    timeframeAccuracy = Math.max(0, 1 - diff / Math.max(predictedTimeframe, 1));
  }

  const compositeAccuracy =
    (directionCorrect ? 0.5 : 0) +
    (magnitudeAccuracy !== null ? magnitudeAccuracy * 0.3 : 0) +
    (timeframeAccuracy !== null ? timeframeAccuracy * 0.2 : 0);

  await query(
    `INSERT INTO prediction_accuracy
     (id, product_id, scenario_model_id, decision_id, option_chosen,
      predicted_outcome_direction, predicted_mrr_delta_pct, predicted_timeframe_days,
      actual_outcome_direction, actual_mrr_delta_pct, actual_timeframe_days,
      direction_correct, magnitude_accuracy, timeframe_accuracy, composite_accuracy,
      measured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      nanoid(), productId, scenario.id, decisionId, scenario.option_label,
      predictedDirection ?? null, predictedMrrDelta ?? null, predictedTimeframe ?? null,
      actualOutcomeDirection, actualMrrDeltaPct, actualTimeframeDays,
      directionCorrect ? 1 : 0,
      magnitudeAccuracy, timeframeAccuracy, compositeAccuracy,
    ],
  );

  // Also update the scenario model's outcome_accuracy field
  await query(
    `UPDATE scenario_models SET outcome_accuracy = ? WHERE id = ?`,
    [JSON.stringify({ direction_correct: directionCorrect, composite_accuracy: compositeAccuracy }), scenario.id],
  );
}

/**
 * Get prediction accuracy summary for a product.
 * Used in the "how accurate is Foundry" dashboard.
 */
export async function getPredictionAccuracySummary(productId: string): Promise<{
  total_predictions: number;
  direction_accuracy: number;
  avg_composite_accuracy: number;
  by_category: Array<{ direction: string; count: number; accuracy: number }>;
}> {
  const result = await query(
    `SELECT
       COUNT(*) as total,
       AVG(CASE WHEN direction_correct THEN 1.0 ELSE 0.0 END) as dir_accuracy,
       AVG(composite_accuracy) as avg_composite
     FROM prediction_accuracy WHERE product_id = ?`,
    [productId],
  );

  const row = (result.rows[0] ?? {}) as Record<string, number | null>;

  const byCategoryResult = await query(
    `SELECT actual_outcome_direction as direction,
            COUNT(*) as count,
            AVG(CASE WHEN direction_correct THEN 1.0 ELSE 0.0 END) as accuracy
     FROM prediction_accuracy WHERE product_id = ?
     GROUP BY actual_outcome_direction`,
    [productId],
  );

  return {
    total_predictions: row.total ?? 0,
    direction_accuracy: row.dir_accuracy ?? 0,
    avg_composite_accuracy: row.avg_composite ?? 0,
    by_category: byCategoryResult.rows as unknown as Array<{ direction: string; count: number; accuracy: number }>,
  };
}
