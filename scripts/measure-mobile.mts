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
  const paths = ['/foundry', '/foundry?ask=today', '/foundry?ask=responsibility',
    '/foundry/portfolio', '/foundry/controls'];

  const dir = 'docs/design/mobile';
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const failures: string[] = [];
  const rows: string[] = [];

  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    });
    const page = await context.newPage();
    for (const path of paths) {
      const response = await page.goto(base + path, { waitUntil: 'load' });
      const status = response?.status() ?? 0;
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
      rows.push(`${String(width).padStart(4)}  ${String(status)}  `
        + `scrollWidth ${String(m.scrollWidth).padStart(4)} vs ${String(m.innerWidth).padStart(4)}  `
        + `${verdict.padEnd(9)} ${path}`);
      if (verdict !== 'ok') {
        failures.push(`${path} at ${String(width)}px: +${String(overflow)}px `
          + `(widest ${m.widest.tag} reaching ${String(m.widest.w)}px)`);
      }
      if (path === '/foundry') {
        await page.screenshot({ path: `${dir}/foundry-${String(width)}.png`, fullPage: true });
      }
    }
    await context.close();
  }

  await browser.close();
  server.close();

  console.log('\nwidth  http  document vs window            verdict   path');
  console.log(rows.join('\n'));
  if (failures.length) {
    console.log('\nHORIZONTAL OVERFLOW:\n' + failures.map((f) => '  ' + f).join('\n'));
    process.exit(1);
  }
  console.log(`\nNo horizontal overflow at ${WIDTHS.join(', ')} px. Screenshots in ${dir}/.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
