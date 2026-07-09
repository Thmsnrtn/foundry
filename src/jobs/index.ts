// =============================================================================
// FOUNDRY — All 14 Scheduled Jobs
// Each job is a standalone async function callable by cron or CLI.
// =============================================================================

import { logger } from '../services/logger.js';
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
import { detectGrowthStage, updateGrowthStage } from '../services/lifecycle/stage-detection.js';
import { refreshFounderHealthMetrics } from '../services/intelligence/founder-health.js';
import { scanGeopoliticalRisks } from '../services/intelligence/global.js';
import { scanRegulatoryChanges } from '../services/intelligence/regulatory.js';
import { aggregateInsights } from '../services/wisdom/network.js';
import { runAllDueSyncs } from '../services/integrations/framework.js';
import { generatePredictions } from '../services/intelligence/predictive.js';
import { generateDraftsForPendingDecisions } from '../services/decisions/actions.js';
import { refreshAllCustomerHealth } from '../services/customers/intelligence.js';
import { buildProductGraph, discoverCausalChains } from '../services/graph/engine.js';
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

// ─── 3. Weekly Synthesis — Friday 6:00 UTC ────────────────────────────────────
export async function weeklySynthesis(): Promise<void> {
  logger.info('weekly_synthesis starting', { jobName: 'weekly_synthesis' });
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

      // Get product growth stage and lifestyle mode
      const growthStage = (p.growth_stage as GrowthStage) ?? 'growth';
      const founderResult = await query('SELECT lifestyle_mode FROM founders WHERE id = ?', [p.owner_id]);
      const isLifestyle = ((founderResult.rows[0] as Record<string, number> | undefined)?.lifestyle_mode ?? 0) === 1;

      // Run stressor identification with stage and lifestyle awareness
      const stressorInputs: StressorInputs = {
        productId: p.id,
        currentMetrics: latestMetrics.rows[0] as unknown as StressorInputs['currentMetrics'],
        priorMetrics: priorMetrics.rows[0] as unknown as StressorInputs['priorMetrics'],
        mrrDecomposition: mrr,
        latestCohort: cohort,
        historicalAvgRetention: historicalAvg ? { day_14: historicalAvg.day_14, day_30: historicalAvg.day_30 } : null,
        highSignificanceSignals: compSignals.rows as unknown as CompetitiveSignal[],
        riskState,
        growthStage,
        lifestyleMode: isLifestyle,
      };
      const stressorReport = await identifyStressors(stressorInputs);

      // Assess risk state with stage awareness
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
        growthStage,
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

      logger.info(`weekly_synthesis: ${p.name} — risk ${riskState}→${riskAssessment.recommendedState}, ${stressorReport.stressors.length} stressors`, { jobName: 'weekly_synthesis' });
    } catch (err) {
      logger.error(`weekly_synthesis error for ${p.id}:`, { jobName: 'weekly_synthesis', error: String(err) });
    }
  }
  logger.info('weekly_synthesis complete', { jobName: 'weekly_synthesis' });
}

// ─── 4. Digest Generate — Monday 7:00 AM per founder timezone ─────────────────
export async function digestGenerate(): Promise<void> {
  logger.info('digest_generate starting', { jobName: 'digest_generate' });
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
      logger.error(`digest_generate error for founder ${f.id}:`, { jobName: 'digest_generate', error: String(err) });
    }
  }
  logger.info('digest_generate complete', { jobName: 'digest_generate' });
}

// ─── 5. Behavioral Triggers — Every 6 hours ──────────────────────────────────
export async function behavioralTriggers(): Promise<void> {
  logger.info('behavioral_triggers starting', { jobName: 'behavioral_triggers' });
  await evaluateTriggers();
  // Day-3 onboarding activation: nudge founders who haven't entered metrics.
  try {
    const { evaluateOnboardingSequence } = await import('../lib/onboarding-emails.js');
    await evaluateOnboardingSequence();
  } catch (err) {
    logger.warn('onboarding_sequence evaluation failed', { error: String(err) });
  }
  logger.info('behavioral_triggers complete', { jobName: 'behavioral_triggers' });
}

// ─── Data retention — daily ──────────────────────────────────────────────────
export async function dataRetention(): Promise<void> {
  logger.info('data_retention starting', { jobName: 'data_retention' });
  const { purgeExpiredRecords } = await import('../services/retention.js');
  const counts = await purgeExpiredRecords();
  logger.info('data_retention complete', { jobName: 'data_retention', counts });
}

// ─── SLO / degradation check — hourly ────────────────────────────────────────
export async function sloCheck(): Promise<void> {
  logger.info('slo_check starting', { jobName: 'slo_check' });
  const { runSloChecksAndAlert } = await import('../services/slo.js');
  const breaches = await runSloChecksAndAlert();
  logger.info('slo_check complete', { jobName: 'slo_check', breachCount: breaches.length });
}

// ─── 6. Metric Snapshot — Daily midnight UTC ──────────────────────────────────
export async function metricSnapshot(): Promise<void> {
  logger.info('metric_snapshot starting', { jobName: 'metric_snapshot' });
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
  logger.info('metric_snapshot complete', { jobName: 'metric_snapshot' });
}

// ─── 7. Slot Enforcement — Daily 9:00 UTC ────────────────────────────────────
export async function slotEnforcement(): Promise<void> {
  logger.info('slot_enforcement starting', { jobName: 'slot_enforcement' });
  await enforceActivationWindow();
  logger.info('slot_enforcement complete', { jobName: 'slot_enforcement' });
}

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
        productId: d.product_id as string,
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
     WHERE ls.risk_state = 'yellow' AND p.status = 'active'`, []);

  for (const row of products.rows) {
    const p = row as Record<string, unknown>;
    try {
      const digest = await generateDigest(p.id as string, 'yellow', 'yellow_pulse');
      await sendDigestEmail(p.email as string, p.name as string, digest);
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
     WHERE ls.risk_state = 'red' AND p.status = 'active'`, []);

  for (const row of products.rows) {
    const p = row as Record<string, unknown>;
    try {
      const digest = await generateDigest(p.id as string, 'red', 'red_daily');
      await sendDigestEmail(p.email as string, p.name as string, digest);
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
        `SELECT COUNT(*) as cnt FROM decisions WHERE product_id = ? AND gate = 3 AND status = 'resolved' AND resolution_reasoning IS NOT NULL`,
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
      logger.error(`nav_badge_refresh error for ${p.id}:`, { jobName: 'nav_badge_refresh', error: String(err) });
    }
  }
  logger.info('nav_badge_refresh complete', { jobName: 'nav_badge_refresh' });
}

// ─── 20. Signal Alert Check — Every 2 hours ───────────────────────────────────

import { computeSignal } from '../services/signal.js';
import { createNotification } from '../services/ux/notifications.js';

export async function signalAlertCheck(): Promise<void> {
  logger.info('signal_alert_check starting', { jobName: 'signal_alert_check' });
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
        logger.info(`signal_alert_check: alert created for ${p.name} — drop ${drop}pts, tier: ${prevTier} → ${signal.tier}`, { jobName: 'signal_alert_check' });
      }
    } catch (err) {
      logger.error(`signal_alert_check error for ${p.id}:`, { jobName: 'signal_alert_check', error: String(err) });
    }
  }
  logger.info('signal_alert_check complete', { jobName: 'signal_alert_check' });
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

      logger.info(`decision_follow_up: notified for decision ${d.id} (${d.what})`, { jobName: 'decision_follow_up' });
    } catch (err) {
      logger.error(`decision_follow_up error for decision ${d.id}:`, { jobName: 'decision_follow_up', error: String(err) });
    }
  }
  logger.info('decision_follow_up complete', { jobName: 'decision_follow_up' });
}

// ─── 22. Daily Insight Generate — Daily 7:30 UTC ──────────────────────────────

import { getPreviousSignalScore } from '../services/signal.js';

export async function dailyInsightGenerate(): Promise<void> {
  logger.info('daily_insight_generate starting', { jobName: 'daily_insight_generate' });
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
        logger.info(`daily_insight_generate: generated for ${p.name} — "${insight.headline}"`, { jobName: 'daily_insight_generate' });
      }
    } catch (err) {
      logger.error(`daily_insight_generate error for ${p.id}:`, { jobName: 'daily_insight_generate', error: String(err) });
    }
  }
  logger.info('daily_insight_generate complete', { jobName: 'daily_insight_generate' });
}

// ─── 23. Weekly Plan Generate — Monday 8:00 UTC ───────────────────────────────

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export async function weeklyPlanGenerate(): Promise<void> {
  logger.info('weekly_plan_generate starting', { jobName: 'weekly_plan_generate' });
  const products = await getAllActiveProducts();
  const week = isoWeek(new Date());

  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const existing = await query('SELECT id FROM weekly_plans WHERE product_id = ? AND week_of = ?', [p.id, week]);
      if (existing.rows.length > 0) continue;

      const [signal, stressors, metrics, lifecycle, pendingResult] = await Promise.all([
        computeSignal(p.id),
        getActiveStressors(p.id),
        getLatestMetrics(p.id),
        query('SELECT current_prompt, risk_state FROM lifecycle_state WHERE product_id = ?', [p.id]),
        query("SELECT COUNT(*) as c FROM decisions WHERE product_id = ? AND status = 'pending'", [p.id]),
      ]);

      const ls = (lifecycle.rows[0] ?? {}) as Record<string, string>;
      const m = (metrics.rows[0] ?? {}) as Record<string, unknown>;
      const stressorList = (stressors.rows as Array<Record<string, string>>)
        .map((s) => `${s.title} (${s.severity})`).slice(0, 5).join('; ') || 'none';
      const pendingCount = (pendingResult.rows[0] as Record<string, number>)?.c ?? 0;

      const prompt = `Product: ${p.name}
Signal score: ${signal.score} (${signal.tier} tier), risk state: ${signal.riskState}
Stage: ${ls.current_prompt ?? 'unknown'}, pending decisions: ${pendingCount}
Active stressors: ${stressorList}
Signal components — stressors: −${signal.components.stressorPenalty}, MRR: −${signal.components.mrrPenalty}, backlog: −${signal.components.backlogPenalty}, lifecycle: +${signal.components.lifecycleBonus}
Activation: ${m.activation_rate != null ? ((m.activation_rate as number)*100).toFixed(1)+'%' : 'unknown'}
Churn: ${m.churn_rate != null ? ((m.churn_rate as number)*100).toFixed(1)+'%' : 'unknown'}

Generate exactly 3 prioritized weekly actions that would raise Signal the most. Be specific and concrete.

Return JSON only:
{
  "synthesis": "1-2 sentence framing of this week's priority",
  "items": [
    { "id": "1", "text": "Specific action", "category": "signal|decision|relationship|product", "impact": "high|medium|low" }
  ]
}`;

      const raw = await callOpus('You are Foundry. Generate a weekly operating plan for a founder.', prompt, 600);
      const plan = parseJSONResponse<{ synthesis: string; items: Array<{ id: string; text: string; category: string; impact: string }> }>(raw.content);

      if (plan?.items) {
        const items = plan.items.map((item) => ({ ...item, done: false }));
        await query(
          `INSERT INTO weekly_plans (id, product_id, week_of, signal_at_generation, items_json, synthesis)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(product_id, week_of) DO NOTHING`,
          [nanoid(), p.id, week, signal.score, JSON.stringify(items), plan.synthesis ?? null],
        );
        logger.info(`weekly_plan_generate: generated for ${p.name}`, { jobName: 'weekly_plan_generate' });
      }
    } catch (err) {
      logger.error(`weekly_plan_generate error for ${p.id}:`, { jobName: 'weekly_plan_generate', error: String(err) });
    }
  }
  logger.info('weekly_plan_generate complete', { jobName: 'weekly_plan_generate' });
}

// ─── New Job: Integration Sync ────────────────────────────────────────────────

export async function integrationSync(): Promise<void> {
  const { syncAllIntegrations } = await import('../services/integrations/sync.js');
  await syncAllIntegrations();
}

// ─── New Job: Morning Briefings ───────────────────────────────────────────────

export async function morningBriefings(): Promise<void> {
  logger.info('morning_briefings starting', { jobName: 'morning_briefings' });
  const products = await getAllActiveProducts();

  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const founderResult = await query('SELECT name FROM founders WHERE id = ?', [p.owner_id]);
      const founderName = (founderResult.rows[0] as Record<string, string> | undefined)?.name ?? null;
      const { generateMorningBriefing } = await import('../services/voice/briefing.js');
      await generateMorningBriefing(p.id, p.owner_id, founderName);
    } catch (err) {
      logger.error(`morning_briefings error for ${p.id}:`, { jobName: 'morning_briefings', error: String(err) });
    }
  }
  logger.info('morning_briefings complete', { jobName: 'morning_briefings' });
}

// ─── New Job: Alignment Scores ────────────────────────────────────────────────

export async function alignmentScores(): Promise<void> {
  logger.info('alignment_scores starting', { jobName: 'alignment_scores' });
  const products = await getAllActiveProducts();
  const { computeAlignmentScore } = await import('../services/team/members.js');

  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      await computeAlignmentScore(p.id);
    } catch (err) {
      logger.error(`alignment_scores error for ${p.id}:`, { jobName: 'alignment_scores', error: String(err) });
    }
  }
  logger.info('alignment_scores complete', { jobName: 'alignment_scores' });
}

// ─── New Job: Network Contribution ────────────────────────────────────────────

export async function networkContribution(): Promise<void> {
  logger.info('network_contribution starting', { jobName: 'network_contribution' });
  const products = await getAllActiveProducts();
  const { contributeToNetwork } = await import('../services/network/benchmarks.js');

  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const lsResult = await query('SELECT current_prompt FROM lifecycle_state WHERE product_id = ?', [p.id]);
      const lifecycleStage = (lsResult.rows[0] as Record<string, string> | undefined)?.current_prompt ?? 'prompt_1';
      await contributeToNetwork(p.id, p.market_category ?? null, lifecycleStage);
    } catch (err) {
      logger.error(`network_contribution error for ${p.id}:`, { jobName: 'network_contribution', error: String(err) });
    }
  }
  logger.info('network_contribution complete', { jobName: 'network_contribution' });
}

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
     LIMIT 50`,
    [],
  );

  const { recordPredictionAccuracy } = await import('../services/temporal/replay.js');

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
      );
    } catch (err) {
      logger.error(`prediction_accuracy error for decision ${d.id}:`, { jobName: 'prediction_accuracy', error: String(err) });
    }
  }
  logger.info(`prediction_accuracy: scored ${decisions.rows.length} decisions`, { jobName: 'prediction_accuracy' });
}

// ─── SCP Jobs ─────────────────────────────────────────────────────────────────

/** Run all due agents for all active SCP companies — the core heartbeat. */
export async function scpAgentRunner(): Promise<void> {
  logger.info('scp_agent_runner starting', { jobName: 'scp_agent_runner' });
  try {
    const { runDueAgentsForAllProducts } = await import('../services/scp/scheduler.js');
    await runDueAgentsForAllProducts();
  } catch (err) {
    logger.error('JOB: scp_agent_runner error:', { jobName: 'JOB', error: String(err) });
  }
  logger.info('scp_agent_runner complete', { jobName: 'scp_agent_runner' });
}

/** Generate CEO briefings for all active SCP companies. */
export async function scpDailyBriefing(): Promise<void> {
  logger.info('scp_daily_briefing starting', { jobName: 'scp_daily_briefing' });
  try {
    const { generateBriefingsForAllProducts } = await import('../services/scp/scheduler.js');
    await generateBriefingsForAllProducts();
  } catch (err) {
    logger.error('JOB: scp_daily_briefing error:', { jobName: 'JOB', error: String(err) });
  }
  logger.info('scp_daily_briefing complete', { jobName: 'scp_daily_briefing' });
}

/** Run evolution synthesis for all active agents across all companies. */
export async function scpEvolutionCycle(): Promise<void> {
  logger.info('scp_evolution_cycle starting', { jobName: 'scp_evolution_cycle' });
  try {
    const { runEvolutionForAllProducts } = await import('../services/scp/scheduler.js');
    await runEvolutionForAllProducts();
  } catch (err) {
    logger.error('JOB: scp_evolution_cycle error:', { jobName: 'JOB', error: String(err) });
  }
  logger.info('scp_evolution_cycle complete', { jobName: 'scp_evolution_cycle' });
}

/** Update company lifecycle states (setup → learning → operating → ...). */
export async function scpLifecycleTransition(): Promise<void> {
  logger.info('scp_lifecycle_transition starting', { jobName: 'scp_lifecycle_transition' });
  try {
    const { SCPInstance } = await import('../services/scp/instance.js');
    const products = await getAllActiveProducts();
    for (const row of products.rows) {
      const p = row as Record<string, string>;
      if (p.scp_status === 'active') {
        try {
          const instance = new SCPInstance(p.id);
          await instance.updateLifecycleState();
        } catch (err) {
          logger.error(`scp_lifecycle_transition error for ${p.id}:`, { jobName: 'scp_lifecycle_transition', error: String(err) });
        }
      }
    }
  } catch (err) {
    logger.error('JOB: scp_lifecycle_transition error:', { jobName: 'JOB', error: String(err) });
  }
  logger.info('scp_lifecycle_transition complete', { jobName: 'scp_lifecycle_transition' });
}

// ─── SCP Remediation Sync — Daily 8:00 UTC ───────────────────────────────────

export async function scpRemediationSync(): Promise<void> {
  logger.info('scp_remediation_sync starting', { jobName: 'scp_remediation_sync' });
  try {
    const { getRemediationSummary } = await import('../services/scp/remediation.js');
    const products = await getAllActiveProducts();
    for (const row of products.rows) {
      const p = row as Record<string, string>;
      try {
        const summary = await getRemediationSummary(p.id);
        if (summary.open > 0) {
          logger.info(`scp_remediation_sync: ${p.name}: ${summary.open} open remediations (critical:${summary.critical}, high:${summary.high})`, { jobName: 'scp_remediation_sync' });
        }
      } catch {
        // Non-fatal per product
      }
    }
  } catch (err) {
    logger.error('scp_remediation_sync: Remediation sync error:', { jobName: 'scp_remediation_sync', error: String(err) });
  }
  logger.info('scp_remediation_sync complete', { jobName: 'scp_remediation_sync' });
}

// ─── SCP Temporal Analysis — Monday 5:00 UTC ─────────────────────────────────

async function scpTemporalAnalysis(): Promise<void> {
  // Weekly: analyze temporal trends for all active SCP products
  const { query } = await import('../db/client.js');
  const { getSignalTimeline, analyzeTemporalTrends } = await import('../services/scp/temporal.js');
  const products = await query(`SELECT id FROM products WHERE scp_status = 'active'`);
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const timeline = await getSignalTimeline(p.id, 90);
      if (timeline.length >= 7) {
        await analyzeTemporalTrends(p.id, timeline);
        logger.info(`temporal: Analyzed ${p.id}: ${timeline.length} data points`, { jobName: 'temporal' });
      }
    } catch (err) {
      logger.error(`temporal: Failed for ${p.id}:`, { jobName: 'temporal', error: String(err) });
    }
  }
}

// ─── SCP Cost Report — 1st of Month ──────────────────────────────────────────

async function scpCostReport(): Promise<void> {
  // Monthly: update 30d trailing AI cost on all active products
  const { query } = await import('../db/client.js');
  const costData = await query(
    `SELECT product_id, SUM(cost_usd) as total_cost
     FROM agent_cost_log
     WHERE logged_at >= datetime('now', '-30 days')
     GROUP BY product_id`
  );
  for (const row of costData.rows) {
    const r = row as Record<string, unknown>;
    await query(
      `UPDATE products SET ai_cost_trailing_30d_usd = ? WHERE id = ?`,
      [r.total_cost as number ?? 0, r.product_id as string]
    );
  }
  logger.info(`cost_report: Updated 30d costs for ${costData.rows.length} products`, { jobName: 'cost_report' });
}

// ─── SCP Wisdom Synthesis — Sunday 3:00 UTC ───────────────────────────────────

async function scpWisdomSynthesis(): Promise<void> {
  // Weekly: synthesize wisdom patterns for all active SCP products
  const { query } = await import('../db/client.js');
  const { synthesizeWisdomPatterns } = await import('../services/scp/wisdom.js');
  const products = await query(`SELECT id FROM products WHERE scp_status = 'active'`);
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      await synthesizeWisdomPatterns(p.id);
    } catch (err) {
      logger.error(`wisdom: synthesis failed for ${p.id}:`, { jobName: 'wisdom', error: String(err) });
    }
  }
}

// ─── SCP Intelligence Benchmarks — Daily 2:00 UTC ────────────────────────────

async function scpIntelligenceBenchmarks(): Promise<void> {
  // Daily: recompute intelligence benchmarks across all products
  const { computeAndStoreBenchmarks } = await import('../services/scp/network.js');
  await computeAndStoreBenchmarks();
}

// ─── SCP DNA Nudge — Daily 10:00 UTC ─────────────────────────────────────────

async function scpDNANudge(): Promise<void> {
  // Daily: nudge founders whose DNA completion < 60% to fill in more context
  // This gives agents better context for their analyses
  logger.info('scp_dna_nudge starting', { jobName: 'scp_dna_nudge' });
  const { query: dbQuery } = await import('../db/client.js');
  const incompleteProducts = await dbQuery(
    `SELECT p.id, p.name, f.email
     FROM products p
     JOIN founders f ON p.owner_id = f.id
     WHERE p.scp_status = 'active'
       AND p.company_lifecycle_state IN ('setup', 'learning')
     LIMIT 50`
  );
  logger.info(`dna_nudge: Found ${incompleteProducts.rows.length} products in early lifecycle`, { jobName: 'dna_nudge' });
  // In production: send email nudge via notification service
  logger.info('scp_dna_nudge complete', { jobName: 'scp_dna_nudge' });
}

// ─── SCP v3: Lifecycle Rules — Every 4h ──────────────────────────────────────

async function scpLifecycleRules(): Promise<void> {
  logger.info('scp_lifecycle_rules starting', { jobName: 'scp_lifecycle_rules' });
  const { query: dbQuery } = await import('../db/client.js');
  const products = await dbQuery(
    `SELECT id FROM products WHERE scp_status = 'active' LIMIT 100`
  );
  const { evaluateLifecycleRules } = await import('../services/customer/lifecycle.js');
  let totalTriggered = 0;
  for (const row of products.rows) {
    const { rules_triggered } = await evaluateLifecycleRules((row as Record<string, unknown>).id as string);
    totalTriggered += rules_triggered;
  }
  logger.info(`scp_lifecycle_rules: ${totalTriggered} rules triggered across ${products.rows.length} products`, { jobName: 'scp_lifecycle_rules' });
}

// ─── SCP v3: AI P&L Update — Daily 1:00 UTC ──────────────────────────────────

async function scpPLUpdate(): Promise<void> {
  logger.info('scp_pl_update starting', { jobName: 'scp_pl_update' });
  const { query: dbQuery } = await import('../db/client.js');
  const products = await dbQuery(
    `SELECT id FROM products WHERE scp_status = 'active' LIMIT 100`
  );
  const { getAICompanyPL } = await import('../services/financial/economics.js');
  for (const row of products.rows) {
    const productId = (row as Record<string, unknown>).id as string;
    const pl = await getAICompanyPL(productId, 30);
    // Update products table with latest AI cost trailing 30d
    await dbQuery(
      `UPDATE products SET ai_cost_trailing_30d_usd=?, attributed_revenue_trailing_30d_usd=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [pl.costs.total_usd, pl.revenue.total_usd, productId]
    );
  }
  logger.info(`scp_pl_update: Updated P&L for ${products.rows.length} products`, { jobName: 'scp_pl_update' });
}

// ─── SCP v3: Monthly Strategy Synthesis — 1st of month ───────────────────────

async function scpStrategySynthesis(): Promise<void> {
  logger.info('scp_strategy_synthesis starting', { jobName: 'scp_strategy_synthesis' });
  const { query: dbQuery } = await import('../db/client.js');
  const products = await dbQuery(
    `SELECT id FROM products WHERE scp_status = 'active' AND company_lifecycle_state NOT IN ('setup') LIMIT 50`
  );
  const { generateStrategicSynthesis } = await import('../services/strategy/synthesis.js');
  let generated = 0;
  for (const row of products.rows) {
    try {
      await generateStrategicSynthesis((row as Record<string, unknown>).id as string);
      generated++;
    } catch (err) {
      logger.error(`scp_strategy_synthesis: Failed for ${(row as Record<string, unknown>).id}`, { jobName: 'scp_strategy_synthesis', error: String(err) });
    }
  }
  logger.info(`scp_strategy_synthesis: Generated ${generated} syntheses`, { jobName: 'scp_strategy_synthesis' });
}

// ─── SCP v3: Integration Fabric Sync — Every Hour ────────────────────────────

async function scpIntegrationFabricSync(): Promise<void> {
  logger.info('scp_integration_fabric_sync starting', { jobName: 'scp_integration_fabric_sync' });
  const { query: dbQuery } = await import('../db/client.js');
  const products = await dbQuery(
    `SELECT id FROM products WHERE scp_status = 'active' LIMIT 100`
  );
  const { syncPostHogEvents } = await import('../services/integration/posthog.js');
  const { syncGitHubEvents } = await import('../services/integration/github.js');

  let posthogSynced = 0;
  let githubSynced = 0;

  for (const row of products.rows) {
    const productId = (row as Record<string, unknown>).id as string;
    try {
      const ph = await syncPostHogEvents(productId);
      posthogSynced += ph.synced;
    } catch { /* non-fatal per product */ }
    try {
      const gh = await syncGitHubEvents(productId);
      githubSynced += gh.synced;
    } catch { /* non-fatal per product */ }
  }

  logger.info(`scp_integration_fabric_sync: PostHog: ${posthogSynced} events, GitHub: ${githubSynced} events`, { jobName: 'scp_integration_fabric_sync' });
}

// ─── SCP v4: Extended Integrations Sync — Every 2h ───────────────────────────

async function scpExtendedIntegrationsSync(): Promise<void> {
  logger.info('scp_extended_integrations_sync starting', { jobName: 'scp_extended_integrations_sync' });
  const { query: dbQuery } = await import('../db/client.js');
  const products = await dbQuery(`SELECT id FROM products WHERE scp_status = 'active' LIMIT 100`);

  let total = 0;
  for (const row of products.rows) {
    const productId = (row as Record<string, unknown>).id as string;
    try {
      const [
        { syncSentryEvents },
        { syncLinearEvents },
        { syncIntercomEvents },
        { syncSlackEvents },
      ] = await Promise.all([
        import('../services/integration/sentry.js').catch(() => ({ syncSentryEvents: async () => ({ synced: 0 }) })),
        import('../services/integration/linear.js').catch(() => ({ syncLinearEvents: async () => ({ synced: 0 }) })),
        import('../services/integration/intercom.js').catch(() => ({ syncIntercomEvents: async () => ({ synced: 0 }) })),
        import('../services/integration/slack.js').catch(() => ({ syncSlackEvents: async () => ({ synced: 0 }) })),
      ]);
      const results = await Promise.allSettled([
        syncSentryEvents(productId),
        syncLinearEvents(productId),
        syncIntercomEvents(productId),
        syncSlackEvents(productId),
      ]);
      const synced = results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? (r.value.synced ?? 0) : 0), 0);
      total += synced;
    } catch { /* non-fatal per product */ }
  }
  logger.info(`scp_extended_integrations_sync: Synced ${total} events across ${products.rows.length} products`, { jobName: 'scp_extended_integrations_sync' });
}

// ─── SCP v4: Benchmark Refresh — Sunday 3:00 UTC ────────────────────────────

async function scpBenchmarkRefresh(): Promise<void> {
  logger.info('scp_benchmark_refresh starting', { jobName: 'scp_benchmark_refresh' });
  try {
    const { refreshPercentiles, submitBenchmark } = await import('../services/benchmarking/pool.js');
    const { query: dbQuery } = await import('../db/client.js');

    // Submit this cycle's metrics as benchmark contributions
    const products = await dbQuery(
      `SELECT ms.*, ls.current_prompt, p.market_category
       FROM metric_snapshots ms
       JOIN products p ON ms.product_id = p.id
       JOIN lifecycle_state ls ON ms.product_id = ls.product_id
       WHERE ms.snapshot_date = date('now', '-1 day')
         AND p.scp_status = 'active'
       LIMIT 200`
    );

    const stageMap: Record<string, string> = {
      prompt_1: 'pre_revenue', prompt_2: 'pre_revenue', prompt_2_5: 'pre_revenue',
      prompt_3: 'early', prompt_4: 'early', prompt_5: 'early',
      prompt_6: 'growth', prompt_7: 'growth', prompt_8: 'scale', prompt_9: 'scale',
    };

    for (const row of products.rows) {
      const r = row as Record<string, unknown>;
      const stage = stageMap[r.current_prompt as string] ?? 'early';
      const contributions = [];
      if (r.churn_rate != null) contributions.push({ metric_name: 'churn_rate', value: Number(r.churn_rate), company_stage: stage, industry: 'saas' });
      if (r.activation_rate != null) contributions.push({ metric_name: 'activation_rate', value: Number(r.activation_rate), company_stage: stage, industry: 'saas' });
      if (contributions.length > 0) {
        await submitBenchmark(r.product_id as string, contributions).catch(() => {});
      }
    }

    await refreshPercentiles();
    logger.info(`scp_benchmark_refresh: Refreshed percentiles for ${products.rows.length} contributions`, { jobName: 'scp_benchmark_refresh' });
  } catch (err) {
    logger.error('scp_benchmark_refresh: Error:', { jobName: 'scp_benchmark_refresh', error: String(err) });
  }
}

// ─── SCP v4: Decision Retrospectives — Monday 9:00 UTC ───────────────────────

async function scpDecisionRetrospectives(): Promise<void> {
  logger.info('scp_decision_retrospectives starting', { jobName: 'scp_decision_retrospectives' });
  try {
    const { getDecisionsDueForRetrospective } = await import('../services/scp/decision-log.js');
    const { query: dbQuery } = await import('../db/client.js');

    const products = await dbQuery(`SELECT id, owner_id, name FROM products WHERE scp_status = 'active' LIMIT 100`);
    let notified = 0;

    for (const row of products.rows) {
      const p = row as Record<string, unknown>;
      const due = await getDecisionsDueForRetrospective(p.id as string);
      if (due.length === 0) continue;

      const { createNotification } = await import('../services/ux/notifications.js');
      await createNotification(
        p.owner_id as string,
        p.id as string,
        'decision_retrospective',
        `${due.length} decision${due.length > 1 ? 's' : ''} ready for retrospective`,
        `Review outcomes for: ${due.slice(0, 2).map(d => `"${d.decision_title}"`).join(', ')}${due.length > 2 ? ` +${due.length - 2} more` : ''}. Rate how each decision played out to improve future judgment.`,
        '/agents/decisions',
        'Review decisions'
      );
      notified++;
    }
    logger.info(`scp_decision_retrospectives: Notified ${notified} products`, { jobName: 'scp_decision_retrospectives' });
  } catch (err) {
    logger.error('scp_decision_retrospectives: Error:', { jobName: 'scp_decision_retrospectives', error: String(err) });
  }
}

// ─── SCP v4: Wellbeing Focus Cleanup — Daily midnight ────────────────────────

async function scpWellbeingFocusCleanup(): Promise<void> {
  logger.info('scp_wellbeing_focus_cleanup starting', { jobName: 'scp_wellbeing_focus_cleanup' });
  try {
    const { query: dbQuery } = await import('../db/client.js');
    // Clear expired focus areas
    await dbQuery(
      `UPDATE founder_focus_settings SET focus_area=NULL, focus_ends_at=NULL WHERE focus_ends_at IS NOT NULL AND focus_ends_at <= datetime('now')`
    );
    // Clear expired vacation modes
    await dbQuery(
      `UPDATE founder_focus_settings SET vacation_mode_until=NULL WHERE vacation_mode_until IS NOT NULL AND vacation_mode_until <= datetime('now')`
    );
    // Clear expired decision snoozes
    await dbQuery(
      `DELETE FROM decision_snooze_log WHERE snoozed_until <= datetime('now')`
    );
    logger.info('scp_wellbeing_focus_cleanup: Cleaned up expired focus and snooze records', { jobName: 'scp_wellbeing_focus_cleanup' });
  } catch (err) {
    logger.error('scp_wellbeing_focus_cleanup: Error:', { jobName: 'scp_wellbeing_focus_cleanup', error: String(err) });
  }
}

// ─── SCP v4: Webhook Delivery Cleanup — Sunday 4:00 UTC ─────────────────────

async function scpWebhookDeliveryCleanup(): Promise<void> {
  logger.info('scp_webhook_delivery_cleanup starting', { jobName: 'scp_webhook_delivery_cleanup' });
  try {
    const { query: dbQuery } = await import('../db/client.js');
    // Keep last 30 days of delivery records, delete older ones
    const result = await dbQuery(
      `DELETE FROM webhook_deliveries WHERE created_at < datetime('now', '-30 days')`
    );
    logger.info(`scp_webhook_delivery_cleanup: Cleaned up old webhook delivery records`, { jobName: 'scp_webhook_delivery_cleanup' });
  } catch (err) {
    logger.error('scp_webhook_delivery_cleanup: Error:', { jobName: 'scp_webhook_delivery_cleanup', error: String(err) });
  }
}

// ─── SCP v5: Prediction Accuracy Check — Daily 6:00 UTC ──────────────────────

async function scpPredictionAccuracyCheck(): Promise<void> {
  logger.info('scp_prediction_accuracy starting', { jobName: 'scp_prediction_accuracy' });
  try {
    const { measurePendingPredictions } = await import('../services/scp/accuracy/tracker.js');
    const { query: dbQuery } = await import('../db/client.js');
    const products = await dbQuery(`SELECT id FROM products WHERE scp_status='active' LIMIT 100`);
    let totalMeasured = 0;
    for (const row of products.rows) {
      const productId = (row as Record<string, unknown>).id as string;
      try {
        const result = await measurePendingPredictions(productId);
        totalMeasured += result.measured;
      } catch { /* non-fatal per product */ }
    }
    logger.info(`scp_prediction_accuracy: Measured ${totalMeasured} predictions`, { jobName: 'scp_prediction_accuracy' });
  } catch (err) {
    logger.error('scp_prediction_accuracy: Error:', { jobName: 'scp_prediction_accuracy', error: String(err) });
  }
}

// ─── SCP v5: Compressed Brief — Monday 7:00 UTC ───────────────────────────────

async function scpCompressedBrief(): Promise<void> {
  logger.info('scp_compressed_brief starting', { jobName: 'scp_compressed_brief' });
  try {
    const { generateCompressedWeeklyBrief } = await import('../services/scp/briefing/compressed.js');
    const { query: dbQuery } = await import('../db/client.js');
    const products = await dbQuery(`SELECT id FROM products WHERE scp_status='active' LIMIT 100`);
    let generated = 0;
    for (const row of products.rows) {
      const productId = (row as Record<string, unknown>).id as string;
      try {
        await generateCompressedWeeklyBrief(productId);
        generated++;
      } catch { /* non-fatal per product */ }
    }
    logger.info(`scp_compressed_brief: Generated ${generated} compressed briefs`, { jobName: 'scp_compressed_brief' });
  } catch (err) {
    logger.error('scp_compressed_brief: Error:', { jobName: 'scp_compressed_brief', error: String(err) });
  }
}

// ─── SCP v5: Scenario Refresh — Monday 5:00 UTC ───────────────────────────────

async function scpScenarioRefresh(): Promise<void> {
  logger.info('scp_scenario_refresh starting', { jobName: 'scp_scenario_refresh' });
  try {
    const { generateScenariosForProduct } = await import('../services/scp/forecasting/runway.js');
    const { query: dbQuery } = await import('../db/client.js');
    const products = await dbQuery(
      `SELECT id FROM products WHERE scp_status='active' LIMIT 100`
    );
    let generated = 0;
    for (const row of products.rows) {
      const productId = (row as Record<string, unknown>).id as string;
      try {
        await generateScenariosForProduct(productId);
        generated++;
      } catch { /* non-fatal per product */ }
    }
    logger.info(`scp_scenario_refresh: Generated scenarios for ${generated} products`, { jobName: 'scp_scenario_refresh' });
  } catch (err) {
    logger.error('scp_scenario_refresh: Error:', { jobName: 'scp_scenario_refresh', error: String(err) });
  }
}

// ─── SCP v6: Debate, Failure Pattern Scan, Prompt Evolution ──────────────────

async function scpDebateRun(): Promise<void> {
  logger.info('scp_debate_run starting', { jobName: 'scp_debate_run' });
  try {
    const { query } = await import('../db/client.js');
    const rows = await query(`SELECT DISTINCT product_id FROM agent_instances WHERE status = 'active'`, []);
    const today = new Date().toISOString().slice(0, 10);
    let ran = 0;
    for (const row of rows.rows) {
      const productId = String((row as Record<string, unknown>)['product_id']);
      try {
        const { runDebateForProduct } = await import('../services/scp/debate/orchestrator.js');
        await runDebateForProduct(productId, today);
        ran++;
      } catch { /* non-fatal per product */ }
    }
    logger.info(`scp_debate_run: Ran debate for ${ran} products`, { jobName: 'scp_debate_run' });
  } catch (err) {
    logger.error('scp_debate_run: Error:', { jobName: 'scp_debate_run', error: String(err) });
  }
}

async function scpFailurePatternScan(): Promise<void> {
  logger.info('scp_failure_pattern_scan starting', { jobName: 'scp_failure_pattern_scan' });
  try {
    const { query } = await import('../db/client.js');
    const rows = await query(`SELECT DISTINCT product_id FROM agent_instances WHERE status = 'active'`, []);
    let scanned = 0;
    for (const row of rows.rows) {
      const productId = String((row as Record<string, unknown>)['product_id']);
      try {
        const { seedDefaultPatterns, scanForFailurePatterns } = await import('../services/network/failure-library.js');
        await seedDefaultPatterns();
        await scanForFailurePatterns(productId);
        scanned++;
      } catch { /* non-fatal */ }
    }
    logger.info(`scp_failure_pattern_scan: Scanned ${scanned} products`, { jobName: 'scp_failure_pattern_scan' });
  } catch (err) {
    logger.error('scp_failure_pattern_scan: Error:', { jobName: 'scp_failure_pattern_scan', error: String(err) });
  }
}

async function scpPromptEvolution(): Promise<void> {
  logger.info('scp_prompt_evolution starting', { jobName: 'scp_prompt_evolution' });
  try {
    const { query } = await import('../db/client.js');
    const rows = await query(`SELECT DISTINCT product_id FROM agent_instances WHERE status = 'active'`, []);
    let evolved = 0;
    for (const row of rows.rows) {
      const productId = String((row as Record<string, unknown>)['product_id']);
      try {
        const { generatePromptMutations, recordMutationOutcome } = await import('../services/scp/accuracy/prompt-evolver.js');
        await recordMutationOutcome(productId, '');  // update outcome stats for active mutations
        await generatePromptMutations(productId);
        evolved++;
      } catch { /* non-fatal */ }
    }
    logger.info(`scp_prompt_evolution: Processed ${evolved} products`, { jobName: 'scp_prompt_evolution' });
  } catch (err) {
    logger.error('scp_prompt_evolution: Error:', { jobName: 'scp_prompt_evolution', error: String(err) });
  }
}

async function scpExecutionPlaybookEval(): Promise<void> {
  logger.info('scp_playbook_eval starting', { jobName: 'scp_playbook_eval' });
  try {
    const { query } = await import('../db/client.js');
    const rows = await query(`SELECT DISTINCT product_id FROM agent_instances WHERE status = 'active'`, []);
    let triggered = 0;
    for (const row of rows.rows) {
      const productId = String((row as Record<string, unknown>)['product_id']);
      try {
        const { evaluatePlaybooksForProduct } = await import('../services/scp/playbooks/execution-engine.js');
        const result = await evaluatePlaybooksForProduct(productId);
        triggered += result.triggered;
      } catch { /* non-fatal */ }
    }
    logger.info(`scp_playbook_eval: Triggered ${triggered} playbook actions`, { jobName: 'scp_playbook_eval' });
  } catch (err) {
    logger.error('scp_playbook_eval: Error:', { jobName: 'scp_playbook_eval', error: String(err) });
  }
}

// ─── SCP v7: Signal Event Processing — Hourly ────────────────────────────────

async function scpSignalEvents(): Promise<void> {
  logger.info('scp_signal_events starting', { jobName: 'scp_signal_events' });
  try {
    const { query: dbQuery } = await import('../db/client.js');
    const { processPendingSignalEvents } = await import('../services/scp/events/dispatcher.js');
    const products = await dbQuery(`SELECT id FROM products WHERE scp_status = 'active' LIMIT 100`);
    let total = 0;
    for (const row of products.rows) {
      const productId = (row as Record<string, unknown>).id as string;
      try {
        const processed = await processPendingSignalEvents(productId);
        total += processed;
      } catch { /* non-fatal per product */ }
    }
    logger.info(`scp_signal_events: Processed ${total} signal events`, { jobName: 'scp_signal_events' });
  } catch (err) {
    logger.error('scp_signal_events: Error:', { jobName: 'scp_signal_events', error: String(err) });
  }
}

// ─── SCP v7: Monthly ROI Computation — 1st of month 8:00 UTC ─────────────────

async function scpROIMonthly(): Promise<void> {
  logger.info('scp_roi_monthly starting', { jobName: 'scp_roi_monthly' });
  try {
    const { query: dbQuery } = await import('../db/client.js');
    const { computeMonthlyROI } = await import('../services/scp/roi/calculator.js');
    const products = await dbQuery(`SELECT id FROM products WHERE scp_status = 'active' LIMIT 100`);
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let computed = 0;
    for (const row of products.rows) {
      const productId = (row as Record<string, unknown>).id as string;
      try {
        await computeMonthlyROI(productId, month);
        computed++;
      } catch { /* non-fatal per product */ }
    }
    logger.info(`scp_roi_monthly: Computed ROI for ${computed} products`, { jobName: 'scp_roi_monthly' });
  } catch (err) {
    logger.error('scp_roi_monthly: Error:', { jobName: 'scp_roi_monthly', error: String(err) });
  }
}

// ─── SCP v7: Founder State Assessment — Daily 7:00 UTC ───────────────────────

async function scpFounderStateAssessment(): Promise<void> {
  logger.info('scp_founder_state starting', { jobName: 'scp_founder_state' });
  try {
    const { query: dbQuery } = await import('../db/client.js');
    const { detectBehavioralSignals, assessFounderState } = await import('../services/scp/founder/decision-quality.js');
    const founders = await dbQuery(
      `SELECT DISTINCT f.id FROM founders f
       JOIN products p ON p.owner_id = f.id
       WHERE p.scp_status = 'active'
       LIMIT 100`
    );
    let assessed = 0;
    for (const row of founders.rows) {
      const founderId = (row as Record<string, unknown>).id as string;
      try {
        await detectBehavioralSignals(founderId);
        await assessFounderState(founderId);
        assessed++;
      } catch { /* non-fatal per founder */ }
    }
    logger.info(`scp_founder_state: Assessed ${assessed} founders`, { jobName: 'scp_founder_state' });
  } catch (err) {
    logger.error('scp_founder_state: Error:', { jobName: 'scp_founder_state', error: String(err) });
  }
}

// ─── SCP v7: Priority Queue Rebuild — Every 30 minutes ───────────────────────

async function scpPriorityRebuild(): Promise<void> {
  logger.info('scp_priority_rebuild starting', { jobName: 'scp_priority_rebuild' });
  try {
    const { query: dbQuery } = await import('../db/client.js');
    const { rebuildPriorityQueue } = await import('../services/scp/priority/ranker.js');
    const products = await dbQuery(`SELECT id FROM products WHERE scp_status = 'active' LIMIT 100`);
    let total = 0;
    for (const row of products.rows) {
      const productId = (row as Record<string, unknown>).id as string;
      try {
        const inserted = await rebuildPriorityQueue(productId);
        total += inserted;
      } catch { /* non-fatal per product */ }
    }
    logger.info(`scp_priority_rebuild: Rebuilt ${total} priority actions`, { jobName: 'scp_priority_rebuild' });
  } catch (err) {
    logger.error('scp_priority_rebuild: Error:', { jobName: 'scp_priority_rebuild', error: String(err) });
  }
}

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

// ─── 22. Geopolitical Scan — Sunday 8:00 UTC ─────────────────────────────────
export async function geopoliticalScan(): Promise<void> {
  logger.info('geopolitical_scan starting', { jobName: 'geopolitical_scan' });
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const signals = await scanGeopoliticalRisks(p.id, p.owner_id);
      if (signals.length > 0) {
        logger.info(`geopolitical_scan: ${p.name} — ${signals.length} signals detected`, { jobName: 'geopolitical_scan' });
      }
    } catch (err) {
      logger.error(`geopolitical_scan error for ${p.id}:`, { jobName: 'geopolitical_scan', error: String(err) });
    }
  }
  logger.info('geopolitical_scan complete', { jobName: 'geopolitical_scan' });
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

// ─── 28. Knowledge Graph Rebuild — Sunday 4:00 UTC ───────────────────────────
export async function graphRebuild(): Promise<void> {
  logger.info('graph_rebuild starting', { jobName: 'graph_rebuild' });
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const graph = await buildProductGraph(p.id);
      logger.info(`graph_rebuild: ${p.name} — ${graph.entities} entities, ${graph.relationships} relationships`, { jobName: 'graph_rebuild' });
      if (graph.entities > 5) {
        const chains = await discoverCausalChains(p.id);
        if (chains.length > 0) logger.info(`graph_rebuild: ${p.name} — ${chains.length} causal chains discovered`, { jobName: 'graph_rebuild' });
      }
    } catch (err) {
      logger.error(`graph_rebuild error for ${p.id}:`, { jobName: 'graph_rebuild', error: String(err) });
    }
  }
  logger.info('graph_rebuild complete', { jobName: 'graph_rebuild' });
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

// ─── 23. Regulatory Scan — Sunday 9:00 UTC ───────────────────────────────────
export async function regulatoryScan(): Promise<void> {
  logger.info('regulatory_scan starting', { jobName: 'regulatory_scan' });
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const changes = await scanRegulatoryChanges(p.id, p.owner_id);
      if (changes.length > 0) {
        logger.info(`regulatory_scan: ${p.name} — ${changes.length} changes detected`, { jobName: 'regulatory_scan' });
      }
    } catch (err) {
      logger.error(`regulatory_scan error for ${p.id}:`, { jobName: 'regulatory_scan', error: String(err) });
    }
  }
  logger.info('regulatory_scan complete', { jobName: 'regulatory_scan' });
}

// ─── V3.1 Layer A: Team Health Aggregate — Monday 5:30 UTC ───────────────────
// Computes Ambros's six metrics weekly per product. Reads from existing
// tables (decisions, agent_messages, agent_evolution_versions,
// agent_predictions); writes to team_health_metrics.

export async function teamHealthAggregate(): Promise<void> {
  const { computeAndStoreHealth } = await import('../services/discipline/team-health.js');
  const products = await getAllActiveProducts();
  const weekStart = mondayOfWeek(new Date());
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      await computeAndStoreHealth({ product_id: p.id, week_starting: weekStart });
    } catch (err) {
      logger.error(`team_health_aggregate error for ${p.id}:`, {
        jobName: 'team_health_aggregate',
        error: String(err),
      });
    }
  }
  logger.info('team_health_aggregate complete', { jobName: 'team_health_aggregate' });
}

// ─── V3.1 Layer A revisit: Outcome Tree Health — Monday 6:00 UTC ─────────────
// Pull latest metric_snapshots into branches' current_value where metric_key
// matches. Mark stale (>90d, no current_value) branches as superseded.
// LLM-driven tree generation is deferred.

export async function outcomeTreeHealth(): Promise<void> {
  const { refreshOutcomeTreeHealth } = await import(
    '../services/destination/outcome-tree-refresh.js'
  );
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const r = await refreshOutcomeTreeHealth(p.id);
      if (r.refreshed > 0 || r.superseded > 0) {
        logger.info(
          `outcome_tree_health ${p.id}: refreshed=${r.refreshed} superseded=${r.superseded} active=${r.total_active}`,
          { jobName: 'outcome_tree_health' }
        );
      }
    } catch (err) {
      logger.error(`outcome_tree_health error for ${p.id}:`, {
        jobName: 'outcome_tree_health',
        error: String(err),
      });
    }
  }
  logger.info('outcome_tree_health complete', { jobName: 'outcome_tree_health' });
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
        const { createNotification } = await import('../services/ux/notifications.js');
        await createNotification(
          p.owner_id, p.id, 'system',
          'A past decision now rests on a false premise',
          `${res.falsified} belief(s) behind decisions you made are now contradicted by your own metrics. Revisit them before they cost you.`,
          '/strategic-decisions', 'Review',
        );
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
export async function redTeamSweep(): Promise<void> {
  logger.info('red_team_sweep starting', { jobName: 'red_team_sweep' });
  const pending = await query(
    `SELECT d.id, d.product_id FROM decisions d
     WHERE d.status = 'pending' AND d.gate >= 3
       AND NOT EXISTS (SELECT 1 FROM red_team_reviews r WHERE r.decision_id = d.id)
     ORDER BY d.created_at ASC LIMIT 5`,
    [],
  );
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
        const { createNotification } = await import('../services/ux/notifications.js');
        await createNotification(
          p.owner_id, p.id, 'system',
          'A note about your week',
          pulse.message,
          '/dashboard', 'See the week',
        );
      }
    } catch (err) {
      logger.error(`founder_pulse_check error for ${p.id}`, { jobName: 'founder_pulse_check', error: String(err) });
    }
  }
  logger.info('founder_pulse_check complete', { jobName: 'founder_pulse_check' });
}

// ─── Network radar (Ascent B4 / Compounding Law) ──────────────────────────────
// Peer early-warning: one notification when a vital sits in the danger tail of
// the product's peer cell. The Letter carries the detail; this is just the tap
// on the shoulder. Abstains on thin cells (radar's own rule).
export async function networkRadarCheck(): Promise<void> {
  logger.info('network_radar starting', { jobName: 'network_radar' });
  const products = await getAllActiveProducts();
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const { scanForWarnings } = await import('../services/network/radar.js');
      const warnings = await scanForWarnings(p.id);
      if (warnings.length > 0) {
        const { createNotification } = await import('../services/ux/notifications.js');
        await createNotification(
          p.owner_id, p.id, 'system',
          `Peer radar: ${warnings.length} vital${warnings.length > 1 ? 's' : ''} in the danger tail`,
          warnings[0].message + (warnings.length > 1 ? ` (+${warnings.length - 1} more in The Letter)` : ''),
          '/letter', 'Read The Letter',
        );
      }
    } catch (err) {
      logger.error(`network_radar error for ${p.id}`, { jobName: 'network_radar', error: String(err) });
    }
  }
  logger.info('network_radar complete', { jobName: 'network_radar' });
}

// ─── Job Registry ─────────────────────────────────────────────────────────────

export const JOB_REGISTRY: Record<string, { fn: () => Promise<void>; schedule: string; description: string }> = {
  memory_premise_check: { fn: memoryPremiseCheck,   schedule: '0 7 * * *',       description: 'Re-check decision premises against live telemetry; flag expired beliefs (daily)' },
  red_team_sweep:       { fn: redTeamSweep,         schedule: '30 */2 * * *',    description: 'Adversarial pre-mortem for uncontested gate-3+ pending decisions (every 2h)' },
  founder_pulse_check:  { fn: founderPulseCheck,    schedule: '0 9 * * 5',       description: 'Founder strain check — kind, numbers-shown, only when overloaded (Friday 9:00 UTC)' },
  network_radar:        { fn: networkRadarCheck,    schedule: '15 7 * * *',      description: 'Peer early-warning radar — warns when a vital sits in the danger tail of ≥5 peers (daily)' },
  lifecycle_check:      { fn: lifecycleCheck,      schedule: '0 6 * * *',       description: 'Evaluate lifecycle conditions for all products' },
  competitive_scan:     { fn: competitiveScan,     schedule: '0 6 * * 0',       description: 'Scan competitors for all products (Sunday)' },
  weekly_synthesis:     { fn: weeklySynthesis,      schedule: '0 6 * * 5',       description: 'Weekly intelligence synthesis (Friday)' },
  digest_generate:      { fn: digestGenerate,       schedule: '0 7 * * 1',       description: 'Generate and send weekly digests (Monday)' },
  behavioral_triggers:  { fn: behavioralTriggers,   schedule: '0 */6 * * *',     description: 'Evaluate behavioral trigger emails (every 6h)' },
  metric_snapshot:      { fn: metricSnapshot,       schedule: '0 0 * * *',       description: 'Ensure daily metric snapshots exist' },
  data_retention:       { fn: dataRetention,        schedule: '30 3 * * *',      description: 'Purge operational log rows past the retention window (daily)' },
  slo_check:            { fn: sloCheck,             schedule: '15 * * * *',      description: 'Check SLOs (AI spend vs cap) and alert operator on breach (hourly)' },
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
  daily_insight_generate: { fn: dailyInsightGenerate,  schedule: '30 7 * * *',  description: 'Generate Daily One Thing for each product (daily 7:30 UTC)' },
  weekly_plan_generate:   { fn: weeklyPlanGenerate,    schedule: '0 8 * * 1',   description: 'Generate Weekly Operating Plan for each product (Monday 8:00 UTC)' },
  integration_sync:       { fn: integrationSync,       schedule: '0 */1 * * *', description: 'Sync all active external integrations (every hour)' },
  morning_briefings:      { fn: morningBriefings,      schedule: '30 6 * * *',  description: 'Pre-generate morning voice briefings (daily 6:30 UTC)' },
  alignment_scores:       { fn: alignmentScores,       schedule: '0 8 * * 1',   description: 'Compute co-founder alignment scores (Monday)' },
  network_contribution:   { fn: networkContribution,   schedule: '0 3 * * 0',   description: 'Contribute anonymized metrics to Intelligence Network (Sunday)' },
  prediction_accuracy:    { fn: predictionAccuracyJob, schedule: '0 11 * * *',  description: 'Compute prediction accuracy for recent decision outcomes (daily)' },
  // ─── SCP Jobs ─────────────────────────────────────────────────────────────
  scp_agent_runner:        { fn: scpAgentRunner,        schedule: '0 * * * *',    description: 'Run due agents for all active SCP companies (every hour)' },
  scp_daily_briefing:      { fn: scpDailyBriefing,      schedule: '30 5 * * *',   description: 'Generate CEO briefings for all SCP companies (daily 5:30 UTC)' },
  scp_evolution_cycle:     { fn: scpEvolutionCycle,     schedule: '0 4 * * *',    description: 'Run evolution synthesis for all SCP agents (daily 4:00 UTC)' },
  scp_lifecycle_transition:{ fn: scpLifecycleTransition,schedule: '0 6 * * *',    description: 'Evaluate company lifecycle state transitions (daily 6:00 UTC)' },
  scp_wisdom_synthesis:    { fn: scpWisdomSynthesis,    schedule: '0 3 * * 0',    description: 'Synthesize wisdom patterns for all active SCP products (Sunday 3:00 UTC)' },
  scp_intelligence_benchmarks: { fn: scpIntelligenceBenchmarks, schedule: '0 2 * * *', description: 'Recompute intelligence benchmarks across all products (daily 2:00 UTC)' },
  scp_remediation_sync:    { fn: scpRemediationSync,   schedule: '0 8 * * *',    description: 'Daily agent remediation sync and health logging (daily 8:00 UTC)' },
  scp_temporal_analysis:   { fn: scpTemporalAnalysis,  schedule: '0 5 * * 1',    description: 'Weekly temporal trend analysis for all SCP companies (Monday 5:00 UTC)' },
  scp_dna_nudge:           { fn: scpDNANudge,          schedule: '0 10 * * *',   description: 'Nudge early-lifecycle SCP founders to complete DNA context (daily 10:00 UTC)' },
  scp_cost_report:         { fn: scpCostReport,        schedule: '0 0 1 * *',    description: 'Monthly 30d AI cost rollup for all products (1st of month)' },
  // SCP v3: New capability layer jobs
  scp_lifecycle_rules:     { fn: scpLifecycleRules,    schedule: '0 */4 * * *',  description: 'Evaluate customer lifecycle rules for all SCP products (every 4h)' },
  scp_pl_update:           { fn: scpPLUpdate,          schedule: '0 1 * * *',    description: 'Update AI Company P&L attribution for all products (daily 1:00 UTC)' },
  scp_strategy_synthesis:  { fn: scpStrategySynthesis, schedule: '0 6 1 * *',    description: 'Generate monthly strategic synthesis for all products (1st of month)' },
  scp_integration_fabric_sync: { fn: scpIntegrationFabricSync, schedule: '0 * * * *', description: 'Sync PostHog and GitHub into integration fabric (every hour)' },
  scp_extended_integrations_sync: { fn: scpExtendedIntegrationsSync, schedule: '0 */2 * * *', description: 'Sync Sentry, Linear, Intercom, Slack integrations (every 2h)' },
  scp_prediction_accuracy: { fn: scpPredictionAccuracyCheck, schedule: '0 6 * * *', description: 'Measure pending agent predictions against actual outcomes (daily 6:00 UTC)' },
  scp_compressed_brief: { fn: scpCompressedBrief, schedule: '0 7 * * 1', description: 'Generate compressed weekly brief for all SCP products (Monday 7:00 UTC)' },
  scp_scenario_refresh: { fn: scpScenarioRefresh, schedule: '0 5 * * 1', description: 'Refresh Monte Carlo runway scenarios for all SCP products (Monday 5:00 UTC)' },
  scp_debate_run: { fn: scpDebateRun, schedule: '0 8 * * *', description: 'Run challenger/synthesizer debate pass after daily agent runs (daily 8:00 UTC)' },
  scp_failure_pattern_scan: { fn: scpFailurePatternScan, schedule: '0 9 * * *', description: 'Scan all products for failure pattern matches (daily 9:00 UTC)' },
  scp_prompt_evolution: { fn: scpPromptEvolution, schedule: '0 4 * * 0', description: 'Generate prompt mutation suggestions for underperforming agents (Sunday 4:00 UTC)' },
  scp_playbook_eval: { fn: scpExecutionPlaybookEval, schedule: '0 * * * *', description: 'Evaluate execution playbook conditions for all active products (hourly)' },
  scp_benchmark_refresh: { fn: scpBenchmarkRefresh, schedule: '0 3 * * 0', description: 'Refresh anonymous benchmark percentiles (Sunday 3:00 UTC)' },
  scp_decision_retrospectives: { fn: scpDecisionRetrospectives, schedule: '0 9 * * 1', description: 'Notify founders of decisions due for 90-day retrospective (Monday)' },
  scp_wellbeing_focus_cleanup: { fn: scpWellbeingFocusCleanup, schedule: '0 0 * * *', description: 'Clear expired focus areas and vacation modes (daily midnight)' },
  scp_webhook_delivery_cleanup: { fn: scpWebhookDeliveryCleanup, schedule: '0 4 * * 0', description: 'Clean up old webhook delivery records (Sunday 4:00 UTC)' },
  // SCP v7: Event bus, ROI, founder intelligence, priority queue
  scp_signal_events:       { fn: scpSignalEvents,           schedule: '0 * * * *',   description: 'Process pending signal events and dispatch to target agents (hourly)' },
  scp_roi_monthly:         { fn: scpROIMonthly,             schedule: '0 8 1 * *',   description: 'Compute monthly ROI summaries for all active products (1st of month 8:00 UTC)' },
  scp_founder_state:       { fn: scpFounderStateAssessment, schedule: '0 7 * * *',   description: 'Detect behavioral signals and assess founder state (daily 7:00 UTC)' },
  scp_priority_rebuild:    { fn: scpPriorityRebuild,        schedule: '*/30 * * * *', description: 'Rebuild priority action queue for One Thing banner (every 30 min)' },
  stage_detection:    { fn: stageDetection,    schedule: '30 5 * * *',  description: 'Auto-detect product growth stage (daily)' },
  founder_health_refresh: { fn: founderHealthRefresh, schedule: '30 6 * * *', description: 'Refresh founder health metrics (daily)' },
  geopolitical_scan: { fn: geopoliticalScan, schedule: '0 8 * * 0', description: 'Scan geopolitical risks (Sunday)' },
  regulatory_scan: { fn: regulatoryScan, schedule: '0 9 * * 0', description: 'Scan regulatory changes (Sunday)' },
  predictive_intelligence: { fn: predictiveIntelligence, schedule: '0 7 * * 3', description: 'Generate predictive insights (Wednesday)' },
  action_draft_generation: { fn: actionDraftGeneration, schedule: '30 7 * * *', description: 'Auto-generate action drafts for pending decisions (daily)' },
  customer_health_refresh: { fn: customerHealthRefresh, schedule: '0 3 * * *', description: 'Refresh all customer health scores (daily 3am)' },
  graph_rebuild: { fn: graphRebuild, schedule: '0 4 * * 0', description: 'Rebuild knowledge graph and discover causal chains (Sunday)' },
  portfolio_snapshots: { fn: portfolioSnapshotJob, schedule: '0 6 * * 1', description: 'Generate portfolio snapshots (Monday)' },
  data_deletion_processor: {
    fn: async () => {
      const { processScheduledDeletions } = await import('../services/privacy/consent.js');
      const deleted = await processScheduledDeletions();
      if (deleted > 0) logger.info(`Processed ${deleted} scheduled deletions`, { jobName: 'data_deletion_processor' });
    },
    schedule: '0 3 * * *', // Daily at 3:00 UTC
    description: 'Process scheduled data deletions (30-day delay)',
  },
  // V3.1 Layer A
  team_health_aggregate: {
    fn: teamHealthAggregate,
    schedule: '30 5 * * 1', // Monday 5:30 UTC
    description: 'Aggregate Ambros six metrics weekly per product',
  },
  // V3.1 Layer C
  idempotency_cleanup: {
    fn: idempotencyCleanup,
    schedule: '0 4 * * *', // Daily 4:00 UTC
    description: 'Delete expired outbound idempotency keys',
  },
  // V3.1 Layer A revisit
  outcome_tree_health: {
    fn: outcomeTreeHealth,
    schedule: '0 6 * * 1', // Monday 6:00 UTC
    description: 'Refresh outcome tree current_value from metrics; supersede stale branches',
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
  // Wave 2 / Council 16: Foundry's own customer onboarding sequence
  welcome_sequence_tick: {
    fn: async () => {
      const { runWelcomeSequenceTick } = await import(
        '../services/founder/welcome-sequence.js'
      );
      const counts = await runWelcomeSequenceTick();
      const total = counts.day_0 + counts.day_3 + counts.day_7;
      if (total > 0) {
        logger.info(
          `welcome_sequence_tick sent: day_0=${counts.day_0} day_3=${counts.day_3} day_7=${counts.day_7}`,
          { jobName: 'welcome_sequence_tick' }
        );
      }
    },
    schedule: '0 */6 * * *', // Every 6 hours; gateway idempotency dedups duplicate sends
    description: "Send Foundry's own day-0 / day-3 / day-7 founder onboarding emails",
  },
};
