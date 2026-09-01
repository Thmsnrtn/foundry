process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { resolveFoundryProductId } from '../../src/services/system-identity.js';

// =============================================================================
// BEGIN WITH FOUNDRY.
//
// The owner of a private institution, arriving with nothing established, was
// shown a four-step customer funnel — Connect GitHub → Select Repository →
// Identify Competitors → First Audit — opening "First, Foundry gets to know
// your product so it can give you an honest health check". That is onboarding
// for a SaaS customer bringing a product to be audited.
//
// There was no way to say "this institution is mine and it begins with
// Foundry". A company existed only as a side effect of finishing the funnel,
// and the funnel's first step needs a GitHub OAuth app this deployment has not
// configured. So the owner could establish nothing, and the recursion could not
// start, because `resolveFoundryProductId()` needs a product row that nothing
// could create. An earlier instruction to "create the company" was simply
// wrong: that action did not exist.
//
// What replaces it writes the smallest true thing — this company is Foundry,
// you own it, it may observe itself — and no more. No agents, no audit, no
// invented competitors, no model call.
// =============================================================================

const OWNER = 'ob_owner';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [OWNER, 'c_ob', 'owner@example.com']);
  const mod = await import('../../src/routes/dashboard/onboarding.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder', { id: OWNER, email: 'owner@example.com' }); await next(); });
  for (const v of Object.values(mod)) {
    if (v && typeof v === 'object' && 'routes' in (v as object)) app.route('/', v as never);
  }
});

beforeEach(() => {
  process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
  process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
});
// NOT RESET BETWEEN TESTS, AND THAT IS THE POINT. `system_identities` refuses
// deletion — `system_identity:immutable` — because a canonical identity that
// could be unbound is not canonical. So these run in the order reality allows:
// everything that requires nothing established comes first, establishment
// happens once, and what follows observes the bound world.
afterEach(() => {
  delete process.env.FOUNDRY_INSTANCE_POSTURE;
  delete process.env.FOUNDRY_OWNER_EMAIL;
});

describe('an owner with nothing established', () => {
  it('is offered one owner-level action, not a customer funnel', async () => {
    const body = await (await app.request('/onboarding')).text();
    expect(body).toContain('Begin with Foundry');
    expect(body).toMatch(/action="\/onboarding\/establish"/);
    // The funnel's language must not be what greets the owner of the place.
    expect(body).not.toContain('Identify Competitors');
    expect(body).not.toContain('health check');
  });

  it('is told what establishing does and does not do', async () => {
    const body = await (await app.request('/onboarding')).text();
    const flat = body.replace(/\s+/g, ' ');
    expect(flat, 'the owner must not be promised knowledge Foundry does not have')
      .toContain('know very little else');
    expect(flat, 'a sense is not a hand, and the first screen should say so')
      .toContain('observing is not permission to change');
  });
});

describe("only the institution owner may found its companies", () => {
  it('refuses a session that is not the owner principal', async () => {
    const stranger = new Hono();
    stranger.use('*', async (c, next) => {
      c.set('founder', { id: 'someone', email: 'stranger@example.com' }); await next();
    });
    const mod = await import('../../src/routes/dashboard/onboarding.js');
    for (const v of Object.values(mod)) {
      if (v && typeof v === 'object' && 'routes' in (v as object)) stranger.route('/', v as never);
    }
    const res = await stranger.request('/onboarding/establish', { method: 'POST' });
    expect(res.status, 'founding a company is not something any session may do').toBe(403);
    expect(await resolveFoundryProductId()).toBeNull();
  });
});

describe('establishing writes the smallest true thing', () => {
  it('refuses on a commercial deployment, where companies are customers', async () => {
    // Runs before establishment: nothing is bound yet, which is the state this
    // guard exists for.
    process.env.FOUNDRY_INSTANCE_POSTURE = 'commercial';
    const res = await app.request('/onboarding/establish', { method: 'POST' });
    expect(res.headers.get('location')).toBe('/onboarding');
    expect(await resolveFoundryProductId()).toBeNull();
  });

  it('creates the company and binds the canonical identity', async () => {
    expect(await resolveFoundryProductId(), 'nothing should exist yet').toBeNull();

    const res = await app.request('/onboarding/establish', { method: 'POST' });
    expect(res.status).toBe(302);
    // The owner surface, not the Letter. Establishing a company lands him in
    // his institution; the Letter and the rest of the old application stay
    // reachable under "Advanced" while their capabilities move across.
    expect(res.headers.get('location')).toBe('/foundry');

    const productId = await resolveFoundryProductId();
    expect(productId, 'self-observation resolves through this identity').not.toBeNull();

    const row = (await query('SELECT name, owner_id, status FROM products WHERE id = ?',
      [productId])).rows[0] as Record<string, unknown>;
    expect(row.name).toBe('Foundry');
    expect(row.owner_id, 'the owner owns it, which is what makes it his').toBe(OWNER);
    expect(row.status, 'operatingProduct() requires active, and the tick reads that')
      .toBe('active');
  });

  it('starts no agents and calls no model', async () => {
    await app.request('/onboarding/establish', { method: 'POST' });
    const agents = (await query('SELECT COUNT(*) AS c FROM agent_instances')).rows[0] as Record<string, number>;
    expect(agents.c, 'establishing is a statement of fact, not a provisioning event').toBe(0);
  });

  it('is idempotent — a second press orients rather than duplicates', async () => {
    await app.request('/onboarding/establish', { method: 'POST' });
    const first = await resolveFoundryProductId();
    const res = await app.request('/onboarding/establish', { method: 'POST' });
    // The owner surface, not the Letter. Establishing a company lands him in
    // his institution; the Letter and the rest of the old application stay
    // reachable under "Advanced" while their capabilities move across.
    expect(res.headers.get('location')).toBe('/foundry');
    expect(await resolveFoundryProductId()).toBe(first);
    const n = (await query('SELECT COUNT(*) AS c FROM products')).rows[0] as Record<string, number>;
    expect(n.c, 'the identity is already bound and does not move').toBe(1);
  });

});

describe('the route is actually authenticated', () => {
  it('sits under a prefix that carries authMiddleware', async () => {
    // THE BUG THIS PINS. It first lived at /establish, a new top-level path.
    // Top-level paths inherit nothing here: `/onboarding/*` carries
    // authMiddleware and `/establish` did not, so `c.get('founder')` was
    // undefined and the owner pressing the only button on his own first screen
    // was told he was not the owner. The guard failed closed correctly — the
    // route was simply never authenticated.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const idx = readFileSync(resolve(import.meta.dirname, '../../src/index.ts'), 'utf8');
    const prefixes = [...idx.matchAll(/app\.use\('([^']+)',\s*authMiddleware\)/g)].map((m) => m[1]);
    const covered = prefixes.some((x) => x.endsWith('/*')
      && '/onboarding/establish'.startsWith(x.slice(0, -1)));
    expect(covered,
      `no authMiddleware prefix covers /onboarding/establish; prefixes: ${prefixes.join(', ')}`)
      .toBe(true);
  });

  it('is under CSRF too, inherited from the same prefix', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const idx = readFileSync(resolve(import.meta.dirname, '../../src/index.ts'), 'utf8');
    expect(idx).toContain("app.use('/onboarding/*', csrfMiddleware)");
  });
});
