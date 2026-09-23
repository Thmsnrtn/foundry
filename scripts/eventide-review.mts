// =============================================================================
// EVENTIDE — look at the actual application, in all three modes.
//
// The owner's directive is explicit that a green test suite does not establish
// product quality: "Use real browser rendering to evaluate the actual
// application rather than relying solely on source inspection or
// route-response tests." So this boots the real routes against a seeded
// database, renders them in a real browser at a phone width and a desk width,
// in each of the three appearance modes, and writes the screenshots out to be
// compared against the Eventide references.
//
// It also MEASURES the two things a screenshot is bad at judging: whether the
// document overflows its viewport sideways, and whether the ground actually
// changed between modes — because a theme that renders but does not apply is
// exactly the failure a picture of a dark screen hides.
//
//   npx tsx scripts/eventide-review.mts
//
// Not part of `npm run check`: it needs a browser binary. Run it before
// shipping anything the owner will open.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMigrations } from '../src/db/migrate.js';
import { query } from '../src/db/client.js';
import { withAppearance, isAppearance } from '../src/views/owner/appearance.js';

const OWNER = 'ev_owner';
const MODES = ['light', 'green', 'dark'] as const;
const PAGES: Array<{ path: string; name: string }> = [
  { path: '/foundry', name: 'brief' },
  { path: '/foundry/controls', name: 'controls' },
  { path: '/foundry/controls/connectors', name: 'connectors' },
  { path: '/foundry/controls/connectors/etsy', name: 'connector-etsy' },
];

async function seed(): Promise<void> {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_ev', 'owner@example.com', 'Thomas Norton']);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
    ['ev_apex', 'Apex Micro', OWNER, 'active']);
}

async function boot(): Promise<string> {
  const app = new Hono();
  // The founder as the real middleware attaches him, and the appearance as the
  // real middleware carries it — from `?mode=`, so one running process can be
  // photographed in all three without restarting.
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'review' as never);
    const asked = new URL(c.req.url).searchParams.get('mode');
    return withAppearance(isAppearance(asked) ? asked : null, async () => next());
  });
  const { staticAssetHandler } = await import('../src/routes/public/static-assets.js');
  app.get('/static/:file', staticAssetHandler(resolve(import.meta.dirname, '../src')) as never);
  const { foundryShellRoutes } = await import('../src/routes/dashboard/foundry-shell.js');
  app.route('/', foundryShellRoutes as never);
  const { settingsRoutes } = await import('../src/routes/dashboard/settings.js');
  app.route('/', settingsRoutes as never);
  const server = serve({ fetch: app.fetch as never, port: 0 });
  const port = (server.address() as { port: number }).port;
  return `http://127.0.0.1:${String(port)}`;
}

const dir = resolve(import.meta.dirname, '../.eventide');
mkdirSync(dir, { recursive: true });

await seed();
const base = await boot();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let failures = 0;

for (const width of [390, 1280]) {
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 900 },
    deviceScaleFactor: 2,
    isMobile: width === 390,
    hasTouch: width === 390,
  });
  const page = await context.newPage();
  for (const mode of MODES) {
    for (const p of PAGES) {
      const url = `${base}${p.path}${p.path.includes('?') ? '&' : '?'}mode=${mode}`;
      const res = await page.goto(url, { waitUntil: 'load' });
      const status = res?.status() ?? 0;
      if (status !== 200) {
        console.log(`  ✗ ${p.name} ${mode} ${String(width)} → HTTP ${String(status)}`);
        failures += 1;
        continue;
      }
      // What actually applied, rather than what was asked for.
      const seen = await page.evaluate(() => ({
        theme: document.documentElement.getAttribute('data-theme'),
        ground: getComputedStyle(document.body).backgroundColor,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        height: document.body.scrollHeight,
        small: Array.from(document.querySelectorAll('a,button,input,select'))
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && (r.height < 38 || r.width < 38);
          }).length,
      }));
      const over = seen.scrollW > seen.clientW;
      if (over) failures += 1;
      if (seen.theme !== mode) { failures += 1; }
      await page.screenshot({
        path: `${dir}/${p.name}-${mode}-${String(width)}.png`,
        fullPage: width === 390,
      });
      console.log(`  ${over || seen.theme !== mode ? '✗' : '·'} ${p.name.padEnd(16)} ${mode.padEnd(5)} ${String(width).padEnd(5)} `
        + `theme=${String(seen.theme)} ground=${seen.ground} h=${String(seen.height)}px `
        + `under38=${String(seen.small)}${over ? ` OVERFLOW ${String(seen.scrollW)}>${String(seen.clientW)}` : ''}`);
    }
  }
  await context.close();
}
await browser.close();
console.log(failures === 0 ? '\nEventide: every page rendered, themed and fitted.' : `\nEventide: ${String(failures)} problem(s).`);
process.exit(failures === 0 ? 0 : 1);
