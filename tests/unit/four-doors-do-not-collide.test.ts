process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '9'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.APP_URL = 'http://localhost:8097';

import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// FOUR DOORS DO NOT COLLIDE, AND THE COMPOSER SITS ABOVE THEM.
//
// The owner's phone once showed the bar's labels laid over one another, and
// the measurement script only asked whether the page overflowed. This asks the
// question the screenshot asked, of the Mission Control bar (30 September
// 2026): at each supported width, at normal and doubled text, are there four
// doors, does every label fit its own track, does no door overlap its
// neighbour, is every target big enough for a thumb, is exactly one door lit —
// and is the composer docked above the bar, thumb-sized, covering none of it.
// Skipped, not failed, where there is no Chromium; the release runs it.
// =============================================================================

const CHROMIUM = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find((p) => existsSync(p));
const WIDTHS = [375, 390, 430];
const OWNER = 'collide_owner';
let REFERENCE = '';
let stop: (() => void) | null = null;
let port = 0;

beforeAll(async () => {
  if (!CHROMIUM) return;
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_collide', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status) VALUES ('collide_p','Private Foundry',?,'active','active')`, [OWNER]);
  // SOMETHING WAITS, so the header carries a number to measure, not an empty pill.
  const { proposeAct, setBoundary } = await import('../../src/services/institution/standing-intent.js');
  await setBoundary({ productId: 'collide_p', subject: 'set_prices', mode: 'ask_first', statement: 'Ask me before changing prices' });
  await proposeAct({ productId: 'collide_p', subject: 'set_prices', actionType: null, params: { price: 49 },
    summary: 'Raise the price to $49', why: 'Buyers asked', expectedEffect: 'More per sale', risk: 'Fewer sales',
    consequence: 'low', proposedBy: 'institution:test' });
  // A COMPANY WITH MORE THAN THREE DIMENSIONS, so its bar carries More.
  const { establishReferenceCompany, advanceReferenceWorld } = await import('../../src/services/reference/world.js');
  const reference = await establishReferenceCompany({ scenarioKey: 'revenue_quietly_falling', ownerId: OWNER });
  if (!reference) throw new Error('the reference scenario did not resolve');
  await advanceReferenceWorld(reference.productId);
  REFERENCE = reference.productId;
  const founder = (await query('SELECT * FROM founders WHERE id = ?', [OWNER])).rows[0] as Record<string, unknown>;
  const { withViewer } = await import('../../src/views/owner/viewer.js');
  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use('*', async (c: any, next) => { c.set('founder', founder); c.set('userId', OWNER); c.set('csrfToken', 't'); await withViewer(OWNER, next); });
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app.route('/', letterRoutes);
  const { staticAssetHandler } = await import('../../src/routes/public/static-assets.js');
  const { resolve } = await import('node:path');
  app.get('/static/:file', staticAssetHandler(resolve('src')));
  const server = serve({ fetch: app.fetch, port: 0 });
  port = (server.address() as { port: number }).port;
  stop = () => { server.close(); };
}, 120_000);
afterAll(() => { if (stop) stop(); });

interface Door { label: string; left: number; right: number; top: number; bottom: number; clipped: boolean; lit: boolean }
interface Box { top: number; bottom: number; height: number }
interface Seen { doors: Door[]; overflowX: number; composer: Box | null; bar: Box | null; elsewhere: Array<{ label: string; height: number }>;
  needs: { top: number; bottom: number; left: number; right: number; text: string } | null; width: number }

async function measure(width: number, scale: number, path: string): Promise<Seen> {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM as string, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
    const page = await ctx.newPage();
    if (scale !== 1) await page.addInitScript((s: number) => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${17 * s}px`; }); }, scale);
    await page.goto(`http://localhost:${String(port)}${path}`, { waitUntil: 'networkidle' });
    return await page.evaluate(() => {
      const visible = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; };
      const doors = [...document.querySelectorAll('nav.places a')].filter(visible).map((a) => {
        const r = a.getBoundingClientRect();
        return { label: (a.textContent ?? '').trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom,
          clipped: a.scrollWidth > a.clientWidth + 1 || a.scrollHeight > a.clientHeight + 1, lit: a.classList.contains('on') };
      }).sort((x, y) => x.left - y.left);
      const de = document.documentElement;
      const box = (e: Element | null) => { if (!e || !visible(e)) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
      const elsewhere = [...document.querySelectorAll('nav.elsewhere a')].filter(visible)
        .map((a) => ({ label: (a.textContent ?? '').trim(), height: a.getBoundingClientRect().height }));
      const pill = [...document.querySelectorAll('a.needs')].find(visible) ?? null;
      const pr = pill ? pill.getBoundingClientRect() : null;
      return { doors, overflowX: de.scrollWidth - de.clientWidth, width: de.clientWidth,
        needs: pill && pr ? { top: pr.top, bottom: pr.bottom, left: pr.left, right: pr.right, text: (pill.textContent ?? '').trim() } : null,
        composer: box(document.querySelector('#ask-foundry .ask-in')), bar: box(document.querySelector('nav.places:not(.company)')), elsewhere };
    });
  } finally { await browser.close(); }
}

const phones = CHROMIUM ? describe : describe.skip;

const DOORS = ['Home', 'Portfolio', 'Explore', 'Control'];

phones('the bar, on the phone he actually holds', () => {
  for (const width of WIDTHS) {
    for (const scale of [1, 2]) {
      it(`at ${String(width)}px and ${String(scale * 100)}% text: four doors, none clipped, none overlapping, all thumb-sized, one lit`, async () => {
        for (const [path, lit] of [['/foundry', 'Home'], ['/foundry/explore', 'Explore'], ['/foundry/experiments', 'Explore'], ['/foundry/money', 'Portfolio']] as const) {
          const seen = await measure(width, scale, path);
          expect(seen.overflowX, `${path} overflow`).toBe(0);
          expect(seen.doors.map((d) => d.label), path).toEqual(DOORS);
          for (const d of seen.doors) {
            expect(d.clipped, `${path} ${d.label} clipped`).toBe(false);
            expect(d.right - d.left, `${path} ${d.label} width`).toBeGreaterThanOrEqual(44);
            expect(d.bottom - d.top, `${path} ${d.label} height`).toBeGreaterThanOrEqual(44);
          }
          for (let i = 1; i < seen.doors.length; i++) {
            expect(seen.doors[i - 1]!.right, `${path} ${seen.doors[i - 1]!.label} overlaps ${seen.doors[i]!.label}`).toBeLessThanOrEqual(seen.doors[i]!.left + 0.5);
          }
          expect(seen.doors.filter((d) => d.lit).map((d) => d.label), path).toEqual([lit]);
          // THE COMPOSER IS ON THE PAGE, NOT BEHIND A BUTTON: visible, a thumb
          // tall, and wholly above the bar so neither covers the other.
          expect(seen.composer, `${path} composer`).not.toBeNull();
          expect(seen.composer!.height, `${path} composer height`).toBeGreaterThanOrEqual(44);
          expect(seen.composer!.bottom, `${path} composer sits above the bar`).toBeLessThanOrEqual(seen.bar!.top + 0.5);
          // NEEDS YOU IS IN THE HEADER, not the bar: one pill, visible, a
          // thumb tall, inside the screen, carrying its number.
          expect(seen.needs, `${path} needs you`).not.toBeNull();
          expect(seen.needs!.bottom - seen.needs!.top, `${path} needs you height`).toBeGreaterThanOrEqual(44);
          expect(seen.needs!.right, `${path} needs you inside the screen`).toBeLessThanOrEqual(seen.width + 0.5);
          expect(seen.needs!.bottom, `${path} needs you sits above the bar`).toBeLessThanOrEqual(seen.bar!.top);
          expect(seen.needs!.text, `${path} needs you count`).toMatch(/1$/);
        }
      }, 120_000);
    }
  }

  it('Control lists every other place in thumb-sized rows', async () => {
    const seen = await measure(390, 1, '/foundry/controls');
    expect(seen.elsewhere.length).toBeGreaterThanOrEqual(10);
    for (const r of seen.elsewhere) expect(r.height, r.label).toBeGreaterThanOrEqual(44);
    expect(seen.overflowX).toBe(0);
  }, 120_000);

  // INSIDE A COMPANY THE BAR IS THE COMPANY'S, and keeps to five in one row:
  // Portfolio, three dimensions, More (f97f3036). The four-door grid of 30
  // September gave it four tracks, so More wrapped under Portfolio and the bar
  // grew over the page's last lines — found when measure-mobile's door rules
  // were corrected (remediation, 7 October 2026).
  it('a company\'s bar keeps its five in one row, at every phone width', async () => {
    for (const width of WIDTHS) {
      for (const scale of [1, 2]) {
        const seen = await measure(width, scale, `/foundry/companies/${REFERENCE}`);
        const where = `${String(width)}px ${String(scale * 100)}%`;
        expect(seen.doors.length, `${where}: Portfolio, three dimensions and More`).toBe(5);
        expect(seen.doors[0]!.label, where).toBe('Portfolio');
        expect(seen.doors[4]!.label, where).toBe('More');
        expect(new Set(seen.doors.map((d) => Math.round(d.top))).size, `${where}: one row`).toBe(1);
        for (let i = 1; i < seen.doors.length; i++) {
          expect(seen.doors[i - 1]!.right, `${where} ${seen.doors[i - 1]!.label} overlaps ${seen.doors[i]!.label}`).toBeLessThanOrEqual(seen.doors[i]!.left + 0.5);
        }
        for (const d of seen.doors) {
          expect(d.right - d.left, `${where} ${d.label} width`).toBeGreaterThanOrEqual(44);
          expect(d.bottom - d.top, `${where} ${d.label} height`).toBeGreaterThanOrEqual(44);
        }
        expect(seen.doors.filter((d) => d.lit).length, `${where}: the dimension underfoot is lit`).toBe(1);
        expect(seen.overflowX, where).toBe(0);
      }
    }
  }, 240_000);

  it('the Letter lights no door, and its bar still has four', async () => {
    const seen = await measure(390, 1, '/letter');
    expect(seen.doors.map((d) => d.label)).toEqual(DOORS);
    expect(seen.doors.filter((d) => d.lit)).toEqual([]);
  }, 120_000);
});
