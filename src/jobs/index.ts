// =============================================================================
// FOUNDRY — All 14 Scheduled Jobs
// Each job is a standalone async function callable by cron or CLI.
// =============================================================================

import { getAllActiveProducts, query, getActiveStressors, getLatestMetrics, insertAuditLog, countGate0DecisionsWithOutcomes } from '../db/client.js';
import { evaluateConditions } from '../services/lifecycle/monitor.js';
import { runCompetitiveScan } from '../services/intelligence/competitive.js';
import { identifyStressors, type StressorInputs } from '../services/intelligence/stressor.js';
import { assessRiskState, transitionRiskState, getOldestPendingGate3Age } from '../services/intelligence/risk-state.js';
import { getMRRDecomposition, computeHealthRatio } from '../services/intelligence/revenue.js';
import { getLatestCohortSummary, getHistoricalAverage } from '../services/intelligence/cohort.js';
import { generateRecoveryProtocol } from '../services/intelligence/recovery.js';
import { generateDigest } from '../services/digest/generator.js';
import { sendDigestEmail } from '../services/digest/delivery.js';
import { evaluateTriggers } from '../services/triggers/behavioral.js';
import { enforceActivationWindow } from '../services/billing/cohort.js';
import { generatePatternFromOutcome } from '../services/decisions/patterns.js';
import { synthesizeJudgmentPatterns } from '../services/wisdom/patterns.js';
import { getProductDNA } from '../services/wisdom/dna.js';
import { isPRMerged, isPROpen } from '../services/audit/github.js';
import { triggerDimensionReAudit } from '../services/audit/remediation.js';
import { callOpus, parseJSONResponse } from '../services/ai/client.js';
import { checkAndAwardMilestones } from '../services/ux/milestones.js';
import { nanoid } from 'nanoid';
import type { RiskStateValue, StressorSeverity, CompetitiveSignal } from '../types/index.js';

// ─── 1. Lifecycle Check — Daily 6:00 UTC ─────────────────────────────────────
export async function lifecycleCheck(): Promise<void> {
  console.log('[JOB] lifecycle_check starting');
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const activated = await evaluateConditions(p.id);
      if (activated.length > 0) {
        console.log(`[JOB] lifecycle_check: ${p.name} activated: ${activated.join(', ')}`);
      }
    } catch (err) {
      console.error(`[JOB] lifecycle_check error for ${p.id}:`, err);
    }
  }
  console.log('[JOB] lifecycle_check complete');
}

// ─── 2. Competitive Scan — Sunday 6:00 UTC ───────────────────────────────────
export async function competitiveScan(): Promise<void> {
  console.log('[JOB] competitive_scan starting');
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const signals = await runCompetitiveScan(p.id);
      console.log(`[JOB] competitive_scan: ${p.name} — ${signals.length} signals`);
    } catch (err) {
      console.error(`[JOB] competitive_scan error for ${p.id}:`, err);
    }
  }
  console.log('[JOB] competitive_scan complete');
}

// ─── 3. Weekly Synthesis — Friday 6:00 UTC ────────────────────────────────────
export async function weeklySynthesis(): Promise<void> {
  console.log('[JOB] weekly_synthesis starting');
  const products = await getAllActiveProducts();

  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const ls = await query('SELECT * FROM lifecycle_state WHERE product_id = ?', [p.id]);
      const lsRow = ls.rows[0] as Record<string, unknown> | undefined;
      if (!lsRow) continue;

      const riskState = (lsRow.risk_state as RiskStateValue) ?? 'green';

      // Gather inputs for stressor identification
      const mrr = await getMRRDecomposition(p.id);
      const latestMetrics = await getLatestMetrics(p.id);
      const priorMetrics = await query(
        'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1 OFFSET 1', [p.id]);
      const cohort = await getLatestCohortSummary(p.id);
      const historicalAvg = await getHistoricalAverage(p.id);
      const compSignals = await query(
        `SELECT * FROM competitive_signals WHERE product_id = ? AND significance = 'high' AND detected_at > datetime('now', '-7 days')`, [p.id]);

      // Run stressor identification
      const stressorInputs: StressorInputs = {
        productId: p.id,
        currentMetrics: latestMetrics.rows[0] as unknown as StressorInputs['currentMetrics'],
        priorMetrics: priorMetrics.rows[0] as unknown as StressorInputs['priorMetrics'],
        mrrDecomposition: mrr,
        latestCohort: cohort,
        historicalAvgRetention: historicalAvg ? { day_14: historicalAvg.day_14, day_30: historicalAvg.day_30 } : null,
        highSignificanceSignals: compSignals.rows as unknown as CompetitiveSignal[],
        riskState,
      };
      const stressorReport = await identifyStressors(stressorInputs);

      // Assess risk state
      const activeStressors = await getActiveStressors(p.id);
      const stressorList = (activeStressors.rows as unknown as Array<Record<string, unknown>>).map((s) => ({
        severity: s.severity as StressorSeverity, name: s.stressor_name as string,
      }));
      const pendingGate3Age = await getOldestPendingGate3Age(p.id);

      const riskAssessment = assessRiskState({
        productId: p.id,
        activeStressors: stressorList,
        mrrHealthRatio: mrr?.health_ratio ?? null,
        pendingGate3AgeDays: pendingGate3Age,
        currentState: riskState,
      });

      if (riskAssessment.transitionWarranted) {
        await transitionRiskState(p.id, riskState, riskAssessment.recommendedState, riskAssessment.reason, riskAssessment.triggeringSignals);

        // If transitioning to Red, generate recovery protocol
        if (riskAssessment.recommendedState === 'red') {
          await generateRecoveryProtocol({
            productId: p.id, productName: p.name,
            activeStress: stressorReport.stressors.map((s) => s.name).join(', '),
            mrrTrajectory: JSON.stringify(mrr), cohortTrends: JSON.stringify(cohort),
            competitiveSignals: JSON.stringify(compSignals.rows),
            activeDecisions: '[]', stressorTrajectory: JSON.stringify(stressorReport.stressors),
          });
        }
      }

      console.log(`[JOB] weekly_synthesis: ${p.name} — risk ${riskState}→${riskAssessment.recommendedState}, ${stressorReport.stressors.length} stressors`);
    } catch (err) {
      console.error(`[JOB] weekly_synthesis error for ${p.id}:`, err);
    }
  }
  console.log('[JOB] weekly_synthesis complete');
}

// ─── 4. Digest Generate — Monday 7:00 AM per founder timezone ─────────────────
export async function digestGenerate(): Promise<void> {
  console.log('[JOB] digest_generate starting');
  const founders = await query('SELECT * FROM founders WHERE tier IS NOT NULL', []);

  for (const fRow of founders.rows) {
    const f = fRow as Record<string, unknown>;
    try {
      const products = await query("SELECT id, name FROM products WHERE owner_id = ? AND status = 'active'", [f.id]);
      for (const pRow of products.rows) {
        const p = pRow as Record<string, string>;
        const ls = await query('SELECT risk_state FROM lifecycle_state WHERE product_id = ?', [p.id]);
        const riskState = ((ls.rows[0] as Record<string, string>)?.risk_state as RiskStateValue) ?? 'green';

        let digestType: 'weekly' | 'yellow_pulse' | 'red_daily' = 'weekly';
        if (riskState === 'red') digestType = 'red_daily';
        else if (riskState === 'yellow' && new Date().getDay() === 4) digestType = 'yellow_pulse';

        const digest = await generateDigest(p.id, riskState, digestType);
        await sendDigestEmail(f.email as string, p.name, digest);
      }
    } catch (err) {
      console.error(`[JOB] digest_generate error for founder ${f.id}:`, err);
    }
  }
  console.log('[JOB] digest_generate complete');
}

// ─── 5. Behavioral Triggers — Every 6 hours ──────────────────────────────────
export async function behavioralTriggers(): Promise<void> {
  console.log('[JOB] behavioral_triggers starting');
  await evaluateTriggers();
  console.log('[JOB] behavioral_triggers complete');
}

// ─── 6. Metric Snapshot — Daily midnight UTC ──────────────────────────────────
export async function metricSnapshot(): Promise<void> {
  console.log('[JOB] metric_snapshot starting');
  // This job is a no-op if metrics are pushed via API.
  // It serves as a fallback to ensure daily snapshots exist.
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    const today = new Date().toISOString().split('T')[0];
    const existing = await query(
      'SELECT id FROM metric_snapshots WHERE product_id = ? AND snapshot_date = ?', [p.id, today]);
    if (existing.rows.length === 0) {
      // Create empty snapshot as placeholder
      await query(
        'INSERT INTO metric_snapshots (id, product_id, snapshot_date) VALUES (?, ?, ?)',
        [nanoid(), p.id, today]);
    }
  }
  console.log('[JOB] metric_snapshot complete');
}

// ─── 7. Slot Enforcement — Daily 9:00 UTC ────────────────────────────────────
export async function slotEnforcement(): Promise<void> {
  console.log('[JOB] slot_enforcement starting');
  await enforceActivationWindow();
  console.log('[JOB] slot_enforcement complete');
}

// ─── 8. Cold Start Check — Daily ──────────────────────────────────────────────
export async function coldStartCheck(): Promise<void> {
  console.log('[JOB] cold_start_check starting');
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
  console.log('[JOB] cold_start_check complete');
}

// ─── 9. Scenario Accuracy — Weekly after synthesis ────────────────────────────
export async function scenarioAccuracy(): Promise<void> {
  console.log('[JOB] scenario_accuracy starting');
  // Find decisions with outcomes that have scenario models but no accuracy score
  const decisions = await query(
    `SELECT d.*, sm.id as scenario_id, sm.best_case, sm.base_case, sm.stress_case
     FROM decisions d
     JOIN scenario_models sm ON d.id = sm.decision_id
     WHERE d.outcome IS NOT NULL AND sm.outcome_accuracy IS NULL
     LIMIT 20`, []);

  for (const row of decisions.rows) {
    const d = row as Record<string, unknown>;
    try {
      // Simple accuracy scoring: compare outcome direction
      const outcome = d.outcome as string;
      const baseCase = JSON.parse(d.base_case as string) as Record<string, unknown>;

      // Ask Claude to evaluate accuracy
      const response = await callOpus(
        'Evaluate scenario prediction accuracy. Return JSON: {"predicted_direction": "positive|neutral|negative", "actual_direction": "positive|neutral|negative", "accuracy_score": 0.0-1.0}',
        `Base case prediction: ${JSON.stringify(baseCase)}\nActual outcome: ${outcome}`,
        512
      );
      const accuracy = parseJSONResponse<Record<string, unknown>>(response.content);

      await query('UPDATE scenario_models SET outcome_accuracy = ? WHERE id = ?',
        [JSON.stringify(accuracy), d.scenario_id]);

      // Feed into decision patterns
      const ls = await query('SELECT * FROM lifecycle_state WHERE product_id = ?', [d.product_id]);
      const lsRow = ls.rows[0] as Record<string, string> | undefined;

      await generatePatternFromOutcome({
        decisionType: d.category as string,
        lifecycleStage: lsRow?.current_prompt ?? 'unknown',
        riskState: (lsRow?.risk_state as RiskStateValue) ?? 'green',
        metricsContext: {},
        optionChosen: d.chosen_option as string,
        outcomeDirection: accuracy.actual_direction as 'positive' | 'neutral' | 'negative',
        outcomeMagnitude: 'moderate',
        outcomeTimeframeDays: 30,
        marketCategory: null,
        contributingFactors: null,
        scenarioAccuracyScore: accuracy.accuracy_score as number,
      });
    } catch (err) {
      console.error(`[JOB] scenario_accuracy error for decision ${d.id}:`, err);
    }
  }
  console.log('[JOB] scenario_accuracy complete');
}

// ─── 10. Yellow Pulse — Thursday (for Yellow state products) ──────────────────
export async function yellowPulse(): Promise<void> {
  console.log('[JOB] yellow_pulse starting');
  const products = await query(
    `SELECT p.*, f.email FROM products p
     JOIN founders f ON p.owner_id = f.id
     JOIN lifecycle_state ls ON p.id = ls.product_id
     WHERE ls.risk_state = 'yellow' AND p.status = 'active'`, []);

  for (const row of products.rows) {
    const p = row as Record<string, unknown>;
    try {
      const digest = await generateDigest(p.id as string, 'yellow', 'yellow_pulse');
      await sendDigestEmail(p.email as string, p.name as string, digest);
    } catch (err) {
      console.error(`[JOB] yellow_pulse error for ${p.id}:`, err);
    }
  }
  console.log('[JOB] yellow_pulse complete');
}

// ─── 11. Red Daily — Daily (for Red state products) ───────────────────────────
export async function redDaily(): Promise<void> {
  console.log('[JOB] red_daily starting');
  const products = await query(
    `SELECT p.*, f.email FROM products p
     JOIN founders f ON p.owner_id = f.id
     JOIN lifecycle_state ls ON p.id = ls.product_id
     WHERE ls.risk_state = 'red' AND p.status = 'active'`, []);

  for (const row of products.rows) {
    const p = row as Record<string, unknown>;
    try {
      const digest = await generateDigest(p.id as string, 'red', 'red_daily');
      await sendDigestEmail(p.email as string, p.name as string, digest);
    } catch (err) {
      console.error(`[JOB] red_daily error for ${p.id}:`, err);
    }
  }
  console.log('[JOB] red_daily complete');
}

// ─── 12. Stressor Cleanup — Daily ────────────────────────────────────────────
export async function stressorCleanup(): Promise<void> {
  console.log('[JOB] stressor_cleanup starting');
  // Auto-resolve stressors that have exceeded their timeframe
  await query(
    `UPDATE stressor_history SET status = 'escalated', resolution_notes = 'Auto-escalated: exceeded timeframe'
     WHERE status = 'active' AND datetime(identified_at, '+' || timeframe_days || ' days') < datetime('now')`, []);
  console.log('[JOB] stressor_cleanup complete');
}

// ─── 13. Pattern Aggregation — Weekly ─────────────────────────────────────────
export async function patternAggregation(): Promise<void> {
  console.log('[JOB] pattern_aggregation starting');
  // Log pattern stats for monitoring
  const total = await query('SELECT COUNT(*) as c FROM decision_patterns', []);
  const withOutcomes = await query('SELECT COUNT(*) as c FROM decision_patterns WHERE outcome_direction IS NOT NULL', []);
  console.log(`[JOB] pattern_aggregation: ${(total.rows[0] as Record<string, number>)?.c ?? 0} total, ${(withOutcomes.rows[0] as Record<string, number>)?.c ?? 0} with outcomes`);
  console.log('[JOB] pattern_aggregation complete');
}

// ─── 14. Story Capture — Event-driven, but checked daily ─────────────────────
export async function storyCapture(): Promise<void> {
  console.log('[JOB] story_capture starting');
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
  console.log('[JOB] story_capture complete');
}

// ─── 15. Founder Pattern Synthesis — Sunday 7:00 UTC ──────────────────────────
export async function founderPatternSynthesis(): Promise<void> {
  console.log('[JOB] founder_pattern_synthesis starting');
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
        `SELECT COUNT(*) as cnt FROM decisions WHERE product_id = ? AND gate = 3 AND status = 'resolved' AND resolution_reasoning IS NOT NULL`,
        [p.id]
      );
      const cnt = (decisions.rows[0] as Record<string, number>)?.cnt ?? 0;
      if (cnt < 3) continue;

      await synthesizeJudgmentPatterns(p.id, p.owner_id);
      console.log(`[JOB] founder_pattern_synthesis: ${p.name} — patterns synthesized`);
    } catch (err) {
      console.error(`[JOB] founder_pattern_synthesis error for ${p.id}:`, err);
    }
  }
  console.log('[JOB] founder_pattern_synthesis complete');
}

// ─── 16. DNA Completion Nudge — Wednesday 8:00 UTC ────────────────────────────
export async function dnaCompletionNudge(): Promise<void> {
  console.log('[JOB] dna_completion_nudge starting');
  const products = await query(
    `SELECT p.id, p.name, p.owner_id, p.created_at, f.email
     FROM products p
     JOIN founders f ON p.owner_id = f.id
     JOIN lifecycle_state ls ON p.id = ls.product_id
     WHERE p.status = 'active'
       AND (ls.dna_completion_pct IS NULL OR ls.dna_completion_pct < 60)
       AND p.created_at < datetime('now', '-14 days')`, []
  );

  for (const row of products.rows) {
    const p = row as Record<string, unknown>;
    try {
      // Max 1 nudge per week: check audit_log
      const recent = await query(
        `SELECT id FROM audit_log WHERE product_id = ? AND action = 'dna_completion_nudge' AND created_at > datetime('now', '-7 days')`,
        [p.id]
      );
      if (recent.rows.length > 0) continue;

      const dna = await getProductDNA(p.id as string);
      const completionPct = dna?.completion_pct ?? 0;

      await sendDigestEmail(
        p.email as string,
        p.name as string,
        {
          subject: `Your Product DNA is ${completionPct}% complete — reach 60% to unlock Wisdom`,
          html: `<p>Complete your Product DNA to activate Foundry's Wisdom Layer. At 60%, audit scoring uses your specific ICP and positioning instead of generic best practices.</p><p><a href="${process.env.APP_URL}/products/${p.id}/dna">Edit Product DNA →</a></p>`,
        } as any
      );

      await query(
        `INSERT INTO audit_log (id, product_id, action, details, created_at) VALUES (?, ?, 'dna_completion_nudge', ?, ?)`,
        [nanoid(), p.id, JSON.stringify({ completion_pct: completionPct }), new Date().toISOString()]
      );
      console.log(`[JOB] dna_completion_nudge: nudged ${p.name} (${completionPct}%)`);
    } catch (err) {
      console.error(`[JOB] dna_completion_nudge error for ${p.id}:`, err);
    }
  }
  console.log('[JOB] dna_completion_nudge complete');
}

// ─── 17. Remediation Outcome Check — Daily 9:00 UTC ───────────────────────────
export async function remediationOutcomeCheck(): Promise<void> {
  console.log('[JOB] remediation_outcome_check starting');
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
        console.log(`[JOB] remediation_outcome_check: PR #${prNumber} merged, re-audit triggered`);
        continue;
      }

      // Check if closed (rejected)
      const open = await isPROpen(owner, repo, prNumber, token);
      if (!open) {
        await query(
          `UPDATE remediation_prs SET status = 'rejected', resolved_at = ?, rejection_reason = 'PR closed without merge' WHERE id = ?`,
          [new Date().toISOString(), pr.id]
        );
        console.log(`[JOB] remediation_outcome_check: PR #${prNumber} rejected`);
        continue;
      }

      // Check for stale (14+ days open)
      const createdAt = new Date(pr.created_at as string);
      const daysSinceCreation = Math.floor((Date.now() - createdAt.getTime()) / 86400000);
      if (daysSinceCreation >= 14) {
        await query(
          `INSERT INTO audit_log (id, product_id, action, details, created_at) VALUES (?, ?, 'remediation_pr_stale', ?, ?)`,
          [nanoid(), pr.product_id, JSON.stringify({ pr_id: pr.id, pr_number: prNumber, days_open: daysSinceCreation }), new Date().toISOString()]
        );
      }
    } catch (err) {
      console.error(`[JOB] remediation_outcome_check error for PR ${pr.id}:`, err);
    }
  }
  console.log('[JOB] remediation_outcome_check complete');
}

// ─── 18. Milestone Check — Daily 8:00 UTC ─────────────────────────────────────
export async function milestoneCheck(): Promise<void> {
  console.log('[JOB] milestone_check starting');
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const awarded = await checkAndAwardMilestones(p.id, p.owner_id);
      if (awarded.length > 0) {
        console.log(`[JOB] milestone_check: ${p.name} — ${awarded.length} new milestones`);
      }
    } catch (err) {
      console.error(`[JOB] milestone_check error for ${p.id}:`, err);
    }
  }
  console.log('[JOB] milestone_check complete');
}

// ─── 19. Nav Badge Refresh — Every 6 hours ────────────────────────────────────
export async function navBadgeRefresh(): Promise<void> {
  console.log('[JOB] nav_badge_refresh starting');
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const pendingDecisions = await query("SELECT COUNT(*) as c FROM decisions WHERE product_id = ? AND status = 'pending'", [p.id]);
      const lastAudit = await query('SELECT created_at FROM audit_scores WHERE product_id = ? ORDER BY created_at DESC LIMIT 1', [p.id]);
      const unreadSignals = await query("SELECT COUNT(*) as c FROM competitive_signals WHERE product_id = ? AND acknowledged = 0", [p.id]);
      const openPRs = await query("SELECT COUNT(*) as c FROM remediation_prs WHERE product_id = ? AND status = 'pr_open'", [p.id]);
      const unseenMilestones = await query('SELECT COUNT(*) as c FROM milestone_events WHERE product_id = ? AND seen_at IS NULL', [p.id]);

      const pendingCount = (pendingDecisions.rows[0] as Record<string, number>)?.c ?? 0;
      const lastAuditDate = (lastAudit.rows[0] as Record<string, string>)?.created_at;
      const auditAgeDays = lastAuditDate ? Math.floor((Date.now() - new Date(lastAuditDate).getTime()) / 86400000) : 999;
      const unreadCount = (unreadSignals.rows[0] as Record<string, number>)?.c ?? 0;
      const openPRCount = (openPRs.rows[0] as Record<string, number>)?.c ?? 0;
      const unseenCount = (unseenMilestones.rows[0] as Record<string, number>)?.c ?? 0;

      const dna = await getProductDNA(p.id);
      const dnaCompletion = dna?.completion_pct ?? 0;

      await query(
        `UPDATE lifecycle_state SET
          pending_decisions_count = ?,
          audit_age_days = ?,
          unread_competitive_signals = ?,
          open_remediation_prs = ?,
          unread_milestones = ?,
          dna_completion_pct = ?
         WHERE product_id = ?`,
        [pendingCount, auditAgeDays, unreadCount, openPRCount, unseenCount, dnaCompletion, p.id],
      );
    } catch (err) {
      console.error(`[JOB] nav_badge_refresh error for ${p.id}:`, err);
    }
  }
  console.log('[JOB] nav_badge_refresh complete');
}

// ─── 20. Signal Alert Check — Every 2 hours ───────────────────────────────────

import { computeSignal } from '../services/signal.js';
import { createNotification } from '../services/ux/notifications.js';

export async function signalAlertCheck(): Promise<void> {
  console.log('[JOB] signal_alert_check starting');
  const products = await getAllActiveProducts();

  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      // Get yesterday's snapshot for comparison
      const prev = await query(
        `SELECT score, tier FROM signal_history
         WHERE product_id = ? AND snapshot_date < date('now')
         ORDER BY snapshot_date DESC LIMIT 1`,
        [p.id],
      );
      if (prev.rows.length === 0) continue;

      const prevRow = prev.rows[0] as Record<string, unknown>;
      const prevScore = prevRow.score as number;
      const prevTier = prevRow.tier as string;

      // Compute current Signal (also records today's snapshot)
      const signal = await computeSignal(p.id);
      const drop = prevScore - signal.score;

      // Alert conditions: significant drop OR tier degradation
      const tierDowngrade =
        (prevTier === 'high' && signal.tier !== 'high') ||
        (prevTier === 'mid' && signal.tier === 'low');

      if (drop >= 10 || tierDowngrade) {
        // Avoid duplicate alerts: check if we've already notified today
        const alreadyNotified = await query(
          `SELECT id FROM notifications
           WHERE product_id = ? AND type = 'signal_alert'
             AND created_at >= datetime('now', 'start of day')`,
          [p.id],
        );
        if (alreadyNotified.rows.length > 0) continue;

        const title = tierDowngrade
          ? `Signal dropped to ${signal.tier.toUpperCase()}`
          : `Signal fell ${drop} points`;

        const body = tierDowngrade
          ? `${p.name} moved from ${prevTier} to ${signal.tier} tier (${prevScore} → ${signal.score}). Review stressors now.`
          : `${p.name} Signal dropped from ${prevScore} to ${signal.score} in the last 24 hours.`;

        await createNotification(p.owner_id, p.id, 'signal_alert', title, body, '/dashboard', 'View Signal');
        console.log(`[JOB] signal_alert_check: alert created for ${p.name} — drop ${drop}pts, tier: ${prevTier} → ${signal.tier}`);
      }
    } catch (err) {
      console.error(`[JOB] signal_alert_check error for ${p.id}:`, err);
    }
  }
  console.log('[JOB] signal_alert_check complete');
}

// ─── 21. Decision Follow-up — Daily 10:00 UTC ─────────────────────────────────

export async function decisionFollowUp(): Promise<void> {
  console.log('[JOB] decision_follow_up starting');

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

      await createNotification(
        d.owner_id,
        d.product_id,
        'decision_followup',
        'How did that decision go?',
        `Time to log the outcome of: "${d.what}" — decision ID: ${d.id}. You chose: ${d.chosen_option}. What actually happened?`,
        `/decisions/${d.id}`,
        'Log outcome',
      );

      // Push back follow_up_at by 7 days to prevent re-notifying immediately
      await query(
        `UPDATE decisions SET follow_up_at = datetime(follow_up_at, '+7 days') WHERE id = ?`,
        [d.id],
      );

      console.log(`[JOB] decision_follow_up: notified for decision ${d.id} (${d.what})`);
    } catch (err) {
      console.error(`[JOB] decision_follow_up error for decision ${d.id}:`, err);
    }
  }
  console.log('[JOB] decision_follow_up complete');
}

// ─── 22. Daily Insight Generate — Daily 7:30 UTC ──────────────────────────────

import { getPreviousSignalScore } from '../services/signal.js';

export async function dailyInsightGenerate(): Promise<void> {
  console.log('[JOB] daily_insight_generate starting');
  const products = await getAllActiveProducts();

  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      // Skip if today's insight already exists
      const existing = await query(
        `SELECT id FROM daily_insights WHERE product_id = ? AND insight_date = date('now')`,
        [p.id],
      );
      if (existing.rows.length > 0) continue;

      // Gather context
      const [metrics, stressors, lifecycle, previousScore, pendingResult] = await Promise.all([
        getLatestMetrics(p.id),
        getActiveStressors(p.id),
        query('SELECT current_prompt, risk_state FROM lifecycle_state WHERE product_id = ?', [p.id]),
        getPreviousSignalScore(p.id),
        query("SELECT COUNT(*) as c FROM decisions WHERE product_id = ? AND status = 'pending'", [p.id]),
      ]);

      const m = (metrics.rows[0] ?? {}) as Record<string, unknown>;
      const ls = (lifecycle.rows[0] ?? {}) as Record<string, string>;
      const stressorList = (stressors.rows as Array<Record<string, string>>)
        .map((s) => `${s.title} (${s.severity})`).join('; ') || 'none';
      const pendingCount = (pendingResult.rows[0] as Record<string, number>)?.c ?? 0;
      const promptLabels: Record<string, string> = {
        prompt_1: 'Ideation', prompt_2: 'Foundation', prompt_2_5: 'Transition',
        prompt_3: 'Pre-launch', prompt_4: 'Launch', prompt_5: 'Early traction',
        prompt_6: 'Growth', prompt_7: 'Scale', prompt_8: 'Maturity', prompt_9: 'Exit',
      };
      const stageLabel = promptLabels[ls.current_prompt ?? 'prompt_1'] ?? 'Unknown';
      const mrrHealthStr = m.mrr_health_ratio != null
        ? `MRR health ratio: ${(m.mrr_health_ratio as number).toFixed(2)}`
        : 'MRR: insufficient data';

      const prompt = `You are Foundry, an intelligence layer for early-stage founders.
Generate today's "Daily One Thing" — the single most important insight for this business today.

Product: ${p.name}
Stage: ${stageLabel}
Risk state: ${ls.risk_state ?? 'green'}
Signal score: ${previousScore !== null ? `${previousScore} (yesterday's last reading)` : 'first day'}
Active stressors: ${stressorList}
Pending decisions: ${pendingCount}
${mrrHealthStr}
Activation rate: ${m.activation_rate != null ? ((m.activation_rate as number) * 100).toFixed(1) + '%' : 'unknown'}
30-day retention: ${m.day_30_retention != null ? ((m.day_30_retention as number) * 100).toFixed(1) + '%' : 'unknown'}
Churn rate: ${m.churn_rate != null ? ((m.churn_rate as number) * 100).toFixed(1) + '%' : 'unknown'}

Return JSON only, no markdown:
{
  "headline": "One sentence, ≤120 chars, specific and concrete — the most important thing to know today",
  "context": "2–3 sentences elaborating on why this matters and what's driving it",
  "action": "The one concrete thing to do today, ≤80 chars, or null if none"
}`;

      const raw = await callOpus('You are Foundry, an intelligence layer for early-stage founders.', prompt, 400);
      const insight = parseJSONResponse<{ headline: string; context: string; action: string | null }>(raw.content);

      if (insight?.headline) {
        const { nanoid: nid } = await import('nanoid');
        await query(
          `INSERT INTO daily_insights (id, product_id, headline, context, action, insight_date)
           VALUES (?, ?, ?, ?, ?, date('now'))
           ON CONFLICT(product_id, insight_date) DO NOTHING`,
          [nid(), p.id, insight.headline, insight.context, insight.action ?? null],
        );
        console.log(`[JOB] daily_insight_generate: generated for ${p.name} — "${insight.headline}"`);
      }
    } catch (err) {
      console.error(`[JOB] daily_insight_generate error for ${p.id}:`, err);
    }
  }
  console.log('[JOB] daily_insight_generate complete');
}

// ─── Job Registry ─────────────────────────────────────────────────────────────

export const JOB_REGISTRY: Record<string, { fn: () => Promise<void>; schedule: string; description: string }> = {
  lifecycle_check:      { fn: lifecycleCheck,      schedule: '0 6 * * *',       description: 'Evaluate lifecycle conditions for all products' },
  competitive_scan:     { fn: competitiveScan,     schedule: '0 6 * * 0',       description: 'Scan competitors for all products (Sunday)' },
  weekly_synthesis:     { fn: weeklySynthesis,      schedule: '0 6 * * 5',       description: 'Weekly intelligence synthesis (Friday)' },
  digest_generate:      { fn: digestGenerate,       schedule: '0 7 * * 1',       description: 'Generate and send weekly digests (Monday)' },
  behavioral_triggers:  { fn: behavioralTriggers,   schedule: '0 */6 * * *',     description: 'Evaluate behavioral trigger emails (every 6h)' },
  metric_snapshot:      { fn: metricSnapshot,       schedule: '0 0 * * *',       description: 'Ensure daily metric snapshots exist' },
  slot_enforcement:     { fn: slotEnforcement,      schedule: '0 9 * * *',       description: 'Enforce founding cohort activation window' },
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
  signal_alert_check:    { fn: signalAlertCheck,       schedule: '0 */2 * * *', description: 'Check for significant Signal drops and tier changes (every 2h)' },
  decision_follow_up:    { fn: decisionFollowUp,       schedule: '0 10 * * *',  description: 'Notify founders to log decision outcomes (daily 10:00 UTC)' },
  daily_insight_generate:{ fn: dailyInsightGenerate,   schedule: '30 7 * * *',  description: 'Generate Daily One Thing for each product (daily 7:30 UTC)' },
};
