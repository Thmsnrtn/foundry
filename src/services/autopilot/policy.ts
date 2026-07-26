// =============================================================================
// FOUNDRY — Autopilot policy engine (Ascent B6 realized / Trust Law)
//
// The graduation ladder: shadow → suggest → act, per decision category.
//
//   shadow  — measure only. Agreement between the agents' recommendation and
//             the founder's actual choice is computed from data Foundry already
//             records (decisions.recommendation vs chosen_option). Trust
//             accrues with ZERO delegated risk.
//   suggest — same measurement; recommendation surfaced as the default.
//   act     — the Second Self resolves gate-≤1 decisions in this category to
//             the recommendation, after a grace window, with undo + logging.
//
// Guardrails on the act path (all mandatory):
//   • founder-set mode only (the ledger PROPOSES; the founder flips the switch)
//   • gate ≤ 1 only — high-stakes decisions always reach the human
//   • grace window: the decision must have been visible ≥ AUTOPILOT_GRACE_HOURS
//   • a recommendation must exist (the autopilot never invents a choice)
//   • product must be active (kill switch: pausing SCP pauses the autopilot)
//   • every act is notified with a 24h undo; undo restores 'pending'
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { buildInsert } from '../../db/schema/kernel.js';
import { resolveDecision } from '../decisions/queue.js';
import { log } from '../../lib/logger.js';

export type AutopilotMode = 'shadow' | 'suggest' | 'act';
export const AUTOPILOT_GRACE_HOURS = 12;
export const SHADOW_MIN_SAMPLE = 5;
// AcreOS-converged promotion machinery: clean cycles from REAL outcomes.
export const PROMOTION_THRESHOLD = 10;   // clean cycles to earn shadow→suggest
export const QUALITY_FLOOR = 0.6;        // hold promotion if positive-rate below

const LADDER: AutopilotMode[] = ['shadow', 'suggest', 'act'];

export interface AutopilotPolicy {
  category: string;
  mode: AutopilotMode;
  set_by: string;
}

/** Plain-language mode labels (the AcreOS Controls convention — no jargon). */
export const MODE_LABELS: Record<AutopilotMode, string> = {
  shadow: 'Watching only',
  suggest: 'Suggests — you decide',
  act: 'Acts on low-stakes — safety-checked',
};

export interface PolicyRow extends AutopilotPolicy {
  clean_cycles: number;
  last_promoted_at: string | null;
  last_demoted_at: string | null;
  last_demotion_reason: string | null;
}

/** Every category's policy + counters, merged with categories seen in decisions
 *  (so brand-new categories appear as 'shadow' before any row exists). */
export async function getAllPolicies(productId: string): Promise<PolicyRow[]> {
  const [policies, seen] = await Promise.all([
    query('SELECT * FROM autopilot_policies WHERE product_id = ?', [productId]),
    query('SELECT DISTINCT category FROM decisions WHERE product_id = ? AND category IS NOT NULL', [productId]),
  ]);
  const byCat = new Map<string, PolicyRow>();
  for (const r of policies.rows as unknown as PolicyRow[]) byCat.set(r.category, r);
  for (const r of seen.rows as unknown as Array<{ category: string }>) {
    if (!byCat.has(r.category)) {
      byCat.set(r.category, {
        category: r.category, mode: 'shadow', set_by: 'default', clean_cycles: 0,
        last_promoted_at: null, last_demoted_at: null, last_demotion_reason: null,
      });
    }
  }
  return [...byCat.values()].sort((a, b) => a.category.localeCompare(b.category));
}

export async function getPolicy(productId: string, category: string): Promise<AutopilotPolicy> {
  const r = await query(
    'SELECT category, mode, set_by FROM autopilot_policies WHERE product_id = ? AND category = ?',
    [productId, category],
  );
  return (r.rows[0] as unknown as AutopilotPolicy) ?? { category, mode: 'shadow', set_by: 'default' };
}

/** The EFFECTIVE autonomy a department may exercise: the founder's configured
 *  mode clamped by the platform cap (Protective Wrapper). Departments MUST use
 *  this, never the raw policy mode — the cap is the operator-controlled ceiling
 *  the clean-hands posture depends on. */
export async function getEffectiveMode(productId: string, category: string): Promise<AutopilotMode> {
  const policy = await getPolicy(productId, category);
  const { effectiveMode } = await import('./platform-cap.js');
  return effectiveMode(policy.mode, category);
}

export async function setPolicy(
  productId: string, category: string, mode: AutopilotMode, setBy: string,
): Promise<void> {
  const prior = await getPolicy(productId, category);
  const { sql, args } = buildInsert('autopilot_policies', {
    id: nanoid(), product_id: productId, category, mode, set_by: setBy,
  });
  await query(
    sql + ` ON CONFLICT(product_id, category) DO UPDATE SET mode = excluded.mode, set_by = excluded.set_by, updated_at = CURRENT_TIMESTAMP`,
    args,
  );

  // Consent ledger (Protective Wrapper): raising to 'act' records the founder's
  // acknowledgment; dropping below 'act' revokes it. Best-effort — the policy
  // write is authoritative; the act path independently requires live consent.
  try {
    const { recordConsent, revokeConsent } = await import('./consent.js');
    if (mode === 'act' && prior.mode !== 'act') {
      await recordConsent({ founderId: setBy, productId, capability: category, fromMode: prior.mode, toMode: 'act' });
    } else if (mode !== 'act' && prior.mode === 'act') {
      await revokeConsent(productId, category);
    }
  } catch { /* consent ledger is additive; never block a policy change */ }

  log.info('autopilot policy set', { productId, category, mode, setBy });
}

export interface ShadowStats {
  category: string;
  sampled: number;        // founder-decided decisions that HAD a recommendation
  agreed: number;         // founder chose what the agents recommended
  agreementRate: number | null;
}

/** The shadow ledger, computed from data Foundry already records: on every
 *  founder-resolved decision that carried a recommendation, did the founder
 *  choose it? This is trust measured with zero delegated risk. */
export async function getShadowStats(productId: string): Promise<ShadowStats[]> {
  const r = await query(
    `SELECT category,
            COUNT(*) AS sampled,
            SUM(CASE WHEN TRIM(LOWER(chosen_option)) = TRIM(LOWER(recommendation)) THEN 1 ELSE 0 END) AS agreed
     FROM decisions
     WHERE product_id = ? AND decided_by = 'founder' AND status IN ('approved','rejected')
       AND recommendation IS NOT NULL AND chosen_option IS NOT NULL
     GROUP BY category`,
    [productId],
  );
  return (r.rows as unknown as Array<Record<string, unknown>>).map((row) => {
    const sampled = Number(row.sampled);
    const agreed = Number(row.agreed);
    return {
      category: String(row.category ?? 'uncategorized'),
      sampled,
      agreed,
      agreementRate: sampled >= SHADOW_MIN_SAMPLE ? agreed / sampled : null, // abstain on thin samples
    };
  });
}

// ── The feedback edge (AcreOS experienceLog semantics): autonomy is earned on
// RESOLVED outcomes only — pending banks nothing. ─────────────────────────────

/** Count each measured decision outcome into the ledger exactly once:
 *  positive → clean cycle (progress toward promotion); negative on a
 *  second_self decision → anomaly (instant one-rung demotion). */
export async function processOutcomeFeedback(productId: string): Promise<{ cleanCycles: number; anomalies: number }> {
  const rows = await query(
    `SELECT id, category, decided_by, outcome_valence FROM decisions
     WHERE product_id = ? AND autopilot_counted = 0 AND outcome_valence IS NOT NULL
       AND decided_by IN ('founder', 'second_self') LIMIT 50`,
    [productId],
  );
  let cleanCycles = 0;
  let anomalies = 0;
  for (const r of rows.rows as unknown as Array<Record<string, string | number>>) {
    // Atomic claim: only the tick that flips the flag banks this outcome, so
    // two overlapping sweeps can never double-count the same decision.
    const claim = await query(
      'UPDATE decisions SET autopilot_counted = 1 WHERE id = ? AND autopilot_counted = 0',
      [r.id],
    );
    if ((claim.rowsAffected ?? 0) === 0) continue;
    const category = (r.category as string) ?? 'uncategorized';
    // outcome_valence is an INTEGER column: 1 positive, -1 negative, 0 mixed.
    const valence = Number(r.outcome_valence);
    if (valence === 1) {
      cleanCycles++;
      await recordCleanCycle(productId, category);
    } else if (valence === -1 && r.decided_by === 'second_self') {
      anomalies++;
      await recordAnomaly(productId, category, `negative outcome on autopilot decision ${r.id}`);
    }
  }
  return { cleanCycles, anomalies };
}

/** A clean cycle banks toward promotion. shadow→suggest auto-promotes at the
 *  threshold IF the category's decision quality clears the floor (the AcreOS
 *  quality hold). The step INTO 'act' is never automatic — founder consent
 *  only (constitutional Trust Law). */
export async function recordCleanCycle(productId: string, category: string): Promise<void> {
  const policy = await getPolicy(productId, category);
  // Ensure the row exists, then bump the counter.
  await setPolicyRow(productId, category, policy.mode, policy.set_by);
  await query(
    `UPDATE autopilot_policies SET clean_cycles = clean_cycles + 1, updated_at = CURRENT_TIMESTAMP
     WHERE product_id = ? AND category = ?`,
    [productId, category],
  );
  const r = await query(
    'SELECT clean_cycles, mode FROM autopilot_policies WHERE product_id = ? AND category = ?',
    [productId, category],
  );
  const row = r.rows[0] as Record<string, unknown>;
  if (row.mode === 'shadow' && Number(row.clean_cycles) >= PROMOTION_THRESHOLD) {
    if (await qualityHold(productId, category)) {
      log.info('autopilot promotion HELD on quality', { productId, category });
      return;
    }
    // Calibration hold: an overconfident category (acts that fail verification,
    // beliefs that falsify) does not earn more autonomy, however high its
    // agreement rate. Truthfulness of confidence gates promotion.
    const { calibrationHold } = await import('./calibration.js');
    if (await calibrationHold(productId, category)) {
      log.info('autopilot promotion HELD on calibration', { productId, category });
      return;
    }
    await query(
      `UPDATE autopilot_policies
       SET mode = 'suggest', set_by = 'earned', clean_cycles = 0, last_promoted_at = CURRENT_TIMESTAMP
       WHERE product_id = ? AND category = ?`,
      [productId, category],
    );
    log.info('autopilot promoted shadow→suggest (earned)', { productId, category });
  }
}

/** Instant circuit-breaker: one rung down, counter reset, reason stamped. */
export async function recordAnomaly(productId: string, category: string, reason: string): Promise<void> {
  const policy = await getPolicy(productId, category);
  const idx = LADDER.indexOf(policy.mode);
  const demoted = LADDER[Math.max(0, idx - 1)];
  await setPolicyRow(productId, category, demoted, 'anomaly');
  await query(
    `UPDATE autopilot_policies
     SET clean_cycles = 0, last_demoted_at = CURRENT_TIMESTAMP, last_demotion_reason = ?
     WHERE product_id = ? AND category = ?`,
    [reason, productId, category],
  );
  // Consent ledger invariant: a capability that drops below 'act' must carry
  // revoked consent — the ledger must never claim authorization that the
  // policy no longer grants.
  if (policy.mode === 'act') {
    try {
      const { revokeConsent } = await import('./consent.js');
      await revokeConsent(productId, category);
    } catch { /* additive ledger; the demotion itself is authoritative */ }
  }
  log.info('autopilot demoted (anomaly)', { productId, category, from: policy.mode, to: demoted, reason });
}

/** Quality hold: don't widen autonomy while measured decision quality in the
 *  category sits below the floor ("earn autonomy by deciding WELL"). */
async function qualityHold(productId: string, category: string): Promise<boolean> {
  const r = await query(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN outcome_valence = 1 THEN 1 ELSE 0 END) AS pos
     FROM decisions
     WHERE product_id = ? AND category = ? AND outcome_valence IS NOT NULL`,
    [productId, category],
  );
  const row = r.rows[0] as Record<string, unknown>;
  const n = Number(row.n);
  if (n < SHADOW_MIN_SAMPLE) return false; // too thin to hold on
  return Number(row.pos) / n < QUALITY_FLOOR;
}

/** The big red button (AcreOS panic-stop): every category to shadow, counters
 *  kept (trust isn't erased, autonomy is just withdrawn), reason stamped. */
export async function panicStop(productId: string, founderId: string): Promise<number> {
  // Revoke consent for every 'act' category BEFORE the demotion, so the
  // ledger never shows live authorization for a capability panic withdrew.
  const acting = await query(
    "SELECT category FROM autopilot_policies WHERE product_id = ? AND mode = 'act'",
    [productId],
  );
  try {
    const { revokeConsent } = await import('./consent.js');
    for (const row of acting.rows as unknown as Array<{ category: string }>) {
      await revokeConsent(productId, row.category);
    }
  } catch { /* additive ledger; the stop itself is authoritative */ }

  const r = await query(
    `UPDATE autopilot_policies
     SET mode = 'shadow', set_by = 'panic', last_demoted_at = CURRENT_TIMESTAMP,
         last_demotion_reason = 'panic stop by founder', updated_at = CURRENT_TIMESTAMP
     WHERE product_id = ? AND mode != 'shadow'`,
    [productId],
  );
  log.info('autopilot PANIC STOP', { productId, founderId, categoriesStopped: r.rowsAffected ?? 0 });
  return Number(r.rowsAffected ?? 0);
}

// Internal: upsert a policy row without clobbering counters.
async function setPolicyRow(productId: string, category: string, mode: AutopilotMode, setBy: string): Promise<void> {
  const { sql, args } = buildInsert('autopilot_policies', {
    id: nanoid(), product_id: productId, category, mode, set_by: setBy,
  });
  await query(
    sql + ` ON CONFLICT(product_id, category) DO UPDATE SET mode = excluded.mode, set_by = excluded.set_by, updated_at = CURRENT_TIMESTAMP`,
    args,
  );
}

export interface AutoActResult {
  acted: number;
  decisions: Array<{ id: string; what: string; category: string }>;
}

/** The act path: resolve eligible gate-≤1 pending decisions in 'act' categories
 *  to the agents' recommendation. Every guardrail checked; every act logged,
 *  notified, undoable. */
export async function runAutopilotTick(productId: string): Promise<AutoActResult> {
  // Learn before acting: bank real outcomes into the ladder (clean cycles /
  // anomalies) so this tick acts on current trust, not stale trust.
  await processOutcomeFeedback(productId);

  // Kill switch: a paused company means a paused autopilot.
  const prod = await query(
    "SELECT scp_status FROM products WHERE id = ? AND status = 'active'", [productId],
  );
  const p = prod.rows[0] as Record<string, unknown> | undefined;
  if (!p || p.scp_status === 'paused') return { acted: 0, decisions: [] };

  const actCategories = await query(
    "SELECT category FROM autopilot_policies WHERE product_id = ? AND mode = 'act'",
    [productId],
  );
  // A configured 'act' is necessary but not sufficient: the platform cap must
  // allow act for the category (Protective Wrapper), and a live recorded
  // consent must exist (Consent Ledger). Either missing → the category is
  // treated as suggest and skipped here.
  const { effectiveMode } = await import('./platform-cap.js');
  const { hasActConsent } = await import('./consent.js');
  const categories: string[] = [];
  for (const r of actCategories.rows as unknown as Array<{ category: string }>) {
    if (effectiveMode('act', r.category) !== 'act') continue;
    if (!(await hasActConsent(productId, r.category))) {
      log.info('autopilot act skipped — no live consent', { productId, category: r.category });
      continue;
    }
    categories.push(r.category);
  }
  if (categories.length === 0) return { acted: 0, decisions: [] };

  const placeholders = categories.map(() => '?').join(',');
  const eligible = await query(
    `SELECT id, what, category, recommendation FROM decisions
     WHERE product_id = ? AND status = 'pending' AND gate <= 1
       AND category IN (${placeholders})
       AND recommendation IS NOT NULL
       AND created_at <= datetime('now', '-${AUTOPILOT_GRACE_HOURS} hours')
     LIMIT 10`,
    [productId, ...categories],
  );

  const acted: AutoActResult['decisions'] = [];
  for (const row of eligible.rows as unknown as Array<Record<string, string>>) {
    await resolveDecision(row.id, productId, row.recommendation, 'second_self');
    acted.push({ id: row.id, what: row.what, category: row.category });
    log.info('autopilot acted', { productId, decisionId: row.id, category: row.category });
  }
  return { acted: acted.length, decisions: acted };
}

/** Undo an autopilot action within the window: restores the decision to
 *  pending and drops this category back to 'suggest' — an undo is a trust
 *  signal, and the autopilot must hear it. */
export async function undoAutopilotAction(decisionId: string, productId: string): Promise<boolean> {
  const r = await query(
    `SELECT category FROM decisions
     WHERE id = ? AND product_id = ? AND decided_by = 'second_self'
       AND datetime(decided_at) >= datetime('now', '-1 day')`,
    [decisionId, productId],
  );
  const row = r.rows[0] as Record<string, string> | undefined;
  if (!row) return false;

  await query(
    `UPDATE decisions
     SET status = 'pending', chosen_option = NULL, decided_at = NULL, decided_by = NULL, follow_up_at = NULL
     WHERE id = ? AND product_id = ?`,
    [decisionId, productId],
  );
  // An undo is a NEGATIVE trust signal: it may only lower autonomy. If an
  // anomaly or panic already dropped the category to shadow, it stays there —
  // never promote on an undo.
  const current = await getPolicy(productId, row.category);
  if (current.mode === 'act') {
    await setPolicy(productId, row.category, 'suggest', 'undo_demotion');
    log.info('autopilot action undone — category demoted to suggest', { productId, decisionId, category: row.category });
  } else {
    log.info('autopilot action undone — category already at or below suggest', { productId, decisionId, category: row.category, mode: current.mode });
  }
  return true;
}
