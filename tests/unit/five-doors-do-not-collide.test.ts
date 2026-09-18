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
// FIVE DOORS DO NOT COLLIDE.
//
// The owner's phone showed the bar's labels laid over one another. The
// measurement script only ever asked whether the page overflowed and whether
// the bars covered content, so the congestion shipped green. This asks the
// question the screenshot asked: at each supported width, at normal and
// doubled text, are there at most five doors, does every label fit its own
// track, does no door overlap its neighbour, is every target big enough for a
// thumb, is exactly one door lit, and does More open a sheet with every
// secondary place in rows a thumb can hit. Skipped, not failed, where there
// is no Chromium; the release runs it.
// =============================================================================

const CHROMIUM = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find((p) => existsSync(p));
const WIDTHS = [375, 390, 430];
const OWNER = 'collide_owner';
let stop: (() => void) | null = null;
let port = 0;

beforeAll(async () => {
  if (!CHROMIUM) return;
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_collide', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status) VALUES ('collide_p','Private Foundry',?,'active','active')`, [OWNER]);
  const founder = (await query('SELECT * FROM founders WHERE id = ?', [OWNER])).rows[0] as Record<string, unknown>;
  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use('*', async (c: any, next) => { c.set('founder', founder); c.set('userId', OWNER); c.set('csrfToken', 't'); await next(); });
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
interface Seen { doors: Door[]; overflowX: number; sheet: { visible: boolean; rows: Array<{ label: string; height: number; current: boolean }> } | null }

async function measure(width: number, scale: number, path: string, openMore: boolean): Promise<Seen> {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM as string, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
    const page = await ctx.newPage();
    if (scale !== 1) await page.addInitScript((s: number) => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${17 * s}px`; }); }, scale);
    await page.goto(`http://localhost:${String(port)}${path}`, { waitUntil: 'networkidle' });
    if (openMore) { await page.click('nav.places a.more-door'); await page.waitForTimeout(100); }
    return await page.evaluate(() => {
      const visible = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; };
      const doors = [...document.querySelectorAll('nav.places a')].filter(visible).map((a) => {
        const r = a.getBoundingClientRect();
        return { label: (a.textContent ?? '').trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom,
          clipped: a.scrollWidth > a.clientWidth + 1 || a.scrollHeight > a.clientHeight + 1, lit: a.classList.contains('on') };
      }).sort((x, y) => x.left - y.left);
      const de = document.documentElement;
      const more = document.getElementById('more');
      const sheet = more && visible(more) ? { visible: true, rows: [...more.querySelectorAll('a')].map((a) => ({ label: (a.textContent ?? '').trim(), height: a.getBoundingClientRect().height, current: a.hasAttribute('aria-current') })) } : null;
      return { doors, overflowX: de.scrollWidth - de.clientWidth, sheet };
    });
  } finally { await browser.close(); }
}

const phones = CHROMIUM ? describe : describe.skip;

phones('the bar, on the phone he actually holds', () => {
  for (const width of WIDTHS) {
    for (const scale of [1, 2]) {
      it(`at ${String(width)}px and ${String(scale * 100)}% text: five doors, none clipped, none overlapping, all thumb-sized, one lit`, async () => {
        for (const path of ['/foundry', '/foundry/decisions']) {
          const seen = await measure(width, scale, path, false);
          expect(seen.overflowX, `${path} overflow`).toBe(0);
          expect(seen.doors.length, `${path} doors`).toBeLessThanOrEqual(5);
          expect(seen.doors.map((d) => d.label), path).toEqual(['Home', 'Portfolio', 'Experiments', 'Inbox', 'More']);
          for (const d of seen.doors) {
            expect(d.clipped, `${path} ${d.label} clipped`).toBe(false);
            expect(d.right - d.left, `${path} ${d.label} width`).toBeGreaterThanOrEqual(44);
            expect(d.bottom - d.top, `${path} ${d.label} height`).toBeGreaterThanOrEqual(44);
          }
          for (let i = 1; i < seen.doors.length; i++) {
            expect(seen.doors[i - 1]!.right, `${path} ${seen.doors[i - 1]!.label} overlaps ${seen.doors[i]!.label}`).toBeLessThanOrEqual(seen.doors[i]!.left + 0.5);
          }
          expect(seen.doors.filter((d) => d.lit).map((d) => d.label), path).toEqual([path === '/foundry' ? 'Home' : 'More']);
        }
      }, 120_000);
    }
  }

  it('More opens a sheet with every secondary place in thumb-sized rows, the page underfoot marked', async () => {
    const seen = await measure(390, 1, '/foundry/decisions', true);
    expect(seen.sheet?.visible).toBe(true);
    expect(seen.sheet!.rows.length).toBeGreaterThanOrEqual(10);
    for (const r of seen.sheet!.rows) expect(r.height, r.label).toBeGreaterThanOrEqual(44);
    expect(seen.sheet!.rows.filter((r) => r.current).map((r) => r.label)).toEqual(['Decisions']);
    expect(seen.overflowX).toBe(0);
  }, 120_000);

  it('the Letter lights no door, and its bar still has five', async () => {
    const seen = await measure(390, 1, '/letter', false);
    expect(seen.doors.map((d) => d.label)).toEqual(['Home', 'Portfolio', 'Experiments', 'Inbox', 'More']);
    expect(seen.doors.filter((d) => d.lit)).toEqual([]);
  }, 120_000);
});
