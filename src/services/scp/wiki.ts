// =============================================================================
// FOUNDRY — Agent Wiki Service
// Persistent cross-agent knowledge store for structured articles per product.
// Based on migration 027 (agent_wiki_entries, agent_wiki_reads tables).
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

// ─── updateWikiEntry ──────────────────────────────────────────────────────────

export async function updateWikiEntry(
  entryId: string,
  updates: { content?: string; tags?: string[]; confidence_score?: number }
): Promise<void> {
  const setParts: string[] = ["updated_at = datetime('now')", 'version = version + 1'];
  const args: unknown[] = [];

  if (updates.content !== undefined) {
    setParts.push('content = ?');
    args.push(updates.content);
  }
  if (updates.tags !== undefined) {
    setParts.push('tags = ?');
    args.push(JSON.stringify(updates.tags));
  }
  if (updates.confidence_score !== undefined) {
    setParts.push('confidence_score = ?');
    args.push(updates.confidence_score);
  }

  args.push(entryId);

  await query(
    `UPDATE agent_wiki_entries SET ${setParts.join(', ')} WHERE id = ?`,
    args
  );
}

// ─── searchWiki ───────────────────────────────────────────────────────────────

export async function searchWiki(
  productId: string,
  searchQuery: string,
  category?: string
): Promise<WikiEntry[]> {
  const like = `%${searchQuery}%`;
  const conditions = ['product_id = ?', '(title LIKE ? OR content LIKE ? OR tags LIKE ?)'];
  const args: unknown[] = [productId, like, like, like];

  if (category) {
    conditions.push('section = ?');
    args.push(toSection(category));
  }

  const result = await query(
    `SELECT * FROM agent_wiki_entries WHERE ${conditions.join(' AND ')}
     ORDER BY updated_at DESC`,
    args
  );

  return result.rows.map((row) => rowToEntry(row as Record<string, unknown>));
}

// ─── getWikiEntry ─────────────────────────────────────────────────────────────

export async function getWikiEntry(entryId: string): Promise<WikiEntry | null> {
  const result = await query(
    `SELECT * FROM agent_wiki_entries WHERE id = ?`,
    [entryId]
  );
  if (result.rows.length === 0) return null;
  return rowToEntry(result.rows[0] as Record<string, unknown>);
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

// ─── markWikiRead ─────────────────────────────────────────────────────────────

export async function markWikiRead(entryId: string, agentName: string): Promise<void> {
  await query(
    `INSERT INTO agent_wiki_reads (id, entry_id, agent_name) VALUES (?, ?, ?)`,
    [nanoid(), entryId, agentName]
  );
}

// ─── getUnreadWikiEntries ─────────────────────────────────────────────────────

export async function getUnreadWikiEntries(
  productId: string,
  agentName: string,
  limit = 20
): Promise<WikiEntry[]> {
  const result = await query(
    `SELECT e.* FROM agent_wiki_entries e
     WHERE e.product_id = ?
       AND e.id NOT IN (
         SELECT r.entry_id FROM agent_wiki_reads r
         WHERE r.agent_name = ?
       )
     ORDER BY e.is_pinned DESC, e.updated_at DESC
     LIMIT ?`,
    [productId, agentName, limit]
  );

  return result.rows.map((row) => rowToEntry(row as Record<string, unknown>));
}
