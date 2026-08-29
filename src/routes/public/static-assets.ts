// =============================================================================
// FOUNDRY — Static assets
//
// Lifted out of `src/index.ts` because it could not be tested where it was:
// importing that module starts an HTTP listener at module scope, so no test has
// ever imported it, and this route served corrupted bytes for as long as it has
// existed without anything noticing.
//
// BYTES, NOT TEXT. It read `utf-8` and served the decoded string, so every byte
// a PNG contains that is not valid UTF-8 came out as the replacement character:
// the signature `89 50 4e 47` was served as `ef bf bd 50`, and a 930-byte icon
// went out as 1478 bytes. No browser can decode that, so both manifest icons
// were undecodable and the app could not be installed — while `manifest.json`,
// the service worker and the meta tags were all correct, which is why it looked
// complete. Every part a reader would check was right; the one part only a
// browser checks was destroyed in transit.
//
// Text is unharmed by being served as bytes; binary is destroyed by being
// served as text. The safe direction is bytes for everything, with the
// Content-Type saying how to read them.
// =============================================================================

import type { Context } from 'hono';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIME_TYPES: Record<string, string> = {
  css: 'text/css',
  js: 'application/javascript',
  svg: 'image/svg+xml',
  json: 'application/json',
  png: 'image/png',
};

/**
 * The file's bytes, or null if there is no such asset.
 *
 * Two roots because the build lays them out differently: `src/public` when
 * running from source, `../src/public` when running from `dist/`.
 */
export function readStaticAsset(dirname: string, fileName: string): Uint8Array<ArrayBuffer> | null {
  // A name, never a path. Anything with a separator or a traversal segment is
  // not a file this serves.
  if (!/^[\w.-]+$/.test(fileName)) return null;
  for (const candidate of [resolve(dirname, 'public', fileName), resolve(dirname, '../src/public', fileName)]) {
    try {
      // Copied onto a plain ArrayBuffer rather than wrapping Node's pooled
      // one: a Buffer is a view into a shared allocation, and handing that
      // straight to the response would expose whatever else the pool holds.
      const file = readFileSync(candidate);
      const bytes = new Uint8Array(new ArrayBuffer(file.byteLength));
      bytes.set(file);
      return bytes;
    } catch { /* try the next root */ }
  }
  return null;
}

export function contentTypeFor(fileName: string): string {
  return MIME_TYPES[fileName.split('.').pop() ?? ''] ?? 'text/plain';
}

/**
 * The handler for `/static/:file`, registered by `src/index.ts` on the door it
 * already had.
 *
 * A HANDLER RATHER THAN A MOUNTED SUB-APP, because the Attention Law says the
 * number of top-level route mounts may only shrink: this is the same door moved
 * for testability, not a new surface, and it must not cost the company one.
 */
export function staticAssetHandler(dirname: string): (c: Context) => Response | Promise<Response> {
  return (c) => {
    const fileName = c.req.param('file') ?? '';
    const bytes = readStaticAsset(dirname, fileName);
    if (!bytes) return c.notFound();
    return c.body(bytes, 200, {
      'Content-Type': contentTypeFor(fileName),
      'Cache-Control': 'public, max-age=3600',
    });
  };
}
