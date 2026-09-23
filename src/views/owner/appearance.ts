// =============================================================================
// WHICH OF THE THREE THIS PAGE IS PAINTED IN.
//
// The shell renders `data-theme` on <html> so the first paint is already the
// owner's mode. Doing it in script after load is a flash of the wrong palette
// on every navigation, which on a phone at night is the difference between an
// application and a website.
//
// WHY A REQUEST STORE RATHER THAN AN ARGUMENT. `page()` is called from several
// hundred sites across the owner surface; threading an appearance through all
// of them to paint a background would be the most expensive possible way to
// carry one string. `AsyncLocalStorage` is the platform's own answer to
// exactly this — a value scoped to one request, invisible to everything that
// does not ask — and it carries nothing else, so it cannot become a second
// place application state lives.
// =============================================================================

import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The three the stylesheet actually declares, and the trigger actually admits. */
export const APPEARANCES = ['light', 'green', 'dark'] as const;
export type Appearance = typeof APPEARANCES[number];

export const isAppearance = (v: unknown): v is Appearance =>
  typeof v === 'string' && (APPEARANCES as readonly string[]).includes(v);

const store = new AsyncLocalStorage<Appearance | null>();

/** Run one request with the owner's chosen mode in scope. */
export const withAppearance = <T>(chosen: Appearance | null, fn: () => T): T =>
  store.run(chosen, fn);

/**
 * The mode to paint, or null when he has never said.
 *
 * NULL IS NOT A DEFAULT. It renders no `data-theme` at all, which is what lets
 * the stylesheet's `prefers-color-scheme` block choose between light and the
 * signature green — so an owner who has expressed nothing gets the device's
 * own answer rather than an assertion from us.
 */
export const currentAppearance = (): Appearance | null => store.getStore() ?? null;

/**
 * THE BROWSER CHROME COLOUR FOR EACH MODE, READ FROM THE STYLESHEET ITSELF.
 *
 * `<meta name="theme-color">` cannot take a custom property — the browser
 * wants a literal — so this is the one place in the owner surface that holds
 * colours in TypeScript. Writing them out by hand would put three hexes beside
 * a palette they must match and nothing keeping them in step; the first time
 * `--bg` moved, the phone's status bar would sit a shade off the app it frames
 * and no test would notice.
 *
 * So they are EXTRACTED, from the same file the page links. Each mode's `--bg`
 * is its ground by definition, so there is one source and it is the one that
 * paints the screen.
 */
function grounds(): Record<Appearance, string | null> {
  const here = dirname(fileURLToPath(import.meta.url));
  let css = '';
  for (const candidate of [
    resolve(here, '../../public/owner.css'),
    resolve(here, '../../../src/public/owner.css'),
  ]) {
    try { css = readFileSync(candidate, 'utf8'); break; } catch { /* next root */ }
  }
  const bg = (block: string): string | null =>
    /--bg:\s*(#[0-9A-Fa-f]{6})/.exec(block)?.[1] ?? null;
  const of = (re: RegExp): string | null => {
    const m = re.exec(css);
    return m?.[1] ? bg(m[1]) : null;
  };
  // NO FALLBACK COLOUR, and that is the point. A literal here would be a
  // second palette in a file whose whole job is to avoid one — and the first
  // time `--bg` moved, this is the copy that would quietly stay behind. Null
  // means the ground could not be read, and the shell then renders no
  // `theme-color` at all: the phone tints its own bars, which is a blemish,
  // where an invented colour would be a lie about what the app looks like.
  return {
    green: of(/:root\{([\s\S]*?)\n\}/),
    light: of(/:root\[data-theme="light"\]\{([\s\S]*?)\n\}/),
    dark: of(/:root\[data-theme="dark"\]\{([\s\S]*?)\n\}/),
  };
}

export const CHROME: Record<Appearance, string | null> = grounds();
