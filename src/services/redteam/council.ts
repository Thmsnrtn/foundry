// =============================================================================
// FOUNDRY — Red Team council (Ascent B2 / Dissent Law)
//
// The adversary paid to disagree. For a high-stakes (gate 3+) decision, the
// council assumes the decision FAILED and works backward: three lenses
// (downside, competitor, capacity), each producing concrete objections —
// falsifiable where possible (a metric + failure condition). One atomic model
// call, structured output, persisted to the ledger.
//
// The unification with the Memory Kernel: an objection is an ANTI-PREMISE.
// When the founder overrules dissent and proceeds, each falsifiable objection's
// INVERSE is recorded as a monitored premise (origin='red_team'). If telemetry
// later falsifies it, the review is vindicated — a calibration point that gives
// dissent a track record (Honesty/Trust Laws).
// =============================================================================

import { nanoid } from 'nanoid';
import { z } from 'zod';
import { query } from '../../db/client.js';
import { callSonnet, parseJSONResponse } from '../ai/client.js';
import { buildInsert } from '../../db/schema/kernel.js';
import { recordPremise, CHECKABLE_METRIC_KEYS } from '../memory/kernel.js';
import {
  RED_TEAM_REVIEWS,
  type RedTeamReview,
  type RedTeamReviewInsert,
  type RedTeamObjection,
} from '../../db/schema/redteam.js';
import type { PremiseComparator } from '../../db/schema/memory.js';
import { log } from '../../lib/logger.js';

const objectionSchema = z.object({
  lens: z.enum(['downside', 'competitor', 'capacity']),
  claim: z.string(),
  severity: z.enum(['fatal', 'serious', 'note']),
  metric_key: z.string().optional(),
  comparator: z.enum(['<', '<=', '>', '>=']).optional(),
  threshold: z.number().optional(),
  mitigation: z.string().optional(),
});

const verdictSchema = z.object({
  verdict: z.enum(['proceed', 'proceed_with_changes', 'do_not_proceed']),
  strongest_objection: z.string(),
  confidence: z.number().min(0).max(1),
  objections: z.array(objectionSchema).max(6),
});

const SYSTEM_PROMPT = `You are Foundry's RED TEAM — the adversary a solo founder cannot hire. Your ONLY job is to find the ways this decision fails. You are not here to be balanced; the rest of the system is the optimist. Assume the decision was made and FAILED 90 days from now, then work backward.

Argue through exactly three lenses:
1. downside — what concretely breaks (revenue, churn, cash, product)?
2. competitor — how does a competitor or the market punish this move?
3. capacity — why does a SOLO founder specifically fail to execute this (time, focus, skill, burnout)?

Rules:
- Objections must be CONCRETE and specific to THIS decision and THIS company's numbers. No generic startup advice.
- Wherever possible, make an objection FALSIFIABLE: express the failure condition as one of these metrics ${JSON.stringify(CHECKABLE_METRIC_KEYS)} with a comparator (<, <=, >, >=) and threshold — the condition that, if observed, proves you were right.
- severity: 'fatal' = do not proceed; 'serious' = proceed only with the mitigation; 'note' = worth watching.
- If the decision genuinely survives all three lenses, say verdict 'proceed' — false alarms erode trust in dissent.
- Respond with ONLY JSON: {"verdict": "proceed"|"proceed_with_changes"|"do_not_proceed", "strongest_objection": string, "confidence": 0..1, "objections": [{"lens","claim","severity","metric_key"?,"comparator"?,"threshold"?,"mitigation"?}]}`;

export interface PreMortemResult {
  review: RedTeamReview;
  objections: RedTeamObjection[];
}

/** Run the adversarial pre-mortem for a pending decision. Idempotent per
 *  decision: an existing review is returned instead of re-running. */
export async function runPreMortem(decisionId: string, productId: string): Promise<PreMortemResult | null> {
  const existing = await getReviewForDecision(decisionId);
  if (existing) return { review: existing, objections: parseObjections(existing) };

  const dRes = await query(
    'SELECT * FROM decisions WHERE id = ? AND product_id = ?',
    [decisionId, productId],
  );
  const decision = dRes.rows[0] as Record<string, unknown> | undefined;
  if (!decision) return null;

  // Ground the council in the company's real numbers (Honesty Law: no
  // fabricated context — only what telemetry actually shows).
  const snap = await query(
    'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId],
  );
  // THE FIVE MOST SEVERE, not five arbitrary ones. An unordered `LIMIT 5` hands
  // a red team a biased sample of a company's risks without either of them
  // knowing it was a sample at all.
  const stressors = await query(
    `SELECT stressor_name, signal FROM stressor_history
      WHERE product_id = ? AND status = 'active'
      ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'elevated' THEN 2 ELSE 3 END, identified_at ASC
      LIMIT 5`,
    [productId],
  );
  const latest = (snap.rows[0] as Record<string, unknown> | undefined) ?? {};
  const telemetry = CHECKABLE_METRIC_KEYS
    .map((k) => (latest[k] != null ? `${k}=${latest[k]}` : null))
    .filter(Boolean)
    .join(', ') || 'no telemetry yet';

  const userPrompt = `DECISION UNDER REVIEW (gate ${decision.gate}, category ${decision.category}):
WHAT: ${decision.what}
WHY NOW: ${decision.why_now ?? 'n/a'}
OPTIONS: ${decision.options ?? 'n/a'}
RECOMMENDATION: ${decision.recommendation ?? 'n/a'}

COMPANY TELEMETRY (latest): ${telemetry}
ACTIVE STRESSORS: ${stressors.rows.map((r) => { const s = r as Record<string, unknown>; return `${s.stressor_name}: ${s.signal ?? ''}`; }).join('; ') || 'none'}

Run the pre-mortem.`;

  const response = await callSonnet(SYSTEM_PROMPT, userPrompt, 1500, productId);
  const parsed = parseJSONResponse(response.content, verdictSchema);

  const row: RedTeamReviewInsert = {
    id: nanoid(),
    product_id: productId,
    decision_id: decisionId,
    verdict: parsed.verdict,
    strongest_objection: parsed.strongest_objection,
    objections_json: JSON.stringify(parsed.objections),
    confidence: parsed.confidence,
    tokens_used: response.usage.input_tokens + response.usage.output_tokens,
  };
  const { sql, args } = buildInsert(RED_TEAM_REVIEWS, row as unknown as Record<string, unknown>);
  await query(sql, args);

  log.info('red_team pre-mortem complete', {
    productId, decisionId, verdict: parsed.verdict, objections: parsed.objections.length,
  });
  const review = await getReviewForDecision(decisionId);
  return review ? { review, objections: parsed.objections as RedTeamObjection[] } : null;
}

export async function getReviewForDecision(decisionId: string): Promise<RedTeamReview | null> {
  const r = await query(
    `SELECT * FROM ${RED_TEAM_REVIEWS} WHERE decision_id = ? ORDER BY created_at DESC LIMIT 1`,
    [decisionId],
  );
  return (r.rows[0] as unknown as RedTeamReview) ?? null;
}

export function parseObjections(review: RedTeamReview): RedTeamObjection[] {
  try {
    return JSON.parse(review.objections_json) as RedTeamObjection[];
  } catch {
    return [];
  }
}

// The failure condition's inverse is the belief the founder implicitly holds by
// proceeding: objection "churn_rate > 0.07" → premise "churn_rate <= 0.07".
const INVERT: Record<string, PremiseComparator> = { '>': '<=', '>=': '<', '<': '>=', '<=': '>' };

/** Called when the founder APPROVES a decision that carries unresolved dissent.
 *  Each falsifiable objection's inverse becomes a monitored premise, so the
 *  overruling is accountable and the dissent can be scored. */
export async function recordOverruledDissent(decisionId: string, productId: string): Promise<number> {
  const review = await getReviewForDecision(decisionId);
  if (!review || review.verdict === 'proceed') return 0;

  let recorded = 0;
  for (const obj of parseObjections(review)) {
    if (!obj.metric_key || !obj.comparator || obj.threshold == null) continue;
    const inverse = INVERT[obj.comparator];
    if (!inverse) continue;
    await recordPremise({
      productId,
      decisionId,
      decisionSource: 'decision',
      premise: `Overruled Red Team (${obj.lens}): ${obj.claim} — proceeding implies ${obj.metric_key} stays ${inverse} ${obj.threshold}`,
      metricKey: obj.metric_key,
      comparator: inverse,
      threshold: obj.threshold,
      origin: 'red_team',
      reviewId: review.id,
    });
    recorded++;
  }
  return recorded;
}

export interface DissentRecord {
  total: number;
  vindicated: number;
  overruled_held: number;
  pending: number;
}

/** The Red Team's track record for a product — its earned voice (Honesty Law). */
export async function getDissentRecord(productId: string): Promise<DissentRecord> {
  const r = await query(
    `SELECT resolved_outcome, COUNT(*) AS n FROM ${RED_TEAM_REVIEWS}
     WHERE product_id = ? GROUP BY resolved_outcome`,
    [productId],
  );
  const rec: DissentRecord = { total: 0, vindicated: 0, overruled_held: 0, pending: 0 };
  for (const row of r.rows as unknown as Array<{ resolved_outcome: string | null; n: number }>) {
    const n = Number(row.n);
    rec.total += n;
    if (row.resolved_outcome === 'vindicated') rec.vindicated = n;
    else if (row.resolved_outcome === 'overruled_held') rec.overruled_held = n;
    else rec.pending += n;
  }
  return rec;
}
