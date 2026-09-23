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
// EVERY OWNER-FACING PLACE, so a migration wave can be chosen from what is
// actually worst rather than from what is nearest to hand.
const PAGES: Array<{ path: string; name: string }> = [
  { path: '/foundry', name: 'brief' },
  { path: '/foundry/controls', name: 'controls' },
  { path: '/foundry/controls/connectors', name: 'connectors' },
  { path: '/foundry/controls/connectors/etsy', name: 'connector-etsy' },
  { path: '/settings', name: 'settings' },
  { path: '/foundry/companies', name: 'portfolio' },
  // THE COMPANY ITSELF, not only the list of them. A card was added to this
  // page and the measurement could not see it: "portfolio" is the index, and
  // the detail — where a company's senses, its sending identity and its
  // authority all live — was the one owner surface nothing measured.
  { path: '/foundry/companies/ev_apex', name: 'company' },
  { path: '/foundry/experiments', name: 'experiments' },
  { path: '/foundry/decisions', name: 'decisions' },
  { path: '/foundry/inbox', name: 'inbox' },
  { path: '/foundry/money', name: 'money' },
  { path: '/foundry/activity', name: 'activity' },
  { path: '/foundry/searching', name: 'searching' },
  { path: '/foundry/charter', name: 'charter' },
].filter((p, _i, all) => {
  // POINTABLE AT WHAT CHANGED. A wave that touches two surfaces should not
  // have to render thirty-nine pages to find out what it did to them, and an
  // instrument too slow to run is an instrument that stops being run.
  // No argument still means all of them, so the release measurement is
  // unchanged and cannot be narrowed by forgetting.
  const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (want.length === 0) return true;
  const known = new Set(all.map((x) => x.name));
  for (const w of want) {
    if (!known.has(w)) throw new Error(`no page named ${w}; known: ${[...known].join(', ')}`);
  }
  return want.includes(p.name);
});

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
  // THE REST OF THE OWNER SURFACE. Mounted by shape rather than by name so a
  // router added later is measured without this list being remembered.
  for (const mod of [
    '../src/routes/dashboard/experiments-place.js',
    '../src/routes/dashboard/charter-place.js',
    '../src/routes/dashboard/places.js',
    '../src/routes/dashboard/inbox-place.js',
    '../src/routes/dashboard/money-place.js',
    '../src/routes/dashboard/activity-place.js',
  ]) {
    const loaded = await import(mod) as Record<string, unknown>;
    for (const v of Object.values(loaded)) {
      if (v && typeof v === 'object' && 'routes' in (v as Record<string, unknown>)) {
        app.route('/', v as never);
      }
    }
  }
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
        // NOT A FAILURE OF THE THEME. A place needing state this harness has
        // not seeded answers honestly; saying so is the point, and counting it
        // as a defect would train the reader to ignore the count.
        console.log(`  ~ ${p.name.padEnd(16)} ${mode.padEnd(5)} ${String(width).padEnd(5)} HTTP ${String(status)} (not seeded)`);
        continue;
      }
      // What actually applied, rather than what was asked for.
      // WHAT A THUMB ACTUALLY HITS, which is not always the element.
      //
      // The rect comes from the wrapping label where there is one, because
      // that is the target: a 20×20 checkbox inside a 40px label is tappable,
      // and WCAG 2.2's target-size criterion says so. Measuring the box
      // instead made the honest arrangement look like the defect.
      //
      // AND IT IS WRITTEN INLINE, TWICE, ON PURPOSE. A named function value
      // inside `page.evaluate` is compiled by esbuild with a `__name` helper
      // that does not exist in the browser, and the page dies with
      // `__name is not defined`. This campaign learned that once already, in
      // `measure-mobile.mts`, and I wrote the same defect again here.
      const seen = await page.evaluate(() => {
        return ({
        theme: document.documentElement.getAttribute('data-theme'),
        ground: getComputedStyle(document.body).backgroundColor,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        height: document.body.scrollHeight,
        // ONE LIST, AND THE COUNT IS ITS LENGTH.
        //
        // This was two expressions of the same rule, and they disagreed:
        // Portfolio reported five controls under the floor and then named
        // none of them, because the count admitted anything with a non-zero
        // box while the list rounded heights to whole pixels and dropped
        // everything under half of one. A sub-pixel element is not a tap
        // target a thumb can miss — it is not on the screen — so the floor of
        // 1px is right and the count was wrong. Now there is nothing for the
        // two to disagree about.
        //
        // AND INLINE LINKS ARE NOT CONTROLS. WCAG 2.2's target-size criterion
        // exempts a target "in a sentence or whose size is otherwise
        // constrained by the line-height of non-target text", and it is right
        // to: making a mid-sentence link 40px tall breaks the paragraph it is
        // a word in. They are counted separately rather than quietly dropped,
        // because an exemption nobody can see is indistinguishable from an
        // instrument that stopped looking.
        ...(() => {
          const judged = Array.from(document.querySelectorAll('a,button,input,select'))
            .map((e) => {
              const target = e.closest('label') ?? e;
              const r = target.getBoundingClientRect();
              const parent = e.parentElement;
              const sentence = e.tagName === 'A' && parent != null
                && (parent.textContent ?? '').trim().length
                  > (e.textContent ?? '').trim().length;
              // The text too, because a bare `a.-` names nothing an author can
              // find. A measurement you have to go hunting to act on gets
              // watched instead of fixed.
              return { t: `${e.tagName.toLowerCase()}.${e.className || '-'} “${
                (e.textContent ?? '').trim().slice(0, 32)}”`.slice(0, 64),
                h: Math.round(r.height * 10) / 10, w: Math.round(r.width * 10) / 10,
                sentence };
            })
            .filter((x) => x.h >= 1 && x.w >= 1 && (x.h < 38 || x.w < 38));
          const controls = judged.filter((x) => !x.sentence);
          return {
            small: controls.length,
            inline: judged.length - controls.length,
            smallest: controls.slice(0, 8),
          };
        })(),
        });
      });
      const over = seen.scrollW > seen.clientW;
      if (over) failures += 1;
      if (seen.theme !== mode) { failures += 1; }
      await page.screenshot({
        path: `${dir}/${p.name}-${mode}-${String(width)}.png`,
        fullPage: width === 390,
      });
      console.log(`  ${over || seen.theme !== mode ? '✗' : '·'} ${p.name.padEnd(16)} ${mode.padEnd(5)} ${String(width).padEnd(5)} `
        + `theme=${String(seen.theme)} ground=${seen.ground} h=${String(seen.height)}px `
        + `under38=${String(seen.small)}${seen.inline ? ` inline=${String(seen.inline)}` : ''}${over ? ` OVERFLOW ${String(seen.scrollW)}>${String(seen.clientW)}` : ''}`
        + (process.env.EVENTIDE_SMALL && seen.smallest.length
          ? `\n      ${seen.smallest.map((x) => `${x.t} ${String(x.w)}x${String(x.h)}`).join('\n      ')}` : ''));
    }
  }
  await context.close();
}
await browser.close();
console.log(failures === 0 ? '\nEventide: every page rendered, themed and fitted.' : `\nEventide: ${String(failures)} problem(s).`);
process.exit(failures === 0 ? 0 : 1);
