// =============================================================================
// FOUNDRY — the mobile gate
//
// THE OWNER MADE THIS A RELEASE GATE, and he was right to: he opened the first
// prototype on his iPhone and found cards cut off on the right, sentences
// truncated, chips and navigation outside the viewport, and horizontal
// scrolling. A layout that overflows on the only device he uses is not a
// smaller version of the product — it is a broken one.
//
// So the owner surface is MEASURED rather than reasoned about. This boots the
// real routes against a seeded database, renders them in a real browser at the
// five widths an iPhone actually reports, and fails if the document is wider
// than the window by a single pixel. Reducing the font size does not pass it;
// only composing vertically does.
//
//   375  iPhone SE / 12 mini / 13 mini
//   390  iPhone 12 / 13 / 14
//   393  iPhone 14 Pro / 15 / 16
//   414  iPhone 11 / XR / 8 Plus
//   430  iPhone 14 Pro Max / 15 Pro Max
//
// Deliberately NOT part of `npm run check`. It needs a browser binary, and the
// CI runner has no reason to carry one; `playwright-core` is a dependency with
// no download of its own and this reads the Chromium the environment already
// provides. Run it before shipping anything the owner will open on his phone:
//
//   npx tsx scripts/measure-mobile.mts
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMigrations } from '../src/db/migrate.js';
import { query } from '../src/db/client.js';

const WIDTHS = [375, 390, 393, 414, 430];
// TWO CANVASES, NEITHER A VERSION OF THE OTHER. The desktop widths are measured
// with a mouse-and-keyboard context, at 100% text only (a desktop user zooms
// the browser, which is a different mechanism and reflows the same way), and
// the screenshots go beside the phone ones so the two can be compared.
const DESKTOP_WIDTHS = [1024, 1280, 1440];
const OWNER = 'mm_owner';
/**
 * THE ESTATE WITH NOTHING WRONG WITH IT.
 *
 * §51-N says Foundry can truthfully display estate healthy / autonomy normal /
 * no owner action required, and there was no picture of that anywhere: this
 * harness seeds everything waiting, because everything waiting is what stresses
 * a layout. Quiet is the state the owner will spend most of his life in, and a
 * first screen nobody has ever seen empty is a first screen nobody has checked.
 *
 * It cannot be a second founder. A private Foundry admits one address and
 * `requireInstitutionOwner` refuses every other, which is the boundary working;
 * measuring around it by inventing a second owner would measure a deployment
 * that does not exist. So this answers every open question instead, as the
 * owner would, and photographs what is left.
 *
 * Decided rather than deleted: an act is withdrawn, advice is declined, a
 * candidate is answered, the experiment is declined, the Workshop is given its
 * address. Deleting the rows would leave a page that renders empty because its
 * queries found nothing, which is a different thing from a page that is empty
 * because the owner is finished.
 */
async function quieten(): Promise<void> {
  // `founder:` prefixed, because the database resolves the principal through
  // the product and refuses a decision by anyone else — including another
  // authenticated founder. Passing the bare id is refused, correctly.
  await query(`UPDATE proposed_acts SET decided_at = datetime('now'), decided_by = ?, decision = 'refused'
                WHERE decided_at IS NULL`, [`founder:${OWNER}`]);
  await query(`UPDATE situation_recommendations SET decided_at = datetime('now'), decided_by = ?, decision = 'declined'
                WHERE decided_at IS NULL`, [`founder:${OWNER}`]);
  await query(`UPDATE venture_experiments SET decision = 'declined', decided_at = datetime('now'), decided_by = ?
                WHERE founder_id = ? AND decision IS NULL`, [OWNER, OWNER]);
  const { decideResponsibilityCandidate } = await import(
    '../src/services/institution/responsibility-candidate.js');
  const pending = await query(
    "SELECT id, product_id FROM responsibility_candidates WHERE status = 'pending'");
  for (const r of pending.rows as Array<Record<string, unknown>>) {
    await decideResponsibilityCandidate({
      productId: String(r.product_id), candidateId: String(r.id), decision: 'rejected',
      ownerId: OWNER, reason: 'measuring the estate with nothing waiting on him',
    });
  }
  const { setPostalAddress } = await import('../src/services/public-workshop/settings.js');
  await setPostalAddress(OWNER, '1 Measurement Way, Suite 0, Nowhere, MA 00000');
}
/** He signs, once, from the charter page's own form; measured after the loaded passes. */
async function signTheCharter(base: string): Promise<void> {
  const { liveCharter } = await import('../src/services/institution/charter.js');
  if (await liveCharter(OWNER)) return;
  const res = await fetch(base + '/foundry/controls/charter', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'tests_dollars=100&probes=3&thinking_dollars=3&days=30&statement=' + encodeURIComponent('A river of nickels: dozens of small, sturdy things, each tested for real, none needing me.'),
  });
  if (res.status !== 302 && res.status !== 200) throw new Error(`the charter was not signed: HTTP ${String(res.status)}`);
}
const COMPANY = 'mm_company';
let REFERENCE_COMPANY = '';
let PROOF1 = '';
let RESPONSIBILITY = '';

/** Production's shape, so the measurement is of what the owner actually sees. */
async function seed(): Promise<void> {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_mm', 'owner@example.com', 'Thomas Norton']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd)
    VALUES (?,'Foundry',?,'active',50)`, [COMPANY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason)
    VALUES ('foundry',?,'measured')`, [COMPANY]);

  const checks: Array<[string, string, string]> = [
    ['mm_a', 'schema-snapshot-freshness',
      '695 schema objects, all described by docs/db/schema.snapshot.sql'],
    ['mm_b', 'ratchet-baseline-liveness',
      '64 baselined exemption(s) across 6 baselines all still name something that exists; '
      + '41 entr(ies) naming source files were not evaluated — this runtime does not carry '
      + 'the repository source'],
  ];
  for (const [id, check, detail] of checks) {
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary,processed)
      VALUES (?,?,'development_verification',?,'low',?,?,0)`,
      [id, COMPANY, `development_verified:${check}:passed`,
        JSON.stringify({ check, result: 'passed', detail, observed_at: new Date().toISOString() }),
        `${check} reported passed`]);
  }

  // THE REFERENCE COMPANY'S PAGE IS MEASURED TOO, because it carries the
  // longest unbroken prose in the product — the disclosure that says the
  // company does not exist — above a list of numbers. If anything overflows on
  // a phone, it is that, and it is the one page whose text may not be cut off.
  const { establishReferenceCompany, advanceReferenceWorld } = await import(
    '../src/services/reference/world.js');
  const reference = await establishReferenceCompany({
    scenarioKey: 'revenue_quietly_falling', ownerId: OWNER,
  });
  if (!reference) throw new Error('the reference scenario did not resolve');
  await advanceReferenceWorld(reference.productId);
  // With the questions on it, because those are the widest blocks on the page.
  const { noticeWhatTheNumbersAreDoing } = await import(
    '../src/services/institution/noticing.js');
  await noticeWhatTheNumbersAreDoing(reference.productId);
  REFERENCE_COMPANY = reference.productId;

  // A standing boundary and an objective, because the company page renders both
  // and the lift buttons carry his own sentence — the longest arbitrary string
  // the owner can put into the layout, and therefore the thing most likely to
  // overflow a phone.
  // THE SITUATION, REMEMBERED, so the company page renders its duration, its
  // history and what Foundry would do about it — the widest new blocks.
  const chain = await import('../src/services/founder/situation-chain.js');
  await chain.recordSituation(reference.productId);
  await chain.recommendFor(reference.productId);

  const intent = await import('../src/services/institution/standing-intent.js');
  await intent.setBoundary({ productId: COMPANY, subject: 'contact_people', mode: 'ask_first',
    statement: 'Do not contact anyone at all until I say otherwise, not even to say hello' });
  // A PROPOSAL IS THE WIDEST BLOCK ON THE PAGE — four labelled paragraphs and
  // two buttons — and it is the single most consequential thing the owner
  // reads, so it is measured rather than assumed.
  await intent.proposeAct({
    productId: COMPANY, subject: 'contact_people', actionType: 'send_email',
    params: { to: 'jane@example.com' },
    summary: 'Email Jane Ashworth about the payment that failed on Tuesday',
    why: 'her card was declined and nothing has told her, so the subscription will lapse',
    expectedEffect: 'she updates the card within a day or two and nothing is interrupted',
    risk: 'if the decline was her bank rather than her card this is an unnecessary message',
    consequence: 'low', proposedBy: 'agent:support',
  });
  await intent.setBoundary({ productId: null, subject: 'set_prices',
    statement: 'Never change what any of my companies charge without asking me first' });
  await intent.setObjective({ productId: COMPANY,
    statement: 'Retention matters more than acquisition right now',
    channels: ['day_30_retention', 'churn_rate'] });

  // A pending proposal, because the widest thing on the page is the decision.
  const { proposeResponsibilityCandidate } = await import(
    '../src/services/institution/responsibility-candidate.js');
  await proposeResponsibilityCandidate({
    productId: COMPANY, convergenceKey: 'self_maintenance:schema-snapshot-freshness',
    proposedResponsibility:
      'regenerate the committed schema snapshot after a migration changes the schema',
    evidenceRefs: [{ kind: 'signal_event', id: 'mm_a' }],
    derivationMethod: 'self_maintenance_scope',
    rationale: 'the check runs against this company independently',
    epistemicStatus: 'known', capabilityDependency: 'development',
    authorityRequired: true, observedAt: new Date(),
  });

  // AND ONE PROMOTED RESPONSIBILITY WITH A FACT ON IT, because the page that
  // says what Foundry understands a responsibility to be — and lets the owner
  // correct a fact that has stopped being true — moved out of the Advanced
  // depth and into the company, and it is a list of twelve labelled facts each
  // with a correction form, which is exactly the shape that breaks on a phone.
  const candidates = await import('../src/services/institution/responsibility-candidate.js');
  const pending = await candidates.getPendingResponsibilityCandidates(COMPANY);
  if (pending[0]) {
    RESPONSIBILITY = await candidates.promoteResponsibilityCandidate({
      productId: COMPANY, candidateId: pending[0].id,
      mechanism: 'authenticated_owner', ownerId: OWNER,
    });
    const evidence = await import('../src/services/institution/founder-evidence.js');
    for (const o of (await evidence.listFounderFactOpportunities(COMPANY)).slice(0, 2)) {
      await evidence.submitFounderFact({
        productId: COMPANY, founderId: OWNER, fact: o.fact, scope: o.scope,
        responsibilityId: o.responsibilityId,
        statement: 'The person who has always done this by hand is leaving at the end of the quarter, '
          + 'and nobody else has ever run it end to end',
        resource: o.resource,
      });
    }
  }

  // THE FIRST REAL EXPERIMENT, READY TO ALLOW. Its page is the widest thing
  // the owner will open on his phone: the three steps, the allowance
  // sentence, the offer, a reach table, the sealed rule, a timeline. Measured
  // in the state that matters most - everything in place, the Allow button
  // on screen - and the review list beside it.
  const { seedProof1 } = await import('../src/services/venture/proof-1.js');
  const seeded = await seedProof1(OWNER);
  PROOF1 = seeded.experimentId;
  const { setSendingIdentity } = await import('../src/services/outbound/sending-identity.js');
  await setSendingIdentity({ productId: COMPANY, provider: 'resend', credential: 're_measure', fromEmail: 'hello@mail.thomasnorton.example', fromName: 'Thomas Norton' });
  const { approveRemaining } = await import('../src/services/venture/hand.js');
  await approveRemaining({ founderId: OWNER, experimentId: PROOF1 });

  // THE PUBLIC WORKSHOP, as the owner sees it: the widest page in the private
  // surface, since it carries health readings, public experiments with their
  // addresses, a do-not-contact list and the provider's receipts. Measured with
  // its prerequisites unmet, which is the state that shows the most.
  const { establishPublicWorkshop } = await import('../src/services/public-workshop/settings.js');
  await establishPublicWorkshop({ founderId: OWNER });

  // HISTORY, SO THE WORKING SET IS MEASURED BESIDE THE RECORD. Production
  // accumulates concluded tests; a measurement seeded with one live test
  // photographs a page that never had to separate now from history. Three
  // ways a test ends: retired as a duplicate of the live one, killed by the
  // forge a month ago, and settled by the world just now.
  const { designExperiment, retireExperiment, decideExperiment, recordResult } = await import('../src/services/venture/validation.js');
  const { recordMaterial } = await import('../src/services/venture/hand.js');
  const base = (await query('SELECT opportunity_id, unknown_id FROM venture_experiments WHERE id = ?', [PROOF1])).rows[0] as Record<string, unknown>;
  const another = async (word: string): Promise<string> => {
    const id = await designExperiment({
      founderId: OWNER, opportunityId: String(base.opportunity_id), unknownId: String(base.unknown_id),
      whatWeDo: `offering the ${word} brief to the same businesses`, whatWeExpect: 'at least one pays', wouldDisprove: 'nobody pays',
      costCents: 0, evidenceMode: 'real' });
    await recordMaterial({ founderId: OWNER, experimentId: id, kind: 'deliverable', title: `The ${word} brief`, body: `# The ${word} brief\n\nA row.`, by: 'measured' });
    return id;
  };
  const dup = await another('duplicate');
  await retireExperiment({ experimentId: dup, by: `founder:${OWNER}`, because: 'the same test as its survivor', supersededBy: PROOF1 });
  const killed = await another('killed');
  await query(`UPDATE venture_experiments SET retired_at = datetime('now','-30 days'), retired_because = 'the forge and its adversary both said kill' WHERE id = ?`, [killed]);
  const finished = await another('finished');
  await decideExperiment({ experimentId: finished, decision: 'approved', by: `founder:${OWNER}`, via: 'its own authorisation' });
  await new Promise((r) => { setTimeout(r, 1100); });
  await recordResult({ experimentId: finished, whatHappened: 'one business paid', asPredicted: true });

}

async function main(): Promise<void> {
  await seed();

  const { foundryShellRoutes } = await import('../src/routes/dashboard/foundry-shell.js');
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'measure' as never);
    await next();
  });
  // THE STYLESHEET, WHICH THIS GATE HAD NEVER SERVED.
  //
  // Every screenshot this harness has ever produced was of an unstyled
  // document, and every "no horizontal overflow" it has ever reported was
  // measured on one. That is close to vacuous: an unstyled page is a column of
  // block elements, which is the one layout that cannot overflow sideways. The
  // things that DO overflow — a grid with a fixed column, a table, a fixed
  // composer, a nav rail, a long token in a monospace field — are all created
  // by the stylesheet that was missing.
  //
  // It is served here exactly as the application serves it, from the same
  // handler, so the gate measures the page the owner actually opens.
  const { staticAssetHandler } = await import('../src/routes/public/static-assets.js');
  app.get('/static/:file', staticAssetHandler(
    resolve(import.meta.dirname, '../src')) as never);
  app.route('/', foundryShellRoutes as never);
  const { experimentRoutes } = await import('../src/routes/dashboard/experiments-place.js');
  app.route('/', experimentRoutes as never);
  const { charterRoutes } = await import('../src/routes/dashboard/charter-place.js');
  app.route('/', charterRoutes as never);
  const { workshopRoutes } = await import('../src/routes/dashboard/workshop-place.js');
  app.route('/', workshopRoutes as never);
  // THE DEEPER SURFACES, MOUNTED SO THE GATE CAN ACTUALLY MEASURE THEM.
  //
  // Adding their paths to the list below without mounting their routers gave
  // six clean-looking 404s: scrollWidth equal to innerWidth on a bare error
  // page, which overflows nothing because there is nothing on it. The gate
  // caught it because it checks the STATUS as well as the width — a page that
  // did not render is not a page that fits.
  const { placeRoutes } = await import('../src/routes/dashboard/places.js');
  app.route('/', placeRoutes as never);
  const { inboxRoutes } = await import('../src/routes/dashboard/inbox-place.js');
  app.route('/', inboxRoutes as never);
  // SETTINGS, WHICH THIS GATE HAS NEVER MOUNTED AND THEREFORE NEVER MEASURED.
  // `/settings` answered 404 to every width it was ever asked about — so the
  // page where the owner's Etsy key goes, and which he described as "overly
  // verbose, difficult to navigate on mobile, and structured more like a
  // technical document than a coherent application", has never once been
  // opened at phone width by the instrument built to catch exactly that.
  const { settingsRoutes } = await import('../src/routes/dashboard/settings.js');
  app.route('/', settingsRoutes as never);
  const { moneyRoutes } = await import('../src/routes/dashboard/money-place.js');
  app.route('/', moneyRoutes as never);
  const { roadmapRoutes } = await import('../src/routes/dashboard/roadmap-place.js');
  app.route('/', roadmapRoutes as never);
  const { absenceRoutes } = await import('../src/routes/dashboard/absence-place.js');
  app.route('/', absenceRoutes as never);
  const { activityRoutes } = await import('../src/routes/dashboard/activity-place.js');
  app.route('/', activityRoutes as never);

  const server = serve({ fetch: app.fetch, port: 4317 });
  const base = 'http://127.0.0.1:4317';
  const paths = ['/foundry', '/foundry?ask=okay', '/foundry?ask=working',
    '/foundry/companies', `/foundry/companies/${COMPANY}`,
    `/foundry/companies/${REFERENCE_COMPANY}`, '/foundry/controls',
    '/foundry/experiments', `/foundry/experiments/${PROOF1}`, `/foundry/experiments/${PROOF1}/recipients`,
    '/foundry/public-workshop',
    // THE PAGES HE ACTUALLY STRUGGLED WITH, and which this gate had never
    // measured. He entered his Etsy application key on `/settings`, could not
    // tell whether it had saved, and described the page as "overly verbose,
    // difficult to navigate on mobile, and structured more like a technical
    // document than a coherent application". A mobile gate that never opened
    // the page where the owner's real work got stuck was measuring the pages
    // that were designed most carefully — the exact failure its own header
    // warns about one screen above.
    '/settings',
    `/foundry/companies/${COMPANY}/see/revenue`,
    // THE DEEPER SURFACES, because a gate that only measures the front page
    // measures the page that was designed most carefully. These are where the
    // owner goes when he wants the subtraction, the load, the queue, the
    // search, what to test next, and whether he could leave — and every one of
    // them renders a list, a table, or a set of nested details, which is where
    // a phone layout actually breaks.
    '/foundry/decisions', '/foundry/inbox', '/foundry/money', '/foundry/roadmap',
    // The stream, and the stream filtered — the filter chips wrap, and a day
    // heading over rows with a coloured strip is a new shape on the phone.
    '/foundry/activity', '/foundry/activity?kind=authority',
    '/foundry/searching', '/foundry/experiments/next', '/foundry/absence',
    // THE CHARTER, unsigned and recalculated; HISTORY, whole and filtered; and
    // the More sheet open, which is the only way the secondary places are
    // reached on a phone.
    '/foundry/charter', '/foundry/charter?tests_dollars=250&probes=4&thinking_dollars=5&days=90&statement=x',
    '/foundry/experiments/history', '/foundry/experiments/history?state=retired',
    '/foundry#more',
    // THE STUDIO AND THE WORKING INBOX. Explore is shelves of folds with a
    // second fold inside each card, which is the deepest nesting on the phone;
    // the inbox rows now carry buttons over a whole-row link, which is where a
    // thumb target and a door most easily collide.
    '/foundry/experiments/explore', '/foundry/inbox?show=needs',
    '/foundry/inbox?show=archived',
    `/foundry/companies/${COMPANY}/understanding/${RESPONSIBILITY}`,
    // Asked about a company by name: the answer is the widest structured block
    // the ask box can produce, and it renders inside the same page.
    '/foundry?q=' + encodeURIComponent('How is Foundry doing?'),
    '/foundry?q=' + encodeURIComponent('Show me the numbers for Foundry')];

  // label → (path, form body). The label is what the report prints.
  const POSTS: Array<[string, string, string]> = [
    ['POST said → boundary', `/foundry/companies/${COMPANY}/said`,
      'said=' + encodeURIComponent('Do not contact anyone at all until I say otherwise')],
    ['POST said → objective', `/foundry/companies/${COMPANY}/said`,
      'said=' + encodeURIComponent('Retention matters more than acquisition right now')],
    ['POST said → not understood', `/foundry/companies/${COMPANY}/said`,
      'said=' + encodeURIComponent('Do not do anything weird')],
  ];

  const dir = 'docs/design/mobile';
  const desk = 'docs/design/desktop';
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(desk)) mkdirSync(desk, { recursive: true });

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const failures: string[] = [];
  const rows: string[] = [];
  /** How much reading stands between the owner and the first thing he can do. */
  const reading: string[] = [];

  // ACCESSIBILITY IS PART OF THE MEASUREMENT, not a later pass. A layout that
  // holds at 17px and breaks at 34px is a layout that breaks for anyone who has
  // turned text up, which on a phone is a great many people.
  const runs: Array<{ width: number; scale: number; desktop: boolean; quiet?: boolean }> = [
    ...WIDTHS.flatMap((width) => [{ width, scale: 1, desktop: false }, { width, scale: 2, desktop: false }]),
    ...DESKTOP_WIDTHS.map((width) => ({ width, scale: 1, desktop: true })),
    // The quiet estate, on the phone, at both text sizes, LAST — because
    // getting there consumes the queue every run above it needs. One path,
    // because the whole question is what the first screen says when there is
    // nothing to say, and an empty page is exactly where a layout built around
    // content quietly collapses.
    // The estate with the charter signed, on the phone: the Autonomy tile
    // says Chartered and the charter page reads Active, the two states the
    // owner lives in once the loop is running. Before quiet, which declines
    // the tests the charter would otherwise let in.
    { width: 390, scale: 1, desktop: false, chartered: true },
    { width: 390, scale: 2, desktop: false, chartered: true },
    { width: 390, scale: 1, desktop: false, quiet: true },
    { width: 390, scale: 2, desktop: false, quiet: true },
  ];
  for (const { width, scale, desktop, quiet, chartered } of runs as Array<{ width: number; scale: number; desktop: boolean; quiet?: boolean; chartered?: boolean }>) {
    if (chartered) await signTheCharter(base);
    // THE GROUND IS DARK, AND EVERY SCREENSHOT THIS HARNESS EVER TOOK WAS OF
    // THE ALTERNATE. The stylesheet is dark-first — the palette lives on bare
    // :root and light is an override under prefers-color-scheme:light. A
    // browser started with Playwright's default asks for light, gets the
    // override, and photographs a product nobody designed. Every picture in
    // docs/design was of that. Asking for dark here is not a preference: it
    // makes the proof a picture of the thing.
    if (quiet) await quieten();
    const context = await browser.newContext(desktop
      ? { viewport: { width, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' }
      : { viewport: { width, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'dark' });
    const page = await context.newPage();
    if (scale !== 1) {
      await page.addInitScript(`document.addEventListener('DOMContentLoaded',function(){
        document.documentElement.style.fontSize = '${String(17 * scale)}px';});`);
    }
    // THE CONFIRMATION IS A POST RESULT, AND IT IS THE MOST CONSEQUENTIAL
    // SCREEN IN THE PRODUCT: it is where a standing boundary binds. A gate that
    // measured only what a browser can navigate to would skip exactly the page
    // whose text must not be cut off. The server renders complete documents
    // with their styles inline, so setting the response as the document is a
    // faithful measurement of what he would see.
    const posted = new Map<string, string>();
    for (const [label, path, body] of (quiet || chartered ? [] : POSTS)) {
      const res = await fetch(base + path, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
      });
      posted.set(label, await res.text());
    }

    // AND THE STREAM, HERE RATHER THAN ABOVE, because quietening the estate is
    // the only thing in this harness that actually decides anything: an act
    // refused, an experiment declined, a candidate answered. Measured in the
    // loaded pass the page is correct and empty, which measures a page that
    // rendered nothing — the same mistake as a clean-looking 404.
    for (const path of quiet ? ['/foundry', '/foundry/activity'] : chartered ? ['/foundry', '/foundry/charter'] : [...paths, ...posted.keys()]) {
      let status = 200;
      if (posted.has(path)) {
        await page.setContent(posted.get(path) ?? '', { waitUntil: 'load' });
      } else {
        const response = await page.goto(base + path, { waitUntil: 'load' });
        status = response?.status() ?? 0;
      }
      // LET THE BARS FINISH MEASURING THEMSELVES.
      //
      // The reserve at the foot of every page is the measured height of the
      // composer and the tab bar, set by a ResizeObserver rather than guessed
      // by a constant. In a real browser the reader's text size applies to the
      // first layout, so that observation is correct before anything paints.
      // Here the 200% run raises the root font size on DOMContentLoaded, after
      // the bars have already measured themselves small — so without this the
      // gate reports content hidden behind a bar that has, by the time anyone
      // could look, moved. Two frames is what the observer needs, and waiting
      // them makes this measure the page rather than the harness.
      await page.evaluate(() => new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => { done(); }));
      }));
      const m = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        // THE DOORS, AS THE THUMB MEETS THEM. This gate measured overflow and
        // coverage and never a door, which is how nine doors at half a rem
        // with colliding labels shipped green. Every visible door in the bar:
        // does its label fit its own box, does it overlap its neighbour, is it
        // big enough to press, and is exactly one lit. And the More sheet,
        // when it is open: visible, with rows a thumb can hit.
        doors: (() => {
          // No named helper here: the script runner names function values on
          // the way in, and the page has no such helper to call.
          const all = [...document.querySelectorAll('nav.places a')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; }).map((a) => {
            const r = a.getBoundingClientRect();
            return { label: (a.textContent ?? '').trim(), left: r.left, right: r.right, w: r.width, h: r.height,
              clipped: a.scrollWidth > a.clientWidth + 1 || a.scrollHeight > a.clientHeight + 1, lit: a.classList.contains('on') };
          }).sort((x, y) => x.left - y.left);
          const overlaps: string[] = [];
          for (let i = 1; i < all.length; i++) if (all[i - 1]!.right > all[i]!.left + 0.5) overlaps.push(`${all[i - 1]!.label}/${all[i]!.label}`);
          const more = document.getElementById('more');
          const sheet = more && more.getBoundingClientRect().height > 0 && getComputedStyle(more).display !== 'none'
            ? { rows: [...more.querySelectorAll('a')].map((a) => ({ label: (a.textContent ?? '').trim(), h: a.getBoundingClientRect().height })) }
            : null;
          return { n: all.length, clipped: all.filter((d) => d.clipped).map((d) => d.label), overlaps,
            small: all.filter((d) => d.w < 44 || d.h < 44).map((d) => d.label), lit: all.filter((d) => d.lit).length, sheet };
        })(),
        // HOW FAR DOWN THE FIRST THING HE CAN DO IS.
        //
        // "Actions can be buried in lengthy explanations", and "avoid placing
        // several screens' worth of technical explanations ahead of the primary
        // action". Both are measurable and neither was measured: this gate
        // knew about overflow and doors, so a page could pass it green while
        // putting four paragraphs between the owner and the button.
        //
        // The nav is excluded deliberately — it is always at the top and
        // always actionable, and counting it would report every page as
        // instantly usable.
        reading: (() => {
          const main = document.querySelector('main') ?? document.body;
          // INLINE, NEVER A NAMED HELPER. The script runner names function
          // values on the way in and emits a `__name` call the page cannot
          // resolve — the same trap this file already warns about one
          // measurement above, which I walked straight into.
          // FROM THE PAGE'S OWN HEADING, not from the top of the document.
          // Measured from the document, every page reported its first action
          // at 13px after 7 words — the shell's own first link, identical
          // everywhere, which measured the frame rather than the page. What
          // the owner meant by "actions buried in lengthy explanations" is
          // what stands between the heading and the first thing he can press.
          const h1 = main.querySelector('h1');
          const acts = [...main.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary')]
            .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('nav')
              && (!h1 || (h1.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0); });
          const first = acts[0];
          const words = (main.textContent ?? '').trim().split(/\s+/).filter(Boolean).length;
          // Words the eye passes before the first control. Counted from the
          // text that precedes it in document order, which is what reading
          // actually is.
          let before = 0;
          if (first) {
            const walk = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
            let n = walk.nextNode();
            let started = h1 === null;
            while (n) {
              if (!started) {
                if (h1 && (h1.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_CONTAINED_BY)) started = true;
              } else if (first.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING) {
                before += (n.textContent ?? '').trim().split(/\s+/).filter(Boolean).length;
              } else break;
              n = walk.nextNode();
            }
          }
          return {
            words,
            wordsBeforeFirstAction: before,
            firstActionAt: first ? Math.round(first.getBoundingClientRect().top + window.scrollY) : -1,
            height: Math.round(document.documentElement.scrollHeight),
            // Every control a thumb has to hit, not only the nav's. 44px is
            // Apple's own floor and this gate already holds the doors to it.
            small: acts.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 44 && e.tagName !== 'SUMMARY' && e.tagName !== 'A'; })
              .map((e) => `${e.tagName.toLowerCase()}:${((e.textContent ?? (e as HTMLInputElement).placeholder ?? '').trim() || '?').slice(0, 24)}`)
              .slice(0, 6),
          };
        })(),
        // The widest element on the page, named, so a failure says what to fix
        // rather than only that something is too wide.
        widest: (() => {
          let worst = { tag: '', w: 0 };
          document.querySelectorAll('*').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.right > worst.w) {
              worst = {
                tag: el.tagName.toLowerCase()
                  + (el.className && typeof el.className === 'string'
                    ? '.' + el.className.split(' ').filter(Boolean).join('.') : ''),
                w: Math.round(r.right),
              };
            }
          });
          return worst;
        })(),
        // WHAT THE FIXED BARS COVER.
        //
        // This gate measured only horizontal overflow, so it never saw that the
        // composer and the tab bar were each reserving the iPhone home
        // indicator — the inset counted twice — and hiding the last lines of
        // every page behind the bar the owner types into. Vertical clearance is
        // as mechanical to check as width, and was simply never checked.
        covered: (() => {
          // Scrolled to the very bottom, which is the only place the question
          // can be asked: can he read the last line of the page, or is it
          // behind the bar he types into?
          window.scrollTo(0, document.documentElement.scrollHeight);
          // Only things actually pinned over the page. On desktop the composer
          // returns to normal flow and the tab bar becomes a full-height
          // sidebar, and neither covers anything.
          const bars = [...document.querySelectorAll('.ask, nav.places')]
            .filter((el) => window.getComputedStyle(el).position === 'fixed')
            .map((el) => el.getBoundingClientRect().top)
            .filter((t) => t > 0 && t < window.innerHeight);
          if (bars.length === 0) return 0;
          const barTop = Math.min(...bars);
          // The composer lives inside .wrap and is itself fixed, so the last
          // child is often the bar — measuring it against itself just reports
          // its own height.
          const wrap = document.querySelector('.wrap');
          if (!wrap) return 0;
          const flowing = [...wrap.children].filter((el) =>
            window.getComputedStyle(el).position !== 'fixed');
          const last = flowing[flowing.length - 1];
          if (!last) return 0;
          return Math.round(last.getBoundingClientRect().bottom - barTop);
        })(),
      }));
      const overflow = m.scrollWidth - m.innerWidth;
      // The door rules hold on a phone: five under the thumb, none clipped,
      // none overlapping, every one 44px, exactly one lit. The desk rail is a
      // list and is not held to them. A page opened at #more must show the
      // sheet, with every row a thumb's height.
      const wantsSheet = path.endsWith('#more');
      const doorFault = desktop ? '' : m.doors.n > 5 ? `${String(m.doors.n)} doors` : m.doors.clipped.length ? `clipped: ${m.doors.clipped.join(', ')}`
        : m.doors.overlaps.length ? `overlapping: ${m.doors.overlaps.join(', ')}` : m.doors.small.length ? `under 44px: ${m.doors.small.join(', ')}`
          : m.doors.lit !== 1 ? `${String(m.doors.lit)} doors lit` : wantsSheet && !m.doors.sheet ? 'the More sheet did not open'
            : wantsSheet && m.doors.sheet && m.doors.sheet.rows.some((r) => r.h < 44) ? `sheet rows under 44px: ${m.doors.sheet.rows.filter((r) => r.h < 44).map((r) => r.label).join(', ')}` : '';
      const verdict = status === 200 && overflow <= 0 && m.covered <= 0 && !doorFault ? 'ok'
        : status === 200 && overflow <= 0 && m.covered <= 0 ? 'DOORS'
          : status === 200 && overflow <= 0 ? 'COVERED' : 'OVERFLOW';
      rows.push(`${String(width).padStart(4)} ${desktop ? ' desk' : scale === 1 ? ' 100%' : ' 200%'}  ${String(status)}  `
        + `scrollWidth ${String(m.scrollWidth).padStart(4)} vs ${String(m.innerWidth).padStart(4)}  `
        + `${verdict.padEnd(9)} ${path}`);
      // READING BURDEN, reported rather than failed. These are not yet a gate:
      // the right ceiling is a design decision the owner has not made, and a
      // number invented here would be a threshold nobody agreed to. Printed at
      // one width so the report stays readable, and so the pages that are
      // documents rather than screens are visible at a glance.
      if (!desktop && scale === 1 && width === 390) {
        reading.push(`${String(m.reading.height).padStart(6)}px tall  `
          + `first action at ${String(m.reading.firstActionAt).padStart(5)}px after `
          + `${String(m.reading.wordsBeforeFirstAction).padStart(4)} words  `
          + `${String(m.reading.words).padStart(5)} words total  `
          + `${m.reading.small.length ? `under 44px: ${m.reading.small.join(', ')}  ` : ''}${path}`);
      }
      if (verdict === 'OVERFLOW') {
        failures.push(`${path} at ${String(width)}px ${String(scale * 100)}% text: +${String(overflow)}px `
          + `(widest ${m.widest.tag} reaching ${String(m.widest.w)}px)`);
      } else if (verdict === 'COVERED') {
        failures.push(`${path} at ${String(width)}px ${String(scale * 100)}% text: `
          + `${String(m.covered)}px of content sits underneath the fixed bars`);
      } else if (verdict === 'DOORS') {
        failures.push(`${path} at ${String(width)}px ${String(scale * 100)}% text: the doors — ${doorFault}`);
      }
      if (chartered && scale === 1) {
        await page.screenshot({ path: `${dir}/${path === '/foundry' ? 'foundry-chartered' : 'charter-active'}-390.png`, fullPage: true });
      }
      if (quiet && scale === 1) {
        await page.screenshot({
          path: `${dir}/${path === '/foundry' ? 'foundry-quiet' : 'activity-quiet'}-390.png`,
          fullPage: true,
        });
      }
      if (!quiet && !chartered && scale === 1 && width === 390) {
        // The home page, and the reference company's — the two the owner
        // actually looks at, and the second is the one whose disclosure has to
        // land before anything else on it does.
        if (path === '/foundry') {
          await page.screenshot({ path: `${dir}/foundry-390.png`, fullPage: true });
        }
        if (path === `/foundry/companies/${REFERENCE_COMPANY}`) {
          await page.screenshot({ path: `${dir}/reference-company-390.png`, fullPage: true });
        }
        if (path === `/foundry/experiments/${PROOF1}`) {
          await page.screenshot({ path: `${dir}/experiment-390.png`, fullPage: true });
        }
        if (path === `/foundry/experiments/${PROOF1}/recipients`) {
          await page.screenshot({ path: `${dir}/experiment-recipients-390.png`, fullPage: true });
        }
        if (path === '/foundry/public-workshop') {
          await page.screenshot({ path: `${dir}/public-workshop-390.png`, fullPage: true });
        }
        // THE DEEPER SURFACES ON THE PHONE HE ACTUALLY CARRIES. Measuring them
        // without keeping a picture leaves the proof as a number nobody can
        // check; these are the pages a reader of the tranche would ask to see.
        for (const [p, name] of [
          ['/foundry/controls', 'controls'], ['/foundry/money', 'money'],
          ['/foundry/roadmap', 'roadmap'], ['/foundry/decisions', 'decisions'],
          ['/foundry/experiments/next', 'forge'], ['/foundry/absence', 'absence'],
          ['/foundry/activity', 'activity'],
          [`/foundry/companies/${COMPANY}/understanding/${RESPONSIBILITY}`, 'understanding'],
          ['/foundry/charter', 'charter'], ['/foundry/experiments/history', 'experiments-history'],
          ['/foundry#more', 'more'], ['/foundry/experiments', 'experiments'], ['/foundry/inbox', 'inbox'],
          ['/foundry/companies', 'portfolio'],
          ['/foundry/experiments/explore', 'explore'], ['/foundry/inbox?show=needs', 'inbox-needs'],
        ] as Array<[string, string]>) {
          if (path === p) await page.screenshot({ path: `${dir}/${name}-390.png`, fullPage: true });
        }
      }
      if (!quiet && !chartered && path === '/foundry' && scale === 1 && width !== 390 && !desktop) {
        await page.screenshot({ path: `${dir}/foundry-${String(width)}.png`, fullPage: true });
      }
      // THE DESKTOP, AT ONE WIDTH, FOR THE THREE PAGES HE LIVES IN - so the two
      // canvases can be put side by side and neither read as a stretched or
      // shrunken version of the other.
      if (desktop && width === 1280) {
        const name = path === '/foundry' ? 'foundry'
          : path === '/foundry/companies' ? 'portfolio'
            : path === `/foundry/companies/${REFERENCE_COMPANY}` ? 'reference-company'
              : path === `/foundry/experiments/${PROOF1}` ? 'experiment'
                : path === '/foundry/money' ? 'money'
                  : path === '/foundry/controls' ? 'controls'
                    : path === '/foundry/absence' ? 'absence'
                      : path === '/foundry/experiments/next' ? 'forge'
                        : path === '/foundry/charter' ? 'charter'
                          : path === '/foundry/experiments' ? 'experiments'
                            : path === '/foundry/experiments/history' ? 'experiments-history' : '';
        if (name) await page.screenshot({ path: `${desk}/${name}-1280.png`, fullPage: true });
      }
    }
    await context.close();
  }

  await browser.close();
  server.close();

  console.log('\nwidth  text  http  document vs window            verdict   path');
  console.log(rows.join('\n'));
  if (reading.length) {
    console.log('\nHOW MUCH READING STANDS BETWEEN HIM AND THE FIRST THING HE CAN DO'
      + '\n(390px, 100% text. Reported, not gated — the ceiling is his to set.)\n');
    console.log([...reading].sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10)).join('\n'));
  }
  if (failures.length) {
    console.log('\nWHAT FAILED:\n' + failures.map((f) => '  ' + f).join('\n'));
    process.exit(1);
  }
  console.log(`\nNo horizontal overflow, nothing under the bars, and five doors that fit, at ${WIDTHS.join(', ')} px, at 100% and 200% text, `
    + `nor overflow at ${DESKTOP_WIDTHS.join(', ')} px on a desktop. Screenshots in ${dir}/ and ${desk}/.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
