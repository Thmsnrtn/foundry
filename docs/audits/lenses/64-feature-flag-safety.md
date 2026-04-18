# Lens 64 — Feature Flag Safety

**Auditor perspective:** Feature flags, stale flags, flag-dependent code paths, gradual rollout mechanisms, and the absence of a feature flag system.

**Date:** 2026-04-16
**Codebase snapshot:** ~288 TypeScript files, no feature flag library or system

---

## Executive Summary

Foundry has no feature flag system. There is no LaunchDarkly, Unleash, Flipper, or custom feature flag implementation. The codebase uses two proxy mechanisms that function as implicit feature flags: (1) subscription tier gates that control feature access based on billing tier (Solo, Growth, Investor-Ready), and (2) environment variable presence checks that enable/disable features based on whether an API key is configured. Neither mechanism supports gradual rollout, A/B testing, or per-founder flag overrides. The tier gate system is well-implemented with a middleware pattern. The environment variable approach is scattered and inconsistent — some checks are at request time, others at module initialization. The lack of feature flags means every feature ships to 100% of users simultaneously, with no ability to roll back a feature without a full deploy.

---

## Findings

### FF-01. No Feature Flag System — All Features Are All-or-Nothing

**Severity: P2**

There is no mechanism to gradually roll out a feature to a subset of users, roll back a feature without deploying, or A/B test different experiences. Every code change ships to 100% of users on the next deploy.

**Evidence:**
- No `feature_flags` table in any migration
- No LaunchDarkly, Unleash, or Flipper in `package.json`
- No `isFeatureEnabled()` or `featureFlag()` function anywhere
- No `features` column on `founders` or `products` tables
- New capabilities (SCP v2 through v7) are gated only by tier, not by feature flag

**Remediation:** Implement a simple feature flag system: a `feature_flags` table with `(flag_name, enabled, rollout_percentage, allowed_founder_ids)`. Add an `isEnabled(flagName, founderId)` helper. This enables gradual rollout of new agent capabilities, experimental UI changes, and A/B testing of AI prompts.

**Target phase:** P2

---

### FF-02. Tier Gates Function as Coarse Feature Flags — But Cannot Be Changed Without Deploy

**Severity: P2**

The `tier-gate.ts` middleware controls feature access based on subscription tier. This works as a feature gating mechanism but cannot be modified without code changes and deployment.

**Evidence:**
- `src/middleware/tier-gate.ts` — checks `founder.tier` against required tiers
- Tier definitions are hardcoded in the middleware
- Changing which tier can access a feature requires a code change and deploy
- No admin UI to override tier access for individual founders (e.g., granting a Solo-tier founder temporary Growth-tier access for a trial)

**Remediation:** Add a `tier_overrides` table that allows per-founder tier upgrades without code changes. This enables sales trials, beta testing, and customer support overrides.

**Target phase:** P3

---

### FF-03. Environment Variable Checks Function as Implicit Feature Flags

**Severity: P2**

Multiple services check for the presence of API keys at runtime and gracefully degrade when the key is missing. This functions as an implicit feature flag but is inconsistent:

**Evidence:**
- `src/services/ai/client.ts:55` — `if (!apiKey) throw new Error(...)` — hard failure, no graceful degradation
- `src/services/digest/delivery.ts:13` — `if (!key) { logger.warn(...); return; }` — silent skip
- `src/services/notifications/push.ts:278-280` — VAPID key checks, returns early if missing
- `src/services/scp/briefing/audio.ts:211-212` — ElevenLabs/OpenAI key checks
- `src/routes/dashboard/ambient.ts:214` — checks `process.env.RESEND_API_KEY` in HTML template to show/hide UI
- Some checks throw errors, some return silently, some show UI warnings — no consistent pattern

**Remediation:** Create an `isServiceConfigured(service: 'ai' | 'email' | 'push' | 'voice')` function that centralizes these checks. Use it both in service logic (graceful degradation) and in UI templates (feature availability badges).

**Target phase:** P2

---

### FF-04. SCP Version Features Cannot Be Rolled Back

**Severity: P2**

The SCP system has evolved through 7 major versions (v1 through v7), each adding new agent capabilities, routes, and database tables. These versions are deployed monolithically — all v7 features are available to all products simultaneously. If a v7 feature has a bug, there is no way to disable it for affected products without a full deploy reverting the code.

**Evidence:**
- `src/index.ts:76-111` — imports for SCP v2/v3/v4/v5/v6/v7 routes
- All routes are mounted unconditionally
- No `scp_version` column on products table to control per-product feature availability
- A bug in v7's `scp_founder_state` job affects all products, with no way to disable it for specific products

**Remediation:** Add a `scp_feature_set` column (or JSON) to the products table that controls which SCP capabilities are enabled. Jobs and routes check this before executing. Default new products to the latest feature set, but allow per-product overrides.

**Target phase:** P2

---

### FF-05. No Kill Switch for Expensive AI Features

**Severity: P1**

There is no mechanism to quickly disable AI-calling features (daily insights, weekly plans, competitive scans, scenario accuracy) without a deploy. If Anthropic has an outage or the cost ceiling is hit, these features continue to attempt calls and log errors.

**Evidence:**
- `src/services/ai/client.ts:67-68` — cost ceiling check is per-product, not global
- No global `AI_ENABLED` flag
- No per-job enable/disable mechanism
- If Anthropic raises prices or has an extended outage, the only response is a code deploy
- The cost ceiling at `$25/day/product` with 100 products is $2,500/day — no global spend cap

**Remediation:** Add a global `AI_ENABLED` environment variable that can be set to `false` to disable all AI calls. Add a global daily spend cap (e.g., `AI_GLOBAL_DAILY_CAP_CENTS`). Make both configurable via Fly.io secrets (no deploy needed for env var changes on Fly.io).

**Target phase:** P1

---

## Embarrassment Test

1. **"There is no way to roll back a feature without a full code deploy — a bug in SCP v7 affects all customers simultaneously with no per-product override"** — Zero gradual rollout capability.

2. **"API key presence checks function as implicit feature flags but behave inconsistently — some throw errors, some return silently, some show UI warnings"** — The inconsistent degradation pattern confuses both developers and users.

3. **"There is no global kill switch for AI features — if Anthropic has an extended outage, all 72 jobs that call Claude log errors every hour with no way to stop them except a deploy"** — Operational inflexibility.

## Pride Test

1. The tier gate middleware is a clean, well-structured feature gating mechanism that correctly enforces subscription-based access control.

2. The `AI_DAILY_COST_CEILING_CENTS` environment variable provides a per-product cost control knob that can be adjusted via Fly.io secrets without a deploy.

3. Several jobs have built-in skip conditions that function as soft flags: `dailyInsightGenerate` skips products with existing insights, `weeklyPlanGenerate` skips products with existing plans.

## Distinct-Value Declaration

This lens examines the feature lifecycle management capabilities of the platform — not just "are features gated?" (covered by the billing/tier lens) but "can features be gradually rolled out, A/B tested, or emergency-disabled?" The analysis of implicit feature flags via environment variable presence checks and their inconsistent behavior patterns is unique to this specialty.

## Tenancy-Critical Flag

**FF-04** is tenancy-critical: a bug in a new SCP feature affects all tenants simultaneously with no per-tenant override. **FF-05** is tenancy-critical: the absence of a global AI kill switch means an Anthropic outage fills logs with errors for all tenants, potentially masking other critical issues.
