// =============================================================================
// FOUNDRY — the one stylesheet, addressed by what it contains.
//
// `/static/owner.css` is served with an hour of cache, which is right for a
// file a browser fetches on every screen — and wrong on the hour after a
// deploy, when the owner opens the product on his phone and meets the old
// stylesheet under the new markup. Telling him to refresh is not a strategy.
//
// So the address carries a fingerprint of the bytes: the link changes when the
// stylesheet changes and never otherwise, the browser fetches exactly once per
// version, and the static route keeps serving the same file because the query
// string is not part of the file name it resolves. Computed once at load from
// the file that will actually be served, so the link and the bytes cannot
// drift apart; there is no second place to remember to bump.
// =============================================================================

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function fingerprint(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // The same two roots the static route reads from: `public/` beside `lib/`
  // when running from source or from `dist/`, and `src/public` from `dist/`.
  for (const candidate of [resolve(here, '../public/owner.css'), resolve(here, '../../src/public/owner.css')]) {
    try {
      return createHash('sha256').update(readFileSync(candidate)).digest('hex').slice(0, 12);
    } catch { /* try the next root */ }
  }
  // Unreadable at load means the link is unversioned rather than broken: the
  // stylesheet still loads, and the cache keeps its hour.
  return '';
}

const VERSION = fingerprint();

/** The address every owner page links the stylesheet at. */
export const OWNER_STYLESHEET = VERSION ? `/static/owner.css?v=${VERSION}` : '/static/owner.css';
