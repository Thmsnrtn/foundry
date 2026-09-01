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
import { runMigrations } from '../src/db/migrate.js';
import { query } from '../src/db/client.js';

const WIDTHS = [375, 390, 393, 414, 430];
const OWNER = 'mm_owner';
const COMPANY = 'mm_company';
let REFERENCE_COMPANY = '';

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
  const intent = await import('../src/services/institution/standing-intent.js');
  await intent.setBoundary({ productId: COMPANY, subject: 'contact_people',
    statement: 'Do not contact anyone at all until I say otherwise, not even to say hello' });
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
  app.route('/', foundryShellRoutes as never);

  const server = serve({ fetch: app.fetch, port: 4317 });
  const base = 'http://127.0.0.1:4317';
  const paths = ['/foundry', '/foundry?ask=okay', '/foundry?ask=working',
    '/foundry/companies', `/foundry/companies/${COMPANY}`,
    `/foundry/companies/${REFERENCE_COMPANY}`, '/foundry/controls',
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
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const failures: string[] = [];
  const rows: string[] = [];

  // ACCESSIBILITY IS PART OF THE MEASUREMENT, not a later pass. A layout that
  // holds at 17px and breaks at 34px is a layout that breaks for anyone who has
  // turned text up, which on a phone is a great many people.
  for (const { width, scale } of WIDTHS.flatMap((width) =>
    [{ width, scale: 1 }, { width, scale: 2 }])) {
    const context = await browser.newContext({
      viewport: { width, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    });
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
    for (const [label, path, body] of POSTS) {
      const res = await fetch(base + path, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
      });
      posted.set(label, await res.text());
    }

    for (const path of [...paths, ...posted.keys()]) {
      let status = 200;
      if (posted.has(path)) {
        await page.setContent(posted.get(path) ?? '', { waitUntil: 'load' });
      } else {
        const response = await page.goto(base + path, { waitUntil: 'load' });
        status = response?.status() ?? 0;
      }
      const m = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
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
      }));
      const overflow = m.scrollWidth - m.innerWidth;
      const verdict = status === 200 && overflow <= 0 ? 'ok' : 'OVERFLOW';
      rows.push(`${String(width).padStart(4)} ${scale === 1 ? ' 100%' : ' 200%'}  ${String(status)}  `
        + `scrollWidth ${String(m.scrollWidth).padStart(4)} vs ${String(m.innerWidth).padStart(4)}  `
        + `${verdict.padEnd(9)} ${path}`);
      if (verdict !== 'ok') {
        failures.push(`${path} at ${String(width)}px ${String(scale * 100)}% text: +${String(overflow)}px `
          + `(widest ${m.widest.tag} reaching ${String(m.widest.w)}px)`);
      }
      if (scale === 1 && width === 390) {
        // The home page, and the reference company's — the two the owner
        // actually looks at, and the second is the one whose disclosure has to
        // land before anything else on it does.
        if (path === '/foundry') {
          await page.screenshot({ path: `${dir}/foundry-390.png`, fullPage: true });
        }
        if (path === `/foundry/companies/${REFERENCE_COMPANY}`) {
          await page.screenshot({ path: `${dir}/reference-company-390.png`, fullPage: true });
        }
      }
      if (path === '/foundry' && scale === 1 && width !== 390) {
        await page.screenshot({ path: `${dir}/foundry-${String(width)}.png`, fullPage: true });
      }
    }
    await context.close();
  }

  await browser.close();
  server.close();

  console.log('\nwidth  text  http  document vs window            verdict   path');
  console.log(rows.join('\n'));
  if (failures.length) {
    console.log('\nHORIZONTAL OVERFLOW:\n' + failures.map((f) => '  ' + f).join('\n'));
    process.exit(1);
  }
  console.log(`\nNo horizontal overflow at ${WIDTHS.join(', ')} px, at 100% and 200% text. `
    + `Screenshots in ${dir}/.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
