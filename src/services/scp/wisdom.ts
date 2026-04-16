// =============================================================================
// FOUNDRY — SCP Wisdom Layer
// Tracks decision outcomes and synthesizes behavioral wisdom from patterns.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { callSonnet, parseJSONResponse } from '../ai/client.js';
import type { AgentName } from './types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DecisionOutcome {
  id: string;
  product_id: string;
  agent_name: AgentName;
  session_id: string | null;
  decision_title: string;
  decision_description: string | null;
  outcome: 'approved' | 'denied';
  outcome_result: 'positive' | 'negative' | 'neutral' | 'pending';
  founder_rationale: string | null;
  impact_usd: number | null;
  resolved_at: string;
  created_at: string;
}

export interface WisdomPattern {
  id: string;
  product_id: string;
  pattern_type: string;
  agent_name: AgentName | null;
  pattern: string;
  evidence_count: number;
  confidence: number;
  active: boolean;
  last_reinforced_at: string;
  created_at: string;
}

// ─── Internal Types ────────────────────────────────────────────────────────────

interface SynthesizedPattern {
  type: 'what_works' | 'what_fails' | 'agent_tendency' | 'approval_signal';
  agent_name: AgentName | null;
  pattern: string;
  confidence: number;
}

interface SynthesisResponse {
  patterns: SynthesizedPattern[];
  summary: string;
}

// ─── recordDecisionOutcome ─────────────────────────────────────────────────────

export async function recordDecisionOutcome(params: {
  productId: string;
  agentName: AgentName;
  sessionId: string | null;
  decisionTitle: string;
  decisionDescription: string;
  outcome: 'approved' | 'denied';
  founderRationale?: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  const {
    productId,
    agentName,
    sessionId,
    decisionTitle,
    decisionDescription,
    outcome,
    founderRationale,
    context,
  } = params;

  await query(
    `INSERT INTO decision_outcomes
       (id, product_id, agent_name, session_id, decision_title, decision_description,
        outcome, outcome_result, founder_rationale, context_json, resolved_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now'), datetime('now'))`,
    [
      nanoid(),
      productId,
      agentName,
      sessionId ?? null,
      decisionTitle,
      decisionDescription,
      outcome,
      founderRationale ?? null,
      context ? JSON.stringify(context) : null,
    ]
  );
}

// ─── getDecisionOutcomes ───────────────────────────────────────────────────────

export async function getDecisionOutcomes(
  productId: string,
  options?: {
    agentName?: AgentName;
    limit?: number;
    outcomeFilter?: 'approved' | 'denied';
  }
): Promise<DecisionOutcome[]> {
  const limit = options?.limit ?? 50;
  const parts: string[] = ['SELECT * FROM decision_outcomes WHERE product_id = ?'];
  const args: unknown[] = [productId];

  if (options?.agentName) {
    parts.push('AND agent_name = ?');
    args.push(options.agentName);
  }

  if (options?.outcomeFilter) {
    parts.push('AND outcome = ?');
    args.push(options.outcomeFilter);
  }

  parts.push('ORDER BY created_at DESC LIMIT ?');
  args.push(limit);

  const result = await query(parts.join(' '), args);
  return result.rows as unknown as DecisionOutcome[];
}

// ─── synthesizeWisdomPatterns ──────────────────────────────────────────────────

export async function synthesizeWisdomPatterns(productId: string): Promise<{
  patternsFound: number;
  summary: string;
}> {
  // Load last 50 decision outcomes
  const outcomes = await getDecisionOutcomes(productId, { limit: 50 });

  if (outcomes.length === 0) {
    return { patternsFound: 0, summary: 'No decision outcomes recorded yet.' };
  }

  // Load existing active wisdom patterns for context
  const existingPatterns = await getWisdomPatterns(productId);

  // Summarize outcomes for the prompt
  const outcomesSummary = outcomes
    .map((o) => {
      const agentLabel = o.agent_name;
      const outcomeLabel = o.outcome === 'approved' ? 'APPROVED' : 'DENIED';
      const rationale = o.founder_rationale ? ` Rationale: "${o.founder_rationale}"` : '';
      return `- [${outcomeLabel}] ${agentLabel}: "${o.decision_title}"${rationale}`;
    })
    .join('\n');

  const existingPatternsText =
    existingPatterns.length > 0
      ? `\n\nExisting active patterns (for context, avoid duplicating):\n${existingPatterns
          .map((p) => `- (${p.pattern_type}) ${p.pattern}`)
          .join('\n')}`
      : '';

  const userPrompt = `Analyze these ${outcomes.length} decision outcomes for a SaaS company's AI agent system:

${outcomesSummary}
${existingPatternsText}

Identify 3-5 distinct behavioral patterns from the data. Each pattern should be actionable and specific.

Return valid JSON only with this exact structure:
{
  "patterns": [
    {
      "type": "what_works|what_fails|agent_tendency|approval_signal",
      "agent_name": "beacon"|"atlas"|"compass"|"prism"|"scribe"|"forge"|"harbor"|"sentinel"|"ledger"|"shield"|"oracle"|"crucible"|null,
      "pattern": "Clear, specific pattern statement (1-2 sentences)",
      "confidence": 0.0
    }
  ],
  "summary": "2-3 sentence overall synthesis of what these decisions reveal about the company's approval patterns"
}

Notes:
- agent_name should be null for cross-agent patterns
- confidence should be 0.0-1.0 based on how strongly the data supports this pattern
- type meanings: what_works=patterns that get approved, what_fails=patterns that get denied, agent_tendency=how a specific agent behaves, approval_signal=what predicts approval`;

  const response = await callSonnet(
    'You are a decision pattern synthesizer for a SaaS company. Analyze decision outcomes to find patterns. Return valid JSON only.',
    userPrompt,
    2048
  );

  let synthesis: SynthesisResponse;
  try {
    synthesis = parseJSONResponse<SynthesisResponse>(response.content);
  } catch {
    return { patternsFound: 0, summary: 'Pattern synthesis failed to parse AI response.' };
  }

  if (!synthesis?.patterns || !Array.isArray(synthesis.patterns)) {
    return { patternsFound: 0, summary: synthesis?.summary ?? 'No patterns identified.' };
  }

  let patternsFound = 0;

  for (const p of synthesis.patterns) {
    if (!p.pattern || typeof p.confidence !== 'number' || p.confidence < 0.6) {
      continue;
    }

    // Check if a similar pattern already exists (text similarity via LIKE on first 50 chars)
    const patternPrefix = p.pattern.substring(0, 50).replace(/%/g, '\\%').replace(/_/g, '\\_');
    const existingResult = await query(
      `SELECT id, evidence_count FROM wisdom_patterns
       WHERE product_id = ? AND active = 1 AND pattern LIKE ? ESCAPE '\\'`,
      [productId, `${patternPrefix}%`]
    );

    if (existingResult.rows.length > 0) {
      // Update existing pattern
      const existing = existingResult.rows[0] as Record<string, unknown>;
      await query(
        `UPDATE wisdom_patterns
         SET evidence_count = evidence_count + 1,
             confidence = ?,
             last_reinforced_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`,
        [Math.min(1.0, p.confidence), existing.id]
      );
    } else {
      // Insert new pattern
      await query(
        `INSERT INTO wisdom_patterns
           (id, product_id, pattern_type, agent_name, pattern, evidence_count, confidence,
            active, last_reinforced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, 1, datetime('now'), datetime('now'), datetime('now'))`,
        [
          nanoid(),
          productId,
          p.type,
          p.agent_name ?? null,
          p.pattern,
          p.confidence,
        ]
      );
    }

    patternsFound++;
  }

  return {
    patternsFound,
    summary: synthesis.summary ?? `Synthesized ${patternsFound} patterns from ${outcomes.length} decisions.`,
  };
}

// ─── getWisdomPatterns ────────────────────────────────────────────────────────

export async function getWisdomPatterns(productId: string): Promise<WisdomPattern[]> {
  const result = await query(
    `SELECT * FROM wisdom_patterns
     WHERE product_id = ? AND active = 1
     ORDER BY confidence DESC`,
    [productId]
  );
  return (result.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    product_id: row.product_id as string,
    pattern_type: row.pattern_type as string,
    agent_name: (row.agent_name as AgentName) ?? null,
    pattern: row.pattern as string,
    evidence_count: row.evidence_count as number,
    confidence: row.confidence as number,
    active: (row.active as number) === 1,
    last_reinforced_at: row.last_reinforced_at as string,
    created_at: row.created_at as string,
  }));
}

// ─── getWisdomSummary ─────────────────────────────────────────────────────────

export async function getWisdomSummary(productId: string): Promise<{
  totalDecisions: number;
  approvedCount: number;
  deniedCount: number;
  approvalRate: number;
  activePatterns: number;
  topPatterns: WisdomPattern[];
}> {
  const [countsResult, patternsResult] = await Promise.all([
    query(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN outcome = 'approved' THEN 1 ELSE 0 END) as approved,
         SUM(CASE WHEN outcome = 'denied' THEN 1 ELSE 0 END) as denied
       FROM decision_outcomes
       WHERE product_id = ?`,
      [productId]
    ),
    query(
      `SELECT COUNT(*) as active_count FROM wisdom_patterns
       WHERE product_id = ? AND active = 1`,
      [productId]
    ),
  ]);

  const counts = (countsResult.rows[0] ?? {}) as Record<string, unknown>;
  const total = (counts.total as number) ?? 0;
  const approved = (counts.approved as number) ?? 0;
  const denied = (counts.denied as number) ?? 0;
  const activePatterns = ((patternsResult.rows[0] as Record<string, number> | undefined)?.active_count) ?? 0;

  const topPatterns = await query(
    `SELECT * FROM wisdom_patterns
     WHERE product_id = ? AND active = 1
     ORDER BY confidence DESC LIMIT 5`,
    [productId]
  );

  return {
    totalDecisions: total,
    approvedCount: approved,
    deniedCount: denied,
    approvalRate: total > 0 ? Math.round((approved / total) * 100) : 0,
    activePatterns,
    topPatterns: (topPatterns.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      product_id: row.product_id as string,
      pattern_type: row.pattern_type as string,
      agent_name: (row.agent_name as AgentName) ?? null,
      pattern: row.pattern as string,
      evidence_count: row.evidence_count as number,
      confidence: row.confidence as number,
      active: (row.active as number) === 1,
      last_reinforced_at: row.last_reinforced_at as string,
      created_at: row.created_at as string,
    })),
  };
}
