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
  { path: '/letter', name: 'letter' },
  { path: '/privacy', name: 'privacy' },
  { path: '/connections', name: 'connections' },
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
    // NEVER ONCE RENDERED BY THIS INSTRUMENT, AND ONE TAP FROM EVERY PAGE.
    //
    // The shell's footer carries "Advanced — inspect the system" on every
    // owner screen, and it goes to the Letter: 2,596 lines, 348 inline style
    // attributes and, until this wave, twenty-nine hard-coded colours. Privacy
    // is linked from Controls and from Settings' delete control. Neither had
    // ever been rendered in any appearance, at any width, by anything.
    //
    // The comment above says the mounting is "by shape rather than by name so
    // a router added later is measured without this list being remembered".
    // That is true of the inner loop and false of this list, which is names,
    // and which forgot three. Saying so rather than deleting the sentence:
    // the gap it describes is the gap it had.
    '../src/routes/dashboard/letter.js',
    '../src/routes/dashboard/privacy.js',
    '../src/routes/dashboard/connections.js',
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

// BOTH ANSWERS THE PHONE CAN GIVE, FOR EVERY MODE HE CAN CHOOSE.
//
// This rendered each appearance once, on a browser whose colour preference
// happened to be one value, and so it could not see the defect it most needed
// to: the `--os-*` family flipping light in GREEN mode because the device
// preferred light, which put a white decision card in a dark green
// application and did it in every screenshot this campaign produced.
//
// An owner-chosen appearance must survive either answer. Rendering both is
// the only way to know, and the ground colour is the cheapest thing to
// compare: if green looks different to a phone set to light than to one set
// to dark, the phone is overruling him.
const grounds = new Map<string, string>();
const shapes = new Map<string, { mode: string; h: number }>();
for (const width of [390, 1280]) {
 for (const prefers of ['light', 'dark'] as const) {
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 900 },
    deviceScaleFactor: 2,
    isMobile: width === 390,
    hasTouch: width === 390,
    colorScheme: prefers,
  });
  const page = await context.newPage();
  // PAGE OUTSIDE, APPEARANCE INSIDE — because the order was being reported as
  // if it were the appearance.
  //
  // This ran all fourteen pages in light, then all fourteen in green, then all
  // fourteen in dark, and printed Home at 1,565px in light and 2,190px in
  // green and dark. That reads exactly like the Green-mode defect the owner
  // asked to be checked for. It was not: rendering Home on its own gives
  // 1,565px in all three. Thirteen pages of browsing had put activity on the
  // page, and the instrument attributed the growth to the mode that happened
  // to be rendering when it appeared.
  //
  // With the page outside, a page's three appearances are measured two visits
  // apart instead of twenty-six, so a difference between them is the
  // appearance's doing. An instrument whose passes are ordered reports the
  // order, not the thing.
  for (const p of PAGES) {
    for (const mode of MODES) {
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
      const seen = await page.evaluate(({ nav, touch }: { nav: boolean; touch: boolean }) => {
        return ({
        theme: document.documentElement.getAttribute('data-theme'),
        ground: getComputedStyle(document.body).backgroundColor,
        // A FINGERPRINT, BECAUSE THE GROUND WAS NOT ENOUGH.
        //
        // The first form of this compared `body`'s background across the two
        // device preferences and proved nothing: the defect it was written
        // for lives in `--os-panel`, which paints the decision card, while
        // the body is painted from `--v3-bg`. Reintroducing the bug on
        // purpose, the CSS gate caught it and this did not — an instrument
        // that passes is not an instrument that looked.
        //
        // So it samples the surfaces an appearance actually colours. If any
        // answers differently because the phone prefers light, the phone is
        // overruling a chosen appearance somewhere.
        // EVERY TOKEN, NOT A HANDFUL OF SURFACES.
        //
        // The second form of this sampled the background colour of six
        // elements and still did not catch the bug, because the decision card
        // is painted with a gradient: `--os-panel` changed underneath it and
        // `backgroundColor` stayed `rgba(0,0,0,0)` throughout. Two instruments
        // in a row that agreed with a defect I had deliberately put back.
        //
        // So it reads the resolved custom properties off the root. That is the
        // palette itself, not a guess at where the palette shows, and it
        // catches any family — `--os-*`, `--v3-*`, or one nobody has written
        // yet — that answers differently because of what the phone prefers.
        skin: (() => {
          const cs = getComputedStyle(document.documentElement);
          const out: string[] = [];
          for (let i = 0; i < cs.length; i += 1) {
            const name = cs.item(i);
            if (name.startsWith('--')) out.push(`${name}=${cs.getPropertyValue(name).trim()}`);
          }
          return out.sort().join(' ');
        })(),
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
            // THE FLOOR IS THE INPUT'S FLOOR, NOT ONE NUMBER FOR BOTH.
            //
            // 38px is the thumb's floor and it belongs to the phone. Applied
            // at the desk it reported the Home orientation line — a link that
            // is a whole paragraph, 169px wide and 22px tall — as a control
            // too small to hit with a mouse, which is not a thing. But the
            // link IS under WCAG 2.2's 24px minimum, and the exemption for a
            // target "in a sentence" does not cover a link that is the entire
            // sentence. One floor hid a real 2px failure inside a false one.
            .filter((x) => x.h >= 1 && x.w >= 1
              && (x.h < (touch ? 38 : 24) || x.w < (touch ? 38 : 24)));
          const controls = judged.filter((x) => !x.sentence);
          return {
            small: controls.length,
            inline: judged.length - controls.length,
            smallest: controls.slice(0, 8),
          };
        })(),
        // TEXT CLIPPED INSIDE A COMPONENT, which the document-overflow check
        // cannot see. The owner photographed a segmented control whose third
        // option read "answers ordinary message itself" with the words running
        // off the end of their own pill, and this instrument had called that
        // page clean: the document did not overflow, so nothing complained.
        // A box narrower than the words in it is a defect wherever it is.
        clipped: Array.from(document.querySelectorAll('body *'))
          .filter((e) => {
            const style = getComputedStyle(e);
            if (style.overflowX === 'auto' || style.overflowX === 'scroll') return false;
            // A SCREEN-READER LABEL IS CLIPPED ON PURPOSE. It is one pixel of
            // box holding a whole sentence, for a reader that never sees a
            // box. Counting it would teach the instrument's user to ignore
            // the instrument, which is worse than not measuring at all.
            const r0 = e.getBoundingClientRect();
            if (r0.width <= 2 || r0.height <= 2) return false;
            if (style.clipPath !== 'none' || style.position === 'absolute') return false;
            if (e.scrollWidth <= e.clientWidth + 1) return false;
            // Only where there is text of its own to lose.
            return Array.from(e.childNodes)
              .some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1);
          })
          .map((e) => ({
            t: `${e.tagName.toLowerCase()}.${e.className || '-'}`.slice(0, 40),
            by: e.scrollWidth - e.clientWidth,
            say: (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
          }))
          .slice(0, 8),
        // CONTENT UNDER THE BOTTOM NAV. The nav is fixed, so it sits on top of
        // whatever the page put at that height, and a full-page screenshot
        // shows the collision the way the owner meets it: tabs half-hidden
        // behind "Home Portfolio Experiments". Nothing measured this either.
        // CONTENT UNDER THE FIXED BAR — ADVISORY, AND NOT YET TRUSTED.
        //
        // This has produced three separate classes of false positive: asking
        // at the top of the page (everything below the fold straddles the
        // bar), counting containers whose children merely reach that far, and
        // counting the Ask composer, which is fixed furniture sitting where it
        // means to sit. Each was fixed and another appeared.
        //
        // The page reserves 88px and the bar measures 63px, so the clearance
        // exists and the remaining readings are probably a fourth kind of
        // mistake rather than a defect. Probably is not good enough to change
        // a stylesheet on, and it is certainly not good enough to fail a run
        // on: a gate that cries wolf is how a real finding gets ignored. So it
        // reports and does not judge, and it stays out of the failure count
        // until somebody proves what it is seeing. Set EVENTIDE_NAV=1 to make
        // it speak; silence here is "unproven", not "clean".
        //
        // CONTENT UNDER THE FIXED BAR, ASKED AT THE BOTTOM OF THE PAGE.
        //
        // The first form of this asked it at the top and answered yes on every
        // page, because everything below the fold has a bottom edge past the
        // bar's top edge. That is not occlusion, it is a page being longer
        // than a screen. The question is only meaningful once the owner has
        // scrolled as far as he can: if content still sits under the bar
        // there, the bar is covering it permanently — which is how the Inbox
        // tabs came to be half-hidden behind "Home Portfolio Experiments".
        pad: (() => {
          const m = document.querySelector('main.wrap');
          const bar = Array.from(document.querySelectorAll('nav,footer'))
            .find((e) => getComputedStyle(e).position === 'fixed');
          return {
            padBottom: m ? getComputedStyle(m).paddingBottom : 'none',
            chrome: getComputedStyle(document.documentElement).getPropertyValue('--chrome').trim(),
            barH: bar ? Math.round(bar.getBoundingClientRect().height) : 0,
          };
        })(),
        // WHERE THE PIXELS ACTUALLY ARE. Twice now I have shortened a page by
        // guessing which block was long and been wrong. A tall page has a
        // reason and the reason is measurable.
        blocks: Array.from(document.querySelectorAll('main.wrap > *, .ctl-grid > *, .cockpit > *, main.wrap > form > *, .settings-grid > *'))
          .map((e) => ({
            t: `${e.tagName.toLowerCase()}.${(e.className || '-').toString().slice(0, 26)}`,
            h: Math.round(e.getBoundingClientRect().height),
            say: (e.querySelector('h1,h2,h3')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30),
          }))
          .filter((x) => x.h > 0)
          .sort((a, b) => b.h - a.h)
          .slice(0, 10),
        occluded: (() => {
          if (!nav) return [];
          const bars = Array.from(document.querySelectorAll('nav,footer,[class*="bottom"]'))
            .filter((e) => getComputedStyle(e).position === 'fixed'
              && e.getBoundingClientRect().bottom > window.innerHeight - 4);
          if (bars.length === 0) return [];
          window.scrollTo(0, document.body.scrollHeight);
          const top = Math.min(...bars.map((b) => b.getBoundingClientRect().top));
          if (!isFinite(top) || top <= 0) return [];
          const hit = Array.from(document.querySelectorAll('main *'))
            .filter((e) => {
              if (bars.some((b) => b.contains(e))) return false;
              // ANYTHING ELSE PINNED TO THE SCREEN IS CHROME, NOT CONTENT.
              // The Ask composer is `position:fixed` above the bar and is not
              // in the bar, so it read as page content being painted over. It
              // is not: it is another piece of furniture, sitting where it
              // means to sit. Walking the ancestors is the only way to know,
              // because the fixed element may be several levels up.
              for (let a: Element | null = e; a; a = a.parentElement) {
                if (getComputedStyle(a).position === 'fixed') return false;
              }
              const r = e.getBoundingClientRect();
              if (r.width < 4 || r.height < 4) return false;
              // ITS OWN WORDS, NOT ITS CHILDREN'S. A container wrapping the
              // whole page straddles the bar on every page by construction,
              // which is a page being long, not a bar covering anything. Only
              // an element with a text node of its own can have that text
              // hidden behind the bar.
              const mine = Array.from(e.childNodes)
                .some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0);
              if (!mine) return false;
              return r.bottom > top + 2 && r.top < top;
            })
            .map((e) => ({
              t: `${e.tagName.toLowerCase()}.${e.className || '-'}`.slice(0, 40),
              by: Math.round(e.getBoundingClientRect().bottom - top),
            }));
          window.scrollTo(0, 0);
          return hit.slice(0, 4);
        })(),
        });
      }, { nav: Boolean(process.env.EVENTIDE_NAV), touch: width === 390 });
      // THE SAME MODE MUST LOOK THE SAME WHATEVER THE DEVICE PREFERS.
      const key = `${p.name} ${mode} ${String(width)}`;
      const was = grounds.get(key);
      if (was === undefined) grounds.set(key, seen.skin);
      else if (was !== seen.skin) {
        failures += 1;
        console.log(`  ✗ ${key}: the device preference changed the paint — `
          + `${was.split(' ').filter((x, j) => x !== seen.skin.split(' ')[j]).join('; ')} → ${seen.skin.split(' ').filter((x, j) => x !== was.split(' ')[j]).join('; ')}`);
      }
      // AN APPEARANCE CHANGES THE PAINT, NOT THE SHAPE.
      //
      // The owner's instruction is that a chosen theme governs the whole
      // component system. The half of that which is already checked is the
      // skin: `grounds`, above, catches a palette that reads the device
      // preference behind the owner's back. The other half is that choosing
      // green must not move anything — a mode that reflows the page is a
      // second layout to maintain, and the one that gets looked at least.
      //
      // Measured across all fourteen surfaces at both widths under both device
      // preferences, the three appearances agree to the pixel, so this is
      // stated exactly rather than with a tolerance: any drift at all is
      // either a defect or a change nobody meant to make, and both want
      // saying.
      const shapeKey = `${p.name} ${String(width)} ${prefers}`;
      const firstShape = shapes.get(shapeKey);
      if (firstShape === undefined) shapes.set(shapeKey, { mode, h: seen.height });
      else if (firstShape.h !== seen.height) {
        failures += 1;
        console.log(`  ✗ ${shapeKey}: the appearance changed the shape — `
          + `${firstShape.mode} ${String(firstShape.h)}px vs ${mode} ${String(seen.height)}px`);
      }
      const over = seen.scrollW > seen.clientW;
      if (over) failures += 1;
      if (seen.theme !== mode) { failures += 1; }
      // A CLIP IS A FAILURE, NOT A FOOTNOTE. It was reported as neither for
      // the whole campaign, which is how a page with words running off the
      // edge of a button kept being called clean.
      if (seen.clipped.length > 0) failures += 1;
      await page.screenshot({
        path: `${dir}/${p.name}-${mode}-${String(width)}.png`,
        fullPage: width === 390,
      });
      if (prefers === 'dark') continue; // One line per page and mode; the
      // second pass exists to compare, not to print the whole table twice.
      console.log(`  ${over || seen.theme !== mode ? '✗' : '·'} ${p.name.padEnd(16)} ${mode.padEnd(5)} ${String(width).padEnd(5)} `
        + `theme=${String(seen.theme)} ground=${seen.ground} h=${String(seen.height)}px `
        + `under38=${String(seen.small)}${seen.inline ? ` inline=${String(seen.inline)}` : ''}${
          seen.clipped.length ? ` CLIPPED ${String(seen.clipped.length)}` : ''}${
          seen.occluded.length ? ` UNDER-NAV ${String(seen.occluded[0].by)}px [${seen.occluded.map((x) => x.t).join(', ')}]` : ''}${over ? ` OVERFLOW ${String(seen.scrollW)}>${String(seen.clientW)}` : ''}`
        + (process.env.EVENTIDE_BLOCKS
          ? `\n      ${seen.blocks.map((b) => `${String(b.h).padStart(5)}px ${b.t} ${b.say}`).join('\n      ')}` : '')
        + (process.env.EVENTIDE_SMALL
          ? `\n      pad=${seen.pad.padBottom} chrome=${seen.pad.chrome || 'unset'} bar=${String(seen.pad.barH)}px` : '')
        + (process.env.EVENTIDE_SMALL && seen.smallest.length
          ? `\n      ${seen.smallest.map((x) => `${x.t} ${String(x.w)}x${String(x.h)}`).join('\n      ')}` : '')
        + (seen.clipped.length
          ? `\n      clipped: ${seen.clipped.map((x) => `${x.t} by ${String(x.by)}px “${x.say}”`).join('\n      clipped: ')}` : ''));
    }
  }
  await context.close();
 }
}
await browser.close();
console.log(failures === 0 ? '\nEventide: every page rendered, themed and fitted.' : `\nEventide: ${String(failures)} problem(s).`);
process.exit(failures === 0 ? 0 : 1);
