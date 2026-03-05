// =============================================================================
// FOUNDRY — Conversational Query API (v2)
// Multi-turn Ask Foundry with full business context, intent routing,
// conversation history, and action capability.
//
// POST /api/ask              — single-turn (legacy compat + quick asks)
// POST /api/threads          — create a new conversation thread
// GET  /api/threads          — list threads for a product
// GET  /api/threads/:id      — get thread with messages
// POST /api/threads/:id/messages — send a message to a thread
// DELETE /api/threads/:id    — archive a thread
// POST /api/threads/:id/save — save a message as an insight
// =============================================================================

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AuthEnv } from '../../middleware/auth.js';
import { getProductByOwner, query, getPendingDecisions, getActiveStressors } from '../../db/client.js';
import { callOpus, callSonnet } from '../../services/ai/client.js';
import { buildConversationContext, formatContextForPrompt } from '../../services/conversation/context.js';
import { classifyIntent, buildSystemPromptForIntent } from '../../services/conversation/intent.js';
import type { ConversationIntent } from '../../types/index.js';

export const apiAskRoutes = new Hono<AuthEnv>();

// ─── POST /api/ask — Legacy single-turn (backward compat) ────────────────────

apiAskRoutes.post('/api/ask', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as { question?: string; product_id?: string };

  if (!body.question?.trim()) return c.json({ error: 'question is required' }, 400);
  if (!body.product_id) return c.json({ error: 'product_id is required' }, 400);

  const productResult = await getProductByOwner(body.product_id, founder.id);
  if (productResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const product = productResult.rows[0] as Record<string, unknown>;

  const [ctx, classified] = await Promise.all([
    buildConversationContext(body.product_id, product.name as string, product.market_category as string | null),
    classifyIntent(body.question.trim()),
  ]);

  const systemPrompt = buildSystemPromptForIntent(classified.intent);
  const contextString = formatContextForPrompt(ctx);
  const userPrompt = `${contextString}\n\nFounder's question: ${body.question.trim()}`;

  // Use Opus for scenario modeling; Sonnet for everything else
  const callFn = classified.intent === 'scenario' ? callOpus : callSonnet;
  const maxTokens = classified.intent === 'scenario' ? 1024 : 512;

  try {
    const response = await callFn(systemPrompt, userPrompt, maxTokens);

    // Build data points for UI
    const dataPoints: Array<{ label: string; value: string }> = [];
    if (ctx.signal) dataPoints.push({ label: 'Signal', value: String(ctx.signal) });
    if (ctx.metrics.healthRatio !== null) dataPoints.push({ label: 'MRR Health', value: ctx.metrics.healthRatio.toFixed(2) });
    if (ctx.stressors.length > 0) dataPoints.push({ label: 'Stressors', value: `${ctx.stressors.length} active` });
    if (ctx.pendingDecisions.length > 0) dataPoints.push({ label: 'Decisions', value: `${ctx.pendingDecisions.length} pending` });

    return c.json({ answer: response.content.trim(), data_points: dataPoints });
  } catch (err) {
    console.error('[/api/ask] AI call failed:', err);
    return c.json({ error: 'Unable to answer right now. Try again shortly.' }, 503);
  }
});

// ─── POST /api/threads — Create a new conversation thread ────────────────────

apiAskRoutes.post('/api/threads', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as { product_id?: string; first_message?: string; message?: string };

  if (!body.product_id) return c.json({ error: 'product_id is required' }, 400);
  const firstMsg = (body.first_message ?? body.message ?? '').trim();
  if (!firstMsg) return c.json({ error: 'message is required' }, 400);

  const productResult = await getProductByOwner(body.product_id, founder.id);
  if (productResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const product = productResult.rows[0] as Record<string, unknown>;

  const [ctx, classified] = await Promise.all([
    buildConversationContext(body.product_id, product.name as string, product.market_category as string | null),
    classifyIntent(firstMsg),
  ]);

  // Generate thread title from first message
  const title = await generateThreadTitle(firstMsg);

  const threadId = nanoid();
  const contextSnapshot = {
    signal: ctx.signal,
    riskState: ctx.riskState,
    stressorCount: ctx.stressors.length,
    pendingDecisions: ctx.pendingDecisions.length,
    currentPrompt: ctx.currentPrompt,
    mrr_health_ratio: ctx.metrics.healthRatio,
  };

  await query(
    `INSERT INTO conversation_threads (id, product_id, founder_id, title, intent, context_snapshot, message_count, last_message_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`,
    [threadId, body.product_id, founder.id, title, classified.intent, JSON.stringify(contextSnapshot)],
  );

  // Process the first message
  const reply = await processMessage(
    threadId,
    body.product_id,
    founder.id,
    firstMsg,
    classified.intent,
    ctx,
    [],  // no history yet
  );

  // Return full thread object for mobile client
  return c.json({
    thread: {
      id: threadId,
      title,
      intent: classified.intent,
      message_count: 1,
      last_message_at: new Date().toISOString(),
    },
    reply,
  });
});

// ─── GET /api/threads — List threads for a product ───────────────────────────

apiAskRoutes.get('/api/threads', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.query('product_id');
  if (!productId) return c.json({ error: 'product_id is required' }, 400);

  const productResult = await getProductByOwner(productId, founder.id);
  if (productResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const threads = await query(
    `SELECT id, title, intent, message_count, last_message_at, pinned, created_at
     FROM conversation_threads
     WHERE product_id = ? AND founder_id = ? AND archived = FALSE
     ORDER BY pinned DESC, last_message_at DESC
     LIMIT 50`,
    [productId, founder.id],
  );

  return c.json({ threads: threads.rows });
});

// ─── GET /api/threads/:id — Get thread with messages ─────────────────────────

apiAskRoutes.get('/api/threads/:id', async (c) => {
  const founder = c.get('founder');
  const threadId = c.req.param('id');

  const threadResult = await query(
    `SELECT * FROM conversation_threads WHERE id = ? AND founder_id = ?`,
    [threadId, founder.id],
  );
  if (threadResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const messages = await query(
    `SELECT id, role, content, data_points, actions_taken, intent, created_at
     FROM conversation_messages WHERE thread_id = ? ORDER BY created_at ASC`,
    [threadId],
  );

  const thread = threadResult.rows[0] as Record<string, unknown>;
  return c.json({
    thread: {
      ...thread,
      context_snapshot: thread.context_snapshot ? JSON.parse(thread.context_snapshot as string) : null,
    },
    messages: messages.rows.map((m) => {
      const msg = m as Record<string, unknown>;
      return {
        ...msg,
        data_points: msg.data_points ? JSON.parse(msg.data_points as string) : null,
        actions_taken: msg.actions_taken ? JSON.parse(msg.actions_taken as string) : null,
      };
    }),
  });
});

// ─── POST /api/threads/:id/messages — Send a message ─────────────────────────

apiAskRoutes.post('/api/threads/:id/messages', async (c) => {
  const founder = c.get('founder');
  const threadId = c.req.param('id');
  const body = await c.req.json() as { message?: string };

  if (!body.message?.trim()) return c.json({ error: 'message is required' }, 400);

  // Verify thread ownership
  const threadResult = await query(
    `SELECT * FROM conversation_threads WHERE id = ? AND founder_id = ?`,
    [threadId, founder.id],
  );
  if (threadResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const thread = threadResult.rows[0] as Record<string, unknown>;

  // Get product
  const productResult = await getProductByOwner(thread.product_id as string, founder.id);
  if (productResult.rows.length === 0) return c.json({ error: 'Product not found' }, 404);
  const product = productResult.rows[0] as Record<string, unknown>;

  // Load conversation history (last 10 messages for context window management)
  const historyResult = await query(
    `SELECT role, content FROM conversation_messages
     WHERE thread_id = ? ORDER BY created_at ASC LIMIT 10`,
    [threadId],
  );
  const history = historyResult.rows as Array<{ role: 'user' | 'assistant'; content: string }>;

  const [ctx, classified] = await Promise.all([
    buildConversationContext(thread.product_id as string, product.name as string, product.market_category as string | null),
    classifyIntent(body.message.trim()),
  ]);

  const reply = await processMessage(
    threadId,
    thread.product_id as string,
    founder.id,
    body.message.trim(),
    classified.intent,
    ctx,
    history,
  );

  // Wrap in { reply } for mobile client compatibility
  return c.json({ reply });
});

// ─── DELETE /api/threads/:id — Archive a thread ──────────────────────────────

apiAskRoutes.delete('/api/threads/:id', async (c) => {
  const founder = c.get('founder');
  const threadId = c.req.param('id');

  await query(
    `UPDATE conversation_threads SET archived = TRUE WHERE id = ? AND founder_id = ?`,
    [threadId, founder.id],
  );
  return c.json({ ok: true });
});

// ─── POST /api/threads/:id/save — Save a message as insight ──────────────────

apiAskRoutes.post('/api/threads/:id/save', async (c) => {
  const founder = c.get('founder');
  const threadId = c.req.param('id');
  const body = await c.req.json() as { message_id?: string; title?: string; tags?: string[] };

  if (!body.message_id) return c.json({ error: 'message_id is required' }, 400);

  const threadResult = await query(
    `SELECT product_id FROM conversation_threads WHERE id = ? AND founder_id = ?`,
    [threadId, founder.id],
  );
  if (threadResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const productId = (threadResult.rows[0] as Record<string, string>).product_id;

  const msgResult = await query(
    `SELECT content FROM conversation_messages WHERE id = ? AND thread_id = ?`,
    [body.message_id, threadId],
  );
  if (msgResult.rows.length === 0) return c.json({ error: 'Message not found' }, 404);
  const content = (msgResult.rows[0] as Record<string, string>).content;

  const id = nanoid();
  await query(
    `INSERT INTO saved_insights (id, product_id, founder_id, message_id, title, content, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, productId, founder.id, body.message_id, body.title ?? 'Saved insight', content, JSON.stringify(body.tags ?? [])],
  );

  return c.json({ id, ok: true });
});

// ─── Core Message Processing ──────────────────────────────────────────────────

interface ProcessedReply {
  message_id: string;
  content: string;
  data_points: Array<{ label: string; value: string }>;
  actions_taken: Array<{ type: string; description: string; entity_id?: string }>;
  intent: ConversationIntent;
}

async function processMessage(
  threadId: string,
  productId: string,
  founderId: string,
  message: string,
  intent: ConversationIntent,
  ctx: Awaited<ReturnType<typeof buildConversationContext>>,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<ProcessedReply> {
  // 1. Save user message
  const userMsgId = nanoid();
  await query(
    `INSERT INTO conversation_messages (id, thread_id, role, content, intent)
     VALUES (?, ?, 'user', ?, ?)`,
    [userMsgId, threadId, message, intent],
  );

  // 2. Handle actionable intents
  const actionsTaken: Array<{ type: string; description: string; entity_id?: string }> = [];

  if (intent === 'action') {
    const classified = await classifyIntent(message);
    if (classified.actionable && classified.action_type) {
      const action = await executeAction(classified, productId, founderId);
      if (action) actionsTaken.push(action);
    }
  }

  // 3. Build messages array for multi-turn
  const systemPrompt = buildSystemPromptForIntent(intent);
  const contextString = formatContextForPrompt(ctx);

  // For multi-turn: inject context only once (first message) or compress it
  const isFirstMessage = history.length === 0;
  const fullSystem = isFirstMessage
    ? `${systemPrompt}\n\n${contextString}`
    : systemPrompt;

  // Build Anthropic-style messages array
  const anthropicMessages = [
    ...history.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user' as const, content: isFirstMessage ? message : `[Current context: Signal ${ctx.signal}/100, ${ctx.riskState.toUpperCase()}]\n\n${message}` },
  ];

  // 4. Call Claude
  const callFn = intent === 'scenario' ? callOpus : callSonnet;
  const maxTokens = intent === 'scenario' ? 1024 : 512;

  let content = 'I was unable to process that request. Please try again.';
  let modelUsed = '';
  let tokensUsed = 0;

  try {
    // Multi-turn call using the Anthropic SDK directly
    const { callClaudeMultiTurn } = await import('../../services/ai/client.js');
    const response = await callClaudeMultiTurn(fullSystem, anthropicMessages, maxTokens, intent === 'scenario');
    content = response.content.trim();
    modelUsed = response.model;
    tokensUsed = response.usage.output_tokens;
  } catch {
    // Fall back to single-turn
    try {
      const r = await callFn(fullSystem, message, maxTokens);
      content = r.content.trim();
      modelUsed = r.model;
      tokensUsed = r.usage.output_tokens;
    } catch (err) {
      console.error('[conversation] AI call failed:', err);
    }
  }

  // 5. Build data points
  const dataPoints: Array<{ label: string; value: string }> = [];
  if (ctx.signal) dataPoints.push({ label: 'Signal', value: String(ctx.signal) });
  if (ctx.metrics.healthRatio !== null) dataPoints.push({ label: 'Health Ratio', value: ctx.metrics.healthRatio.toFixed(2) });
  if (ctx.mrr) dataPoints.push({ label: 'MRR', value: `$${ctx.mrr.total.toLocaleString()}` });
  if (ctx.stressors.length > 0) dataPoints.push({ label: 'Active Stressors', value: String(ctx.stressors.length) });

  // 6. Save assistant message
  const assistantMsgId = nanoid();
  await query(
    `INSERT INTO conversation_messages
     (id, thread_id, role, content, data_points, actions_taken, intent, model_used, tokens_used)
     VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)`,
    [
      assistantMsgId, threadId, content,
      JSON.stringify(dataPoints),
      actionsTaken.length > 0 ? JSON.stringify(actionsTaken) : null,
      intent, modelUsed, tokensUsed,
    ],
  );

  // 7. Update thread metadata
  await query(
    `UPDATE conversation_threads
     SET message_count = message_count + 2, last_message_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [threadId],
  );

  return { message_id: assistantMsgId, content, data_points: dataPoints, actions_taken: actionsTaken, intent };
}

// ─── Action Executor ──────────────────────────────────────────────────────────

async function executeAction(
  classified: Awaited<ReturnType<typeof classifyIntent>>,
  productId: string,
  founderId: string,
): Promise<{ type: string; description: string; entity_id?: string } | null> {
  switch (classified.action_type) {
    case 'create_decision': {
      if (!classified.entities.decision_what) return null;
      const id = nanoid();
      await query(
        `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status)
         VALUES (?, ?, ?, 2, ?, 'Captured via Ask Foundry conversation.', 'pending')`,
        [id, productId, classified.entities.decision_category ?? 'strategic', classified.entities.decision_what],
      );
      return { type: 'create_decision', description: `Created decision: "${classified.entities.decision_what}"`, entity_id: id };
    }

    case 'resolve_stressor': {
      if (!classified.entities.stressor_name) return null;
      const result = await query(
        `SELECT id FROM stressor_history WHERE product_id = ? AND status = 'active'
         AND stressor_name LIKE ? LIMIT 1`,
        [productId, `%${classified.entities.stressor_name}%`],
      );
      if (result.rows.length === 0) return null;
      const stressorId = (result.rows[0] as Record<string, string>).id;
      await query(
        `UPDATE stressor_history SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [stressorId],
      );
      return { type: 'resolve_stressor', description: `Resolved stressor: "${classified.entities.stressor_name}"`, entity_id: stressorId };
    }

    case 'create_stressor': {
      if (!classified.entities.stressor_name) return null;
      const id = nanoid();
      await query(
        `INSERT INTO stressor_history
         (id, product_id, stressor_name, signal, timeframe_days, neutralizing_action, severity, status)
         VALUES (?, ?, ?, 'Captured via Ask Foundry.', 14, 'To be determined.', 'watch', 'active')`,
        [id, productId, classified.entities.stressor_name],
      );
      return { type: 'create_stressor', description: `Created stressor: "${classified.entities.stressor_name}"`, entity_id: id };
    }

    case 'update_metric': {
      if (!classified.entities.metric_name || classified.entities.metric_value === undefined) return null;
      // Route to the ingest service
      const today = new Date().toISOString().slice(0, 10);
      const col = classified.entities.metric_name.toLowerCase().replace(/\s+/g, '_');
      const allowedCols = ['activation_rate', 'churn_rate', 'day_30_retention', 'nps_score', 'signups_7d', 'active_users'];
      if (!allowedCols.includes(col)) return null;
      await query(
        `INSERT INTO metric_snapshots (id, product_id, snapshot_date, ${col})
         VALUES (?, ?, ?, ?)
         ON CONFLICT(product_id, snapshot_date) DO UPDATE SET ${col} = ?`,
        [nanoid(), productId, today, classified.entities.metric_value, classified.entities.metric_value],
      );
      return { type: 'update_metric', description: `Updated ${classified.entities.metric_name} to ${classified.entities.metric_value}` };
    }

    default:
      return null;
  }
}

// ─── Thread Title Generation ──────────────────────────────────────────────────

async function generateThreadTitle(firstMessage: string): Promise<string> {
  if (firstMessage.length <= 60) return firstMessage;
  try {
    const r = await callSonnet(
      'Generate a concise title (max 60 chars) for a business conversation starting with this message. Return only the title, no quotes.',
      firstMessage,
      64,
    );
    return r.content.trim().slice(0, 60);
  } catch {
    return firstMessage.slice(0, 60);
  }
}
