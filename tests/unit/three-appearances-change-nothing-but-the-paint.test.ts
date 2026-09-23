// =============================================================================
// THREE APPEARANCES, AND NOT ONE OF THEM CHANGES WHAT FOUNDRY MAY DO.
//
// The owner's Eventide directive: "Implement three first-class appearance
// modes… All three modes must use one shared component system, information
// architecture, and functional implementation. Do not build three separate
// applications… Changing appearance must never alter actual application
// behavior, authority, financial state, or connected-service functionality."
//
// The last sentence is the one worth a test, because it is the one a theme
// system breaks quietly. A mode that hides a control, drops a status, or
// renders a different sentence about what is authorised has stopped being a
// palette and become a second application — and nobody would notice from a
// screenshot, because each screen looks right on its own.
//
// So the pages are rendered in all three and compared as TEXT. Identical
// words, identical order, in a document whose ground is demonstrably
// different.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'e'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'paint@example.com';

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { APPEARANCES, CHROME, isAppearance, withAppearance } from '../../src/views/owner/appearance.js';

const F = 'f_paint', P = 'p_paint';
let app: Hono;
const CSS = readFileSync('src/public/owner.css', 'utf8');

/** One page, rendered in one mode, exactly as the shell renders it. */
const render = async (path: string, mode: 'light' | 'green' | 'dark' | null): Promise<string> =>
  withAppearance(mode, async () => {
    const res = await app.request(path);
    expect(res.status, `${path} in ${String(mode)}`).toBe(200);
    return res.text();
  });

/**
 * The words, with every tag and attribute removed — the meaning, not the paint.
 *
 * ONE SENTENCE IS ALLOWED TO DIFFER, and it is the one that reports which
 * mode he is in. The Appearance card says "Set to green, on every device you
 * open Foundry on", which is a true statement about the setting rather than a
 * difference in what the application does — and a comparison that refused it
 * would be asserting the page must not be able to tell him what he chose.
 * Everything else, including every number, permission and connection
 * sentence, must be identical.
 */
const words = (html: string): string =>
  html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    .replace(/Set to (light|green|dark), on every device/, 'Set to THE MODE, on every device')
    .trim();

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [F, 'c_paint', 'paint@example.com']);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
    [P, 'Apex Micro', F, 'active']);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder', { id: F, email: 'paint@example.com' }); await next();
  });
  app.route('/', foundryShellRoutes);
});

describe('the three are the three, everywhere', () => {
  it('names the same modes the stylesheet declares', async () => {
    // A fourth value would render as NO palette: the attribute present, the
    // selector matching nothing, the page falling through to green while the
    // record said otherwise.
    for (const mode of APPEARANCES) {
      const declared = mode === 'green'
        ? /:root\{/.test(CSS)
        : new RegExp(`:root\\[data-theme="${mode}"\\]\\{`).test(CSS);
      expect(declared, `${mode} has a palette`).toBe(true);
    }
    expect([...APPEARANCES].sort()).toEqual(['dark', 'green', 'light']);
  });

  it('refuses a mode the stylesheet does not have', async () => {
    await expect(query('UPDATE founders SET appearance = ? WHERE id = ?', ['sepia', F]))
      .rejects.toThrow(/not_a_mode/);
  });

  it('takes each of the three, and takes null back', async () => {
    for (const mode of APPEARANCES) {
      await query('UPDATE founders SET appearance = ? WHERE id = ?', [mode, F]);
      expect((await query('SELECT appearance FROM founders WHERE id = ?', [F])).rows[0])
        .toMatchObject({ appearance: mode });
    }
    // 'system' is the ABSENCE of a choice, stored as one. Recording it as a
    // fourth value would make an owner who never expressed a preference look
    // like he had.
    await query('UPDATE founders SET appearance = NULL WHERE id = ?', [F]);
    expect((await query('SELECT appearance FROM founders WHERE id = ?', [F])).rows[0])
      .toMatchObject({ appearance: null });
  });

  it('holds its chrome colour from the stylesheet, never from a literal', async () => {
    // These are the only colours in TypeScript on the owner surface, because
    // `<meta name="theme-color">` cannot take a custom property. Extracted, so
    // a palette change carries them and they cannot drift.
    for (const mode of APPEARANCES) {
      expect(CHROME[mode], `${mode} has a ground`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(CSS, `${mode}'s ground comes from the stylesheet`).toContain(String(CHROME[mode]));
    }
    expect(new Set(Object.values(CHROME)).size, 'three grounds, three colours').toBe(3);
  });

  it('is not something a caller can invent', async () => {
    expect(isAppearance('green')).toBe(true);
    expect(isAppearance('SEPIA')).toBe(false);
    expect(isAppearance(null)).toBe(false);
  });
});

describe('the paint changes and the application does not', () => {
  const PAGES = ['/foundry/controls', '/foundry/controls/connectors', '/foundry/controls/connectors/etsy'];

  it('says exactly the same things in all three modes', async () => {
    for (const path of PAGES) {
      // SEQUENTIALLY, because three concurrent renders share one in-memory
      // database and a lock contention here would read as a theme defect.
      const light = await render(path, 'light');
      const green = await render(path, 'green');
      const dark = await render(path, 'dark');
      expect(words(green), `${path}: green and light disagree`).toBe(words(light));
      expect(words(dark), `${path}: dark and light disagree`).toBe(words(light));
    }
  });

  it('paints them differently, which is the only difference', async () => {
    const light = await render('/foundry/controls', 'light');
    const green = await render('/foundry/controls', 'green');
    expect(light).toContain('data-theme="light"');
    expect(green).toContain('data-theme="green"');
    expect(light).not.toBe(green);
  });

  it('asserts nothing when he has never chosen', async () => {
    // No attribute at all, so the stylesheet's own `prefers-color-scheme`
    // block answers. Rendering a default here would be us expressing a
    // preference on his behalf.
    const unset = await render('/foundry/controls', null);
    expect(unset).not.toContain('data-theme=');
    expect(unset).toContain('prefers-color-scheme: dark');
  });

  it('offers the choice where the other controls are, and says it changes nothing', async () => {
    const html = await render('/foundry/controls', 'green');
    expect(html).toContain('Appearance');
    expect(html).toContain('/foundry/controls/appearance');
    expect(html.replace(/\s+/g, ' ')).toContain('changes nothing about what');
  });

  it('records the choice against him rather than against the device', async () => {
    // "The selected appearance must persist… across mobile and desktop." A
    // cookie persists on the phone that made the choice and nowhere else.
    const res = await withAppearance(null, async () => app.request(
      '/foundry/controls/appearance',
      { method: 'POST', body: new URLSearchParams({ mode: 'dark' }) }));
    expect(res.status).toBe(302);
    expect((await query('SELECT appearance FROM founders WHERE id = ?', [F])).rows[0])
      .toMatchObject({ appearance: 'dark' });
    const back = await withAppearance(null, async () => app.request(
      '/foundry/controls/appearance',
      { method: 'POST', body: new URLSearchParams({ mode: 'system' }) }));
    expect(back.status).toBe(302);
    expect((await query('SELECT appearance FROM founders WHERE id = ?', [F])).rows[0])
      .toMatchObject({ appearance: null });
  });

  it('will not store a mode somebody posted that does not exist', async () => {
    await query('UPDATE founders SET appearance = ? WHERE id = ?', ['green', F]);
    const res = await withAppearance(null, async () => app.request(
      '/foundry/controls/appearance',
      { method: 'POST', body: new URLSearchParams({ mode: 'sepia' }) }));
    expect(res.status).toBe(302);
    expect((await query('SELECT appearance FROM founders WHERE id = ?', [F])).rows[0])
      .toMatchObject({ appearance: 'green' });
  });
});
