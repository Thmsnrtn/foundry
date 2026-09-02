// =============================================================================
// FOUNDRY — Trial state (Phase 1.3)
// Pure helpers for the 14-day trial: compute remaining days and expiry from the
// founder's trial_ends_at + tier. No DB access — trivially testable.
// =============================================================================

export const TRIAL_DAYS = parseInt(process.env.TRIAL_PERIOD_DAYS ?? '14', 10);

// THE SHAPE LIVES IN `src/types/trial.ts`, and only the shape moved. Deriving
// this status, charging for it and expiring it are billing and are right here.
// The layout needed the three fields and nothing else, and taking them from
// commercial code made the shared layout formally dependent on the dormant
// commercial half of the repository.
import type { TrialState, TrialStatus } from '../../types/trial.js';
export type { TrialState, TrialStatus };

/**
 * Derive trial status from a founder's trial_ends_at and tier.
 *
 * - `trialing`: trial_ends_at is in the future (they have access via the trial).
 * - `expired`: trial_ends_at is in the past AND no paid tier is set.
 * - `none`:    no trial window recorded (never started, or converted to paid —
 *              a paid tier with a past trial_ends_at reads as 'none').
 */
export function getTrialStatus(
  trialEndsAt: string | null | undefined,
  tier: string | null | undefined,
  now: Date = new Date(),
): TrialStatus {
  if (!trialEndsAt) return { state: 'none', daysRemaining: 0, onTrial: false };

  const end = new Date(trialEndsAt).getTime();
  if (Number.isNaN(end)) return { state: 'none', daysRemaining: 0, onTrial: false };

  const msLeft = end - now.getTime();
  if (msLeft > 0) {
    return {
      state: 'trialing',
      daysRemaining: Math.ceil(msLeft / 86_400_000),
      onTrial: true,
    };
  }

  // Trial window has passed. If they converted to a paid tier, it's not an
  // active-but-expired trial — treat as 'none'. Otherwise it's expired.
  if (tier) return { state: 'none', daysRemaining: 0, onTrial: false };
  return { state: 'expired', daysRemaining: 0, onTrial: false };
}
