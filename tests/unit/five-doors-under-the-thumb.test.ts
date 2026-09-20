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
import { ADDRESSES } from '../../src/views/owner/labels.js';

// =============================================================================
// FIVE DOORS UNDER THE THUMB.
//
// The phone bar rendered nine doors at half a rem, and the owner's screenshots
// showed the labels colliding. Now the bar is five doors in markup — Home,
// Portfolio, Experiments, Inbox, More — styled by the stylesheet alone, and
// the rest of the places sit in a sheet the More door opens. No script
// decides membership; a script that fails to run leaves exactly the bar the
// stylesheet drew. The geometry is proven in a browser beside this file; this
// holds the structure without one.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const OWNER = 'doors_owner';
let app: Hono;
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const shell = read('src/views/owner/shell.ts');
const script = read('src/lib/owner-surface-script.ts');
const css = read('src/public/owner.css');
const phoneCss = css.slice(css.indexOf('@media (max-width:899px){'), css.indexOf('/* Desktop: dense private-institution cockpit'));

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_doors', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status) VALUES ('doors_p','Private Foundry',?,'active','active')`, [OWNER]);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

const page = async (path: string): Promise<string> => { const r = await app.request(path); expect(r.status, path).toBe(200); return r.text(); };
/** The bar's door row: the desk rail's "Also here" and company sections sit after it and are not doors. */
const bar = (html: string): string => (/<nav class="places[^"]*" aria-label="Places">[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '').split(/<section class="(?:sub|more)"/)[0]!;
const sheet = (html: string): string => /<section class="sheet-more" id="more"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
/** Every anchor in the bar, as the phone sees it: the desk-only doors are not there. */
const anchors = (html: string): Array<{ href: string; cls: string; label: string }> => [...bar(html).matchAll(/<a ([^>]*)>(?:<svg[\s\S]*?<\/svg>)?([^<]*)/g)]
  .map((m) => ({ href: /href="([^"]+)"/.exec(m[1]!)?.[1] ?? '', cls: /class="([^"]*)"/.exec(m[1]!)?.[1] ?? '', label: m[2]!.trim() }))
  .filter((a) => !a.cls.split(' ').includes('desk'));
const doors = (html: string): string[] => anchors(html).map((a) => a.href);
const lit = (html: string): string[] => anchors(html).filter((a) => a.cls.split(' ').includes('on')).map((a) => a.label);

describe('the structure', () => {
  it('renders four phone doors, five on the rail only, and the More door; the Ask tab is gone', () => {
    // The doors name their PLACE; the place's address and word come from the
    // one vocabulary (views/owner/labels.ts), so this reads the keys and
    // resolves them there rather than re-typing the addresses here.
    const phone = [...shell.matchAll(/\$\{door\(ADDRESSES\.\w+, '([^']+)', LABELS\.\w+, ICONS\.[a-z]+, lit, counts\)\}/g)].map((m) => m[1]);
    const desk = [...shell.matchAll(/\$\{door\(ADDRESSES\.\w+, '([^']+)', LABELS\.\w+, ICONS\.[a-z]+, lit, counts, true\)\}/g)].map((m) => m[1]);
    expect(phone.map((k) => ADDRESSES[k as keyof typeof ADDRESSES])).toEqual(['/foundry', '/foundry/companies', '/foundry/experiments', '/foundry/inbox']);
    expect(desk.map((k) => ADDRESSES[k as keyof typeof ADDRESSES])).toEqual(['/foundry/decisions', '/foundry/searching', '/foundry/activity', '/foundry/money', '/foundry/controls']);
    expect(shell).toContain('class="more-door');
    expect(shell).not.toContain('ask-door');
    expect(shell).toContain('class="ask-fab" href="#ask-foundry"');
  });

  it('no script assembles the bar, and the phone stylesheet draws five columns and never nine', () => {
    expect(script).not.toMatch(/grid-template-columns|columns=|matchMedia/);
    expect(phoneCss).toContain('nav.places div{display:grid;grid-template-columns:repeat(5,minmax(0,1fr))');
    expect(css).not.toContain('repeat(9,');
    // A label that would not fit is clipped, never laid over its neighbour.
    expect(phoneCss).toMatch(/nav\.places a\{[^}]*white-space:nowrap;overflow:hidden/);
    expect(phoneCss).toMatch(/nav\.places a\{[^}]*min-height:52px/);
    // And nothing encodes navigation meaning as DOM position.
    expect(css).not.toMatch(/nav\.places[^{]*:nth-(child|of-type)/);
  });
});

describe('the rendered bar', () => {
  it('shows the same five doors on every page, and lights exactly the one underfoot', async () => {
    for (const path of ['/foundry', '/foundry/experiments', '/foundry/inbox', '/foundry/companies']) {
      const html = await page(path);
      expect(doors(html), path).toEqual(['/foundry', '/foundry/companies', '/foundry/experiments', '/foundry/inbox', '#more']);
      expect(lit(html), path).toHaveLength(1);
    }
    expect(lit(await page('/foundry'))).toEqual(['Home']);
    expect(lit(await page('/foundry/experiments'))).toEqual(['Experiments']);
  });

  it('lights More on a place the sheet holds, and marks that place inside the sheet', async () => {
    for (const [path, label] of [['/foundry/decisions', 'Decisions'], ['/foundry/money', 'Economics'], ['/foundry/controls', 'Controls'], ['/foundry/charter', 'The charter'], ['/foundry/searching', 'Searching']] as const) {
      const html = await page(path);
      expect(lit(html), path).toEqual(['More']);
      const current = [...sheet(html).matchAll(/<a href="([^"]+)" aria-current="page">/g)].map((m) => m[1]);
      expect(current, path).toHaveLength(1);
      expect(sheet(html), path).toContain(`aria-current="page">`);
      expect(sheet(html), path).toMatch(new RegExp(`aria-current="page">(?:<svg[\\s\\S]*?</svg>|<i class="mk"[\\s\\S]*?</i>)${label}`));
    }
    // The charter page marks The charter, not Controls, though it stands under Controls.
    const charter = sheet(await page('/foundry/charter'));
    expect(charter).toContain('<a href="/foundry/charter" aria-current="page">');
    expect(charter).not.toContain('<a href="/foundry/controls" aria-current="page">');
  });

  it('lights nothing on the Letter, which is a depth and not a place; the sheet still says where he is', async () => {
    const html = await page('/letter');
    expect(lit(html)).toEqual([]);
    expect(sheet(html)).toContain('<a href="/letter" aria-current="page">');
  });

  it('holds every secondary place in the sheet, and each one answers', async () => {
    const html = await page('/foundry');
    const hrefs = [...sheet(html).matchAll(/<a href="(\/[^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs).toEqual(['/foundry/decisions', '/foundry/charter', '/foundry/money', '/foundry/activity', '/foundry/controls', '/foundry/searching', '/foundry/public-workshop', '/foundry/roadmap', '/foundry/absence', '/letter']);
    for (const href of hrefs) expect((await app.request(href)).status, href).toBe(200);
    expect(sheet(html)).toContain('<a class="close" href="#_">Close</a>');
    // Home no longer carries a second row of the same places.
    expect(html).not.toContain('class="also"');
  });
});
