// =============================================================================
// FOUNDRY — Product Evolution: the third department (Hands Law layer 3)
//
// Product work that must cite the thesis and survive dissent. The loop:
//   sense  — real product telemetry only: activation, churn, support load
//   decide — a feature HYPOTHESIS is a gate-3 decision citing the Product
//            Thesis (the DNA's positioning + what-we-are-not), carrying a
//            metric premise with a grace window: "this work moves metric X
//            to Y within 30 days"
//   dissent— gate-3 means the EXISTING red_team_sweep contests every
//            hypothesis automatically before the founder commits — the
//            strongest anti-bloat force in the system costs zero new code
//   act    — the founder commits in the chamber (gate 3 never auto-executes);
//            the ladder governs proposing only
//   learn  — the premise falsifies honestly if the shipped work doesn't move
//            the metric: "you built this believing it would fix activation —
//            it didn't."
//
// No thesis, no hypotheses: a product without a stated positioning gets a
// nudge to write one, not invented feature ideas (Honesty Law).
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { getProductDNA } from '../wisdom/dna.js';
import { getPolicy } from '../autopilot/policy.js';
import { recordPremise } from '../memory/kernel.js';
import { checkAndConsume } from '../outbound/envelopes.js';
import { ensurePolicyVisible, recordShadowWork } from './shared.js';
import { log } from '../../lib/logger.js';

export const CATEGORY = 'product_evolution';        // trust-ladder category (Controls)
const DECISION_CATEGORY = 'product';                 // decisions.category CHECK vocabulary
const THESIS_MARKER = 'Serves the thesis:';          // marks this department's decisions
const ENVELOPE_SCOPE = 'dept:product_evolution';
const COOLDOWN_DAYS = 28;
const PREMISE_GRACE_DAYS = 30;

export interface ProductSweepResult {
  sensed: boolean;
  shadowed: number;
  proposed: number;
  skipped: number;
  reason?: string;
}

interface Hypothesis {
  what: string;
  whyNow: string;
  premise: string;
  metricKey: string;
  comparator: '<' | '<=' | '>' | '>=';
  threshold: number;
}

/** Deterministic hypothesis generation — each candidate exists ONLY because a
 *  real number crossed a real line. Strongest signal wins; one at a time. */
export function deriveHypothesis(snap: Record<string, unknown>): Hypothesis | null {
  const activation = snap.activation_rate != null ? Number(snap.activation_rate) : null;
  const churn = snap.churn_rate != null ? Number(snap.churn_rate) : null;
  const support = snap.support_volume_7d != null ? Number(snap.support_volume_7d) : null;

  if (activation != null && activation < 0.4) {
    const target = Math.round(activation * 1.15 * 100) / 100;
    return {
      what: 'Rework the first-run experience — new users are not reaching value',
      whyNow: `Activation is at ${Math.round(activation * 100)}% — most signups never experience the product working.`,
      premise: `Reworking onboarding lifts activation to at least ${target}`,
      metricKey: 'activation_rate', comparator: '>=', threshold: target,
    };
  }
  if (churn != null && churn > 0.07) {
    const target = Math.round(churn * 0.85 * 1000) / 1000;
    return {
      what: 'Find and fix the top churn driver — customers are leaving faster than you can replace them',
      whyNow: `Churn is at ${Math.round(churn * 1000) / 10}% monthly — growth is refilling a leaking bucket.`,
      premise: `Fixing the top churn driver brings churn down to at most ${target}`,
      metricKey: 'churn_rate', comparator: '<=', threshold: target,
    };
  }
  if (support != null && support > 20) {
    const target = Math.ceil(support * 0.8);
    return {
      what: 'Eliminate the top support driver — the product is asking humans to do its job',
      whyNow: `${support} support contacts this week — the most common one is a product defect wearing a costume.`,
      premise: `Fixing the top support driver cuts weekly volume to at most ${target}`,
      metricKey: 'support_volume_7d', comparator: '<=', threshold: target,
    };
  }
  return null;
}

export async function runProductSweep(productId: string): Promise<ProductSweepResult> {
  await ensurePolicyVisible(productId, CATEGORY);
  const policy = await getPolicy(productId, CATEGORY);

  // Hypotheses must cite a thesis. No positioning, no invented feature ideas.
  const dna = await getProductDNA(productId);
  if (!dna?.positioning_statement) {
    return { sensed: false, shadowed: 0, proposed: 0, skipped: 0, reason: 'no product thesis — write your positioning in Product DNA first' };
  }

  const snap = (await query(
    `SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1`,
    [productId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!snap) return { sensed: false, shadowed: 0, proposed: 0, skipped: 0, reason: 'no telemetry yet' };

  const hypothesis = deriveHypothesis(snap);
  if (!hypothesis) return { sensed: true, shadowed: 0, proposed: 0, skipped: 0, reason: 'no metric is over a line — nothing to propose' };

  const recent = await query(
    `SELECT id FROM decisions WHERE product_id = ? AND category = ?
       AND recommendation LIKE '${THESIS_MARKER}%'
       AND created_at >= datetime('now', '-${COOLDOWN_DAYS} days') LIMIT 1`,
    [productId, DECISION_CATEGORY],
  );
  if (recent.rows.length > 0) {
    return { sensed: true, shadowed: 0, proposed: 0, skipped: 1, reason: 'a hypothesis is already in front of you' };
  }

  if (policy.mode === 'shadow') {
    await recordShadowWork(
      productId, CATEGORY,
      `shadow: would propose "${hypothesis.what}" — premise: ${hypothesis.premise}`,
      { metric: hypothesis.metricKey, threshold: hypothesis.threshold },
    );
    return { sensed: true, shadowed: 1, proposed: 0, skipped: 0 };
  }

  const envelope = await checkAndConsume(productId, ENVELOPE_SCOPE);
  if (!envelope.allowed) {
    return { sensed: true, shadowed: 0, proposed: 0, skipped: 1, reason: 'department envelope reached' };
  }

  // Gate 3: the founder always commits personally, and the red_team_sweep
  // contests it automatically before they do (Dissent Law, existing machinery).
  const decisionId = nanoid();
  const thesisCitation = `${THESIS_MARKER} "${dna.positioning_statement}"` +
    (dna.what_we_are_not ? ` — and stays inside what we are not: "${dna.what_we_are_not}".` : '.');
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, recommendation, status)
     VALUES (?, ?, ?, 3, ?, ?, ?, 'pending')`,
    [decisionId, productId, DECISION_CATEGORY, hypothesis.what, hypothesis.whyNow, thesisCitation],
  );
  await recordPremise({
    productId,
    decisionId,
    decisionSource: 'decision',
    premise: hypothesis.premise,
    metricKey: hypothesis.metricKey,
    comparator: hypothesis.comparator,
    threshold: hypothesis.threshold,
    graceDays: PREMISE_GRACE_DAYS,
  });

  log.info('product evolution hypothesis proposed', { productId, what: hypothesis.what });
  return { sensed: true, shadowed: 0, proposed: 1, skipped: 0 };
}

const NEGATIVE_RESOLUTIONS = /do nothing|reject|defer|decline|not now/i;

/** When the founder commits a thesis-cited hypothesis, the decision becomes
 *  WORK: a ticket lands in the action queue carrying the hypothesis and its
 *  falsifiable premise. (Pending, not auto-executed: ticket creation needs a
 *  connected tracker, and the queue is where that connection is visible.) */
export async function onHypothesisResolved(
  decisionId: string, productId: string, chosenOption: string,
): Promise<void> {
  if (NEGATIVE_RESOLUTIONS.test(chosenOption)) return;
  const d = (await query(
    `SELECT what, why_now, recommendation FROM decisions
     WHERE id = ? AND product_id = ? AND recommendation LIKE '${THESIS_MARKER}%'`,
    [decisionId, productId],
  )).rows[0] as Record<string, string> | undefined;
  if (!d) return;

  const premise = (await query(
    `SELECT premise FROM decision_premises WHERE decision_id = ? LIMIT 1`, [decisionId],
  )).rows[0] as Record<string, string> | undefined;

  const { createExecution } = await import('../scp/actions/executor.js');
  await createExecution(productId, null, {
    action_type: 'create_ticket',
    integration: 'linear',
    ticket_title: d.what,
    ticket_description: [
      d.why_now,
      '',
      d.recommendation,
      premise ? `\nThe bet on record: ${premise.premise} — it falsifies honestly if the shipped work doesn't move the metric.` : '',
    ].join('\n'),
  });
  log.info('hypothesis converted to work', { productId, decisionId });
}
