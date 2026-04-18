// =============================================================================
// Simulation 01: Founder Onboarding Journey
// Verifies the critical path from signup to first product + SCP provisioning.
// Uses static analysis to verify route handlers, schemas, and service wiring.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../../src');

let authRouteSource: string;
let onboardingRouteSource: string;
let provisionerSource: string;
let typesSource: string;
let lifecycleMonitorSource: string;
let schemaSource: string;
let clientSource: string;

beforeAll(() => {
  authRouteSource = readFileSync(resolve(SRC, 'routes/auth/clerk.ts'), 'utf-8');
  onboardingRouteSource = readFileSync(resolve(SRC, 'routes/dashboard/onboarding.ts'), 'utf-8');
  provisionerSource = readFileSync(resolve(SRC, 'services/scp/provisioner.ts'), 'utf-8');
  typesSource = readFileSync(resolve(SRC, 'services/scp/types.ts'), 'utf-8');
  lifecycleMonitorSource = readFileSync(resolve(SRC, 'services/lifecycle/monitor.ts'), 'utf-8');
  schemaSource = readFileSync(resolve(SRC, 'db/schema.sql'), 'utf-8');
  clientSource = readFileSync(resolve(SRC, 'db/client.ts'), 'utf-8');
});

// =============================================================================
// 1. Signup Flow — Clerk webhook creates founder record
// =============================================================================

describe('Signup flow (Clerk webhook → founder record)', () => {

  it('webhook handler processes user.created event', () => {
    expect(authRouteSource).toMatch(/payload\.type\s*===\s*['"]user\.created['"]/);
  });

  it('creates a founder record with INSERT INTO founders', () => {
    // After user.created check, there should be an INSERT INTO founders
    const userCreatedBlock = authRouteSource.slice(
      authRouteSource.indexOf("payload.type === 'user.created'")
    );
    expect(userCreatedBlock).toMatch(/INSERT INTO founders/i);
  });

  it('extracts email from Clerk payload', () => {
    expect(authRouteSource).toMatch(/email_addresses.*email_address/);
  });

  it('creates Stripe customer during signup', () => {
    expect(authRouteSource).toMatch(/createCustomer/);
  });

  it('webhook verifies Svix signature to prevent spoofing', () => {
    expect(authRouteSource).toMatch(/svix-id/);
    expect(authRouteSource).toMatch(/svix-timestamp/);
    expect(authRouteSource).toMatch(/svix-signature/);
    expect(authRouteSource).toMatch(/createHmac.*sha256/);
  });
});

// =============================================================================
// 2. Product Creation — No-code path (form-based)
// =============================================================================

describe('Product creation (no-code path)', () => {

  it('POST /onboarding/create-product route exists', () => {
    expect(onboardingRouteSource).toMatch(
      /onboardingRoutes\.post\(['"]\/onboarding\/create-product['"]/
    );
  });

  it('validates input with Zod schema (createProductSchema)', () => {
    expect(onboardingRouteSource).toMatch(/createProductSchema/);
    expect(onboardingRouteSource).toMatch(/z\.object/);
  });

  it('requires product name (min 1 char)', () => {
    expect(onboardingRouteSource).toMatch(/name:\s*z\.string\(\)\.min\(1/);
  });

  it('supports multiple build platforms (Bubble, Webflow, etc.)', () => {
    const platformEnum = onboardingRouteSource.match(/build_platform:\s*z\.enum\(\[([^\]]+)\]/);
    expect(platformEnum).toBeTruthy();
    const platforms = platformEnum![1];
    expect(platforms).toMatch(/bubble/);
    expect(platforms).toMatch(/webflow/);
    expect(platforms).toMatch(/shopify/);
  });

  it('enforces per-tier product limits', () => {
    expect(onboardingRouteSource).toMatch(/productLimits/);
    expect(onboardingRouteSource).toMatch(/solo.*1|1.*solo/);
    expect(onboardingRouteSource).toMatch(/growth.*3|3.*growth/);
    expect(onboardingRouteSource).toMatch(/investor_ready/);
  });
});

// =============================================================================
// 3. Lifecycle State Initialization
// =============================================================================

describe('Lifecycle state initialization', () => {

  it('inserts lifecycle_state row during product creation', () => {
    expect(onboardingRouteSource).toMatch(
      /INSERT INTO lifecycle_state.*product_id.*current_prompt.*risk_state/i
    );
  });

  it('sets initial risk_state to green', () => {
    const lifecycleInserts = onboardingRouteSource.match(
      /INSERT INTO lifecycle_state[^;]+/g
    );
    expect(lifecycleInserts).toBeTruthy();
    const anyGreen = lifecycleInserts!.some((s) => s.includes("'green'"));
    expect(anyGreen).toBe(true);
  });

  it('sets initial prompt to prompt_1', () => {
    expect(onboardingRouteSource).toMatch(/prompt_1/);
  });

  it('lifecycle_state table exists in schema with product_id FK', () => {
    expect(schemaSource).toMatch(/CREATE TABLE.*lifecycle_state/i);
    expect(schemaSource).toMatch(/lifecycle_state[\s\S]*?product_id/i);
  });
});

// =============================================================================
// 4. SCP Provisioning
// =============================================================================

describe('SCP provisioning during onboarding', () => {

  it('onboarding calls ensureProvisioned after product creation', () => {
    expect(onboardingRouteSource).toMatch(/ensureProvisioned/);
  });

  it('provisioner creates exactly 12 agent instances', () => {
    expect(provisionerSource).toMatch(/ALL_AGENTS/);
    // ALL_AGENTS should have 12 entries
    const agentList = typesSource.match(
      /ALL_AGENTS:\s*AgentName\[\]\s*=\s*\[([\s\S]*?)\]/
    );
    expect(agentList).toBeTruthy();
    const agents = agentList![1].match(/'/g);
    expect(agents).toBeTruthy();
    expect(agents!.length).toBe(24); // 12 agents × 2 quotes each
  });

  it('provisioner creates SCP constitution', () => {
    expect(provisionerSource).toMatch(/INSERT INTO scp_constitutions/i);
  });

  it('provisioner uses ON CONFLICT to prevent duplicate agents', () => {
    expect(provisionerSource).toMatch(
      /ON CONFLICT\(product_id,\s*agent_name\)\s*DO NOTHING/i
    );
  });

  it('provisioning failure is non-fatal (caught in try/catch)', () => {
    // In the onboarding route, ensureProvisioned is wrapped in try/catch
    const provisionBlock = onboardingRouteSource.match(
      /try\s*\{[\s\S]*?ensureProvisioned[\s\S]*?\}\s*catch/
    );
    expect(provisionBlock).toBeTruthy();
  });

  it('provisioner sets SCP status to active on success', () => {
    expect(provisionerSource).toMatch(/scp_status='active'/);
  });
});

// =============================================================================
// 5. Competitor Addition
// =============================================================================

describe('Competitor identification step', () => {

  it('GET /onboarding/competitors route exists', () => {
    expect(onboardingRouteSource).toMatch(
      /onboardingRoutes\.get\(['"]\/onboarding\/competitors['"]/
    );
  });

  it('POST /onboarding/competitors inserts competitor records', () => {
    expect(onboardingRouteSource).toMatch(/INSERT INTO competitors/i);
  });

  it('competitor insertion includes product_id for tenant scoping', () => {
    const competitorInsert = onboardingRouteSource.match(
      /INSERT INTO competitors[^;]+/
    );
    expect(competitorInsert).toBeTruthy();
    expect(competitorInsert![0]).toMatch(/product_id/);
  });

  it('verifies product ownership before adding competitors', () => {
    // After POST /onboarding/competitors, there should be an ownership check
    const competitorPost = onboardingRouteSource.slice(
      onboardingRouteSource.indexOf("onboardingRoutes.post('/onboarding/competitors'")
    );
    expect(competitorPost).toMatch(/owner_id\s*=\s*\?/);
  });

  it('redirects to audit step after competitor addition', () => {
    expect(onboardingRouteSource).toMatch(
      /redirect.*\/onboarding\/audit\?product_id=/
    );
  });
});
