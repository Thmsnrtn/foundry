// =============================================================================
// Tests: the two pause axes must be read together
//
// A product can stop being operated in two independent ways:
//   products.status      'archived' — the record is gone (consent withdrawal,
//                        data deletion, founder archive)
//   products.scp_status  'paused'   — the company is not acting (subscription
//                        cancelled, founder paused it, entitlement lapsed)
//
// Every consumer that reads one and not the other is wrong in one direction:
//   • `status` only  → a cancelled or unpaid company keeps being operated
//   • `scp_status` only → a company whose founder withdrew consent and whose
//     data was just deleted stays on the work list
//
// Both were live. Roughly twenty scheduled jobs selected on `scp_status`
// alone while the deletion path wrote only `status`; the digest jobs selected
// on `status` alone while the entitlement sweep wrote only `scp_status`. Each
// half was correct about its own axis and blind to the other.
//
// `operatingProduct()` is the single definition. This file keeps it single: a
// new one-axis filter fails here rather than being found the next time the two
// halves are compared.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

import { operatingProduct } from '../../src/db/client.js';

const SRC = resolve(__dirname, '../../src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Source with block comments and line comments removed — a rule described in
 * prose is not a rule applied in a query, and counting prose as a violation is
 * how a gate earns its reputation for noise. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
}

describe('operatingProduct is the definition of "Foundry is operating this"', () => {
  it('constrains both axes', () => {
    const sql = operatingProduct();
    expect(sql).toMatch(/status = 'active'/);
    expect(sql).toMatch(/scp_status/);
    expect(sql).toMatch(/paused/);
    expect(sql).toMatch(/archived/);
  });

  it('coalesces a NULL scp_status rather than dropping the row', () => {
    // SQLite: NULL NOT IN ('paused','archived') is NULL, not true. Without the
    // COALESCE, every product predating migration 017 silently disappears from
    // every job — a fail-closed so total it looks like the platform is idle.
    expect(operatingProduct()).toMatch(/COALESCE\(scp_status,'active'\)/);
  });

  it('qualifies both columns when given an alias', () => {
    const sql = operatingProduct('p');
    expect(sql).toMatch(/p\.status/);
    expect(sql).toMatch(/COALESCE\(p\.scp_status,'active'\)/);
    expect(sql).not.toMatch(/(?<!p\.)\bscp_status/);
  });
});

// ONE DIRECTION IS CHECKABLE, THE OTHER IS NOT. A query that filters
// `scp_status` is choosing work — that is the only thing the column means — so
// it must also exclude archived records. The reverse is not a defect on its
// face: a dashboard listing a founder's companies SHOULD filter on `status`
// alone, because the owner decision keeps a read-only account's data readable.
// Distinguishing "selects products to act on" from "lists products to show"
// cannot be done by pattern, so this checks the half that can be, and says so
// rather than shipping an allow-list of two dozen entries that are mostly fine.
describe('no query chooses work on the SCP axis alone', () => {
  const OFFENDERS: string[] = [];

  for (const file of tsFiles(SRC)) {
    if (file.endsWith('/db/client.ts')) continue;             // the definition itself
    const source = code(file);
    for (const m of source.matchAll(/`[^`]*`|'[^'\n]*'|"[^"\n]*"/g)) {
      const sql = m[0];
      if (!/\bscp_status\s*(=|!=|<>|NOT\s+IN|IN)/i.test(sql)) continue;
      if (!/\bFROM\s+products\b/i.test(sql)) continue;
      if (/operatingProduct/.test(sql)) continue;             // uses the definition
      if (/(?<!scp_)\bstatus\s*(=|!=|<>|NOT\s+IN|IN)/i.test(sql)) continue;
      OFFENDERS.push(`${relative(SRC, file)}:${source.slice(0, m.index).split('\n').length}`);
    }
  }

  it('constrains the archive axis too, or uses operatingProduct()', () => {
    expect(OFFENDERS, 'work chosen on scp_status alone still runs for a deleted company')
      .toEqual([]);
  });
});

describe('the writers agree with the readers', () => {
  it('deletion ends the operating relationship, not just the record', () => {
    const consent = code(resolve(SRC, 'services/privacy/consent.ts'));
    const archive = consent.match(/UPDATE products SET status = 'archived'[\s\S]{0,200}?WHERE id = \?/);
    expect(archive, 'the deletion job must still archive the product').not.toBeNull();
    expect(archive![0], 'archiving must also stop the company acting')
      .toMatch(/scp_status\s*=\s*'archived'/);
  });
});
