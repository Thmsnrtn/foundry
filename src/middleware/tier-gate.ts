// =============================================================================
// FOUNDRY — Feature Gating by Tier
// Solo ($79) → core loop. Growth ($199) → integrations + team. Investor-Ready ($399) → full platform.
// Gates are previews, not walls.
// =============================================================================

import { createMiddleware } from 'hono/factory';
import { query } from '../db/client.js';
import { nanoid } from 'nanoid';
import type { Founder, SubscriptionTier, FeatureGateConfig } from '../types/index.js';
import type { AuthEnv } from './auth.js';

export const FEATURE_GATES: Record<string, FeatureGateConfig> = {
  // Available to all tiers (Solo, Growth, Investor-Ready)
  audit:     { requiredTier: ['solo', 'growth', 'investor_ready'], name: 'Audit Engine', description: '10-dimension codebase audit', upgradeMessage: '' },
  dashboard: { requiredTier: ['solo', 'growth', 'investor_ready'], name: 'Dashboard', description: 'Core intelligence dashboard', upgradeMessage: '' },
  decisions: { requiredTier: ['solo', 'growth', 'investor_ready'], name: 'Decision Queue', description: 'Structured decision management', upgradeMessage: '' },
  lifecycle: { requiredTier: ['solo', 'growth', 'investor_ready'], name: 'Lifecycle Tracking', description: 'Prompt-by-prompt progress', upgradeMessage: '' },
  digest:    { requiredTier: ['solo', 'growth', 'investor_ready'], name: 'Weekly Digest', description: 'Email intelligence digest', upgradeMessage: '' },

  // Growth and above ($199+)
  integrations:  { requiredTier: ['growth', 'investor_ready'], name: 'Live Integrations', description: 'Stripe, PostHog, Intercom, Linear data sync', upgradeMessage: 'Live Integrations pull real-time metrics from Stripe, PostHog, Intercom, and Linear directly into your Signal score. Available on Growth.' },
  team_mode:     { requiredTier: ['growth', 'investor_ready'], name: 'Team Mode', description: 'Co-founder alignment scores and decision voting', upgradeMessage: 'Team Mode enables co-founder alignment tracking, decision voting, and shared operating context. Available on Growth.' },
  benchmarks:    { requiredTier: ['growth', 'investor_ready'], name: 'Intelligence Network', description: 'Anonymized benchmarks across the founder network', upgradeMessage: 'The Intelligence Network shows how your key metrics compare to anonymized peers in the same market and stage. Available on Growth.' },
  wisdom:        { requiredTier: ['growth', 'investor_ready'], name: 'Wisdom Layer', description: 'Product DNA and judgment pattern accumulation', upgradeMessage: 'The Wisdom Layer learns how you make decisions and calibrates every recommendation to your specific product and ICP. Available on Growth.' },
  remediation:   { requiredTier: ['growth', 'investor_ready'], name: 'Remediation Engine', description: 'Automated fix generation and GitHub PR creation', upgradeMessage: 'The Remediation Engine generates targeted code fixes for blocking issues and opens GitHub PRs automatically. Available on Growth.' },

  // Investor-Ready only ($399)
  investor_layer: { requiredTier: ['investor_ready'], name: 'Investor Layer', description: 'Board packets, funding readiness score, deal rooms', upgradeMessage: 'The Investor Layer generates AI-drafted board packets, computes your funding readiness across 7 dimensions, and creates secure deal rooms for investor sharing. Available on Investor-Ready.' },
  playbooks:      { requiredTier: ['investor_ready'], name: 'Playbook Crystallization', description: 'Auto-generate operating playbooks from your patterns', upgradeMessage: 'Playbook Crystallization distills your decision history into reusable operating playbooks — onboarding kits, pricing frameworks, churn responses, and more. Available on Investor-Ready.' },
  temporal:       { requiredTier: ['investor_ready'], name: 'Temporal Intelligence', description: 'Signal replay and prediction accuracy tracking', upgradeMessage: 'Temporal Intelligence lets you replay your Signal history day-by-day and measures how accurate your scenario predictions were. Available on Investor-Ready.' },
  competitive:    { requiredTier: ['investor_ready'], name: 'Competitive Intelligence', description: 'Weekly competitor monitoring', upgradeMessage: 'Competitive Intelligence runs weekly scans of your competitors and surfaces pricing changes, feature launches, and positioning shifts. Available on Investor-Ready.' },
  cohorts:        { requiredTier: ['investor_ready'], name: 'Cohort Analysis', description: 'Retention by acquisition period and channel', upgradeMessage: 'Cohort Analysis tracks retention across acquisition cohorts and channels, identifying which users actually stick and why. Available on Investor-Ready.' },
  story:          { requiredTier: ['investor_ready'], name: 'Founding Story Engine', description: 'Timestamped publishable case studies', upgradeMessage: 'The Founding Story Engine generates publishable case studies with cryptographic timestamps. Available on Investor-Ready.' },
  multi_product:  { requiredTier: ['investor_ready'], name: 'Multi-Product', description: 'Govern more than one product', upgradeMessage: 'Investor-Ready allows unlimited products with cross-portfolio intelligence. Available on Investor-Ready.' },
};

/**
 * Check if a founder can access a feature based on their tier.
 * Null tier (free/no subscription) blocks everything except public routes.
 * Investor-Ready has full access to all features.
 */
export function canAccess(founder: Founder, featureKey: string): boolean {
  const gate = FEATURE_GATES[featureKey];
  if (!gate) return true; // Unknown feature — allow

  // Investor-Ready always has full access
  if (founder.tier === 'investor_ready') return true;

  if (!founder.tier) return false; // No tier — no access to gated features

  return gate.requiredTier.includes(founder.tier);
}

/**
 * Hono middleware factory for tier gating.
 * Returns a full HTML gate page on access denied — not a 403.
 * Logs the attempt to gate_events table.
 */
export function requireTier(featureKey: string) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const founder = c.get('founder');
    if (!founder) return c.redirect('/auth/login');

    if (canAccess(founder, featureKey)) {
      return next();
    }

    const gate = FEATURE_GATES[featureKey];
    if (!gate) return next();

    // Log gate event
    try {
      await query(
        'INSERT INTO gate_events (id, founder_id, feature_key, tier_required, tier_actual) VALUES (?, ?, ?, ?, ?)',
        [nanoid(), founder.id, featureKey, gate.requiredTier.join(','), founder.tier ?? 'free'],
      );
    } catch {
      // Non-critical — don't block the response
    }

    return c.html(gatePageHtml(gate, founder));
  });
}

/**
 * Render the gate page — a preview, not a wall.
 */
function gatePageHtml(feature: FeatureGateConfig, founder: Founder): string {
  const checkoutUrl = '/settings'; // Stripe checkout via settings
  const tierLabel = getTierBadge(founder.tier);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${feature.name} — Foundry</title>
  <link rel="stylesheet" href="/static/styles.css" />
</head>
<body>
  <header class="site-header">
    <div class="header-left">
      <a href="/dashboard" class="logo">Foundry</a>
    </div>
    <div class="header-right">
      <span class="user-name">${founder.name ?? founder.email}</span>
      <a href="/settings" class="header-link">Settings</a>
    </div>
  </header>
  <main class="main-full">
    <div class="gate-page">
      <div style="margin-bottom:1.5rem;">
        <span class="badge badge-watch">${tierLabel}</span>
      </div>
      <h1 class="gate-feature-name">${feature.name}</h1>
      <p class="gate-description">${feature.description}</p>

      <div class="gate-preview">
        <div style="display:flex;flex-direction:column;gap:0.75rem;">
          <div style="height:12px;background:#e5e7eb;border-radius:4px;width:80%;"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;">
            <div style="height:48px;background:#f3f4f6;border-radius:6px;"></div>
            <div style="height:48px;background:#f3f4f6;border-radius:6px;"></div>
            <div style="height:48px;background:#f3f4f6;border-radius:6px;"></div>
          </div>
          <div style="height:80px;background:#f3f4f6;border-radius:6px;"></div>
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:0.5rem;">
            <div style="height:32px;background:#f3f4f6;border-radius:6px;"></div>
            <div style="height:32px;background:#e5e7eb;border-radius:6px;"></div>
          </div>
        </div>
      </div>

      ${feature.upgradeMessage ? `<div class="gate-upgrade-message">${feature.upgradeMessage}</div>` : ''}

      <a href="${checkoutUrl}" class="btn btn-primary" style="font-size:1rem;padding:0.75rem 2rem;">Upgrade Plan</a>
      <div style="margin-top:1rem;">
        <a href="/dashboard" style="font-size:0.87rem;color:#6b7280;">← Back to Dashboard</a>
      </div>
    </div>
  </main>
</body>
</html>`;
}

/**
 * Display-friendly tier name.
 */
export function getTierBadge(tier: string | null): string {
  switch (tier) {
    case 'solo': return 'Solo';
    case 'growth': return 'Growth';
    case 'investor_ready': return 'Investor-Ready';
    default: return 'Free Trial';
  }
}

/**
 * Returns list of feature keys accessible to a given tier.
 */
export function getTierCapabilities(tier: string | null): string[] {
  return Object.entries(FEATURE_GATES)
    .filter(([_, gate]) => {
      if (tier === 'investor_ready') return true;
      if (!tier) return false;
      return gate.requiredTier.includes(tier as SubscriptionTier);
    })
    .map(([key]) => key);
}
