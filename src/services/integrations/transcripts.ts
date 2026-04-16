// =============================================================================
// FOUNDRY — Call Transcript Ingestion & Analysis
// Ingests call transcripts from Fathom/Gong/Fireflies/Zoom and analyzes them
// using Claude to extract sentiment, topics, competitor mentions, and more.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { callSonnet, parseJSONResponse } from '../ai/client.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TranscriptAnalysis {
  sentiment: number;
  keyTopics: string[];
  competitorMentions: Array<{ name: string; context: string; sentiment: 'positive' | 'negative' | 'neutral' }>;
  objections: string[];
  commitments: string[];
  summary: string;
}

// ─── Ingest ──────────────────────────────────────────────────────────────────

/**
 * Insert a raw transcript record and return its ID.
 * Does not perform analysis — call analyzeTranscript separately.
 */
export async function ingestTranscript(
  productId: string,
  data: {
    source: string;
    call_type: string;
    participant_emails?: string;
    duration_minutes?: number;
    transcript_text: string;
    call_date: string;
  },
): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO call_transcripts
       (id, product_id, source, call_type, participant_emails, duration_minutes, transcript_text, call_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      productId,
      data.source,
      data.call_type,
      data.participant_emails ?? null,
      data.duration_minutes ?? null,
      data.transcript_text,
      data.call_date,
    ],
  );
  return id;
}

// ─── Analysis ────────────────────────────────────────────────────────────────

/**
 * Call Claude to extract structured insights from a transcript.
 * Updates the record's analyzed fields and sets processed_at.
 */
export async function analyzeTranscript(transcriptId: string): Promise<void> {
  const result = await query(
    `SELECT transcript_text, call_type, participant_emails FROM call_transcripts WHERE id = ?`,
    [transcriptId],
  );
  if (result.rows.length === 0) return;

  const row = result.rows[0] as Record<string, unknown>;
  const transcriptText = row.transcript_text as string;
  const callType = row.call_type as string;
  const participants = (row.participant_emails as string | null) ?? '';

  if (!transcriptText) return;

  const systemPrompt = `You are an expert at analyzing business call transcripts. Extract structured insights and return ONLY valid JSON with no markdown formatting.`;

  const userPrompt = `Analyze this ${callType} call transcript and extract the following. Return ONLY a JSON object with these exact keys:

{
  "sentiment": <number from -1.0 (very negative) to 1.0 (very positive)>,
  "keyTopics": <array of strings, the main topics discussed>,
  "competitorMentions": <array of {name: string, context: string, sentiment: "positive"|"negative"|"neutral"}>,
  "objections": <array of strings representing objections or concerns raised>,
  "commitments": <array of strings representing next steps or commitments made>,
  "summary": <2-3 sentence summary of the call>
}

Participants: ${participants || 'Unknown'}

Transcript:
${transcriptText.slice(0, 12000)}`;

  try {
    const response = await callSonnet(systemPrompt, userPrompt, 2048);
    const analysis = parseJSONResponse<TranscriptAnalysis>(response.content);

    await query(
      `UPDATE call_transcripts SET
         sentiment_score = ?,
         key_topics_json = ?,
         competitor_mentions_json = ?,
         objections_json = ?,
         commitments_json = ?,
         summary = ?,
         processed_at = datetime('now')
       WHERE id = ?`,
      [
        analysis.sentiment ?? null,
        JSON.stringify(analysis.keyTopics ?? []),
        JSON.stringify(analysis.competitorMentions ?? []),
        JSON.stringify(analysis.objections ?? []),
        JSON.stringify(analysis.commitments ?? []),
        analysis.summary ?? null,
        transcriptId,
      ],
    );
  } catch (err) {
    console.error('[transcripts] analyzeTranscript error:', err);
  }
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Return a list of transcript summaries for a product, newest first.
 */
export async function getTranscriptSummaries(
  productId: string,
  limit = 20,
): Promise<Array<{
  id: string;
  call_type: string;
  call_date: string;
  sentiment_score: number | null;
  summary: string | null;
  competitor_count: number;
  objection_count: number;
}>> {
  const result = await query(
    `SELECT id, call_type, call_date, sentiment_score, summary,
            competitor_mentions_json, objections_json
     FROM call_transcripts
     WHERE product_id = ?
     ORDER BY call_date DESC
     LIMIT ?`,
    [productId, limit],
  );

  return result.rows.map((r) => {
    const row = r as Record<string, unknown>;
    let competitorCount = 0;
    let objectionCount = 0;
    try {
      competitorCount = JSON.parse((row.competitor_mentions_json as string) || '[]').length;
    } catch { /* noop */ }
    try {
      objectionCount = JSON.parse((row.objections_json as string) || '[]').length;
    } catch { /* noop */ }
    return {
      id: row.id as string,
      call_type: row.call_type as string,
      call_date: row.call_date as string,
      sentiment_score: row.sentiment_score as number | null,
      summary: row.summary as string | null,
      competitor_count: competitorCount,
      objection_count: objectionCount,
    };
  });
}

/**
 * Aggregate competitor mentions across all analyzed transcripts for a product.
 */
export async function getCompetitorMentionTrends(
  productId: string,
): Promise<Array<{
  competitor: string;
  mention_count: number;
  avg_sentiment: number;
  recent_contexts: string[];
}>> {
  const result = await query(
    `SELECT competitor_mentions_json, sentiment_score
     FROM call_transcripts
     WHERE product_id = ? AND competitor_mentions_json IS NOT NULL
     ORDER BY call_date DESC
     LIMIT 100`,
    [productId],
  );

  const competitorMap = new Map<string, { count: number; sentiments: number[]; contexts: string[] }>();

  for (const r of result.rows) {
    const row = r as Record<string, unknown>;
    let mentions: Array<{ name: string; context: string; sentiment: string }> = [];
    try {
      mentions = JSON.parse((row.competitor_mentions_json as string) || '[]');
    } catch { continue; }

    for (const mention of mentions) {
      const name = mention.name?.toLowerCase().trim();
      if (!name) continue;

      if (!competitorMap.has(name)) {
        competitorMap.set(name, { count: 0, sentiments: [], contexts: [] });
      }
      const entry = competitorMap.get(name)!;
      entry.count++;
      const sentVal = mention.sentiment === 'positive' ? 1 : mention.sentiment === 'negative' ? -1 : 0;
      entry.sentiments.push(sentVal);
      if (mention.context && entry.contexts.length < 5) {
        entry.contexts.push(mention.context);
      }
    }
  }

  return Array.from(competitorMap.entries())
    .map(([competitor, data]) => ({
      competitor,
      mention_count: data.count,
      avg_sentiment: data.sentiments.length > 0
        ? data.sentiments.reduce((a, b) => a + b, 0) / data.sentiments.length
        : 0,
      recent_contexts: data.contexts,
    }))
    .sort((a, b) => b.mention_count - a.mention_count);
}
