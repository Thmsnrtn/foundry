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
  // THE RATIONALE WAS PICKED ALPHABETICALLY. `MAX(strategic_rationale)` over a
  // group of strings returns the one that sorts last, and it sat in the same
  // row as `MAX(detected_at)` — so a reader takes the sentence beside "Latest"
  // to be the latest one. It was whichever rationale happened to start with the
  // highest character. Two signals for the same acquirer, and the older one
  // beginning with "They..." beats the newer one beginning with "Acquired...".
  //
  // This card is read as the current thinking on an acquirer, and it feeds the
  // acquisition thesis prompt. The correlated read below takes the rationale
  // from the most recent signal that has one, with `rowid` as the tiebreak two
  // signals recorded in the same second need — an id here is a nanoid, which is
  // not a clock, while SQLite assigns rowid in insertion order.
  const res = await query(
    `SELECT
       s.acquirer_name,
       s.acquirer_type,
       COUNT(*) as signal_count,
       AVG(s.fit_score) as avg_fit_score,
       MAX(s.detected_at) as latest_signal,
       (SELECT s2.strategic_rationale
          FROM acquirer_signals s2
         WHERE s2.product_id = s.product_id
           AND s2.acquirer_name = s.acquirer_name
           AND s2.acquirer_type = s.acquirer_type
           AND s2.strategic_rationale IS NOT NULL
         ORDER BY s2.detected_at DESC, s2.rowid DESC
         LIMIT 1) as strategic_rationale
     FROM acquirer_signals s
     WHERE s.product_id=?
     GROUP BY s.acquirer_name, s.acquirer_type
     ORDER BY avg_fit_score DESC, signal_count DESC, s.acquirer_name ASC
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

  // FOUR LABELS, THREE OF THEM WRONG. This block described the company to a
  // model that writes an acquisition thesis about it, and:
  //
  //   "Product:" was `dna.product_id` — a nanoid. The model was told the
  //   company is called "V1StGXR8_Z5jdHi6B-myT".
  //   "Current phase:" was `market_insight`, which is a note about the market
  //   the founder wrote, not a stage of the company.
  //   "Key differentiator:" was the positioning statement, which is a different
  //   sentence with a different job; `what_we_are_not` is the differentiator.
  //
  //   And every absent field read "Unknown", which in a thesis prompt is a
  //   statement about the company rather than about Foundry's records.
  const nameRow = (await query('SELECT name FROM products WHERE id = ?', [productId])
    .catch(() => ({ rows: [] }))).rows[0] as Record<string, unknown> | undefined;
  const productName = (nameRow?.name as string) ?? null;
  const orNotRecorded = (v: string | null | undefined) => v ?? 'not recorded in Foundry';

  const productDescription = dna
    ? `Company: ${orNotRecorded(productName)}
Problem it solves: ${orNotRecorded(dna.icp_pain)}
Target customer: ${orNotRecorded(dna.icp_description)}
Positioning statement: ${orNotRecorded(dna.positioning_statement)}
What it is deliberately not: ${orNotRecorded(dna.what_we_are_not)}
The founder's market insight: ${orNotRecorded(dna.market_insight)}`
    : `Company: ${orNotRecorded(productName)}
No Product DNA has been recorded, so the problem, the customer and the
positioning below are not available. Do not infer them.`;

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

  const response = await callSonnet(systemPrompt, userPrompt, 1500, productId);
  return response.content;
}
