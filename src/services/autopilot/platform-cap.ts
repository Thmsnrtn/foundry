// =============================================================================
// FOUNDRY — Platform Cap (Protective Wrapper primitive 1)
//
// Autonomy = min(customer setting, PLATFORM CAP, earned trust). The trust
// ladder (policy.ts) is earned trust; this is the operator-controlled CEILING
// that no customer setting can exceed — the enforcement arm of the clean-hands
// posture (LIABILITY-AUDIT.md). A category's effective mode is the LOWER of
// what the founder configured and what the platform permits.
//
// Caps are keyed by capability class, conservative by default:
//   - money-touching        → 'shadow' (Foundry does not move money by default)
//   - outreach (cold-ish)   → 'suggest' until compliance is configured
//   - everything else       → 'act' (the ladder governs from there)
//
// Design: pax-jarvis.md — "a customer's autonomy setting is a ceiling request,
// not a grant." Caps only ever LOWER the effective mode; they never raise it.
// =============================================================================

import type { AutopilotMode } from './policy.js';

const RANK: Record<AutopilotMode, number> = { shadow: 0, suggest: 1, act: 2 };
const byRank = (a: AutopilotMode, b: AutopilotMode): AutopilotMode => (RANK[a] <= RANK[b] ? a : b);

// Category → the loudest autonomy the platform permits, whatever the founder
// sets. Absent → 'act' (no platform ceiling; the ladder alone governs).
const PLATFORM_CAP: Record<string, AutopilotMode> = {
  // Outreach reaches third parties — capped at Suggest until a sender-of-record
  // + suppression posture is configured (a human eye on every send).
  outreach: 'suggest',
  // Any future money-touching capability caps here, permanently (immutable:
  // never auto-move money without explicit, recent, revocable consent).
  billing: 'shadow',
  refunds: 'shadow',
  pricing: 'shadow',
};

/** The platform ceiling for a capability (operator-controlled policy). */
export function platformCap(category: string): AutopilotMode {
  return PLATFORM_CAP[category] ?? 'act';
}

/** The effective autonomy: the LOWER of the founder's setting and the platform
 *  cap. This is what departments must consult — never the raw policy mode. */
export function effectiveMode(configured: AutopilotMode, category: string): AutopilotMode {
  return byRank(configured, platformCap(category));
}

/** True when the platform cap is actively holding this category below what the
 *  founder configured — for honest display in Controls. */
export function isCappedBelow(configured: AutopilotMode, category: string): boolean {
  return RANK[platformCap(category)] < RANK[configured];
}
