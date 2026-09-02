// =============================================================================
// FOUNDRY — the shape of a trial, which is not billing
//
// MOVED OUT OF `services/billing/` FOR THE LAYER BOUNDARY, and the distinction
// is real rather than bookkeeping. `TrialStatus` is three fields describing a
// state; deriving it, charging for it and expiring it are billing, and they
// stay where they are.
//
// The page layout renders a banner from a value somebody hands it. It needed
// the shape and nothing else, and importing it from commercial code made the
// shared layout — which every surface in this repository uses — formally
// dependent on the dormant commercial half. That is the tangle the boundary
// exists to prevent, and here it was one type away from not existing.
// =============================================================================

export type TrialState = 'none' | 'trialing' | 'expired';

export interface TrialStatus {
  state: TrialState;
  /** Whole days remaining (>=0) while trialing; 0 otherwise. */
  daysRemaining: number;
  /** True when the founder is inside an active trial window. */
  onTrial: boolean;
}
