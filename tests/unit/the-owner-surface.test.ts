process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// THE OWNER SURFACE.
//
// The owner opened his institution on his phone and said he had no clue what
// was happening. The page was answering in the vocabulary of the machinery:
// thirty destinations, `schema-snapshot-freshness`, `visible`, eight empty
// questions about a database he did not build.
//
// This is the surface that replaces it, and these are the properties that make
// it that rather than a nicer skin:
//
//   1. It is built from real institutional state, through the same services.
//   2. It answers a question it can answer, and SAYS SO when it cannot, rather
//      than improvising something that sounds right.
//   3. The internal vocabulary does not reach it. A check's identifier, a
//      ladder state and a table name are all findable one disclosure down, and
//      none of them is the sentence.
//   4. What needs the owner is a decision, not a form.
// =============================================================================

const OWNER = 'os_owner';
const COMPANY = 'os_company';
let app: Hono;

const get = async (path: string) => {
  const res = await app.request(path, { headers: { cookie: `foundry_product=${COMPANY}` } });
  expect(res.status).toBe(200);
  return res.text();
};

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_os', 'owner@example.com', 'Thomas Norton']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd)
    VALUES (?,'Foundry',?,'active',50)`, [COMPANY, OWNER]);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary,processed)
    VALUES ('os_a',?,'development_verification','development_verified:schema-snapshot-freshness:passed','low',?,?,0)`,
    [COMPANY, JSON.stringify({
      check: 'schema-snapshot-freshness', result: 'passed',
      detail: '695 schema objects, all described by docs/db/schema.snapshot.sql',
      observed_at: '2026-09-01T01:30:32.041Z',
    }), 'schema-snapshot-freshness reported passed']);

  const { proposeResponsibilityCandidate } = await import(
    '../../src/services/institution/responsibility-candidate.js');
  await proposeResponsibilityCandidate({
    productId: COMPANY, convergenceKey: 'self_maintenance:schema-snapshot-freshness',
    proposedResponsibility:
      'regenerate the committed schema snapshot after a migration changes the schema',
    evidenceRefs: [{ kind: 'signal_event', id: 'os_a' }],
    derivationMethod: 'self_maintenance_scope', rationale: 'runs independently',
    epistemicStatus: 'known', capabilityDependency: 'development',
    authorityRequired: true, observedAt: new Date(),
  });

  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', foundryShellRoutes);
});

describe('opening Foundry', () => {
  it('orients from real state in the owner\'s language', async () => {
    const body = await get('/foundry');
    expect(body).toContain('Thomas');
    expect(body).toContain('One thing needs you');
    // Read from the product row, not invented.
    expect(body).toContain('$0.00');
    expect(body).toContain('$50');
  });

  it('leads with the decision, not a form', async () => {
    const body = await get('/foundry');
    expect(body).toContain('Keep my internal map accurate');
    expect(body).toContain('Yes, that is mine');
    // The eight-question wall is gone from the owner's path entirely.
    expect(body).not.toContain('In your own words');
    expect(body).not.toContain('What is &quot;regenerate');
  });

  it('keeps the machinery one disclosure down rather than on the page', async () => {
    const body = await get('/foundry');
    // WHAT THE OWNER READS, not the markup. The first version of this checked
    // the raw HTML and failed on `focus-visible` in a stylesheet — an assertion
    // about jargon has to look at prose, or it fails on CSS and passes on
    // nothing that matters.
    const readable = body.replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]*>/g, ' ');
    const [above] = readable.split('Technical details');
    // None of the institution's internal vocabulary is the sentence.
    for (const jargon of ['schema-snapshot-freshness', 'capability development',
      'signal_event', 'institutional_responsibilities', 'visible']) {
      expect(above).not.toContain(jargon);
    }
    // But it is genuinely reachable, because evidence may not be hidden.
    expect(body).toContain('Technical details');
    expect(body).toContain('schema-snapshot-freshness');
  });

  it('offers no destination the owner has to learn', async () => {
    const body = await get('/foundry');
    for (const door of ['Signal', 'Ambient', 'Roster', 'Debate', 'Multi-Modal',
      'Investor Hub', 'Standing Orders', 'Benchmarks']) {
      expect(body).not.toContain('>' + door + '<');
    }
    expect(body).toContain('Advanced — inspect the system');
  });
});

describe('asking it something', () => {
  it('answers what happened from what actually happened', async () => {
    const body = await get('/foundry?ask=today');
    expect(body).toContain('I checked 1 thing about myself');
    expect(body).toContain('All of them still match');
  });

  it('answers whether it is okay, and what that is based on', async () => {
    const body = await get('/foundry?ask=okay');
    expect(body).toContain('everything I watch still matches');
    expect(body).toContain('1 check matching');
  });

  it('understands typed words, not only the buttons', async () => {
    const body = await get('/foundry?q=' + encodeURIComponent('are you ok?'));
    expect(body).toContain('everything I watch still matches');
  });

  it('says plainly when it cannot answer instead of improvising', async () => {
    const body = await get('/foundry?q=' + encodeURIComponent('what is our revenue in Germany'));
    expect(body).toContain('cannot answer that one yet');
    expect(body).toContain('rather say so than improvise');
  });

  it('never claims a routine ran when none has', async () => {
    // No `job_health` rows exist here. The first draft said "Everything I run is
    // running normally — 0 routines", which is a reassurance about nothing.
    const body = await get('/foundry');
    expect(body).toContain('I have not run anything yet');
    expect(body).not.toContain('0 routine');
  });
});

describe('the other two places', () => {
  it('shows the one company that exists and does not imply others', async () => {
    const body = await get('/foundry/portfolio');
    expect(body).toContain('Foundry');
    expect(body).toContain('nothing is connected yet');
    expect(body).toContain('only company you have given me');
  });

  it('states authority as what it is: nothing', async () => {
    const body = await get('/foundry/controls');
    expect(body).toContain('Nothing, right now');
    expect(body).toContain('cannot change anything');
    expect(body).toContain('Stop everything');
  });
});

describe('an obligation it already understands', () => {
  it('offers the one judgment that is genuinely the owner\'s, and calls it needed', async () => {
    // Foundry may not predict on its own behalf, so the expectation is his —
    // and until he states it, the obligation is stopped. A surface that showed
    // it as understood with nothing to do would be the dead end this cutover
    // exists to remove.
    const { promoteResponsibilityCandidate } = await import(
      '../../src/services/institution/responsibility-candidate.js');
    const candidate = (await query(
      'SELECT id FROM responsibility_candidates WHERE product_id=?', [COMPANY],
    )).rows[0] as Record<string, unknown>;
    const rid = await promoteResponsibilityCandidate({
      productId: COMPANY, candidateId: String(candidate.id),
      mechanism: 'authenticated_owner', ownerId: OWNER,
    });
    const { describeOwnSelfMaintenance } = await import(
      '../../src/services/foundry/self-observation.js');
    await describeOwnSelfMaintenance({ productId: COMPANY });
    const { earnResponsibilityUnderstanding } = await import(
      '../../src/services/institution/responsibility-understanding.js');
    await earnResponsibilityUnderstanding(COMPANY, rid);

    const body = await get('/foundry');
    expect(body).toContain('I understand what it is');
    expect(body).toContain('Yes — hold me to that');
    expect(body).toContain('One thing needs you');
    // And it is still only watching: no permission is implied or requested.
    expect(body).toContain('I still cannot change anything');
  });
});

describe('the surface is private', () => {
  it('is registered under authMiddleware, not guarded only by its own handlers', async () => {
    // A NEW TOP-LEVEL PATH INHERITS NOTHING HERE. `/foundry` lives inside the
    // Letter's router, but auth is registered by PATH on the app — so mounting
    // it there authenticated nothing. Deployed, it answered anonymous callers
    // with a redirect while `/letter` answered 401, and the only thing between
    // a stranger and the owner's institution was a null check inside one
    // handler. This deployment already paid for that lesson once, at
    // POST /establish.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const idx = readFileSync(resolve(import.meta.dirname, '../../src/index.ts'), 'utf8');
    const prefixes = [...idx.matchAll(/app\.use\('([^']+)',\s*authMiddleware\)/g)].map((m) => m[1]);
    for (const path of ['/foundry', '/foundry/portfolio', '/foundry/controls']) {
      const covered = prefixes.some((x) => x === path
        || (x.endsWith('/*') && path.startsWith(x.slice(0, -1))));
      expect(covered, `no authMiddleware prefix covers ${path}`).toBe(true);
    }
  });

  it('carries CSRF, so the first mutating form added here is covered by construction', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const idx = readFileSync(resolve(import.meta.dirname, '../../src/index.ts'), 'utf8');
    expect(idx).toContain("app.use('/foundry/*', csrfMiddleware)");
  });
});
