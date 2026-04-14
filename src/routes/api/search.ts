// =============================================================================
// FOUNDRY — Search API
// Full-text search across decisions, audit log, story artifacts.
// =============================================================================

import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductsByOwner } from '../../db/client.js';
import { parsePagination, paginatedQuery } from '../../lib/pagination.js';

export const searchRoutes = new Hono<AuthEnv>();

searchRoutes.get('/api/search', async (c) => {
  const founder = c.get('founder');
  const q = c.req.query('q')?.trim();
  const type = c.req.query('type'); // decisions, audit_log, artifacts, all
  const pagination = parsePagination({ page: c.req.query('page'), limit: c.req.query('limit') });

  if (!q || q.length < 2) {
    return c.json({ error: 'Query must be at least 2 characters', results: [] }, 400);
  }

  // Get all product IDs for this founder
  const products = await getProductsByOwner(founder.id);
  if (products.rows.length === 0) return c.json({ results: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 0, hasNext: false, hasPrev: false } });

  const productIds = products.rows.map((p) => (p as Record<string, string>).id);
  const placeholders = productIds.map(() => '?').join(', ');
  const searchTerm = `%${q}%`;

  const results: Array<{ type: string; id: string; title: string; excerpt: string; created_at: string; product_id: string }> = [];

  // Search decisions
  if (!type || type === 'decisions' || type === 'all') {
    const decisions = await query(
      `SELECT id, product_id, category, what, why_now, created_at FROM decisions
       WHERE product_id IN (${placeholders}) AND (what LIKE ? OR why_now LIKE ?)
       ORDER BY created_at DESC LIMIT 20`,
      [...productIds, searchTerm, searchTerm]
    );
    for (const row of decisions.rows) {
      const d = row as Record<string, string>;
      results.push({
        type: 'decision',
        id: d.id,
        title: d.what,
        excerpt: (d.why_now ?? '').slice(0, 200),
        created_at: d.created_at,
        product_id: d.product_id,
      });
    }
  }

  // Search audit log
  if (!type || type === 'audit_log' || type === 'all') {
    const logs = await query(
      `SELECT id, product_id, action_type, reasoning, created_at FROM audit_log
       WHERE product_id IN (${placeholders}) AND (action_type LIKE ? OR reasoning LIKE ?)
       ORDER BY created_at DESC LIMIT 20`,
      [...productIds, searchTerm, searchTerm]
    );
    for (const row of logs.rows) {
      const l = row as Record<string, string>;
      results.push({
        type: 'audit_log',
        id: l.id,
        title: l.action_type,
        excerpt: (l.reasoning ?? '').slice(0, 200),
        created_at: l.created_at,
        product_id: l.product_id,
      });
    }
  }

  // Search story artifacts
  if (!type || type === 'artifacts' || type === 'all') {
    const artifacts = await query(
      `SELECT id, product_id, title, content, created_at FROM founding_story_artifacts
       WHERE product_id IN (${placeholders}) AND (title LIKE ? OR content LIKE ?)
       ORDER BY created_at DESC LIMIT 20`,
      [...productIds, searchTerm, searchTerm]
    );
    for (const row of artifacts.rows) {
      const a = row as Record<string, string>;
      results.push({
        type: 'artifact',
        id: a.id,
        title: a.title,
        excerpt: (a.content ?? '').slice(0, 200),
        created_at: a.created_at,
        product_id: a.product_id,
      });
    }
  }

  // Sort all results by date descending
  results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Manual pagination
  const total = results.length;
  const paged = results.slice(pagination.offset, pagination.offset + pagination.limit);

  return c.json({
    query: q,
    results: paged,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
      hasNext: pagination.page * pagination.limit < total,
      hasPrev: pagination.page > 1,
    },
  });
});
