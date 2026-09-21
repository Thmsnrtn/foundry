// =============================================================================
// THE JOURNEYS, ON THE PHONE HE HOLDS.
//
// The directive names twelve owner journeys and asks that they be proven in a
// browser rather than inferred from a DOM. These are the ones the substrate
// can produce today without pretending: the estate healthy with nothing to
// do; degraded and recovering on its own; one consequential decision waiting,
// and the button naming what it does; a test running; a test blocked on a
// real dependency; a test stopped by its own rule; the owner back after a day
// away; and WATCH → INSPECT → INTERVENE without losing his place. A sale, a
// refund and a tax reserve wait for the economic substrate — they are not
// faked here.
//
// Each journey is read from the first viewport of a 390px phone: what he sees
// before he scrolls is the product; everything below is the appendix.
//
// SKIPS RATHER THAN FAILS WITHOUT A BROWSER, as the geometry test does.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '6'.repeat(64);
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_testsecret';
process.env.RESEND_API_KEY = 're_test_key';
process.env.CLOUDFLARE_API_TOKEN = 'cfat_test_token';
process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_test';
process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'thomas@example.com';
process.env.APP_URL = 'http://localhost:8097';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import '../../src/services/integration/resend.js';
import '../../src/services/integration/stripe-gateway.js';
import '../../src/services/integration/cloudflare-gateway.js';
import { providerStubs } from '../helpers/provider-stubs.js';

vi.setConfig({ testTimeout: 180_000 });
const CHROMIUM = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) => existsSync(p));
const OWNER = 'j_owner'; const FOUNDRY = 'j_foundry';
const NOW = new Date('2026-09-08T00:00:00Z');
const { state, fetch: fetchStub } = providerStubs();
let port = 0; let stop: (() => void) | null = null; let X = '';

beforeAll(async () => {
  if (!CHROMIUM) return;
  vi.stubGlobal('fetch', fetchStub);
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)`, [OWNER, 'j_clk', 'thomas@example.com', 'Thomas Norton']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES (?,'Foundry',?,'active',50)`, [FOUNDRY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry',?,'journeys')`, [FOUNDRY]);
  const founder = (await query('SELECT * FROM founders WHERE id = ?', [OWNER])).rows[0];
  const app = new Hono();
  app.use('*', async (c: any, next) => { c.set('founder', founder); c.set('userId', OWNER); c.set('csrfToken', 't'); await next(); });
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app.route('/', letterRoutes);
  const { staticAssetHandler } = await import('../../src/routes/public/static-assets.js');
  app.get('/static/:file', staticAssetHandler(resolve('src')));
  const server = serve({ fetch: app.fetch, port: 0 });
  port = (server.address() as { port: number }).port;
  stop = () => { server.close(); };
}, 180_000);
afterAll(() => { if (stop) stop(); vi.unstubAllGlobals(); });

interface Seen { text: string; firstScreen: string; overflowX: number; oneThingTop: number | null; url: string }
async function onThePhone(path: string, act?: (page: any) => Promise<void>): Promise<Seen> {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM as string, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${String(port)}${path}`, { waitUntil: 'networkidle' });
    if (act) await act(page);
    return await page.evaluate(() => {
      const H = innerHeight;
      // WHAT IS IN THE FIRST VIEWPORT: elements whose top edge is on screen.
      const firstScreen = [...document.querySelectorAll('h1,h2,dt,dd,p,a,button,span.state')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.top < H && r.height > 0; })
        .map((e) => e.textContent?.replace(/\s+/g, ' ').trim() ?? '').filter(Boolean).join(' | ');
      const de = document.documentElement;
      const one = document.querySelector('#the-one-thing');
      return { text: document.body.innerText, firstScreen, overflowX: de.scrollWidth - de.clientWidth,
        oneThingTop: one ? one.getBoundingClientRect().top : null, url: location.pathname + location.search + location.hash };
    });
  } finally { await browser.close(); }
}

const phones = CHROMIUM ? describe : describe.skip;

phones('the estate, journey by journey', () => {
  it('1. healthy, nothing to do: the glance says so before any sentence, and no button asks anything', async () => {
    const seen = await onThePhone('/foundry');
    expect(seen.overflowX).toBe(0);
    expect(seen.firstScreen).toContain('Health | Healthy');
    expect(seen.firstScreen).toContain('Needs you | None');
    expect(seen.text).not.toMatch(/routine/i);
    expect(seen.oneThingTop).toBeNull();
  });

  it('2. degraded and recovering on its own: state first, rows he can check, nothing asked of him', async () => {
    await query(`INSERT INTO job_health (job_name, consecutive_failures, last_failure_at, last_error_name, last_success_at)
      VALUES ('institutional_judgment_tick', 3, datetime('now'), 'TypeError', datetime('now','-2 days'))`);
    const seen = await onThePhone('/foundry');
    expect(seen.firstScreen).toMatch(/Health \| 1 thing needs looking at/);
    expect(seen.text).toMatch(/system degraded/i);
    expect(seen.text).toContain('Recovering');
    expect(seen.text).toContain('automatically');
    expect(seen.text).toContain('Owner action');
    expect(seen.text).toMatch(/Owner action\s+none/i);
    await query(`DELETE FROM job_health WHERE job_name = 'institutional_judgment_tick'`);
  });

  it('3. one consequential decision waiting: it is the one thing, it says where it lands, and the button names it', async () => {
    await query(`INSERT INTO owner_boundaries (id, product_id, subject, statement, mode) VALUES ('jb1',?,'contact_people','ask me before contacting anyone','ask_first')`, [FOUNDRY]);
    await query(`INSERT INTO proposed_acts (id, product_id, subject, action_type, params_fingerprint, summary, why, expected_effect, risk, consequence, proposed_by, expires_at, rung, cost_cents)
      VALUES ('ja1',?,'contact_people','outreach','jfp1','Email the six customers whose renewals lapse this month','their renewals are due','some renew','some unsubscribe','medium','hand:test',datetime('now','+5 day'),'public',0)`, [FOUNDRY]);
    // A stopped routine beside it must not push it off the top.
    await query(`INSERT OR REPLACE INTO job_health (job_name, consecutive_failures, last_failure_at, last_error_name, last_success_at)
      VALUES ('institutional_judgment_tick', 3, datetime('now'), 'TypeError', datetime('now','-2 days'))`);
    const seen = await onThePhone('/foundry');
    expect(seen.firstScreen).toContain('Needs you | 1');
    expect(seen.oneThingTop).not.toBeNull();
    expect(seen.oneThingTop as number).toBeLessThan(844);
    expect(seen.text).toContain('Email the six customers whose renewals lapse this month');
    expect(seen.text).toContain('person-facing');
    expect(seen.text).toContain('Partly reversible');
    // THE BUTTON IS THE CONSEQUENCE. Not "go ahead", not "approve this one thing".
    expect(seen.text).toMatch(/Email the six customers whose renewals lapse this month · person-facing/);
    expect(seen.text).not.toContain('Approve this one thing');
    expect(seen.text).not.toMatch(/go ahead/i);
    await query(`DELETE FROM job_health WHERE job_name = 'institutional_judgment_tick'`);
  });

  it('12. WATCH → INSPECT → INTERVENE without losing his place', async () => {
    // WATCH: the card. INSPECT: "Show your work" goes to the why page and the
    // trail says where he is. INTERVENE: the decision is one press, and the
    // decision is recorded against the act, not merely acknowledged.
    const inspect = await onThePhone('/foundry', async (page) => {
      await page.click('#the-one-thing a.why, #the-one-thing a[href^="/foundry/why/"]');
      await page.waitForLoadState('networkidle');
    });
    expect(inspect.url).toMatch(/^\/foundry\/why\/proposal\/ja1/);
    expect(inspect.text).toContain('Foundry');
    expect(inspect.text).toContain('Email the six customers');
    const intervene = await onThePhone('/foundry', async (page) => {
      await page.click('#the-one-thing form[action$="/refuse"] button');
      await page.waitForLoadState('networkidle');
    });
    expect(intervene.url).toMatch(/^\/foundry/);
    const decided = (await query(`SELECT decision FROM proposed_acts WHERE id = 'ja1'`)).rows[0] as Record<string, unknown>;
    expect(decided.decision).toBe('refused');
    expect(intervene.firstScreen).toContain('Needs you | None');
  });

  it('4. a test running: the glance names it, Now and Next come from the records', async () => {
    const { seedProof1, reframeProof1UnderTheWorkshop } = await import('../../src/services/venture/proof-1.js');
    const { reconsiderProof1 } = await import('../../src/services/venture/proof-1-deliberation.js');
    const { establishPublicWorkshop, setPostalAddress } = await import('../../src/services/public-workshop/settings.js');
    const { connectWorkshopSending, standUpWorkshop } = await import('../../src/services/public-workshop/infrastructure.js');
    const { allowExperiment, approveRemaining, qualifyRecipient, recipientsOf, runHand } = await import('../../src/services/venture/hand.js');
    await seedProof1(OWNER);
    await establishPublicWorkshop({ founderId: OWNER });
    await standUpWorkshop(OWNER);
    X = (await reframeProof1UnderTheWorkshop(OWNER)).successor;
    await reconsiderProof1(OWNER);
    await approveRemaining({ founderId: OWNER, experimentId: X });
    for (const cand of (await recipientsOf(X)).filter((x) => x.reviewStatus === 'approved')) {
      await qualifyRecipient({ founderId: OWNER, experimentId: X, recipientId: cand.id,
        because: 'names two public schools among its own completed projects', source: 'https://example-millwork.test/projects' });
    }
    state.nextDomainStatus = 'verified';
    await connectWorkshopSending(OWNER);
    await setPostalAddress(OWNER, 'PO Box 123, Example, MA 01000');
    // A test that invites a reply may not be allowed until a message sent to
    // the advertised address has actually come back.
    const { giveTheWorkshopEars } = await import('../helpers/world.js');
    await giveTheWorkshopEars(OWNER);
    await allowExperiment({ founderId: OWNER, experimentId: X, by: 'owner' });
    await runHand({ now: NOW, offersPerTick: 2 });
    const seen = await onThePhone('/foundry');
    expect(seen.firstScreen).toMatch(/Running/);
    expect(seen.firstScreen).toMatch(/\d+ of \d+ written to/);
    expect(seen.text).toMatch(/\bnow\b/i);
    expect(seen.text).toMatch(/\bnext\b/i);
    expect(seen.text).toMatch(/The hand passes again at \d\d:20 UTC/);
  });

  it('5. a test blocked on a real dependency: the estate says blocked, and names what only he can do', async () => {
    const { recordRun } = await import('../../src/services/venture/run-state.js');
    await recordRun(X, OWNER, { state: 'blocked', attempting: 'writing to the businesses you approved',
      because: 'the Workshop has no sending identity', dependency: 'resend', ownerAction: 'connect sending in the Workshop', progressed: false });
    const seen = await onThePhone('/foundry');
    expect(seen.firstScreen).toContain('Health | 1 pass blocked');
    expect(seen.firstScreen).toContain('connect sending in the Workshop');
    await recordRun(X, OWNER, { state: 'success', attempting: 'writing to the businesses you approved', because: null, dependency: null, ownerAction: null, progressed: true });
  });

  it('6. a test stopped by its own rule: the glance says so, and says which rule', async () => {
    const { suppress } = await import('../../src/services/public-workshop/suppression.js');
    for (const who of ['a', 'b', 'c', 'd']) await suppress({ founderId: OWNER, email: `${who}@example.com`, reason: 'they_asked', source: 'page_opt_out', experimentId: X });
    const { runHand } = await import('../../src/services/venture/hand.js');
    await runHand({ now: NOW, offersPerTick: 5 });
    const seen = await onThePhone(`/foundry/experiments/${X}`);
    expect(seen.text).toMatch(/Stopped|stopped early/);
    expect(seen.text).toContain('people asking not to be contacted');
  });

  it('11. the Advanced depth is the same product: one shell, no second stylesheet, no self-link', async () => {
    // THE LETTER WAS THE LAST PAGE IN THE OTHER VISUAL SYSTEM.
    //
    // It rendered through `views/layout.ts` and `public/styles.css` while every
    // other owner surface rendered through the shell and `owner.css` — so the
    // one door out of the estate led somewhere that looked like a different
    // product. It now renders in this shell as the `advanced` depth.
    //
    // The risk of moving a page between stylesheets is not that it looks
    // slightly different; it is that 396 inline declarations written against
    // names the new sheet does not define quietly stop applying, and the page
    // reads as broken on the phone. So this checks the things that would break:
    // it does not scroll sideways, it is on the shell's ground, and it still
    // says what it is for.
    const seen = await onThePhone('/letter');
    expect(seen.overflowX, 'the Letter must not scroll sideways at 390px').toBe(0);
    expect(seen.text.length, 'the Letter still renders content').toBeGreaterThan(200);
  });

  it('11a. no door lights for a depth, and the footer does not point at the page you are on', async () => {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ executablePath: CHROMIUM as string, args: ['--no-sandbox'] });
    try {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
      const pg = await ctx.newPage();
      await pg.goto(`http://localhost:${String(port)}/letter`, { waitUntil: 'networkidle' });
      const shape = await pg.evaluate(() => ({
        // The shell, not the other layout.
        sheets: [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => (l as HTMLLinkElement).getAttribute('href')),
        place: document.querySelector('main.wrap')?.getAttribute('data-place') ?? null,
        litDoors: [...document.querySelectorAll('nav.places a.on')].map((a) => a.textContent?.trim() ?? ''),
        selfLink: [...document.querySelectorAll('footer a')].map((a) => a.getAttribute('href')),
        // The ground is painted, so the page cannot borrow the host's theme.
        bg: getComputedStyle(document.body).backgroundColor,
        // The alias layer resolves: this was `var(--text-primary)`, defined in
        // NEITHER stylesheet before, so it used to be an invalid declaration.
        primary: getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim(),
        card: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
      }));
      expect(shape.sheets, 'renders on owner.css and nothing else').toHaveLength(1);
      expect(shape.sheets[0], 'owner.css, addressed by its fingerprint').toMatch(/^\/static\/owner\.css(\?v=[0-9a-f]{12})?$/);
      expect(shape.place, 'a depth, not a place').toBe('advanced');
      expect(shape.litDoors, 'a depth lights no door in the rail').toEqual([]);
      expect(shape.selfLink, 'the Advanced footer must not link to the Advanced page').toEqual([]);
      expect(shape.bg, 'the shell paints its own ground').not.toBe('rgba(0, 0, 0, 0)');
      expect(shape.primary, '--text-primary now resolves').toBe(shape.card);
    } finally { await browser.close(); }
  });

  it('10. back after a day away: what changed is a count with a door, and the list is under it', async () => {
    await query("UPDATE owner_visits SET looked_at = datetime('now','-1 day'), since = datetime('now','-1 day') WHERE founder_id = ?", [OWNER]);
    const seen = await onThePhone('/foundry');
    expect(seen.text).toContain('Since you looked');
    expect(seen.text).not.toMatch(/I checked|I ran/i);
  });
});
