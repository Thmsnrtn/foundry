// =============================================================================
// THE THREE JOURNEYS THE PLAN NAMES, ON THE PHONE HE HOLDS.
//
// Integrated plan §8: "Prove three real authenticated mobile journeys …: a
// quiet return after a week; a stale Etsy read with a known buyer remedy; and a
// new direction followed by a binding Controls change." And: "A shorter page
// that yields a wrong answer fails."
//
// Each is read through the owner's real routes. The first two are read in a
// 390px browser, from the first viewport, because what he sees before he
// scrolls is the product. The third is the sentence-to-rule path he walks:
// say it, see what it would bind, confirm, and read back the rule now in force
// — and a direction on its own binds no money.
//
// What is NOT proved here: his own authenticated session on his own phone.
// That is his, and the maturity map says so.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '4'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

vi.setConfig({ testTimeout: 180_000 });
const CHROMIUM = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) => existsSync(p));
const QUIET = 'tj_quiet';
const STALE = 'tj_stale';
const STEER = 'tj_steer';
let who = QUIET;
let port = 0;
let stop: (() => void) | null = null;
let app: Hono;

async function founder(id: string): Promise<void> {
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [id, `clerk_${id}`, `${id}@example.com`, 'Owner']);
}

beforeAll(async () => {
  await runMigrations();
  for (const id of [QUIET, STALE, STEER]) await founder(id);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c: any, next) => {
    // One owner per journey; the institution's owner is whoever this journey is.
    process.env.FOUNDRY_OWNER_EMAIL = `${who}@example.com`;
    const f = (await query('SELECT * FROM founders WHERE id = ?', [who])).rows[0];
    c.set('founder', f); c.set('userId', who); c.set('csrfToken', 't'); await next();
  });
  app.route('/', foundryShellRoutes);
  const { staticAssetHandler } = await import('../../src/routes/public/static-assets.js');
  app.get('/static/:file', staticAssetHandler(resolve('src')));
  if (CHROMIUM) {
    const server = serve({ fetch: app.fetch, port: 0 });
    port = (server.address() as { port: number }).port;
    stop = () => { server.close(); };
  }
}, 180_000);
afterAll(() => { if (stop) stop(); });

interface Seen { text: string; firstScreen: string; overflowX: number }
async function onThePhone(path: string): Promise<Seen> {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM as string, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${String(port)}${path}`, { waitUntil: 'networkidle' });
    return await page.evaluate(() => {
      const H = innerHeight;
      const firstScreen = [...document.querySelectorAll('h1,h2,h3,p,a,button,span,dt,dd,li')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.top < H && r.height > 0 && e.children.length === 0; })
        .map((e) => e.textContent?.replace(/\s+/g, ' ').trim() ?? '').filter(Boolean).join(' | ');
      const de = document.documentElement;
      return { text: document.body.innerText, firstScreen, overflowX: de.scrollWidth - de.clientWidth };
    });
  } finally { await browser.close(); }
}

const phones = CHROMIUM ? describe : describe.skip;

phones('1. a quiet return after a week', () => {
  it('is quiet: nothing is asked of him, nothing claims more than it knows, and it fits the phone', async () => {
    who = QUIET;
    await query(`INSERT INTO products (id, name, owner_id, status, reality) VALUES ('tj_q_co','Apex Micro',?,'active','real')`, [QUIET]);
    await query(`INSERT INTO owner_visits (founder_id, looked_at, since) VALUES (?, datetime('now','-7 days'), datetime('now','-7 days'))
      ON CONFLICT(founder_id) DO UPDATE SET looked_at = excluded.looked_at, since = excluded.since`, [QUIET]).catch(() => undefined);
    const seen = await onThePhone('/foundry');
    expect(seen.overflowX, 'Home scrolls sideways on a phone').toBe(0);
    expect(seen.firstScreen).not.toMatch(/One thing needs you|things need you/);
    // Quiet is not the same as calm-by-assertion: with nothing observing, the
    // first screen may not call the estate healthy and watched.
    expect(seen.text).not.toMatch(/\d+ compan(y|ies) watched/);
    expect(seen.text).toMatch(/nothing connected can see your company/);
  });
});

phones('2. a stale Etsy read with a known buyer remedy', () => {
  it('leads with the buyer, says the shop cannot be read, and never says Healthy', async () => {
    who = STALE;
    const { approveListing, recordListing, recordVenueOrder, requestVenueRefund, seedProof2 } = await import('../../src/services/venture/proof-2.js');
    const X = (await seedProof2(STALE)).experimentId;
    await approveListing({ founderId: STALE, experimentId: X });
    const P = String(((await query('SELECT id FROM products WHERE from_experiment_id = ?', [X])).rows[0] as Record<string, unknown>).id);
    await recordListing({ founderId: STALE, experimentId: X, url: 'https://www.etsy.com/listing/1234567890/w' });
    await recordVenueOrder({ founderId: STALE, experimentId: X,
      order: { orderRef: '5000000001', paidAt: new Date().toISOString(), grossCents: 1400, feeCents: 158 } });
    await requestVenueRefund({ founderId: STALE, experimentId: X, orderRef: '5000000001' });
    await query(`INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure, last_error, last_observed_at)
      VALUES (?,?,'revenue','etsy','real','read-only','Etsy could not be read: Etsy answered 503', datetime('now','-3 days'))`, [nanoid(), P]);

    const seen = await onThePhone('/foundry');
    expect(seen.overflowX).toBe(0);
    // What is owed, first, and who must act.
    expect(seen.firstScreen).toMatch(/One thing needs you/);
    expect(seen.text).toMatch(/Refund it yourself on Etsy, against order 5000000001/);
    // What cannot be seen, said — not "Healthy".
    expect(seen.text).not.toMatch(/Health\s*\|?\s*Healthy/);
    expect(seen.text).toMatch(/Etsy could not be read since/);
    expect(seen.text).toMatch(/check its orders and messages on Etsy yourself/);
  });
});

describe('3. a new direction, then a binding Controls change', () => {
  const said = (path: string, fields: Record<string, string>) => app.request(`https://f.test${path}`, {
    method: 'POST', body: new URLSearchParams(fields), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

  it('a direction is shown before it binds, binds on confirm, and binds no money', async () => {
    who = STEER;
    await query(`INSERT INTO products (id, name, owner_id, status, reality) VALUES ('tj_s_co','Apex Micro',?,'active','real')`, [STEER]);
    const preview = await (await said('/foundry/companies/tj_s_co/said', { said: 'focus on small contractors who track bids by hand' })).text();
    const { objectiveFor } = await import('../../src/services/institution/standing-intent.js');
    expect(await objectiveFor('tj_s_co'), 'a preview bound something').toBeNull();
    expect(preview).toMatch(/said\/confirm/);
    const bound = await said('/foundry/companies/tj_s_co/said/confirm', { said: 'focus on small contractors who track bids by hand', as: 'objective' });
    expect(bound.headers.get('location')).toMatch(/done=steered/);
    expect((await objectiveFor('tj_s_co'))?.statement).toBe('focus on small contractors who track bids by hand');
    const money = (await query('SELECT COUNT(*) AS n FROM owner_allowances WHERE product_id = ?', ['tj_s_co'])).rows[0] as Record<string, unknown>;
    expect(Number(money.n), 'a direction granted money').toBe(0);
  });

  it('a spending limit binds on confirm and reads back as the rule now in force', async () => {
    const r = await said('/foundry/companies/tj_s_co/said/confirm', { said: 'you can spend up to $30 on this' });
    expect(r.headers.get('location')).toMatch(/done=allowed/);
    const live = (await query('SELECT amount_cents FROM owner_allowances WHERE product_id = ? AND withdrawn_at IS NULL', ['tj_s_co']))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(live.map((x) => Number(x.amount_cents))).toEqual([3000]);
    const page = (await (await app.request('https://f.test/foundry/companies/tj_s_co?done=allowed')).text()).replace(/<[^>]+>/g, ' ');
    expect(page).toMatch(/Up to \$30/);
    // And the direction he set first is still the direction.
    const { objectiveFor } = await import('../../src/services/institution/standing-intent.js');
    expect((await objectiveFor('tj_s_co'))?.statement).toBe('focus on small contractors who track bids by hand');
  });
});
