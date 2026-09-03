// =============================================================================
// FOUNDRY — All 14 Scheduled Jobs
// Each job is a standalone async function callable by cron or CLI.
// =============================================================================

import { logger } from '../services/logger.js';
import { getAllActiveProducts, operatingProduct, realCompany, referenceCompany, query, getActiveStressors, getLatestMetrics, insertAuditLog, countGate0DecisionsWithOutcomes } from '../db/client.js';
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
      // A TEMPLATE LITERAL, BECAUSE IT WAS NOT ONE. This was written in double
      // quotes, so `${operatingProduct()}` reached SQLite as those literal
      // characters and every run of this job threw `unrecognized token: "$"`
      // before sending a single digest. Nothing caught it: the string scanners
      // in `scripts/` read template literals, so a query hidden in quotes is
      // invisible to all of them, and the failure is swallowed by the per-
      // founder try/catch below as one more logged error.
      // And `realCompany()`, which the original could not have had: a digest is
      // the owner reading his own companies, and a company that does not exist
      // has nothing to tell him.
      const products = await query(
        `SELECT id, name FROM products
          WHERE owner_id = ? AND ${operatingProduct()} AND ${realCompany()}`, [f.id]);
      for (const pRow of products.rows) {
        const p = pRow as Record<string, string>;
        const ls = await query('SELECT risk_state FROM lifecycle_state WHERE product_id = ?', [p.id]);
        const riskState = ((ls.rows[0] as Record<string, string>)?.risk_state as RiskStateValue) ?? 'green';

        let digestType: 'weekly' | 'yellow_pulse' | 'red_daily' = 'weekly';
        if (riskState === 'red') digestType = 'red_daily';
        else if (riskState === 'yellow' && new Date().getDay() === 4) digestType = 'yellow_pulse';

        const digest = await generateDigest(p.id, riskState, digestType);
        await sendDigestEmail(p.id, f.email as string, p.name, digest);
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

import { computeSignal } from '../services/signal.js';

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

      // NO ALERT ABOUT A COMPANY NOTHING IS KNOWN ABOUT. `computeSignal`
      // returns a default when there is no metric snapshot, and that default
      // used to be written into `signal_history` like any other score — so the
      // first day a company actually reported something, the real score landed
      // against a default baseline and the founder was told their Signal had
      // "dropped 30 points" from a number their company was never at.
      //
      // `signal.ts` no longer records the default, so any row read above is a
      // real measurement; this guard covers the other end.
      if (!signal.hasData) continue;

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

        // Through the policy. A Signal falling is worth acting on, and the
        // ceiling now costs the founder nothing: migration 182 records the
        // quieted event and the Letter reads it back.
        const { deliver } = await import('../services/ux/interruption.js');
        await deliver(p.owner_id, p.id, {
          importance: 'action_needed',
          title, body, actionUrl: '/dashboard', actionLabel: 'View Signal',
        }, await founderPrefs(p.owner_id) as never);
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

      const raw = await callOpus('You are Foundry, an intelligence layer for early-stage founders.', prompt, 400, p.id);
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

      const raw = await callOpus('You are Foundry. Generate a weekly operating plan for a founder.', prompt, 600, p.id);
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
  const products = await query(`SELECT id FROM products WHERE ${operatingProduct()}`);
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
  const products = await query(`SELECT id FROM products WHERE ${operatingProduct()}`);
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
     WHERE ${operatingProduct('p')}
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
    `SELECT id FROM products WHERE ${operatingProduct()} LIMIT 100`
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
    `SELECT id FROM products WHERE ${operatingProduct()} LIMIT 100`
  );
  const { getAICompanyPL } = await import('../services/financial/economics.js');
  for (const row of products.rows) {
    const productId = (row as Record<string, unknown>).id as string;
    const pl = await getAICompanyPL(productId, 30);
    // Update products table with latest AI cost trailing 30d
    await dbQuery(
      `UPDATE products SET ai_cost_trailing_30d_usd=?, attributed_revenue_trailing_30d_usd=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [pl.costs.total_usd, pl.attributed_revenue.total_usd, productId]
    );
  }
  logger.info(`scp_pl_update: Updated P&L for ${products.rows.length} products`, { jobName: 'scp_pl_update' });
}

// ─── SCP v3: Monthly Strategy Synthesis — 1st of month ───────────────────────

async function scpStrategySynthesis(): Promise<void> {
  logger.info('scp_strategy_synthesis starting', { jobName: 'scp_strategy_synthesis' });
  const { query: dbQuery } = await import('../db/client.js');
  const products = await dbQuery(
    `SELECT id FROM products WHERE ${operatingProduct()} AND company_lifecycle_state NOT IN ('setup') LIMIT 50`
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
    `SELECT id FROM products WHERE ${operatingProduct()} LIMIT 100`
  );
  const { syncPostHogEvents } = await import('../services/integration/posthog.js');
  const { syncGitHubEvents } = await import('../services/integration/github.js');

  // The same shape as the extended sync below: both of these return
  // `{ synced, error? }`, the `error` was never read, a throw was swallowed per
  // product, and neither wrote `integration_sync_log` — so the integrations
  // page said no sync had been attempted while this ran hourly.
  const { recordSyncAttempt } = await import('../services/integrations/health.js');
  const providers: Array<{ name: string; run: (p: string) => Promise<{ synced: number; error?: string }> }> = [
    { name: 'posthog', run: syncPostHogEvents },
    { name: 'github', run: syncGitHubEvents },
  ];

  const recorded = new Map<string, number>(providers.map((p) => [p.name, 0]));
  let failed = 0;

  for (const row of products.rows) {
    const productId = (row as Record<string, unknown>).id as string;
    for (const { name, run } of providers) {
      const startedAt = new Date().toISOString();
      try {
        const result = await run(productId);
        await recordSyncAttempt({
          productId, provider: name, startedAt,
          recordsProcessed: result.synced ?? 0, error: result.error ?? null,
        });
        if (result.error) {
          failed += 1;
          logger.error(`scp_integration_fabric_sync: ${name} failed for ${productId}: ${result.error}`,
            { jobName: 'scp_integration_fabric_sync' });
        } else {
          recorded.set(name, (recorded.get(name) ?? 0) + (result.synced ?? 0));
        }
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        await recordSyncAttempt({
          productId, provider: name, startedAt, recordsProcessed: 0, error: message,
        }).catch(() => { /* the throw above is the finding */ });
        logger.error(`scp_integration_fabric_sync: ${name} threw for ${productId}: ${message}`,
          { jobName: 'scp_integration_fabric_sync' });
      }
    }
  }

  // Summaries stored, not raw provider events: each run writes a handful of
  // trend rows.
  const line = `scp_integration_fabric_sync: PostHog ${recorded.get('posthog') ?? 0} summaries, `
    + `GitHub ${recorded.get('github') ?? 0} summaries, ${failed} provider sync(s) failed`;
  if (failed > 0) logger.error(line, { jobName: 'scp_integration_fabric_sync' });
  else logger.info(line, { jobName: 'scp_integration_fabric_sync' });
}

// ─── SCP v4: Extended Integrations Sync — Every 2h ───────────────────────────

async function scpExtendedIntegrationsSync(): Promise<void> {
  logger.info('scp_extended_integrations_sync starting', { jobName: 'scp_extended_integrations_sync' });
  const { query: dbQuery } = await import('../db/client.js');
  const products = await dbQuery(`SELECT id FROM products WHERE ${operatingProduct()} LIMIT 100`);

  // FIVE WAYS THIS LOST A FAILURE, and one number that could not tell "nothing
  // to sync" from "everything broken".
  //
  //  1. Each import was wrapped in `.catch(() => ({ syncXEvents: async () =>
  //     ({ synced: 0 }) }))`, so a module that could not be LOADED — a
  //     deployment fault — became a function reporting a clean zero.
  //  2. `allSettled` results were read as `r.status === 'fulfilled' ? synced :
  //     0`, so a sync that THREW contributed zero and was never mentioned.
  //  3. All six of these functions return `{ synced, error? }` and set
  //     `integrations.last_error` themselves. The `error` field was never read.
  //  4. A per-product `catch {}` swallowed whatever was left.
  //  5. Nothing was written to `integration_sync_log`, so the integrations
  //     page — which is careful and right — told the founder "No sync has been
  //     attempted in the last 7 days" about integrations Foundry had been
  //     syncing every two hours.
  //
  // The imports are hoisted out of the loop and no longer substituted: a module
  // that will not load should fail this job once, loudly, rather than a hundred
  // times silently. Each provider records its own attempt, so a failure reaches
  // the founder's page rather than only this log line.
  const [
    { syncSentryEvents },
    { syncLinearEvents },
    { syncIntercomEvents },
    { syncSlackEvents },
  ] = await Promise.all([
    import('../services/integration/sentry.js'),
    import('../services/integration/linear.js'),
    import('../services/integration/intercom.js'),
    import('../services/integration/slack.js'),
  ]);
  const { recordSyncAttempt } = await import('../services/integrations/health.js');

  const providers: Array<{ name: string; run: (p: string) => Promise<{ synced: number; error?: string }> }> = [
    { name: 'sentry', run: syncSentryEvents },
    { name: 'linear', run: syncLinearEvents },
    { name: 'intercom', run: syncIntercomEvents },
    { name: 'slack', run: syncSlackEvents },
  ];

  let recorded = 0;
  let failed = 0;
  for (const row of products.rows) {
    const productId = (row as Record<string, unknown>).id as string;
    await Promise.all(providers.map(async ({ name, run }) => {
      const startedAt = new Date().toISOString();
      try {
        const result = await run(productId);
        await recordSyncAttempt({
          productId, provider: name, startedAt,
          recordsProcessed: result.synced ?? 0, error: result.error ?? null,
        });
        if (result.error) {
          failed += 1;
          logger.error(`scp_extended_integrations_sync: ${name} failed for ${productId}: ${result.error}`,
            { jobName: 'scp_extended_integrations_sync' });
        } else {
          recorded += result.synced ?? 0;
        }
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        await recordSyncAttempt({
          productId, provider: name, startedAt, recordsProcessed: 0, error: message,
        }).catch(() => { /* the throw above is the finding; do not mask it with a second one */ });
        logger.error(`scp_extended_integrations_sync: ${name} threw for ${productId}: ${message}`,
          { jobName: 'scp_extended_integrations_sync' });
      }
    }));
  }
  // `recorded` counts summary rows the syncs wrote, not raw provider events —
  // each of these functions stores a handful of trend summaries per run.
  const line = `scp_extended_integrations_sync: recorded ${recorded} summaries across `
    + `${products.rows.length} products, ${failed} provider sync(s) failed`;
  if (failed > 0) logger.error(line, { jobName: 'scp_extended_integrations_sync' });
  else logger.info(line, { jobName: 'scp_extended_integrations_sync' });
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
         AND ${operatingProduct('p')}
       LIMIT 200`
    );

    // The band vocabulary lives with the pool that is keyed on it, so the
    // reader in `network/cohort-patterns.ts` cannot invent a second spelling.
    const { lifecycleBandForPrompt } = await import('../services/benchmarking/pool.js');

    for (const row of products.rows) {
      const r = row as Record<string, unknown>;
      const stage = lifecycleBandForPrompt(r.current_prompt as string | null);
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

    const products = await dbQuery(`SELECT id, owner_id, name FROM products WHERE ${operatingProduct()} LIMIT 100`);
    let notified = 0;

    for (const row of products.rows) {
      const p = row as Record<string, unknown>;
      const due = await getDecisionsDueForRetrospective(p.id as string);
      if (due.length === 0) continue;

      const { deliver } = await import('../services/ux/interruption.js');
      await deliver(p.owner_id as string, p.id as string, {
        // Rating past decisions improves future judgment; it is not urgent.
        importance: 'attention',
        title: `${due.length} decision${due.length > 1 ? 's' : ''} ready for retrospective`,
        body: `Review outcomes for: ${due.slice(0, 2).map(d => `"${d.decision_title}"`).join(', ')}${due.length > 2 ? ` +${due.length - 2} more` : ''}. Rate how each decision played out to improve future judgment.`,
        actionUrl: '/agents/decisions', actionLabel: 'Review decisions',
      }, await founderPrefs(p.owner_id as string) as never);
      notified++;
    }
    logger.info(`scp_decision_retrospectives: Notified ${notified} products`, { jobName: 'scp_decision_retrospectives' });
  } catch (err) {
    logger.error('scp_decision_retrospectives: Error:', { jobName: 'scp_decision_retrospectives', error: String(err) });
  }
}

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

async function scpPredictionAccuracyCheck(): Promise<void> {
  logger.info('scp_prediction_accuracy starting', { jobName: 'scp_prediction_accuracy' });
  try {
    const { measurePendingPredictions } = await import('../services/scp/accuracy/tracker.js');
    const { query: dbQuery } = await import('../db/client.js');
    const products = await dbQuery(`SELECT id FROM products WHERE ${operatingProduct()} LIMIT 100`);
    let totalMeasured = 0;
    let failed = 0;
    for (const row of products.rows) {
      const productId = (row as Record<string, unknown>).id as string;
      try {
        const result = await measurePendingPredictions(productId);
        totalMeasured += result.measured;
      } catch (err) {
        failed += 1;
        logSubjectFailure('scp_prediction_accuracy', productId, err);
      }
    }
    reportRun('scp_prediction_accuracy', `Measured ${totalMeasured} predictions`, failed);
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
    const products = await dbQuery(`SELECT id FROM products WHERE ${operatingProduct()} LIMIT 100`);
    let generated = 0;
    let failed = 0;
    for (const row of products.rows) {
      const productId = (row as Record<string, unknown>).id as string;
      try {
        await generateCompressedWeeklyBrief(productId);
        generated++;
      } catch (err) {
        failed += 1;
        logSubjectFailure('scp_compressed_brief', productId, err);
      }
    }
    reportRun('scp_compressed_brief', `Generated ${generated} compressed briefs`, failed);
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
      `SELECT id FROM products WHERE ${operatingProduct()} LIMIT 100`
    );
    let generated = 0;
    let awaitingPosition = 0;
    let failed = 0;
    for (const row of products.rows) {
      const productId = (row as Record<string, unknown>).id as string;
      try {
        // Null means the company has not stated its cash position, which is a
        // normal state and not a failure — counted apart so the log does not
        // read as though every company were being modelled.
        if (await generateScenariosForProduct(productId) === null) awaitingPosition++;
        else generated++;
      } catch (err) {
        failed += 1;
        logSubjectFailure('scp_scenario_refresh', productId, err);
      }
    }
    reportRun('scp_scenario_refresh',
      `Generated scenarios for ${generated} products, `
      + `${awaitingPosition} awaiting a stated cash position`, failed);
  } catch (err) {
    logger.error('scp_scenario_refresh: Error:', { jobName: 'scp_scenario_refresh', error: String(err) });
  }
}

// ─── SCP v6: Debate, Failure Pattern Scan, Prompt Evolution ──────────────────

async function scpDebateRun(): Promise<void> {
  logger.info('scp_debate_run starting', { jobName: 'scp_debate_run' });
  try {
    const { query } = await import('../db/client.js');
    const rows = await query(
      `SELECT DISTINCT ai.product_id FROM agent_instances ai
         JOIN products p ON p.id = ai.product_id
        WHERE ai.status = 'active' AND ${operatingProduct('p')}`, []);
    const today = new Date().toISOString().slice(0, 10);
    let ran = 0;
    let failed = 0;
    for (const row of rows.rows) {
      const productId = String((row as Record<string, unknown>)['product_id']);
      try {
        const { runDebateForProduct } = await import('../services/scp/debate/orchestrator.js');
        await runDebateForProduct(productId, today);
        ran++;
      } catch (err) {
        failed += 1;
        logSubjectFailure('scp_debate_run', productId, err);
      }
    }
    reportRun('scp_debate_run', `Ran debate for ${ran} products`, failed);
  } catch (err) {
    logger.error('scp_debate_run: Error:', { jobName: 'scp_debate_run', error: String(err) });
  }
}

async function scpFailurePatternScan(): Promise<void> {
  logger.info('scp_failure_pattern_scan starting', { jobName: 'scp_failure_pattern_scan' });
  try {
    const { query } = await import('../db/client.js');
    const rows = await query(
      `SELECT DISTINCT ai.product_id FROM agent_instances ai
         JOIN products p ON p.id = ai.product_id
        WHERE ai.status = 'active' AND ${operatingProduct('p')}`, []);
    let scanned = 0;
    let failed = 0;
    for (const row of rows.rows) {
      const productId = String((row as Record<string, unknown>)['product_id']);
      try {
        const { seedDefaultPatterns, scanForFailurePatterns } = await import('../services/network/failure-library.js');
        await seedDefaultPatterns();
        await scanForFailurePatterns(productId);
        scanned++;
      } catch (err) {
        failed += 1;
        logSubjectFailure('scp_failure_pattern_scan', productId, err);
      }
    }
    reportRun('scp_failure_pattern_scan', `Scanned ${scanned} products`, failed);
  } catch (err) {
    logger.error('scp_failure_pattern_scan: Error:', { jobName: 'scp_failure_pattern_scan', error: String(err) });
  }
}

async function scpPromptEvolution(): Promise<void> {
  logger.info('scp_prompt_evolution starting', { jobName: 'scp_prompt_evolution' });
  try {
    const { query } = await import('../db/client.js');
    const rows = await query(
      `SELECT DISTINCT ai.product_id FROM agent_instances ai
         JOIN products p ON p.id = ai.product_id
        WHERE ai.status = 'active' AND ${operatingProduct('p')}`, []);
    let evolved = 0;
    let failed = 0;
    for (const row of rows.rows) {
      const productId = String((row as Record<string, unknown>)['product_id']);
      try {
        const { generatePromptMutations, recordMutationOutcome } = await import('../services/scp/accuracy/prompt-evolver.js');
        await recordMutationOutcome(productId, '');  // update outcome stats for active mutations
        await generatePromptMutations(productId);
        evolved++;
      } catch (err) {
        failed += 1;
        logSubjectFailure('scp_prompt_evolution', productId, err);
      }
    }
    reportRun('scp_prompt_evolution', `Processed ${evolved} products`, failed);
  } catch (err) {
    logger.error('scp_prompt_evolution: Error:', { jobName: 'scp_prompt_evolution', error: String(err) });
  }
}

async function scpExecutionPlaybookEval(): Promise<void> {
  logger.info('scp_playbook_eval starting', { jobName: 'scp_playbook_eval' });
  try {
    const { query } = await import('../db/client.js');
    const rows = await query(
      `SELECT DISTINCT ai.product_id FROM agent_instances ai
         JOIN products p ON p.id = ai.product_id
        WHERE ai.status = 'active' AND ${operatingProduct('p')}`, []);
    let triggered = 0;
    let failed = 0;
    for (const row of rows.rows) {
      const productId = String((row as Record<string, unknown>)['product_id']);
      try {
        const { evaluatePlaybooksForProduct } = await import('../services/scp/playbooks/execution-engine.js');
        const result = await evaluatePlaybooksForProduct(productId);
        triggered += result.triggered;
      } catch (err) {
        failed += 1;
        logSubjectFailure('scp_playbook_eval', productId, err);
      }
    }
    reportRun('scp_playbook_eval', `Triggered ${triggered} playbook actions`, failed);
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
    const products = await dbQuery(`SELECT id FROM products WHERE ${operatingProduct()} LIMIT 100`);
    let total = 0;
    let failed = 0;
    for (const row of products.rows) {
      const productId = (row as Record<string, unknown>).id as string;
      try {
        const processed = await processPendingSignalEvents(productId);
        total += processed;
      } catch (err) {
        failed += 1;
        logSubjectFailure('scp_signal_events', productId, err);
      }
    }
    reportRun('scp_signal_events', `Processed ${total} signal events`, failed);
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
    const products = await dbQuery(`SELECT id FROM products WHERE ${operatingProduct()} LIMIT 100`);
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let computed = 0;
    let failed = 0;
    for (const row of products.rows) {
      const productId = (row as Record<string, unknown>).id as string;
      try {
        await computeMonthlyROI(productId, month);
        computed++;
      } catch (err) {
        failed += 1;
        logSubjectFailure('scp_roi_monthly', productId, err);
      }
    }
    reportRun('scp_roi_monthly', `Computed ROI for ${computed} products`, failed);
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
       WHERE ${operatingProduct('p')}
       LIMIT 100`
    );
    let assessed = 0;
    let failed = 0;
    for (const row of founders.rows) {
      const founderId = (row as Record<string, unknown>).id as string;
      try {
        await detectBehavioralSignals(founderId);
        await assessFounderState(founderId);
        assessed++;
      } catch (err) {
        failed += 1;
        logSubjectFailure('scp_founder_state', founderId, err);
      }
    }
    reportRun('scp_founder_state', `Assessed ${assessed} founders`, failed);
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
    const products = await dbQuery(`SELECT id FROM products WHERE ${operatingProduct()} LIMIT 100`);
    let total = 0;
    let failed = 0;
    for (const row of products.rows) {
      const productId = (row as Record<string, unknown>).id as string;
      try {
        const inserted = await rebuildPriorityQueue(productId);
        total += inserted;
      } catch (err) {
        failed += 1;
        logSubjectFailure('scp_priority_rebuild', productId, err);
      }
    }
    reportRun('scp_priority_rebuild', `Rebuilt ${total} priority actions`, failed);
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
          actionUrl: '/dashboard', actionLabel: 'See the week',
        }, await founderPrefs(p.owner_id) as never);
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
        // THROUGH THE INTERRUPTION POLICY, because the Letter carries this fact
        // itself — `letter/composer.ts` calls `scanForWarnings` too. That is the
        // condition which makes quieting safe: a founder whose ceiling is
        // `letter` loses the bell and still reads the warning, which is exactly
        // what they asked for. The bell used to ignore their ceiling entirely.
        const { deliver } = await import('../services/ux/interruption.js');
        await deliver(p.owner_id, p.id, {
          // A peer signal in the danger tail is worth reading, not worth a
          // phone buzzing: the Letter is where it belongs and where it already
          // is.
          importance: 'attention',
          title: `Peer radar: ${warnings.length} vital${warnings.length > 1 ? 's' : ''} in the danger tail`,
          body: warnings[0].message + (warnings.length > 1 ? ` (+${warnings.length - 1} more in The Letter)` : ''),
          actionUrl: '/letter', actionLabel: 'Read The Letter',
        }, await founderPrefs(p.owner_id) as never);
      }
    } catch (err) {
      logger.error(`network_radar error for ${p.id}`, { jobName: 'network_radar', error: String(err) });
    }
  }
  logger.info('network_radar complete', { jobName: 'network_radar' });
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

// ─── Customer Success sweep (Hands Law layer 3 — the first department) ─────────
// One save per at-risk customer, drafted from their real account state.
// Trust-ladder governed: shadow records, suggest queues for approval, act sends.
export async function customerSuccessSweep(): Promise<void> {
  logger.info('customer_success_sweep starting', { jobName: 'customer_success_sweep' });
  const products = await getAllActiveProducts();
  let proposed = 0, sent = 0;
  for (const row of products.rows) {
    const p = row as Record<string, string>;
    try {
      const { runSuccessSweep } = await import('../services/departments/success.js');
      const res = await runSuccessSweep(p.id);
      proposed += res.proposed;
      sent += res.sent;
      if (res.proposed > 0) {
        const { deliver } = await import('../services/ux/interruption.js');
        // Drafts sit in the queue until approved; nothing reaches a customer
        // while the founder is not looking. Action needed, not urgent.
        await deliver(p.owner_id, p.id, {
          importance: 'action_needed',
          title: 'Check-in drafts waiting for your approval',
          body: `${res.proposed} at-risk customer(s) have a check-in drafted from their real account state. Approve or discard in the action queue.`,
          actionUrl: '/agents/actions', actionLabel: 'Review drafts',
        }, await founderPrefs(p.owner_id) as never);
      }
    } catch (err) {
      logger.error(`customer_success_sweep error for ${p.id}`, { jobName: 'customer_success_sweep', error: String(err) });
    }
  }
  logger.info(`customer_success_sweep complete — ${proposed} proposed, ${sent} sent`, { jobName: 'customer_success_sweep' });
}

// ─── Marketing / Product Evolution / Outreach sweeps (Hands Law departments) ───
// Same shape as customer_success_sweep: per-product, trust-ladder governed,
// envelope-bounded, errors isolated per product.
function departmentSweepJob(
  jobName: string,
  run: (productId: string) => Promise<{ proposed: number }>,
): () => Promise<void> {
  return async () => {
    logger.info(`${jobName} starting`, { jobName });
    const products = await getAllActiveProducts();
    let proposed = 0;
    for (const row of products.rows) {
      const p = row as Record<string, string>;
      try {
        proposed += (await run(p.id)).proposed;
      } catch (err) {
        logger.error(`${jobName} error for ${p.id}`, { jobName, error: String(err) });
      }
    }
    logger.info(`${jobName} complete — ${proposed} proposed`, { jobName });
  };
}

export const marketingSweep = departmentSweepJob('marketing_sweep', async (id) => {
  const { runMarketingSweep } = await import('../services/departments/marketing.js');
  return runMarketingSweep(id);
});
export const productEvolutionSweep = departmentSweepJob('product_evolution_sweep', async (id) => {
  const { runProductSweep } = await import('../services/departments/product.js');
  return runProductSweep(id);
});
export const outreachSweep = departmentSweepJob('outreach_sweep', async (id) => {
  const { runOutreachSweep } = await import('../services/departments/outreach.js');
  return runOutreachSweep(id);
});

// ─── Fleet Letter (Jarvis slice 1) ──────────────────────────────────────────
// One artifact per founder across their whole fleet: compose → independently
// VERIFY → deliver through the interruption policy (quietest sufficient
// channel; strain quiets non-critical noise; the founder's ceiling wins).
export async function fleetLetterNotify(): Promise<void> {
  logger.info('fleet_letter_notify starting', { jobName: 'fleet_letter_notify' });
  const founders = await query(
    `SELECT DISTINCT p.owner_id, f.preferences
       FROM products p JOIN founders f ON f.id = p.owner_id
      WHERE p.status != 'archived'`, [],
  );
  let delivered = 0;
  for (const row of founders.rows as unknown as Array<Record<string, string>>) {
    const founderId = row.owner_id;
    try {
      const { composeFleetLetter } = await import('../services/letter/fleet.js');
      const { verifyFleetLetter } = await import('../services/letter/verifier.js');
      const { deliver } = await import('../services/ux/interruption.js');

      let prefs: Record<string, unknown> | null = null;
      try { prefs = row.preferences ? JSON.parse(row.preferences) : null; } catch { /* unset */ }
      const fluency = (prefs?.fluency as 'plain' | 'balanced' | 'technical') ?? 'balanced';

      const { letter } = await verifyFleetLetter(await composeFleetLetter(founderId, fluency));
      if (letter.quiet) continue; // silence is the success state (Attention Law)

      const top = letter.needsYou[0];
      const anchorProduct = top?.productId ?? letter.products[0]?.productId;
      if (!anchorProduct) continue;

      const result = await deliver(founderId, anchorProduct, {
        // A responsibility has no gate, and a passed date the COMPANY gave is
        // not "attention" — it is the one ask that is already late. Gate 3+
        // decisions and overdue responsibilities are both action_needed; the
        // rest is attention.
        importance: top
          ? ((top.kind === 'decision' ? top.gate >= 3
            : top.kind === 'responsibility' ? top.because === 'overdue'
              : top.evaluationState === 'contradicted')
            ? 'action_needed' : 'attention')
          : 'info',
        title: top ? `Your letter: ${top.what} needs you` : 'Your letter is ready',
        body: top
          // `needsYou` is capped at MAX_NEEDS_YOU for the page, so this read
          // `Top of 5` whatever the real number of asks was — a count of the
          // cap, printed as a count of the fleet.
          ? `Top of ${letter.needsYouTotal} across ${letter.products.length} companies: ${top.what} (${top.productName}).`
          : `What ran across your ${letter.products.length} companies while you were away.`,
        actionUrl: '/letter',
        actionLabel: 'Read the letter',
      }, prefs as never);
      if (result.delivered) delivered++;
    } catch (err) {
      logger.error(`fleet_letter_notify error for ${founderId}`, { jobName: 'fleet_letter_notify', error: String(err) });
    }
  }
  logger.info(`fleet_letter_notify complete — ${delivered} delivered`, { jobName: 'fleet_letter_notify' });
}

// ─── Action verification sweep (Jarvis axis 1 — verified action) ──────────────
export async function actionVerifySweep(): Promise<void> {
  logger.info('action_verify_sweep starting', { jobName: 'action_verify_sweep' });
  try {
    const { verifyDueActions } = await import('../services/outbound/action-verifier.js');
    const res = await verifyDueActions();
    logger.info(`action_verify_sweep complete — ${res.checked} checked, ${res.passed} passed, ${res.failed} failed`, { jobName: 'action_verify_sweep' });
  } catch (err) {
    logger.error('action_verify_sweep error', { jobName: 'action_verify_sweep', error: String(err) });
  }
}

// ─── Job Registry ─────────────────────────────────────────────────────────────

/** Words that make a claim a sentence rather than a search. */
const STOP = new Set(['that', 'this', 'with', 'from', 'would', 'will', 'have', 'they',
  'them', 'there', 'their', 'been', 'because', 'about', 'into', 'than', 'then', 'when',
  'what', 'which', 'while', 'also', 'more', 'most', 'some', 'such', 'only', 'other',
  'nobody', 'anybody', 'somebody', 'space', 'itself']);

export const JOB_REGISTRY: Record<string, { fn: () => Promise<void>; schedule: string; description: string }> = {
  memory_premise_check: { fn: memoryPremiseCheck,   schedule: '0 7 * * *',       description: 'Re-check decision premises against live telemetry; flag expired beliefs (daily)' },
  red_team_sweep:       { fn: redTeamSweep,         schedule: '30 */2 * * *',    description: 'Adversarial pre-mortem for uncontested gate-3+ pending decisions (every 2h)' },
  founder_pulse_check:  { fn: founderPulseCheck,    schedule: '0 9 * * 5',       description: 'Founder strain check — kind, numbers-shown, only when overloaded (Friday 9:00 UTC)' },
  network_radar:        { fn: networkRadarCheck,    schedule: '15 7 * * *',      description: 'Peer early-warning radar — warns when a vital sits in the danger tail of ≥5 peers (daily)' },
  autopilot_tick:       { fn: autopilotTick,        schedule: '45 */4 * * *',    description: 'Second Self: bank real outcomes into the trust ladder, then act on eligible gate-≤1 decisions in founder-granted categories (every 4h)' },
  customer_success_sweep: { fn: customerSuccessSweep, schedule: '15 8 * * *',    description: 'Customer Success department: one check-in per at-risk customer, drafted from real account state; trust-ladder governed, envelope-bounded (daily)' },
  marketing_sweep:      { fn: marketingSweep,       schedule: '0 9 * * 1',       description: 'Marketing department: one campaign proposal per cycle, carried by a graced signups_7d premise that falsifies honestly (Monday)' },
  product_evolution_sweep: { fn: productEvolutionSweep, schedule: '30 9 * * 2',  description: 'Product Evolution department: one gate-3 hypothesis citing the thesis, auto-contested by the Red Team, carried by a graced metric premise (Tuesday)' },
  outreach_sweep:       { fn: outreachSweep,        schedule: '0 10 * * 3',      description: 'Outreach department (referral engine v1): asks champions for intros; suppression-listed, never auto-sends (Wednesday)' },
  fleet_letter_notify:  { fn: fleetLetterNotify,    schedule: '30 7 * * *',      description: 'One verified letter per founder across their fleet; delivered via the interruption policy — quietest sufficient channel, strain-aware (daily)' },
  action_verify_sweep:  { fn: actionVerifySweep,    schedule: '20 */6 * * *',    description: 'Independent verification of act-tier executions against their pre-declared success criteria; failures log defects and demote the acting category (every 6h)' },
  lifecycle_check:      { fn: lifecycleCheck,      schedule: '0 6 * * *',       description: 'Evaluate lifecycle conditions for all products' },
  competitive_scan:     { fn: competitiveScan,     schedule: '0 6 * * 0',       description: 'Scan competitors for all products (Sunday)' },
  weekly_synthesis:     { fn: weeklySynthesis,      schedule: '0 6 * * 5',       description: 'Weekly intelligence synthesis (Friday)' },
  digest_generate:      { fn: digestGenerate,       schedule: '0 7 * * 1',       description: 'Generate and send weekly digests (Monday)' },
  behavioral_triggers:  { fn: behavioralTriggers,   schedule: '0 */6 * * *',     description: 'Evaluate behavioral trigger emails (every 6h)' },
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
  scp_expire_overdue_decisions: { fn: scpExpireOverdueDecisions, schedule: '5 0 * * *', description: 'Mark pending decisions past their deadline as expired (daily)' },
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
      const { renewCredentials, probeCredential } = await import(
        '../services/senses/credentials.js');
      const outcome = await renewCredentials();
      for (const broken of outcome.broke) {
        logger.error(
          `a sense went blind: ${broken.provider} for ${broken.productId} — ${broken.why}`,
          { jobName: 'sense_credential_tick', productId: broken.productId });
      }

      // AND THE ONES THAT DID NOT NEED RENEWING. A credential with no expiry is
      // exactly the kind that can be revoked elsewhere without anything here
      // noticing, so it is asked rather than assumed to be alive.
      const live = await query(
        `SELECT s.id, s.product_id, s.provider FROM company_senses s
           JOIN sense_credentials c ON c.company_sense_id = s.id AND c.revoked_at IS NULL
          WHERE s.disconnected_at IS NULL AND c.expires_at IS NULL
          ORDER BY s.rowid`, []);
      let dark = 0;
      for (const row of live.rows as unknown as Array<Record<string, unknown>>) {
        const senseId = String(row.id);
        try {
          const result = await probeCredential(senseId);
          if (result && !result.ok) {
            dark += 1;
            const { noteSenseObserved } = await import('../services/senses/index.js');
            await noteSenseObserved(String(row.product_id), String(row.provider),
              result.detail);
          }
        } catch (err) {
          logger.error(
            `probing a sense failed for ${String(row.product_id)}: `
            + `${err instanceof Error ? err.message : String(err)}`,
            { jobName: 'sense_credential_tick' });
        }
      }
      logger.info(
        `sense_credential_tick: renewed=${String(outcome.renewed)} `
        + `nothing_to_do=${String(outcome.nothingToDo)} failed=${String(outcome.failed)} `
        + `gone_dark=${String(dark)}`,
        { jobName: 'sense_credential_tick' });
    },
    schedule: '25 * * * *', // Hourly, off the hour so it does not collide
    description:
      'Renew sense credentials near expiry and probe the ones that do not expire, so a '
      + 'connection that has gone dark is said out loud before anything derived from it '
      + 'is shown (hourly)',
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
      const { checkOwnDependencies, verifyRealEvidenceLanded } = await import(
        '../services/institution/dependency-health.js');
      const { recordMaturity, capability } = await import(
        '../services/institution/capabilities.js');

      let health;
      try {
        health = await checkOwnDependencies({ founderId });
      } catch (err) {
        logger.error(
          `dependency_health_tick could not reach the registry: `
          + `${err instanceof Error ? err.message : String(err)}`,
          { jobName: 'dependency_health_tick' });
        return;
      }
      if (!health) {
        logger.info('dependency_health_tick: nothing to check',
          { jobName: 'dependency_health_tick' });
        return;
      }
      logger.info(`dependency_health_tick: ${health.sentence}`,
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

      // AND ONLY THEN, THE RESULT ITSELF, CHECKED.
      const verified = await verifyRealEvidenceLanded(health.claimId);
      if (!verified.ok) {
        logger.error(`dependency_health_tick: the read left no usable evidence — `
          + verified.because, { jobName: 'dependency_health_tick' });
        return;
      }
      const now = (await capability('read_package_registry'))?.providers
        .find((p) => p.provider === 'npm_registry');
      if (now && now.maturity === 'available') {
        await recordMaturity({
          providerId: now.id, to: 'reality_proven', evidenceMode: 'real',
          witnessedBy: 'dependency_health_tick',
          evidence: `performed its intended work on a real claim about Foundry's own `
            + `dependencies and the result was checked: ${verified.because}`,
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
  venture_discovery_tick: {
    fn: async () => {
      const { discover, weedOut } = await import('../services/venture/discovery.js');
      const mandates = await query(
        `SELECT id, founder_id, evidence_mode FROM venture_mandates
          WHERE closed_at IS NULL ORDER BY opened_at`, []);
      let sown = 0;
      let buried = 0;
      for (const row of mandates.rows as unknown as Array<Record<string, unknown>>) {
        const founderId = String(row.founder_id);
        const world = String(row.evidence_mode) === 'reference' ? 'reference' : 'real';
        try {
          const found = await discover({
            founderId, mandateId: String(row.id), world });
          sown += found.sown.length;
          for (const passed of found.passedOver.slice(0, 3)) {
            logger.info(`venture_discovery_tick passed over ${passed.what}: ${passed.because}`,
              { jobName: 'venture_discovery_tick' });
          }
          // The ruthless half, immediately, so the frontier never accumulates.
          const weeded = await weedOut({ founderId, world });
          buried += weeded.buried.length;
        } catch (err) {
          logger.error(
            `venture_discovery_tick failed for ${String(row.id)}: `
            + `${err instanceof Error ? err.message : String(err)}`,
            { jobName: 'venture_discovery_tick' });
        }
      }
      logger.info(
        `venture_discovery_tick: seeds sown=${String(sown)}, buried=${String(buried)}`,
        { jobName: 'venture_discovery_tick' });
    },
    schedule: '0 6 * * *',
    description:
      'Turn what the portfolio needs into a search through real sources, sow a few seeds '
      + 'from what people actually wrote, and bury most of them against a different way '
      + 'of knowing (daily)',
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
            logger.error(
              `real_market_evidence_tick failed for claim ${String(c.id)}: `
              + `${err instanceof Error ? err.message : String(err)}`,
              { jobName: 'real_market_evidence_tick' });
          }
        }
      }
      logger.info(`real_market_evidence_tick: claims looked at=${String(looked)}`,
        { jobName: 'real_market_evidence_tick' });
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
  // Entitlement to ACT, swept into line with billing (owner decision).
  //
  // Cancelling a subscription already stopped Foundry acting. A founder who
  // never subscribed, or whose trial expired without converting, looked exactly
  // like a paying customer to every capability gate — so the agents kept
  // running and the AI spend kept accruing on an account that would never pay.
  //
  // This writes the SAME `scp_status='paused'` that `customer.subscription
  // .deleted` writes, so every check that already honours a cancellation
  // honours a lapsed trial too, rather than adding a second thing to keep in
  // agreement. It resumes as well as pauses: one-way enforcement leaves a
  // founder who subscribes after a lapse stuck read-only until somebody
  // notices, which is a worse product than not enforcing at all.
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
  entitlement_sweep: {
    fn: async () => {
      const { sweepEntitlements, sendTrialEndingNotices } = await import(
        '../services/billing/entitlement.js');
      // Warn BEFORE pausing, in that order and in the same tick: a founder
      // whose trial ends within the hour should get the warning rather than
      // only the obituary.
      const warned = await sendTrialEndingNotices();
      const { paused, resumed } = await sweepEntitlements();
      if (paused.length || resumed.length || warned.length) {
        logger.info(
          `entitlement_sweep: paused=${paused.length} resumed=${resumed.length} warned=${warned.length}`,
          { jobName: 'entitlement_sweep' });
      }
    },
    schedule: '25 * * * *', // Hourly
    description: 'Pause acting for products whose owner has no paid tier and no live trial; resume when they do',
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
