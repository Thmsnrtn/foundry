// =============================================================================
// FOUNDRY — Agent Wiki Service
// Persistent cross-agent knowledge store for structured articles per product.
// Backed by `agent_wiki_entries` (migration 027).
//
// This module is deliberately two functions wide. It used to export six, and
// four of them had no caller: a second writer that bypassed the upsert's
// (product, section, title) identity, a search, a single-entry fetch, and a
// read-tracking pair whose ledger `agent_wiki_reads` nothing populated —
// removed in migration 195. What is here is what runs.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WikiEntry {
  id: string;
  product_id: string;
  title: string;
  content: string;
  category: string; // 'strategy' | 'product' | 'technical' | 'process' | 'market' | 'customer'
  tags: string[];
  created_by_agent: string;
  confidence_score: number; // 0-1
  created_at: string;
  updated_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Map user-facing category names to DB section values where needed.
// The DB CHECK constraint uses: customers|product|market|operations|team|financial|technical|strategy|other
// We store the user's category value directly if it matches, else fall back to 'other'.
const VALID_SECTIONS = new Set([
  'customers', 'product', 'market', 'operations', 'team',
  'financial', 'technical', 'strategy', 'other',
]);

function toSection(category: string): string {
  return VALID_SECTIONS.has(category) ? category : 'other';
}

function rowToEntry(r: Record<string, unknown>): WikiEntry {
  let tags: string[] = [];
  try {
    tags = JSON.parse((r.tags as string) ?? '[]') as string[];
  } catch {
    tags = [];
  }
  return {
    id: r.id as string,
    product_id: r.product_id as string,
    title: r.title as string,
    content: r.content as string,
    category: r.section as string,
    tags,
    created_by_agent: (r.author as string) ?? '',
    confidence_score: (r.confidence_score as number) ?? 1.0,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}

// ─── createWikiEntry ──────────────────────────────────────────────────────────

export async function createWikiEntry(
  productId: string,
  entry: Omit<WikiEntry, 'id' | 'product_id' | 'created_at' | 'updated_at'>
): Promise<string> {
  const id = nanoid();
  const section = toSection(entry.category);

  await query(
    `INSERT INTO agent_wiki_entries
       (id, product_id, section, title, content, tags, author, confidence_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(product_id, section, title) DO UPDATE SET
       content = excluded.content,
       tags = excluded.tags,
       confidence_score = excluded.confidence_score,
       last_editor = excluded.author,
       version = version + 1,
       updated_at = datetime('now')`,
    [
      id,
      productId,
      section,
      entry.title,
      entry.content,
      JSON.stringify(entry.tags ?? []),
      entry.created_by_agent,
      entry.confidence_score ?? 1.0,
    ]
  );

  // Return the id of the row (may differ if ON CONFLICT updated an existing row)
  const existing = await query(
    `SELECT id FROM agent_wiki_entries WHERE product_id = ? AND section = ? AND title = ?`,
    [productId, section, entry.title]
  );
  return ((existing.rows[0] as Record<string, unknown>)?.id as string) ?? id;
}

// ─── listWikiEntries ──────────────────────────────────────────────────────────

export async function listWikiEntries(
  productId: string,
  opts?: { category?: string; limit?: number; offset?: number }
): Promise<{ entries: WikiEntry[]; total: number }> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const conditions = ['product_id = ?'];
  const args: unknown[] = [productId];

  if (opts?.category) {
    conditions.push('section = ?');
    args.push(toSection(opts.category));
  }

  const where = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(*) as total FROM agent_wiki_entries WHERE ${where}`,
    args
  );
  const total = ((countResult.rows[0] as Record<string, unknown>)?.total as number) ?? 0;

  const dataResult = await query(
    `SELECT * FROM agent_wiki_entries WHERE ${where}
     ORDER BY updated_at DESC
     LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );

  const entries = dataResult.rows.map((row) => rowToEntry(row as Record<string, unknown>));
  return { entries, total };
}
