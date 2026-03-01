// =============================================================================
// FOUNDRY — Guided Onboarding Tour
// 5-step walkthrough using real audit data after the first audit.
// =============================================================================

import { query } from '../../db/client.js';
import type { OnboardingTour } from '../../types/index.js';

export interface TourStep {
  step: number;
  target_selector: string;
  headline: string;
  body_template: string;
  score_interpretations?: Record<string, string>;
}

export const TOUR_STEPS: TourStep[] = [
  {
    step: 1,
    target_selector: '.composite-score',
    headline: 'Your Audit Score',
    body_template: 'Your composite score is {score}/10. {score_interpretation} This is your baseline — every subsequent audit measures improvement from here.',
    score_interpretations: {
      low: 'Below 4 indicates foundational infrastructure gaps. This is common and fixable — it means Foundry has a lot to work with.',
      mid: 'In the 4–6 range, your product has functional core but gaps in operational readiness and commercial integrity. Remediation will move this quickly.',
      high: 'Above 6 means you\'re approaching market-ready territory. A few targeted fixes and you cross the READY threshold.',
      ready: 'Above 7 is the READY threshold. Every dimension is market-credible. You can acquire and charge users without technical trust problems.',
    },
  },
  {
    step: 2,
    target_selector: '.blocking-list',
    headline: 'Blocking Issues',
    body_template: '{count_text} They are ordered by dependency — BLOCK-001 before BLOCK-002. {remediation_text}',
  },
  {
    step: 3,
    target_selector: '.risk-state-card',
    headline: 'Your Risk State',
    body_template: 'The {state} badge is your operational health signal. It updates automatically as your metrics and intelligence layers evolve. Green means autonomous operation. Yellow means heightened monitoring. Red means recovery protocol.',
  },
  {
    step: 4,
    target_selector: '.decision-card, .empty-state',
    headline: 'Decision Queue',
    body_template: '{decision_text} Gate 3 decisions come with scenario models — best, base, and stress cases — so you\'re deciding with context, not instinct.',
  },
  {
    step: 5,
    target_selector: '.lifecycle-bar',
    headline: 'Your Weekly Rhythm',
    body_template: 'Foundry runs automatically on a weekly cycle. Friday: synthesis and stressor identification. Sunday: competitive scan. Monday: your digest. Your job is to review decisions, merge PRs, and fill in context as your product evolves. The lifecycle bar tracks your position in the methodology.',
  },
];

/**
 * Get the current tour state for a founder.
 */
export async function getTourState(founderId: string): Promise<OnboardingTour | null> {
  const result = await query('SELECT * FROM onboarding_tour WHERE founder_id = ?', [founderId]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as Record<string, unknown>;
  return {
    founder_id: row.founder_id as string,
    started_at: row.started_at as string,
    current_step: row.current_step as number,
    completed_steps: JSON.parse((row.completed_steps as string) || '[]') as number[],
    completed_at: row.completed_at as string | null,
    skipped_at: row.skipped_at as string | null,
    product_id: row.product_id as string,
  };
}

/**
 * Start the tour for a founder.
 */
export async function startTour(founderId: string, productId: string): Promise<void> {
  await query(
    `INSERT INTO onboarding_tour (founder_id, product_id, current_step, completed_steps)
     VALUES (?, ?, 1, '[]')
     ON CONFLICT (founder_id) DO UPDATE SET current_step = 1, completed_steps = '[]', started_at = CURRENT_TIMESTAMP, completed_at = NULL, skipped_at = NULL, product_id = ?`,
    [founderId, productId, productId],
  );
}

/**
 * Advance the tour to the next step. If step 5 completed, calls completeTour.
 */
export async function advanceTour(founderId: string, step: number): Promise<void> {
  const tour = await getTourState(founderId);
  if (!tour || tour.completed_at || tour.skipped_at) return;

  const completedSteps = [...tour.completed_steps, step];
  const nextStep = step + 1;

  if (nextStep > TOUR_STEPS.length) {
    await completeTour(founderId);
    return;
  }

  await query(
    'UPDATE onboarding_tour SET current_step = ?, completed_steps = ? WHERE founder_id = ?',
    [nextStep, JSON.stringify(completedSteps), founderId],
  );
}

/**
 * Mark the tour as completed.
 */
export async function completeTour(founderId: string): Promise<void> {
  const now = new Date().toISOString();
  await query(
    'UPDATE onboarding_tour SET completed_at = ?, completed_steps = ? WHERE founder_id = ?',
    [now, JSON.stringify([1, 2, 3, 4, 5]), founderId],
  );
  await query(
    'UPDATE founders SET onboarding_completed_at = ? WHERE id = ?',
    [now, founderId],
  );
}

/**
 * Skip the tour entirely.
 */
export async function skipTour(founderId: string): Promise<void> {
  await query(
    'UPDATE onboarding_tour SET skipped_at = CURRENT_TIMESTAMP WHERE founder_id = ?',
    [founderId],
  );
}

/**
 * Fill template variables from real audit and product data.
 */
export function buildTourStepData(
  step: TourStep,
  auditScore: Record<string, unknown>,
  productState: Record<string, unknown>,
): Record<string, string> {
  const data: Record<string, string> = {};
  const composite = auditScore.composite as number | null;

  // Step 1: Score interpretation
  if (step.score_interpretations && composite !== null) {
    data.score = composite.toFixed(1);
    if (composite >= 7) data.score_interpretation = step.score_interpretations.ready!;
    else if (composite >= 6) data.score_interpretation = step.score_interpretations.high!;
    else if (composite >= 4) data.score_interpretation = step.score_interpretations.mid!;
    else data.score_interpretation = step.score_interpretations.low!;
  }

  // Step 2: Blocking issues count
  const blockingCount = productState.blocking_count as number ?? 0;
  data.count_text = blockingCount > 0
    ? `${blockingCount} blocking issue${blockingCount > 1 ? 's' : ''} need${blockingCount === 1 ? 's' : ''} resolution.`
    : 'No blocking issues.';

  const remediationEnabled = productState.remediation_enabled as boolean ?? false;
  const remediationQueued = productState.remediation_queued as number ?? 0;
  data.remediation_text = remediationEnabled && remediationQueued > 0
    ? `Foundry has queued automated fixes for ${remediationQueued} of them.`
    : 'Enable automated fixes in Settings to let Foundry resolve these autonomously.';

  // Step 3: Risk state
  data.state = (productState.risk_state as string ?? 'GREEN').toUpperCase();

  // Step 4: Decision count
  const pendingDecisions = productState.pending_decisions as number ?? 0;
  data.decision_text = pendingDecisions > 0
    ? `You have ${pendingDecisions} pending decision${pendingDecisions > 1 ? 's' : ''}.`
    : 'Your decision queue is empty — Foundry is operating autonomously.';

  return data;
}

/**
 * Fill a body template with the data map.
 */
export function fillTemplate(template: string, data: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}
