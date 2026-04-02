// =============================================================================
// FOUNDRY — Competitor Job Signal Intelligence
// Tracks competitor hiring signals and uses Claude to interpret strategic intent.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { callSonnet, parseJSONResponse } from '../ai/client.js';

// ─── Add Signal ───────────────────────────────────────────────────────────────

/**
 * Insert a competitor job signal, then trigger AI interpretation.
 * Returns the new signal ID.
 */
export async function addJobSignal(
  productId: string,
  data: {
    competitor_name: string;
    job_title: string;
    department?: string;
    seniority?: string;
    job_url?: string;
    description_excerpt?: string;
    posted_at: string;
  },
): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO competitor_job_signals
       (id, product_id, competitor_name, job_title, department, seniority, job_url, description_excerpt, posted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      productId,
      data.competitor_name,
      data.job_title,
      data.department ?? null,
      data.seniority ?? null,
      data.job_url ?? null,
      data.description_excerpt ?? null,
      data.posted_at,
    ],
  );

  // Fire-and-forget interpretation — don't block the caller
  interpretJobSignal(id).catch((err) =>
    console.error('[job-signals] interpretJobSignal error:', err),
  );

  return id;
}

// ─── Interpret ────────────────────────────────────────────────────────────────

/**
 * Use Claude to interpret what a competitor hiring signal means strategically.
 * Updates the signal_interpretation field.
 */
export async function interpretJobSignal(signalId: string): Promise<void> {
  const result = await query(
    `SELECT competitor_name, job_title, department, seniority, description_excerpt
     FROM competitor_job_signals WHERE id = ?`,
    [signalId],
  );
  if (result.rows.length === 0) return;

  const row = result.rows[0] as Record<string, unknown>;
  const competitorName = row.competitor_name as string;
  const jobTitle = row.job_title as string;
  const department = (row.department as string | null) ?? 'unknown';
  const seniority = (row.seniority as string | null) ?? 'unknown';
  const excerpt = (row.description_excerpt as string | null) ?? '';

  const systemPrompt = `You are a competitive intelligence analyst who interprets hiring signals to understand competitor strategic direction. Be concise and specific.`;

  const userPrompt = `A competitor is hiring for the following role. What does this signal about their strategic direction?

Competitor: ${competitorName}
Role: ${seniority !== 'unknown' ? seniority + ' ' : ''}${jobTitle}
Department: ${department}
${excerpt ? `Job excerpt: ${excerpt.slice(0, 500)}` : ''}

Provide a 2-3 sentence interpretation focusing on: what product/market bet this suggests, what capability they're building, and what it means for competitive positioning. Be specific, not generic.`;

  try {
    const response = await callSonnet(systemPrompt, userPrompt, 512);
    const interpretation = response.content.trim();

    await query(
      `UPDATE competitor_job_signals SET signal_interpretation = ? WHERE id = ?`,
      [interpretation, signalId],
    );
  } catch (err) {
    console.error('[job-signals] Claude interpretation error:', err);
  }
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Return trend data per competitor: recent signals, velocity, and an AI-summarized
 * strategic direction synthesized across all their recent job postings.
 */
export async function getJobSignalTrends(
  productId: string,
): Promise<Array<{
  competitor: string;
  recent_signals: Array<{ title: string; department: string; interpretation: string; posted_at: string }>;
  hiring_velocity: number;
  strategic_direction: string;
}>> {
  const result = await query(
    `SELECT competitor_name, job_title, department, signal_interpretation, posted_at, detected_at
     FROM competitor_job_signals
     WHERE product_id = ?
     ORDER BY detected_at DESC`,
    [productId],
  );

  const competitorMap = new Map<string, {
    signals: Array<{ title: string; department: string; interpretation: string; posted_at: string; detected_at: string }>;
  }>();

  for (const r of result.rows) {
    const row = r as Record<string, unknown>;
    const name = row.competitor_name as string;
    if (!competitorMap.has(name)) {
      competitorMap.set(name, { signals: [] });
    }
    competitorMap.get(name)!.signals.push({
      title: row.job_title as string,
      department: (row.department as string | null) ?? 'unknown',
      interpretation: (row.signal_interpretation as string | null) ?? '',
      posted_at: row.posted_at as string,
      detected_at: row.detected_at as string,
    });
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const trends: Array<{
    competitor: string;
    recent_signals: Array<{ title: string; department: string; interpretation: string; posted_at: string }>;
    hiring_velocity: number;
    strategic_direction: string;
  }> = [];

  for (const [competitor, data] of competitorMap.entries()) {
    const hiringVelocity = data.signals.filter(
      (s) => s.detected_at >= thirtyDaysAgo,
    ).length;

    const recentSignals = data.signals.slice(0, 5).map((s) => ({
      title: s.title,
      department: s.department,
      interpretation: s.interpretation,
      posted_at: s.posted_at,
    }));

    // Synthesize strategic direction from interpretations
    const interpretations = data.signals
      .filter((s) => s.interpretation)
      .slice(0, 10)
      .map((s) => `- ${s.title} (${s.department}): ${s.interpretation}`)
      .join('\n');

    let strategicDirection = 'Insufficient signals to determine direction.';
    if (interpretations) {
      try {
        const response = await callSonnet(
          'You are a competitive intelligence analyst. Synthesize hiring signals into a concise strategic direction summary.',
          `Based on these recent hiring signals from ${competitor}, summarize their overall strategic direction in 1-2 sentences:\n\n${interpretations}`,
          256,
        );
        strategicDirection = response.content.trim();
      } catch { /* use default */ }
    }

    trends.push({ competitor, recent_signals: recentSignals, hiring_velocity: hiringVelocity, strategic_direction: strategicDirection });
  }

  return trends.sort((a, b) => b.hiring_velocity - a.hiring_velocity);
}

/**
 * List job signals for a product, newest first.
 */
export async function listJobSignals(
  productId: string,
  limit = 50,
): Promise<Array<Record<string, unknown>>> {
  const result = await query(
    `SELECT id, competitor_name, job_title, department, seniority, job_url,
            description_excerpt, signal_interpretation, posted_at, detected_at
     FROM competitor_job_signals
     WHERE product_id = ?
     ORDER BY detected_at DESC
     LIMIT ?`,
    [productId, limit],
  );
  return result.rows as Array<Record<string, unknown>>;
}
