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
import { log } from '../../../lib/logger.js';

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

  // WHAT THE FOUNDER HEARS WHEN THE BRIEF COULD NOT BE WRITTEN.
  //
  // These defaults used to be one set, and it was the confident set: "No
  // significant signals detected in the last 24 hours. Your agents are running
  // and monitoring your business. No immediate action items require your
  // attention right now." Those sentences were spoken whenever the model call
  // FAILED — a provider outage, a spend ceiling, a company Foundry may not
  // spend for, a malformed response — because the catch below swallowed the
  // error and returned the defaults unchanged.
  //
  // So the one case where Foundry had observed nothing at all was the case
  // where it told the founder, out loud, first thing in the morning, that
  // there was nothing to see. The stated window made it worse rather than
  // better: "in the last 24 hours" is the sound of a search that happened.
  //
  // Having no observation of a thing is not an observation that the thing is
  // absent. There is no new vocabulary here and no enum — just three sets of
  // words for the three situations that were being described with one, and the
  // right one chosen by which is actually true.
  const nothingIsConnected = contextBlock.trim().length === 0;

  // NOT INSTRUMENTED — the brief has nothing to read, and saying "no signals"
  // would describe an empty pipe as a quiet one.
  const uninstrumented: AIScriptResponse = {
    intro: `Good morning. Here is your Foundry brief for ${dateStr}.`,
    metrics_segment: 'I do not have metrics for you yet — nothing is reporting into Foundry so far.',
    top_signal_segment: 'I cannot tell you what is happening in your business yet, because nothing is connected for me to watch.',
    agent_highlight_segment: 'Once your data is connected, your agents will have something to work from.',
    action_items_segment: 'Connecting your metrics is the thing that would make tomorrow\'s brief worth listening to.',
    closing: 'That is everything I can tell you today.',
  };

  // UNKNOWN — the brief could not be written. Note what is NOT claimed: not
  // that things are quiet, not that the agents are running, not that nothing
  // needs attention.
  const couldNotPrepare: AIScriptResponse = {
    intro: `Good morning. This is your Foundry brief for ${dateStr}, and it is a short one.`,
    metrics_segment: 'I was not able to prepare your brief this morning, so I am not going to tell you how things are going — I do not know.',
    top_signal_segment: 'That means I have not checked your signals today, not that there was nothing to find.',
    agent_highlight_segment: 'Your dashboard has the current numbers and is not affected by this.',
    action_items_segment: 'If something needed your attention, this brief would not have caught it. Please check the dashboard today.',
    closing: 'I will try again tomorrow.',
  };

  let segments: AIScriptResponse = nothingIsConnected ? uninstrumented : couldNotPrepare;

  if (!nothingIsConnected) {
    try {
      const aiResponse = await callSonnet(systemPrompt, userPrompt, 1024, productId);
      const parsed = parseJSONResponse<AIScriptResponse>(aiResponse.content);
      // OBSERVED — the only branch entitled to say what is or is not there,
      // because it is the only one where something looked.
      segments = { ...segments, ...parsed };
    } catch (err) {
      // Not swallowed any more. A brief that silently degrades to reassurance
      // is worse than one that is missing, and nothing was recording that this
      // happened at all.
      log.warn('audio_brief.script_generation_failed', {
        productId, date: dateStr, error: (err as Error).message,
      });
    }
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

// Audio synthesis is intentionally not performed here. Provider spend and
// ambiguous effects require governed admission and reconciliation before this
// optional presentation enhancement can be reintroduced.

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

  // Script remains useful without incurring an ungoverned external effect.
  const audio_url: string | null = null;

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
