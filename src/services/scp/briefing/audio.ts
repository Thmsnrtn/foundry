// =============================================================================
// FOUNDRY — Morning Audio Brief Generator
// Generates a spoken-word script from the daily briefing, then optionally
// calls a TTS API (ElevenLabs or OpenAI) to produce an audio file.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { getLatestBriefing } from '../briefing.js';
import { getLatestCompressedBrief } from './compressed.js';

// ─── Init table ───────────────────────────────────────────────────────────────

let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS audio_brief_scripts (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      brief_date TEXT NOT NULL,
      script_json TEXT NOT NULL,
      audio_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(product_id, brief_date)
    )
  `);
  tableReady = true;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AudioBriefScript {
  intro: string;
  metrics_segment: string;
  top_signal_segment: string;
  agent_highlight_segment: string;
  action_items_segment: string;
  closing: string;
  full_script: string;
  estimated_duration_seconds: number;
}

// ─── Script Generation ────────────────────────────────────────────────────────

/**
 * Loads today's briefing + compressed brief, then calls Claude to write a
 * natural-language spoken brief in first-person ("Your MRR is up 3%...").
 */
export async function generateAudioBriefScript(
  productId: string,
  briefingDate?: string,
): Promise<AudioBriefScript> {
  const dateStr = briefingDate ?? new Date().toISOString().slice(0, 10);

  // Load latest briefing
  let briefingContext = '';
  try {
    const briefing = await getLatestBriefing(productId);
    if (briefing) {
      briefingContext = `
Headline: ${briefing.headline}
Full Briefing: ${briefing.full_briefing}
Health Score: ${briefing.health_score ?? 'unknown'}
Risk State: ${briefing.risk_state ?? 'unknown'}
Date: ${briefing.briefing_date}
`.trim();
    }
  } catch {
    // non-fatal
  }

  // Load compressed brief for action items
  let compressedContext = '';
  try {
    const compressed = await getLatestCompressedBrief(productId);
    if (compressed) {
      compressedContext = `
Weekly Status: ${compressed.one_sentence_status}
Top 3 Priorities: ${compressed.top_3.join('; ')}
Agent Consensus: ${compressed.agent_consensus ?? 'none'}
Key Decision: ${compressed.one_decision_to_make ?? 'none'}
`.trim();
    }
  } catch {
    // non-fatal
  }

  const contextBlock = [briefingContext, compressedContext].filter(Boolean).join('\n\n');

  const systemPrompt = `You are writing a morning audio brief for a founder — spoken-word, natural, concise.
Write as if you are a trusted advisor speaking directly to the founder.
Use first-person framing: "Your MRR is up 3%", "Your top priority today is...".
Speak like a human, not a robot. No bullet points in the audio script — it must flow as speech.
Each segment should be 2–4 sentences. Keep the total under 90 seconds (roughly 220 words).
Return ONLY valid JSON.`;

  const userPrompt = `Based on this company data, write a morning audio brief:

${contextBlock || 'No briefing data available yet. Write a brief placeholder script.'}

Return ONLY valid JSON in this exact format:
{
  "intro": "Good morning. Here is your Foundry brief for ...",
  "metrics_segment": "...",
  "top_signal_segment": "...",
  "agent_highlight_segment": "...",
  "action_items_segment": "...",
  "closing": "That is your brief for today. ..."
}`;

  interface AIScriptResponse {
    intro: string;
    metrics_segment: string;
    top_signal_segment: string;
    agent_highlight_segment: string;
    action_items_segment: string;
    closing: string;
  }

  let segments: AIScriptResponse = {
    intro: `Good morning. Here is your Foundry brief for ${dateStr}.`,
    metrics_segment: 'Your metrics are being tracked. Check the dashboard for the latest numbers.',
    top_signal_segment: 'No significant signals detected in the last 24 hours.',
    agent_highlight_segment: 'Your agents are running and monitoring your business.',
    action_items_segment: 'No immediate action items require your attention right now.',
    closing: 'That is your brief for today. Have a focused day.',
  };

  try {
    const aiResponse = await callSonnet(systemPrompt, userPrompt, 1024);
    const parsed = parseJSONResponse<AIScriptResponse>(aiResponse.content);
    segments = { ...segments, ...parsed };
  } catch {
    // fall back to defaults
  }

  const full_script = [
    segments.intro,
    segments.metrics_segment,
    segments.top_signal_segment,
    segments.agent_highlight_segment,
    segments.action_items_segment,
    segments.closing,
  ]
    .filter(Boolean)
    .join(' ');

  // ~150 words per minute for spoken audio
  const wordCount = full_script.split(/\s+/).length;
  const estimated_duration_seconds = Math.round((wordCount / 150) * 60);

  return {
    ...segments,
    full_script,
    estimated_duration_seconds,
  };
}

// ─── TTS ──────────────────────────────────────────────────────────────────────

async function callElevenLabsTTS(text: string, apiKey: string): Promise<string | null> {
  const voiceId = 'EXAVITQu4vr4xnSDxMaL'; // Rachel
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_monolingual_v1',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!response.ok) return null;

  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  // Return a data URL for immediate playback
  return `data:audio/mpeg;base64,${base64}`;
}

async function callOpenAITTS(text: string, apiKey: string): Promise<string | null> {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice: 'nova',
    }),
  });

  if (!response.ok) return null;

  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  return `data:audio/mpeg;base64,${base64}`;
}

async function generateAudioUrl(script: string): Promise<string | null> {
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (elevenKey) {
    try {
      return await callElevenLabsTTS(script, elevenKey);
    } catch {
      return null;
    }
  }

  if (openaiKey) {
    try {
      return await callOpenAITTS(script, openaiKey);
    } catch {
      return null;
    }
  }

  return null;
}

// ─── Get or Generate ──────────────────────────────────────────────────────────

/**
 * Returns the cached audio brief for today, or generates a new one.
 * Calls TTS if an API key is configured.
 */
export async function getOrGenerateAudioScript(
  productId: string,
  date?: string,
): Promise<{ script: AudioBriefScript; audio_url: string | null } | null> {
  await ensureTable();

  const dateStr = date ?? new Date().toISOString().slice(0, 10);

  // Check cache
  try {
    const cached = await query(
      'SELECT script_json, audio_url FROM audio_brief_scripts WHERE product_id = ? AND brief_date = ?',
      [productId, dateStr],
    );
    if (cached.rows.length > 0) {
      const row = cached.rows[0] as Record<string, unknown>;
      const script = JSON.parse(row.script_json as string) as AudioBriefScript;
      return { script, audio_url: (row.audio_url as string | null) ?? null };
    }
  } catch {
    // non-fatal — proceed to generate
  }

  // Generate script
  const script = await generateAudioBriefScript(productId, dateStr);

  // Generate audio if TTS configured
  const audio_url = await generateAudioUrl(script.full_script);

  // Persist
  try {
    const id = nanoid();
    await query(
      `INSERT INTO audio_brief_scripts (id, product_id, brief_date, script_json, audio_url)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(product_id, brief_date) DO UPDATE SET
         script_json = excluded.script_json,
         audio_url = excluded.audio_url`,
      [id, productId, dateStr, JSON.stringify(script), audio_url],
    );
  } catch {
    // non-fatal
  }

  return { script, audio_url };
}
