// =============================================================================
// FOUNDRY — Voice Reply Processor
// Transcribes a founder's 30-second voice note and routes it to the
// appropriate system: decision log, note memory, or approval flow.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { createDecision } from '../decision-log.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type VoiceActionType = 'decision' | 'question' | 'note' | 'approval';

export interface VoiceReplyInput {
  audio_base64: string;
  mime_type: 'audio/webm' | 'audio/mp4' | 'audio/wav' | string;
  context: string; // what briefing item this is replying to
  briefing_date: string;
  /** WHICH action the founder is approving.
   *
   * Approval used to bind to nothing: `routeApproval` took the most recently
   * created pending `action_execution` for the product and approved that one,
   * whatever the founder had actually been replying to. `context` — "what
   * briefing item this is replying to" — was never read, is caller-supplied
   * free text, and defaults to the empty string, so there was no way to tell
   * which action was meant and nothing tried.
   *
   * A voice approval is an authority decision about ONE outward effect. If the
   * caller cannot name it, no approval happens. */
  action_execution_id?: string;
}

export interface VoiceReplyResult {
  transcript: string;
  action_type: VoiceActionType;
  routed_to: string;
}

// ─── Transcription ────────────────────────────────────────────────────────────

// Transcription is a paid provider call, and it was the only one in the
// codebase that spent money without reserving it first.
//
// Every model call goes through `services/ai/client.ts`, which atomically
// reserves a conservative maximum against the global, product and founder
// ceilings before dispatch, settles the actual usage afterwards, and releases
// only on a definitive failure. This function POSTed straight to the provider
// with the API key and none of that — so a caller holding a valid API key could
// drive unbounded transcription cost that the daily ceiling never saw.
//
// It was also invisible to the consequential-effects audit: that detector
// matches a quoted literal URL, and this call builds its URL from a template,
// so the inventory reported zero direct effects while this one existed.
//
// COST BOUND. Whisper is billed per minute of audio and the response carries
// no duration, so there is nothing to settle against. The reservation is
// derived from the payload size — an upper bound on how much audio can be in
// it — and settled at that same conservative figure. Recording the bound is
// honest; releasing it as if the call were free would not be.
const WHISPER_CENTS_PER_MINUTE = 0.6;
// Compressed speech runs well under 1 MB/minute; 250 KB is a deliberately
// pessimistic floor, so the estimate over-counts rather than under-counts.
const BYTES_PER_MINUTE_FLOOR = 250_000;

function transcriptionBoundCents(audioBase64: string): number {
  const bytes = Math.ceil((audioBase64.length * 3) / 4);
  const minutes = Math.max(1, Math.ceil(bytes / BYTES_PER_MINUTE_FLOOR));
  return Math.max(1, Math.ceil(minutes * WHISPER_CENTS_PER_MINUTE));
}

/**
 * Calls OpenAI Whisper to transcribe base64-encoded audio.
 * Requires OPENAI_API_KEY, and spends against the same ceilings every other
 * provider call does.
 */
export async function transcribeAudio(
  audioBase64: string, mimeType: string,
  attribution: { productId?: string; founderId?: string } = {},
): Promise<string> {
  // Use OpenRouter key (preferred) or fall back to direct OpenAI key
  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY (or OPENAI_API_KEY) is required for voice transcription');
  }

  // Determine file extension from mime type
  const extMap: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/mp4': 'mp4',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
  };
  const ext = extMap[mimeType] ?? 'webm';

  // Decode base64 to Buffer
  const audioBuffer = Buffer.from(audioBase64, 'base64');

  // Build FormData for Whisper API
  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: mimeType });
  formData.append('file', blob, `audio.${ext}`);
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'text');

  // OpenRouter supports the same /audio/transcriptions endpoint
  const baseUrl = process.env.OPENROUTER_API_KEY
    ? 'https://openrouter.ai/api/v1'
    : 'https://api.openai.com/v1';

  // Reserved BEFORE dispatch. A ceiling checked afterwards is a report, not a
  // ceiling.
  const { reserveSpend, finishReservation } = await import('../../ai/spend-ledger.js');
  const boundCents = transcriptionBoundCents(audioBase64);
  const reservation = await reserveSpend({
    productId: attribution.productId, founderId: attribution.founderId,
    model: 'whisper-1', amountCents: boundCents,
    caps: {
      global: parseInt(process.env.AI_DAILY_COST_CEILING_GLOBAL_CENTS ?? '50000', 10),
      product: parseInt(process.env.AI_DAILY_COST_CEILING_CENTS ?? '2500', 10),
      founder: parseInt(process.env.AI_DAILY_COST_CEILING_FOUNDER_CENTS ?? '10000', 10),
    },
  });

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });
  } catch (error) {
    // The provider may or may not have processed it. Ambiguous is the honest
    // state; it counts at the full authorized amount when it expires, and is
    // never released as if nothing happened.
    await finishReservation(reservation, { kind: 'ambiguous' });
    throw error;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // A refused request is a definitive non-event, so the reservation goes back.
    await finishReservation(reservation, { kind: 'released' });
    throw new Error(`Whisper API error ${response.status}: ${body}`);
  }

  const text = await response.text();
  // Settled at the bound, not at zero. The response carries no duration, so the
  // conservative estimate IS what we know, and pretending otherwise would make
  // the ledger read as cheaper than reality.
  await finishReservation(reservation, { kind: 'settled', actualCents: boundCents });
  return text.trim();
}

// ─── Intent Classification ────────────────────────────────────────────────────

interface IntentResult {
  action_type: VoiceActionType;
  summary: string;
}

async function classifyIntent(transcript: string, context: string, productId: string): Promise<IntentResult> {
  const systemPrompt = `You classify founder voice notes into one of four action types:
- "decision": Founder is making or recording a strategic decision ("I've decided to...", "We're going to...", "My call is...")
- "approval": Founder is approving a proposed action ("Yes, do it", "Approved", "Go ahead with...")
- "question": Founder is asking a question for follow-up ("Can you check...", "What is...", "Why did...")
- "note": General thought, observation, or context ("I noticed...", "Remember to...", "FYI...")

Return ONLY valid JSON.`;

  const userPrompt = `Context (briefing item being replied to): ${context}

Transcript: "${transcript}"

Classify this voice note. Return ONLY valid JSON:
{
  "action_type": "decision" | "approval" | "question" | "note",
  "summary": "One sentence summary of what the founder said"
}`;

  try {
    const aiResponse = await callSonnet(systemPrompt, userPrompt, 256, productId);
    const parsed = parseJSONResponse<IntentResult>(aiResponse.content);
    if (['decision', 'approval', 'question', 'note'].includes(parsed.action_type)) {
      return parsed;
    }
  } catch {
    // fall through to default
  }

  return { action_type: 'note', summary: transcript.slice(0, 100) };
}

// ─── Routing ──────────────────────────────────────────────────────────────────

async function routeDecision(
  productId: string,
  transcript: string,
  context: string,
  _briefingDate: string,
): Promise<string> {
  const id = await createDecision(productId, {
    decision_title: transcript.slice(0, 100),
    decision_description: transcript,
    decision_rationale: `Voice note reply to: ${context}`,
    decision_category: 'other',
    made_by: 'founder',
    agent_context: { source: 'voice_reply', context },
  });
  return `strategic_decisions_log:${id}`;
}

/**
 * Approve the action the founder named — and only that one.
 *
 * THE OLD BEHAVIOUR, in two layers.
 *
 * It selected the most recently created pending `action_execution` for the
 * product and approved that one, ignoring `context` entirely — so a founder
 * saying "yes, go ahead" in reply to briefing item A would have approved
 * whichever action happened to be newest, which is not necessarily A.
 *
 * Except it never approved anything at all, because it looked for
 * `status = 'pending_approval'` and `action_executions.status` permits
 * pending / approved / executing / completed / failed / cancelled. That
 * spelling belongs to `outbound_actions`, a different table. The query matched
 * no rows, ever, and fell through to filing the founder's approval as a note —
 * silently, because the fall-through is also what happens when there is
 * genuinely nothing to approve.
 *
 * So the feature has never worked, and the first time it did work it would
 * have approved the wrong thing. Both halves are fixed here: the status is the
 * one the table has, and the action is the one the founder named.
 *
 * An approval is authority over ONE effect. Binding it to "the latest" is not
 * a loose match; it is a different decision.
 */
async function routeApproval(
  productId: string,
  transcript: string,
  context: string,
  actionExecutionId?: string,
): Promise<string> {
  if (!actionExecutionId) {
    // Nothing to bind to. Recorded so the founder's words are not lost, and
    // explicitly not an approval.
    return routeNote(productId, transcript, context, 'approval_unbound');
  }

  // Scoped to the product AND to the pending state: a caller may not approve
  // another company's action, nor re-approve one already decided.
  const res = await query(
    `UPDATE action_executions
        SET status = 'approved', approved_at = datetime('now'),
            approved_by = 'voice:founder', approval_note = ?
      WHERE id = ? AND product_id = ? AND status = 'pending'`,
    [transcript, actionExecutionId, productId],
  );
  if ((res.rowsAffected ?? 0) === 0) {
    // The id names nothing pending for this company. Refused, and said so,
    // rather than falling through to approving something else.
    return routeNote(productId, transcript, context, 'approval_unmatched');
  }
  return `action_executions:${actionExecutionId}`;
}

async function routeQuestion(
  productId: string,
  transcript: string,
  context: string,
): Promise<string> {
  const id = nanoid();
  try {
    await query(
      `INSERT INTO decisions (id, product_id, what, why_now, category, gate, status)
       VALUES (?, ?, ?, ?, 'strategic', 0, 'pending')`,
      [id, productId, `[Voice Question] ${transcript.slice(0, 200)}`, `Context: ${context}`],
    );
    return `decisions:${id}`;
  } catch {
    return routeNote(productId, transcript, context, 'question');
  }
}

async function routeNote(
  productId: string,
  transcript: string,
  context: string,
  label = 'note',
): Promise<string> {
  const id = nanoid();
  // A note lands in the decisions ledger as informational (a valid category
  // under the decisions CHECK) at gate 0 — visible in the inbox, never urgent.
  try {
    await query(
      `INSERT INTO decisions (id, product_id, what, why_now, category, gate, status)
       VALUES (?, ?, ?, ?, 'informational', 0, 'pending')`,
      [id, productId, `[Voice ${label}] ${transcript.slice(0, 200)}`, `Context: ${context}`],
    );
    return `decisions:${id}`;
  } catch {
    return `unrouted:${id}`;
  }
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Transcribes a base64-encoded voice note and routes it into the appropriate
 * system based on intent classification.
 */
export async function processVoiceReply(
  productId: string,
  data: VoiceReplyInput,
): Promise<VoiceReplyResult> {
  // 1. Transcribe
  // Attributed, so the spend lands against this company's ceiling rather than
  // only the global one.
  const transcript = await transcribeAudio(data.audio_base64, data.mime_type, { productId });

  // 2. Classify intent
  const intent = await classifyIntent(transcript, data.context, productId);

  // 3. Route based on intent
  let routedTo: string;

  switch (intent.action_type) {
    case 'decision':
      routedTo = await routeDecision(productId, transcript, data.context, data.briefing_date);
      break;
    case 'approval':
      routedTo = await routeApproval(productId, transcript, data.context, data.action_execution_id);
      break;
    case 'question':
      routedTo = await routeQuestion(productId, transcript, data.context);
      break;
    default:
      routedTo = await routeNote(productId, transcript, data.context);
  }

  return {
    transcript,
    action_type: intent.action_type,
    routed_to: routedTo,
  };
}

/** Exposed for tests only. The reachable path runs through `processVoiceReply`,
 * whose first step is a paid transcription call; testing the binding through a
 * fake audio pipeline would prove less than testing the binding. */
export const __routeApprovalForTest = routeApproval;
