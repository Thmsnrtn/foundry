process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.APP_URL = 'http://localhost:8098';

import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// THE OWNER CAN REACH THE ONE THING.
//
// IF ONE THING NEEDS THE OWNER, THE OWNER MUST BE ABLE TO UNDERSTAND AND ACT ON
// THAT ONE THING IMMEDIATELY.
//
// Every other test in this repository asks whether the institution knows what
// it is doing. This one asks whether the product SAYS SO — on a phone, at the
// width he actually holds, with the bars that actually sit on top of it. Those
// are different questions, and the gap between them was where this failed:
// the machinery correctly determined that one decision genuinely needed him,
// and the layout rendered it as a 28,000-pixel column of single letters with
// the label column starved to zero width.
//
// A DOM assertion could not have caught that. Every element was present, in the
// right order, with the right text. It was the geometry that was wrong, so the
// test has to be geometry: real widths, real fixed bars, real wrapping.
//
// SKIPS RATHER THAN FAILS WITHOUT A BROWSER. The runner that gates deploys does
// not have Chromium, and a gate that cannot run is worse than one that says so.
// =============================================================================

const CHROMIUM = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find((p) => existsSync(p));

const PHONES = [390, 430];
const OWNER = 'reach_owner';
let stop: (() => void) | null = null;
let port = 0;

beforeAll(async () => {
  if (!CHROMIUM) return;
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_reach', 'owner@example.com', 'Thomas']);
  await query('INSERT INTO products (id,name,owner_id,status,scp_status) VALUES (?,?,?,?,?)',
    ['reach_p', 'Private Foundry', OWNER, 'active', 'active']);

  // THE REAL CHAIN RAISES THE REAL CARD. Nothing here writes a decision by
  // hand: the work runs into the wall it actually runs into, and what the
  // owner is shown is what that produced.
  const { produceSchemaDescription } = await import(
    '../../src/services/institution/carrying.js');
  await produceSchemaDescription({ founderId: OWNER, evidenceMode: 'real' });

  // AND A STOPPED ROUTINE, BECAUSE THAT IS THE SCREEN HE ACTUALLY OPENED. The
  // tidy case was the only one ever rendered, and the real one had a failing
  // routine on it that took the whole first screen.
  await query(
    `INSERT INTO job_health (job_name, consecutive_failures, last_success_at)
     VALUES ('institutional_judgment_tick', 3, datetime('now','-2 days'))`);

  const founder = (await query('SELECT * FROM founders WHERE id = ?', [OWNER]))
    .rows[0] as Record<string, unknown>;
  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use('*', async (c: any, next) => {
    c.set('founder', founder); c.set('userId', OWNER); c.set('csrfToken', 't');
    await next();
  });
  const shell = await import('../../src/routes/dashboard/foundry-shell.js');
  app.route('/', shell.foundryShellRoutes);
  const server = serve({ fetch: app.fetch, port: 0 });
  port = (server.address() as { port: number }).port;
  stop = () => { server.close(); };
}, 120_000);

afterAll(() => { if (stop) stop(); });

async function onThePhone<T>(
  width: number, fn: (page: Awaited<ReturnType<typeof openPage>>) => Promise<T>,
): Promise<T> {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({
    executablePath: CHROMIUM as string, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({
      viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${String(port)}/foundry`, { waitUntil: 'networkidle' });
    return await fn(page);
  } finally { await browser.close(); }
}
type PageOf<T> = T extends Promise<infer U> ? U : never;
declare function openPage(): Promise<unknown>;

const phones = CHROMIUM ? describe : describe.skip;

phones('the first screen, on the phone he actually holds', () => {
  for (const width of PHONES) {
    it(`says one thing needs him, and shows what it is, at ${String(width)}px`,
      async () => {
        const seen = await onThePhone(width, async (page) => page.evaluate(() => ({
          text: document.body.innerText,
          cardTop: document.querySelector('#the-one-thing')?.getBoundingClientRect().top ?? -1,
        })));
        expect(seen.text).toContain('One thing needs you');
        expect(seen.text).toContain('Foundry needs an isolated workshop');
        // In the FIRST viewport, not somewhere below three tiles of context.
        expect(seen.cardTop).toBeGreaterThan(0);
        expect(seen.cardTop).toBeLessThan(844);
      }, 120_000);

    it(`breaks no ordinary word and overflows nowhere at ${String(width)}px`, async () => {
      const seen = await onThePhone(width, async (page) => page.evaluate(() => {
        // A TRACK STARVED TO NOTHING IS THE DEFECT; a broken word is its
        // symptom. Measuring the track catches it before anybody has to read
        // the result.
        const starved = [...document.querySelectorAll('dd, .tile dd, p')]
          .filter((e) => e.textContent!.trim().length > 20)
          .filter((e) => e.getBoundingClientRect().width < 60)
          .map((e) => e.textContent!.slice(0, 40));
        const de = document.documentElement;
        return { starved, overflowX: de.scrollWidth - de.clientWidth, tall: de.scrollHeight };
      }));
      expect(seen.starved).toEqual([]);
      expect(seen.overflowX).toBe(0);
      // A decision card that needs thirty screens is not a decision card.
      expect(seen.tall).toBeLessThan(9000);
    }, 120_000);

    it(`keeps every control clear of the bars at ${String(width)}px`, async () => {
      const seen = await onThePhone(width, async (page) => {
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(150);
        return page.evaluate(() => {
          const H = innerHeight;
          const bars = [...document.querySelectorAll('*')]
            .filter((e) => getComputedStyle(e).position === 'fixed')
            .map((e) => e.getBoundingClientRect())
            .filter((r) => r.height < H / 2 && r.bottom > H * 0.6);
          const chromeTop = bars.length ? Math.min(...bars.map((r) => r.top)) : H;
          const buried = [...document.querySelectorAll('.do .btn')]
            .filter((e) => e.getBoundingClientRect().bottom > chromeTop)
            .map((e) => e.textContent!.trim());
          return { buried, reserved: getComputedStyle(document.querySelector('.wrap')!).paddingBottom };
        });
      });
      expect(seen.buried).toEqual([]);
      // Reserved from measurement rather than from a constant that cannot be
      // right for every text size.
      expect(parseFloat(seen.reserved)).toBeGreaterThan(100);
    }, 120_000);
  }

  it('answers "why" without making him decide in order to find out', async () => {
    const seen = await onThePhone(390, async (page) => page.evaluate(() => {
      const why = [...document.querySelectorAll('#the-one-thing details')]
        .find((d) => d.querySelector('summary')?.textContent?.trim() === 'Why?');
      if (!why) return null;
      const before = location.href;
      (why as HTMLDetailsElement).open = true;
      return { chars: why.textContent!.length, stayed: location.href === before };
    }));
    expect(seen).not.toBeNull();
    expect(seen!.stayed).toBe(true);
    expect(seen!.chars).toBeGreaterThan(400);
  }, 120_000);

  it('offers both answers, and both reach the one persisted decision', async () => {
    const forms = await onThePhone(390, async (page) => page.evaluate(() =>
      [...document.querySelectorAll('#the-one-thing form')].map((f) => ({
        action: f.getAttribute('action') ?? '',
        label: f.querySelector('button')?.textContent?.trim() ?? '',
      })).filter((f) => f.action.includes('/acquisitions/'))));
    expect(forms.map((f) => f.label)).toEqual(['Allow the isolated workshop', 'Not yet']);
    // ONE INSTITUTIONAL OBJECT, NOT A MOBILE COPY WITH ITS OWN WRITE PATH.
    expect(new Set(forms.map((f) => f.action)).size).toBe(1);

    const rows = (await query(
      `SELECT id FROM capability_acquisitions
        WHERE founder_id = ? AND capability_key = 'run_in_workspace'`, [OWNER]))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(forms[0]!.action).toContain(String(rows[0]!.id));
  }, 120_000);

  it('states the recurring commitment and the ceilings as separate facts', async () => {
    const text = await onThePhone(390, async (page) => page.evaluate(() =>
      document.querySelector('#the-one-thing')!.textContent ?? ''));
    // The subscription is not hidden behind the small reassuring number.
    expect(text).toContain('$20.00, every month');
    expect(text).toContain('$0.25');
    expect(text).toContain('$5.00 a month');
    expect(text).toContain('not saying yes to unlimited computing');
    // And no screen asks him for the key.
    expect(text).not.toContain('SPRITES_TOKEN');
    expect(text).not.toContain('api.sprites.dev');
  }, 120_000);

  it('does not let a notice that needs nothing stand in front of one that needs him',
    async () => {
      // The stopped card says, in its own words, "nothing needs you". It came
      // first unconditionally, so the one thing on his screen was a notice
      // asking nothing of him while a decision that could not proceed without
      // him waited behind it.
      const seen = await onThePhone(390, async (page) => page.evaluate(() => ({
        one: document.querySelector('#the-one-thing')?.textContent ?? '',
        page: document.body.innerText,
      })));
      expect(seen.one).toContain('Foundry needs an isolated workshop');
      expect(seen.one).not.toContain('Part of me has stopped running');
      // AND THE STOPPED ROUTINE IS STILL SAID. Demoting it must not delete it:
      // what he is told elsewhere may genuinely be out of date.
      expect(seen.page).toContain('has stopped');
    }, 120_000);

  it('survives the text being doubled', async () => {
    const seen = await onThePhone(390, async (page) => {
      await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
      await page.waitForTimeout(200);
      return page.evaluate(() => {
        const de = document.documentElement;
        return {
          overflowX: de.scrollWidth - de.clientWidth,
          stillThere: document.body.innerText.includes('Foundry needs an isolated workshop'),
        };
      });
    });
    expect(seen.overflowX).toBe(0);
    expect(seen.stillThere).toBe(true);
  }, 120_000);
});
