import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// EVERY ROUTE THE SOURCE DECLARES, AS THE APP MOUNTS IT.
//
// The two stranger-facing invariants each derived their own list, and both
// scanned `src/routes/` alone — so 27 declarations under `src/api/` sat outside
// a population whose tests were named "every mutating route" and "what a
// stranger can see". That is the machine-facing public API: the most
// security-sensitive surface in the product, and the one both tests claimed to
// cover and did not.
//
// Derived here, once, so the two invariants cannot disagree about what they are
// about, and so a directory added later is a change in one place.
//
// `/api/v1` is mounted from sub-routers whose declarations are relative to
// their mount point, so the prefixes are read from the `apiV1.route(...)` table
// rather than assumed. A sub-router whose prefix cannot be resolved is RETURNED
// as unresolved rather than dropped: a route silently missing from this list is
// the defect this file exists to prevent.
// =============================================================================

const ROOT = resolve(__dirname, '../..');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export type Method = Uppercase<(typeof METHODS)[number]>;
export interface DeclaredRoute { method: Method; path: string; file: string }

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  (function walk(d: string): void {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) out.push(p);
    }
  })(dir);
  return out;
}

/** `probe-value` for any `:param`, because a stranger must be refused before
 *  anything looks the value up. */
const concrete = (p: string): string => p.replace(/:[A-Za-z0-9_]+/g, 'probe-value');

function declarationsIn(file: string, prefix: string): DeclaredRoute[] {
  const src = stripComments(readFileSync(file, 'utf8'));
  const out: DeclaredRoute[] = [];
  for (const method of METHODS) {
    for (const m of src.matchAll(new RegExp(`\\.${method}\\('(/[^']*)'`, 'g'))) {
      const joined = `${prefix}${m[1]}`.replace(/\/+$/, '') || '/';
      out.push({
        method: method.toUpperCase() as Method,
        path: concrete(joined),
        file: file.replace(`${ROOT}/`, ''),
      });
    }
  }
  return out;
}

/** Which file each `/api/v1` sub-router lives in, from the mount table. */
function apiV1Prefixes(): { byFile: Map<string, string>; unresolved: string[] } {
  const src = stripComments(readFileSync(join(ROOT, 'src/api/v1/index.ts'), 'utf8'));
  const imports = new Map<string, string>();
  for (const m of src.matchAll(/import\s*\{\s*([\w\s,]+?)\s*\}\s*from\s*'(\.[^']+)'/g)) {
    for (const name of m[1].split(',').map((n) => n.trim()).filter(Boolean)) {
      imports.set(name, m[2]);
    }
  }
  const byFile = new Map<string, string>();
  const unresolved: string[] = [];
  for (const m of src.matchAll(/apiV1\.route\('(\/[^']*)',\s*(\w+)\)/g)) {
    const rel = imports.get(m[2]);
    if (!rel) { unresolved.push(m[2]); continue; }
    byFile.set(basename(rel).replace(/\.js$/, '.ts'), `/api/v1${m[1]}`);
  }
  return { byFile, unresolved };
}

/** Every route the app declares, with the path a request would actually use. */
export function declaredRoutes(): { routes: DeclaredRoute[]; unresolved: string[] } {
  const routes: DeclaredRoute[] = [];
  for (const file of tsFiles(join(ROOT, 'src/routes'))) {
    routes.push(...declarationsIn(file, ''));
  }

  const { byFile, unresolved } = apiV1Prefixes();
  routes.push(...declarationsIn(join(ROOT, 'src/api/v1/index.ts'), '/api/v1'));
  for (const file of tsFiles(join(ROOT, 'src/api'))) {
    if (file.endsWith('src/api/v1/index.ts')) continue;
    const prefix = byFile.get(basename(file));
    if (prefix === undefined) {
      if (declarationsIn(file, '').length) unresolved.push(file.replace(`${ROOT}/`, ''));
      continue;
    }
    routes.push(...declarationsIn(file, prefix));
  }

  const seen = new Set<string>();
  return {
    routes: routes.filter((r) => {
      const key = `${r.method} ${r.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    unresolved,
  };
}
