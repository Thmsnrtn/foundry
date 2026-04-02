// =============================================================================
// FOUNDRY — Onboarding Chat Service
// Conversational setup that gets a founder to their first AI briefing.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { callClaudeMultiTurn } from '../../ai/client.js';
import { upsertProductDNA } from '../../wisdom/dna.js';
import { generateDailyBriefing } from '../briefing.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OnboardingMessage {
  role: 'assistant' | 'founder';
  content: string;
  timestamp: string;
}

export interface ExtractedContext {
  company_name?: string;
  problem?: string;
  solution?: string;
  target_customer?: string;
  revenue_model?: string;
  current_mrr_estimate?: number; // cents
  team_size?: number;
  biggest_challenge?: string;
  stage?: string; // 'idea' | 'building' | 'launched' | 'growing'
  north_star_metric?: string;
}

// ─── System Prompt ────────────────────────────────────────────────────────────

const ONBOARDING_SYSTEM_PROMPT = `You are the Foundry setup assistant. Your job is to understand a founder's business in a warm, friendly 5-7 message conversation, then set up their AI agent team.

Ask one question at a time. Start by asking what they're building and why.
After learning: what they build, who it's for, what stage they're at, and their biggest current challenge — you have enough to proceed.

At the end of EACH response, include a JSON block on its own line:
CONTEXT_JSON: {"company_name": "...", "problem": "...", "solution": "...", "target_customer": "...", "stage": "...", "biggest_challenge": "...", "revenue_model": "...", "north_star_metric": "..."}

Only include fields you've learned. Leave unknown fields out of the JSON.
When you have enough context (problem + solution + target_customer + stage all filled), end your message with READY_TO_BRIEF: true`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseSessionRow(row: Record<string, unknown>): {
  id: string;
  status: string;
  messages: OnboardingMessage[];
  extractedContext: ExtractedContext;
  firstBriefingGenerated: boolean;
} {
  let messages: OnboardingMessage[] = [];
  let extractedContext: ExtractedContext = {};

  try {
    messages = JSON.parse(row.messages_json as string) as OnboardingMessage[];
  } catch {
    messages = [];
  }

  try {
    extractedContext = JSON.parse(row.extracted_context_json as string) as ExtractedContext;
  } catch {
    extractedContext = {};
  }

  return {
    id: row.id as string,
    status: row.status as string,
    messages,
    extractedContext,
    firstBriefingGenerated: (row.first_briefing_generated as number) === 1,
  };
}

function parseContextJSON(content: string): ExtractedContext {
  const marker = 'CONTEXT_JSON:';
  const idx = content.lastIndexOf(marker);
  if (idx === -1) return {};

  try {
    // Extract everything after the marker on that line
    const after = content.slice(idx + marker.length).trim();
    const endOfLine = after.indexOf('\n');
    const jsonStr = endOfLine === -1 ? after : after.slice(0, endOfLine);
    return JSON.parse(jsonStr.trim()) as ExtractedContext;
  } catch {
    return {};
  }
}

function stripMetaLines(content: string): string {
  // Remove the CONTEXT_JSON line and READY_TO_BRIEF line from the visible reply
  return content
    .split('\n')
    .filter((line) => !line.trim().startsWith('CONTEXT_JSON:') && !line.trim().startsWith('READY_TO_BRIEF:'))
    .join('\n')
    .trim();
}

function isReadyToBrief(content: string): boolean {
  return content.includes('READY_TO_BRIEF: true');
}

function hasMinimumContext(ctx: ExtractedContext): boolean {
  return !!(ctx.problem && ctx.solution && ctx.target_customer && ctx.stage);
}

function mergeContext(existing: ExtractedContext, incoming: ExtractedContext): ExtractedContext {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined && value !== null && value !== '') {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

// Count how many of the 5 key questions have been answered
export function countAnsweredQuestions(ctx: ExtractedContext): number {
  const fields: Array<keyof ExtractedContext> = [
    'solution', 'target_customer', 'stage', 'biggest_challenge', 'revenue_model',
  ];
  return fields.filter((f) => !!ctx[f]).length;
}

// ─── getOrCreateSession ───────────────────────────────────────────────────────

export async function getOrCreateSession(
  productId: string,
  founderId: string,
): Promise<{
  id: string;
  status: string;
  messages: OnboardingMessage[];
  extractedContext: ExtractedContext;
  firstBriefingGenerated: boolean;
}> {
  const existing = await query(
    'SELECT * FROM onboarding_sessions WHERE product_id = ?',
    [productId],
  );

  if (existing.rows.length > 0) {
    return parseSessionRow(existing.rows[0] as Record<string, unknown>);
  }

  // Create a new session with the assistant's opening message
  const sessionId = nanoid();
  const openingMessage: OnboardingMessage = {
    role: 'assistant',
    content: "Hey! Welcome to Foundry. I'm here to help set up your AI agent team — it only takes a few minutes.\n\nTo get started: what are you building, and what problem does it solve?",
    timestamp: new Date().toISOString(),
  };

  const messages: OnboardingMessage[] = [openingMessage];

  await query(
    `INSERT INTO onboarding_sessions
       (id, product_id, founder_id, status, messages_json, extracted_context_json,
        dna_fields_populated, first_briefing_generated)
     VALUES (?, ?, ?, 'in_progress', ?, '{}', '[]', 0)`,
    [sessionId, productId, founderId, JSON.stringify(messages)],
  );

  return {
    id: sessionId,
    status: 'in_progress',
    messages,
    extractedContext: {},
    firstBriefingGenerated: false,
  };
}

// ─── sendOnboardingMessage ────────────────────────────────────────────────────

export async function sendOnboardingMessage(
  sessionId: string,
  founderMessage: string,
): Promise<{
  assistantReply: string;
  extractedContext: ExtractedContext;
  isComplete: boolean;
  nextAction: 'continue_chat' | 'generate_briefing' | 'complete';
}> {
  // 1. Load session + message history
  const result = await query(
    'SELECT * FROM onboarding_sessions WHERE id = ?',
    [sessionId],
  );
  if (result.rows.length === 0) throw new Error(`Session ${sessionId} not found`);

  const session = parseSessionRow(result.rows[0] as Record<string, unknown>);
  const messages = session.messages;

  // 2. Add founder message to history
  const founderMsg: OnboardingMessage = {
    role: 'founder',
    content: founderMessage,
    timestamp: new Date().toISOString(),
  };
  messages.push(founderMsg);

  // 3. Build Anthropic-style messages array (assistant=assistant, founder=user)
  const anthropicMessages = messages.map((m) => ({
    role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: m.content,
  }));

  // 4. Call Claude with the full history and extraction system prompt
  let rawReply = '';
  try {
    const response = await callClaudeMultiTurn(
      ONBOARDING_SYSTEM_PROMPT,
      anthropicMessages,
      512,
      false,
    );
    rawReply = response.content.trim();
  } catch (err) {
    console.error('[onboarding/chat] AI call failed:', err);
    rawReply = "Sorry, I had trouble connecting. Could you try again?";
  }

  // 5. Parse Claude's response for: reply text + extracted fields
  const incomingContext = parseContextJSON(rawReply);
  const visibleReply = stripMetaLines(rawReply);
  const ready = isReadyToBrief(rawReply);

  // 6. Merge extracted fields into session's extractedContext
  const updatedContext = mergeContext(session.extractedContext, incomingContext);

  // 7. Determine if enough context exists to generate briefing
  const canBrief = ready || hasMinimumContext(updatedContext);

  // 8. Add assistant reply to history
  const assistantMsg: OnboardingMessage = {
    role: 'assistant',
    content: visibleReply,
    timestamp: new Date().toISOString(),
  };
  messages.push(assistantMsg);

  // 9. Save updated session
  const now = new Date().toISOString();
  await query(
    `UPDATE onboarding_sessions
     SET messages_json = ?, extracted_context_json = ?, updated_at = ?
     WHERE id = ?`,
    [JSON.stringify(messages), JSON.stringify(updatedContext), now, sessionId],
  );

  const nextAction: 'continue_chat' | 'generate_briefing' | 'complete' = canBrief
    ? 'generate_briefing'
    : 'continue_chat';

  return {
    assistantReply: visibleReply,
    extractedContext: updatedContext,
    isComplete: canBrief,
    nextAction,
  };
}

// ─── generateFirstBriefingFromContext ─────────────────────────────────────────

export async function generateFirstBriefingFromContext(sessionId: string): Promise<string> {
  // 1. Load session extractedContext
  const result = await query(
    'SELECT * FROM onboarding_sessions WHERE id = ?',
    [sessionId],
  );
  if (result.rows.length === 0) throw new Error(`Session ${sessionId} not found`);

  const session = parseSessionRow(result.rows[0] as Record<string, unknown>);
  const ctx = session.extractedContext;
  const row = result.rows[0] as Record<string, unknown>;
  const productId = row.product_id as string;
  const founderId = row.founder_id as string;

  // 2. Populate product DNA fields from extractedContext via upsertProductDNA
  const dnaUpdates: Record<string, unknown> = {};
  const dnaFieldsPopulated: string[] = [];

  if (ctx.target_customer) {
    dnaUpdates.icp_description = ctx.target_customer;
    dnaFieldsPopulated.push('icp_description');
  }
  if (ctx.problem) {
    dnaUpdates.icp_pain = ctx.problem;
    dnaFieldsPopulated.push('icp_pain');
  }
  if (ctx.solution && ctx.target_customer) {
    dnaUpdates.positioning_statement = `${ctx.solution} for ${ctx.target_customer}`;
    dnaFieldsPopulated.push('positioning_statement');
  }
  if (ctx.biggest_challenge) {
    dnaUpdates.retention_hypothesis = ctx.biggest_challenge;
    dnaFieldsPopulated.push('retention_hypothesis');
  }
  if (ctx.north_star_metric) {
    dnaUpdates.market_insight = ctx.north_star_metric;
    dnaFieldsPopulated.push('market_insight');
  }

  if (Object.keys(dnaUpdates).length > 0) {
    await upsertProductDNA(productId, founderId, dnaUpdates);
  }

  // 3. Update product name if we have company name
  if (ctx.company_name) {
    await query(
      `UPDATE products SET name = ?, updated_at = datetime('now') WHERE id = ?`,
      [ctx.company_name, productId],
    );
  }

  // 4. Create a synthetic metric_snapshot with estimated values from context
  const today = new Date().toISOString().slice(0, 10);
  const mrrCents = ctx.current_mrr_estimate ?? 0;
  const snapshotId = nanoid();

  await query(
    `INSERT OR IGNORE INTO metric_snapshots
       (id, product_id, snapshot_date, mrr_cents, active_users)
     VALUES (?, ?, ?, ?, ?)`,
    [snapshotId, productId, today, mrrCents, ctx.team_size ?? 1],
  );

  // 5. Trigger first briefing generation
  const briefing = await generateDailyBriefing(productId);

  // 6. Mark session as completed, first_briefing_generated=1
  await query(
    `UPDATE onboarding_sessions
     SET status = 'completed', first_briefing_generated = 1,
         dna_fields_populated = ?, completed_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
    [JSON.stringify(dnaFieldsPopulated), sessionId],
  );

  // Return the briefing date path
  return `/agents/briefings/${briefing.briefing_date}`;
}

// ─── skipOnboarding ───────────────────────────────────────────────────────────

export async function skipOnboarding(sessionId: string): Promise<void> {
  await query(
    `UPDATE onboarding_sessions
     SET status = 'skipped', updated_at = datetime('now')
     WHERE id = ?`,
    [sessionId],
  );
}
