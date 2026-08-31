import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { staticAssetHandler } from '../../src/routes/public/static-assets.js';

// =============================================================================
// AN ICON NOBODY COULD DECODE.
//
// The static route read every file as UTF-8 and served the decoded string, so
// every byte a PNG contains that is not valid UTF-8 came out as the replacement
// character. The PNG signature `89 50 4e 47` was served as `ef bf bd 50`, and a
// 930-byte icon went out as 1478 bytes.
//
// So both manifest icons were undecodable and the app could not be installed —
// a paid-tier claim on the pricing page — while `manifest.json`, the service
// worker and the meta tags were all correct. That is why it looked complete:
// every part a reader would check was right, and the one part only a browser
// checks was destroyed in transit.
//
// Text is unharmed by being served as bytes; binary is destroyed by being
// served as text. The safe direction is bytes for everything.
// =============================================================================

const PUBLIC = resolve(__dirname, '../../src/public');

// THE ROUTE, WITHOUT THE SERVER. `src/index.ts` starts an HTTP listener at
// module scope, so importing it in a test binds a port — which is why no test
// has ever imported it, and why this route was never independently exercised.
// It lives in its own module now, mounted the same way production mounts it.
const app = new Hono();
app.get('/static/:file', staticAssetHandler(resolve(__dirname, '../../src')));
const fetchStatic = (name: string): Promise<Response> => app.request(`/static/${name}`);

describe('a static file arrives as the bytes it is', () => {
  it('serves a PNG byte-for-byte, signature intact', async () => {
    const onDisk = readFileSync(resolve(PUBLIC, 'icon-192.png'));
    const served = Buffer.from(await (await fetchStatic('icon-192.png')).arrayBuffer());

    // The signature is the part a browser checks first and the part UTF-8
    // decoding destroys first.
    expect(served.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(served.length).toBe(onDisk.length);
    expect(served.equals(onDisk)).toBe(true);
  });

  it('serves every binary file in public/ unchanged, not only the one that was noticed', async () => {
    const binaries = readdirSync(PUBLIC).filter((f) => /\.(png|jpg|jpeg|gif|woff2?|ico)$/i.test(f));
    expect(binaries.length).toBeGreaterThan(0);
    for (const name of binaries) {
      const onDisk = readFileSync(resolve(PUBLIC, name));
      const served = Buffer.from(await (await fetchStatic(name)).arrayBuffer());
      expect(served.equals(onDisk), `${name} was altered in transit`).toBe(true);
    }
  });

  it('still serves text files correctly, which the old read did too', async () => {
    const res = await fetchStatic('manifest.json');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(JSON.parse(await res.text())).toMatchObject({ icons: expect.any(Array) });
  });

  it('refuses a name that is a path, rather than reading one', async () => {
    // The validation moved with the route, so it stays tested where it lives.
    expect((await fetchStatic('..%2F..%2Fpackage.json')).status).toBe(404);
    expect((await fetchStatic('no-such-file.png')).status).toBe(404);
  });

  it('serves the icons the manifest actually names', async () => {
    // The manifest is correct and always was; what it pointed at was not. A
    // test that checked only the manifest would have passed throughout.
    const manifest = JSON.parse(readFileSync(resolve(PUBLIC, 'manifest.json'), 'utf8')) as
      { icons: Array<{ src: string }> };
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      const name = icon.src.replace('/static/', '');
      const served = Buffer.from(await (await fetchStatic(name)).arrayBuffer());
      expect(served.equals(readFileSync(resolve(PUBLIC, name))), `${icon.src} is not intact`).toBe(true);
    }
  });
});
