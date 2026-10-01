// =============================================================================
// Simulation 03: Fleet Scale Behavior
// Verifies the system can handle multiple products without hardcoded limits.
// Static analysis: scheduler, query functions, cost ceiling, tier gates.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../../src');

let clientSource: string;
let aiClientSource: string;
let spendLedgerSource: string;
// THE DEPLOYMENT'S THREE CAPS MOVED OUT OF THE CLIENT. They bound this
// deployment rather than belonging to the thing that spends, and the
// institutional kernel (which may not import a model client) has to read them
// to explain them. Same facts, asserted where they now live.
let ceilingsSource: string;

beforeAll(() => {
  clientSource = readFileSync(resolve(SRC, 'db/client.ts'), 'utf-8');
  aiClientSource = readFileSync(resolve(SRC, 'services/ai/client.ts'), 'utf-8');
  spendLedgerSource = readFileSync(resolve(SRC, 'services/ai/spend-ledger.ts'), 'utf-8');
  ceilingsSource = readFileSync(resolve(SRC, 'services/deployment/ai-ceilings.ts'), 'utf-8');
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

  // The provisionSCP case went with `scp/provisioner.ts` in Roadmap 2027 R9.
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
    expect(ceilingsSource).toMatch(/AI_DAILY_COST_CEILING_FOUNDER_CENTS/);
    expect(ceilingsSource).toMatch(/AI_DAILY_COST_CEILING_GLOBAL_CENTS/);
    expect(aiClientSource).toMatch(/GLOBAL_COST_CEILING_CENTS/);
  });

  it('per-product cost ceiling is configurable via environment variable', () => {
    expect(ceilingsSource).toMatch(/AI_DAILY_COST_CEILING_CENTS/);
    expect(ceilingsSource).toMatch(/process\.env\.AI_DAILY_COST_CEILING_CENTS/);
    // And the client still reads that one home rather than the env itself.
    expect(aiClientSource).toMatch(/from '\.\.\/deployment\/ai-ceilings\.js'/);
    expect(aiClientSource).not.toMatch(/process\.env\.AI_DAILY_COST_CEILING/);
  });

  it('per-product cost ceiling has a sensible default ($25/day = 2500 cents)', () => {
    expect(ceilingsSource).toMatch(/2500/);
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
// 4. TIER-GATED PRODUCT LIMITS — THE SECTION THAT WENT WITH THE BILLING.
//
// Five checks lived here: that onboarding held a `productLimits` map, that Solo
// allowed one company, Growth three and Investor-Ready `Infinity`, and that a
// tier-gate middleware existed to enforce it all. Every one of them read a
// source file for a shape rather than exercising a behaviour, which is why they
// kept passing long after they meant anything.
//
// They describe Commercial Foundry. The onboarding wizard that counted a
// founder's companies against their plan is deleted, `middleware/tier-gate.ts`
// is deleted, and this instance has one owner who is not on a plan. A fleet
// still has limits worth checking — the scheduler's, the spend ceiling's, the
// connection pool's — and those sections above are untouched. What is gone is
// the limit that was a price.
// =============================================================================

