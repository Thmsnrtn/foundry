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
//   5. There is ONE of it. The first version had three tabs, four status lines
//      and six chips — a dashboard with a chat box. Every element was true and
//      none was why he opened it.
// =============================================================================

const OWNER = 'os_owner';
const COMPANY = 'os_company';
let app: Hono;

const get = async (path: string) => {
  const res = await app.request(path, { headers: { cookie: `foundry_product=${COMPANY}` } });
  expect(res.status).toBe(200);
  return res.text();
};

/** What the page SAYS, whitespace collapsed as a browser collapses it. Asserting
 *  on raw HTML makes a sentence that happens to wrap in the template look like a
 *  missing sentence, which is a test failing on its own formatting. */
const reads = async (path: string) => (await get(path))
  .replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

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
  it('orients in one sentence', async () => {
    const body = await get('/foundry');
    expect(body).toContain('Thomas');
    expect(body).toContain('One thing needs you');
  });

  it('does not report machinery he did not ask about', async () => {
    // A routine count and a spend of zero are true, measurable, and not why he
    // opened this. They are answers now, not the first screen.
    const body = await get('/foundry');
    expect(body).not.toContain('routine');
    expect(body).not.toContain('$0.00');
    expect(body).not.toContain('Portfolio');
    expect(body).not.toContain('Controls');
  });

  it('shows exactly one thing to act on', async () => {
    const body = await get('/foundry');
    // The card itself, not `one-in` inside it: a prefix match counted the
    // wrapper and its own body as two cards.
    expect((body.match(/class="one(?: alert)?"/g) ?? [])).toHaveLength(1);
    // One primary action, so there is never a question of where to press.
    expect((body.match(/class="btn go"/g) ?? [])).toHaveLength(1);
  });

  it('leads with the decision, not a form', async () => {
    const body = await get('/foundry');
    expect(body).toContain('Keep my internal map accurate');
    // The QUESTION is the heading, and the button states the resulting state.
    // "Hold me to that" had personality and left the consequence ambiguous.
    expect(body).toContain('Is this worth looking after?');
    expect(body).toContain('Yes — worth looking after');
    expect(body).toContain('Recognition');
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

  it('does not advertise a prompt library while something needs him', async () => {
    // Suggestions are for a quiet day. Beside a decision they compete with it.
    const body = await get('/foundry');
    expect(body).not.toContain('Are you okay?');
  });
});

describe('asking it something', () => {
  it('answers what happened from what actually happened', async () => {
    const body = await get('/foundry?ask=today');
    expect(body).toContain('I checked 1 thing about myself');
    expect(body).toContain('All of them still match');
  });

  it('answers whether it is okay, without overclaiming', async () => {
    // Nothing has run in this database, and the answer says exactly that rather
    // than reassuring him on the strength of no evidence.
    const said = await reads('/foundry?ask=okay');
    expect(said).toContain('Yes.');
    expect(said).toContain('I have not run anything yet, so there is not much to go on');
  });

  it('answers what the owner owns without a Portfolio to visit', async () => {
    const said = await reads('/foundry?ask=companies');
    expect(said).toContain('One: Foundry');
    expect(said).toContain('you have not connected anything');
    expect(said).toContain('no point pretending to compare one');
  });

  it('answers what it may do without a Controls to visit', async () => {
    const said = await reads('/foundry?ask=allowed');
    expect(said).toContain('Nothing.');
    expect(said).toContain('I cannot change anything, spend anything, or contact anyone');
    expect(said).toContain('I have spent nothing');
  });

  it('understands typed words, not only the buttons', async () => {
    const said = await reads('/foundry?q=' + encodeURIComponent('are you ok?'));
    expect(said).toContain('I have not run anything yet');
    const owned = await reads('/foundry?q=' + encodeURIComponent('what companies do I own'));
    expect(owned).toContain('One: Foundry');
  });

  it('says plainly when it cannot answer instead of improvising', async () => {
    const said = await reads('/foundry?q=' + encodeURIComponent('draft a plan for hiring'));
    expect(said).toContain("I don't know yet");
    expect(said).toContain('rather say that than make something up');
  });

  it('never claims a routine ran when none has', async () => {
    // No `job_health` rows exist here. An early draft said "Everything I run is
    // running normally — 0 routines", which is a reassurance about nothing.
    const said = await reads('/foundry?ask=today');
    expect(said).toContain('I have not run anything yet');
    expect(said).not.toContain('0 routine');
  });
});

describe('the places that stopped being places', () => {
  it('has no Portfolio or Controls to visit', async () => {
    // They were rooms containing a sentence each: one company he established,
    // and "nothing, right now". They are answers until there is a second
    // company or a permission to withdraw.
    for (const gone of ['/foundry/portfolio', '/foundry/controls']) {
      const res = await app.request(gone, { headers: { cookie: `foundry_product=${COMPANY}` } });
      expect(res.status).toBe(404);
    }
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

    const said = await reads('/foundry');
    // A DIFFERENT ACT, NAMED AS ONE. Recognition and responsibility are not the
    // same owner decision and the card never lets them read as one.
    expect(said).toContain('Responsibility');
    expect(said).toContain('Can I take responsibility for this?');
    expect(said).toContain('Yes — take responsibility');
    expect(said).toContain('One thing needs you');
    // Still no authority, and it says what it would ask for next.
    expect(said).toContain('I still cannot change anything');
    expect(said).toContain('this permits no changes');
    expect(said).toContain('Permission to do the work, for seven days');
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
    for (const path of ['/foundry']) {
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
