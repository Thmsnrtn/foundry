// =============================================================================
// FOUNDRY — Billing Cohort Utilities
// The Founding Cohort tier and 7-day activation window were retired when
// pricing moved to Solo / Growth / Investor-Ready.
// enforceActivationWindow is kept as a no-op so the job registry doesn't break.
// =============================================================================

export async function enforceActivationWindow(): Promise<void> {
  // No-op: activation window enforcement was specific to the legacy
  // Founding Cohort tier which no longer exists.
}
