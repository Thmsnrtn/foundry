// =============================================================================
// Tests: Trial state (Phase 1.3)
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getTrialStatus } from '../../src/services/billing/trial.js';

const NOW = new Date('2026-07-08T12:00:00Z');

describe('getTrialStatus', () => {
  it('returns none when no trial window is recorded', () => {
    expect(getTrialStatus(null, null, NOW)).toEqual({ state: 'none', daysRemaining: 0, onTrial: false });
    expect(getTrialStatus(undefined, 'solo', NOW).state).toBe('none');
  });

  it('returns trialing with whole days remaining while the trial is active', () => {
    const in10Days = new Date(NOW.getTime() + 10 * 86_400_000).toISOString();
    const s = getTrialStatus(in10Days, null, NOW);
    expect(s.state).toBe('trialing');
    expect(s.onTrial).toBe(true);
    expect(s.daysRemaining).toBe(10);
  });

  it('rounds partial days up so "a few hours left" still shows 1 day', () => {
    const in6Hours = new Date(NOW.getTime() + 6 * 3_600_000).toISOString();
    expect(getTrialStatus(in6Hours, null, NOW).daysRemaining).toBe(1);
  });

  it('returns expired when the window has passed and no tier was purchased', () => {
    const yesterday = new Date(NOW.getTime() - 86_400_000).toISOString();
    expect(getTrialStatus(yesterday, null, NOW)).toEqual({ state: 'expired', daysRemaining: 0, onTrial: false });
  });

  it('returns none (not expired) when the trial converted to a paid tier', () => {
    const yesterday = new Date(NOW.getTime() - 86_400_000).toISOString();
    expect(getTrialStatus(yesterday, 'growth', NOW).state).toBe('none');
  });

  it('treats an unparseable trial_ends_at as none', () => {
    expect(getTrialStatus('not-a-date', null, NOW).state).toBe('none');
  });
});

describe('checkout uses a card-upfront trial', () => {
  it('createCheckoutSession passes trial_period_days to Stripe', () => {
    const src = readFileSync(resolve(__dirname, '../../src/services/billing/stripe.ts'), 'utf-8');
    expect(src).toMatch(/trial_period_days/);
    expect(src).toMatch(/subscription_data/);
    expect(src).toMatch(/TRIAL_PERIOD_DAYS/);
  });

  it('the webhook persists and clears trial_ends_at', () => {
    const src = readFileSync(resolve(__dirname, '../../src/services/billing/stripe.ts'), 'utf-8');
    expect(src).toMatch(/trial_ends_at = \?/);
    expect(src).toMatch(/trial_ends_at = NULL/);
  });
});
