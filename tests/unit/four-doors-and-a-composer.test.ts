process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { ADDRESSES, LABELS } from '../../src/views/owner/labels.js';
import { DOORS, DOOR_OF, EVERYWHERE_ELSE } from '../../src/views/owner/shell.js';
import { withViewer } from '../../src/views/owner/viewer.js';

// =============================================================================
// FOUR DOORS, A COUNT AND A COMPOSER (long-horizon directive, 30 September
// 2026; INSTITUTION_MODEL §8).
//
// Home, Portfolio, Explore, Control — the same four on a phone and on a desk,
// meant to stay put for years. Every other place is a depth that lights the
// door it stands under and is listed once, under "Everywhere else". Needs you
// is not a door but a count in every page's header. The composer is on every
// page and takes no door. No script decides any of this; a script that fails
// to run leaves exactly the bar the stylesheet drew.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const OWNER = 'doors_owner';
let app: Hono;
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const script = read('src/lib/owner-surface-script.ts');
const css = read('src/public/owner.css');
const phoneCss = css.slice(css.indexOf('@media (max-width:899px){\n  .wrap{padding:13px'), css.indexOf('/* Desktop: dense private-institution cockpit'));

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_doors', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status) VALUES ('doors_p','Private Foundry',?,'active','active')`, [OWNER]);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await withViewer(OWNER, next); });
  app.route('/', letterRoutes);
  // Account and Your data are depths under Control that the Letter's router
  // does not carry; production mounts them beside it.
  app.route('/', (await import('../../src/routes/dashboard/settings.js')).settingsRoutes);
  app.route('/', (await import('../../src/routes/dashboard/privacy.js')).privacySettings);
});

const page = async (path: string): Promise<string> => { const r = await app.request(path); expect(r.status, path).toBe(200); return r.text(); };
/** The bar's door row: the rail's company and "Everywhere else" sections sit after it and are not doors. */
const bar = (html: string): string => (/<nav class="places[^"]*" aria-label="Places">[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '')
  .split(/<section class="(?:sub|more)"/)[0]!.replace(/<header class="rail-brand">[\s\S]*?<\/header>/, '');
const anchors = (html: string): Array<{ href: string; cls: string; label: string }> => [...bar(html).matchAll(/<a ([^>]*)>(?:<svg[\s\S]*?<\/svg>)?([^<]*)/g)]
  .map((m) => ({ href: /href="([^"]+)"/.exec(m[1]!)?.[1] ?? '', cls: /class="([^"]*)"/.exec(m[1]!)?.[1] ?? '', label: m[2]!.trim() }));
const doors = (html: string): string[] => anchors(html).map((a) => a.href);
const lit = (html: string): string[] => anchors(html).filter((a) => a.cls.split(' ').includes('on')).map((a) => a.label);

describe('the structure', () => {
  it('is four doors, in the directive\'s order and words', () => {
    expect(DOORS.map((d) => LABELS[d])).toEqual(['Home', 'Portfolio', 'Explore', 'Control']);
    expect(DOORS.map((d) => ADDRESSES[d])).toEqual(['/foundry', '/foundry/companies', '/foundry/explore', '/foundry/controls']);
  });

  it('puts every other place under exactly one door, and Needs you and the Letter under none', () => {
    for (const [place, door] of Object.entries(DOOR_OF)) {
      if (place === 'advanced' || place === 'decisions') expect(door, place).toBeNull();
      else expect(DOORS, place).toContain(door);
    }
  });

  it('no script assembles the bar; the phone draws four columns; the More sheet is gone', () => {
    expect(script).not.toMatch(/grid-template-columns|columns=|matchMedia/);
    expect(phoneCss).toContain('nav.places div{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))');
    expect(css).not.toMatch(/nav\.places div\{[^}]*repeat\((5|9),/);
    expect(css).not.toContain('.sheet-more');
    expect(css).not.toContain('.ask-fab');
    expect(phoneCss).toMatch(/nav\.places a\{[^}]*white-space:nowrap;overflow:hidden/);
    expect(phoneCss).toMatch(/nav\.places a\{[^}]*min-height:52px/);
    expect(css).not.toMatch(/nav\.places[^{]*:nth-(child|of-type)/);
  });

  it('docks the composer above the bar on a phone instead of hiding it behind a button', () => {
    expect(phoneCss).toMatch(/\.ask\{display:block;position:fixed/);
    expect(phoneCss).not.toContain('.ask:target');
  });
});

describe('the rendered bar', () => {
  it('shows the same four doors on every page, and lights exactly the one underfoot', async () => {
    for (const [path, door] of [
      ['/foundry', 'Home'], ['/foundry/companies', 'Portfolio'], ['/foundry/explore', 'Explore'], ['/foundry/controls', 'Control'],
      ['/foundry/missions', 'Explore'], ['/foundry/experiments', 'Explore'], ['/foundry/searching', 'Explore'],
      ['/foundry/inbox', 'Portfolio'], ['/foundry/money', 'Portfolio'], ['/foundry/activity', 'Home'], ['/foundry/charter', 'Control'],
    ] as const) {
      const html = await page(path);
      expect(doors(html), path).toEqual(['/foundry', '/foundry/companies', '/foundry/explore', '/foundry/controls']);
      expect(lit(html), path).toEqual([door]);
    }
  });

  it('lights nothing on the Letter or on Needs you, which are beneath every door', async () => {
    expect(lit(await page('/letter'))).toEqual([]);
    expect(lit(await page('/foundry/needs-you'))).toEqual([]);
  });

  it('puts the composer on every page, as a form that posts to the one door for sentences', async () => {
    for (const path of ['/foundry', '/foundry/companies', '/foundry/explore', '/foundry/needs-you', '/foundry/controls']) {
      expect(await page(path), path).toMatch(/<form class="ask" id="ask-foundry" method="POST" action="\/foundry\/ask">/);
    }
  });

  it('lists every other place once, on Control and in the rail, and each one answers', async () => {
    const control = await page('/foundry/controls');
    const grid = /<nav class="elsewhere"[\s\S]*?<\/nav>/.exec(control)?.[0] ?? '';
    const hrefs = [...grid.matchAll(/<a href="(\/[^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs).toEqual(EVERYWHERE_ELSE.map((e) => e.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect((await app.request(href)).status, href).toBe(200);
    const rail = /<section class="more" aria-label="Everywhere else">[\s\S]*?<\/section>/.exec(control)?.[0] ?? '';
    expect([...rail.matchAll(/<a href="(\/[^"]+)"/g)].map((m) => m[1])).toEqual(hrefs);
  });

  it('carries Needs you as a count in the header of every page, on a phone and on a desk', async () => {
    for (const path of ['/foundry', '/foundry/companies', '/foundry/explore', '/foundry/controls', '/foundry/charter', '/letter']) {
      const html = await page(path);
      const pills = [...html.matchAll(/<a class="needs[^"]*" href="([^"]+)"[^>]*>/g)];
      expect(pills.map((m) => m[1]), path).toEqual(['/foundry/needs-you', '/foundry/needs-you']);
      expect(html, path).toContain('aria-label="Nothing needs you"');
    }
  });

  it('sends the old Decisions address to Needs you, permanently, keeping its query', async () => {
    const r = await app.request('/foundry/decisions?company=doors_p');
    expect(r.status).toBe(308);
    expect(r.headers.get('location')).toBe('/foundry/needs-you?company=doors_p');
  });
});
