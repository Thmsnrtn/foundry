// =============================================================================
// Tests: Onboarding / activation email wiring (Phase 0.4 regression guard)
//
// sendAuditResultsEmail (Day-1), evaluateOnboardingSequence (Day-3) and the
// founder welcome were all defined but never called — dead code that never
// fired. These static checks pin that they are (a) actually invoked from their
// trigger sites and (b) routed through the V3.1 tool gateway, not raw Resend.
//
// THE DAY-1 EMAIL IS NOW GONE RATHER THAN WIRED. Its one trigger site was
// `POST /onboarding/run-audit`, deleted with the commercial onboarding wizard,
// and an email reporting the results of an audit nobody can start is a send
// that can never be correct. Wiring it to something else would have been
// inventing a trigger to keep a test passing.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const base = resolve(__dirname, '../../src');
const read = (rel: string) => readFileSync(resolve(base, rel), 'utf-8');

describe('onboarding email wiring', () => {
  it('onboarding emails route through the gateway (send_email), not raw sendTriggerEmail', () => {
    const src = read('lib/onboarding-emails.ts');
    expect(src).toMatch(/from '\.\.\/services\/outbound\/gateway\.js'/);
    expect(src).toMatch(/tool: 'send_email'/);
    expect(src).not.toMatch(/sendTriggerEmail/);
    // Idempotency keys so a retried job never double-sends.
    expect(src).toMatch(/dedupKey: `onboarding_metrics:/);
  });

  it('sends no Day-1 audit email, because no route starts an audit', () => {
    // Matched on the declaration and the call rather than on the bare name: the
    // epitaph in that file says what was removed and why, and a grep cannot
    // tell an explanation from the thing it explains.
    expect(read('lib/onboarding-emails.ts'))
      .not.toMatch(/export async function sendAuditResultsEmail/);
    expect(read('routes/dashboard/onboarding.ts')).not.toMatch(/sendAuditResultsEmail\(/);
  });

  it('points the Day-3 email at pages that exist', () => {
    // Its first call to action was `/products/:id/revenue`, the manual metric
    // form on a surface that is deleted — an activation email whose button is
    // a 404, sent to someone who has just arrived.
    const src = read('lib/onboarding-emails.ts');
    expect(src).not.toMatch(/\$\{appUrl\}\/products\//);
  });

  it('the behavioral_triggers job runs the Day-3 onboarding sequence', () => {
    const src = read('jobs/index.ts');
    expect(src).toMatch(/evaluateOnboardingSequence\(/);
  });

  it('founder provisioning sends a welcome (Clerk webhook + auth fallback)', () => {
    expect(read('routes/auth/clerk.ts')).toMatch(/sendFounderWelcome\(/);
    expect(read('middleware/auth.ts')).toMatch(/sendFounderWelcome\(/);
  });

  it('the welcome send routes through the gateway and is dedup-keyed per stage', () => {
    const src = read('services/founder/welcome-sequence.ts');
    expect(src).toMatch(/tool: 'send_email'/);
    expect(src).toMatch(/dedupKey: `welcome:\$\{founder\.id\}:\$\{stage\}`/);
  });
});
