// =============================================================================
// FOUNDRY — SCP Agent Message Bus
// Inter-agent communication: sending, receiving, and reading agent messages.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentMessage {
  id: string;
  product_id: string;
  from_agent: string;
  to_agent: string;
  type: string;
  priority: string;
  subject: string;
  body: string;
  context: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToMessage(row: Record<string, unknown>): AgentMessage {
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    from_agent: row.from_agent as string,
    to_agent: row.to_agent as string,
    type: row.type as string,
    priority: (row.priority as string) ?? 'medium',
    subject: row.subject as string,
    body: row.body as string,
    context: parseJson<Record<string, unknown>>(row.context_json as string, {}),
    read_at: (row.read_at as string) ?? null,
    created_at: row.created_at as string,
  };
}

// ─── sendMessage ──────────────────────────────────────────────────────────────

export async function sendMessage(params: {
  productId: string;
  fromAgent: string;
  toAgent: string;
  type: 'insight' | 'request' | 'alert' | 'handoff' | 'question' | 'report';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  subject: string;
  body: string;
  context?: Record<string, unknown>;
}): Promise<string> {
  const id = nanoid();
  const {
    productId,
    fromAgent,
    toAgent,
    type,
    priority = 'medium',
    subject,
    body,
    context = {},
  } = params;

  // A REQUEST-FOR-RESPONSE PROTOCOL NOTHING USED. `requiresResponse` and
  // `responseDeadlineHours` were parameters no caller ever passed, so
  // `requires_response` was 0 on every message ever sent; `replyToMessage` was
  // the only writer of `responded_at` and had no caller; and the dashboard drew
  // an "Unanswered" card and a "Response requested" badge from the pair, which
  // could therefore only ever show zero and never render. Migration 213 drops
  // the four columns. If agents are to ask each other for answers, that is a
  // loop with a sender, a replier and a deadline nobody has written yet.
  await query(
    `INSERT INTO agent_messages
       (id, product_id, from_agent, to_agent, type, priority, subject, body,
        context_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [id, productId, fromAgent, toAgent, type, priority, subject, body,
     JSON.stringify(context)]
  );

  return id;
}

// ─── getUnreadMessages ────────────────────────────────────────────────────────

export async function getUnreadMessages(
  productId: string,
  agentName: string
): Promise<AgentMessage[]> {
  const result = await query(
    `SELECT * FROM agent_messages
     WHERE product_id = ? AND (to_agent = ? OR to_agent = 'broadcast') AND read_at IS NULL
     ORDER BY
       CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
       created_at DESC`,
    [productId, agentName]
  );
  return (result.rows as unknown as Array<Record<string, unknown>>).map(rowToMessage);
}

// ─── getMessageInbox ──────────────────────────────────────────────────────────

export async function getMessageInbox(
  productId: string,
  agentName: string,
  limit = 50
): Promise<AgentMessage[]> {
  const result = await query(
    `SELECT * FROM agent_messages
     WHERE product_id = ? AND (to_agent = ? OR to_agent = 'broadcast')
     ORDER BY
       CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
       created_at DESC
     LIMIT ?`,
    [productId, agentName, limit]
  );
  return (result.rows as unknown as Array<Record<string, unknown>>).map(rowToMessage);
}

// ─── markAsRead ───────────────────────────────────────────────────────────────

/**
 * THE SCOPE TRAVELS WITH THE CALL. This took message ids alone, so the company
 * whose messages were being marked was decided entirely by whoever assembled
 * the list. Its one caller had fetched them for the company on screen, which is
 * the only reason that was not a cross-tenant write — the same shape, and the
 * same reason, as `experiments.updateResults` before it was scoped.
 */
export async function markAsRead(productId: string, messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  const placeholders = messageIds.map(() => '?').join(', ');
  await query(
    `UPDATE agent_messages SET read_at = datetime('now')
      WHERE product_id = ? AND id IN (${placeholders}) AND read_at IS NULL`,
    [productId, ...messageIds]
  );
}

// ─── getMessageSummary ────────────────────────────────────────────────────────

export async function getMessageSummary(
  productId: string,
  hours = 24
): Promise<{
  total_messages: number;
  critical_count: number;
  most_active_agents: string[];
  recent_highlights: string[];
}> {
  const [totalsResult, agentsResult, highlightsResult] = await Promise.all([
    query(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN priority = 'critical' THEN 1 ELSE 0 END) as critical
       FROM agent_messages
       WHERE product_id = ? AND created_at > datetime('now', ? || ' hours')`,
      [productId, `-${hours}`]
    ),
    query(
      `SELECT from_agent, COUNT(*) as cnt
       FROM agent_messages
       WHERE product_id = ? AND created_at > datetime('now', ? || ' hours')
       GROUP BY from_agent
       ORDER BY cnt DESC
       LIMIT 5`,
      [productId, `-${hours}`]
    ),
    query(
      `SELECT subject, from_agent, priority
       FROM agent_messages
       WHERE product_id = ? AND priority IN ('critical','high')
         AND created_at > datetime('now', ? || ' hours')
       ORDER BY
         CASE priority WHEN 'critical' THEN 1 ELSE 2 END,
         created_at DESC
       LIMIT 5`,
      [productId, `-${hours}`]
    ),
  ]);

  const totals = (totalsResult.rows[0] as Record<string, unknown> | undefined) ?? {};
  const activeAgents = (agentsResult.rows as unknown as Array<Record<string, unknown>>)
    .map((r) => r.from_agent as string);
  const highlights = (highlightsResult.rows as unknown as Array<Record<string, unknown>>)
    .map((r) => `[${(r.priority as string).toUpperCase()}] ${r.from_agent}: ${r.subject}`);

  return {
    total_messages: (totals.total as number) ?? 0,
    critical_count: (totals.critical as number) ?? 0,
    most_active_agents: activeAgents,
    recent_highlights: highlights,
  };
}

// ─── broadcastAlert ───────────────────────────────────────────────────────────

export async function broadcastAlert(
  productId: string,
  fromAgent: string,
  params: {
    subject: string;
    body: string;
    priority: 'medium' | 'high' | 'critical';
    context?: Record<string, unknown>;
  }
): Promise<void> {
  await sendMessage({
    productId,
    fromAgent,
    toAgent: 'broadcast',
    type: 'alert',
    priority: params.priority,
    subject: params.subject,
    body: params.body,
    context: params.context ?? {},
  });
}
