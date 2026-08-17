import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// =============================================================================
// Public surfaces must not reach for rows that carry secrets.
//
// Two routes answer without any authentication at all — the share page and the
// ingest endpoints — and the `products` row carries `ingest_token` and
// `share_token`. The share page selected `p.*` and rendered only `id` and
// `name`, so nothing leaked; it was one added field away from handing an
// investor the credential their tools post metrics with.
//
// This gate is about REACH, not about rendering. Asserting "no secret is
// printed" would pass right up until somebody printed one. Asserting the row
// never arrives at a public handler means there is nothing there to print.
//
// Scoped ingest credentials (migration 139) are the same principle applied to
// the other direction: what a credential may DO is bounded at mint time rather
// than by whichever route happens to accept it.
// =============================================================================

const ROOT = resolve(__dirname, '../..');

/** Columns that are credentials. A public handler may match on one — that is
 * how token auth works — but must never select one into its own scope. */
const SECRET_COLUMNS = ['ingest_token', 'share_token', 'secret', 'intake_key', 'api_key'];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = resolve(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Routes reachable with no session and no founder — the URL is the whole of
 * the authentication, so whatever they read is read by whoever has the link. */
const PUBLIC_ROUTE_DIRS = ['src/routes/share', 'src/routes/ingest'];

describe('public, unauthenticated surfaces', () => {
  it('never select * from a table that carries a credential', () => {
    const offenders: string[] = [];
    for (const dir of PUBLIC_ROUTE_DIRS) {
      for (const file of walk(resolve(ROOT, dir))) {
        const source = readFileSync(file, 'utf8');
        for (const [i, line] of source.split('\n').entries()) {
          if (/SELECT\s+(\w+\.)?\*\s+FROM\s+(products|founders|support_channels|ingest_credentials|api_keys)\b/i
            .test(line)) {
            offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1} → ${line.trim()}`);
          }
        }
      }
    }
    expect(offenders,
      'A public handler selected a whole row from a table carrying a credential. '
      + 'Name the columns instead — the risk is not what is printed today:\n'
      + offenders.join('\n')).toEqual([]);
  });

  it('select a credential column only to match on it, never to carry it', () => {
    const offenders: string[] = [];
    for (const dir of PUBLIC_ROUTE_DIRS) {
      for (const file of walk(resolve(ROOT, dir))) {
        const source = readFileSync(file, 'utf8');
        for (const [i, line] of source.split('\n').entries()) {
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
          // A SELECT list, not a WHERE clause. `WHERE ingest_token = ?` is the
          // authentication itself and is exactly right.
          const selectList = /SELECT\s+([^]*?)\s+FROM\b/i.exec(line)?.[1];
          if (!selectList) continue;
          for (const secret of SECRET_COLUMNS) {
            if (new RegExp(`(^|[\\s,.])${secret}(\\s|,|$)`).test(selectList)) {
              offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1} → selects ${secret}`);
            }
          }
        }
      }
    }
    expect(offenders,
      'A public handler read a credential column into its own scope:\n' + offenders.join('\n'))
      .toEqual([]);
  });

  it('the share page reads only what it renders', () => {
    // Named explicitly, so widening it is a visible edit rather than a silent
    // consequence of a `*`.
    const source = readFileSync(resolve(ROOT, 'src/routes/share/index.ts'), 'utf8');
    expect(source).toContain('SELECT p.id, p.name, f.name as founder_name');
    const rendered = [...source.matchAll(/product\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(rendered)].sort()).toEqual(['id', 'name']);
  });
});
