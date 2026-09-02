process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
// A PRIVATE-OWNER DEPLOYMENT, WHICH IS WHAT THIS FIXTURE ALWAYS DESCRIBED.
// Without it `requireInstitutionOwner()` refuses, and the owner-gated routes
// here were only passing because they had no guard yet.
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

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
    // opened this. They are answers and other places now, not the first screen.
    const body = await get('/foundry');
    expect(body).not.toContain('routine');
    expect(body).not.toContain('$0.00');
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

describe('places he can walk to', () => {
  // READING "TOO TECHNICAL" AS "TOO MUCH INTERFACE" WAS THE ERROR. The old
  // thirty doors were bad because they exposed machinery — Ambient, Roster,
  // Multi-Modal — not because destinations are bad. Stripping to a chat box
  // left him with nowhere to do anything, and he said so.
  it('offers three, named for his world rather than the institution', async () => {
    const body = await get('/foundry');
    expect(body).toContain('/foundry/companies');
    expect(body).toContain('/foundry/controls');
    // The second place is the portfolio: what he owns, as a river rather than
    // a list. The tab carries an icon, so the word follows the glyph.
    expect(body).toContain('Portfolio</a>');
    expect(body).toContain('Controls</a>');
  });

  it('lists his companies and offers to add one', async () => {
    const body = await get('/foundry/companies');
    const said = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    expect(said).toContain('Portfolio');
    expect(said).toContain('Foundry');
    // The prompt lives in a placeholder attribute, so it is read from the markup.
    expect(body).toContain('Add a company by name');
    // Adding is not connecting, and not permission.
    expect(said).toContain('It does not connect anything or let me do anything');
  });

  it('shows a company as what is known and what is missing, not empty charts', async () => {
    const said = await reads(`/foundry/companies/${COMPANY}`);
    expect(said).toContain('What I know');
    expect(said).toContain('What I cannot see');
    // MIGRATION 226 MADE THIS SENSE-DERIVED. The list used to be three
    // hardcoded sentences asserted unconditionally — which is how a company
    // reporting revenue came to be told, four inches below the figure, that
    // Foundry could not see any money. It is now what is actually missing, and
    // each gap names who could fix it.
    expect(said).toContain('I cannot see what it earns');
    expect(said).toContain('would show me revenue, subscriptions, failed payments');
    // The distinction that governs every connection.
    expect(said).toContain('Letting me read something never lets me change it');
  });

  it('asks what he is trying to do, and keeps it', async () => {
    const before = await reads(`/foundry/companies/${COMPANY}`);
    expect(before).toContain('You have not told me what you are trying to do');

    // MIGRATION 225 MOVED THIS. Stating what a company is for used to be
    // written into `company_okrs`, which invented a quarter, a status and a
    // progress figure the owner never gave. It is now standing intent, and it
    // takes the same sentence through a confirmation that says what it will do
    // before anything binds.
    const shown = await app.request(`/foundry/companies/${COMPANY}/said`, {
      method: 'POST',
      headers: { cookie: `foundry_product=${COMPANY}`,
        'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ said: 'Get the first ten paying customers' }),
    });
    expect(shown.status).toBe(200);
    expect(await shown.text()).toContain('what Foundry is for right now');

    const res = await app.request(`/foundry/companies/${COMPANY}/said/confirm`, {
      method: 'POST',
      headers: { cookie: `foundry_product=${COMPANY}`,
        'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ said: 'Get the first ten paying customers' }),
    });
    expect(res.headers.get('location')).toBe(`/foundry/companies/${COMPANY}?done=steered`);

    const after = await reads(`/foundry/companies/${COMPANY}?done=steered`);
    expect(after).toContain('Get the first ten paying customers');
    expect(after).toContain('I will weigh that when I decide what is worth your attention');
  });

  it('refuses a company that is not his, without saying whether it exists', async () => {
    await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('os_other','c_o','o@e.com')");
    await query("INSERT INTO products (id,name,owner_id,status) VALUES ('os_theirs','Theirs','os_other','active')");
    const mine = await app.request('/foundry/companies/os_theirs',
      { headers: { cookie: `foundry_product=${COMPANY}` } });
    expect(mine.status).toBe(404);
  });

  it('states permissions, money and the stop in one place', async () => {
    const said = await reads('/foundry/controls');
    expect(said).toContain('None.');
    expect(said).toContain('cannot change anything, spend anything, or contact anyone');
    expect(said).toContain('Stop everything');
    expect(said).toContain('a month is the limit you set');
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

describe('every way in leads to the owner surface', () => {
  it('signs him in to his institution, not to the old application', async () => {
    // WHAT HE ACTUALLY EXPERIENCED. He tapped a link to /foundry, was not
    // signed in on that navigation, and the login page — seeing an existing
    // Clerk session — sent him straight to /dashboard. Everything shipped was
    // live and correct, and he never saw any of it.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const clerk = readFileSync(
      resolve(import.meta.dirname, '../../src/routes/auth/clerk.ts'), 'utf8');
    expect(clerk).not.toContain('"/dashboard"');
    expect(clerk).toContain('forceRedirectUrl: "/foundry"');
    expect(clerk).toContain('fallbackRedirectUrl: "/foundry"');
  });

  it('opens the installed app on the owner surface', async () => {
    // A home-screen icon installed before the cutover opens start_url, and
    // start_url was the old dashboard.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const manifest = JSON.parse(readFileSync(
      resolve(import.meta.dirname, '../../src/public/manifest.json'), 'utf8')) as
      { start_url: string };
    expect(manifest.start_url).toBe('/foundry');
  });

  it('sends an old bookmark to the owner surface on a private deployment', async () => {
    process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
    process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
    try {
      const { dashboardRoutes } = await import('../../src/routes/dashboard/index.js');
      const backstop = new Hono();
      backstop.use('*', async (c, next) => {
        c.set('founder' as never,
          { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
        c.set('csrfToken' as never, 'test' as never);
        await next();
      });
      backstop.route('/', dashboardRoutes);
      const res = await backstop.request('/dashboard',
        { headers: { cookie: `foundry_product=${COMPANY}` } });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/foundry');
    } finally {
      delete process.env.FOUNDRY_INSTANCE_POSTURE;
      delete process.env.FOUNDRY_OWNER_EMAIL;
    }
  });
});
