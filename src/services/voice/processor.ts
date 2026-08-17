// =============================================================================
// FOUNDRY — Voice-First COO
// Transcription, voice-to-decision pipeline, async voice memos.
// =============================================================================

import { query } from '../../db/client.js';
import { callSonnet, callOpus, parseJSONResponse } from '../ai/client.js';
import { sendMessage, startSession } from '../chat/coo.js';
import { nanoid } from 'nanoid';

/**
 * Process a voice memo: transcribe, extract actions, create decisions, respond.
 */
export async function processVoiceMemo(
  founderId: string,
  productId: string,
  audioUrl: string,
  transcript: string, // Pre-transcribed via Whisper/Deepgram on the client
  durationSeconds: number
): Promise<{
  id: string;
  action_items: string[];
  decisions_created: string[];
  coo_response: string;
}> {
  const id = nanoid();

  // Use Claude to extract structure from the transcript
  const prompt = `A founder just recorded a voice memo. Extract the key content.

Transcript:
${transcript}

Return JSON:
{
  "summary": "2-3 sentence summary of what the founder said",
  "action_items": ["specific things the founder mentioned needing to do"],
  "decisions_embedded": ["decisions that are implicit in what they said, formatted as questions"],
  "emotional_tone": "stressed|neutral|excited|frustrated|uncertain",
  "key_topics": ["topic1", "topic2"]
}`;

  const extraction = await callSonnet(
    'You are extracting structured data from a founder\'s stream-of-consciousness voice memo. Be perceptive.',
    prompt,
    2048, productId
  );

  const extracted = parseJSONResponse<{
    summary: string;
    action_items: string[];
    decisions_embedded: string[];
    emotional_tone: string;
    key_topics: string[];
  }>(extraction.content);

  // Create decisions from embedded decisions
  const decisionsCreated: string[] = [];
  for (const decision of extracted.decisions_embedded.slice(0, 3)) {
    const decisionId = nanoid();
    await query(
      `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status)
       VALUES (?, ?, 'strategic', 2, ?, 'Surfaced from founder voice memo', 'pending')`,
      [decisionId, productId, decision]
    );
    decisionsCreated.push(decisionId);
  }

  // Generate COO response
  const sessionId = await startSession(founderId, productId, 'Voice memo response');
  const cooResponse = await sendMessage(sessionId, founderId,
    `[Voice memo transcript]\n\n${transcript}\n\n[Extracted topics: ${extracted.key_topics.join(', ')}]\n\nRespond to what the founder said. Address their concerns directly.`
  );

  // Persist
  await query(
    `INSERT INTO voice_memos (id, founder_id, product_id, audio_url, transcript, duration_seconds, action_items, decisions_created, coo_response, processed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      id, founderId, productId, audioUrl, transcript, durationSeconds,
      JSON.stringify(extracted.action_items),
      JSON.stringify(decisionsCreated),
      cooResponse.content,
    ]
  );

  return {
    id,
    action_items: extracted.action_items,
    decisions_created: decisionsCreated,
    coo_response: cooResponse.content,
  };
}

/**
 * Generate a spoken digest summary (text for TTS).
 */
export async function generateSpokenDigest(
  founderId: string,
  productId: string
): Promise<string> {
  const product = await query('SELECT name, growth_stage FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;

  const ls = await query('SELECT risk_state FROM lifecycle_state WHERE product_id = ?', [productId]);
  const riskState = (ls.rows[0] as Record<string, string> | undefined)?.risk_state ?? 'green';

  const stressors = await query(
    "SELECT stressor_name FROM stressor_history WHERE product_id = ? AND status = 'active' LIMIT 3",
    [productId]
  );

  const metrics = await query(
    'SELECT new_mrr_cents, active_users, churn_rate FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
  const m = metrics.rows[0] as Record<string, number> | undefined;

  const prompt = `Write a 30-second spoken summary (about 80 words) of this product's status. Written for text-to-speech — use natural speech patterns, no bullet points or formatting.

Product: ${p?.name ?? 'your product'}
Risk: ${riskState}
MRR: $${m ? ((m.new_mrr_cents ?? 0) / 100).toFixed(0) : '0'}
Users: ${m?.active_users ?? 0}
Churn: ${m?.churn_rate ?? 0}%
Stressors: ${(stressors.rows as unknown as Array<Record<string, string>>).map((s) => s.stressor_name).join(', ') || 'none'}

Speak naturally. Start with the most important thing. End with what needs attention today.`;

  const response = await callSonnet(
    'You are a COO giving a verbal briefing. Natural speech, no formatting. Conversational but direct.',
    prompt,
    512, productId
  );

  return response.content;
}

/**
 * Start a voice session (creates a linked chat session).
 */
export async function startVoiceSession(
  founderId: string,
  productId: string
): Promise<{ voice_session_id: string; chat_session_id: string }> {
  const chatSessionId = await startSession(founderId, productId, 'Voice session');
  const voiceSessionId = nanoid();

  await query(
    `INSERT INTO voice_sessions (id, founder_id, product_id, chat_session_id) VALUES (?, ?, ?, ?)`,
    [voiceSessionId, founderId, productId, chatSessionId]
  );

  return { voice_session_id: voiceSessionId, chat_session_id: chatSessionId };
}

/**
 * End a voice session with final transcript.
 */
export async function endVoiceSession(
  voiceSessionId: string,
  transcript: string,
  durationSeconds: number
): Promise<void> {
  // Extract decisions from full session transcript
  const prompt = `Extract key decisions and action items from this voice conversation transcript.
Return JSON: {"decisions": ["decision questions"], "actions": ["action items"], "summary": "2 sentence summary"}

Transcript:
${transcript.slice(0, 5000)}`;

  // The session row carries the company. Without it this call is charged to
  // nobody, which means no per-product ceiling applies to it.
  const sessionRow = await query(
    'SELECT product_id FROM voice_sessions WHERE id = ?', [voiceSessionId]);
  const sessionProductId =
    (sessionRow.rows[0] as Record<string, string> | undefined)?.product_id;

  const response = await callSonnet(
    'Extract structured data from a conversation transcript.', prompt, 1024, sessionProductId);
  const extracted = parseJSONResponse<{ decisions: string[]; actions: string[]; summary: string }>(response.content);

  await query(
    `UPDATE voice_sessions SET
       transcript = ?, duration_seconds = ?, extracted_decisions = ?,
       extracted_actions = ?, summary = ?, status = 'completed'
     WHERE id = ?`,
    [
      transcript, durationSeconds,
      JSON.stringify(extracted.decisions),
      JSON.stringify(extracted.actions),
      extracted.summary,
      voiceSessionId,
    ]
  );
}
