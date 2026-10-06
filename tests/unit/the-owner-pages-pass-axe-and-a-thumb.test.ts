// =============================================================================
// THE OWNER'S PAGES PASS AXE AND A THUMB (remediation, 6 October 2026).
//
// The owner walk found what no gate had: an unlabelled switch on Settings and
// three on Privacy (axe critical), the Inbox's selected filter in mint on
// near-white, a definition list holding a link on Activity, a "Needs you" pill
// and company cards whose spoken name was not the one on the screen (axe
// serious), and controls under WCAG 2.2's 24px floor on a dozen pages. Each was
// fixed where it was drawn; this holds every one of those pages to it, on the
// world production has, so the next one fails here rather than in a walk
// somebody has to remember to run.
//
// Axe at serious and above, everywhere. 24px for every control on a phone;
// 44px is the design target the components carry, and the floor is what a
// regression is measured against.
//
// SKIPS RATHER THAN FAILS WITHOUT A BROWSER, as the geometry tests do.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.STRIPE_SECRET_KEY ??= 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_fake';
process.env.APP_URL = 'http://localhost:8099';

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { serve } from '@hono/node-server';
import type { Browser } from 'playwright-core';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const CHROMIUM = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find((p) => existsSync(p));
const AXE = resolve('node_modules/axe-core/axe.min.js');

let port = 0;
let stop: (() => void) | null = null;
let browser: Browser | null = null;
let pages: string[] = [];

beforeAll(async () => {
  if (!CHROMIUM) return;
  const { providerStubs } = await import('../helpers/provider-stubs.js');
  const stubs = providerStubs();
  vi.stubGlobal('fetch', (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    return stubs.fetch(u, init);
  }) as typeof fetch);
  const { seedProductionShape, addCompanies, ownerApp, OWNER } = await import('../helpers/world.js');
  const { experimentId } = await seedProductionShape({ charter: true, searching: true, eyes: true, undecided: true });
  const app = await ownerApp();
  const [company] = await addCompanies(app, ['Apex Micro Press', 'Northfield Candles']);
  const mail = await import('../../src/services/public-workshop/mail.js');
  const { publicWorkshopOf } = await import('../../src/services/public-workshop/settings.js');
  await mail.openTheEars(OWNER);
  const to = (await publicWorkshopOf(OWNER))?.contactEmail ?? 'thomas@apexmicro.ai';
  await mail.hearMail({ founderId: OWNER, to, from: 'shop@example.com', fromName: 'A millwork shop', subject: 'About the bid brief', body: 'Is the brief updated weekly?', rfcMessageId: '<axe-gate-1@example.com>', size: 60 });
  const { withViewer } = await import('../../src/views/owner/viewer.js');
  const server = serve({ fetch: (req: Request) => withViewer(OWNER, () => app.fetch(req)), port: 0, hostname: '127.0.0.1' });
  if (!server.address()) await new Promise<void>((r) => { (server as unknown as { once: (e: string, f: () => void) => void }).once('listening', r); });
  port = (server.address() as { port: number }).port;
  stop = () => { server.close(); };
  // Every page the walk found something on, and the doors.
  pages = [
    '/foundry', '/foundry/companies', `/foundry/companies/${company!}`, '/foundry/explore',
    '/foundry/controls', '/foundry/charter', '/foundry/activity', '/foundry/absence',
    '/foundry/inbox', '/foundry/inbox?show=needs', '/foundry/inbox?show=handled',
    '/foundry/needs-you', '/foundry/money', '/foundry/money/research', '/foundry/etsy-messages',
    '/foundry/experiments', `/foundry/experiments/${experimentId}`, '/foundry/missions',
    '/foundry/public-workshop', `/foundry/public-workshop/preview/${experimentId}`,
    '/settings', '/privacy', '/letter',
  ];
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
});

afterAll(async () => { if (browser) await browser.close(); if (stop) stop(); vi.unstubAllGlobals(); });

interface Seen { path: string; status: number; axe: string[]; tiny: string[]; words: number }

async function walk(width: number, height: number, mobile: boolean): Promise<Seen[]> {
  const ctx = await browser!.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const axe = readFileSync(AXE, 'utf8');
  const out: Seen[] = [];
  try {
    for (const path of pages) {
      const res = await page.goto(`http://127.0.0.1:${String(port)}${path}`, { waitUntil: 'networkidle' });
      await page.addScriptTag({ content: axe });
      const seen = await page.evaluate(async (isPhone) => {
        const r = await (window as unknown as { axe: { run: (d: Document, o: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: Array<{ target: string[] }> }> }> } })
          .axe.run(document, { resultTypes: ['violations'] });
        const axeHits = r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
          .map((v) => `${v.impact ?? ''} ${v.id} at ${v.nodes[0]?.target.join(' ') ?? '?'} (${String(v.nodes.length)})`);
        const tiny: string[] = [];
        if (isPhone) {
          const visible = (e: Element): boolean => {
            const b = e.getBoundingClientRect(); if (b.width === 0 || b.height === 0) return false;
            const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none';
          };
          for (const e of document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button]')) {
            if (!visible(e)) continue;
            const b = e.getBoundingClientRect();
            if (b.width < 24 || b.height < 24) tiny.push(`${e.tagName.toLowerCase()} "${(e.textContent ?? '').trim().slice(0, 30)}" ${String(Math.round(b.width))}x${String(Math.round(b.height))}`);
          }
        }
        const main = document.querySelector('main');
        const words = (main ? main.innerText : '').split(/\s+/).filter(Boolean).length;
        return { axe: axeHits, tiny, words };
      }, mobile);
      out.push({ path, status: res?.status() ?? 0, ...seen });
    }
  } finally { await ctx.close(); }
  return out;
}

const withBrowser = CHROMIUM ? describe : describe.skip;

withBrowser('every page the owner walks', () => {
  it('on a 375×667 phone: renders, passes axe at serious and above, and has no control under 24px', async () => {
    const seen = await walk(375, 667, true);
    expect(seen.filter((s) => s.status !== 200).map((s) => `${s.path} ${String(s.status)}`)).toEqual([]);
    expect(seen.filter((s) => s.axe.length).map((s) => `${s.path}: ${s.axe.join('; ')}`)).toEqual([]);
    expect(seen.filter((s) => s.tiny.length).map((s) => `${s.path}: ${s.tiny.join('; ')}`)).toEqual([]);
  });

  // READING BURDEN: what a phone shows before any disclosure is opened (a
  // closed <details> is not in innerText). 700 words is the walk's line. TWO
  // NAMED EXCEPTIONS: the absence page's open failures (below), and one that
  // is the owner's to remove: "Before you decide"
  // keeps who a test reaches, what it spends and where it stops open, because
  // they are the terms of the only act that reaches a stranger
  // (OWNER_DECISIONS_PENDING 38).
  it('on a phone: no page reads more than 700 words before anything is opened', async () => {
    const seen = await walk(390, 844, true);
    // The preview is the PUBLIC page, as a visitor reads it, not the owner's.
    // "If you stepped away" folds a longer horizon only when it adds no
    // failure: a failing property carries what would fix it and is never
    // folded (`a-fold-never-hides-what-would-fix-it`). On this world the 30-
    // and 90-day horizons each add one, so the page is long because it is
    // telling the owner something — doctrine, not a reading-burden defect.
    const heavy = seen.filter((s) => s.words > 700 && !s.path.endsWith('/decide')
      && !s.path.includes('/preview/') && s.path !== '/foundry/absence');
    expect(heavy.map((s) => `${s.path} ${String(s.words)}w`)).toEqual([]);
  });

  it('on a desk, where the rail carries the Needs-you pill: passes axe at serious and above', async () => {
    const seen = await walk(1440, 900, false);
    expect(seen.filter((s) => s.axe.length).map((s) => `${s.path}: ${s.axe.join('; ')}`)).toEqual([]);
  });
});
