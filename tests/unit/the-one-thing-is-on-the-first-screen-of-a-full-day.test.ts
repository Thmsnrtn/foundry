// =============================================================================
// THE ONE THING IS ON THE FIRST SCREEN OF A FULL DAY.
//
// `the-owner-can-reach-the-one-thing` proved the card reaches the first screen
// — on a world with one company, no charter, no search, no glance worth
// drawing, and nothing else on Home. That is the easy page, and it passed
// while the owner walk, on the world production actually has (a charter, a
// search running, the eyes open, an undecided test, three companies, mail),
// measured the card's top at 888px on a 390×844 phone and 957px on an SE:
// below the pulse, the quick tiles, the four-tile glance and the
// standing-permission composer, none of which asked anything of the owner.
//
// So this one seeds what the walk seeds and asks the same question at the
// three phone sizes the walk holds, plus the large phone: is the card the owner
// came for, and the button that answers it, on the screen before any scroll?
//
// SKIPS RATHER THAN FAILS WITHOUT A BROWSER, as the geometry test does.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.STRIPE_SECRET_KEY ??= 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_fake';
process.env.APP_URL = 'http://localhost:8099';

import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { serve } from '@hono/node-server';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const CHROMIUM = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find((p) => existsSync(p));

// The walk's phones, and the large one.
const PHONES = [
  { name: 'iPhone 13', width: 390, height: 844 },
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone Pro Max', width: 430, height: 932 },
];
let port = 0;
let stop: (() => void) | null = null;

beforeAll(async () => {
  if (!CHROMIUM) return;
  const { providerStubs } = await import('../helpers/provider-stubs.js');
  const stubs = providerStubs();
  vi.stubGlobal('fetch', (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    return stubs.fetch(u, init);
  }) as typeof fetch);
  const { seedProductionShape, addCompanies, ownerApp, OWNER } = await import('../helpers/world.js');
  await seedProductionShape({ charter: true, searching: true, eyes: true, undecided: true });
  const app = await ownerApp();
  await addCompanies(app, ['Apex Micro Press', 'Northfield Candles', 'Tidewater Templates']);
  const mail = await import('../../src/services/public-workshop/mail.js');
  const { publicWorkshopOf } = await import('../../src/services/public-workshop/settings.js');
  await mail.openTheEars(OWNER);
  const to = (await publicWorkshopOf(OWNER))?.contactEmail ?? 'thomas@apexmicro.ai';
  await mail.hearMail({ founderId: OWNER, to, from: 'shop@example.com', fromName: 'A millwork shop', subject: 'About the bid brief', body: 'Is the brief updated weekly?', rfcMessageId: '<first-screen-1@example.com>', size: 60 });
  // The header's count is computed only inside the viewer, as production serves it.
  const { withViewer } = await import('../../src/views/owner/viewer.js');
  const server = serve({ fetch: (req: Request) => withViewer(OWNER, () => app.fetch(req)), port: 0, hostname: '127.0.0.1' });
  if (!server.address()) await new Promise<void>((r) => { (server as unknown as { once: (e: string, f: () => void) => void }).once('listening', r); });
  port = (server.address() as { port: number }).port;
  stop = () => { server.close(); };
});

afterAll(() => { if (stop) stop(); vi.unstubAllGlobals(); });

const phones = CHROMIUM ? describe : describe.skip;

async function measure(phone: { width: number; height: number }) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM as string, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({
      viewport: { width: phone.width, height: phone.height }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${String(port)}/foundry`, { waitUntil: 'networkidle' });
    return await page.evaluate(() => {
      const H = innerHeight;
      const one = document.querySelector('#the-one-thing');
      const primary = one?.querySelector('.btn.go, .do button, .do a') ?? null;
      // What sits fixed over the bottom of the screen hides what is under it.
      const bars = [...document.querySelectorAll('*')]
        .filter((e) => getComputedStyle(e).position === 'fixed')
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.height < H / 2 && r.bottom > H * 0.6);
      const chromeTop = bars.length ? Math.min(...bars.map((r) => r.top)) : H;
      return {
        present: Boolean(one),
        act: one?.querySelector('.act')?.textContent?.trim() ?? null,
        cardTop: one ? one.getBoundingClientRect().top : null,
        primaryBottom: primary ? primary.getBoundingClientRect().bottom : null,
        chromeTop,
      };
    });
  } finally { await browser.close(); }
}

function onTheFirstScreen(seen: Awaited<ReturnType<typeof measure>>, height: number): void {
  expect(seen.present, 'the queue says something needs the owner, so Home has the card').toBe(true);
  expect(seen.cardTop!).toBeGreaterThan(0);
  expect(seen.cardTop!, `the card's top, on a ${String(height)}px screen`).toBeLessThan(seen.chromeTop);
  expect(seen.primaryBottom, 'the card has a way to answer').not.toBeNull();
  expect(seen.primaryBottom!, 'and the answer is above the bars, unscrolled').toBeLessThanOrEqual(seen.chromeTop);
}

phones('the card the owner came for, before any scroll, on the world production has', () => {
  for (const phone of PHONES) {
    it(`is on the first screen of a ${phone.name} (${String(phone.width)}×${String(phone.height)})`, async () => {
      onTheFirstScreen(await measure(phone), phone.height);
    });
  }

  // DAY 39, AS THE WALK HOLDS IT. The charter the world signed has run out, so
  // the card is the charter's — three terms and a door — and on an SE its
  // button sat at 607px, under bars that begin at 532.
  describe('thirty-eight days on, when the charter has run out', () => {
    beforeAll(async () => {
      const { advanceDays } = await import('../helpers/world.js');
      await advanceDays(38);
    });
    for (const phone of PHONES) {
      it(`is on the first screen of a ${phone.name}`, async () => {
        const seen = await measure(phone);
        expect(seen.act).toBe('Authority');
        onTheFirstScreen(seen, phone.height);
      });
    }
  });
});
