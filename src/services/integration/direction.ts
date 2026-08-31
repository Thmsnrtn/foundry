// =============================================================================
// FOUNDRY — which way an integration points
//
// `integrations.type` meant three different things depending on which of five
// writers created the row: a PROVIDER KEY, a DIRECTION, or a CATEGORY. Every
// reader had to guess which, and three live defects came out of the guessing —
// most visibly an outbound MCP connection dragged into the inbound sync until
// Foundry told the founder it had "stopped syncing outbound", a sentence about
// a direction announcing that it had given up on something it was never meant
// to pull from.
//
// Direction is its own column now, with a database trigger holding the
// vocabulary, and this is the one place that says which way a provider points.
// A map in five copies is the shape the defect had.
// =============================================================================

export type IntegrationDirection = 'inbound' | 'outbound' | 'bidirectional';

/**
 * Which way each provider points, by provider key.
 *
 * INBOUND is the default and the safe one: a provider Foundry has not been told
 * about is treated as a data source, and the outbound gateway is what decides
 * whether anything may LEAVE. Adding a provider that sends means adding it
 * here, deliberately.
 */
export const DIRECTION_BY_PROVIDER: Record<string, IntegrationDirection> = {
  stripe: 'inbound',
  posthog: 'inbound',
  plausible: 'inbound',
  mixpanel: 'inbound',
  google_analytics: 'inbound',
  intercom: 'inbound',
  sentry: 'inbound',
  linear: 'bidirectional',
  github: 'bidirectional',
  resend: 'outbound',
  slack: 'outbound',
  mcp: 'outbound',
};

/** The direction for a provider key, defaulting to inbound. */
export function directionOf(provider: string): IntegrationDirection {
  return DIRECTION_BY_PROVIDER[provider] ?? 'inbound';
}
