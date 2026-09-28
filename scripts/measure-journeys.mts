// =============================================================================
// FOUNDRY — two of the owner's journeys, walked on a phone and counted.
//
// Roadmap A8. J1 (start an investigation, and find it later) and J3 (stop a
// search, and still find the record) were proved through HTTP requests, which
// proves the rows and not the walk: how many taps, how many screens, and
// whether each screen fits a 390px iPhone. This drives the real pages in a real
// browser at that width, taps only what is on the screen, and prints the count.
//
// Like `measure-mobile.mts`, deliberately NOT part of `npm run check`: it needs
// the Chromium binary this environment provides.
//
//   npx tsx scripts/measure-journeys.mts
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { chromium, type Page } from 'playwright-core';
import { resolve } from 'node:path';
import { runMigrations } from '../src/db/migrate.js';
import { query } from '../src/db/client.js';

const OWNER = 'mj_owner';
const DIRECTION = 'Look for small digital tools that contractors would pay for once';

interface Walk { journey: string; taps: number; screens: string[]; overflow: string[]; ok: boolean; notes: string[] }

async function seed(): Promise<void> {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_mj', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES ('mj_f','Foundry',?,'active',50)`, [OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry','mj_f','measure')`, []);
  const { recordJobSuccess, ECONOMIC_LOOPS } = await import('../src/services/institution/loop-health.js');
  for (const j of ECONOMIC_LOOPS) await recordJobSuccess(j);
}

/** A screen is a document load; each is checked for horizontal overflow at 390px. */
async function screen(page: Page, w: Walk): Promise<void> {
  await page.waitForLoadState('load');
  const url = new URL(page.url());
  w.screens.push(url.pathname + url.search);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 0) w.overflow.push(`${url.pathname}: ${String(over)}px`);
}

async function tap(page: Page, w: Walk, locator: ReturnType<Page['locator']>, what: string): Promise<void> {
  if (await locator.count() === 0) {
    w.notes.push(`no "${what}" on ${page.url()}`);
    w.notes.push(`forms there: ${(await page.locator('form').evaluateAll((fs) => fs.map((f) => `${f.getAttribute('action') ?? ''} [${(f.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)}]`))).join(' | ')}`);
    w.notes.push(`it says: ${(await page.locator('main').first().innerText()).replace(/\s+/g, ' ').slice(0, 300)}`);
    w.ok = false; throw new Error(`missing: ${what}`);
  }
  await locator.first().scrollIntoViewIfNeeded();
  await Promise.all([page.waitForLoadState('load'), locator.first().click()]);
  w.taps += 1;
}

/** On a phone the Ask box opens from a link to it (`.ask:target`): one tap, no new screen. */
async function openAsk(page: Page, w: Walk): Promise<void> {
  const box = page.locator('form#ask-foundry [name="said"]').first();
  if (await box.isVisible()) return;
  const opener = page.locator('a[href$="#ask-foundry"]').filter({ visible: true });
  if (await opener.count() === 0) { w.ok = false; w.notes.push('the Ask box is hidden and nothing on screen opens it'); throw new Error('no way to open Ask'); }
  await opener.first().click();
  w.taps += 1;
  await box.waitFor({ state: 'visible' });
}

async function main(): Promise<void> {
  await seed();
  const { letterRoutes } = await import('../src/routes/dashboard/letter.js');
  const { staticAssetHandler } = await import('../src/routes/public/static-assets.js');
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner', preferences: {} } as never);
    c.set('csrfToken' as never, 'measure' as never);
    await next();
  });
  app.get('/static/:file', staticAssetHandler(resolve(import.meta.dirname, '../src')) as never);
  app.route('/', letterRoutes as never);
  const server = serve({ fetch: app.fetch, port: 4318 });
  const base = 'http://127.0.0.1:4318';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const page = await context.newPage();
  const walks: Walk[] = [];

  // ── J1: start an investigation in ordinary English, and find it later ─────
  const j1: Walk = { journey: 'J1 start an investigation', taps: 0, screens: [], overflow: [], ok: true, notes: [] };
  try {
    await page.goto(`${base}/foundry`); await screen(page, j1);
    await openAsk(page, j1);
    const box = page.locator('form#ask-foundry [name="said"]');
    await box.first().tap(); j1.taps += 1;
    await box.first().fill(DIRECTION);
    await tap(page, j1, page.locator('form#ask-foundry button[type="submit"], form#ask-foundry input[type="submit"]'), 'Ask button');
    await screen(page, j1);
    await tap(page, j1, page.locator('form[action="/foundry/venture/confirm"] button[type="submit"]'), 'confirm the direction');
    await screen(page, j1);
    const open = (await query(`SELECT statement FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL`, [OWNER])).rows;
    if (open.length !== 1) { j1.ok = false; j1.notes.push('no open search after confirming'); }
    // Find it later: from Home, by what is on the screen.
    await page.goto(`${base}/foundry`); await screen(page, j1);
    const body = await page.locator('body').innerText();
    if (!body.includes(DIRECTION.slice(0, 30)) && !/What I am looking for/i.test(body)) { j1.ok = false; j1.notes.push('Home does not show the search'); }
    j1.notes.push(`Home shows it: ${/What I am looking for/i.test(body) ? '"What I am looking for"' : 'the sentence'}`);
  } catch (e) { j1.ok = false; j1.notes.push(String(e)); }
  walks.push(j1);

  // ── J3: stop the search, and still find the record ────────────────────────
  const j3: Walk = { journey: 'J3 stop a search', taps: 0, screens: [], overflow: [], ok: true, notes: [] };
  try {
    await page.goto(`${base}/foundry`); await screen(page, j3);
    await openAsk(page, j3);
    const box = page.locator('form#ask-foundry [name="said"]');
    await box.first().tap(); j3.taps += 1;
    await box.first().fill('Stop looking.');
    await tap(page, j3, page.locator('form#ask-foundry button[type="submit"], form#ask-foundry input[type="submit"]'), 'Ask button');
    await screen(page, j3);
    await tap(page, j3, page.locator('form[action="/foundry/venture/confirm"] button[type="submit"]'), 'confirm stopping');
    await screen(page, j3);
    const open = (await query(`SELECT id FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL`, [OWNER])).rows;
    if (open.length !== 0) { j3.ok = false; j3.notes.push('the search is still open'); }
    // Still find the record: Activity, reached by tapping what is on screen.
    await page.goto(`${base}/foundry`); await screen(page, j3);
    // Only what a thumb can see: on a phone Activity is in the More sheet,
    // which opens from a link to it (`.sheet-more:target`) — a tap, no screen.
    const visibleActivity = page.locator('a[href="/foundry/activity"]').filter({ visible: true });
    if (await visibleActivity.count() === 0) {
      const more = page.locator('a[href$="#more"]').filter({ visible: true });
      if (await more.count() === 0) { j3.ok = false; j3.notes.push('Activity is hidden and nothing on screen opens More'); throw new Error('no More'); }
      await more.first().click(); j3.taps += 1;
    }
    await tap(page, j3, page.locator('a[href="/foundry/activity"]').filter({ visible: true }), 'Activity'); await screen(page, j3);
    const record = await page.locator('body').innerText();
    if (!/Stopped looking/i.test(record)) { j3.ok = false; j3.notes.push('Activity does not show "Stopped looking"'); }
    else j3.notes.push('Activity shows "Stopped looking"');
  } catch (e) { j3.ok = false; j3.notes.push(String(e)); }
  walks.push(j3);

  for (const w of walks) {
    console.log(`${w.ok ? 'OK  ' : 'FAIL'} ${w.journey}: ${String(w.taps)} taps, ${String(w.screens.length)} screens`);
    console.log(`     ${w.screens.join(' → ')}`);
    if (w.overflow.length) console.log(`     overflow: ${w.overflow.join(', ')}`);
    for (const n of w.notes) console.log(`     ${n}`);
  }
  await browser.close();
  server.close();
  process.exit(walks.every((w) => w.ok && w.overflow.length === 0) ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
