// =============================================================================
// FOUNDRY — Marketing: the second department (Hands Law layer 3)
//
// Marketing that kills its own bad bets. The loop:
//   sense  — top-of-funnel telemetry (metric_snapshots.signups_7d) + how much
//            of the Product DNA exists to ground a brief in
//   decide — a campaign IS a decision with a PREMISE: "consistent publishing
//            lifts weekly signups to >= N". The premise is a real metric
//            premise on signups_7d, so the memory kernel's daily check
//            falsifies it automatically when the channel doesn't work —
//            no vanity-metric immortality.
//   act    — campaigns are gate-2: the Trust Law forbids the autopilot from
//            committing them at ANY mode (act is gate-≤1 only). The ladder
//            here governs PROPOSING: shadow records what it would propose;
//            suggest/act put the campaign decision in front of the founder,
//            grounded brief attached.
//   learn  — a falsified campaign premise surfaces as an expired belief:
//            "you bet on this channel believing it would lift signups —
//            it didn't." The channel dies on the record.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { getProductDNA } from '../wisdom/dna.js';
import { getPolicy } from '../autopilot/policy.js';
import { recordPremise } from '../memory/kernel.js';
import { checkAndConsume } from '../outbound/envelopes.js';
import { ensurePolicyVisible, recordShadowWork } from './shared.js';
import { log } from '../../lib/logger.js';

export const CATEGORY = 'marketing';
const ENVELOPE_SCOPE = 'dept:marketing';
const CAMPAIGN_COOLDOWN_DAYS = 28;

export interface MarketingSweepResult {
  sensed: boolean;       // was there funnel telemetry to reason from?
  shadowed: number;
  proposed: number;
  skipped: number;
  reason?: string;
}

/** A content brief grounded ONLY in the founder's own DNA. Sparse DNA →
 *  a sparse brief that says so; it never invents positioning. */
export function draftContentBrief(dna: {
  icp_description?: string | null;
  icp_pain?: string | null;
  positioning_statement?: string | null;
  primary_objection?: string | null;
  growth_hypothesis?: string | null;
} | null): { title: string; brief: string; grounded: boolean } {
  const parts: string[] = [];
  if (dna?.icp_description) parts.push(`Audience: ${dna.icp_description}`);
  if (dna?.icp_pain) parts.push(`Lead with the pain: ${dna.icp_pain}`);
  if (dna?.positioning_statement) parts.push(`Angle: ${dna.positioning_statement}`);
  if (dna?.primary_objection) parts.push(`Answer the objection head-on: ${dna.primary_objection}`);
  if (dna?.growth_hypothesis) parts.push(`Growth thesis to test: ${dna.growth_hypothesis}`);
  const grounded = parts.length >= 2;
  if (!grounded) {
    parts.push('Your Product DNA is thin — fill in audience, pain, and positioning to get a brief that sounds like YOUR company instead of a template.');
  }
  return {
    title: 'Weekly content push',
    brief: parts.join('\n'),
    grounded,
  };
}

export async function runMarketingSweep(productId: string): Promise<MarketingSweepResult> {
  await ensurePolicyVisible(productId, CATEGORY);
  const policy = await getPolicy(productId, CATEGORY);

  // Sense: no funnel telemetry → nothing honest to propose (Honesty Law).
  const snap = (await query(
    `SELECT signups_7d FROM metric_snapshots WHERE product_id = ?
     ORDER BY snapshot_date DESC LIMIT 1`,
    [productId],
  )).rows[0] as Record<string, unknown> | undefined;
  const signups = snap?.signups_7d != null ? Number(snap.signups_7d) : null;
  if (signups == null) {
    return { sensed: false, shadowed: 0, proposed: 0, skipped: 0, reason: 'no funnel telemetry yet' };
  }

  // One campaign proposal per cooldown window — proposing is cheap, founder
  // attention is not (Attention Law).
  const recent = await query(
    `SELECT id FROM decisions WHERE product_id = ? AND category = ?
       AND created_at >= datetime('now', '-${CAMPAIGN_COOLDOWN_DAYS} days') LIMIT 1`,
    [productId, CATEGORY],
  );
  if (recent.rows.length > 0) {
    return { sensed: true, shadowed: 0, proposed: 0, skipped: 1, reason: 'campaign already live this cycle' };
  }

  const dna = await getProductDNA(productId);
  const draft = draftContentBrief(dna);
  // The testable bet: publishing lifts weekly signups by ≥20% (floor 5).
  const target = Math.max(Math.ceil(signups * 1.2), 5);

  if (policy.mode === 'shadow') {
    await recordShadowWork(
      productId, CATEGORY,
      `shadow: would propose "${draft.title}" — signups_7d at ${signups}, premise target >= ${target}`,
      { signups_7d: signups, target, grounded: draft.grounded },
    );
    return { sensed: true, shadowed: 1, proposed: 0, skipped: 0 };
  }

  const envelope = await checkAndConsume(productId, ENVELOPE_SCOPE);
  if (!envelope.allowed) {
    return { sensed: true, shadowed: 0, proposed: 0, skipped: 1, reason: 'department envelope reached' };
  }

  // The campaign decision — gate 2, so the founder always commits it
  // personally (Trust Law: autopilot acts at gate ≤ 1 only).
  const decisionId = nanoid();
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, recommendation, status)
     VALUES (?, ?, ?, 2, ?, ?, ?, 'pending')`,
    [
      decisionId, productId, CATEGORY,
      `${draft.title}: commit to one channel for ${CAMPAIGN_COOLDOWN_DAYS} days`,
      `Weekly signups are at ${signups}. A consistent content push is the cheapest lever you haven't systematically tested.`,
      draft.brief,
    ],
  );
  await recordPremise({
    productId,
    decisionId,
    decisionSource: 'decision',
    premise: `A consistent content push lifts weekly signups to at least ${target} (from ${signups})`,
    metricKey: 'signups_7d',
    comparator: '>=',
    threshold: target,
    graceDays: CAMPAIGN_COOLDOWN_DAYS, // judge the bet after its window, not before
  });

  log.info('marketing sweep proposed campaign', { productId, signups, target, grounded: draft.grounded });
  return { sensed: true, shadowed: 0, proposed: 1, skipped: 0 };
}
