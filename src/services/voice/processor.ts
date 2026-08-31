// =============================================================================
// FOUNDRY — Voice-First COO
// Transcription, voice-to-decision pipeline, async voice memos.
// =============================================================================

import { query } from '../../db/client.js';
import { callSonnet, callOpus, parseJSONResponse } from '../ai/client.js';
import { sendMessage, startSession } from '../chat/coo.js';
import { nanoid } from 'nanoid';
import { wrapDataBlock, dataBlockInstruction, sanitizeForPrompt } from '../ai/sanitize.js';

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

  // A TRANSCRIPT IS DATA, AND IT IS NOT ONLY THE FOUNDER'S WORDS.
  //
  // This interpolated the transcript raw, at the boundary between the prompt's
  // instructions and its content, three times in this file. A voice memo is
  // dictated by the founder — but a memo can be recorded in a meeting, read
  // aloud from an email, or pasted in as text by whatever produced the
  // transcript, so the words are not guaranteed to be theirs. The extraction
  // below creates DECISIONS in the founder's queue from what comes back.
  //
  // The block is the defence: the content sits inside a named tag and the
  // system prompt says what a tag means. The words are not rewritten — see
  // `wrapDataBlock` for why a denylist is the wrong instrument for somebody's
  // own dictation.
  const prompt = `A founder just recorded a voice memo. Extract the key content.

${wrapDataBlock('transcript', transcript)}

Return JSON:
{
  "summary": "2-3 sentence summary of what the founder said",
  "action_items": ["specific things the founder mentioned needing to do"],
  "decisions_embedded": ["decisions that are implicit in what they said, formatted as questions"],
  "emotional_tone": "stressed|neutral|excited|frustrated|uncertain",
  "key_topics": ["topic1", "topic2"]
}`;

  const extraction = await callSonnet(
    'You are extracting structured data from a founder\'s stream-of-consciousness voice memo. Be perceptive. '
    + dataBlockInstruction('transcript'),
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
    `${dataBlockInstruction('transcript')}\n\n${wrapDataBlock('transcript', transcript)}\n\n`
    + `[Extracted topics: ${extracted.key_topics.map((t) => sanitizeForPrompt(t)).join(', ')}]\n\n`
    + 'Respond to what the founder said. Address their concerns directly.'
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

  // The three most severe. Spoken aloud in a briefing, an arbitrary three is
  // indistinguishable from the three that matter most.
  const stressors = await query(
    `SELECT stressor_name FROM stressor_history
      WHERE product_id = ? AND status = 'active'
      ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'elevated' THEN 2 ELSE 3 END, identified_at ASC
      LIMIT 3`,
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

  // A CONVERSATION IS NOT A BRIEFING, AND THEY SHARED A TABLE WITH A UNIQUE KEY
  // WRITTEN FOR THE BRIEFING. `voice_sessions` is keyed
  // `UNIQUE(product_id, session_date)` — one briefing per company per day, which
  // is right for a briefing. This insert supplied `date('now')` to satisfy the
  // NOT NULL, and so collided with the row `morning_briefings` writes at 06:30
  // UTC: after that job ran, starting a voice conversation was refused for the
  // rest of the day, every day. Migration 218 gives the conversation its own
  // table, where as many as somebody wants to have is the correct number.
  await query(
    `INSERT INTO voice_conversations (id, founder_id, product_id, chat_session_id)
     VALUES (?, ?, ?, ?)`,
    [voiceSessionId, founderId, productId, chatSessionId]
  );

  return { voice_session_id: voiceSessionId, chat_session_id: chatSessionId };
}

export interface VoiceConversationSummary {
  id: string;
  created_at: string;
  duration_seconds: number | null;
  status: string;
  summary: string | null;
  extracted_decisions: string[];
  extracted_actions: string[];
}

/**
 * The conversations this company has held, newest first.
 *
 * `endVoiceSession` PAYS FOR A SONNET CALL to pull decisions, action items and
 * a summary out of every transcript, and there was no way to read any of it
 * back: `start` answers with ids and `end` answers `{"status":"completed"}`.
 * The extraction was charged to the company and stored where only the erasure
 * export could reach it.
 *
 * This is the read half of a write that already exists — the same judgement
 * made for `portfolio_snapshots` earlier in this campaign, and the case is
 * stronger here: the founder held the conversation, so what Foundry took from
 * it is unambiguously theirs. Bounded, newest first, and the transcript is NOT
 * returned in the list — it is the longest field by far and a list is for
 * choosing, not for reading.
 */
export async function getVoiceConversations(
  productId: string,
  limit = 20,
): Promise<VoiceConversationSummary[]> {
  const result = await query(
    `SELECT id, created_at, duration_seconds, status, summary,
            extracted_decisions, extracted_actions
       FROM voice_conversations
      WHERE product_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?`,
    [productId, Math.min(Math.max(1, limit), 100)],
  );

  const decode = (raw: unknown): string[] => {
    if (raw == null) return [];
    try {
      const parsed: unknown = JSON.parse(String(raw));
      return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
    } catch {
      return [];
    }
  };

  return (result.rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    created_at: String(r.created_at),
    duration_seconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    status: String(r.status),
    summary: r.summary == null ? null : String(r.summary),
    extracted_decisions: decode(r.extracted_decisions),
    extracted_actions: decode(r.extracted_actions),
  }));
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

${wrapDataBlock('transcript', transcript, 5000)}`;

  // The session row carries the company. Without it this call is charged to
  // nobody, which means no per-product ceiling applies to it.
  const sessionRow = await query(
    'SELECT product_id FROM voice_conversations WHERE id = ?', [voiceSessionId]);
  const sessionProductId =
    (sessionRow.rows[0] as Record<string, string> | undefined)?.product_id;
  if (!sessionProductId) {
    // No company to charge and no institutional purpose: a session that has
    // lost its product is a bug, and spending on it under the global ceiling
    // would hide that.
    throw new Error(`voice session ${voiceSessionId} has no product to attribute spend to`);
  }

  const response = await callSonnet(
    `Extract structured data from a conversation transcript. ${dataBlockInstruction('transcript')}`,
    prompt, 1024, sessionProductId);
  const extracted = parseJSONResponse<{ decisions: string[]; actions: string[]; summary: string }>(response.content);

  await query(
    `UPDATE voice_conversations SET
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
