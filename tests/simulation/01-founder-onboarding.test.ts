// =============================================================================
// Simulation 01: the path from signing in to a first company
//
// This verified "signup to first product + SCP provisioning" through a
// nine-route commercial wizard: GitHub OAuth, repository selection, five
// competitors, a first audit, a subscription plan deciding how many companies
// you were allowed. That wizard is deleted. What remains is one act — naming
// the institution's first company and binding it to the canonical identity —
// and the parts of the old path that were never about selling: the Clerk
// webhook, lifecycle-state initialisation, and the agent roster.
//
// Static analysis of route handlers, schemas and service wiring.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
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

  it('extracts the VERIFIED PRIMARY email from the Clerk payload', () => {
    // This asserted `/email_addresses.*email_address/` — that the webhook read
    // the address off the payload at all. It did, from `[0]`: the first entry
    // in an array, neither necessarily primary nor necessarily verified. Since
    // `founders.email` is what `isFounder` compares against to admit the
    // platform-operator surface, that made an admin boundary out of array
    // order. The webhook now resolves it through the shared helper, and the
    // assertion moved with it: reading the payload is not the property worth
    // pinning, reading the right address is.
    expect(authRouteSource).toMatch(/email_addresses/);
    expect(authRouteSource).toContain('verifiedPrimaryEmail(');
    expect(authRouteSource).toContain('primary_email_address_id');
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

// PRODUCT CREATION WAS A WIZARD STEP. IT IS AN ESTABLISHMENT ACT NOW.
//
// Five checks here read the deleted `POST /onboarding/create-product`: that it
// existed, that it validated a `createProductSchema`, that a name was at least
// one character, that `build_platform` admitted Bubble, Webflow and Shopify,
// and that `productLimits` refused a second company to anyone on Solo. That
// last one is the shape of the whole section: a company was something a
// SUBSCRIPTION entitled you to, and the wizard counted yours against your plan.
//
// There is one owner here and he is not on a plan. The act that creates the
// first company is `POST /onboarding/establish`, and it writes the smallest
// true thing — a company named Foundry, owned by him, bound to the canonical
// identity so self-observation can resolve it. That is what is checked now.

describe('Establishing the institution\'s first company', () => {

  it('POST /onboarding/establish exists and is owner-guarded', () => {
    expect(onboardingRouteSource).toMatch(
      /onboardingRoutes\.post\(['"]\/onboarding\/establish['"],\s*requireInstitutionOwner\(\)/
    );
  });

  it('refuses to establish anything in a commercial deployment', () => {
    // The posture check and the ownership check answer different questions —
    // "is this deployment private" and "may this caller found a company" — and
    // neither stands in for the other.
    expect(onboardingRouteSource).toMatch(/if\s*\(!isPrivateOwnerInstance\(\)\)\s*return/);
  });

  it('is idempotent: an identity already bound does not move', () => {
    const handler = onboardingRouteSource.slice(
      onboardingRouteSource.indexOf("onboardingRoutes.post('/onboarding/establish'"));
    expect(handler).toMatch(/resolveFoundryProductId\(\)/);
    expect(handler.indexOf('existing')).toBeLessThan(handler.indexOf('INSERT INTO products'));
  });

  it('binds the new company to the canonical foundry identity', () => {
    expect(onboardingRouteSource).toMatch(/establishSystemIdentity\(FOUNDRY_IDENTITY_KEY/);
  });

  it('sits under /onboarding, which is where auth and CSRF are registered', () => {
    // It first lived at `/establish`, a new top-level path, and top-level paths
    // in this app inherit nothing: `c.get('founder')` was undefined and the
    // owner pressing the only button on his first screen was told he was not
    // the owner. The guard failed closed correctly; the route was never
    // authenticated.
    const index = readFileSync(resolve(SRC, 'index.ts'), 'utf-8');
    expect(index).toMatch(/app\.use\('\/onboarding\/\*', authMiddleware\)/);
    expect(index).toMatch(/app\.use\('\/onboarding\/\*', csrfMiddleware\)/);
    expect(onboardingRouteSource).not.toMatch(/\.post\(['"]\/establish['"]/);
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

  it('establishment provisions NOTHING, and that is the point', () => {
    // The wizard called `ensureProvisioned` the moment a company existed, so a
    // founder who had typed a name and a URL had nine agents running against
    // it. Establishment writes three true things and stops: this company is
    // Foundry, you own it, it may begin observing itself. The page says so in
    // as many words — "No agents are started, nothing is audited and no model
    // is called" — and a page that says that must be telling the truth.
    expect(onboardingRouteSource).not.toMatch(/ensureProvisioned/);
    expect(onboardingRouteSource).toMatch(/No agents are started, nothing is audited/);
  });

  it('provisions one agent for every agent that exists, and no others', () => {
    // THIS USED TO ASSERT THE NUMBER 24 — twelve agents times two quote
    // characters each — and it broke the day the roster became nine.
    //
    // A hardcoded count is not the invariant. `ALL_AGENTS` is the closed
    // vocabulary three dynamic `import()` loaders narrow through, and one of
    // those names arrives from an `agent_instances` ROW, so the thing that
    // actually matters is that every name the provisioner writes has a MODULE
    // ON DISK to load. A name without a file is a row that resolves to a
    // missing module at runtime, in production; a file without a name is an
    // agent nobody is ever given.
    //
    // So the two sets are compared directly. The count follows from them and
    // never needs editing again.
    expect(provisionerSource).toMatch(/ALL_AGENTS/);

    const agentList = typesSource.match(
      /ALL_AGENTS:\s*AgentName\[\]\s*=\s*\[([\s\S]*?)\]/
    );
    expect(agentList, 'ALL_AGENTS is no longer an array literal').toBeTruthy();
    const provisioned = [...agentList![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();

    // `base`, `challenger` and `synthesizer` are scaffolding, not agents: they
    // are never provisioned and never loaded by name.
    const SCAFFOLDING = new Set(['base.ts', 'challenger.ts', 'synthesizer.ts']);
    const onDisk = readdirSync(resolve(SRC, 'services/scp/agents'))
      .filter((f) => f.endsWith('.ts') && !SCAFFOLDING.has(f))
      .map((f) => f.replace(/\.ts$/, '')).sort();

    expect(provisioned,
      'every provisioned agent must have a module, and every module an agent')
      .toEqual(onDisk);
    expect(provisioned.length).toBeGreaterThan(0);
  });

  it('provisioner creates SCP constitution', () => {
    expect(provisionerSource).toMatch(/INSERT INTO scp_constitutions/i);
  });

  it('provisioner uses ON CONFLICT to prevent duplicate agents', () => {
    expect(provisionerSource).toMatch(
      /ON CONFLICT\(product_id,\s*agent_name\)\s*DO NOTHING/i
    );
  });

  it('provisioning failure is non-fatal where provisioning happens', () => {
    // This read the onboarding route, where `ensureProvisioned` was wrapped in
    // a try/catch so a failed agent roster did not cost a founder the company
    // they had just created. Onboarding no longer provisions; the guarantee
    // belongs to the provisioner, which swallows a per-agent failure rather
    // than abandoning the roster half-written.
    expect(provisionerSource).toMatch(/catch/);
  });

  it('provisioner sets SCP status to active on success', () => {
    expect(provisionerSource).toMatch(/scp_status='active'/);
  });
});

// =============================================================================
// 5. COMPETITOR ADDITION — THE SECTION THAT WENT WITH THE FUNNEL.
//
// Five checks read `GET` and `POST /onboarding/competitors`: that the form
// existed, that it inserted into `competitors`, that the insert carried
// `product_id` for tenant scoping, that ownership was verified first, and that
// it redirected on to the audit step.
//
// Asking a founder to name five competitors was step four of bringing a product
// in to be audited. The owner's instance holds no competitors and no
// repositories, the wizard is deleted, and the audit it led to was a paid model
// run on a stranger's codebase. The `competitors` table still stands and is
// still read — what is gone is the funnel that filled it.
// =============================================================================
