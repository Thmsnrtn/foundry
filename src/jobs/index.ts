// =============================================================================
// FOUNDRY — All 14 Scheduled Jobs
// Each job is a standalone async function callable by cron or CLI.
// =============================================================================

import { logger } from '../services/logger.js';
import { getAllActiveProducts, operatingProduct, referenceCompany, query, insertAuditLog, countGate0DecisionsWithOutcomes } from '../db/client.js';
import { evaluateConditions } from '../services/lifecycle/monitor.js';
import { runCompetitiveScan } from '../services/intelligence/competitive.js';
import { getMRRDecomposition } from '../services/intelligence/revenue.js';
import { generateDigest } from '../services/digest/generator.js';
import { sendDigestEmail } from '../services/digest/delivery.js';
import { generatePatternFromOutcome } from '../services/decisions/patterns.js';
import { synthesizeJudgmentPatterns } from '../services/wisdom/patterns.js';
import { getProductDNA } from '../services/wisdom/dna.js';
import { isPRMerged, isPROpen } from '../services/audit/github.js';
import { triggerDimensionReAudit } from '../services/audit/remediation.js';
import { companySpend } from '../services/ai/what-it-is-for.js';;
import { checkAndAwardMilestones } from '../services/ux/milestones.js';
import { detectGrowthStage, updateGrowthStage } from '../services/lifecycle/stage-detection.js';
import { refreshFounderHealthMetrics } from '../services/intelligence/founder-health.js';
import { aggregateInsights } from '../services/wisdom/network.js';
// `runAllDueSyncs` was imported here and never scheduled. It belongs to the
// second integration subsystem — services/integrations/framework.ts — which
// writes `integrations.last_sync_at` / `last_sync_status` / `error_count` while
// the Integrations page reads `last_synced_at` / `last_error` / `status`. Two
// generations of the same columns on one table, and only the first is
// displayed. The scheduled job is `integration_sync`, which runs the OTHER
// subsystem (services/integrations/sync.ts). Left as-is rather than wired up:
// scheduling a second hourly sync over the same rows would double every
// provider call, and reconciling the two vocabularies is a real piece of work,
// not an import statement. Recorded in the frontier.
import { generatePredictions } from '../services/intelligence/predictive.js';
import { generateDraftsForPendingDecisions } from '../services/decisions/actions.js';
import { refreshAllCustomerHealth } from '../services/customers/intelligence.js';
import { generatePortfolioSnapshot } from '../services/portfolio/manager.js';
import { nanoid } from 'nanoid';
import type { RiskStateValue, StressorSeverity, CompetitiveSignal, GrowthStage } from '../types/index.js';

// ─── 1. Lifecycle Check — Daily 6:00 UTC ─────────────────────────────────────
export async function lifecycleCheck(): Promise<void> {
  logger.info('lifecycle_check starting', { jobName: 'lifecycle_check' });
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const activated = await evaluateConditions(p.id);
      if (activated.length > 0) {
        logger.info(`lifecycle_check: ${p.name} activated: ${activated.join(', ')}`, { jobName: 'lifecycle_check' });
      }
    } catch (err) {
      logger.error(`lifecycle_check error for ${p.id}:`, { jobName: 'lifecycle_check', error: String(err) });
    }
  }
  logger.info('lifecycle_check complete', { jobName: 'lifecycle_check' });
}

// ─── 2. Competitive Scan — Sunday 6:00 UTC ───────────────────────────────────
export async function competitiveScan(): Promise<void> {
  logger.info('competitive_scan starting', { jobName: 'competitive_scan' });
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const signals = await runCompetitiveScan(p.id);
      logger.info(`competitive_scan: ${p.name} — ${signals.length} signals`, { jobName: 'competitive_scan' });
    } catch (err) {
      logger.error(`competitive_scan error for ${p.id}:`, { jobName: 'competitive_scan', error: String(err) });
    }
  }
  logger.info('competitive_scan complete', { jobName: 'competitive_scan' });
}

// ─── 5. Behavioral Triggers — Every 6 hours ──────────────────────────────────
// BEHAVIOURAL TRIGGERS IS RETIRED, AND THE RESPONSIBILITY WITH IT.
//
// It was Commercial Foundry's activation funnel: four nudges — connect your
// GitHub, select a repository, act on your audit, your decisions are piling up
// — plus a day-three "you have not entered metrics yet" sequence, addressed to
// founders who signed up in the last seven days. Private Foundry has one owner
// and no funnel; there is no seventh day after his signup and no audit wizard
// to return to. The responsibility it served does not exist here.
//
// It had failed FORTY-NINE consecutive times since 1 September and nothing the
// owner could open said so. It failed closed, which is the only reason this is
// a tidy-up rather than an incident: every one of those sends was addressed to
// `founders.email`, which on this instance is the owner's personal address —
// the one he has ruled out of Foundry operations. A broken job was the only
// thing standing between that rule and forty-nine violations of it.
//
// Retired rather than repaired: repairing it would mean deciding who to write
// to about an onboarding that does not happen. `job_health` keeps the history;
// the row is cleared so the institution stops expecting a routine that no
// longer exists.

// ─── SLO / degradation check — hourly ────────────────────────────────────────
export async function sloCheck(): Promise<void> {
  logger.info('slo_check starting', { jobName: 'slo_check' });
  const { runSloChecksAndAlert } = await import('../services/slo.js');
  const breaches = await runSloChecksAndAlert();
  logger.info('slo_check complete', { jobName: 'slo_check', breachCount: breaches.length });
}

// ─── 6. THE DAILY PLACEHOLDER SNAPSHOT, AND WHY IT IS GONE ───────────────────
//
// `metricSnapshot` inserted an EMPTY `metric_snapshots` row for every active
// product at midnight UTC, "to ensure daily snapshots exist". Nothing needed
// them to exist, and their existence was read as measurement all over the
// codebase:
//
//   • `getMRRDecomposition` read the LATEST row — the placeholder — and
//     returned a confident decomposition of zeros to ten importers, because
//     the four movement columns are `INTEGER DEFAULT 0` and cannot say
//     "not reported". It now selects the newest row that reports SOMETHING,
//     which was a workaround for this job.
//   • `/v1/metrics/health` computed `is_stale` from the EXISTENCE of a row, so
//     every company was fresh from its first day forever.
//   • `assessMigrationReadiness` and several intelligence readers took the
//     latest row and found a company with no revenue.
//
// The two ingest paths that genuinely depended on the row — the GitHub and
// Intercom adapters, which wrote into today's snapshot with a bare UPDATE and
// reported success when it matched nothing — upsert now. The Stripe webhook
// path always called `ensureSnapshot` for itself. So nothing is left that needs
// a row it did not write.
//
// WHAT THE ABSENCE OF A ROW NOW MEANS: this company reported nothing that day.
// That is a fact worth being able to state, and a row of zeros cannot state it.

// ─── 8. Cold Start Check — Daily ──────────────────────────────────────────────
export async function coldStartCheck(): Promise<void> {
  logger.info('cold_start_check starting', { jobName: 'cold_start_check' });
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    const count = await countGate0DecisionsWithOutcomes(p.id);
    const ls = await query('SELECT * FROM lifecycle_state WHERE product_id = ?', [p.id]);
    const lsRow = ls.rows[0] as Record<string, unknown> | undefined;
    if (!lsRow) continue;

    const createdAt = new Date(p.created_at);
    const daysSinceCreation = Math.floor((Date.now() - createdAt.getTime()) / 86400000);

    // Cold Start exits when: 25+ decisions with outcomes AND 30+ days elapsed
    const coldStartActive = count < 25 || daysSinceCreation < 30;

    if (!coldStartActive && lsRow.prompt_9_status === 'not_started') {
      // Exit cold start — mark prompt 9 as started
      await query(
        `UPDATE lifecycle_state SET prompt_9_status = 'in_progress', prompt_9_started_at = ? WHERE product_id = ?`,
        [new Date().toISOString(), p.id]);

      await insertAuditLog({
        id: nanoid(), product_id: p.id,
        action_type: 'cold_start_exit', gate: 1,
        trigger: 'cold_start_check',
        reasoning: `Cold Start complete: ${count} decisions with outcomes, ${daysSinceCreation} days elapsed`,
      });
    }
  }
  logger.info('cold_start_check complete', { jobName: 'cold_start_check' });
}

// ─── 9. Scenario Accuracy — Weekly after synthesis ────────────────────────────
export async function scenarioAccuracy(): Promise<void> {
  logger.info('scenario_accuracy starting', { jobName: 'scenario_accuracy' });
  // A PAID FRONTIER CALL THAT NOTHING READ, DUPLICATING A FREE DETERMINISTIC ONE.
  //
  // This asked Opus, once per decision and up to twenty per pass, to classify
  // an outcome as positive/neutral/negative and score how close the base case
  // had been. It then wrote that answer to `scenario_models.outcome_accuracy`
  // — a column no SELECT in this repository reads. Every reader of
  // `scenario_models` takes `id`, `option_label`, `base_case`, `best_case`,
  // `stress_case`, and none of them takes the accuracy.
  //
  // Meanwhile the direction it was paying to infer is already a recorded fact:
  // `decisions.outcome_valence`, which the prediction-accuracy job beside this
  // one reads deterministically and writes to `prediction_accuracy`, a table
  // that IS read. So the model was being asked for something the database
  // already knew, and the answer was filed where nobody looks.
  //
  // Cognition pays rent or it goes. What this job is FOR — contributing the
  // outcome to the cross-company pattern pool — is kept, computed from the
  // valence the founder recorded. The scenario comparison it was scoring is
  // not lost either: nothing consumed it, and if a consumer appears the
  // deterministic comparison can be written then, without buying it.
  const decisions = await query(
    `SELECT d.id, d.product_id, d.category, d.chosen_option, d.outcome_valence
     FROM decisions d
     JOIN scenario_models sm ON d.id = sm.decision_id
     JOIN products p ON p.id = d.product_id
     WHERE d.outcome IS NOT NULL AND d.outcome_valence IS NOT NULL
       AND ${operatingProduct('p')}
     LIMIT 20`, []);

  for (const row of decisions.rows) {
    const d = row as Record<string, unknown>;
    try {
      const valence = Number(d.outcome_valence);
      const outcomeDirection = valence === 1 ? 'positive' : valence === -1 ? 'negative' : 'neutral';

      const ls = await query('SELECT * FROM lifecycle_state WHERE product_id = ?', [d.product_id]);
      const lsRow = ls.rows[0] as Record<string, string> | undefined;

      await generatePatternFromOutcome({
        productId: d.product_id as string,
        decisionType: d.category as string,
        lifecycleStage: lsRow?.current_prompt ?? 'unknown',
        riskState: (lsRow?.risk_state as RiskStateValue) ?? 'green',
        metricsContext: {},
        optionChosen: d.chosen_option as string,
        outcomeDirection,
        outcomeMagnitude: 'moderate',
        outcomeTimeframeDays: 30,
        marketCategory: null,
        contributingFactors: null,
        // NOT A SCORE ANY MORE, AND NOT A FABRICATED ONE. The accuracy figure
        // came from the model call that has gone; inventing a number here
        // would be worse than the call was. The pool records the outcome
        // without a scenario-accuracy claim.
        scenarioAccuracyScore: null,
      });
    } catch (err) {
      logger.error(`scenario_accuracy error for decision ${d.id}:`, { jobName: 'scenario_accuracy', error: String(err) });
    }
  }
  logger.info('scenario_accuracy complete', { jobName: 'scenario_accuracy' });
}


// ─── 10. Yellow Pulse — Thursday (for Yellow state products) ──────────────────
export async function yellowPulse(): Promise<void> {
  logger.info('yellow_pulse starting', { jobName: 'yellow_pulse' });
  const products = await query(
    `SELECT p.*, f.email FROM products p
     JOIN founders f ON p.owner_id = f.id
     JOIN lifecycle_state ls ON p.id = ls.product_id
     WHERE ls.risk_state = 'yellow' AND ${operatingProduct('p')}`, []);

  for (const row of products.rows) {
    const p = row as Record<string, unknown>;
    try {
      const digest = await generateDigest(p.id as string, 'yellow', 'yellow_pulse');
      await sendDigestEmail(p.id as string, p.email as string, p.name as string, digest);
    } catch (err) {
      logger.error(`yellow_pulse error for ${p.id}:`, { jobName: 'yellow_pulse', error: String(err) });
    }
  }
  logger.info('yellow_pulse complete', { jobName: 'yellow_pulse' });
}

// ─── 11. Red Daily — Daily (for Red state products) ───────────────────────────
export async function redDaily(): Promise<void> {
  logger.info('red_daily starting', { jobName: 'red_daily' });
  const products = await query(
    `SELECT p.*, f.email FROM products p
     JOIN founders f ON p.owner_id = f.id
     JOIN lifecycle_state ls ON p.id = ls.product_id
     WHERE ls.risk_state = 'red' AND ${operatingProduct('p')}`, []);

  for (const row of products.rows) {
    const p = row as Record<string, unknown>;
    try {
      const digest = await generateDigest(p.id as string, 'red', 'red_daily');
      await sendDigestEmail(p.id as string, p.email as string, p.name as string, digest);
    } catch (err) {
      logger.error(`red_daily error for ${p.id}:`, { jobName: 'red_daily', error: String(err) });
    }
  }
  logger.info('red_daily complete', { jobName: 'red_daily' });
}

// ─── 12. Stressor Cleanup — Daily ────────────────────────────────────────────
export async function stressorCleanup(): Promise<void> {
  logger.info('stressor_cleanup starting', { jobName: 'stressor_cleanup' });
  // Auto-resolve stressors that have exceeded their timeframe
  await query(
    `UPDATE stressor_history SET status = 'escalated', resolution_notes = 'Auto-escalated: exceeded timeframe'
     WHERE status = 'active' AND datetime(identified_at, '+' || timeframe_days || ' days') < datetime('now')`, []);
  logger.info('stressor_cleanup complete', { jobName: 'stressor_cleanup' });
}

// ─── 13. Pattern Aggregation — Weekly ─────────────────────────────────────────
export async function patternAggregation(): Promise<void> {
  logger.info('pattern_aggregation starting', { jobName: 'pattern_aggregation' });
  // Log pattern stats for monitoring
  const total = await query('SELECT COUNT(*) as c FROM decision_patterns', []);
  const withOutcomes = await query('SELECT COUNT(*) as c FROM decision_patterns WHERE outcome_direction IS NOT NULL', []);
  logger.info(`pattern_aggregation: ${(total.rows[0] as Record<string, number>)?.c ?? 0} total, ${(withOutcomes.rows[0] as Record<string, number>)?.c ?? 0} with outcomes`, { jobName: 'pattern_aggregation' });

  // Cross-product wisdom network aggregation
  try {
    const insightsGenerated = await aggregateInsights();
    if (insightsGenerated > 0) {
      logger.info(`pattern_aggregation: generated ${insightsGenerated} cross-product insights`, { jobName: 'pattern_aggregation' });
    }
  } catch (err) {
    logger.error('JOB: pattern_aggregation: wisdom network aggregation failed:', { jobName: 'JOB', error: String(err) });
  }
  logger.info('pattern_aggregation complete', { jobName: 'pattern_aggregation' });
}

// ─── 14. Story Capture — Event-driven, but checked daily ─────────────────────
export async function storyCapture(): Promise<void> {
  logger.info('story_capture starting', { jobName: 'story_capture' });
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    // Check for milestone events that should generate story artifacts
    const recentTransitions = await query(
      `SELECT * FROM audit_log WHERE product_id = ? AND action_type = 'risk_state_transition' AND created_at > datetime('now', '-1 day')`, [p.id]);

    for (const t of recentTransitions.rows) {
      const tr = t as Record<string, unknown>;
      await query(
        `INSERT INTO founding_story_artifacts (id, product_id, phase, artifact_type, title, content)
         VALUES (?, ?, 'operational', 'risk_event', ?, ?)`,
        [nanoid(), p.id, `Risk Transition: ${tr.reasoning}`, tr.reasoning as string]);
    }
  }
  logger.info('story_capture complete', { jobName: 'story_capture' });
}

// ─── 15. Founder Pattern Synthesis — Sunday 7:00 UTC ──────────────────────────
export async function founderPatternSynthesis(): Promise<void> {
  logger.info('founder_pattern_synthesis starting', { jobName: 'founder_pattern_synthesis' });
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      // Only synthesize for products with wisdom layer active
      const ls = await query('SELECT wisdom_layer_active FROM lifecycle_state WHERE product_id = ?', [p.id]);
      const lsRow = ls.rows[0] as Record<string, unknown> | undefined;
      if (!lsRow || (lsRow.wisdom_layer_active as number) !== 1) continue;

      // Check for 3+ resolved Gate 3 decisions with reasoning
      const decisions = await query(
        // `decisions.status` has never had a 'resolved' value — the
        // vocabulary is pending / approved / rejected / executed / expired. So
        // this count was always zero, `cnt < 3` always held, and
        // founder-pattern synthesis has never run for anybody. A decision the
        // founder settled is one they approved or rejected; both carry the
        // reasoning this looks for.
        `SELECT COUNT(*) as cnt FROM decisions
          WHERE product_id = ? AND gate = 3
            AND status IN ('approved','rejected','executed')
            AND resolution_reasoning IS NOT NULL`,
        [p.id]
      );
      const cnt = (decisions.rows[0] as Record<string, number>)?.cnt ?? 0;
      if (cnt < 3) continue;

      await synthesizeJudgmentPatterns(p.id, p.owner_id);
      logger.info(`founder_pattern_synthesis: ${p.name} — patterns synthesized`, { jobName: 'founder_pattern_synthesis' });
    } catch (err) {
      logger.error(`founder_pattern_synthesis error for ${p.id}:`, { jobName: 'founder_pattern_synthesis', error: String(err) });
    }
  }
  logger.info('founder_pattern_synthesis complete', { jobName: 'founder_pattern_synthesis' });
}

// ─── 16. DNA Completion Nudge — Wednesday 8:00 UTC ────────────────────────────
export async function dnaCompletionNudge(): Promise<void> {
  logger.info('dna_completion_nudge starting', { jobName: 'dna_completion_nudge' });
  const products = await query(
    `SELECT p.id, p.name, p.owner_id, p.created_at, f.email
     FROM products p
     JOIN founders f ON p.owner_id = f.id
     JOIN lifecycle_state ls ON p.id = ls.product_id
     WHERE ${operatingProduct('p')}
       AND (ls.dna_completion_pct IS NULL OR ls.dna_completion_pct < 60)
       AND p.created_at < datetime('now', '-14 days')`, []
  );

  for (const row of products.rows) {
    const p = row as Record<string, unknown>;
    try {
      // Max 1 nudge per week: check audit_log
      const recent = await query(
        `SELECT id FROM audit_log WHERE product_id = ? AND action_type = 'dna_completion_nudge' AND created_at > datetime('now', '-7 days')`,
        [p.id]
      );
      if (recent.rows.length > 0) continue;

      const dna = await getProductDNA(p.id as string);
      const completionPct = dna?.completion_pct ?? 0;

      await sendDigestEmail(
        p.id as string,
        p.email as string,
        p.name as string,
        {
          subject: `Your Product DNA is ${completionPct}% complete — reach 60% to unlock Wisdom`,
          html: `<p>Complete your Product DNA to activate Foundry's Wisdom Layer. At 60%, audit scoring uses your specific ICP and positioning instead of generic best practices.</p><p><a href="${process.env.APP_URL}/products/${p.id}/dna">Edit Product DNA →</a></p>`,
        } as any
      );

      await query(
        `INSERT INTO audit_log (id, product_id, action_type, gate, trigger, reasoning, created_at) VALUES (?, ?, 'dna_completion_nudge', 0, 'job', ?, ?)`,
        [nanoid(), p.id, JSON.stringify({ completion_pct: completionPct }), new Date().toISOString()]
      );
      logger.info(`dna_completion_nudge: nudged ${p.name} (${completionPct}%)`, { jobName: 'dna_completion_nudge' });
    } catch (err) {
      logger.error(`dna_completion_nudge error for ${p.id}:`, { jobName: 'dna_completion_nudge', error: String(err) });
    }
  }
  logger.info('dna_completion_nudge complete', { jobName: 'dna_completion_nudge' });
}

// ─── 17. Remediation Outcome Check — Daily 9:00 UTC ───────────────────────────
export async function remediationOutcomeCheck(): Promise<void> {
  logger.info('remediation_outcome_check starting', { jobName: 'remediation_outcome_check' });
  const openPRs = await query(
    `SELECT rp.*, p.github_repo_owner, p.github_repo_name, p.github_access_token
     FROM remediation_prs rp
     JOIN products p ON rp.product_id = p.id
     WHERE rp.status = 'pr_open'`, []
  );

  for (const row of openPRs.rows) {
    const pr = row as Record<string, unknown>;
    try {
      const owner = pr.github_repo_owner as string;
      const repo = pr.github_repo_name as string;
      const token = pr.github_access_token as string;
      const prNumber = pr.github_pr_number as number;

      if (!owner || !repo || !token || !prNumber) continue;

      // Check if merged
      const merged = await isPRMerged(owner, repo, prNumber, token);
      if (merged) {
        await query(
          `UPDATE remediation_prs SET status = 'merged', resolved_at = ? WHERE id = ?`,
          [new Date().toISOString(), pr.id]
        );
        // Trigger dimension re-audit
        await triggerDimensionReAudit(
          pr.product_id as string,
          pr.audit_score_id as string,
          pr.blocking_issue_dimension as string,
          pr.id as string
        );
        logger.info(`remediation_outcome_check: PR #${prNumber} merged, re-audit triggered`, { jobName: 'remediation_outcome_check' });
        continue;
      }

      // Check if closed (rejected)
      const open = await isPROpen(owner, repo, prNumber, token);
      if (!open) {
        await query(
          `UPDATE remediation_prs SET status = 'rejected', resolved_at = ?, rejection_reason = 'PR closed without merge' WHERE id = ?`,
          [new Date().toISOString(), pr.id]
        );
        logger.info(`remediation_outcome_check: PR #${prNumber} rejected`, { jobName: 'remediation_outcome_check' });
        continue;
      }

      // Check for stale (14+ days open)
      const createdAt = new Date(pr.created_at as string);
      const daysSinceCreation = Math.floor((Date.now() - createdAt.getTime()) / 86400000);
      if (daysSinceCreation >= 14) {
        await query(
          `INSERT INTO audit_log (id, product_id, action_type, gate, trigger, reasoning, created_at) VALUES (?, ?, 'remediation_pr_stale', 0, 'job', ?, ?)`,
          [nanoid(), pr.product_id, JSON.stringify({ pr_id: pr.id, pr_number: prNumber, days_open: daysSinceCreation }), new Date().toISOString()]
        );
      }
    } catch (err) {
      logger.error(`remediation_outcome_check error for PR ${pr.id}:`, { jobName: 'remediation_outcome_check', error: String(err) });
    }
  }
  logger.info('remediation_outcome_check complete', { jobName: 'remediation_outcome_check' });
}

// ─── 18. Milestone Check — Daily 8:00 UTC ─────────────────────────────────────
export async function milestoneCheck(): Promise<void> {
  logger.info('milestone_check starting', { jobName: 'milestone_check' });
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const awarded = await checkAndAwardMilestones(p.id, p.owner_id);
      if (awarded.length > 0) {
        logger.info(`milestone_check: ${p.name} — ${awarded.length} new milestones`, { jobName: 'milestone_check' });
      }
    } catch (err) {
      logger.error(`milestone_check error for ${p.id}:`, { jobName: 'milestone_check', error: String(err) });
    }
  }
  logger.info('milestone_check complete', { jobName: 'milestone_check' });
}

// ─── 19. Nav Badge Refresh — Every 6 hours ────────────────────────────────────
export async function navBadgeRefresh(): Promise<void> {
  logger.info('nav_badge_refresh starting', { jobName: 'nav_badge_refresh' });
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      // FOUR OF THESE SIX COUNTS FED A BADGE THAT DOES NOT EXIST. The sidebar
      // draws one badge — the count beside "Decide" — and has since the nav was
      // cut to five doors. An audit's age, unacknowledged competitive signals,
      // unseen milestones and open remediation PRs were swept for every product
      // every six hours, written into `lifecycle_state`, read back on every
      // dashboard page load, and handed to a layout that ignored them. Their
      // columns are dropped in migration 211.
      //
      // `dna_completion_pct` stays: `wisdom/dna.ts` reads it, and writes it
      // itself on every DNA update — this job was a second writer of the same
      // number, so it is no longer one.
      const pendingDecisions = await query("SELECT COUNT(*) as c FROM decisions WHERE product_id = ? AND status = 'pending'", [p.id]);
      const pendingCount = (pendingDecisions.rows[0] as Record<string, number>)?.c ?? 0;

      await query(
        'UPDATE lifecycle_state SET pending_decisions_count = ? WHERE product_id = ?',
        [pendingCount, p.id],
      );
    } catch (err) {
      logger.error(`nav_badge_refresh error for ${p.id}:`, { jobName: 'nav_badge_refresh', error: String(err) });
    }
  }
  logger.info('nav_badge_refresh complete', { jobName: 'nav_badge_refresh' });
}

// ─── 20. Signal Alert Check — Every 2 hours ───────────────────────────────────


/** The founder's interruption ceiling, for a job that needs to route an event
 *  through `ux/interruption.ts`. Unset or unreadable preferences are no
 *  ceiling, which is the same thing `decideChannel` assumes. */
async function founderPrefs(founderId: string): Promise<Record<string, unknown> | null> {
  try {
    const row = (await query('SELECT preferences FROM founders WHERE id = ?', [founderId]))
      .rows[0] as Record<string, unknown> | undefined;
    return row?.preferences ? JSON.parse(String(row.preferences)) as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

// ─── 21. Decision Follow-up — Daily 10:00 UTC ─────────────────────────────────

export async function decisionFollowUp(): Promise<void> {
  logger.info('decision_follow_up starting', { jobName: 'decision_follow_up' });

  const overdue = await query(
    `SELECT d.id, d.what, d.product_id, d.chosen_option, p.owner_id, p.name as product_name
     FROM decisions d
     JOIN products p ON d.product_id = p.id
     WHERE d.status = 'approved'
       AND d.follow_up_at IS NOT NULL
       AND d.follow_up_at <= datetime('now')
       AND d.outcome IS NULL
       AND d.outcome_measured_at IS NULL`,
    [],
  );

  for (const row of overdue.rows) {
    const d = row as Record<string, string>;
    try {
      // Check if notification already sent for this decision today
      const alreadySent = await query(
        `SELECT id FROM notifications
         WHERE product_id = ? AND type = 'decision_followup'
           AND body LIKE ? AND created_at >= datetime('now', '-1 day')`,
        [d.product_id, `%${d.id}%`],
      );
      if (alreadySent.rows.length > 0) continue;

      // Through the policy. Safe since migration 182: the letter rung records
      // the event, so a founder who quieted their ceiling reads it in the
      // Letter instead of losing it. Before that, this bell had to bypass the
      // ceiling to avoid dropping the fact.
      const { deliver } = await import('../services/ux/interruption.js');
      await deliver(d.owner_id, d.product_id, {
        // A decision whose outcome is unlogged is a question, not an alarm.
        importance: 'attention',
        title: 'How did that decision go?',
        body: `Time to log the outcome of: "${d.what}" — decision ID: ${d.id}. You chose: ${d.chosen_option}. What actually happened?`,
        actionUrl: `/decisions/${d.id}`, actionLabel: 'Log outcome',
      }, await founderPrefs(d.owner_id) as never);

      // Push back follow_up_at by 7 days to prevent re-notifying immediately
      await query(
        `UPDATE decisions SET follow_up_at = datetime(follow_up_at, '+7 days') WHERE id = ?`,
        [d.id],
      );

      logger.info(`decision_follow_up: notified for decision ${d.id} (${d.what})`, { jobName: 'decision_follow_up' });
    } catch (err) {
      logger.error(`decision_follow_up error for decision ${d.id}:`, { jobName: 'decision_follow_up', error: String(err) });
    }
  }
  logger.info('decision_follow_up complete', { jobName: 'decision_follow_up' });
}

// ─── 22. Daily Insight Generate — Daily 7:30 UTC ──────────────────────────────


// ─── 23. Weekly Plan Generate — Monday 8:00 UTC ───────────────────────────────

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ─── New Job: Integration Sync ────────────────────────────────────────────────

export async function integrationSync(): Promise<void> {
  const { syncAllIntegrations } = await import('../services/integrations/sync.js');
  await syncAllIntegrations();
}

// ─── New Job: Morning Briefings ───────────────────────────────────────────────

// ─── New Job: Prediction Accuracy ─────────────────────────────────────────────

export async function predictionAccuracyJob(): Promise<void> {
  logger.info('prediction_accuracy starting', { jobName: 'prediction_accuracy' });
  // Find decisions with outcomes recorded in the last 7 days that haven't been scored
  const decisions = await query(
    `SELECT d.id, d.product_id, d.chosen_option, d.outcome, d.outcome_valence
     FROM decisions d
     WHERE d.outcome IS NOT NULL AND d.outcome_valence IS NOT NULL
       AND d.decided_at > date('now', '-90 days')
       AND NOT EXISTS (
         SELECT 1 FROM prediction_accuracy pa WHERE pa.decision_id = d.id
       )
     ORDER BY d.decided_at ASC
     LIMIT 50`,
    [],
  );

  const { recordPredictionAccuracy } = await import('../services/temporal/prediction-accuracy.js');

  for (const row of decisions.rows) {
    const d = row as Record<string, unknown>;
    const direction = d.outcome_valence === 1 ? 'positive' : d.outcome_valence === -1 ? 'negative' : 'neutral';
    try {
      await recordPredictionAccuracy(
        d.product_id as string,
        d.id as string,
        direction as 'positive' | 'neutral' | 'negative',
        null,
        null,
        // Already selected above, and previously discarded one call short of
        // the scorer that needed it to grade the right forecast.
        d.chosen_option == null ? null : String(d.chosen_option),
      );
    } catch (err) {
      logger.error(`prediction_accuracy error for decision ${d.id}:`, { jobName: 'prediction_accuracy', error: String(err) });
    }
  }
  logger.info(`prediction_accuracy: scored ${decisions.rows.length} decisions`, { jobName: 'prediction_accuracy' });
}

// ─── SCP Jobs ─────────────────────────────────────────────────────────────────

// ─── SCP Remediation Sync — Daily 8:00 UTC ───────────────────────────────────

// ─── SCP Temporal Analysis — Monday 5:00 UTC ─────────────────────────────────

// ─── SCP Cost Report — 1st of Month ──────────────────────────────────────────

// ─── SCP Wisdom Synthesis — Sunday 3:00 UTC ───────────────────────────────────

// ─── SCP Intelligence Benchmarks — Daily 2:00 UTC ────────────────────────────

// ─── SCP DNA Nudge — Daily 10:00 UTC ─────────────────────────────────────────

// ─── SCP v3: Lifecycle Rules — Every 4h ──────────────────────────────────────

// ─── SCP v3: AI P&L Update — Daily 1:00 UTC ──────────────────────────────────

// ─── SCP v3: Monthly Strategy Synthesis — 1st of month ───────────────────────

// ─── SCP v3: Integration Fabric Sync — Every Hour ────────────────────────────

// ─── SCP v4: Extended Integrations Sync — Every 2h ───────────────────────────

// ─── SCP v4: Decision Retrospectives — Monday 9:00 UTC ───────────────────────

// ─── Decision expiry — with the retrospective sweep ─────────────────────────
//
// `decisions.status` has permitted 'expired' since migration 001, the type
// declares it, and the WEEKLY OUTCOME REPORT TELLS THE FOUNDER HOW MANY
// DECISIONS EXPIRED UNACTED THIS WEEK. Nothing ever wrote the value. So that
// number was structurally zero — "you let nothing lapse" — however many
// decisions had sat past their deadline, and those decisions stayed pending in
// the queue forever, indistinguishable from ones still worth making.
//
// The deadline column is real and is set. This is the producing half that was
// never built, and its absence made a report say something false rather than
// merely doing nothing.
//
// Only decisions that carry a deadline expire. A decision with no deadline is
// not late; it is unscheduled, and sweeping those up would silently clear the
// queue of everything the founder has not got to yet.
async function scpExpireOverdueDecisions(): Promise<void> {
  logger.info('scp_expire_overdue_decisions starting', { jobName: 'scp_expire_overdue_decisions' });
  try {
    const { query: dbQuery } = await import('../db/client.js');
    const result = await dbQuery(
      `UPDATE decisions SET status = 'expired'
        WHERE status = 'pending'
          AND deadline IS NOT NULL
          AND datetime(deadline) < datetime('now')
          AND deleted_at IS NULL`,
      []);
    logger.info(`scp_expire_overdue_decisions: Expired ${result.rowsAffected ?? 0} overdue decisions`,
      { jobName: 'scp_expire_overdue_decisions' });
  } catch (err) {
    logger.error('scp_expire_overdue_decisions: Error:', { jobName: 'scp_expire_overdue_decisions', error: String(err) });
  }
}


// ─── SCP v4: Webhook Delivery Cleanup — Sunday 4:00 UTC ─────────────────────

async function scpWebhookDeliveryCleanup(): Promise<void> {
  logger.info('scp_webhook_delivery_cleanup starting', { jobName: 'scp_webhook_delivery_cleanup' });
  try {
    const { query: dbQuery } = await import('../db/client.js');
    // Keep last 30 days of delivery records, delete older ones
    const result = await dbQuery(
      `DELETE FROM webhook_deliveries
         WHERE COALESCE(delivered_at, failed_at) < datetime('now', '-30 days')`
    );
    logger.info(`scp_webhook_delivery_cleanup: Cleaned up old webhook delivery records`, { jobName: 'scp_webhook_delivery_cleanup' });
  } catch (err) {
    logger.error('scp_webhook_delivery_cleanup: Error:', { jobName: 'scp_webhook_delivery_cleanup', error: String(err) });
  }
}

// ─── Per-subject work, and what failed ───────────────────────────────────────
//
// ELEVEN SCHEDULED JOBS SHARED ONE SHAPE: a loop over products or founders,
// `catch { /* non-fatal per product */ }`, and a closing line reporting only
// the successes. So a run in which EVERY company failed logged the same
// sentence as a run with nothing to do. "Generated 0 compressed briefs" was
// both "no companies" and "every company's weekly brief threw", and nothing
// anywhere distinguished them — the outer try/catch never fires, because the
// loop completes.
//
// `institution/loop-health.ts` exists precisely to separate "nothing happened"
// from "nothing ran", and it cannot see this — correctly, and by design. It
// records the JOB, and the job succeeded; and it scopes itself deliberately to
// the two loops whose silence changes the founder's own page, saying so in its
// header. These eleven belong to the operator log, which is exactly where their
// failures were invisible.
//
// `scp_scenario_refresh` shows what was intended: someone had already separated
// "awaiting a stated cash position" from "generated" — two non-failure outcomes
// told apart — while the failure path stayed uncounted beside them.
//
// Nothing here changes what any job DOES.

/** One subject's failure, named, at error level. The message is for the
 *  operator's log, not for `job_health`, which stores an error CLASS only.
 *  Exported so the behaviour can be RUN in a test rather than read. */
export function logSubjectFailure(jobName: string, subjectId: string, err: unknown): void {
  logger.error(
    `${jobName}: ${subjectId} failed: ${err instanceof Error ? err.message : String(err)}`,
    { jobName },
  );
}

/** A job's closing line, said so that a failure cannot read as an empty day.
 *  Exported for the same reason as above. */
export function reportRun(jobName: string, sentence: string, failed: number): void {
  const line = failed > 0 ? `${jobName}: ${sentence}, and ${failed} failed` : `${jobName}: ${sentence}`;
  if (failed > 0) logger.error(line, { jobName });
  else logger.info(line, { jobName });
}

// ─── SCP v5: Prediction Accuracy Check — Daily 6:00 UTC ──────────────────────

// ─── SCP v5: Compressed Brief — Monday 7:00 UTC ───────────────────────────────

// ─── SCP v5: Scenario Refresh — Monday 5:00 UTC ───────────────────────────────

// ─── SCP v6: Debate, Failure Pattern Scan, Prompt Evolution ──────────────────

// ─── SCP v7: Signal Event Processing — Hourly ────────────────────────────────

// ─── SCP v7: Monthly ROI Computation — REMOVED ───────────────────────────────
//
// A MONTHLY JOB THAT SUMMARISED A TABLE NOTHING COULD FILL, INTO A TABLE
// NOTHING COULD READ.
//
// `scp_roi_monthly` ran `computeMonthlyROI` over every operating product on the
// 1st at 08:00 and wrote `roi_monthly_summaries`. Its source was
// `recommendation_outcomes`, whose writers — `recordRecommendation` and
// `markActedOn` in `scp/roi/outcome-tracker.ts` — were exported and called from
// nowhere; and its only reader was the `/roi` page, deleted with the commercial
// product. Both ends were gone, so the job spent a database round-trip per
// company each month to record that nothing had been measured.
//
// The calculator's own header said the sharp version of this: `/roi` reported
// "$0 delivered" to every founder, always, on no evidence — a product telling
// its customer it was worthless because the measurement path was absent rather
// than because the value was. That page is gone and this is the other half.
//
// ─── SCP v7: Founder State Assessment — Daily 7:00 UTC ───────────────────────

// ─── SCP v7: Priority Queue Rebuild — Every 30 minutes ───────────────────────

// ─── 20. Growth Stage Detection — Daily 5:30 UTC ─────────────────────────────
export async function stageDetection(): Promise<void> {
  logger.info('stage_detection starting', { jobName: 'stage_detection' });
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const detected = await detectGrowthStage(p.id);
      const current = p.growth_stage ?? 'pre_launch';
      if (detected !== current) {
        await updateGrowthStage(p.id, detected);
        logger.info(`stage_detection: ${p.name} ${current} → ${detected}`, { jobName: 'stage_detection' });
      }
    } catch (err) {
      logger.error(`stage_detection error for ${p.id}:`, { jobName: 'stage_detection', error: String(err) });
    }
  }
  logger.info('stage_detection complete', { jobName: 'stage_detection' });
}

// ─── 21. Founder Health Refresh — Daily 6:30 UTC ─────────────────────────────
export async function founderHealthRefresh(): Promise<void> {
  logger.info('founder_health_refresh starting', { jobName: 'founder_health_refresh' });
  const founders = await query('SELECT id FROM founders WHERE tier IS NOT NULL', []);
  for (const row of founders.rows) {
    const f = row as Record<string, string>;
    try {
      await refreshFounderHealthMetrics(f.id);
    } catch (err) {
      logger.error(`founder_health_refresh error for ${f.id}:`, { jobName: 'founder_health_refresh', error: String(err) });
    }
  }
  logger.info('founder_health_refresh complete', { jobName: 'founder_health_refresh' });
}

// ─── 27. Customer Health Refresh — Daily 3:00 UTC ────────────────────────────
export async function customerHealthRefresh(): Promise<void> {
  logger.info('customer_health_refresh starting', { jobName: 'customer_health_refresh' });
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const count = await refreshAllCustomerHealth(p.id);
      if (count > 0) logger.info(`customer_health_refresh: ${p.name} — ${count} customers refreshed`, { jobName: 'customer_health_refresh' });
    } catch (err) {
      logger.error(`customer_health_refresh error for ${p.id}:`, { jobName: 'customer_health_refresh', error: String(err) });
    }
  }
  logger.info('customer_health_refresh complete', { jobName: 'customer_health_refresh' });
}

// ─── 29. Portfolio Snapshots — Monday 6:00 UTC ───────────────────────────────
export async function portfolioSnapshotJob(): Promise<void> {
  logger.info('portfolio_snapshots starting', { jobName: 'portfolio_snapshots' });
  const portfolios = await query('SELECT id, name FROM portfolios', []);
  for (const row of portfolios.rows as unknown as Array<Record<string, string>>) {
    try {
      await generatePortfolioSnapshot(row.id);
      logger.info(`portfolio_snapshots: ${row.name} snapshot generated`, { jobName: 'portfolio_snapshots' });
    } catch (err) {
      logger.error(`portfolio_snapshots error for ${row.id}:`, { jobName: 'portfolio_snapshots', error: String(err) });
    }
  }
  logger.info('portfolio_snapshots complete', { jobName: 'portfolio_snapshots' });
}

// ─── 25. Predictive Intelligence — Wednesday 7:00 UTC ────────────────────────
export async function predictiveIntelligence(): Promise<void> {
  logger.info('predictive_intelligence starting', { jobName: 'predictive_intelligence' });
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const predictions = await generatePredictions(p.id, p.owner_id);
      if (predictions.length > 0) {
        logger.info(`predictive_intelligence: ${p.name} — ${predictions.length} predictions`, { jobName: 'predictive_intelligence' });
      }
    } catch (err) {
      logger.error(`predictive_intelligence error for ${p.id}:`, { jobName: 'predictive_intelligence', error: String(err) });
    }
  }
  logger.info('predictive_intelligence complete', { jobName: 'predictive_intelligence' });
}

// ─── 26. Action Draft Generation — Daily 7:30 UTC ───────────────────────────
export async function actionDraftGeneration(): Promise<void> {
  logger.info('action_draft_generation starting', { jobName: 'action_draft_generation' });
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const count = await generateDraftsForPendingDecisions(p.id, p.owner_id);
      if (count > 0) {
        logger.info(`action_draft_generation: ${p.name} — ${count} drafts generated`, { jobName: 'action_draft_generation' });
      }
    } catch (err) {
      logger.error(`action_draft_generation error for ${p.id}:`, { jobName: 'action_draft_generation', error: String(err) });
    }
  }
  logger.info('action_draft_generation complete', { jobName: 'action_draft_generation' });
}

// ─── V3.1 Layer C: Idempotency Cleanup — Daily 4:00 UTC ──────────────────────
// Delete expired outbound idempotency keys so the table stays bounded.

export async function idempotencyCleanup(): Promise<void> {
  const { cleanupExpired } = await import('../services/outbound/idempotency.js');
  try {
    const removed = await cleanupExpired();
    if (removed > 0) {
      logger.info(`idempotency_cleanup removed ${removed} expired keys`, {
        jobName: 'idempotency_cleanup',
      });
    }
  } catch (err) {
    logger.error('idempotency_cleanup error', {
      jobName: 'idempotency_cleanup',
      error: String(err),
    });
  }
}

function mondayOfWeek(d: Date): string {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = copy.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy.toISOString().slice(0, 10);
}

// ─── Memory Kernel — premise check (Ascent B1) ─────────────────────────────────
// Re-evaluates every recorded decision premise against live telemetry. When a
// belief a past decision rested on is now contradicted, the founder is notified
// so the decision doesn't quietly expire unnoticed.
export async function memoryPremiseCheck(): Promise<void> {
  logger.info('memory_premise_check starting', { jobName: 'memory_premise_check' });
  const products = await getAllActiveProducts();
  let totalFalsified = 0;
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const { checkPremises } = await import('../services/memory/kernel.js');
      const res = await checkPremises(p.id);
      totalFalsified += res.falsified;
      if (res.falsified > 0) {
        // THROUGH THE INTERRUPTION POLICY. `checkPremises` sets
        // `status='falsified'`, and the Letter's `getExpiredBeliefs` reads
        // exactly that status — so the fact survives being quieted, which is
        // the condition that makes routing here safe. See the letter rung in
        // `ux/interruption.ts` for why that condition is not optional.
        const { deliver } = await import('../services/ux/interruption.js');
        await deliver(p.owner_id, p.id, {
          // A decision resting on a premise the company's own metrics now
          // contradict is something to act on, not something to be woken for.
          importance: 'action_needed',
          title: 'A past decision now rests on a false premise',
          body: `${res.falsified} belief(s) behind decisions you made are now contradicted by your own metrics. Revisit them before they cost you.`,
          actionUrl: '/strategic-decisions', actionLabel: 'Review',
        }, await founderPrefs(p.owner_id) as never);
      }
    } catch (err) {
      logger.error(`memory_premise_check error for ${p.id}`, { jobName: 'memory_premise_check', error: String(err) });
    }
  }
  logger.info(`memory_premise_check complete — ${totalFalsified} beliefs expired`, { jobName: 'memory_premise_check' });
}

// ─── Red Team sweep (Ascent B2 / Dissent Law) ──────────────────────────────────
// No gate-3+ decision sits uncontested: any pending high-stakes decision without
// a pre-mortem gets one. Cost-bounded (max 5 per run; the AI cost ceiling in
// callClaude is the hard backstop).
/**
 * The decisions this sweep can actually review.
 *
 * A BOUNDED QUEUE THAT SELECTS WORK IT CANNOT DO STOPS BEING A QUEUE.
 *
 * This asked for the five oldest uncontested gate-3 decisions and said nothing
 * about whether Foundry may act for the company they belong to. `runPreMortem`
 * spends money, so the AI client refuses it for a company that is paused,
 * unpaid or being erased — and the `red_team_reviews` row that would mark the
 * decision as handled is written only after that call returns. So the refusal
 * left no trace: the decision stayed uncontested, `NOT EXISTS` stayed true, and
 * `ORDER BY created_at ASC LIMIT 5` picked the same five rows on the next run,
 * and every run after that.
 *
 * Five old decisions belonging to companies Foundry may not act for were enough
 * to occupy the entire window permanently, and no operating company's decision
 * would ever be red-teamed again. Nothing would have reported this: each run
 * logged five per-decision errors and completed, and "no gate-3+ decision sits
 * uncontested" would have been false for every company at once.
 *
 * Exported so this is provable against seeded rows rather than by reading SQL.
 */
export async function pendingRedTeamWork(): Promise<Array<{ id: string; product_id: string }>> {
  const pending = await query(
    `SELECT d.id, d.product_id FROM decisions d
     JOIN products p ON p.id = d.product_id
     WHERE d.status = 'pending' AND d.gate >= 3
       AND ${operatingProduct('p')}
       AND NOT EXISTS (SELECT 1 FROM red_team_reviews r WHERE r.decision_id = d.id)
     ORDER BY d.created_at ASC LIMIT 5`,
    [],
  );
  return pending.rows as unknown as Array<{ id: string; product_id: string }>;
}

export async function redTeamSweep(): Promise<void> {
  logger.info('red_team_sweep starting', { jobName: 'red_team_sweep' });
  const pending = { rows: await pendingRedTeamWork() };
  let reviewed = 0;
  for (const row of pending.rows) {
    const d = row as Record<string, string>;
    try {
      const { runPreMortem } = await import('../services/redteam/council.js');
      const res = await runPreMortem(d.id, d.product_id);
      if (res) reviewed++;
    } catch (err) {
      logger.error(`red_team_sweep error for decision ${d.id}`, { jobName: 'red_team_sweep', error: String(err) });
    }
  }
  logger.info(`red_team_sweep complete — ${reviewed} pre-mortems`, { jobName: 'red_team_sweep' });
}

// ─── Founder pulse (Ascent B5 / Human Law) ────────────────────────────────────
// Weekly check on the human running the company. Notifies ONLY on 'overloaded'
// (two independent strain factors) — a kind observation with the numbers shown,
// never a diagnosis, and deliberately sent Friday morning, not at night.
export async function founderPulseCheck(): Promise<void> {
  logger.info('founder_pulse_check starting', { jobName: 'founder_pulse_check' });
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const { getFounderPulse } = await import('../services/wellbeing/pulse.js');
      const pulse = await getFounderPulse(p.id);
      if (pulse.signal === 'overloaded') {
        // Through the policy. A note about the founder's own strain is the
        // last thing that should arrive as an interruption — and the policy
        // already quiets non-critical events for an overloaded founder, which
        // is exactly who this is about.
        const { deliver } = await import('../services/ux/interruption.js');
        await deliver(p.owner_id, p.id, {
          importance: 'info',
          title: 'A note about your week',
          body: pulse.message,
          actionUrl: '/foundry', actionLabel: 'See the week',
        }, await founderPrefs(p.owner_id) as never);
      }
    } catch (err) {
      logger.error(`founder_pulse_check error for ${p.id}`, { jobName: 'founder_pulse_check', error: String(err) });
    }
  }
  logger.info('founder_pulse_check complete', { jobName: 'founder_pulse_check' });
}

// ─── Autopilot tick (Ascent B6 realized / Trust Law) ──────────────────────────
// Learn (bank real outcomes into the ladder) then act (resolve eligible gate-≤1
// decisions in founder-granted categories). Every act is notified with its 24h
// undo — the founder always knows, and the undo itself teaches the ladder.
export async function autopilotTick(): Promise<void> {
  logger.info('autopilot_tick starting', { jobName: 'autopilot_tick' });
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const { runAutopilotTick } = await import('../services/autopilot/policy.js');
      const result = await runAutopilotTick(p.id);
      if (result.acted > 0) {
        const { deliver } = await import('../services/ux/interruption.js');
        const first = result.decisions[0];
        // ACTION NEEDED, and it earns that: something was decided FOR the
        // founder and the window to undo it is twenty-four hours. The policy's
        // floor keeps `action_needed` in the letter even for an overloaded
        // founder, so the undo window is never quieted out of existence.
        await deliver(p.owner_id, p.id, {
          importance: 'action_needed',
          title: `Second Self handled ${result.acted} decision${result.acted > 1 ? 's' : ''}`,
          body: `"${first.what}" resolved to the team's recommendation (${first.category}). You have 24h to undo from the decision page — an undo also pulls that category back.`,
          actionUrl: `/decisions/${first.id}`, actionLabel: 'Review / undo',
        }, await founderPrefs(p.owner_id) as never);
      }
    } catch (err) {
      logger.error(`autopilot_tick error for ${p.id}`, { jobName: 'autopilot_tick', error: String(err) });
    }
  }
  logger.info('autopilot_tick complete', { jobName: 'autopilot_tick' });
}

// ─── Job Registry ─────────────────────────────────────────────────────────────

/** Words that make a claim a sentence rather than a search. */
const STOP = new Set(['that', 'this', 'with', 'from', 'would', 'will', 'have', 'they',
  'them', 'there', 'their', 'been', 'because', 'about', 'into', 'than', 'then', 'when',
  'what', 'which', 'while', 'also', 'more', 'most', 'some', 'such', 'only', 'other',
  'nobody', 'anybody', 'somebody', 'space', 'itself']);


// =============================================================================
// ─── The week, in five sets (Roadmap 2027 R5) ───────────────────────────────
export async function theWeekTick(): Promise<void> {
  const { worthSending, isoWeek } = await import('../services/week/sets.js');
  const { sendAccountNotice } = await import('../services/billing/account-notice.js');
  const { mandateOf } = await import('../services/mandate/statements.js');
  // STANDING DOES NOT APPLY: this resolves the one product that IS the
  // institution, by its system identity, to find whose account to write to.
  const owners = (await query(
    `SELECT p.id AS product_id, f.id AS founder_id, f.email
       FROM system_identities s JOIN products p ON p.id = s.product_id
       JOIN founders f ON f.id = p.owner_id
      WHERE s.identity_key = 'foundry'`, [])).rows as unknown as Array<Record<string, unknown>>;
  const now = new Date();
  for (const o of owners) {
    const founderId = String(o.founder_id);
    // "QUIET CEO": only what cannot wait. The week can wait; it is on Money.
    if ((await mandateOf(founderId, now)).some((m) => m.dimension === 'involvement' && m.subject === 'quiet')) {
      logger.info('the_week: not sent, the owner asked for quiet', { jobName: 'the_week' });
      continue;
    }
    const { send, week, why } = await worthSending(founderId, now);
    if (!send) { logger.info(`the_week: not sent (${why})`, { jobName: 'the_week' }); continue; }
    const sent = await sendAccountNotice({
      productId: String(o.product_id), to: String(o.email),
      notice: { kind: 'the_week', companyName: 'Foundry', effectiveAt: `${isoWeek(now)}:${week.fingerprint}` },
    });
    logger.info(`the_week: ${sent ? 'sent' : 'refused at the door'}`, { jobName: 'the_week' });
  }
}

// THE SOCIETY IS NO LONGER ON A TIMER.
//
// WHAT THE EVIDENCE SAID. Twelve agents across three companies, provisioned on
// 1 September, ran for a fortnight under twenty-seven scheduled loops. In that
// time they completed ninety sessions, wrote thirty-six briefings, twenty-seven
// scratchpad notes and eighteen messages to each other, and produced ELEVEN
// proposals for the owner. Not one was ever approved — `approved_at` is null on
// every row — and ten of the eleven had already expired unread. Every row in
// `agent_evolution_versions` is an initial provision from the day they were
// created; `evolved_prompts`, `agent_accuracy_scores`, `agent_remediations`,
// `agent_initiative_queue` and `agent_audit_log` are all empty. The one thing
// that reached the world in that fortnight — twenty-one messages to millwork
// businesses — was done by the hand, not by an agent.
//
// AND NOTHING THE OWNER CAN SEE DEPENDS ON ANY OF IT. No surface behind the six
// doors, and nothing in `services/founder` or `services/institution`, reads
// `agent_sessions`, `scp_briefings`, `agent_configs` or any sibling. The
// society was talking to itself on a schedule.
//
// WHY, STRUCTURALLY. These agents assess MRR, OKRs, churn, activation and the
// sales/product/CS functions of a SaaS company. Their proposals in production
// say so plainly — "Before I can flag drift or validate direction…", "With no
// active OKRs, there is no basis for evaluation…". They are describing the
// absence of a business that does not exist here. Private Foundry has one owner
// and no funnel; the shape they were built for is Commercial Foundry's.
//
// WHAT IS RETIRED, AND THEN DELETED. The schedules stopped first, with the code
// kept while the owner decided. The owner decided on 30 September 2026
// (PENDING 16, "Retire them"), and Roadmap 2027 R4 and R9 deleted the code:
// the twelve agents, these loops, every module only they reached, the public
// API that served their briefings, and the tables nothing could touch after
// (migration 375, every row kept in `retired_rows`). The code before the
// deletion is commit 1864d6dc.
//
// WHY THE NAMES STAY. A retired name is REFUSED, not absent: `job:run` answers
// a name below with what it was and why it went, rather than "Unknown job", so
// nobody re-creates one believing it never existed. A name here may never also
// be in `JOB_REGISTRY`.
//
// TWO LOOPS STAY IN THE REGISTRY, and they are not cognition:
//   `scp_expire_overdue_decisions`  expires overdue rows in `decisions`, which
//                                   the owner's Decisions door reads;
//   `scp_webhook_delivery_cleanup`  deletes delivery records over thirty days
//                                   old. Retention hygiene, no model, no cost.
//
// ANYTHING HERE MAY COME BACK — rebuilt, deliberately, with a reason, by
// somebody who has read what a fortnight of it produced.
// =============================================================================
export const RETIRED_LOOPS: Readonly<Record<string, string>> = {
  scp_agent_runner: 'Run due agents for all active SCP companies (every hour)',
  scp_daily_briefing: 'Generate CEO briefings for all SCP companies (daily 5:30 UTC)',
  scp_evolution_cycle: 'Run evolution synthesis for all SCP agents (daily 4:00 UTC)',
  scp_lifecycle_transition: 'Evaluate company lifecycle state transitions (daily 6:00 UTC)',
  scp_wisdom_synthesis: 'Synthesize wisdom patterns for all active SCP products (Sunday 3:00 UTC)',
  scp_intelligence_benchmarks: 'Recompute intelligence benchmarks across all products (daily 2:00 UTC)',
  scp_remediation_sync: 'Daily agent remediation sync and health logging (daily 8:00 UTC)',
  scp_temporal_analysis: 'Weekly temporal trend analysis for all SCP companies (Monday 5:00 UTC)',
  scp_dna_nudge: 'Nudge early-lifecycle SCP founders to complete DNA context (daily 10:00 UTC)',
  scp_cost_report: 'Monthly 30d AI cost rollup for all products (1st of month)',
  scp_lifecycle_rules: 'Evaluate customer lifecycle rules for all SCP products (every 4h)',
  scp_pl_update: 'Update AI Company P&L attribution for all products (daily 1:00 UTC)',
  scp_strategy_synthesis: 'Generate monthly strategic synthesis for all products (1st of month)',
  scp_integration_fabric_sync: 'Sync PostHog and GitHub into integration fabric (every hour)',
  scp_extended_integrations_sync: 'Sync Sentry, Linear, Intercom, Slack integrations (every 2h)',
  scp_prediction_accuracy: 'Measure pending agent predictions against actual outcomes (daily 6:00 UTC)',
  scp_compressed_brief: 'Generate compressed weekly brief for all SCP products (Monday 7:00 UTC)',
  scp_scenario_refresh: 'Refresh Monte Carlo runway scenarios for all SCP products (Monday 5:00 UTC)',
  scp_debate_run: 'Run challenger/synthesizer debate pass after daily agent runs (daily 8:00 UTC)',
  scp_failure_pattern_scan: 'Scan all products for failure pattern matches (daily 9:00 UTC)',
  scp_prompt_evolution: 'Generate prompt mutation suggestions for underperforming agents (Sunday 4:00 UTC)',
  scp_playbook_eval: 'Evaluate execution playbook conditions for all active products (hourly)',
  scp_decision_retrospectives: 'Notify founders of decisions due for 90-day retrospective (Monday)',
  scp_signal_events: 'Process pending signal events and dispatch to target agents (hourly)',
  scp_founder_state: 'Detect behavioral signals and assess founder state (daily 7:00 UTC)',
  scp_priority_rebuild: 'Rebuild priority action queue for One Thing banner (every 30 min)',
  // The four department sweeps and the verifier of what they did, deleted with
  // the last legacy executor they fed (R10). None could find work here: earned
  // products only, no SaaS customers, every policy at shadow, acting capped at
  // suggest.
  customer_success_sweep: 'Customer Success department: one check-in per at-risk customer, drafted from real account state (daily 8:15 UTC)',
  marketing_sweep: 'Marketing department: one campaign proposal per cycle, carried by a signups_7d premise (Monday)',
  product_evolution_sweep: 'Product Evolution department: one gate-3 hypothesis citing the thesis, contested by the red team (Tuesday)',
  outreach_sweep: 'Outreach department: asked champions for introductions, never auto-sending (Wednesday)',
  action_verify_sweep: 'Independent verification of acted executions against their declared success criteria (every 6h)',
  // Eight jobs that bought thinking nothing read (R11). Six ran on the owner's
  // pre-charter dollar a day, the same dollar the forge and discovery need.
  daily_insight_generate: 'Generate Daily One Thing for each product (daily 7:30 UTC)',
  weekly_plan_generate: 'Generate Weekly Operating Plan for each product (Monday 8:00 UTC)',
  morning_briefings: 'Pre-generate morning voice briefings (daily 6:30 UTC)',
  signal_alert_check: 'Check for significant Signal drops and tier changes (every 2h)',
  geopolitical_scan: 'Scan geopolitical risks (Sunday)',
  regulatory_scan: 'Scan regulatory changes (Sunday)',
  graph_rebuild: 'Rebuild knowledge graph and discover causal chains (Sunday)',
  weekly_synthesis: 'Weekly intelligence synthesis (Friday)',
  // Two weekly jobs that measured the society, deleted with it (R9): the
  // critique and evolution rates of agents that no longer exist, and outcome
  // trees whose only writer went in R4.
  team_health_aggregate: 'Aggregate Ambros six metrics weekly per product (Monday 5:30 UTC)',
  outcome_tree_health: 'Refresh outcome tree current_value from metrics; supersede stale branches (Monday 6:00 UTC)',
};

export const JOB_REGISTRY: Record<string, { fn: () => Promise<void>; schedule: string; description: string }> = {
  memory_premise_check: { fn: memoryPremiseCheck,   schedule: '0 7 * * *',       description: 'Re-check decision premises against live telemetry; flag expired beliefs (daily)' },
  red_team_sweep:       { fn: redTeamSweep,         schedule: '30 */2 * * *',    description: 'Adversarial pre-mortem for uncontested gate-3+ pending decisions (every 2h)' },
  founder_pulse_check:  { fn: founderPulseCheck,    schedule: '0 9 * * 5',       description: 'Founder strain check — kind, numbers-shown, only when overloaded (Friday 9:00 UTC)' },
  autopilot_tick:       { fn: autopilotTick,        schedule: '45 */4 * * *',    description: 'Second Self: bank real outcomes into the trust ladder, then act on eligible gate-≤1 decisions in founder-granted categories (every 4h)' },
  // THE WEEK, IN FIVE SETS (Roadmap 2027 R5). Replaces the daily fleet letter
  // notification and the Monday digest (which needed a subscription tier
  // nobody has): one email a week to the owner, composed on the server from
  // their own rows, sent only when the week differs from the last and is not
  // empty, and not at all while the owner has asked for "quiet".
  the_week:             { fn: theWeekTick,          schedule: '30 7 * * 1',      description: 'The week in five sets, emailed to the owner only when it changed (Monday)' },
  lifecycle_check:      { fn: lifecycleCheck,      schedule: '0 6 * * *',       description: 'Evaluate lifecycle conditions for all products' },
  competitive_scan:     { fn: competitiveScan,     schedule: '0 6 * * 0',       description: 'Scan competitors for all products (Sunday)' },
  slo_check:            { fn: sloCheck,             schedule: '15 * * * *',      description: 'Check SLOs (AI spend vs cap) and alert operator on breach (hourly)' },
  cold_start_check:     { fn: coldStartCheck,       schedule: '0 5 * * *',       description: 'Check cold start exit conditions' },
  scenario_accuracy:    { fn: scenarioAccuracy,     schedule: '0 8 * * 5',       description: 'Evaluate scenario prediction accuracy (Friday)' },
  yellow_pulse:         { fn: yellowPulse,          schedule: '0 7 * * 4',       description: 'Thursday pulse digest for Yellow products' },
  red_daily:            { fn: redDaily,             schedule: '0 7 * * *',       description: 'Daily briefing for Red products' },
  stressor_cleanup:     { fn: stressorCleanup,      schedule: '0 4 * * *',       description: 'Auto-escalate expired stressors' },
  pattern_aggregation:  { fn: patternAggregation,   schedule: '0 9 * * 0',       description: 'Aggregate decision pattern stats (Sunday)' },
  story_capture:        { fn: storyCapture,         schedule: '0 23 * * *',      description: 'Capture milestone events as story artifacts' },
  founder_pattern_synthesis: { fn: founderPatternSynthesis, schedule: '0 7 * * 0', description: 'Synthesize founder judgment patterns (Sunday)' },
  dna_completion_nudge: { fn: dnaCompletionNudge,    schedule: '0 8 * * 3',      description: 'Nudge founders with incomplete DNA (Wednesday)' },
  remediation_outcome_check: { fn: remediationOutcomeCheck, schedule: '0 9 * * *', description: 'Check remediation PR outcomes (daily)' },
  milestone_check:      { fn: milestoneCheck,      schedule: '0 8 * * *',   description: 'Check and award milestones for all products (daily)' },
  nav_badge_refresh:    { fn: navBadgeRefresh,     schedule: '0 */6 * * *', description: 'Refresh cached nav badge counts (every 6h)' },
  decision_follow_up:    { fn: decisionFollowUp,       schedule: '0 10 * * *',  description: 'Notify founders to log decision outcomes (daily 10:00 UTC)' },
  integration_sync:       { fn: integrationSync,       schedule: '0 */1 * * *', description: 'Sync all active external integrations (every hour)' },
  prediction_accuracy:    { fn: predictionAccuracyJob, schedule: '0 11 * * *',  description: 'Compute prediction accuracy for recent decision outcomes (daily)' },
  // ─── SCP Jobs ─────────────────────────────────────────────────────────────
  // SCP v3: New capability layer jobs
  scp_expire_overdue_decisions: { fn: scpExpireOverdueDecisions, schedule: '5 0 * * *', description: 'Mark pending decisions past their deadline as expired (daily)' },
  scp_webhook_delivery_cleanup: { fn: scpWebhookDeliveryCleanup, schedule: '0 4 * * 0', description: 'Clean up old webhook delivery records (Sunday 4:00 UTC)' },
  // SCP v7: Event bus, ROI, founder intelligence, priority queue
  stage_detection:    { fn: stageDetection,    schedule: '30 5 * * *',  description: 'Auto-detect product growth stage (daily)' },
  founder_health_refresh: { fn: founderHealthRefresh, schedule: '30 6 * * *', description: 'Refresh founder health metrics (daily)' },
  predictive_intelligence: { fn: predictiveIntelligence, schedule: '0 7 * * 3', description: 'Generate predictive insights (Wednesday)' },
  action_draft_generation: { fn: actionDraftGeneration, schedule: '30 7 * * *', description: 'Auto-generate action drafts for pending decisions (daily)' },
  customer_health_refresh: { fn: customerHealthRefresh, schedule: '0 3 * * *', description: 'Refresh all customer health scores (daily 3am)' },
  portfolio_snapshots: { fn: portfolioSnapshotJob, schedule: '0 6 * * 1', description: 'Generate portfolio snapshots (Monday)' },
  data_deletion_processor: {
    fn: async () => {
      const { processScheduledDeletions } = await import('../services/privacy/consent.js');
      const outcome = await processScheduledDeletions();
      if (outcome.completed > 0) {
        logger.info(`Processed ${outcome.completed} scheduled deletions`, { jobName: 'data_deletion_processor' });
      }
      // A run that erased nothing because everything failed used to be
      // indistinguishable from a run with nothing to do. An erasure request
      // that cannot be honoured has a clock running on it and has to be
      // visible, not merely retried in silence.
      if (outcome.failed.length > 0) {
        logger.error(`${outcome.failed.length} scheduled deletion(s) did not complete`, {
          jobName: 'data_deletion_processor',
          products: outcome.failed.map((f) => f.productId).join(','),
        });
      }
    },
    schedule: '0 3 * * *', // Daily at 3:00 UTC
    description: 'Process scheduled data deletions (30-day delay)',
  },
  // V3.1 Layer C
  idempotency_cleanup: {
    fn: idempotencyCleanup,
    schedule: '0 4 * * *', // Daily 4:00 UTC
    description: 'Delete expired outbound idempotency keys',
  },
  // Wave 4 / Council 8: data retention policy — archive/delete old rows
  // from agent_messages, audit_log, briefing_decision_links,
  // ai_cost_log, integration_events. Daily, batch-bounded.
  retention_policy: {
    fn: async () => {
      const { runRetentionPolicy } = await import(
        '../services/maintenance/retention.js'
      );
      const results = await runRetentionPolicy();
      const total = results.reduce((acc, r) => acc + r.deleted, 0);
      if (total > 0) {
        logger.info(`retention_policy: deleted ${total} rows total`, {
          jobName: 'retention_policy',
          per_table: results,
        });
      }
    },
    schedule: '0 5 * * *', // Daily at 5 UTC
    description: 'Drop rows past the per-table retention horizon',
  },
  // A CREDENTIAL THAT DIES QUIETLY IS THE WORST KIND.
  //
  // An access token expires, an account closes, someone revokes Foundry's
  // access at the provider — and without this the first sign would be numbers
  // that stopped moving, which reads as a business going quiet rather than a
  // connection going dark. Renewing what is near expiry and probing the rest
  // turns that into a sentence the owner reads on the company page BEFORE he is
  // shown anything derived from what the sense last said.
  //
  // Hourly, because a token that expires in an hour cannot be caught daily.
  sense_credential_tick: {
    fn: async () => {
      const { renewCredentials } = await import(
        '../services/senses/credentials.js');
      const outcome = await renewCredentials();
      for (const broken of outcome.broke) {
        logger.error(
          `a sense went blind: ${broken.provider} for ${broken.productId} — ${broken.why}`,
          { jobName: 'sense_credential_tick', productId: broken.productId });
      }

      // AND THEN ASK EVERY LIVE CONNECTION WHOSE IT IS.
      //
      // TWO PROBE LOOPS BECAME ONE. This used to probe only the credentials
      // with no expiry — "a credential with no expiry is exactly the kind that
      // can be revoked elsewhere without anything here noticing" — and threw
      // the provider's answer away after reading `ok`. That answer is also the
      // only place the account's identity exists.
      //
      // `recoverIdentities` asks the same question of a superset, reads the
      // answer for both facts, and writes each where it belongs: aliveness on
      // the credential, identity on the sense. A second loop probing the same
      // credentials in the same hour would be a second place a secret is read
      // and a second answer about whether a connection is alive.
      //
      // WHAT IT DOES FOR THE OWNER, hourly, without him:
      //   - a connection made before identity was recorded gets its account
      //     read back, so there is something for him to recognise;
      //   - a shop renamed keeps its recognition, because the comparison is on
      //     the stable reference and never the display name;
      //   - a provider naming a different account stops consequential work and
      //     says so, rather than continuing under the old recognition;
      //   - a disagreement that ends is cleared without asking him anything.
      const { recoverIdentities } = await import('../services/senses/identity-pass.js');
      const pass = await recoverIdentities();
      const count = (o: string): number => pass.findings.filter((f) => f.outcome === o).length;
      const dark = count('unavailable');
      const { noteSenseObserved } = await import('../services/senses/index.js');
      for (const f of pass.findings) {
        // The sentence the owner reads on the company page before he is shown
        // anything derived from this sense. `disputed` writes its own, in the
        // pass, because the words are about identity rather than blindness.
        if (f.outcome === 'unavailable') {
          await noteSenseObserved(f.productId, f.provider, f.ownerWords);
        }
      }
      logger.info(
        `sense_credential_tick: renewed=${String(outcome.renewed)} `
        + `nothing_to_do=${String(outcome.nothingToDo)} failed=${String(outcome.failed)} `
        + `gone_dark=${String(dark)} recovered=${String(count('recovered'))} `
        + `renamed=${String(count('renamed'))} disputed=${String(count('disputed'))} `
        + `resolved=${String(count('resolved'))} unnamed=${String(count('unnamed'))}`,
        { jobName: 'sense_credential_tick' });
    },
    schedule: '25 * * * *', // Hourly, off the hour so it does not collide
    description:
      'Renew sense credentials near expiry, then ask every live connection which account '
      + 'it reaches — so a connection that has gone dark is said out loud before anything '
      + 'derived from it is shown, an unrecorded account is read back for the owner to '
      + 'recognise, and a provider that starts naming a different account stops work '
      + 'rather than continuing under the old recognition (hourly)',
  },
  // A SENSE THAT WAS LET SEE, READS.
  //
  // Until this job, a connected Stripe sense had a credential that was probed
  // hourly and renewed near expiry, and nothing ever READ through it: the only
  // Stripe reader was the legacy hourly sync on the `integrations` table, which
  // the sense path does not populate. The owner saw "connected", the numbers
  // page saw nothing, and no row could tell the two apart.
  //
  // This is a read, not a Hand: it changes nothing at Stripe, writes one
  // snapshot row a day, and reports through the same observation channel every
  // other provider sync uses — so sandbox mode stays test evidence and a
  // refused page is a blind sense said out loud, never a confident zero.
  sense_read_tick: {
    fn: async () => {
      const { readSenses } = await import('../services/senses/read.js');
      const outcome = await readSenses();
      logger.info(
        `sense_read_tick: read=${String(outcome.read)} nothing_to_do=${String(outcome.nothingToDo)} `
        + `blind=${String(outcome.blind)} failed=${String(outcome.failed)}`,
        { jobName: 'sense_read_tick' });
    },
    schedule: '40 4 * * *', // Daily, after the credential tick has had a night to renew
    description:
      'Read, through each live sense credential, what the owner let Foundry see — one '
      + 'revenue snapshot a day per connected Stripe sense, and a blind sense said out '
      + 'loud when the provider refuses (daily)',
  },
  // THE REFERENCE WORLD, ONE DAY AT A TIME.
  //
  // A reference company arrives with ninety days of history and no observations
  // of it (nobody watched those movements happen). Everything the institution
  // can actually reason about — the readings that resolve an expectation, prove
  // a channel is live, and carry a responsibility up the ladder — arrives here,
  // one day per day, through the same public intake a real company's provider
  // posts to.
  //
  // DELIBERATELY BEFORE `institutional_judgment_tick` at 05:00, so the day's
  // reading is in front of the institution on the same pass rather than a day
  // late. Advancing is idempotent per day: the intake upserts on
  // (product_id, snapshot_date) and the observation recorder derives its id
  // from the reading, so a re-run is the same day again, not a second one.
  // THE FIRST JOB THAT LOOKS AT THE REAL WORLD.
  //
  // Every claim this institution has ever formed rested on invented evidence.
  // This pass takes claims that have not been settled and have never been
  // looked at, and asks a real public registry the one question it can answer
  // honestly: does something for this already exist, is anybody maintaining
  // it, and how used is it.
  //
  // IT RUNS ONLY WHERE A REAL WAY OF LOOKING WAS CONNECTED. A claim in the
  // rehearsal world is left alone — putting real observations on invented
  // claims would mix the two worlds in the one place the boundary matters
  // most. And a claim it has already looked at is left alone too, because
  // looking again on a schedule is how a source becomes noise.
  //
  // WHAT IT CANNOT SETTLE IT RAISES. Every use files the questions a registry
  // cannot answer — whether anybody pays, whether the downloads are people —
  // so a claim that has been researched carries the shape of what is still
  // dark rather than an air of completeness.
  // WHAT FOUNDRY ITSELF IS BUILT ON, AND THE PROOF THAT EARNS ITSELF.
  //
  // Two things at once, and neither is a pretext for the other. The work is
  // real: the packages Foundry runs on are a real provider dependency of a real
  // company, and whether anybody is still maintaining them is a question a
  // public registry can honestly answer. It would be worth doing if no
  // capability needed proving.
  //
  // AND BECAUSE IT IS REAL WORK, IT CAN EARN A REAL PROOF. A capability becomes
  // reality-proven when the institution performed its intended work and the
  // result was checked - not when a development harness called a provider, and
  // not when a call failed to throw. So the maturity moves only after reading
  // back what the work left behind: real observations, seen directly, each
  // naming an address somebody could go and visit. The check is about the
  // result, never the call.
  //
  // ONE RUNG AT A TIME. Reaching the provider and getting a well-formed answer
  // makes it AVAILABLE. Only a verified result makes it REALITY-PROVEN. Both
  // are witnessed changes carrying what was actually seen.
  dependency_health_tick: {
    fn: async () => {
      const owner = await query(
        `SELECT id FROM founders ORDER BY created_at, rowid LIMIT 1`, []);
      const founderId = owner.rows.length
        ? String((owner.rows[0] as Record<string, unknown>).id) : null;
      if (founderId === null) {
        logger.info('dependency_health_tick: no owner yet', { jobName: 'dependency_health_tick' });
        return;
      }
      const { recordMaturity, capability } = await import(
        '../services/institution/capabilities.js');

      // CARRIED AS A RESPONSIBILITY RATHER THAN PERFORMED AS A TASK.
      //
      // The registry read is the same read it always was. What is around it is
      // new: the act is described by what it does, its consequence is derived
      // from that rather than from the tool, standing authority is consulted
      // before anything happens, and the claim the LAST pass made is settled
      // against observations that genuinely came later.
      //
      // Until he allows it, this refuses — and that is the chain working rather
      // than failing. The read does not happen, the reason is recorded, and
      // what remains is one question on his first screen.
      let carried;
      try {
        const { carryDependencyHealth } = await import(
          '../services/institution/carrying.js');
        carried = await carryDependencyHealth(founderId);
      } catch (err) {
        logger.error(
          `dependency_health_tick could not reach the registry: `
          + `${err instanceof Error ? err.message : String(err)}`,
          { jobName: 'dependency_health_tick' });
        return;
      }
      if (carried.settled) {
        logger.info(
          `dependency_health_tick settled what the last pass said: `
          + `${carried.settled.verdict} — ${carried.settled.because}`,
          { jobName: 'dependency_health_tick' });
      }
      if (!carried.covered) {
        logger.info(
          `dependency_health_tick: not covered — ${carried.because}`,
          { jobName: 'dependency_health_tick' });
        return;
      }
      const health = carried.performed === null ? null : {
        claimId: carried.performed.claimId,
        checked: carried.performed.checked,
        abandoned: carried.performed.abandoned,
      };
      if (!health) {
        logger.info('dependency_health_tick: nothing to check',
          { jobName: 'dependency_health_tick' });
        return;
      }
      logger.info(
        `dependency_health_tick: checked ${String(health.checked)}, `
        + `${String(health.abandoned.length)} quiet`,
        { jobName: 'dependency_health_tick' });

      // A SECOND WAY OF KNOWING, BUT ONLY WHERE THERE IS SOMETHING TO KNOW.
      // The registry can say a package has gone quiet; it cannot say whether
      // that matters. If nothing has gone quiet there is no question, and the
      // community capability stays unproven — which is honest, where inventing
      // a question so it could earn a proof would not be.
      if (health.abandoned.length > 0) {
        try {
          const { askAboutQuietDependencies } = await import(
            '../services/institution/dependency-health.js');
          const talk = await askAboutQuietDependencies({
            founderId, claimId: health.claimId, abandoned: health.abandoned });
          for (const line of talk.sentences) {
            logger.info(`dependency_health_tick: ${line}`,
              { jobName: 'dependency_health_tick' });
          }
          const community = (await capability('read_community_discussion'))?.providers
            .find((p) => p.provider === 'hn_algolia');
          if (community && talk.asked > 0 && community.maturity === 'declared') {
            await recordMaturity({
              providerId: community.id, to: 'available', evidenceMode: 'real',
              witnessedBy: 'dependency_health_tick',
              evidence: `reached the discussion archive and read what people said about `
                + `${String(talk.asked)} quiet dependencies`,
            });
          }
        } catch (err) {
          logger.error(
            `dependency_health_tick could not reach the discussion archive: `
            + `${err instanceof Error ? err.message : String(err)}`,
            { jobName: 'dependency_health_tick' });
        }
      }

      // The provider reached the world and answered in a shape we could use.
      const fabric = await capability('read_package_registry');
      const provider = fabric?.providers.find((p) => p.provider === 'npm_registry');
      if (!provider) return;
      if (provider.maturity === 'declared') {
        await recordMaturity({
          providerId: provider.id, to: 'available', evidenceMode: 'real',
          witnessedBy: 'dependency_health_tick',
          evidence: `reached the registry and read ${String(health.checked)} package `
            + 'records in a shape the institution could use',
        });
      }

      // AND ONLY THEN, THE RESULT ITSELF, CHECKED — verified inside the loop
      // that performed it, because what the provider actually did belongs
      // beside the act rather than being re-derived here.
      if (carried.performed !== null && !carried.performed.providerVerified) {
        logger.error(`dependency_health_tick: the read left no usable evidence — `
          + carried.performed.verificationBecause,
          { jobName: 'dependency_health_tick' });
        return;
      }
      const now = (await capability('read_package_registry'))?.providers
        .find((p) => p.provider === 'npm_registry');
      if (now && now.maturity === 'available') {
        await recordMaturity({
          providerId: now.id, to: 'reality_proven', evidenceMode: 'real',
          witnessedBy: 'dependency_health_tick',
          evidence: `performed its intended work on a real claim about Foundry's own `
            + 'dependencies and the result was checked: '
            + (carried.performed?.verificationBecause ?? 'verified'),
        });
        logger.info('dependency_health_tick: read_package_registry is reality-proven',
          { jobName: 'dependency_health_tick' });
      }

      // AND WHAT IT HAS PROVEN, IT CAN LOOK THROUGH. Without this the
      // institution reads a registry every morning and still tells the owner it
      // has nowhere to look — two true statements about different tables making
      // one piece of nonsense.
      {
        const { openTheEyesThatAreProven } = await import(
          '../services/venture/research-sources.js');
        const opened = await openTheEyesThatAreProven(founderId);
        if (opened.length > 0) {
          logger.info(`dependency_health_tick: can now look through ${opened.join(', ')}`,
            { jobName: 'dependency_health_tick' });
        }
      }
    },
    schedule: '45 5 * * *',
    description:
      'Ask a real public registry whether every package Foundry runs on is still being '
      + 'maintained, and let the capability earn its reality proof from the checked result '
      + '(daily)',
  },

  // THE RESPONSIBILITY THAT NOBODY RAN.
  //
  // Everything about keeping Foundry's own written description of its database
  // true was built, tested and proven in rehearsal — the drift check against
  // the live schema, the capability need, the choice of a computer by standing,
  // the workshop lifecycle, the verification, the teardown, the receipt, and
  // the card that goes to the owner when the last thing missing is his
  // decision. Then nothing called any of it.
  //
  // So in production the drift was never noticed, the wall was never hit, and
  // the acquisition was never raised. The owner opened his product looking for
  // a decision the institution had reasoned its way to and found no trace of
  // it, because the reasoning had never been given a way to happen. A chain
  // with no caller is a description of work, not work.
  //
  // IT STILL DECIDES NOTHING. The pass looks at the live schema, and if the
  // description has drifted it tries to produce the correction somewhere the
  // institution is not. That attempt stops at the one thing it cannot supply
  // itself, and stopping there is what puts the question on his screen. No
  // branch, no pull request, no publication — the same posture the rehearsal
  // proved, now actually running.
  schema_description_tick: {
    fn: async () => {
      const owner = await query(
        `SELECT id FROM founders ORDER BY created_at, rowid LIMIT 1`, []);
      const founderId = owner.rows.length
        ? String((owner.rows[0] as Record<string, unknown>).id) : null;
      if (founderId === null) {
        logger.info('schema_description_tick: no owner yet',
          { jobName: 'schema_description_tick' });
        return;
      }

      const { carrySchemaDescription, produceSchemaDescription } = await import(
        '../services/institution/carrying.js');

      // HAS IT ACTUALLY DRIFTED? Asked of the live database rather than
      // assumed. An institution that reported work needing doing without
      // checking would be manufacturing its own recurrence.
      const carried = await carrySchemaDescription(founderId);
      if (!carried.drifted) {
        logger.info('schema_description_tick: the description still matches',
          { jobName: 'schema_description_tick' });
        return;
      }
      logger.info(`schema_description_tick: ${carried.standing?.sentence ?? 'drifted'}`,
        { jobName: 'schema_description_tick' });

      // AND THE ATTEMPT IS WHAT RAISES THE QUESTION. Not a check that decides
      // to ask him — the work going as far as it can and naming what stopped
      // it. If a workspace ever becomes available this same call produces the
      // correction instead, and nothing here has to change.
      const made = await produceSchemaDescription({ founderId, evidenceMode: 'real' });
      logger.info(
        `schema_description_tick: ${made.workspaceId === null ? 'could not' : 'did'} `
        + `produce the correction — ${made.because}`,
        { jobName: 'schema_description_tick' });
    },
    schedule: '20 6 * * *',
    description:
      'Check whether Foundry\'s own written description of its database still matches the '
      + 'database, and try to produce the correction on a computer it is not running on '
      + '(daily)',
  },
  // WHEN THE EVIDENCE DISAGREES, DO SOMETHING ABOUT IT.
  //
  // The institution could hold a contradiction and could say when reading had
  // stopped helping, and neither of those carried itself. A contested claim sat
  // open forever; a candidate whose only remaining questions were about
  // behaviour waited to be asked. This is the pass that closes both.
  //
  // IT PROPOSES AND NARROWS. IT DOES NOT DECIDE. Narrowing a thesis is a
  // judgement the record keeps and the owner can read; proposing an experiment
  // leaves a sealed prediction waiting for him, and the experiment machinery
  // still refuses to run anything he has not approved. Nothing here spends,
  // publishes or contacts anybody.
  // THE PASS THAT MAKES A REAL MANDATE PRODUCE ANYTHING.
  //
  // Everything downstream of a candidate was built and proven while nothing
  // ever created one outside the rehearsal world. This is the front of the
  // chain: what the portfolio needs becomes a brief, the brief becomes a search
  // through real sources, and what people actually wrote becomes a small number
  // of seeds — each quoting a sentence, each carrying Foundry's reading of it
  // as a reading.
  //
  // AND IT KILLS MOST OF WHAT IT SOWS, in the same pass, using a genuinely
  // different way of knowing than the one that sowed them. A permissive
  // frontier is only defensible if the weeding is ruthless and cheap, and if
  // seeds die of evidence rather than of taste.
  //
  // NOTHING REACHES THE OWNER FROM HERE. Seeds are institutional working
  // memory; only candidates reach him, and promotion needs independent stances
  // that this pass does not grant.
  // WHAT CAN I ACTUALLY SEE?
  //
  // A defect this fixes, and it was mine: the only line that ever promoted the
  // community source out of `declared` sat inside the branch that runs when one
  // of Foundry's own dependencies has gone quiet. None had, so the eye never
  // opened, so discovery refused every search with "nothing I can look through
  // tells me what people say" — a capability blocked forever behind an
  // unrelated coincidence.
  //
  // This asks each declared way of looking one dull question and checks the
  // shape of the answer. It files no market observation, because the answer is
  // about the instrument rather than about the world, and it promotes no
  // further than `available` — reality proof is still earned by doing real work
  // whose result is checked. It runs between dependency health and discovery so
  // an eye opened this morning can be looked through this morning.
  // THE WHOLE INSTITUTION IS ONE FILE.
  //
  // Every fact this place holds — what he owns, what he said, what it may and
  // may not do, everything it has learned — lives in one SQLite file on one
  // volume attached to one machine. Nothing anywhere copied it. Ninety-five
  // routines ran every day and not one of them made the institution survivable.
  // The written recovery plan described a hosted database this deployment does
  // not use, which is worse than no plan: it reads like an answer.
  //
  // VACUUM INTO is SQLite's own consistent copy. It is safe against a live
  // write-ahead log, needs no lock held by anything else, adds no dependency,
  // and produces a single file that can simply be opened. It does not survive
  // losing the volume — the volume's own snapshots are for that, and are set in
  // fly.private.toml — but it survives the things that actually happen:
  // corruption, a bad migration, a delete nobody meant.
  workshop_correspondence_tick: {
    fn: async () => {
      // THE WORKSHOP ANSWERS ITS OWN POST. Interpretation and answering happen
      // here rather than at the intake door, so that hearing a message can
      // never be slowed, failed or refused by the work of deciding what to say
      // about it — and so an answer that could not be sent is retried as a
      // decision rather than lost with the request that carried it.
      const { unanswered, answer, correspondenceMode } = await import('../services/public-workshop/correspondence.js');
      const founders = (await query(`SELECT founder_id FROM workshop_correspondence_policy WHERE mode <> 'off'`, []))
        .rows as unknown as Array<Record<string, unknown>>;
      for (const f of founders) {
        const founderId = String(f.founder_id);
        const mode = await correspondenceMode(founderId);
        const waiting = await unanswered(founderId, 20);
        let sent = 0; let escalated = 0;
        for (const mailId of waiting) {
          try {
            const a = await answer(founderId, mailId);
            if (a.sent) sent += 1;
            if (a.decision === 'escalate') escalated += 1;
          } catch (error) {
            logger.warn(`workshop_correspondence_tick: ${mailId}: ${error instanceof Error ? error.message : String(error)}`,
              { jobName: 'workshop_correspondence_tick' });
          }
        }
        if (waiting.length) {
          logger.info(`workshop_correspondence_tick: ${waiting.length} heard, ${sent} answered, ${escalated} for the owner (${mode})`,
            { jobName: 'workshop_correspondence_tick' });
        }
      }
    },
    schedule: '*/10 * * * *',
    description: 'Answer what the Workshop has been asked, inside the envelope the owner set',
  },

  workshop_mail_replay_tick: {
    fn: async () => {
      // NOTHING IS LOST BECAUSE FOUNDRY WAS DOWN. The program at the edge
      // writes every message into the Workshop's own store before it tells
      // Foundry anything, so a message that arrived mid-deploy, mid-outage or
      // while the intake door was refusing is sitting there rather than gone.
      // Recovery is therefore not an operator's errand to remember: it is this,
      // running on a timer, deduplicating on the sender's own Message-ID, and
      // costing an index lookup per message it has already heard.
      const { replayHeldMail } = await import('../services/public-workshop/mail.js');
      const held = (await query(`SELECT founder_id FROM public_workshop WHERE mail_kv_namespace_id IS NOT NULL`, []))
        .rows as unknown as Array<Record<string, unknown>>;
      for (const w of held) {
        const founderId = String(w.founder_id);
        try {
          const r = await replayHeldMail(founderId);
          if (r.recovered || r.unreadable) {
            logger.info(`workshop_mail_replay_tick: ${r.recovered} recovered, ${r.unreadable} unreadable of ${r.held} held`,
              { jobName: 'workshop_mail_replay_tick' });
          }
        } catch (error) {
          logger.warn(`workshop_mail_replay_tick: ${founderId}: ${error instanceof Error ? error.message : String(error)}`,
            { jobName: 'workshop_mail_replay_tick' });
        }
      }
    },
    schedule: '*/10 * * * *',
    description: 'Hear anything the Workshop held while Foundry could not take it',
  },

  experiment_hand_tick: {
    fn: async () => {
      // The first real experiment's hand: offers to the businesses the owner
      // approved, deliveries of what was paid for, the provider's receipts as
      // outcome events, refunds of failed deliveries, then the sealed rule.
      // Nothing here spends beyond the asset's allowance or writes to anyone
      // the owner did not approve; the plan guard on outbound_actions is the
      // authority, not this job.
      // THE STEWARD FIRST: a brief going stale is re-pulled before the hand
      // would send it, so the freshness rule stops nothing that rows could
      // have kept fresh.
      const { refreshStaleBriefs } = await import('../services/venture/products/registry.js');
      for (const r of await refreshStaleBriefs()) {
        logger.info(`experiment_hand_tick: brief ${r.experimentId} ${r.refreshed ? 'refreshed' : 'not refreshed'} — ${r.because}`, { jobName: 'experiment_hand_tick' });
      }
      const { runHand } = await import('../services/venture/hand.js');
      // No number here: the stage size is the experiment's own, small on the
      // first pass and larger once the outbound has shown it behaves.
      const reports = await runHand();
      for (const r of reports) {
        logger.info(`experiment_hand_tick: ${r.experimentId} ${r.state} — offers ${r.offersSent}/${r.offersPlanned}, deliveries ${r.deliveriesSent}, reconciled ${r.reconciled}, refunds ${r.refundsIssued}, settled ${r.settled ?? 'not yet'}${r.withheld.length ? `, withheld from ${r.withheld.length}` : ''}`,
          { jobName: 'experiment_hand_tick', state: r.state, because: r.because, exceptions: r.exceptions, withheld: r.withheld });
      }
      // AND WHERE THE VENUE CAN BE READ, IT IS READ BEFORE IT IS SETTLED.
      //
      // The owner: he does not intend to personally check external accounts or
      // reconcile marketplace activity, and manually completing external
      // platform workflows is not to be the normal operating model. This is
      // the pass that takes the first of those off him. It runs only where a
      // connection exists — with none it answers "no Etsy account is
      // connected" and costs nothing — and it publishes nothing, because
      // reading is all the credential it acts through can do.
      const { bringTheVenueUpToDate, listingExperimentsToRead, settledListingsStillLive } =
        await import('../services/senses/readers/etsy-shop.js');
      for (const r of await listingExperimentsToRead()) {
        // A THIRD PARTY'S OUTAGE IS NOT THIS INSTITUTION'S FAILURE TO ACT.
        //
        // This loop was unwrapped, so a 429 or a 503 from Etsy threw straight
        // out of the job — skipping `settleListings` for every founder, and
        // skipping the deliberate throw below that exists to put "an
        // authorised experiment could not proceed" into job health. Settlement
        // does not depend on Etsy answering, and must not wait on it.
        try {
          const venue = await bringTheVenueUpToDate({ founderId: r.founderId, experimentId: r.experimentId });
          if (venue.read) {
            logger.info(`experiment_hand_tick: read ${venue.shopName ?? 'the shop'} for ${r.experimentId} — `
              + `${String(venue.listings)} listings, ${String(venue.orders)} orders, ${String(venue.recorded)} new`
              + `${venue.complete ? '' : ' — INCOMPLETE, so no absence is claimed from it'}`,
            { jobName: 'experiment_hand_tick' });
          } else {
            // The refusal was discarded entirely before. A connected credential
            // that has started failing said nothing at all.
            logger.info(`experiment_hand_tick: did not read the venue for ${r.experimentId}: ${venue.because}`,
              { jobName: 'experiment_hand_tick' });
          }
        } catch (err) {
          logger.warn(`experiment_hand_tick: reading the venue for ${r.experimentId} threw: `
            + `${err instanceof Error ? err.message : String(err)}`, { jobName: 'experiment_hand_tick' });
        }
      }
      // A LISTING DOES NOT GO QUIET WHEN ITS EXPERIMENT DOES. `settleListings`
      // below withdraws the exposure the moment a test settles, and without
      // this second pass that same withdrawal is what drops the experiment out
      // of `listingExperimentsToRead` for ever — so a listing the owner has
      // not taken down at Etsy goes unread as soon as its trial concludes.
      // Same read, same tolerance for a third party's outage; the only
      // difference is which experiments are asked for.
      for (const r of await settledListingsStillLive()) {
        try {
          const venue = await bringTheVenueUpToDate({ founderId: r.founderId, experimentId: r.experimentId });
          if (venue.read) {
            logger.info(`experiment_hand_tick: read ${venue.shopName ?? 'the shop'} for settled test ${r.experimentId} — `
              + `${String(venue.orders)} orders, ${String(venue.recorded)} new`, { jobName: 'experiment_hand_tick' });
          }
        } catch (err) {
          logger.warn(`experiment_hand_tick: reading the venue for settled test ${r.experimentId} threw: `
            + `${err instanceof Error ? err.message : String(err)}`, { jobName: 'experiment_hand_tick' });
        }
      }
      // A listing the owner placed himself has no act for the hand to carry;
      // the sealed rule still reads what the venue reported, on the same pass.
      const { settleListings } = await import('../services/venture/proof-2.js');
      for (const r of await settleListings()) {
        logger.info(`experiment_hand_tick: listing ${r.experimentId} settled ${r.settled ?? 'not yet'} — ${r.because}`, { jobName: 'experiment_hand_tick', earned: r.earned });
      }
      // A PASS THAT COULD NOT MOVE AN AUTHORISED ACT DID NOT SUCCEED.
      //
      // This job used to swallow everything and record a success, so an
      // owner-authorised experiment that could not create its payment link
      // looked identical to one with nothing to do — for as long as the
      // dependency stayed down. Throwing here is what puts the failure in
      // job_health, where the institution can see its own condition.
      const stopped = reports.filter((r) => r.state === 'blocked' || r.state === 'failed');
      if (stopped.length) {
        throw new Error(`${stopped.length} authorised experiment(s) could not proceed: `
          + stopped.map((r) => `${r.experimentId} ${r.state} (${r.because ?? 'no reason recorded'})`).join('; '));
      }
    },
    schedule: '20 * * * *',
    description: 'Carry every live real experiment one step: offers, deliveries, receipts, refunds, settlement.',
  },
  public_workshop_tick: {
    fn: async () => {
      // THE PUBLIC WORKSHOP, KEPT: opt-outs that arrived at the public store
      // copied onto the Workshop's list and swept, every live page read back
      // from its public address, and the health reading the owner sees
      // refreshed. Nothing here publishes anything new or writes to anyone.
      const { query } = await import('../db/client.js');
      const owners = (await query('SELECT founder_id FROM public_workshop')).rows as unknown as Array<Record<string, unknown>>;
      const { syncOptOutsFromStore } = await import('../services/public-workshop/suppression.js');
      const { workshopHealth, keepTheProgramCurrent } = await import('../services/public-workshop/infrastructure.js');
      const { publishSite } = await import('../services/public-workshop/publication.js');
      // Every other Workshop is still kept; then the pass says what failed
      // (case 8). A failed opt-out sync is named on its own: it is a promise
      // to stop writing to somebody, not a housekeeping count.
      const workshopFailed: string[] = [];
      for (const o of owners) {
        const founderId = String(o.founder_id);
        const opt = await syncOptOutsFromStore(founderId);
        if (opt.failed.length > 0) workshopFailed.push(`${founderId}: ${String(opt.failed.length)} opt-out(s) could not be kept`);
        // THE WORLD SAYS WHAT THE RECORD SAYS. A page is rendered from rows,
        // and rows change — the Workshop's own statement did, by migration —
        // while the world kept serving the page as it was the day somebody
        // pressed publish. Re-rendering every hour and putting up only what
        // differs closes that gap without a button: an unchanged page is a
        // no-op by digest, and every change leaves the receipt it always did.
        // Only a Workshop that is already standing is kept; one that has never
        // been published is not put up behind the owner's back.
        const live = (await query(
          `SELECT COUNT(*) AS n FROM public_publications WHERE founder_id = ? AND superseded_at IS NULL`,
          [founderId])).rows[0] as Record<string, unknown>;
        if (Number(live.n) > 0) {
          try {
            // The program first, so a page that needs the new program (a file
            // served as what it is) is never put up under the old one.
            // THE RECORD FIRST, for the same reason as the program: a page
            // republished a moment before its own record was brought current
            // is a page that carries yesterday's record for an hour, and the
            // one thing a correction must not be is late by a cycle.
            const { keepProof1sRecordCurrent } = await import('../services/venture/proof-1.js');
            const record = await keepProof1sRecordCurrent(founderId);
            if (record === 'written') logger.info(`public_workshop_tick: ${founderId} added the authorised clarification to Experiment 001's record`, { jobName: 'public_workshop_tick' });
            // AND THE BOUNDARY HE NARROWED BY NAME. `approveListing` writes the
            // narrowed wording for any listing approved from here on and
            // refuses to run twice, so it can never reach the row that already
            // exists. This can, once, under his dated authorisation. A refusal
            // is logged as loudly as the change: it means the live row is not
            // the one he authorised narrowing, which is a thing to look at
            // rather than a thing to retry quietly every hour.
            const { keepProof2sEntryCurrent } = await import('../services/venture/proof-2.js');
            const entry = await keepProof2sEntryCurrent(founderId);
            if (entry === 'narrowed') logger.info(`public_workshop_tick: ${founderId} narrowed Experiment 002's publishing boundary to the entry he authorised, and gave the workbook its public identity`, { jobName: 'public_workshop_tick' });
            else if (entry === 'not_the_boundary_he_narrowed' || entry === 'not_the_authorised_record') logger.warn(`public_workshop_tick: ${founderId} did not narrow Experiment 002's boundary: ${entry}`, { jobName: 'public_workshop_tick' });
            const program = await keepTheProgramCurrent(founderId);
            if (program === 'deployed') logger.info(`public_workshop_tick: ${founderId} program brought current with its reviewed text`, { jobName: 'public_workshop_tick' });
            const site = await publishSite(founderId, 'institution:public_workshop_tick');
            // A HELD PAGE IS SAID OUT LOUD. It is not a failure and not a
            // success, and leaving it out of the line meant the only trace of
            // the owner's word being applied was a page that stopped changing.
            if (site.failed.length > 0) workshopFailed.push(`${founderId}: ${String(site.failed.length)} page(s) could not be republished`);
            if (site.published.length > 0 || site.failed.length > 0 || site.held.length > 0) {
              logger.info(`public_workshop_tick: ${founderId} republished ${site.published.join(', ') || 'nothing'}${site.failed.length ? `; failed ${site.failed.map((f) => `${f.path} (${f.reason})`).join(', ')}` : ''}${site.held.length ? `; held ${site.held.map((h) => `${h.path} (${h.reason})`).join(', ')}` : ''}`,
                { jobName: 'public_workshop_tick' });
            }
          } catch (err) {
            workshopFailed.push(`${founderId}: could not republish (${err instanceof Error ? err.message : String(err)})`);
            logger.warn(`public_workshop_tick: ${founderId} could not republish: ${err instanceof Error ? err.message : String(err)}`,
              { jobName: 'public_workshop_tick' });
          }
        }
        // ─── ASK THE REPLY ROUTE TO PROVE ITSELF ────────────────────────
        //
        // Once a day, one message to the Workshop's own advertised address,
        // through its own governed capability, carrying a nonce. It is the
        // only check in the institution that answers the question the others
        // only approach: not whether a routing rule exists, but whether a
        // message sent there arrives. Bounded by `probeIsDue`, so an hourly
        // routine does not turn a diagnostic into a mailing list.
        try {
          const { probeIsDue, sendReplyProbe } = await import('../services/public-workshop/reply-probe.js');
          if (await probeIsDue(founderId)) {
            const probe = await sendReplyProbe(founderId);
            logger.info(`public_workshop_tick: ${founderId} reply-route check ${'sent' in probe ? `sent (${probe.route})` : `not sent: ${probe.refused}`}`,
              { jobName: 'public_workshop_tick' });
          }
        } catch (err) {
          workshopFailed.push(`${founderId}: could not check the reply route (${err instanceof Error ? err.message : String(err)})`);
          logger.warn(`public_workshop_tick: ${founderId} could not check the reply route: ${err instanceof Error ? err.message : String(err)}`,
            { jobName: 'public_workshop_tick' });
        }

        const health = await workshopHealth(founderId);
        logger.info(`public_workshop_tick: ${founderId} opt-outs +${opt.recorded}, answers +${opt.continuations}, swept ${opt.swept}; site ${health.site.status}, cloudflare ${health.cloudflare.status}, sending ${health.sending.status}, inbox ${health.replyInbox.status}`,
          { jobName: 'public_workshop_tick', failing: health.pagesFailing, optOutFailures: opt.failed });
      }
      if (workshopFailed.length > 0) {
        throw new Error(`the Workshop could not be kept: ${workshopFailed.join('; ')}`);
      }
    },
    schedule: '40 * * * *',
    description: 'Keep the public Workshop: record opt-outs from its store, read every page back from its address, refresh its health.',
  },
  keep_a_copy_of_everything: {
    fn: async () => {
      const { copyTheInstitution } = await import('../services/institution/keeping.js');
      const kept = await copyTheInstitution();
      if (kept.skipped !== null) {
        logger.info(`keep_a_copy_of_everything: ${kept.skipped}`,
          { jobName: 'keep_a_copy_of_everything' });
        return;
      }
      logger.info(
        `keep_a_copy_of_everything: wrote ${kept.wrote} (${String(kept.bytes)} bytes); `
        + `${String(kept.kept)} copies kept, ${String(kept.removed)} aged out`,
        { jobName: 'keep_a_copy_of_everything' });
      // AND IT IS PUT BACK THE SAME DAY (roadmap G5): a copy nobody has
      // restored is a belief. A copy that would not serve a recovery fails the
      // job, so job health and the Brief say so.
      const { rehearseRestore, sayRehearsal } = await import('../services/institution/keeping.js');
      const rehearsed = await rehearseRestore(kept.wrote);
      if ('skipped' in rehearsed) throw new Error(`keep_a_copy_of_everything: could not rehearse — ${rehearsed.skipped}`);
      const said = sayRehearsal(rehearsed);
      if (!said.ok) throw new Error(`keep_a_copy_of_everything: today's copy would not serve a recovery — ${said.lines.join('; ')}`);
      logger.info(`keep_a_copy_of_everything: restored and read — ${said.lines.join('; ')}`,
        { jobName: 'keep_a_copy_of_everything' });
      // AND THEN IT LEAVES THE MACHINE (Private S4): only a copy that has just
      // been shown to serve a recovery is sealed and sent away. Not configured
      // is said and is not a failure; a configured send that fails fails the job.
      const { sendTheCopyAway } = await import('../services/institution/sending-away.js');
      const away = await sendTheCopyAway(kept.wrote);
      logger.info('notConfigured' in away
        ? `keep_a_copy_of_everything: the copy stays on this machine — ${away.notConfigured}`
        : `keep_a_copy_of_everything: sealed and sent away as ${away.sent.key} (${String(away.sent.bytes)} bytes)`,
      { jobName: 'keep_a_copy_of_everything' });
    },
    schedule: '15 4 * * *',
    description:
      'Take a consistent copy of the whole database, rehearse restoring it, and send the '
      + 'sealed copy off the machine when storage is configured (daily)',
  },
  sense_check_tick: {
    fn: async () => {
      const { checkTheSenses } = await import('../services/institution/sense-check.js');
      const checked = await checkTheSenses();
      for (const one of checked) {
        if (one.movedTo !== null) {
          logger.info(
            `sense_check_tick: ${one.provider} ${one.was} -> ${one.movedTo} — ${one.because}`,
            { jobName: 'sense_check_tick' });
        }
      }
      const answering = checked.filter((c) => c.answered).length;
      logger.info(
        `sense_check_tick: ${String(answering)} of ${String(checked.length)} ways of `
        + 'looking answered',
        { jobName: 'sense_check_tick' });
      // AN EYE PROVEN TODAY IS LOOKED THROUGH TODAY, for everyone with a
      // search open, rather than on the next pass of a different job.
      const { openTheEyesThatAreProven } = await import('../services/venture/research-sources.js');
      const searching = await query(
        'SELECT DISTINCT founder_id FROM venture_mandates WHERE closed_at IS NULL', []);
      for (const row of searching.rows as unknown as Array<Record<string, unknown>>) {
        const opened = await openTheEyesThatAreProven(String(row.founder_id));
        if (opened.length > 0) {
          logger.info(`sense_check_tick: ${String(row.founder_id)} can now look through ${opened.join(', ')}`,
            { jobName: 'sense_check_tick' });
        }
      }
    },
    // BEFORE dependency health at 05:45, which is what opens the eyes for
    // whatever is available by then. Running after it would mean a sense
    // promoted this morning could not be looked through until tomorrow — a
    // whole day of "I have nowhere to look" caused by nothing but the order of
    // two jobs.
    schedule: '40 5 * * *',
    description:
      'Ask every way of looking Foundry claims to have one dull question, so a sense that '
      + 'works can be looked through and a sense that has stopped working stops being '
      + 'claimed (daily)',
  },
  forge_tick: {
    fn: async () => {
      const { forgePass } = await import('../services/venture/forge-deliberation.js');
      const searching = await query(
        'SELECT DISTINCT founder_id FROM venture_mandates WHERE closed_at IS NULL AND evidence_mode = ?', ['real']);
      for (const row of searching.rows as unknown as Array<Record<string, unknown>>) {
        const founderId = String(row.founder_id);
        const pass = await forgePass(founderId);
        if (pass.skipped) {
          logger.info(`forge_tick: ${founderId} skipped — ${pass.skipped}`, { jobName: 'forge_tick' });
          continue;
        }
        for (const d of pass.deliberated) {
          logger.info(`forge_tick: ${d.experimentId} ${d.outcome}${d.because ? ` — ${d.because}` : ''}${d.design ? `; recommends ${d.design.recommendation}` : ''}${d.sealed ? '; sealed inside the charter' : d.unsealedBecause.length ? `; not sealed: ${d.unsealedBecause.join('; ')}` : ''}`,
            { jobName: 'forge_tick' });
        }
        for (const id of pass.allowed) logger.info(`forge_tick: ${id} let in under the charter`, { jobName: 'forge_tick' });
        for (const n of pass.notAllowed) logger.info(`forge_tick: ${n.experimentId} sealed but not let in — ${n.because}`, { jobName: 'forge_tick' });
        logger.info(`forge_tick: ${founderId} proposed ${String(pass.proposed)}, designed ${String(pass.deliberated.length)}, let in ${String(pass.allowed.length)}`,
          { jobName: 'forge_tick' });
      }
    },
    schedule: '0 7 * * *',
    description:
      'Deliberate on every undesigned real test: five disciplines read the record, one design is '
      + 'composed, an adversary attacks it, and it is sealed only inside the charter; a sealed, ready '
      + 'test is let in as the charter\'s principal (daily)',
  },
  // WHETHER FOUNDRY'S OWN WORK COMPLETED, told to the owner once, without
  // his opening anything.
  //
  // The reading is the same one Home shows: the economic loop's routines,
  // each against its own cadence, from `job_health`. When one has stopped —
  // failing, or simply not succeeding when it should — one account notice
  // goes to the owner through the same door billing notices use, keyed on the
  // last time that routine succeeded, so a stoppage is one message and an
  // hourly re-check cannot become a feed. Recovery is not mailed; Home says
  // it. Nothing here is a monitoring system: no thresholds beyond the cadence
  // the loop list already states, no preferences, no queue.
  //
  // WHAT IT CANNOT DO: run when the scheduler itself is dead. That case is the
  // deployment's to see, and /internal/health now carries this same reading
  // for whatever probes it from outside.
  institution_pulse_tick: {
    fn: async () => {
      const { query } = await import('../db/client.js');
      const { howFoundryIsRunning } = await import('../services/founder/health.js');
      const { sendAccountNotice } = await import('../services/billing/account-notice.js');
      // STANDING DOES NOT APPLY: this resolves the one product that IS the
      // institution, by its system identity, to find whose account to write
      // to. It is an identity lookup, not a roll-up of his companies, and the
      // institution's own product is never an experimental asset.
      const owners = (await query(
        `SELECT p.id AS product_id, f.id AS founder_id, f.email
           FROM system_identities s JOIN products p ON p.id = s.product_id
           JOIN founders f ON f.id = p.owner_id
          WHERE s.identity_key = 'foundry'`, []))
        .rows as unknown as Array<Record<string, unknown>>;
      for (const o of owners) {
        const pulse = await howFoundryIsRunning(String(o.founder_id));
        logger.info(`institution_pulse_tick: ${pulse.state} — ${pulse.sentence}`, { jobName: 'institution_pulse_tick' });
        if (pulse.state !== 'stopped' || pulse.stoppedLoop === null) continue;
        const sent = await sendAccountNotice({
          productId: String(o.product_id), to: String(o.email),
          notice: {
            kind: 'institution_stopped', companyName: 'Foundry',
            // THE STOPPAGE'S IDENTITY. The same routine, stopped since the same
            // last success, is the same stoppage, and the door's dedup refuses
            // a second message about it.
            effectiveAt: `${pulse.stoppedLoop.jobName}:${pulse.stoppedLoop.lastSuccessAt ?? 'never'}`,
            detail: pulse.sentence,
          },
        });
        logger.info(`institution_pulse_tick: owner ${sent ? 'told' : 'not told (already told, or the door refused)'} about ${pulse.stoppedLoop.jobName}`,
          { jobName: 'institution_pulse_tick' });
      }
    },
    // After the hourly routines have had their turn, so a routine that ran at
    // :20, :35 or :40 is read as run rather than as stale by minutes.
    schedule: '50 * * * *',
    description:
      'Read whether the economic loop\'s routines completed on their cadence, and tell the '
      + 'owner once, by account notice, when one has stopped (hourly)',
  },

  venture_discovery_tick: {
    fn: async () => {
      const { discover, promoteWhatEarnedIt, weedOut } = await import(
        '../services/venture/discovery.js');
      const mandates = await query(
        `SELECT id, founder_id, evidence_mode FROM venture_mandates
          WHERE closed_at IS NULL ORDER BY opened_at`, []);
      let sown = 0;
      let buried = 0;
      // Every other search still runs; then the pass says it failed (case 8).
      const discoveryFailed: string[] = [];
      let promotedCount = 0;
      let readCount = 0;
      let declined = 0;
      for (const row of mandates.rows as unknown as Array<Record<string, unknown>>) {
        const founderId = String(row.founder_id);
        const world = String(row.evidence_mode) === 'reference' ? 'reference' : 'real';
        try {
          const found = await discover({
            founderId, mandateId: String(row.id), world });
          sown += found.sown.length;
          readCount += found.read;
          // A READING DECLINED IS NOT A PASS THAT FAILED. Counted separately so
          // "the reader found nothing worth sowing" can be told apart from "the
          // reader was never reached", which look identical in a seed count.
          declined += found.passedOver.filter(
            (p) => p.because.includes('coherent economic problem')).length;
          for (const passed of found.passedOver.slice(0, 3)) {
            logger.info(`venture_discovery_tick passed over ${passed.what}: ${passed.because}`,
              { jobName: 'venture_discovery_tick' });
          }
          // The ruthless half, immediately, so the frontier never accumulates.
          const weeded = await weedOut({ founderId, world });
          buried += weeded.buried.length;
          // ASKED, AND THE ANSWER COULD NOT SETTLE IT. Logged rather than
          // silent: burying these used to be the defect, so the institution
          // should be able to see how often a source turns out to be incapable
          // of the question it was asked.
          for (const quiet of weeded.saidNothing.slice(0, 3)) {
            logger.info(
              `venture_discovery_tick could not settle ${quiet.seed}: ${quiet.because}`,
              { jobName: 'venture_discovery_tick' });
          }
          // And promote what has earned it on independent ways of knowing. The
          // refusals matter more than the promotions and are logged either way.
          const earned = await promoteWhatEarnedIt({ founderId, world });
          promotedCount += earned.promoted.length;
          for (const one of earned.promoted) {
            logger.info(
              `venture_discovery_tick promoted a seed to candidate: ${one.headline}`,
              { jobName: 'venture_discovery_tick' });
          }
          for (const no of earned.refused.slice(0, 3)) {
            logger.info(`venture_discovery_tick refused to promote ${no.seed}: ${no.because}`,
              { jobName: 'venture_discovery_tick' });
          }
        } catch (err) {
          discoveryFailed.push(`${String(row.id)}: ${err instanceof Error ? err.message : String(err)}`);
          logger.error(
            `venture_discovery_tick failed for ${String(row.id)}: `
            + `${err instanceof Error ? err.message : String(err)}`,
            { jobName: 'venture_discovery_tick' });
        }
      }
      logger.info(
        `venture_discovery_tick: read=${String(readCount)}, declined=${String(declined)}, `
        + `sown=${String(sown)}, buried=${String(buried)}, promoted=${String(promotedCount)}`,
        { jobName: 'venture_discovery_tick' });
      if (discoveryFailed.length > 0) {
        throw new Error(`${String(discoveryFailed.length)} search(es) could not run: ${discoveryFailed.join('; ')}`);
      }
    },
    schedule: '0 6 * * *',
    description:
      'Turn what the portfolio needs into a search through real sources, read the '
      + 'sentences worth reading, sow a few seeds as hypotheses in Foundry\'s own words, '
      + 'bury the ones a capable source actually contradicts, and promote any that earn '
      + 'independent ways of knowing (daily)',
  },
  // WHAT LIABILITY A CANDIDATE CREATES, ASKED OF EVERY REAL ONE.
  //
  // `legalPictureOf` gated advancement and, for a real candidate, nothing had
  // ever written a legal surface or answered the lighter-architecture question
  // — only the reference world did — so no real candidate could ever move.
  // This pass recognises exposure from the candidate's own record, quoting the
  // words it rests on, applying the durable floors, recording what it could
  // not resolve, and answering the lighter question. It certifies nothing. At
  // asset level it runs again once an offer has a shape, because that is when
  // the facts severity depends on stop being unknown.
  // THE WORLD SETTLES THE EXPERIMENT. For every approved, valid, unsettled
  // test with a sealed rule and a live exposure, apply the rule to what the
  // providers said happened; and retire the asset of a test that validly
  // failed once the policy's grace has passed with no re-run. Nothing here
  // has an opinion: the rule was approved with the prediction.
  business_outcome_tick: {
    fn: async () => {
      const { settleFromTheWorld, whatTheWorldOwes, retireWhatFailed } = await import(
        '../services/venture/outcome.js');
      const due = await whatTheWorldOwes();
      let settled = 0;
      const failed: string[] = [];
      for (const experimentId of due) {
        try {
          const s = await settleFromTheWorld(experimentId);
          if (s.settled !== null) {
            settled += 1;
            logger.info(`business_outcome_tick settled ${experimentId} ${s.settled}`
              + `${s.earned ? ' and reality earned its asset' : ''}: ${s.because}`,
              { jobName: 'business_outcome_tick' });
          }
        } catch (err) {
          const why = err instanceof Error ? err.message : String(err);
          failed.push(`${experimentId} (${why})`);
          logger.error(`business_outcome_tick failed for ${experimentId}: ${why}`, { jobName: 'business_outcome_tick' });
        }
      }
      const retired = await retireWhatFailed();
      logger.info(`business_outcome_tick: due=${String(due.length)}, settled=${String(settled)}, `
        + `retired=${String(retired.length)}`, { jobName: 'business_outcome_tick' });
      // A PASS THAT COULD NOT SETTLE A DUE TEST DID NOT SUCCEED — the rule its
      // sibling `experiment_hand_tick` already keeps. This caught every failure
      // and recorded a healthy run, so a settlement failing every hour looked
      // identical to one with nothing due. Throwing puts it in job_health; the
      // rest of the pass still ran, and the next pass retries (and, since case
      // 2's repair, finishes whatever an interruption left).
      if (failed.length > 0) {
        throw new Error(`${String(failed.length)} due test(s) could not settle: ${failed.join('; ')}`);
      }
    },
    schedule: '35 * * * *', // Hourly
    description:
      'Apply each approved test\'s sealed settlement rule to what providers reported at its offer, '
      + 'grade the prediction by the world, let reality earn the asset, and retire the asset of a '
      + 'validly failed test after the policy\'s grace (hourly)',
  },
  legal_surface_tick: {
    fn: async () => {
      const { recogniseExposure, subjectsNeedingRecognition } = await import(
        '../services/venture/legal-pass.js');
      const due = await subjectsNeedingRecognition();
      let recognised = 0;
      let abstained = 0;
      for (const subject of due) {
        try {
          const result = await recogniseExposure({
            subjectKind: subject.subjectKind, subjectId: subject.subjectId });
          if ('refused' in result) {
            logger.info(`legal_surface_tick refused ${subject.subjectId}: ${result.refused}`,
              { jobName: 'legal_surface_tick' });
          } else if ('abstained' in result) {
            abstained += 1;
            logger.info(`legal_surface_tick abstained on ${subject.subjectId}: ${result.abstained}`,
              { jobName: 'legal_surface_tick' });
          } else {
            recognised += 1;
            logger.info(
              `legal_surface_tick read ${subject.subjectId} (${subject.because}): `
              + `${String(result.surfaces)} surfaces, ${String(result.unresolved)} unresolved, `
              + `${String(result.unknownFacts)} of ${String(result.facts)} facts unknown, `
              + `${String(result.droppedForGrounds)} dropped for want of grounds`,
              { jobName: 'legal_surface_tick' });
          }
        } catch (err) {
          logger.error(
            `legal_surface_tick failed for ${subject.subjectId}: `
            + `${err instanceof Error ? err.message : String(err)}`,
            { jobName: 'legal_surface_tick' });
        }
      }
      logger.info(`legal_surface_tick: due=${String(due.length)}, recognised=${String(recognised)}, `
        + `abstained=${String(abstained)}`, { jobName: 'legal_surface_tick' });
    },
    schedule: '15 6 * * *',
    description:
      'Recognise what legal surface each real candidate creates, in its own words, apply the '
      + 'durable floors, record what could not be resolved, and answer whether the same value '
      + 'could be made with less of it (daily)',
  },
  contested_evidence_tick: {
    fn: async () => {
      const { proposeWhatRealityWouldSettle } = await import(
        '../services/venture/validation.js');
      const open = await query(
        `SELECT DISTINCT o.id, o.founder_id FROM venture_opportunities o
          WHERE o.verdict IS NULL
            AND EXISTS (SELECT 1 FROM market_unknowns u
                         WHERE u.opportunity_id = o.id AND u.answered_at IS NULL
                           AND u.blocking = 1)
          ORDER BY o.rowid`, []);
      let proposed = 0;
      for (const row of open.rows as unknown as Array<Record<string, unknown>>) {
        try {
          const asked = await proposeWhatRealityWouldSettle({
            founderId: String(row.founder_id), opportunityId: String(row.id) });
          proposed += asked.proposed.length;
          for (const skip of asked.skipped) {
            logger.info(
              `contested_evidence_tick left "${skip.question}" alone: ${skip.because}`,
              { jobName: 'contested_evidence_tick' });
          }
        } catch (err) {
          logger.error(
            `contested_evidence_tick failed for ${String(row.id)}: `
            + `${err instanceof Error ? err.message : String(err)}`,
            { jobName: 'contested_evidence_tick' });
        }
      }
      logger.info(`contested_evidence_tick: experiments proposed=${String(proposed)}`,
        { jobName: 'contested_evidence_tick' });
    },
    schedule: '30 6 * * *',
    description:
      'Where reading has stopped helping and only behaviour could settle what is left, '
      + 'propose the cheapest test with a prediction sealed before it runs (daily)',
  },
  real_market_evidence_tick: {
    fn: async () => {
      const { waysOfLooking } = await import('../services/venture/research-sources.js');
      const { askWhatAlreadyExists } = await import('../services/venture/sources/index.js');
      const founders = await query(
        `SELECT DISTINCT c.founder_id FROM market_claims c
          WHERE c.evidence_mode = 'real' AND c.settled_as IS NULL
            AND NOT EXISTS (SELECT 1 FROM market_observations o WHERE o.claim_id = c.id)`, []);
      let looked = 0;
      // Every other claim is still looked at; then the pass says it failed (case 8).
      const evidenceFailed: string[] = [];
      for (const row of founders.rows as unknown as Array<Record<string, unknown>>) {
        const founderId = String(row.founder_id);
        const ways = await waysOfLooking(founderId, 'real');
        if (!ways.some((w) => w.sourceType === 'directory')) continue;
        const claims = await query(
          `SELECT id, claim, opportunity_id FROM market_claims
            WHERE founder_id = ? AND evidence_mode = 'real' AND settled_as IS NULL
              AND NOT EXISTS (SELECT 1 FROM market_observations o WHERE o.claim_id = market_claims.id)
            ORDER BY formed_at LIMIT 3`, [founderId]);
        for (const c of claims.rows as unknown as Array<Record<string, unknown>>) {
          // The claim's own words are the search. A claim nobody could search
          // for is a claim nobody could check, which is worth knowing.
          const words = String(c.claim).toLowerCase()
            .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
            .filter((w) => w.length > 3 && !STOP.has(w)).slice(0, 6).join(' ');
          if (words.length === 0) continue;
          try {
            await askWhatAlreadyExists({
              founderId, claimId: String(c.id), query: words,
              // The honest default: a claim formed about an opportunity space
              // is usually a claim that the space is open. Finding maintained
              // substitutes contradicts it, which is the result worth having.
              supportsIf: 'nothing_maintained_exists',
              opportunityId: c.opportunity_id == null ? null : String(c.opportunity_id),
            });
            looked += 1;
          } catch (err) {
            evidenceFailed.push(`${String(c.id)}: ${err instanceof Error ? err.message : String(err)}`);
            logger.error(
              `real_market_evidence_tick failed for claim ${String(c.id)}: `
              + `${err instanceof Error ? err.message : String(err)}`,
              { jobName: 'real_market_evidence_tick' });
          }
        }
      }
      logger.info(`real_market_evidence_tick: claims looked at=${String(looked)}`,
        { jobName: 'real_market_evidence_tick' });
      if (evidenceFailed.length > 0) {
        throw new Error(`${String(evidenceFailed.length)} claim(s) could not be looked at: ${evidenceFailed.join('; ')}`);
      }
    },
    schedule: '15 5 * * *',
    description:
      'Ask a real public package registry what already exists for each unexamined real market '
      + 'claim, filing dated, attributed observations and the questions a registry cannot '
      + 'settle (daily)',
  },
  reference_world_tick: {
    fn: async () => {
      const { advanceReferenceWorld } = await import('../services/reference/world.js');
      const worlds = await query(
        `SELECT p.id FROM products p
           JOIN reference_companies r ON r.product_id = p.id
          WHERE ${operatingProduct('p')} AND ${referenceCompany('p')}
          ORDER BY p.created_at, p.rowid`, []);
      let advanced = 0;
      for (const row of worlds.rows as unknown as Array<Record<string, unknown>>) {
        const productId = String(row.id);
        // One invented company's failure must not stop another's day, on the
        // same principle the institutional tick states below.
        try {
          const result = await advanceReferenceWorld(productId);
          if (result?.status === 200) advanced += 1;
          else {
            logger.error(
              `reference_world_tick refused for ${productId}: status ${String(result?.status ?? 'none')}`,
              { jobName: 'reference_world_tick', productId });
          }
        } catch (err) {
          logger.error(
            `reference_world_tick failed for ${productId}: ${err instanceof Error ? err.message : String(err)}`,
            { jobName: 'reference_world_tick', productId });
        }
      }
      logger.info(`reference_world_tick: advanced=${String(advanced)}`,
        { jobName: 'reference_world_tick' });
    },
    schedule: '30 4 * * *', // Daily at 04:30 UTC, before the institution looks
    description:
      'Advance every reference company by one day through the public metrics intake, so the '
      + 'institution can be exercised end to end without a real company (daily)',
  },
  // Institutional judgment: the production writer. Deterministic judgment, its
  // later-reality evaluation, and the owner disposition loop all existed with
  // no caller outside the test suite, so the founder-facing "needs your
  // direction" section could only ever be empty. This pass raises at most one
  // judgment per standing conflict (migration 124 makes that identity unique)
  // and observes conflicts that later evidence has settled. It grants nothing
  // and executes nothing: every judgment still requires the owner's separate
  // authority, and direction is still not permission.
  institutional_judgment_tick: {
    fn: async () => {
      const products = await query(`SELECT id FROM products WHERE ${operatingProduct()}`, []);
      const { runInstitutionalJudgmentPass } = await import(
        '../services/institution/institutional-judgment.js'
      );
      const { runJudgmentObservationPass } = await import(
        '../services/institution/institutional-judgment-evaluation.js'
      );
      // A COMPANY'S LOOPS CAN STOP INSIDE A TICK THAT SUCCEEDS.
      //
      // Every unit below is wrapped so that "one product's institutional state
      // must never stop another's pass" — they log and continue, so this job
      // resolves and `recordJobSuccess` writes a fresh `last_success_at`. A
      // company whose pass throws on every run therefore reads a page saying
      // nothing has stopped, and the staleness branch that would eventually
      // notice is defeated by the very same write.
      //
      // Failures are remembered per company here and recorded once at the end.
      // A slice failed if something in it was already logged as an ERROR: that
      // is the code's own judgement, not a new one, which is why the
      // understanding handler below — "not yet sufficient... is not an error" —
      // is deliberately not counted.
      const companyFailures = new Map<string, unknown>();
      const noteFailure = (productId: string, err: unknown): void => {
        if (!companyFailures.has(productId)) companyFailures.set(productId, err);
      };

      let raised = 0; let observed = 0;
      for (const row of products.rows as unknown as Array<Record<string, unknown>>) {
        const productId = String(row.id);
        // One product's institutional state must never stop another's pass.
        try {
          const pass = await runInstitutionalJudgmentPass(productId);
          if (pass.raised) raised++;
          observed += (await runJudgmentObservationPass(productId)).length;
        } catch (err) {
          noteFailure(productId, err);
          logger.error(
            `institutional_judgment_tick failed for ${productId}: ${err instanceof Error ? err.message : String(err)}`,
            { jobName: 'institutional_judgment_tick', productId },
          );
        }
      }
      // Two links the reachability gate found dark: nothing in production ever
      // *earned* Understanding from accumulated facts, and nothing ever
      // *resolved* an open shadow expectation. Both are deterministic reads of
      // state that already exists — neither invents evidence, and both refuse
      // themselves when the evidence is insufficient.
      let understood = 0; let compared = 0;
      const { earnResponsibilityUnderstanding } = await import(
        '../services/institution/responsibility-understanding.js'
      );
      const { resolveExternalMetricShadowing, metricExpectation } = await import(
        '../services/institution/external-shadowing.js'
      );
      const { resolveDevelopmentShadowing } = await import(
        '../services/institution/development-shadowing.js'
      );
      // NOTICING, WHICH IS THE RUNG BEFORE THE LADDER. Until this, the
      // institution held only the responsibilities somebody handed it, so a
      // company whose numbers were visibly coming apart produced nothing —
      // proved by running the reference world past it. This reads what a
      // company's own independent observations have done over a month and
      // proposes a candidate for the adverse, material ones. It concludes
      // nothing, grants nothing, and asks once per channel ever.
      const { noticeWhatTheNumbersAreDoing } = await import(
        '../services/institution/noticing.js'
      );
      // AND THE SITUATION, REMEMBERED. A diagnosis recomputed on every page
      // load and stored nowhere cannot be followed by anything — not duration,
      // not "what changed", not "we said something, did it help". Recorded here
      // because it must happen whether or not he opens the page: a situation
      // that only exists while someone is looking is not a record.
      const { recordSituation, recommendFor } = await import(
        '../services/founder/situation-chain.js');
      let situationsRecorded = 0;
      let noticedCount = 0;
      for (const row of products.rows as unknown as Array<Record<string, unknown>>) {
        const productId = String(row.id);
        try {
          const before = await import('../services/founder/situation-chain.js')
            .then((m) => m.currentSpell(productId));
          const spell = await recordSituation(productId);
          if (!before || before.id !== spell.id) situationsRecorded += 1;
          await recommendFor(productId);
        } catch (err) {
          noteFailure(productId, err);
          logger.error(
            `situation recording failed for ${productId}: `
            + `${err instanceof Error ? err.message : String(err)}`,
            { jobName: 'institutional_judgment_tick', productId });
        }
        try {
          noticedCount += (await noticeWhatTheNumbersAreDoing(productId)).length;
        } catch (err) {
          noteFailure(productId, err);
          logger.error(
            `noticing failed for ${productId}: ${err instanceof Error ? err.message : String(err)}`,
            { jobName: 'institutional_judgment_tick', productId });
        }
        const visible = await query(
          `SELECT id FROM institutional_responsibilities
            WHERE product_id=? AND state='visible' AND disposition='active'`, [productId]);
        for (const r of visible.rows as unknown as Array<Record<string, unknown>>) {
          // Throws when the facts are not yet sufficient. That is the normal
          // case and is not an error.
          try { await earnResponsibilityUnderstanding(productId, String(r.id)); understood++; } catch { /* not yet */ }
        }
        const open = await query(
          `SELECT x.id FROM responsibility_shadow_expectations x
             JOIN institutional_responsibilities r ON r.id=x.responsibility_id
            WHERE x.product_id=? AND r.state='shadowing'
              AND ${metricExpectation()}`, [productId]);
        for (const x of open.rows as unknown as Array<Record<string, unknown>>) {
          try {
            const resolved = await resolveExternalMetricShadowing(productId, String(x.id));
            if (resolved.classification !== 'unresolved') compared++;
          } catch (err) {
            noteFailure(productId, err);
            logger.error(
              `shadow resolution failed for ${String(x.id)}: ${err instanceof Error ? err.message : String(err)}`,
              { jobName: 'institutional_judgment_tick', productId },
            );
          }
        }

        // THE DEVELOPMENT TWIN, WHICH NOTHING RESOLVED. The founder can open a
        // development expectation from The Letter — Foundry asks what they
        // would expect a check to report, and records their answer — and
        // `resolveDevelopmentShadowing` had no caller outside its own tests. So
        // the institution asked a person a question and never compared the
        // answer against what the check actually said.
        //
        // Identical treatment to the metric twin above, and deliberately in the
        // same loop: they are one thing, and having them wired in two places
        // is how one of them came to be wired in none.
        const openDevelopment = await query(
          `SELECT x.id FROM responsibility_shadow_expectations x
             JOIN institutional_responsibilities r ON r.id=x.responsibility_id
            WHERE x.product_id=? AND r.state='shadowing' AND r.capability='development'
              AND x.expected_event_type LIKE 'development_verified:%'`, [productId]);
        for (const x of openDevelopment.rows as unknown as Array<Record<string, unknown>>) {
          try {
            const resolved = await resolveDevelopmentShadowing(
              { productId, expectationId: String(x.id) });
            if (resolved.verdict !== 'unresolved') compared++;
          } catch (err) {
            noteFailure(productId, err);
            logger.error(
              `development shadow resolution failed for ${String(x.id)}: ${err instanceof Error ? err.message : String(err)}`,
              { jobName: 'institutional_judgment_tick', productId },
            );
          }
        }
      }

      // Foundry observes one true fact about its own repository, as an ordinary
      // company. The canonical identity is resolved inside that module — the
      // outer boundary — and everything past it is the same intake any other
      // company's evidence uses. This is the supply that development Shadowing
      // never had: an independent check of a reality Foundry does not get to
      // narrate. It records an observation and nothing else; no repair, no
      // command, no permission.
      let selfObserved = false;
      try {
        const { observeFoundryRepositoryReality } = await import(
          '../services/foundry/self-observation.js'
        );
        const outcome = await observeFoundryRepositoryReality();
        selfObserved = outcome.observed;
        if (outcome.observed && outcome.result === 'failed') {
          logger.warn(
            `schema snapshot has drifted from the migrations that produce it: ${outcome.observation.eventType}`,
            { jobName: 'institutional_judgment_tick' },
          );
        }
        // The second check of the same shape, so the machinery downstream is
        // exercised by more than one input. Nothing here special-cases it: the
        // reader that puts a failing check on The Letter takes the latest
        // observation per check and needed no change to see this one.
        // IS WHAT IS RUNNING WHAT WAS WRITTEN. The observation that did not
        // exist when the institution described a branch as a product. It
        // changes nothing and repairs nothing; it says out loud whether the
        // deployed build can name itself, which is the fact whose absence made
        // the two kinds of truth indistinguishable.
        const { observeDeployedIdentity } = await import(
          '../services/foundry/self-observation.js'
        );
        const identity = await observeDeployedIdentity();
        if (!identity.sameThing) {
          logger.warn(`deployed identity: ${identity.says}`,
            { jobName: 'institutional_judgment_tick' });
        }

        const { observeFoundryBaselineLiveness } = await import(
          '../services/foundry/self-observation.js'
        );
        const liveness = await observeFoundryBaselineLiveness();
        selfObserved = selfObserved || liveness.observed;

        // AND FOUNDRY SAYS WHAT IT KNOWS ABOUT ITS OWN UPKEEP, so its owner is
        // never asked to invent it. Understanding is not authority: this opens
        // the rung where an obligation may be WATCHED, and changing a file
        // still needs the bounded grant only he can give.
        const { describeOwnSelfMaintenance } = await import(
          '../services/foundry/self-observation.js'
        );
        const described = await describeOwnSelfMaintenance();
        if (described.described.length) {
          logger.info(`foundry described its own upkeep: ${described.described.length} fact(s)`,
            { jobName: 'institutional_judgment_tick' });
        }
      } catch (err) {
        logger.error(
          `foundry self-observation failed: ${err instanceof Error ? err.message : String(err)}`,
          { jobName: 'institutional_judgment_tick' },
        );
      }

      // One outcome per company, whether or not anything went wrong for it —
      // a run that succeeded has to clear a previous failure, or a company that
      // recovers stays marked as failing for good.
      const { recordCompanyLoopOutcome } = await import(
        '../services/institution/loop-health.js'
      );
      for (const row of products.rows as unknown as Array<Record<string, unknown>>) {
        const productId = String(row.id);
        await recordCompanyLoopOutcome(
          productId, 'institutional_judgment_tick', companyFailures.get(productId) ?? null);
      }

      if (raised > 0 || observed > 0 || understood > 0 || compared > 0 || selfObserved) {
        logger.info(
          `institutional_judgment_tick: raised=${raised} observed=${observed} `
          + `situations=${String(situationsRecorded)} noticed=${String(noticedCount)} `
          + `understood=${understood} compared=${compared} self_observed=${selfObserved}`,
          { jobName: 'institutional_judgment_tick' },
        );
      }
    },
    schedule: '20 */6 * * *', // Every 6 hours
    description: 'Raise deterministic institutional judgments from real institutional state and observe conflicts later evidence has settled',
  },
  // The outcome loop's external half had nowhere to land.
  //
  // Migration 137 gave `outcome_status` a supply, and `/ingest/effect-outcome`
  // lets a system that can actually see the result report it. But
  // `reconcileAssistedSupportEmail` — the only function that turns those
  // observations into an outcome — had exactly one caller: the founder
  // answering the question themselves in The Letter.
  //
  // So an outcome reported by a rota system, a delivery scan or a helpdesk sat
  // in `signal_events` and changed nothing, and the effect stayed `unresolved`
  // until a person happened to answer. `reconcile_after`, written by the
  // dispatch path since the day it was built, was read by nobody.
  //
  // This pass buys NO privilege. It calls the same canonical function the
  // founder's answer calls, which reads only independently recorded evidence
  // and refuses to invent any. It reconciles only effects that ALREADY have an
  // observation, so a run with nothing to learn changes nothing at all.
  institutional_effect_reconciliation: {
    fn: async () => {
      const { listActionsAwaitingOutcomeReconciliation, reconcileAssistedSupportEmail } = await import(
        '../services/institution/responsibility-assisted-email.js'
      );
      // WHICH ROWS ARE CONSIDERED IS THE SERVICE'S QUESTION, NOT THE JOB'S.
      //
      // This held its own SELECT, and that copy carried a rule the service did
      // not: it took only rows still unresolved, so the first report to arrive
      // settled the verdict permanently and a later contradiction was never
      // looked at. The selector now lives beside the function that acts on it
      // and reopens a settled outcome when more evidence exists than the
      // verdict was decided from.
      //
      // Still a reconciliation rather than a sweep: an effect nobody has said
      // anything about is not selected, so a run with nothing to learn changes
      // nothing at all. And the tenant clause was never what protected
      // tenancy — `reconcileAssistedSupportEmail` is product-scoped and refuses
      // an action belonging to someone else.
      const pending = await listActionsAwaitingOutcomeReconciliation();

      let reconciled = 0; let verified = 0; let conflicting = 0;
      // Same reason as the judgment tick: this handler logs and continues, so a
      // company whose every reconciliation throws sits inside a run that
      // succeeds. Only companies that actually had work are recorded — a
      // company with nothing pending had no slice to succeed or fail, and
      // saying otherwise would be inventing an outcome.
      const touched = new Set<string>();
      const companyFailures = new Map<string, unknown>();
      for (const row of pending) {
        touched.add(row.productId);
        // One company's state must never stop another's reconciliation.
        try {
          const outcome = await reconcileAssistedSupportEmail(row.productId, row.actionId);
          reconciled++;
          if (outcome === 'verified_success' || outcome === 'verified_failure') verified++;
          if (outcome === 'conflicting') conflicting++;
        } catch (err) {
          if (!companyFailures.has(row.productId)) companyFailures.set(row.productId, err);
          logger.error(
            `institutional_effect_reconciliation failed for ${row.actionId}: ${err instanceof Error ? err.message : String(err)}`,
            { jobName: 'institutional_effect_reconciliation', productId: row.productId },
          );
        }
      }
      if (touched.size) {
        const { recordCompanyLoopOutcome } = await import(
          '../services/institution/loop-health.js'
        );
        for (const productId of touched) {
          await recordCompanyLoopOutcome(
            productId, 'institutional_effect_reconciliation', companyFailures.get(productId) ?? null);
        }
      }
      if (reconciled > 0) {
        // Disagreement is worth saying out loud. It is a real state, it stays
        // visible, and nothing here resolves it toward the convenient answer.
        logger.info(
          `institutional_effect_reconciliation: reconciled=${reconciled} verified=${verified} conflicting=${conflicting}`,
          { jobName: 'institutional_effect_reconciliation' },
        );
      }
    },
    schedule: '10 * * * *', // Hourly
    description: 'Turn independently reported effect outcomes into resolved outcome status; reconciles only effects that already have an observation',
  },
  // Shared rate-limit counters accumulate one row per (key, window). Nothing
  // else deletes them.
  rate_limit_counter_sweep: {
    fn: async () => {
      const { sweepRateLimitCounters } = await import('../middleware/rate-limit.js');
      const removed = await sweepRateLimitCounters();
      if (removed > 0) {
        logger.info(`rate_limit_counter_sweep: removed ${removed} closed windows`,
          { jobName: 'rate_limit_counter_sweep' });
      }
    },
    schedule: '40 * * * *', // Hourly
    description: 'Delete rate-limit counters for windows that have closed',
  },
  // CAPITAL RESEARCH (migrations 364–365; CAPITAL_RESEARCH.md): read each
  // venue's public market, seal two forecasts before the window closes, and import the
  // official result. It reads; it cannot order. When the venue asks to wait,
  // the pass says so and concludes nothing.
  capital_research_observe: {
    fn: async () => {
      const { observeOnce, evaluateDue, describeRun } = await import('../services/capital/research.js');
      // A venue that asks to wait is said in its own pass and concludes nothing; the others carry on.
      const r = await observeOnce();
      logger.info(`capital_research_observe: ${describeRun(r)}`, { jobName: 'capital_research_observe' });
      // Once a day per question, the evidence is scored and kept with its digest.
      const evaluated = await evaluateDue();
      if (evaluated) logger.info(`capital_research_observe: evaluated ${String(evaluated)} question(s)`, { jobName: 'capital_research_observe' });
    },
    schedule: '*/5 * * * *',
    description: 'Capital research: on each venue being observed, snapshot the open 15-minute window, seal the forecasts, import official results, and score each question once a day (read-only; no order is possible)',
  },
};

/** What `job:run` says for a retired name: refused with its reason, never "unknown". */
export function retiredLoopRefusal(name: string): string | null {
  const was = RETIRED_LOOPS[name];
  return was === undefined ? null
    : `${name} was retired by the owner's decision of 30 September 2026 and deleted (Roadmap 2027 R4/R9). It was: ${was}.`;
}
