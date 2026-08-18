// =============================================================================
// FOUNDRY — Founder Psychology Engine
// Detects behavioral patterns and surfaces gentle, actionable observations.
// All insights are private, non-judgmental, actionable, and dismissable.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';

export type PatternType =
  | 'overcorrection'
  | 'imposter_syndrome'
  | 'perfectionism'
  | 'empathy_scope_creep'
  | 'isolation_drift'
  | 'trauma_based'
  | 'model_fixation';

export interface PsychologyInsight {
  id: string;
  pattern_type: PatternType;
  description: string;
  confidence: number;
  evidence: string[];
  intervention_suggestion: string;
  status: string;
}

/**
 * Detect overcorrection pattern (serial founders over-indexing against past failures).
 */
export async function detectOvercorrection(founderId: string, productId: string): Promise<PsychologyInsight | null> {
  // Check for failure logs that indicate past founder experience
  const failures = await query(
    'SELECT * FROM failure_log WHERE product_id = ? ORDER BY created_at DESC LIMIT 10',
    [productId]
  );
  if (failures.rows.length < 2) return null;

  const decisions = await query(
    `SELECT * FROM decisions WHERE product_id = ? AND status IN ('approved', 'rejected') ORDER BY decided_at DESC LIMIT 20`,
    [productId]
  );

  const prompt = `Analyze whether this founder is overcorrecting from past failures.

Past failures logged:
${(failures.rows as unknown as Array<Record<string, string>>).map((f) =>
  `- ${f.category}: ${f.what_was_tried} → ${f.outcome}`
).join('\n')}

Recent decisions:
${(decisions.rows as unknown as Array<Record<string, string>>).map((d) =>
  `- [${d.category}] ${d.what} → ${d.status}`
).join('\n')}

If the founder's current decisions show extreme avoidance of past failure patterns (e.g., failed at growth so now refuses all growth-oriented decisions), return:
{"detected": true, "description": "...", "confidence": 0.0-1.0, "evidence": ["..."], "suggestion": "..."}

If no overcorrection detected:
{"detected": false}`;

  const response = await callOpus(
    'You are a founder behavior analyst. Detect overcorrection patterns. Be sensitive and non-judgmental.',
    prompt,
    1024, productId
  );

  const result = parseJSONResponse<{
    detected: boolean;
    description?: string;
    confidence?: number;
    evidence?: string[];
    suggestion?: string;
  }>(response.content);

  if (!result.detected) return null;

  const insight: PsychologyInsight = {
    id: nanoid(),
    pattern_type: 'overcorrection',
    description: result.description ?? 'Overcorrection pattern detected',
    confidence: result.confidence ?? 0.5,
    evidence: result.evidence ?? [],
    intervention_suggestion: result.suggestion ?? 'Consider whether your current approach is balanced.',
    status: 'active',
  };

  await persistInsight(founderId, productId, insight);
  return insight;
}

/**
 * Detect perfectionism: high commit frequency + low release frequency.
 */
export async function detectPerfectionism(productId: string, founderId: string): Promise<PsychologyInsight | null> {
  // Check audit log for commit activity vs releases
  const activity = await query(
    `SELECT action_type, COUNT(*) as cnt FROM audit_log
     WHERE product_id = ? AND created_at > datetime('now', '-30 days')
     GROUP BY action_type`,
    [productId]
  );

  const activityMap: Record<string, number> = {};
  for (const row of activity.rows as unknown as Array<Record<string, unknown>>) {
    activityMap[row.action_type as string] = row.cnt as number;
  }

  const commits = activityMap['code_commit'] ?? 0;
  const releases = activityMap['deployment'] ?? activityMap['release'] ?? 0;

  if (commits > 20 && releases === 0) {
    const insight: PsychologyInsight = {
      id: nanoid(),
      pattern_type: 'perfectionism',
      description: 'We notice high development activity but no releases in the past 30 days. Your product may be ready for users even if it feels incomplete.',
      confidence: 0.7,
      evidence: [`${commits} code activities, 0 releases in 30 days`],
      intervention_suggestion: 'Consider shipping what you have. Early user feedback is more valuable than another iteration cycle.',
      status: 'active',
    };
    await persistInsight(founderId, productId, insight);
    return insight;
  }

  return null;
}

/**
 * Detect empathy scope creep: all feature decisions approved, none declined.
 */
export async function detectEmpathyScopeCreep(productId: string, founderId: string): Promise<PsychologyInsight | null> {
  const decisions = await query(
    `SELECT status, COUNT(*) as cnt FROM decisions
     WHERE product_id = ? AND category = 'product' AND created_at > datetime('now', '-60 days')
     GROUP BY status`,
    [productId]
  );

  const statusMap: Record<string, number> = {};
  for (const row of decisions.rows as unknown as Array<Record<string, unknown>>) {
    statusMap[row.status as string] = row.cnt as number;
  }

  const approved = statusMap['approved'] ?? 0;
  const rejected = statusMap['rejected'] ?? 0;
  const total = approved + rejected;

  if (total >= 5 && rejected === 0) {
    const insight: PsychologyInsight = {
      id: nanoid(),
      pattern_type: 'empathy_scope_creep',
      description: `You've approved all ${approved} product decisions without declining any. Saying yes to everything can dilute your positioning.`,
      confidence: 0.65,
      evidence: [`${approved} approved, ${rejected} rejected product decisions in 60 days`],
      intervention_suggestion: 'Review your approved decisions: which ones advance your positioning, and which just make existing users incrementally happier?',
      status: 'active',
    };
    await persistInsight(founderId, productId, insight);
    return insight;
  }

  return null;
}

/**
 * Detect isolation drift (solo founders): declining engagement signals.
 */
export async function detectIsolationDrift(founderId: string, productId: string): Promise<PsychologyInsight | null> {
  // IS THIS FOUNDER ACTUALLY ALONE?
  //
  // This counted `cofounder_profiles`, a table nothing anywhere writes — no
  // INSERT in the codebase, no trigger, no migration seed. So the count was
  // always zero and EVERY founder read as solo, including one running a company
  // with three co-founders. The insight below then told them "As a solo
  // founder, your engagement has been declining", which is a false statement
  // about their own company delivered at the moment they are least able to
  // shrug it off.
  //
  // The real record of who is in a company is `team_members` — the canonical
  // membership model, the one the invite flow writes and every permission
  // check reads. `co_founder` is the role label the invite form offers for a
  // second founder; advisors and investor observers are not co-founders and
  // are deliberately not counted, because the thing being detected is building
  // ALONE, not having nobody to talk to.
  const cofounders = await query(
    `SELECT COUNT(*) AS c FROM team_members
      WHERE product_id = ? AND status = 'active' AND role = 'co_founder'`,
    [productId]
  );
  const cofounderCount = Number((cofounders.rows[0] as Record<string, unknown>)?.c ?? 0);
  if (cofounderCount > 0) return null; // Not solo

  // Check engagement trend from founder health
  const health = await query('SELECT engagement_trend, motivation_score FROM founder_health WHERE founder_id = ?', [founderId]);
  const h = health.rows[0] as Record<string, unknown> | undefined;

  if (h && ((h.engagement_trend === 'declining' || h.engagement_trend === 'critical') && ((h.motivation_score as number) ?? 100) < 40)) {
    const insight: PsychologyInsight = {
      id: nanoid(),
      pattern_type: 'isolation_drift',
      description: 'As a solo founder, your engagement has been declining. Building alone is hard — this is normal, not a failure.',
      confidence: 0.6,
      evidence: [`Engagement trend: ${h.engagement_trend}`, `Motivation score: ${h.motivation_score}`],
      intervention_suggestion: 'Consider joining a founder community, finding an accountability partner, or scheduling regular check-ins with a mentor.',
      status: 'active',
    };
    await persistInsight(founderId, productId, insight);
    return insight;
  }

  return null;
}

/**
 * Detect imposter signals: underpricing, excessive disclaimers, avoiding visibility.
 */
export async function detectImposterSignals(productId: string, founderId: string): Promise<PsychologyInsight | null> {
  const product = await query('SELECT name, sector_profile FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) return null;

  // Check for pricing data
  const economics = await query('SELECT * FROM unit_economics_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1', [productId]);
  const e = economics.rows[0] as Record<string, unknown> | undefined;

  if (e && (e.ltv_cac_ratio as number) > 10) {
    // Very high LTV:CAC might indicate underpricing
    const insight: PsychologyInsight = {
      id: nanoid(),
      pattern_type: 'imposter_syndrome',
      description: `Your LTV:CAC ratio of ${(e.ltv_cac_ratio as number).toFixed(1)}x is unusually high. This often signals underpricing — you may be delivering more value than you're capturing.`,
      confidence: 0.5,
      evidence: [`LTV:CAC ratio: ${(e.ltv_cac_ratio as number).toFixed(1)}x (healthy is 3-5x)`],
      intervention_suggestion: 'Consider a pricing experiment. A 20-30% increase for new customers would test whether your current price undervalues your product.',
      status: 'active',
    };
    await persistInsight(founderId, productId, insight);
    return insight;
  }

  return null;
}

/**
 * Generate all psychology insights for a founder. Returns at most 1 new insight.
 */
export async function generatePsychologyInsights(founderId: string, productId: string): Promise<PsychologyInsight | null> {
  // Only surface one insight at a time — check for recent active insights
  const recent = await query(
    `SELECT id FROM founder_psychology_insights
     WHERE founder_id = ? AND status = 'active' AND surfaced_at > datetime('now', '-7 days')`,
    [founderId]
  );
  if (recent.rows.length > 0) return null; // Already has a recent insight

  // Run detectors in sequence — first match wins
  const detectors = [
    () => detectPerfectionism(productId, founderId),
    () => detectEmpathyScopeCreep(productId, founderId),
    () => detectIsolationDrift(founderId, productId),
    () => detectImposterSignals(productId, founderId),
    () => detectOvercorrection(founderId, productId),
  ];

  for (const detect of detectors) {
    const insight = await detect();
    if (insight) return insight;
  }

  return null;
}

/**
 * Dismiss an insight (founder says "not relevant").
 */
export async function dismissInsight(insightId: string, founderId: string): Promise<void> {
  await query(
    `UPDATE founder_psychology_insights SET status = 'dismissed', acknowledged = 1
     WHERE id = ? AND founder_id = ?`,
    [insightId, founderId]
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function persistInsight(founderId: string, productId: string, insight: PsychologyInsight): Promise<void> {
  // Check for duplicate: same pattern_type in last 30 days
  const existing = await query(
    `SELECT id FROM founder_psychology_insights
     WHERE founder_id = ? AND product_id = ? AND pattern_type = ? AND surfaced_at > datetime('now', '-30 days')
     AND status != 'dismissed'`,
    [founderId, productId, insight.pattern_type]
  );
  if (existing.rows.length > 0) return; // Don't resurface

  await query(
    `INSERT INTO founder_psychology_insights (id, founder_id, product_id, pattern_type, description, confidence, evidence, intervention_suggestion, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      insight.id, founderId, productId, insight.pattern_type,
      insight.description, insight.confidence,
      JSON.stringify(insight.evidence), insight.intervention_suggestion,
      insight.status,
    ]
  );
}
