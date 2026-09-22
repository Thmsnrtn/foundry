// =============================================================================
// A SLACK DOUBLE THAT KEEPS THE DOOR.
//
// Three suites mocked `src/services/integration/slack.js` to keep a test off
// the network. That was harmless while the Slack path called its provider
// directly. It stopped being harmless the moment that path went through the
// outbound door, because registration is deliberately a property of the import
// graph — `gateway.ts`: "A tool registers itself when its gateway module is
// imported." A factory that returned only `sendSlackNotification` therefore
// replaced the registration too, and every governed Slack send answered
// `no_handler`. Three suites went red at once, which is the import-graph
// doctrine working: the mock was silently removing a gate, and it was caught.
//
// The fix belongs in one place rather than copied into each factory, because
// the copies drift and a drifted copy is a suite that proves the door while
// standing in for it. This double registers the same tool, under the same
// policy, translating the same receipt vocabulary — including the one
// distinction the door cannot reconstruct afterwards: `ambiguous` means the
// message may have arrived, and everything else means definitively nothing
// left the building.
// =============================================================================

import { vi } from 'vitest';

/** Exactly `POST_SLACK_POLICY`, restated so the double cannot import the module it replaces. */
const POLICY = {
  actor: 'action_executor', surface: 'channel_outbound', dataClass: 'customer',
  requireDedupKey: true, requireCustomerExternalId: false,
} as const;

export type Receipt =
  | { certainty: 'provider_acknowledged'; providerMessageTs?: string | null }
  | { certainty: 'not_attempted' | 'provider_rejected' | 'ambiguous'; reason?: string };

/**
 * The module shape `vi.mock` should return for `integration/slack.js`.
 *
 * Call it from inside the factory. The returned `sendSlackNotification` is a
 * `vi.fn`, so a suite reads it back with `await import(...)` and asserts on it
 * exactly as before — but what it now proves is that a message reached the
 * sender THROUGH the door, rather than that a function was called.
 */
export async function slackModuleDouble(
  answer: () => Promise<Receipt> = async () => ({ certainty: 'provider_acknowledged', providerMessageTs: '1.0' }),
): Promise<Record<string, unknown>> {
  const sendSlackNotification = vi.fn(answer);
  const { registerToolHandler } = await import('../../src/services/outbound/gateway.js');
  registerToolHandler('post_slack', async () => {
    const receipt = await sendSlackNotification();
    if (receipt.certainty === 'provider_acknowledged') return { ts: receipt.providerMessageTs ?? null };
    const err = new Error(`slack: ${receipt.reason ?? 'Slack rejected the message'}`) as
      Error & { notAttempted?: boolean };
    if (receipt.certainty !== 'ambiguous') err.notAttempted = true;
    throw err;
  }, POLICY);
  return {
    sendSlackNotification,
    // The briefing path formats and does not send, so the double gives back a
    // formatter rather than a second sender.
    briefingMessage: (b: { date: string; health_score: number; headline: string; key_points: string[] }) =>
      ({ text: `Foundry Daily Briefing — ${b.date}`, blocks: [] as unknown[] }),
    isSlackConnected: async () => true,
    POST_SLACK_POLICY: POLICY,
  };
}
