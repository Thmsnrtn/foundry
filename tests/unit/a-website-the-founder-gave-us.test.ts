process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// A WEBSITE THE FOUNDER GAVE US AND WE COULD NOT RECALL.
//
// Onboarding asks a founder for their website. The answer went into
// `web_audit_results` as a bare row — url plus ids, every analysis column NULL
// — and `products` had no website column at all, only `github_repo_url`.
// Nothing reads `web_audit_results`. So a founder answered a plain question
// about their own company and the institution could not afterwards say what the
// answer was.
//
// The audit that would fill those columns, `runWebAudit`, is reachable only
// through `routes/api/tier2.ts` — the clientless API of frontier item 2 — so a
// row written at onboarding was never going to become an audit either. A table
// named for audit results held a URL and nothing else.
//
// This is the plainest kind of company-sense gap: not a number computed wrongly
// but a fact volunteered and dropped. Found by following
// `check-unread-tables.mjs` to its second entry.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM web_audit_results');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

describe('where a company website lives', () => {
  it('is a column on the company', async () => {
    const cols = (await query('PRAGMA table_info(products)')).rows as unknown as
      Array<Record<string, unknown>>;
    expect(cols.map((c) => String(c.name)), 'beside github_repo_url')
      .toContain('website_url');
  });

  it('survives being read back', async () => {
    const owner = `f_${nanoid(8)}`;
    await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
      [owner, `c_${owner}`, `${owner}@example.com`]);
    const pid = `p_${nanoid(8)}`;
    await query(
      `INSERT INTO products (id, name, owner_id, website_url, status)
       VALUES (?,?,?,?, 'active')`, [pid, 'Acme', owner, 'https://acme.example']);

    const [row] = (await query('SELECT website_url FROM products WHERE id = ?', [pid]))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(row!.website_url).toBe('https://acme.example');
  });
});

describe('onboarding', () => {
  it('writes the website to the company, not to the audit table', () => {
    const src = stripComments(
      readFileSync('src/routes/dashboard/onboarding.ts', 'utf8'), { lineComments: true });
    expect(src, 'a URL in a table named for audit results, with no audit in it')
      .not.toMatch(/INSERT INTO web_audit_results/);
    expect(src).toMatch(/website_url/);
  });

  it('says why, where the change was made', () => {
    const src = readFileSync('src/routes/dashboard/onboarding.ts', 'utf8');
    expect(src).toMatch(/THE WEBSITE GOES WITH THE COMPANY/);
  });
});

describe('the founder can see it', () => {
  it('is shown on settings beside the repository', () => {
    const src = stripComments(
      readFileSync('src/routes/dashboard/settings.ts', 'utf8'), { lineComments: true });
    expect(src, 'selected').toMatch(/SELECT id, name, github_repo_url, website_url/);
    expect(src, 'and rendered — a column nobody displays is the same gap again')
      .toMatch(/p\.website_url \?/);
  });
});

describe('the audit table keeps its own purpose', () => {
  it('still exists, for real audit output', async () => {
    const rows = await query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='web_audit_results'");
    expect(rows.rows.length, 'runWebAudit still writes analysis here').toBe(1);
  });

  it('is still on the unread list, which is item 2’s decision not this one’s', () => {
    expect(readFileSync('docs/db/unread-tables-baseline.txt', 'utf8'))
      .toMatch(/web_audit_results/);
  });
});
