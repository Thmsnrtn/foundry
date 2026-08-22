// =============================================================================
// FOUNDRY — Conversational COO Interface
// Multi-turn chat with full product context. The founder talks to their business.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, callSonnet } from '../ai/client.js';
import { buildWisdomContext } from '../wisdom/dna.js';
import { getMRRDecomposition, computeHealthRatio } from '../intelligence/revenue.js';
import { getFounderHealthSummary } from '../intelligence/founder-health.js';
import { getStageConfig } from '../lifecycle/stage-detection.js';
import { buildFounderSystemPrompt } from '../ai/calibration.js';
import { nanoid } from 'nanoid';
import type { RiskStateValue, GrowthStage } from '../../types/index.js';

export interface ChatMessage {
  id: string;
  role: 'founder' | 'coo' | 'system';
  content: string;
  actions_proposed?: ActionProposal[];
  created_at: string;
}

export interface ActionProposal {
  type: string;
  description: string;
  draft_id?: string;
  requires_approval: boolean;
}

interface ConversationContext {
  productId: string;
  productName: string;
  riskState: RiskStateValue;
  growthStage: GrowthStage;
  wisdomContext: string;
  mrrSummary: string;
  stressorSummary: string;
  founderContext: string;
  recentHistory: ChatMessage[];
}

/**
 * Start a new chat session.
 */
export async function startSession(
  founderId: string,
  productId: string,
  title?: string
): Promise<string> {
  const sessionId = nanoid();
  await query(
    `INSERT INTO chat_sessions (id, founder_id, product_id, title) VALUES (?, ?, ?, ?)`,
    [sessionId, founderId, productId, title ?? 'New conversation']
  );
  return sessionId;
}

/**
 * Send a message and get a COO response.
 */
export async function sendMessage(
  sessionId: string,
  founderId: string,
  message: string
): Promise<ChatMessage> {
  // Validate session
  const session = await query(
    'SELECT * FROM chat_sessions WHERE id = ? AND founder_id = ?',
    [sessionId, founderId]
  );
  const s = session.rows[0] as Record<string, string> | undefined;
  if (!s) throw new Error('Session not found');

  const productId = s.product_id;

  // Persist founder message
  const founderMsgId = nanoid();
  await query(
    `INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, 'founder', ?)`,
    [founderMsgId, sessionId, message]
  );

  // Build full context
  const context = await buildConversationContext(productId, sessionId, founderId);

  // Build system prompt with AI calibration
  const baseSystemPrompt = buildCOOSystemPrompt(context);
  let systemPrompt: string;
  try {
    systemPrompt = await buildFounderSystemPrompt(founderId, baseSystemPrompt);
  } catch {
    systemPrompt = baseSystemPrompt;
  }

  // Build conversation history
  const historyPrompt = context.recentHistory.map((m) =>
    `${m.role === 'founder' ? 'Founder' : 'COO'}: ${m.content}`
  ).join('\n\n');

  const userPrompt = historyPrompt
    ? `${historyPrompt}\n\nFounder: ${message}`
    : `Founder: ${message}`;

  // Use Opus for strategic questions, Sonnet for operational
  const isStrategic = /strategy|should i|what if|pricing|expand|pivot|raise|compete/i.test(message);
  const model = isStrategic ? callOpus : callSonnet;
  const maxTokens = isStrategic ? 4096 : 2048;

  const response = await model(systemPrompt, userPrompt, maxTokens, productId);

  // Parse any action proposals from the response
  const actions = extractActionProposals(response.content);

  // Persist COO response
  const cooMsgId = nanoid();
  await query(
    `INSERT INTO chat_messages (id, session_id, role, content, context_used, actions_proposed, tokens_in, tokens_out)
     VALUES (?, ?, 'coo', ?, ?, ?, ?, ?)`,
    [
      cooMsgId, sessionId, response.content,
      JSON.stringify({ risk_state: context.riskState, growth_stage: context.growthStage }),
      actions.length > 0 ? JSON.stringify(actions) : null,
      response.usage.input_tokens, response.usage.output_tokens,
    ]
  );

  // Update session
  await query(
    `UPDATE chat_sessions SET last_message_at = datetime('now'), message_count = message_count + 2 WHERE id = ?`,
    [sessionId]
  );

  return {
    id: cooMsgId,
    role: 'coo',
    content: response.content,
    actions_proposed: actions.length > 0 ? actions : undefined,
    created_at: new Date().toISOString(),
  };
}

/**
 * Get conversation history for a session.
 */
export async function getSessionHistory(
  sessionId: string,
  founderId: string,
  limit: number = 50
): Promise<ChatMessage[]> {
  const result = await query(
    `SELECT * FROM chat_messages WHERE session_id = ?
     AND session_id IN (SELECT id FROM chat_sessions WHERE founder_id = ?)
     ORDER BY created_at ASC LIMIT ?`,
    [sessionId, founderId, limit]
  );

  return (result.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    role: row.role as 'founder' | 'coo' | 'system',
    content: row.content as string,
    actions_proposed: row.actions_proposed ? JSON.parse(row.actions_proposed as string) : undefined,
    created_at: row.created_at as string,
  }));
}

/**
 * List sessions for a founder.
 */
export async function listSessions(founderId: string): Promise<Array<{
  id: string;
  product_id: string;
  title: string;
  message_count: number;
  last_message_at: string;
}>> {
  const result = await query(
    `SELECT * FROM chat_sessions WHERE founder_id = ? AND status = 'active' ORDER BY last_message_at DESC LIMIT 20`,
    [founderId]
  );
  return result.rows as any;
}

/**
 * Proactively send a COO message (triggered by events, not founder input).
 */
export async function sendProactiveMessage(
  founderId: string,
  productId: string,
  message: string,
): Promise<void> {
  // Find or create a session
  let sessionResult = await query(
    `SELECT id FROM chat_sessions WHERE founder_id = ? AND product_id = ? AND status = 'active' ORDER BY last_message_at DESC LIMIT 1`,
    [founderId, productId]
  );

  let sessionId: string;
  if (sessionResult.rows.length > 0) {
    sessionId = (sessionResult.rows[0] as Record<string, string>).id;
  } else {
    sessionId = await startSession(founderId, productId, 'Foundry COO');
  }

  await query(
    `INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, 'coo', ?)`,
    [nanoid(), sessionId, message]
  );

  // WEBHOOK DELIVERY REMOVED. This read `chat_webhooks` for a founder-configured
  // destination and posted the COO's message to it. Nothing anywhere wrote a row
  // into that table — there was no settings page, no API, no onboarding step —
  // so the branch never once fired. The consuming half shipped and the
  // producing half never did, which reads as a delivery channel and behaves as
  // an absence. The message is still recorded in `chat_messages`, which is where
  // the founder actually reads it.

}

// ─── Internal Helpers ───────────────────────────────────────────────────────

async function buildConversationContext(
  productId: string,
  sessionId: string,
  founderId: string
): Promise<ConversationContext> {
  const [product, ls, wisdom, mrr, stressors, health, history] = await Promise.all([
    query('SELECT * FROM products WHERE id = ?', [productId]),
    query('SELECT * FROM lifecycle_state WHERE product_id = ?', [productId]),
    buildWisdomContext(productId),
    getMRRDecomposition(productId),
    query(`SELECT stressor_name, severity, signal FROM stressor_history WHERE product_id = ? AND status = 'active' ORDER BY severity LIMIT 5`, [productId]),
    getFounderHealthSummary(founderId),
    query(`SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 10`, [sessionId]),
  ]);

  const p = product.rows[0] as Record<string, string> | undefined;
  const l = ls.rows[0] as Record<string, unknown> | undefined;
  const riskState = (l?.risk_state as RiskStateValue) ?? 'green';
  const growthStage = (p?.growth_stage as GrowthStage) ?? 'growth';

  const mrrSummary = mrr
    ? `MRR: ${mrr.level_cents === null ? 'not reported' : `$${(mrr.level_cents / 100).toFixed(0)}/mo`}`
      + `, net new this period: $${(mrr.net_new_cents / 100).toFixed(0)}`
      + `, health ratio: ${mrr.health_ratio?.toFixed(2) ?? 'unknown — no new MRR to divide by'}`
    : 'No MRR data yet.';

  const stressorSummary = stressors.rows.length > 0
    ? (stressors.rows as unknown as Array<Record<string, string>>).map((s) => `[${s.severity}] ${s.stressor_name}`).join('; ')
    : 'No active stressors.';

  const founderContext = health
    ? `Motivation: ${health.motivation_score ?? 'N/A'}/100, Engagement: ${health.engagement_trend}, Runway: ${health.personal_runway_months ?? 'unknown'} months`
    : '';

  const recentHistory = (history.rows as unknown as Array<Record<string, string>>).reverse().map((m) => ({
    id: '',
    role: m.role as 'founder' | 'coo',
    content: m.content,
    created_at: '',
  }));

  return {
    productId,
    productName: p?.name ?? 'your product',
    riskState,
    growthStage,
    wisdomContext: wisdom.dna_context,
    mrrSummary,
    stressorSummary,
    founderContext,
    recentHistory,
  };
}

function buildCOOSystemPrompt(ctx: ConversationContext): string {
  const stageConfig = getStageConfig(ctx.growthStage);
  return `You are Foundry COO — an autonomous Chief Operating Officer for ${ctx.productName}.

CURRENT STATE:
- Risk state: ${ctx.riskState}
- Growth stage: ${ctx.growthStage}
- Stage focus: ${stageConfig.digestFocus}
- ${ctx.mrrSummary}
- Stressors: ${ctx.stressorSummary}
${ctx.founderContext ? `- Founder: ${ctx.founderContext}` : ''}

${ctx.wisdomContext}

BEHAVIOR RULES:
1. You are a COO, not an assistant. Be direct and opinionated. Lead with the answer.
2. When the founder asks "should I...?", give a clear recommendation with reasoning, not a list of pros/cons.
3. When you identify an action to take, propose it concretely: "I'll draft [X] for your approval."
4. Reference real data. Don't hedge with "it depends" when you have the data to decide.
5. Keep responses concise. 2-4 paragraphs max for most questions. No preamble.
6. If the founder is stressed or burned out, be supportive but don't lose directness.
7. When proposing actions, tag them with [ACTION: description] so they can be extracted.
8. You can suggest things to STOP doing, not just things to start.

You have full context on this product's metrics, stressors, competitors, and history.
Answer as if you've been in the room for every meeting.`;
}

function extractActionProposals(content: string): ActionProposal[] {
  const actionPattern = /\[ACTION:\s*(.+?)\]/g;
  const actions: ActionProposal[] = [];
  let match;
  while ((match = actionPattern.exec(content)) !== null) {
    actions.push({
      type: 'proposed',
      description: match[1]!,
      requires_approval: true,
    });
  }
  return actions;
}
