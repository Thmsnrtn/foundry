// =============================================================================
// THE OWNER SURFACE FITS A PHONE.
//
// The surfaces this month changed — the experiment page's "What happened and
// why", the Inbox's clear control, the money answer, Explore's precedent line
// — read on a 390px phone from the world, in a real browser: no horizontal
// scroll on any of them, and the way to ask (the Ask pill) on the first
// screen of every page, because a returning owner on a phone asks before he
// taps. Skips rather than fails without a browser, as the geometry test does.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);

import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { serve } from '@hono/node-server';
import { OWNER, owner, ownerApp, seedProductionShape } from '../helpers/world.js';

vi.setConfig({ testTimeout: 120_000 });
const CHROMIUM = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) => existsSync(p));
let port = 0; let stop: (() => void) | null = null; let X = '';

beforeAll(async () => {
  if (!CHROMIUM) return;
  ({ experimentId: X } = await seedProductionShape({ searching: true }));
  const app = await ownerApp();
  const me = owner(app);
  const mail = await import('../../src/services/public-workshop/mail.js');
  await mail.openTheEars(OWNER);
  await mail.hearMail({ founderId: OWNER, to: 'thomas@apexmicro.ai', from: 'shop@example.com', fromName: 'A shop', subject: 'Thanks', body: 'This was useful.', rfcMessageId: '<p1@example.com>', size: 100 });
  for (const t of await mail.theThreads(OWNER, 'working')) await mail.settleThread({ founderId: OWNER, threadKey: t.key, because: 'dealt with' });
  void me;
  const server = serve({ fetch: app.fetch, port: 0 });
  port = (server.address() as { port: number }).port;
  stop = () => { server.close(); };
}, 120_000);
afterAll(() => { if (stop) stop(); });

interface Seen { text: string; firstScreen: string; overflowX: number; width: number }
async function onThePhone(path: string): Promise<Seen> {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM as string, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${String(port)}${path}`, { waitUntil: 'networkidle' });
    return await page.evaluate(() => {
      const H = innerHeight;
      const firstScreen = [...document.querySelectorAll('h1,h2,p,a,button,summary,span.state')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.top < H && r.height > 0; })
        .map((e) => e.textContent?.replace(/\s+/g, ' ').trim() ?? '').filter(Boolean).join(' | ');
      const de = document.documentElement;
      return { text: document.body.innerText, firstScreen, overflowX: de.scrollWidth - de.clientWidth, width: de.clientWidth };
    });
  } finally { await browser.close(); }
}

const phones = CHROMIUM ? describe : describe.skip;

phones('the surfaces that changed, on a 390px phone', () => {
  it('Home: no horizontal scroll; the last test\'s word; the way to ask on the first screen', async () => {
    const seen = await onThePhone('/foundry');
    expect(seen.overflowX).toBe(0);
    expect(seen.text).toContain('Last test');
    expect(seen.text).toContain('Surprised');
    expect(seen.firstScreen).toMatch(/Ask/);
  });

  it('the experiment page: "What happened and why" reads without sideways scroll', async () => {
    const seen = await onThePhone(`/foundry/experiments/${X}`);
    expect(seen.overflowX).toBe(0);
    expect(seen.text).toContain('What happened and why');
    expect(seen.text).toContain('What that establishes');
    expect(seen.firstScreen).toMatch(/Ask/);
  });

  it('the Inbox\'s Handled view carries the clear control and fits', async () => {
    const seen = await onThePhone('/foundry/inbox?show=handled');
    expect(seen.overflowX).toBe(0);
    expect(seen.text).toContain('Put away all 1');
  });

  it('the money answer and Explore\'s precedent line fit', async () => {
    const money = await onThePhone(`/foundry?q=${encodeURIComponent('Is anything making money yet?')}`);
    expect(money.overflowX).toBe(0);
    expect(money.text).toContain('Nobody has paid for anything yet.');
    const explore = await onThePhone('/foundry/experiments/explore');
    expect(explore.overflowX).toBe(0);
    expect(explore.text).toContain('Tested before:');
  });
});
