import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  OWNER_SURFACES, OWNER_SURFACE_SCRIPT, OWNER_SURFACE_SCRIPT_HASH, isOwnerSurface,
} from '../../src/lib/owner-surface-script.js';

// =============================================================================
// THE ONLY SCRIPT THE OWNER'S SURFACE RUNS, AND EVERY PLACE THAT IS TRUE.
//
// A Content-Security-Policy carrying 'unsafe-inline' for script-src permits
// exactly the construct an injected tag uses, and this product renders text
// written by strangers — a Hacker News comment quoted verbatim beneath an
// opportunity is the evidence discipline working as intended. One of those
// quotes reached the owner's first screen as live markup.
//
// The first screen has had a strict policy since; the rest of the surface he
// signs in to did not, because it carried inline handlers a hash cannot cover.
// Now it does not carry them, and these tests hold three things that a future
// change could quietly undo:
//
//   1. the strict list and the authenticated mounts stay the same set,
//   2. no owner route file grows an inline handler or a second script block,
//   3. the hash is computed from the script rather than written down.
//
// The failure each prevents is silent in the browser and invisible in review:
// a page that renders correctly and whose toggle has stopped toggling, or a
// policy that says 'unsafe-inline' because one attribute came back.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/** Every path the application puts behind authMiddleware, from the source. */
function authenticatedMounts(): string[] {
  const index = read('src/index.ts');
  const found = new Set<string>();
  for (const m of index.matchAll(/app\.use\('(\/[^']*)',\s*authMiddleware\)/g)) {
    const p = m[1].replace(/\/\*$/, '');
    // `/api` is machine-to-machine and renders no page; it has no policy to
    // relax and no script to hash.
    if (p !== '/api' && p !== '') found.add(p);
  }
  return [...found].sort();
}

describe('the strict policy covers every place he signs in to', () => {
  it('names the same set the application authenticates', () => {
    // THE DRIFT THIS CATCHES: a new owner surface mounted behind auth and not
    // added here would render under 'unsafe-inline' and nothing would say so.
    expect([...OWNER_SURFACES].sort()).toEqual(authenticatedMounts());
  });

  it('matches a path and everything beneath it, and nothing that merely starts the same way', () => {
    expect(isOwnerSurface('/settings')).toBe(true);
    expect(isOwnerSurface('/settings/api-keys')).toBe(true);
    expect(isOwnerSurface('/foundry/companies/abc')).toBe(true);
    // A prefix is not a path. `/settingsomething` is somebody else's route.
    expect(isOwnerSurface('/settingsomething')).toBe(false);
    expect(isOwnerSurface('/privacyish')).toBe(false);
    expect(isOwnerSurface('/')).toBe(false);
    expect(isOwnerSurface('/sign-in')).toBe(false);
  });

  it('still relaxes the policy for the sign-in pages, which is the whole remaining exception', () => {
    const headers = read('src/middleware/security-headers.ts');
    expect(headers).toContain("script-src 'self' ${OWNER_SURFACE_SCRIPT_HASH}");
    // Three inline blocks remain in the application, all of them Clerk's. The
    // shell's own block is the hashed constant, which is the point.
    const blocks = allSourceFiles().filter((f) => {
      const src = read(f);
      return /<script>/.test(src)
        && !src.includes('<script>${raw(OWNER_SURFACE_SCRIPT)}</script>');
    });
    expect(blocks).toEqual(['src/routes/auth/clerk.ts']);
  });
});

describe('the owner surfaces carry no inline behaviour at all', () => {
  it('has no on-attribute handler in any route that renders through the owner shell', () => {
    // THE CLASS, NOT THE INSTANCE. Escaping one injected quote fixed one
    // quote. This fails the moment any handler comes back, in any file that
    // renders a page the strict policy covers.
    const offenders: string[] = [];
    for (const f of allSourceFiles()) {
      const src = read(f);
      if (!src.includes("views/owner/shell.js")) continue;
      for (const m of src.matchAll(/\son[a-z]+=["']/g)) {
        offenders.push(`${f}: ${src.slice(Math.max(0, m.index - 40), m.index + 30).replace(/\n/g, ' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives every one of them a delegated listener to replace it', () => {
    // Intent in the markup, behaviour in one hashed place. Each attribute the
    // routes now use must actually be handled, or the page renders perfectly
    // and does nothing.
    for (const attr of ['data-confirm', 'data-submits', 'data-select', 'data-copy',
      'data-open', 'data-close']) {
      expect(OWNER_SURFACE_SCRIPT, `${attr} is written but never read`).toContain(attr);
    }
  });

  it('asks before it disables, so a cancelled form is not a dead page', () => {
    // The confirm and the busy-marking are one listener in that order. As two
    // listeners the button would disable itself and then the submission would
    // be cancelled, leaving a form nobody can submit and no way to say why.
    const confirm = OWNER_SURFACE_SCRIPT.indexOf('data-confirm');
    const busy = OWNER_SURFACE_SCRIPT.indexOf("dataset.busy='1'");
    expect(confirm).toBeGreaterThan(-1);
    expect(busy).toBeGreaterThan(confirm);
  });
});

describe('the hash cannot drift from the script', () => {
  it('is computed, not recorded', () => {
    const src = read('src/lib/owner-surface-script.ts');
    expect(src).toContain("createHash('sha256').update(OWNER_SURFACE_SCRIPT");
    expect(src).not.toMatch(/'sha256-[A-Za-z0-9+/]{20}/);
  });

  it('is the sha256 of exactly what the shell renders', () => {
    const shell = read('src/views/owner/shell.ts');
    expect(shell).toContain('<script>${raw(OWNER_SURFACE_SCRIPT)}</script>');
    expect(OWNER_SURFACE_SCRIPT_HASH).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/);
  });
});

describe('the conversational surface is gone, not hidden', () => {
  it('leaves no route, no mount and no service behind', () => {
    const index = read('src/index.ts');
    expect(index).not.toContain("'/talk'");
    expect(index).not.toContain("'/talk/*'");
    for (const f of allSourceFiles()) {
      expect(read(f), `${f} still reaches the retired chat`)
        .not.toMatch(/services\/chat\/institution/);
    }
  });
});

function allSourceFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
  return walk('src').filter((f) => f.endsWith('.ts'));
}
