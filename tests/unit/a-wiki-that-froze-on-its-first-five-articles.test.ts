process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { createWikiEntry, listWikiEntries } from '../../src/services/scp/wiki.js';

// =============================================================================
// A WIKI THAT FROZE ON ITS FIRST FIVE ARTICLES.
//
// Scribe is the agent whose whole job is what the company has learned. Every
// cycle it writes articles into `agent_wiki_entries`, and every cycle it reads
// the table back to see what is already written down before naming knowledge
// gaps. It read the table with its own copy of the query, ordered by
// `created_at DESC LIMIT 5`.
//
// `createWikiEntry` upserts on (product, section, title): revising an article
// EDITS the row, bumping `version` and `updated_at` and leaving `created_at`
// where it was. That is correct — a weekly run that improves an article should
// not accumulate near-duplicates. But it means ordering by `created_at` shows
// the five articles that appeared FIRST-most-recently, not the five that most
// recently CHANGED. Once five distinct titles existed, the list froze, and
// every revision Scribe made afterwards was invisible to Scribe's own next run.
//
// An agent that cannot see its own edits will keep recommending that the
// company document what it has already documented.
//
// `listWikiEntries` already ordered by `updated_at DESC` and already returned
// the total. So the fix was not to write anything new — it was to stop keeping
// a second answer to "what does the wiki most recently say" in the caller.
//
// The total matters as much as the order. Five entries is a PAGE, and an agent
// asked to name what is missing has to know whether it is looking at the whole
// wiki or the top of it. This is the capped-page rule: a page is named a page.
// =============================================================================

const P = 'p_wiki';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_w','c_w','w@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_w','active')", [P]);
});

beforeEach(async () => { await query('DELETE FROM agent_wiki_entries'); });

async function write(title: string, content: string): Promise<string> {
  return createWikiEntry(P, {
    title, content, category: 'strategy', tags: [],
    created_by_agent: 'scribe', confidence_score: 1,
  });
}

/** Force a row's timestamps so ordering is decided by data, not by test speed. */
async function stamp(title: string, createdAt: string, updatedAt: string): Promise<void> {
  await query(
    `UPDATE agent_wiki_entries SET created_at = ?, updated_at = ? WHERE product_id = ? AND title = ?`,
    [createdAt, updatedAt, P, title],
  );
}

describe('what the wiki most recently says', () => {
  it('surfaces a revised article ahead of newer ones that have not changed', async () => {
    await write('Pricing', 'v1');
    await write('Churn', 'v1');
    await write('ICP', 'v1');
    await stamp('Pricing', '2026-01-01', '2026-01-01');
    await stamp('Churn', '2026-02-01', '2026-02-01');
    await stamp('ICP', '2026-03-01', '2026-03-01');

    // Scribe revises the oldest article. The upsert edits the row in place.
    await write('Pricing', 'v2 — much better');
    await query(
      `UPDATE agent_wiki_entries SET updated_at = '2026-04-01' WHERE product_id = ? AND title = 'Pricing'`,
      [P],
    );

    const page = await listWikiEntries(P, { limit: 5 });

    // Ordered by created_at, Pricing would be LAST of three, and with a tighter
    // limit it would have dropped out entirely.
    // By last change: Pricing (April), ICP (March), Churn (February).
    expect(page.entries.map((e) => e.title)).toEqual(['Pricing', 'ICP', 'Churn']);
    expect(page.entries[0].content).toBe('v2 — much better');
  });

  it('edits rather than accumulates, so a revision does not look like a new article', async () => {
    const first = await write('Pricing', 'v1');
    const second = await write('Pricing', 'v2');

    expect(second).toBe(first);
    const page = await listWikiEntries(P, { limit: 5 });
    expect(page.total).toBe(1);

    const row = await query(
      `SELECT version FROM agent_wiki_entries WHERE product_id = ? AND title = 'Pricing'`, [P]);
    expect((row.rows[0] as unknown as { version: number }).version).toBe(2);
  });

  it('reports the whole even when it returns a page', async () => {
    for (const t of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) await write(t, 'x');

    const page = await listWikiEntries(P, { limit: 5 });

    expect(page.entries.length).toBe(5);
    // The count is of the table, not of the page. An agent naming knowledge
    // gaps from five titles must be able to tell that two more exist.
    expect(page.total).toBe(7);
  });
});

describe('the read-tracking half is gone', () => {
  it('leaves no agent_wiki_reads table after every migration applies', async () => {
    const rows = await query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = 'agent_wiki_reads'`);
    expect(rows.rows.length).toBe(0);
  });

  it('keeps the store the wiki is actually written to', async () => {
    const rows = await query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = 'agent_wiki_entries'`);
    expect(rows.rows.length).toBe(1);
  });
});
