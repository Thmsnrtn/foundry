// =============================================================================
// FOUNDRY — Strategic Acquirer Tracker
// Tracks acquirer signals and generates acquisition thesis using Claude.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { callSonnet } from '../../ai/client.js';
import { getLatestMAScore } from './ma-readiness.js';
import { getProductDNA } from '../../wisdom/dna.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AcquirerSignal {
  id: string;
  product_id: string;
  acquirer_name: string;
  acquirer_type: 'strategic' | 'financial' | 'pe';
  signal_type: string;
  signal_description: string;
  fit_score: number;
  strategic_rationale: string | null;
  notes: string | null;
  detected_at: string;
}

export interface AcquirerCandidate {
  acquirer_name: string;
  acquirer_type: string;
  signal_count: number;
  avg_fit_score: number;
  latest_signal: string;
  strategic_rationale: string | null;
}

// ─── addAcquirerSignal ────────────────────────────────────────────────────────

export async function addAcquirerSignal(
  productId: string,
  data: {
    acquirer_name: string;
    acquirer_type: 'strategic' | 'financial' | 'pe';
    signal_type: string;
    signal_description: string;
    fit_score?: number;
    strategic_rationale?: string;
    notes?: string;
  }
): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO acquirer_signals
       (id, product_id, acquirer_name, acquirer_type, signal_type,
        signal_description, fit_score, strategic_rationale, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      productId,
      data.acquirer_name,
      data.acquirer_type,
      data.signal_type,
      data.signal_description,
      data.fit_score ?? 0.5,
      data.strategic_rationale ?? null,
      data.notes ?? null,
    ]
  );
  return id;
}

// ─── getAcquirerSignals ───────────────────────────────────────────────────────

export async function getAcquirerSignals(productId: string): Promise<AcquirerSignal[]> {
  const res = await query(
    `SELECT * FROM acquirer_signals
     WHERE product_id=?
     ORDER BY detected_at DESC`,
    [productId]
  );
  return res.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      product_id: row.product_id as string,
      acquirer_name: row.acquirer_name as string,
      acquirer_type: row.acquirer_type as 'strategic' | 'financial' | 'pe',
      signal_type: row.signal_type as string,
      signal_description: row.signal_description as string,
      fit_score: row.fit_score as number,
      strategic_rationale: row.strategic_rationale as string | null,
      notes: row.notes as string | null,
      detected_at: row.detected_at as string,
    };
  });
}

// ─── getTopAcquirerCandidates ────────────────────────────────────────────────

export async function getTopAcquirerCandidates(productId: string): Promise<AcquirerCandidate[]> {
  const res = await query(
    `SELECT
       acquirer_name,
       acquirer_type,
       COUNT(*) as signal_count,
       AVG(fit_score) as avg_fit_score,
       MAX(detected_at) as latest_signal,
       MAX(strategic_rationale) as strategic_rationale
     FROM acquirer_signals
     WHERE product_id=?
     GROUP BY acquirer_name, acquirer_type
     ORDER BY avg_fit_score DESC, signal_count DESC
     LIMIT 10`,
    [productId]
  );

  return res.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      acquirer_name: row.acquirer_name as string,
      acquirer_type: row.acquirer_type as string,
      signal_count: row.signal_count as number,
      avg_fit_score: parseFloat((row.avg_fit_score as number).toFixed(2)),
      latest_signal: row.latest_signal as string,
      strategic_rationale: row.strategic_rationale as string | null,
    };
  });
}

// ─── generateAcquirerThesis ───────────────────────────────────────────────────

export async function generateAcquirerThesis(productId: string): Promise<string> {
  const [dna, maScore, signals, topCandidates] = await Promise.all([
    getProductDNA(productId).catch(() => null),
    getLatestMAScore(productId).catch(() => null),
    getAcquirerSignals(productId).catch(() => [] as AcquirerSignal[]),
    getTopAcquirerCandidates(productId).catch(() => [] as AcquirerCandidate[]),
  ]);

  const systemPrompt = `You are an M&A advisor helping a startup founder understand who is most likely to acquire them and why.
Be specific, strategic, and grounded in the data provided. Avoid generic advice.
Write in clear prose, 3-5 paragraphs. Focus on actionable insights.`;

  const productDescription = dna
    ? `Product: ${dna.product_name ?? 'Unknown'}
Problem it solves: ${dna.problem ?? 'Unknown'}
Target customer: ${dna.target_customer ?? 'Unknown'}
Key differentiator: ${dna.positioning ?? 'Unknown'}
Current phase: ${dna.current_phase ?? 'Unknown'}`
    : 'Product DNA not available.';

  const maContext = maScore
    ? `M&A Readiness Score: ${maScore.overall_score}/10
Ready to be acquired: ${maScore.ready_to_be_acquired ? 'Yes' : 'Not yet'}
Target acquirer profile: ${maScore.target_acquirer_profile}
Estimated multiple range: ${maScore.estimated_multiple_range}
Key gaps: ${maScore.key_gaps.join('; ') || 'None'}`
    : 'No M&A readiness assessment available.';

  const signalsContext = topCandidates.length > 0
    ? `Known acquirer signals:\n${topCandidates.map((c) =>
        `- ${c.acquirer_name} (${c.acquirer_type}): ${c.signal_count} signal(s), avg fit score ${c.avg_fit_score}, rationale: ${c.strategic_rationale ?? 'not specified'}`
      ).join('\n')}`
    : 'No acquirer signals tracked yet.';

  const recentSignals = signals.slice(0, 5);
  const signalDetails = recentSignals.length > 0
    ? `Recent signals:\n${recentSignals.map((s) =>
        `- ${s.acquirer_name}: ${s.signal_description} (fit: ${s.fit_score})`
      ).join('\n')}`
    : '';

  const userPrompt = `Based on the following information, generate an M&A acquisition thesis — explain which companies are most likely to acquire this startup, why they would pay a premium, and what the founder should do to maximize exit value.

${productDescription}

${maContext}

${signalsContext}

${signalDetails}

Generate a strategic acquisition thesis that covers:
1. The most likely acquirer archetypes and specific company types
2. Why they would value this company (strategic rationale)
3. What the company should do in the next 12 months to become a more attractive target
4. Any timing considerations or market dynamics that affect exit windows`;

  const response = await callSonnet(systemPrompt, userPrompt, 1500);
  return response.content;
}
