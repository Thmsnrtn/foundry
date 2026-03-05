// =============================================================================
// FOUNDRY — Voice Interface: Morning Briefing Generator
// Generates a spoken briefing for the daily founder ritual.
// Also processes voice transcripts to extract structured updates.
// =============================================================================

import { query, getActiveStressors, getPendingDecisions } from '../../db/client.js';
import { computeSignal } from '../signal.js';
import { getMRRDecomposition } from '../intelligence/revenue.js';
import { callOpus, callSonnet } from '../ai/client.js';
import { nanoid } from 'nanoid';
import type { VoiceSession, VoiceUpdate } from '../../types/index.js';

// ─── Generate Morning Briefing ────────────────────────────────────────────────

/**
 * Generate today's spoken briefing for a product.
 * Target: 60-90 seconds when read at normal speaking pace (~140 wpm = ~200 words).
 */
export async function generateMorningBriefing(
  productId: string,
  founderId: string,
  founderName: string | null,
): Promise<VoiceSession> {
  // Check if we already generated today's briefing
  const today = new Date().toISOString().slice(0, 10);
  const existingResult = await query(
    `SELECT * FROM voice_sessions WHERE product_id = ? AND session_date = ?`,
    [productId, today],
  );
  if (existingResult.rows.length > 0) {
    return existingResult.rows[0] as unknown as VoiceSession;
  }

  const [signal, stressors, decisions, mrr] = await Promise.all([
    computeSignal(productId),
    getActiveStressors(productId),
    getPendingDecisions(productId),
    getMRRDecomposition(productId).catch(() => null),
  ]);

  // Get today's daily insight if it exists
  const insightResult = await query(
    `SELECT headline, action FROM daily_insights WHERE product_id = ? AND insight_date = ?`,
    [productId, today],
  );
  const insight = insightResult.rows[0] as Record<string, string | null> | undefined;

  // Build briefing data
  const stressorRows = stressors.rows as Array<Record<string, string>>;
  const decisionRows = decisions.rows as Array<Record<string, unknown>>;

  const criticalStressors = stressorRows.filter((s) => s.severity === 'critical');
  const overdueDecisions = decisionRows.filter((d) => {
    const age = Math.round((Date.now() - new Date(d.created_at as string).getTime()) / (1000 * 60 * 60 * 24));
    return age >= 7;
  });

  // Build context for Claude
  const contextParts = [
    `Signal: ${signal.score}/100 (${signal.riskState.toUpperCase()})`,
    signal.prose,
    '',
  ];

  if (mrr) {
    contextParts.push(`MRR: $${Math.round(mrr.total_cents / 100).toLocaleString()}`);
    if (mrr.health_ratio !== null) {
      contextParts.push(`Health ratio: ${mrr.health_ratio.toFixed(2)}`);
    }
  }

  if (criticalStressors.length > 0) {
    contextParts.push(`CRITICAL: ${criticalStressors.map((s) => s.stressor_name).join(', ')}`);
  } else if (stressorRows.length > 0) {
    contextParts.push(`Active stressors: ${stressorRows.map((s) => `${s.stressor_name} [${s.severity}]`).join(', ')}`);
  }

  if (overdueDecisions.length > 0) {
    contextParts.push(`${overdueDecisions.length} decisions are overdue (>7 days)`);
  } else if (decisionRows.length > 0) {
    contextParts.push(`${decisionRows.length} decisions pending`);
  }

  if (insight?.action) {
    contextParts.push(`Today's action: ${insight.action}`);
  }

  const systemPrompt = `You write morning briefings for SaaS founders. These are read aloud — conversational, direct, energizing.
Rules:
- Open with a one-sentence Signal status (include the score)
- Most important thing happening right now (stressor or positive signal)
- One concrete action to take today
- End with a short motivational close (one sentence, not cheesy)
- Total: 150-200 words. Natural speech, no bullet points, no headers.
- Never start with "Good morning" or "Hello". Start with the Signal.`;

  const userPrompt = `Founder: ${founderName ?? 'the founder'}\nDate: ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}\n\n${contextParts.join('\n')}`;

  let briefingText = '';
  let headline = '';

  try {
    const r = await callSonnet(systemPrompt, userPrompt, 512);
    briefingText = r.content.trim();
    // Extract the headline (first sentence)
    const firstSentence = briefingText.split('.')[0];
    headline = firstSentence.trim().slice(0, 120);
  } catch {
    briefingText = buildFallbackBriefing(signal.score, signal.riskState, stressorRows, decisionRows, mrr);
    headline = `Signal is at ${signal.score} — ${signal.riskState === 'red' ? 'recovery mode active' : signal.riskState === 'yellow' ? 'elevated monitoring active' : 'operations stable'}.`;
  }

  // Persist
  const id = nanoid();
  await query(
    `INSERT INTO voice_sessions
     (id, product_id, founder_id, session_date, briefing_text, briefing_headline,
      signal_at_briefing, risk_state_at_briefing)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, productId, founderId, today, briefingText, headline, signal.score, signal.riskState],
  );

  return {
    id, product_id: productId, founder_id: founderId, session_date: today,
    briefing_text: briefingText, briefing_headline: headline,
    signal_at_briefing: signal.score, risk_state_at_briefing: signal.riskState,
    transcript: null, structured_updates: null,
    decisions_created: null, stressors_updated: null, metrics_updated: null,
    duration_seconds: null, model_used: 'claude-sonnet-4-5',
    created_at: new Date().toISOString(),
  };
}

// ─── Process Voice Transcript ─────────────────────────────────────────────────

/**
 * Process a voice transcript to extract structured business updates.
 * Returns updates that can be applied to the system.
 */
export async function processVoiceTranscript(
  sessionId: string,
  productId: string,
  transcript: string,
): Promise<{ updates: VoiceUpdate[]; summary: string }> {
  const systemPrompt = `You extract structured business updates from founder voice transcripts.
Identify: metric updates, stressor reports, decision captures, and general notes.

Return JSON:
{
  "updates": [
    {
      "type": "metric|stressor|decision|note",
      "data": {
        // for metric: {"field": "activation_rate|churn_rate|nps_score|etc", "value": number}
        // for stressor: {"name": "...", "description": "...", "severity": "watch|elevated|critical"}
        // for decision: {"what": "...", "category": "strategic|product|marketing|urgent|informational"}
        // for note: {"content": "..."}
      }
    }
  ],
  "summary": "1-2 sentences describing what was captured"
}`;

  const updates: VoiceUpdate[] = [];
  let summary = '';

  try {
    const r = await callSonnet(systemPrompt, `Transcript: "${transcript}"`, 512);
    const parsed = JSON.parse(r.content) as { updates: VoiceUpdate[]; summary: string };
    updates.push(...(parsed.updates ?? []));
    summary = parsed.summary ?? '';
  } catch {
    summary = 'Transcript captured but could not extract structured updates.';
  }

  // Persist transcript and updates
  await query(
    `UPDATE voice_sessions SET transcript = ?, structured_updates = ? WHERE id = ?`,
    [transcript, JSON.stringify(updates), sessionId],
  );

  return { updates, summary };
}

// ─── Fallback Briefing ────────────────────────────────────────────────────────

function buildFallbackBriefing(
  score: number,
  riskState: string,
  stressors: Array<Record<string, string>>,
  decisions: Array<Record<string, unknown>>,
  mrr: { total_cents: number; health_ratio: number | null } | null,
): string {
  const lines: string[] = [];

  lines.push(`Signal is at ${score} out of 100 — ${riskState === 'red' ? 'recovery mode is active' : riskState === 'yellow' ? 'elevated monitoring is active' : 'operations are stable'}.`);

  if (stressors.length > 0) {
    const critical = stressors.filter((s) => s.severity === 'critical');
    if (critical.length > 0) {
      lines.push(`Your top priority today is resolving ${critical[0].stressor_name}.`);
    } else {
      lines.push(`You have ${stressors.length} active stressor${stressors.length > 1 ? 's' : ''} to monitor.`);
    }
  } else {
    lines.push('No critical issues are active — this is a good day to focus on forward progress.');
  }

  if (decisions.length > 0) {
    lines.push(`${decisions.length} decision${decisions.length > 1 ? 's are' : ' is'} waiting for your judgment.`);
  }

  lines.push('Make it count.');
  return lines.join(' ');
}
