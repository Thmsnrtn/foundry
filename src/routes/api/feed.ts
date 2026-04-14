// =============================================================================
// FOUNDRY — Activity Feed API
// Unified timeline of everything that happened — the single source of truth.
// =============================================================================

import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductsByOwner } from '../../db/client.js';
import { parsePagination } from '../../lib/pagination.js';

export const feedRoutes = new Hono<AuthEnv>();

interface FeedItem {
  id: string;
  type: 'audit' | 'decision' | 'stressor' | 'risk_change' | 'milestone' | 'metric' | 'competitive' | 'remediation' | 'system';
  title: string;
  body: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
  product_id: string;
  product_name?: string;
  created_at: string;
  action_url?: string;
}

feedRoutes.get('/api/feed', async (c) => {
  const founder = c.get('founder');
  const pagination = parsePagination({ page: c.req.query('page'), limit: c.req.query('limit') ?? '20' });

  const products = await getProductsByOwner(founder.id);
  if (products.rows.length === 0) return c.json({ feed: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false } });

  const productIds = products.rows.map((p) => (p as Record<string, string>).id);
  const productMap = new Map(products.rows.map((p) => [(p as Record<string, string>).id, (p as Record<string, string>).name]));
  const placeholders = productIds.map(() => '?').join(',');

  // Pull from multiple sources and merge into a single timeline
  const [auditLogs, decisions, stressors, milestones, signals] = await Promise.all([
    query(
      `SELECT id, product_id, action_type, reasoning, gate, risk_state_at_action, created_at
       FROM audit_log WHERE product_id IN (${placeholders})
       ORDER BY created_at DESC LIMIT 50`,
      productIds
    ),
    query(
      `SELECT id, product_id, category, what, status, created_at
       FROM decisions WHERE product_id IN (${placeholders})
       ORDER BY created_at DESC LIMIT 30`,
      productIds
    ),
    query(
      `SELECT id, product_id, stressor_name, severity, status, identified_at as created_at
       FROM stressor_history WHERE product_id IN (${placeholders})
       ORDER BY identified_at DESC LIMIT 20`,
      productIds
    ),
    query(
      `SELECT id, product_id, milestone_title, milestone_description, created_at
       FROM milestone_events WHERE founder_id = ?
       ORDER BY created_at DESC LIMIT 15`,
      [founder.id]
    ),
    query(
      `SELECT id, product_id, competitor_name, signal_summary, significance, detected_at as created_at
       FROM competitive_signals WHERE product_id IN (${placeholders}) AND significance IN ('medium','high')
       ORDER BY detected_at DESC LIMIT 15`,
      productIds
    ),
  ]);

  const feed: FeedItem[] = [];

  // Audit log entries
  for (const row of auditLogs.rows) {
    const r = row as Record<string, string>;
    feed.push({
      id: r.id,
      type: r.action_type.includes('risk_state') ? 'risk_change' : r.action_type.includes('audit') ? 'audit' : 'system',
      title: formatActionType(r.action_type),
      body: (r.reasoning ?? '').slice(0, 200),
      severity: r.risk_state_at_action === 'red' ? 'critical' : r.risk_state_at_action === 'yellow' ? 'warning' : 'info',
      product_id: r.product_id,
      product_name: productMap.get(r.product_id),
      created_at: r.created_at,
    });
  }

  // Decisions
  for (const row of decisions.rows) {
    const d = row as Record<string, string>;
    feed.push({
      id: d.id,
      type: 'decision',
      title: d.what,
      body: `${d.category} decision — ${d.status}`,
      severity: d.category === 'urgent' ? 'warning' : 'info',
      product_id: d.product_id,
      product_name: productMap.get(d.product_id),
      created_at: d.created_at,
      action_url: `/decisions/${d.id}`,
    });
  }

  // Stressors
  for (const row of stressors.rows) {
    const s = row as Record<string, string>;
    feed.push({
      id: s.id,
      type: 'stressor',
      title: s.stressor_name,
      body: s.status === 'resolved' ? 'Resolved' : `Active — ${s.severity}`,
      severity: s.severity === 'critical' ? 'critical' : s.severity === 'elevated' ? 'warning' : 'info',
      product_id: s.product_id,
      product_name: productMap.get(s.product_id),
      created_at: s.created_at,
    });
  }

  // Milestones
  for (const row of milestones.rows) {
    const m = row as Record<string, string>;
    feed.push({
      id: m.id,
      type: 'milestone',
      title: m.milestone_title,
      body: m.milestone_description,
      severity: 'success',
      product_id: m.product_id,
      product_name: productMap.get(m.product_id),
      created_at: m.created_at,
    });
  }

  // Competitive signals
  for (const row of signals.rows) {
    const s = row as Record<string, string>;
    feed.push({
      id: s.id,
      type: 'competitive',
      title: `${s.competitor_name}: ${s.signal_summary}`,
      body: `Significance: ${s.significance}`,
      severity: s.significance === 'high' ? 'warning' : 'info',
      product_id: s.product_id,
      product_name: productMap.get(s.product_id),
      created_at: s.created_at,
    });
  }

  // Sort by date descending
  feed.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Paginate
  const total = feed.length;
  const paged = feed.slice(pagination.offset, pagination.offset + pagination.limit);

  return c.json({
    feed: paged,
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

function formatActionType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
