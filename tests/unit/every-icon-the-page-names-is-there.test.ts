// =============================================================================
// EVERY ICON THE OWNER'S PAGE NAMES IS THERE (remediation 1.6, 6 October 2026).
//
// Home logged a console 404 on the owner's first visit from a phone. The walk
// could not say which resource: it was `/favicon.ico`, which a browser asks for
// on its own when a page declares no icon — and the owner's shell declared an
// apple-touch icon and no other, while nothing serves `/favicon.ico`. The shell
// now names the icon it has. This holds every icon and manifest link in the
// shell to a file that exists, and holds that one icon is declared at all.
//
// DECLARING IT WAS NOT ENOUGH. The next full walk still logged a browser-level
// 404 for `/favicon.ico` on 64 pages: Chromium asks for it whatever the page
// names. So the address answers too, from the handler production and the
// laboratory both mount.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { html } from 'hono/html';

describe('the owner shell\'s head', () => {
  it('declares an icon', async () => {
    const { page } = await import('../../src/views/owner/shell.js');
    const out = String(await page('Home', html`<p>x</p>`));
    expect(out).toMatch(/<link rel="icon" type="image\/png" href="\/static\/icon-192\.png" \/>/);
  });

  it('every icon and manifest it names is a file the application serves', async () => {
    const { page } = await import('../../src/views/owner/shell.js');
    const out = String(await page('Home', html`<p>x</p>`));
    const hrefs = [...out.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="([^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThanOrEqual(3);
    for (const h of hrefs) {
      const file = h.startsWith('/static/') ? resolve('src/public', h.slice('/static/'.length)) : resolve('src/public', h.slice(1));
      expect(existsSync(file), h).toBe(true);
    }
  });
});

describe('the address a browser asks for on its own', () => {
  it('/favicon.ico answers with the icon, in the app the walk serves', async () => {
    const { ownerApp } = await import('../helpers/world.js');
    const res = await (await ownerApp()).request('/favicon.ico');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
  it('and production mounts the same handler', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(resolve('src/index.ts'), 'utf8')).toMatch(/app\.get\('\/favicon\.ico', pwa\.favicon\)/);
  });
});
