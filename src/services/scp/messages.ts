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
  requires_response: boolean;
  response_deadline: string | null;
  responded_at: string | null;
  response_id: string | null;
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
    requires_response: (row.requires_response as number) === 1,
    response_deadline: (row.response_deadline as string) ?? null,
    responded_at: (row.responded_at as string) ?? null,
    response_id: (row.response_id as string) ?? null,
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
  requiresResponse?: boolean;
  responseDeadlineHours?: number;
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
    requiresResponse = false,
    responseDeadlineHours,
  } = params;

  const deadlineSql = responseDeadlineHours
    ? `datetime('now', '+${responseDeadlineHours} hours')`
    : null;

  await query(
    `INSERT INTO agent_messages
       (id, product_id, from_agent, to_agent, type, priority, subject, body,
        context_json, requires_response, response_deadline, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${deadlineSql ? deadlineSql : '?'}, datetime('now'))`,
    deadlineSql
      ? [id, productId, fromAgent, toAgent, type, priority, subject, body,
         JSON.stringify(context), requiresResponse ? 1 : 0]
      : [id, productId, fromAgent, toAgent, type, priority, subject, body,
         JSON.stringify(context), requiresResponse ? 1 : 0, null]
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

export async function markAsRead(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  const placeholders = messageIds.map(() => '?').join(', ');
  await query(
    `UPDATE agent_messages SET read_at = datetime('now') WHERE id IN (${placeholders}) AND read_at IS NULL`,
    messageIds
  );
}

// ─── replyToMessage ───────────────────────────────────────────────────────────

export async function replyToMessage(
  originalMessageId: string,
  params: {
    fromAgent: string;
    body: string;
    context?: Record<string, unknown>;
  }
): Promise<string> {
  // Fetch original to get product_id, from_agent, subject
  const originalResult = await query(
    `SELECT * FROM agent_messages WHERE id = ?`,
    [originalMessageId]
  );
  if (originalResult.rows.length === 0) {
    throw new Error(`Message ${originalMessageId} not found`);
  }

  const original = originalResult.rows[0] as Record<string, unknown>;
  const productId = original.product_id as string;
  const toAgent = original.from_agent as string;
  const subject = `Re: ${original.subject as string}`;

  const replyId = await sendMessage({
    productId,
    fromAgent: params.fromAgent,
    toAgent,
    type: 'report',
    priority: 'medium',
    subject,
    body: params.body,
    context: params.context ?? {},
  });

  // Mark original as responded
  await query(
    `UPDATE agent_messages
     SET responded_at = datetime('now'), response_id = ?
     WHERE id = ?`,
    [replyId, originalMessageId]
  );

  return replyId;
}

// ─── getMessageSummary ────────────────────────────────────────────────────────

export async function getMessageSummary(
  productId: string,
  hours = 24
): Promise<{
  total_messages: number;
  critical_count: number;
  unresponded_count: number;
  most_active_agents: string[];
  recent_highlights: string[];
}> {
  const [totalsResult, agentsResult, highlightsResult] = await Promise.all([
    query(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN priority = 'critical' THEN 1 ELSE 0 END) as critical,
         SUM(CASE WHEN requires_response = 1 AND responded_at IS NULL THEN 1 ELSE 0 END) as unresponded
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
    unresponded_count: (totals.unresponded as number) ?? 0,
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
