// =============================================================================
// FOUNDRY — Agent Message Threading
// Groups agent messages into named conversation threads.
// Based on migration 031 (agent_message_threads + thread_id on agent_messages).
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { sendMessage } from './messages.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MessageThread {
  id: string;
  product_id: string;
  subject: string;
  participants: string[];
  message_count: number;
  last_message_at: string | null;
  created_at: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function createThread(
  productId: string,
  subject: string,
  participants: string[]
): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO agent_message_threads (id, product_id, subject, participants)
     VALUES (?,?,?,?)`,
    [id, productId, subject, JSON.stringify(participants)]
  );
  return id;
}

export async function sendThreadedMessage(
  threadId: string,
  params: {
    productId: string;
    fromAgent: string;
    toAgent: string;
    type: 'insight' | 'request' | 'alert' | 'handoff' | 'question' | 'report';
    priority?: 'low' | 'medium' | 'high' | 'critical';
    subject: string;
    body: string;
    context?: Record<string, unknown>;
    parentMessageId?: string;
  }
): Promise<string> {
  const messageId = await sendMessage({
    productId: params.productId,
    fromAgent: params.fromAgent,
    toAgent: params.toAgent,
    type: params.type,
    priority: params.priority,
    subject: params.subject,
    body: params.body,
    context: params.context,
  });

  // Link message to thread
  await query(
    `UPDATE agent_messages SET thread_id=?, parent_message_id=? WHERE id=?`,
    [threadId, params.parentMessageId ?? null, messageId]
  );

  // Update thread metadata
  await query(
    `UPDATE agent_message_threads SET
       message_count = message_count + 1,
       last_message_at = datetime('now')
     WHERE id=?`,
    [threadId]
  );

  return messageId;
}

export async function getThread(threadId: string): Promise<MessageThread | null> {
  const result = await query(`SELECT * FROM agent_message_threads WHERE id=?`, [threadId]);
  if (result.rows.length === 0) return null;
  return parseThreadRow(result.rows[0] as Record<string, unknown>);
}

export async function getThreadMessages(threadId: string): Promise<Array<{
  id: string;
  from_agent: string;
  to_agent: string;
  type: string;
  priority: string;
  subject: string;
  body: string;
  parent_message_id: string | null;
  read_at: string | null;
  created_at: string;
}>> {
  const result = await query(
    `SELECT id, from_agent, to_agent, type, priority, subject, body,
            parent_message_id, read_at, created_at
     FROM agent_messages WHERE thread_id=? ORDER BY created_at ASC`,
    [threadId]
  );
  return result.rows.map(r => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      from_agent: row.from_agent as string,
      to_agent: row.to_agent as string,
      type: row.type as string,
      priority: row.priority as string,
      subject: row.subject as string,
      body: row.body as string,
      parent_message_id: (row.parent_message_id as string) ?? null,
      read_at: (row.read_at as string) ?? null,
      created_at: row.created_at as string,
    };
  });
}

export async function listThreads(
  productId: string,
  opts?: { participant?: string; limit?: number }
): Promise<MessageThread[]> {
  let where = 'product_id=?';
  const params: unknown[] = [productId];

  if (opts?.participant) {
    where += ` AND participants LIKE ?`;
    params.push(`%${opts.participant}%`);
  }

  params.push(opts?.limit ?? 20);

  const result = await query(
    `SELECT * FROM agent_message_threads WHERE ${where} ORDER BY last_message_at DESC LIMIT ?`,
    params
  );
  return result.rows.map(r => parseThreadRow(r as Record<string, unknown>));
}

export async function getOrCreateThread(
  productId: string,
  subject: string,
  participants: string[]
): Promise<string> {
  // Look for existing open thread with same subject
  const existing = await query(
    `SELECT id FROM agent_message_threads WHERE product_id=? AND subject=? LIMIT 1`,
    [productId, subject]
  );
  if (existing.rows.length > 0) {
    return (existing.rows[0] as Record<string, unknown>).id as string;
  }
  return createThread(productId, subject, participants);
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function parseThreadRow(row: Record<string, unknown>): MessageThread {
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    subject: row.subject as string,
    participants: (() => { try { return JSON.parse(row.participants as string || '[]'); } catch { return []; } })(),
    message_count: Number(row.message_count ?? 0),
    last_message_at: (row.last_message_at as string) ?? null,
    created_at: row.created_at as string,
  };
}
