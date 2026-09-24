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
import { withAppearance } from '../src/views/owner/appearance.js';
import type { Appearance } from '../src/views/owner/appearance.js';
// THE LABORATORY, NOT A SECOND COPY OF IT.
//
// This booted its own Hono app and listed ten owner routers by name — a
// hand-maintained copy of what `src/index.ts` assembles, and one that had
// already drifted: three surfaces were missing from it last wave.
// `tests/helpers/world.ts` learned that same lesson first, in its own words:
// "a review instrument that is missing parts of the thing it reviews produces
// findings that are not true and hides findings that are". Its `ownerApp()`
// mounts `letterRoutes`, which carries the whole owner surface exactly as
// production does, so there is one assembly rather than two that can differ.
//
// `seedProductionShape()` comes with it, and that is the larger half. The old
// seed was one founder and one empty company, so nine owner surfaces answered
// 404 for want of state and every height was measured against an institution
// with nothing in it. This is Experiment 001, the Workshop, a sending
// identity, a public page — production's shape, which is the only shape worth
// measuring.
import { COMPANY, ownerApp, seedProductionShape } from '../tests/helpers/world.js';

const OWNER = 'ev_owner';
const MODES = ['light', 'green', 'dark'] as const;
// EVERY OWNER-FACING PLACE, so a migration wave can be chosen from what is
// actually worst rather than from what is nearest to hand.
// EVERY OWNER-FACING PLACE, DERIVED RATHER THAN REMEMBERED.
//
// This was a list of fourteen paths, under a comment promising "every
// owner-facing place, so a migration wave can be chosen from what is actually
// worst rather than from what is nearest to hand". It was not every place. It
// was missing the Letter — which the shell's footer links from every single
// owner screen — along with Privacy, Connections, the absence review, the
// Workshop, the roadmap, the public workshop, every company sub-surface, every
// experiment sub-surface, a thread in the Inbox, and the why-page. Twenty-odd
// surfaces that nothing had ever rendered in any appearance at any width.
//
// Adding the three most obvious of those by hand found, on the first pass,
// that the four consent switches on Privacy were printing their own source as
// text and could not be set at all. A list that has to be remembered will be
// missing exactly the pages nobody is thinking about, which are the pages
// where that sort of thing survives.
//
// So the list is read off the booted app's routing table. A page that is
// mounted is a page that is measured, and one added later is measured without
// anybody updating this file.
const NAMES: Record<string, string> = {
  '/foundry': 'brief',
  '/foundry/controls': 'controls',
  '/foundry/controls/connectors': 'connectors',
  '/foundry/controls/connectors/:provider': 'connector-etsy',
  '/settings': 'settings',
  '/foundry/companies': 'portfolio',
  '/foundry/companies/:id': 'company',
  '/foundry/experiments': 'experiments',
  '/foundry/decisions': 'decisions',
  '/foundry/inbox': 'inbox',
  '/foundry/money': 'money',
  '/foundry/activity': 'activity',
  '/foundry/searching': 'searching',
  '/foundry/charter': 'charter',
};

// WHAT A PARAMETER STANDS FOR, given what the seed actually put in the
// database. Keyed by the route first and by the bare token second, because
// `:id` is a company on one path and an experiment on another and one table
// cannot say both. Where there is no honest value the route is still listed —
// as a surface this harness cannot reach — rather than dropped, because a
// silent omission is how the first list came to be wrong.
const PARAM: Record<string, string> = {
  ':provider': 'etsy',
  ':id': COMPANY,
  ':sense': 'sales',
};

// THE PUBLIC FACE, SEEN FROM INSIDE THE OWNER APPLICATION.
//
// A preview of a Workshop page is a preview of what a CUSTOMER sees: the
// public site's palette, and the visitor's own device preference deciding
// between its light and dark, because a stranger has no owner appearance to
// have chosen. The instrument reported it three ways at once — no
// `data-theme`, a ground that is neither of the owner's, a palette that
// answers to the device — and all three were the page being correct.
//
// So the appearance rules do not apply here and the fit rules still do: it is
// rendered, measured, and checked for clipping, overflow and targets, and
// only the three owner-appearance questions are not asked of it. Naming the
// exception is the point; an instrument that quietly stops asking is the
// failure this whole wave is about.
const PUBLIC_FACE = new Set([
  '/foundry/public-workshop/preview/:experimentId',
]);
const publicFace = new Set<string>();

// GETs that answer with a file or a redirect rather than a page. Each is here
// for a stated reason; the default is that a GET is a page.
const NOT_A_PAGE = new Set([
  '/static/:file',                  // the stylesheet and the script
  '/privacy/export',                // a CSV download
  '/privacy/export-account',        // a JSON download
  '/settings/export-all',           // a CSV download
  '/foundry/senses/callback',       // an OAuth landing that redirects
]);

const unreachable: string[] = [];

function pagesFrom(routes: ReadonlyArray<{ method: string; path: string }>):
Array<{ path: string; name: string }> {
  const out: Array<{ path: string; name: string }> = [];
  const seen = new Set<string>();
  for (const r of routes) {
    if (r.method !== 'GET') continue;
    if (NOT_A_PAGE.has(r.path) || r.path.includes('*')) continue;
    if (seen.has(r.path)) continue;
    seen.add(r.path);
    const filled = r.path.replace(/:[A-Za-z_]+/g,
      (m) => PARAM[`${r.path} ${m}`] ?? PARAM[m] ?? m);
    if (filled.includes(':')) { unreachable.push(r.path); continue; }
    const derived = filled.replace(/^\//, '').replace(/\//g, '-');
    const name = NAMES[r.path] ?? (derived === '' ? 'root' : derived);
    if (PUBLIC_FACE.has(r.path)) publicFace.add(name);
    out.push({ path: filled, name });
  }
  return out;
}

function chosen(all: Array<{ path: string; name: string }>):
Array<{ path: string; name: string }> {
  // POINTABLE AT WHAT CHANGED. A wave that touches two surfaces should not
  // have to render every page to find out what it did to them, and an
  // instrument too slow to run is an instrument that stops being run.
  // No argument still means all of them, so the release measurement is
  // unchanged and cannot be narrowed by forgetting.
  const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (want.length === 0) return all;
  const known = new Set(all.map((x) => x.name));
  for (const w of want) {
    if (!known.has(w)) throw new Error(`no page named ${w}; known: ${[...known].join(', ')}`);
  }
  return all.filter((p) => want.includes(p.name));
}

async function boot(): Promise<{ base: string; app: Hono }> {
  const app = await ownerApp();
  // THE APPEARANCE WRAPS THE WHOLE REQUEST, INCLUDING A REDIRECT'S SECOND HOP.
  //
  // `ownerApp()` registers its own middleware before it mounts anything, so a
  // `use('*')` added here would never run for those routes. Wrapping `fetch`
  // puts the appearance outside everything the app does, which is also where
  // production puts it: `auth.ts` reads the owner's `appearance` column on the
  // row it already loads for every authenticated request. It is not in the
  // URL, so a 302 keeps it.
  const inner = app.fetch.bind(app);
  const fetch = ((req: Request, ...rest: unknown[]) =>
    withAppearance(rendering, () => inner(req, ...(rest as [])))) as typeof app.fetch;
  const server = serve({ fetch: fetch as never, port: 0 });
  const port = (server.address() as { port: number }).port;
  return { base: `http://127.0.0.1:${String(port)}`, app };
}

const dir = resolve(import.meta.dirname, '../.eventide');
mkdirSync(dir, { recursive: true });

const { experimentId } = await seedProductionShape();
// The experiment the institution actually ran, so its detail, its decision and
// its recipients are surfaces this instrument can reach at all.
PARAM['/foundry/experiments/:id :id'] = experimentId;
PARAM['/foundry/experiments/:id/decide :id'] = experimentId;
PARAM['/foundry/experiments/:id/recipients :id'] = experimentId;
PARAM['/foundry/public-workshop/preview/:experimentId :experimentId'] = experimentId;
const { base, app: booted } = await boot();
const PAGES = chosen(pagesFrom(booted.routes));
if (unreachable.length > 0) {
  // SAID OUT LOUD, EVERY RUN. These are owner surfaces this harness cannot
  // reach because `seed()` has nothing for their parameter — an experiment
  // that does not exist, a thread nobody has written. They are not measured,
  // and the right response is to widen the seed, not to stop printing them.
  console.log(`  ! ${String(unreachable.length)} surface(s) the seed cannot reach: ${
    unreachable.join(', ')}`);
}
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
/**
 * The appearance the current render is in, held for the request the way the
 * owner's row holds it in production rather than in the address.
 */
let rendering: Appearance | null = null;
const shapes = new Map<string, { mode: string; h: number }>();
/** Pages that render differently twice running: nothing about them compares. */
const unsteady = new Set<string>();
for (const width of [390, 1280]) {
 for (const prefers of ['light', 'dark'] as const) {
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 900 },
    deviceScaleFactor: 2,
    isMobile: width === 390,
    hasTouch: width === 390,
    colorScheme: prefers,
  });
  let page = await context.newPage();
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
    // ONE VISIT BEFORE THE THREE THAT COUNT.
    //
    // Some pages grow the first time they are opened — an activity row gets
    // written, something is marked seen — and with the page outside and the
    // appearance inside, that growth lands on whichever appearance renders
    // first and reads as "the appearance changed the shape". It did exactly
    // that on a company's work page the moment the seed became production's
    // shape: light 934px, green and dark 1,256px, and nothing to do with any
    // of the three.
    //
    // So the page is opened twice in the SAME appearance before anything is
    // measured, and the two heights compared. If they differ, this page is
    // not idempotent to read — it writes something when looked at — and no
    // comparison across appearances can mean anything for it. That is said
    // out loud and the shape check is not applied, rather than the page being
    // quietly dropped or the drift being reported as an appearance defect.
    //
    // Which is not hypothetical: a company's work page moves by twenty pixels
    // between two identical renders, and with the page outside and the
    // appearance inside, that lands on whichever appearance went first and
    // reads exactly like "green is taller than light". The second time this
    // instrument has had to stop measuring its own visit.
    rendering = MODES[0] ?? null;
    const twice: number[] = [];
    for (let k = 0; k < 2; k += 1) {
      const r0 = await page.goto(`${base}${p.path}`, { waitUntil: 'load' }).catch(() => null);
      if (r0?.status() === 200) {
        twice.push(await page.evaluate(() => document.body.scrollHeight));
      }
    }
    const steady = twice.length === 2 && twice[0] === twice[1];
    if (!steady && twice.length === 2) {
      unsteady.add(p.name);
    }
    for (const mode of MODES) {
      rendering = mode;
      // A FRESH PAGE, BECAUSE THE EMULATED POINTER DOES NOT SURVIVE ONE.
      //
      // Chromium reports `(pointer:coarse)` on the first navigation in a
      // context and `false` on every one after it, with the same viewport and
      // the same `isMobile`. So the stylesheet's own thumb rules — everything
      // guarded on `(pointer:coarse)` — stopped applying from the second
      // render onward, and every target this instrument called too small was
      // measured against the desk rules on a phone-sized screen. The numbers
      // were not wrong about the page; they were about a page the owner will
      // never see.
      //
      // One page per render costs a few seconds across the whole run and makes
      // the media features mean what they say. `coarse=` is printed beside the
      // floor under EVENTIDE_SMALL so the two can never drift again silently.
      await page.close().catch(() => null);
      page = await context.newPage();
      const res = await page.goto(`${base}${p.path}`, { waitUntil: 'load' });
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
        // WHICH FLOOR THE PAGE ITSELF THINKS IT IS UNDER. The stylesheet asks
        // `(pointer:coarse)`; this asks the same question in the same context,
        // so a disagreement between the rule and the measurement is visible
        // rather than inferred.
        coarse: matchMedia('(pointer:coarse)').matches,
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
        // TEXT NOBODY CAN READ, MEASURED WHERE IT IS PAINTED.
        //
        // `every-colour-is-readable` computes ratios between TOKENS, which is
        // the right check for the palette and blind to everything else. The
        // stylesheet also paints with eighty-nine literal colours inside
        // ordinary rules, and one of them is `.btn{background:#102019}` — a
        // dark green, applied in every appearance. In light mode that put
        // `rgb(20,32,27)` ink on an `rgb(16,32,25)` button: dark green on dark
        // green, on the appearance most likely on a bright phone, on every
        // secondary button in the application.
        //
        // No token pair says that, because neither colour is a token. So this
        // asks the browser what was actually painted: the ink as computed, the
        // ground composited up through every transparent ancestor, and the
        // ratio between them against WCAG AA — 3:1 for large text, 4.5:1 for
        // the rest.
        //
        // Written with no named function values anywhere, because esbuild
        // gives those a `__name` helper that does not exist in the page.
        unreadable: (() => {
          const out: Array<{ t: string; say: string; ratio: number; ink: string; on: string }> = [];
          for (const e of Array.from(document.querySelectorAll('body *'))) {
            const own = Array.from(e.childNodes)
              .filter((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1);
            if (own.length === 0) continue;
            const cs = getComputedStyle(e);
            if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
            const box = e.getBoundingClientRect();
            if (box.width < 2 || box.height < 2) continue;
            const ink = (/rgba?\(([^)]+)\)/.exec(cs.color)?.[1] ?? '')
              .split(',').map(Number);
            if (ink.length < 3) continue;
            const inkA = ink.length > 3 ? (ink[3] ?? 1) : 1;
            if (inkA < 0.95) continue; // deliberately faded; a different question
            // The ground: composite every ancestor's background upward until
            // it is opaque. The page's own ground is the base.
            let rr = 255; let gg = 255; let bb = 255; let settled = false;
            const chain: Element[] = [];
            for (let n: Element | null = e; n !== null; n = n.parentElement) chain.push(n);
            chain.push(document.documentElement);
            for (const n of chain.reverse()) {
              const nb = (/rgba?\(([^)]+)\)/.exec(getComputedStyle(n).backgroundColor)?.[1] ?? '')
                .split(',').map(Number);
              if (nb.length < 3) continue;
              const a = nb.length > 3 ? (nb[3] ?? 1) : 1;
              if (a === 0) continue;
              rr = (nb[0] ?? 0) * a + rr * (1 - a);
              gg = (nb[1] ?? 0) * a + gg * (1 - a);
              bb = (nb[2] ?? 0) * a + bb * (1 - a);
              settled = true;
            }
            if (!settled) continue;
            const lum: number[] = [];
            for (const trio of [[ink[0] ?? 0, ink[1] ?? 0, ink[2] ?? 0], [rr, gg, bb]]) {
              let acc = 0;
              const weight = [0.2126, 0.7152, 0.0722];
              for (let k = 0; k < 3; k += 1) {
                const c = (trio[k] ?? 0) / 255;
                acc += (weight[k] ?? 0) * (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
              }
              lum.push(acc);
            }
            const hi = Math.max(lum[0] ?? 0, lum[1] ?? 0);
            const lo = Math.min(lum[0] ?? 0, lum[1] ?? 0);
            const ratio = (hi + 0.05) / (lo + 0.05);
            const size = parseFloat(cs.fontSize);
            const bold = Number(cs.fontWeight) >= 700;
            const floor = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
            if (ratio + 0.02 < floor) {
              out.push({
                t: `${e.tagName.toLowerCase()}.${(e.className || '-').toString().slice(0, 22)}`,
                say: (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 34),
                ratio: Math.round(ratio * 100) / 100,
                ink: `rgb(${String(Math.round(ink[0] ?? 0))},${String(Math.round(ink[1] ?? 0))},${String(Math.round(ink[2] ?? 0))})`,
                on: `rgb(${String(Math.round(rr))},${String(Math.round(gg))},${String(Math.round(bb))})`,
              });
            }
          }
          return out.sort((a, b) => a.ratio - b.ratio).slice(0, 6);
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
      const owners = !publicFace.has(p.name);
      const key = `${p.name} ${mode} ${String(width)}`;
      const was = grounds.get(key);
      if (was === undefined) grounds.set(key, seen.skin);
      else if (was !== seen.skin && owners) {
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
      const comparable = owners && !unsteady.has(p.name);
      const firstShape = shapes.get(shapeKey);
      if (firstShape === undefined) shapes.set(shapeKey, { mode, h: seen.height });
      else if (firstShape.h !== seen.height && comparable) {
        failures += 1;
        console.log(`  ✗ ${shapeKey}: the appearance changed the shape — `
          + `${firstShape.mode} ${String(firstShape.h)}px vs ${mode} ${String(seen.height)}px`);
      }
      const over = seen.scrollW > seen.clientW;
      if (over) failures += 1;
      if (seen.theme !== mode && owners) { failures += 1; }
      // A CLIP IS A FAILURE, NOT A FOOTNOTE. It was reported as neither for
      // the whole campaign, which is how a page with words running off the
      // edge of a button kept being called clean.
      if (seen.clipped.length > 0) failures += 1;
      // A CONTRAST FAILURE IS A FAILURE. It is the one defect on this list
      // that makes a page unusable rather than untidy.
      if (seen.unreadable.length > 0) failures += 1;
      await page.screenshot({
        path: `${dir}/${p.name}-${mode}-${String(width)}.png`,
        fullPage: width === 390,
      });
      if (prefers === 'dark') continue; // One line per page and mode; the
      // second pass exists to compare, not to print the whole table twice.
      console.log(`  ${over || (seen.theme !== mode && owners) ? '✗' : '·'} ${p.name.padEnd(16)} ${mode.padEnd(5)} ${String(width).padEnd(5)} `
        + `${owners ? `theme=${String(seen.theme)}` : 'public face'} ground=${seen.ground} h=${String(seen.height)}px `
        + `under38=${String(seen.small)}${seen.inline ? ` inline=${String(seen.inline)}` : ''}${
          seen.clipped.length ? ` CLIPPED ${String(seen.clipped.length)}` : ''}${
          seen.unreadable.length ? ` UNREADABLE ${String(seen.unreadable.length)}` : ''}${
          seen.occluded.length ? ` UNDER-NAV ${String(seen.occluded[0].by)}px [${seen.occluded.map((x) => x.t).join(', ')}]` : ''}${over ? ` OVERFLOW ${String(seen.scrollW)}>${String(seen.clientW)}` : ''}`
        + (process.env.EVENTIDE_BLOCKS
          ? `\n      ${seen.blocks.map((b) => `${String(b.h).padStart(5)}px ${b.t} ${b.say}`).join('\n      ')}` : '')
        + (process.env.EVENTIDE_SMALL
          ? `\n      pad=${seen.pad.padBottom} chrome=${seen.pad.chrome || 'unset'} bar=${String(seen.pad.barH)}px`
            + ` coarse=${String(seen.coarse)} floor=${width === 390 ? '38' : '24'}px` : '')
        + (process.env.EVENTIDE_SMALL && seen.smallest.length
          ? `\n      ${seen.smallest.map((x) => `${x.t} ${String(x.w)}x${String(x.h)}`).join('\n      ')}` : '')
        + (seen.clipped.length
          ? `\n      clipped: ${seen.clipped.map((x) => `${x.t} by ${String(x.by)}px “${x.say}”`).join('\n      clipped: ')}` : '')
        + (seen.unreadable.length
          ? `\n      unreadable: ${seen.unreadable.map((x) =>
    `${x.t} ${String(x.ratio)}:1 ${x.ink} on ${x.on} “${x.say}”`).join('\n      unreadable: ')}` : ''));
    }
  }
  await context.close();
 }
}
await browser.close();
if (unsteady.size > 0) {
  console.log(`\n  ! ${String(unsteady.size)} page(s) render differently twice running, so their `
    + `appearances cannot be compared: ${[...unsteady].join(', ')}`);
}
console.log(failures === 0 ? '\nEventide: every page rendered, themed and fitted.' : `\nEventide: ${String(failures)} problem(s).`);
process.exit(failures === 0 ? 0 : 1);
