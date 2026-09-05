// =============================================================================
// Shared by the two gates that read every query over `products`:
// check-reality-scope (synthetic must not reach owner truth) and
// check-standing-scope (a test object must not read as an operating company).
// One walker and one "already bound to one company" rule, so the two gates
// cannot disagree about what a product query is. A rule two scripts share is
// a module, not a line copied twice.
// =============================================================================

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** A query that names one company by id is already scoped to that company. */
export function boundToOneCompany(sql) {
  return /\b(id|product_id|p\.id)\s*=\s*\?/.test(sql)
    || /\bWHERE\s+id\s*=/.test(sql)
    || /products\s+WHERE\s+id/i.test(sql);
}
