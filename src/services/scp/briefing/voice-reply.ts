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
}

export interface VoiceReplyResult {
  transcript: string;
  action_type: VoiceActionType;
  routed_to: string;
}

// ─── Transcription ────────────────────────────────────────────────────────────

/**
 * Calls OpenAI Whisper to transcribe base64-encoded audio.
 * Requires OPENAI_API_KEY.
 */
export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY is required for voice transcription');
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

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Whisper API error ${response.status}: ${body}`);
  }

  const text = await response.text();
  return text.trim();
}

// ─── Intent Classification ────────────────────────────────────────────────────

interface IntentResult {
  action_type: VoiceActionType;
  summary: string;
}

async function classifyIntent(transcript: string, context: string): Promise<IntentResult> {
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
    const aiResponse = await callSonnet(systemPrompt, userPrompt, 256);
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

async function routeApproval(
  productId: string,
  transcript: string,
  context: string,
): Promise<string> {
  // Look for a pending action_execution referencing this context
  try {
    const pending = await query(
      `SELECT id FROM action_executions
       WHERE product_id = ? AND status = 'pending_approval'
       ORDER BY created_at DESC LIMIT 1`,
      [productId],
    );

    if (pending.rows.length > 0) {
      const execId = (pending.rows[0] as Record<string, unknown>).id as string;
      await query(
        `UPDATE action_executions
         SET status = 'approved', approved_at = datetime('now'), approval_note = ?
         WHERE id = ?`,
        [transcript, execId],
      );
      return `action_executions:${execId}`;
    }
  } catch {
    // action_executions table may not exist or have different schema
  }

  // Fall back to storing as a note
  return routeNote(productId, transcript, context, 'approval');
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
  try {
    // Use company_memory if available, otherwise fall back to decisions table
    await query(
      `INSERT INTO company_memory (id, product_id, category, content, source, created_at)
       VALUES (?, ?, 'founder_note', ?, 'voice_reply', datetime('now'))`,
      [id, productId, `[${label}] Context: ${context}\n\n${transcript}`],
    );
    return `company_memory:${id}`;
  } catch {
    // company_memory table may not exist — try decisions as fallback
    try {
      await query(
        `INSERT INTO decisions (id, product_id, what, why_now, category, gate, status)
         VALUES (?, ?, ?, ?, 'operational', 0, 'pending')`,
        [id, productId, `[Voice ${label}] ${transcript.slice(0, 200)}`, `Context: ${context}`],
      );
      return `decisions:${id}`;
    } catch {
      return `unrouted:${id}`;
    }
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
  const transcript = await transcribeAudio(data.audio_base64, data.mime_type);

  // 2. Classify intent
  const intent = await classifyIntent(transcript, data.context);

  // 3. Route based on intent
  let routedTo: string;

  switch (intent.action_type) {
    case 'decision':
      routedTo = await routeDecision(productId, transcript, data.context, data.briefing_date);
      break;
    case 'approval':
      routedTo = await routeApproval(productId, transcript, data.context);
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
