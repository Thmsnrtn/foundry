// =============================================================================
// Simulation 04: Chaos & Graceful Degradation
// Verifies the system degrades gracefully under failure conditions.
// Static analysis of error handling, fallbacks, and resilience patterns.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../../src');

let aiClientSource: string;
let healthRouteSource: string;
let resilienceSource: string;
let provisionerSource: string;
let schedulerSource: string;
let onboardingSource: string;
let voiceBriefingSource: string;
let signalSource: string;

beforeAll(() => {
  aiClientSource = readFileSync(resolve(SRC, 'services/ai/client.ts'), 'utf-8');
  healthRouteSource = readFileSync(resolve(SRC, 'routes/internal/health.ts'), 'utf-8');
  resilienceSource = readFileSync(resolve(SRC, 'services/resilience.ts'), 'utf-8');
  provisionerSource = readFileSync(resolve(SRC, 'services/scp/provisioner.ts'), 'utf-8');
  schedulerSource = readFileSync(resolve(SRC, 'services/scp/scheduler.ts'), 'utf-8');
  onboardingSource = readFileSync(resolve(SRC, 'routes/dashboard/onboarding.ts'), 'utf-8');
  voiceBriefingSource = readFileSync(resolve(SRC, 'services/voice/briefing.ts'), 'utf-8');
  signalSource = readFileSync(resolve(SRC, 'services/signal.ts'), 'utf-8');
});

// =============================================================================
// 1. AI Client — Missing API Key Handling
// =============================================================================

describe('AI client handles missing API key gracefully', () => {

  it('getApiKey throws a descriptive error when no AI key is set', () => {
    expect(aiClientSource).toMatch(/OPENROUTER_API_KEY.*required|required.*OPENROUTER_API_KEY|ANTHROPIC_API_KEY/);
  });

  it('atomic spend authorization runs after credential validation and before provider dispatch', () => {
    const callClaudeFn = aiClientSource.match(
      /export\s+async\s+function\s+callClaude[\s\S]*?(?=export\s+async\s+function|$)/
    );
    expect(callClaudeFn).toBeTruthy();
    const body = callClaudeFn![0];
    const ceilingCheckIdx = body.indexOf('authorizeSpend');
    const getClientIdx = body.indexOf('getApiKey()');
    const fetchIdx = body.indexOf('fetch(');
    expect(ceilingCheckIdx).toBeGreaterThan(-1);
    expect(getClientIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(getClientIdx).toBeLessThan(ceilingCheckIdx);
    expect(ceilingCheckIdx).toBeLessThan(fetchIdx);
  });

  it('AI client has retry logic with exponential backoff', () => {
    expect(aiClientSource).toMatch(/MAX_RETRIES|maxRetries/);
    expect(aiClientSource).toMatch(/Math\.pow\(2/);
    expect(aiClientSource).toMatch(/attempt\s*<\s*MAX_RETRIES/);
  });

  it('AI client does not retry non-retryable errors (4xx except 429)', () => {
    expect(aiClientSource).toMatch(/status\s*<\s*500\s*&&\s*status\s*!==\s*429/);
  });

  it('AI client has a configurable timeout', () => {
    expect(aiClientSource).toMatch(/AI_TIMEOUT_MS/);
    expect(aiClientSource).toMatch(/timeout/);
  });
});

// =============================================================================
// 2. Health Check — Returns 503 When DB Is Down
// =============================================================================

describe('Health check returns 503 when DB is down', () => {

  it('health route exists at /internal/health', () => {
    expect(healthRouteSource).toMatch(
      /\.get\(['"]\/internal\/health['"]/
    );
  });

  it('health check tests database connectivity', () => {
    expect(healthRouteSource).toMatch(/SELECT 1/);
  });

  it('health check catches database errors', () => {
    expect(healthRouteSource).toMatch(/catch/);
    expect(healthRouteSource).toMatch(/database.*error/i);
  });

  it('health check returns 503 when unhealthy', () => {
    expect(healthRouteSource).toMatch(/503/);
  });

  it('health check returns 200 when healthy', () => {
    expect(healthRouteSource).toMatch(/200/);
  });

  it('health check reports status as ok or degraded', () => {
    expect(healthRouteSource).toMatch(/healthy\s*\?\s*['"]ok['"]\s*:\s*['"]degraded['"]/);
  });

  it('health check verifies AI key is configured', () => {
    expect(healthRouteSource).toMatch(/OPENROUTER_API_KEY|ANTHROPIC_API_KEY/);
    expect(healthRouteSource).toMatch(/ai_configured/);
  });
});

// =============================================================================
// 3. Resilience Utility — Timeout Handling
// =============================================================================

describe('Resilience utility handles timeout correctly', () => {

  it('withRetry function is exported', () => {
    expect(resilienceSource).toMatch(/export\s+async\s+function\s+withRetry/);
  });

  it('wraps calls in Promise.race with a timeout', () => {
    expect(resilienceSource).toMatch(/Promise\.race/);
    expect(resilienceSource).toMatch(/setTimeout.*reject.*Timeout/);
  });

  it('has configurable timeout (default 30s)', () => {
    expect(resilienceSource).toMatch(/timeoutMs.*=\s*30000|30000.*timeoutMs/);
  });

  it('has configurable max retries (default 2)', () => {
    expect(resilienceSource).toMatch(/maxRetries.*=\s*2|2.*maxRetries/);
  });

  it('uses jittered exponential backoff', () => {
    expect(resilienceSource).toMatch(/Math\.pow\(2/);
    expect(resilienceSource).toMatch(/Math\.random/);
  });

  it('stops retrying on non-retryable status codes', () => {
    expect(resilienceSource).toMatch(/retryableStatuses/);
    expect(resilienceSource).toMatch(/!retryableStatuses\.includes/);
  });
});

// =============================================================================
// 4. SCP Provisioning Failure Is Non-Fatal
// =============================================================================

describe('SCP provisioning failure is non-fatal', () => {

  it('onboarding wraps ensureProvisioned in try/catch', () => {
    const blocks = onboardingSource.match(
      /try\s*\{[\s\S]*?ensureProvisioned[\s\S]*?\}\s*catch/g
    );
    expect(blocks).toBeTruthy();
    expect(blocks!.length).toBeGreaterThanOrEqual(1);
  });

  it('provisionSCP returns a result object instead of throwing', () => {
    // provisionSCP catches errors internally and returns ProvisionResult
    expect(provisionerSource).toMatch(/catch\s*\(err\)/);
    expect(provisionerSource).toMatch(/success:\s*false/);
    expect(provisionerSource).toMatch(/error/);
  });

  it('scheduler continues to next product if one fails', () => {
    // The scheduler's runDueAgentsForAllProducts has a try/catch inside the for loop
    // and a comment "Continue to next product" — verify the pattern
    const fn = schedulerSource.match(
      /export\s+async\s+function\s+runDueAgentsForAllProducts[\s\S]*?(?=export\s+async\s+function|$)/
    );
    expect(fn).toBeTruthy();
    const body = fn![0];
    expect(body).toMatch(/for\s*\(.*of\s+result\.rows\)/);
    expect(body).toMatch(/try\s*\{/);
    expect(body).toMatch(/catch\s*\(err\)/);
    expect(body).toMatch(/Continue to next product/);
  });
});

// =============================================================================
// 5. Voice Briefing Has AI Fallback
// =============================================================================

describe('Voice briefing degrades gracefully when AI fails', () => {

  it('voice briefing has a fallback when AI call fails', () => {
    expect(voiceBriefingSource).toMatch(/catch/);
    expect(voiceBriefingSource).toMatch(/buildFallbackBriefing|fallback/i);
  });

  it('fallback briefing includes the Signal score', () => {
    expect(voiceBriefingSource).toMatch(/score.*out of 100|signal.*score/i);
  });

  it('fallback briefing includes risk state context', () => {
    expect(voiceBriefingSource).toMatch(/recovery mode|elevated monitoring|operations.*stable/i);
  });
});
