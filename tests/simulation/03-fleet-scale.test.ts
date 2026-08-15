// =============================================================================
// Simulation 03: Fleet Scale Behavior
// Verifies the system can handle multiple products without hardcoded limits.
// Static analysis: scheduler, query functions, cost ceiling, tier gates.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../../src');

let schedulerSource: string;
let clientSource: string;
let aiClientSource: string;
let spendLedgerSource: string;
let provisonerSource: string;
let onboardingSource: string;
let tierGateSource: string;

beforeAll(() => {
  schedulerSource = readFileSync(resolve(SRC, 'services/scp/scheduler.ts'), 'utf-8');
  clientSource = readFileSync(resolve(SRC, 'db/client.ts'), 'utf-8');
  aiClientSource = readFileSync(resolve(SRC, 'services/ai/client.ts'), 'utf-8');
  spendLedgerSource = readFileSync(resolve(SRC, 'services/ai/spend-ledger.ts'), 'utf-8');
  provisonerSource = readFileSync(resolve(SRC, 'services/scp/provisioner.ts'), 'utf-8');
  onboardingSource = readFileSync(resolve(SRC, 'routes/dashboard/onboarding.ts'), 'utf-8');
  tierGateSource = readFileSync(resolve(SRC, 'middleware/tier-gate.ts'), 'utf-8');
});

// =============================================================================
// 1. Scheduler — No Hardcoded Product Limits
// =============================================================================

describe('Scheduler has no hardcoded product limits', () => {

  it('runDueAgentsForAllProducts iterates all products from DB query', () => {
    // Should query products table without LIMIT or hardcoded count
    const fn = schedulerSource.match(
      /export\s+async\s+function\s+runDueAgentsForAllProducts[\s\S]*?(?=export\s+async\s+function|$)/
    );
    expect(fn).toBeTruthy();
    const fnBody = fn![0];

    // Verify it queries products from the DB
    expect(fnBody).toMatch(/SELECT.*FROM products/i);

    // Should NOT have a hardcoded LIMIT on the product query
    const productQuery = fnBody.match(/SELECT.*FROM products[^;]*/i);
    expect(productQuery).toBeTruthy();
    expect(productQuery![0]).not.toMatch(/LIMIT\s+\d+/i);
  });

  it('scheduler loops with for...of (handles any count dynamically)', () => {
    expect(schedulerSource).toMatch(/for\s*\(.*of\s+result\.rows\)/);
  });

  it('scheduler continues to next product on failure (no cascading abort)', () => {
    // The loop should have try/catch that continues on error
    const loopBlock = schedulerSource.match(
      /for\s*\(.*of\s+result\.rows\)[\s\S]*?catch[\s\S]*?continue|\/\/ Continue/i
    );
    expect(loopBlock).toBeTruthy();
  });

  it('generateBriefingsForAllProducts has no product count limit', () => {
    const fn = schedulerSource.match(
      /export\s+async\s+function\s+generateBriefingsForAllProducts[\s\S]*?(?=export\s+async\s+function|$)/
    );
    expect(fn).toBeTruthy();
    const productQuery = fn![0].match(/SELECT.*FROM products[^;]*/i);
    expect(productQuery).toBeTruthy();
    expect(productQuery![0]).not.toMatch(/LIMIT\s+\d+/i);
  });

  it('runEvolutionForAllProducts has no product count limit', () => {
    const fn = schedulerSource.match(
      /export\s+async\s+function\s+runEvolutionForAllProducts[\s\S]*?(?=export\s+async\s+function|$)/
    );
    expect(fn).toBeTruthy();
    const productQuery = fn![0].match(/SELECT.*FROM products[^;]*/i);
    expect(productQuery).toBeTruthy();
    expect(productQuery![0]).not.toMatch(/LIMIT\s+\d+/i);
  });
});

// =============================================================================
// 2. Query Functions Accept Any Product Count
// =============================================================================

describe('Query functions accept any product count', () => {

  it('getProductsByOwner has no LIMIT clause (returns all owned products)', () => {
    const fn = clientSource.match(
      /export\s+async\s+function\s+getProductsByOwner[\s\S]*?(?=export\s+async\s+function|$)/
    );
    expect(fn).toBeTruthy();
    expect(fn![0]).not.toMatch(/LIMIT\s+\d+/i);
  });

  it('getAllActiveProducts has no LIMIT clause (returns all active)', () => {
    const fn = clientSource.match(
      /export\s+async\s+function\s+getAllActiveProducts[\s\S]*?(?=export\s+async\s+function|$)/
    );
    expect(fn).toBeTruthy();
    expect(fn![0]).not.toMatch(/LIMIT\s+\d+/i);
  });

  it('provisionSCP accepts any productId (no hardcoded product cap)', () => {
    const fn = provisonerSource.match(
      /export\s+async\s+function\s+provisionSCP[\s\S]*?(?=export\s+async\s+function|$)/
    );
    expect(fn).toBeTruthy();
    // Should not check a global product count limit
    expect(fn![0]).not.toMatch(/products\.length\s*>=?\s*\d+/);
    expect(fn![0]).not.toMatch(/MAX_PRODUCTS/);
  });
});

// =============================================================================
// 3. Cost Ceiling Is Per-Product (Not Global)
// =============================================================================

describe('AI cost ceiling is persisted and multi-scoped', () => {

  it('spend is persisted to the ai_daily_spend table (survives deploys)', () => {
    // Must write through to the DB, not just an in-process Map.
    expect(aiClientSource).toMatch(/ai_daily_spend/);
    expect(spendLedgerSource).toMatch(/INSERT INTO ai_spend_reservations/);
  });

  it('keeps an in-process read-through cache to avoid a DB hit per AI call', () => {
    expect(aiClientSource).toMatch(/spendCache.*Map/);
    expect(aiClientSource).toMatch(/CACHE_TTL_MS/);
  });

  it('isCostCeilingReached accepts a productId parameter', () => {
    expect(aiClientSource).toMatch(
      /function\s+isCostCeilingReached\(\s*productId\??:\s*string\s*\)/
    );
  });

  it('getDailySpend accepts a productId parameter', () => {
    expect(aiClientSource).toMatch(
      /function\s+getDailySpend\(\s*productId:\s*string\s*\)/
    );
  });

  it('enforces fleet-level caps (per-founder and global) with env overrides', () => {
    expect(aiClientSource).toMatch(/AI_DAILY_COST_CEILING_FOUNDER_CENTS/);
    expect(aiClientSource).toMatch(/AI_DAILY_COST_CEILING_GLOBAL_CENTS/);
    expect(aiClientSource).toMatch(/GLOBAL_COST_CEILING_CENTS/);
  });

  it('per-product cost ceiling is configurable via environment variable', () => {
    expect(aiClientSource).toMatch(/AI_DAILY_COST_CEILING_CENTS/);
    expect(aiClientSource).toMatch(/process\.env\.AI_DAILY_COST_CEILING_CENTS/);
  });

  it('per-product cost ceiling has a sensible default ($25/day = 2500 cents)', () => {
    expect(aiClientSource).toMatch(/2500/);
  });

  it('callClaude atomically authorizes spend before making API call', () => {
    const callClaudeFn = aiClientSource.match(
      /export\s+async\s+function\s+callClaude[\s\S]*?(?=export\s+async\s+function|$)/
    );
    expect(callClaudeFn).toBeTruthy();
    const body = callClaudeFn![0];
    const ceilingCheckPos = body.indexOf('authorizeSpend');
    const apiCallPos = body.indexOf('fetch(');
    expect(ceilingCheckPos).toBeGreaterThan(-1);
    expect(apiCallPos).toBeGreaterThan(-1);
    expect(ceilingCheckPos).toBeLessThan(apiCallPos);
  });
});

// =============================================================================
// 4. Tier-Gated Product Limits (Billing Enforcement)
// =============================================================================

describe('Product limits enforced via tier, not hardcoded caps', () => {

  it('onboarding enforces per-tier product limits', () => {
    expect(onboardingSource).toMatch(/productLimits/);
  });

  it('solo tier allows 1 product', () => {
    expect(onboardingSource).toMatch(/solo:\s*1/);
  });

  it('growth tier allows 3 products', () => {
    expect(onboardingSource).toMatch(/growth:\s*3/);
  });

  it('investor_ready tier allows unlimited products', () => {
    expect(onboardingSource).toMatch(/investor_ready/);
    expect(onboardingSource).toMatch(/Infinity/);
  });

  it('tier-gate middleware exists for feature access control', () => {
    expect(tierGateSource).toMatch(/canAccess|tierGate|createMiddleware/i);
  });
});
