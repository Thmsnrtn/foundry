process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// A FOUNDER-LEVEL EMAIL CHARGED TO WHICHEVER COMPANY SORTED FIRST.
//
// The four behavioural triggers ask questions about the FOUNDER — "your audit",
// "you have pending decisions" — across all their companies. But the gateway
// needs a company for authority and `audit_log.product_id` is NOT NULL, so one
// has to be named, and this named `products.rows[0]` with no ORDER BY. For a
// founder with two companies the email about their account was logged against
// whichever row SQLite returned first, and the dedup key that stops it
// repeating was keyed on that same arbitrary choice — so which company it
// landed on could change between runs, and the email could repeat.
//
// The company is now the founder's oldest active one: deterministic, and the
// one their account was opened with. `rowid` breaks the tie, because an id here
// is a nanoid and not a clock.
// =============================================================================

const src = stripComments(readFileSync('src/services/triggers/behavioral.ts', 'utf8'));

describe('the company a founder-level trigger is charged to', () => {
  it('is chosen deterministically, not by row order', () => {
    expect(src).toContain("ORDER BY created_at ASC, rowid ASC LIMIT 1");
    expect(src).not.toMatch(/SELECT id FROM products WHERE owner_id = \?'/);
  });

  it('excludes an archived company', () => {
    expect(src).toContain("status != 'archived'");
  });

  it('fails closed when the founder has no company to charge', () => {
    // `if (!productId) continue;` — no authority context, no send.
    expect(src).toContain('if (!productId) continue');
  });

  it('does not log against a company id it invented', () => {
    // `product_id: productId || 'system'` wrote the literal string 'system'
    // into a column with a foreign key to `products`.
    expect(src).not.toContain("productId || 'system'");
  });
});

describe('the check signature', () => {
  it('takes only the founder, because that is all any check reads', () => {
    expect(src).toContain('check: (founderId: string) => Promise<boolean>');
    expect(src).not.toContain('trigger.check(founder.id, productId)');
  });
});
