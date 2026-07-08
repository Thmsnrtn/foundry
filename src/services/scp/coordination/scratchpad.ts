// =============================================================================
// FOUNDRY — Agent Shared Scratchpad
// A shared context space where agents read each other's in-progress outputs
// so they can build on (not duplicate) each other's work.
// =============================================================================

import { z } from 'zod';
import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { logger } from '../../logger.js';
import { callHaiku, parseJSONResponse } from '../../ai/client.js';
import { sanitizeForPrompt } from '../../ai/sanitize.js';

export interface AgentFinding {
  position: string;           // agent's main position (1-2 sentences)
  confidence: number;         // 0-1
  key_metric?: string;        // the metric driving the finding
  action_recommended?: string; // the single action recommended
}

interface ScratchpadRow {
  id: string;
  product_id: string;
  scratchpad_date: string;
  findings_json: string;
  consensus_points_json: string;
  conflict_points_json: string;
  updated_at: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getOrCreateScratchpad(
  productId: string,
  date?: string
): Promise<{
  id: string;
  findings: Record<string, AgentFinding>;
  consensus_points: string[];
  conflict_points: string[];
}> {
  const scratchpadDate = date ?? new Date().toISOString().slice(0, 10);

  const existing = await query(
    'SELECT * FROM agent_scratchpad WHERE product_id = ? AND scratchpad_date = ?',
    [productId, scratchpadDate]
  );

  if (existing.rows.length > 0) {
    return _rowToScratchpad(existing.rows[0] as Record<string, unknown>);
  }

  // Create a new row
  const id = nanoid();
  await query(
    `INSERT INTO agent_scratchpad (id, product_id, scratchpad_date, findings_json, consensus_points_json, conflict_points_json, updated_at)
     VALUES (?, ?, ?, '{}', '[]', '[]', datetime('now'))`,
    [id, productId, scratchpadDate]
  );

  return { id, findings: {}, consensus_points: [], conflict_points: [] };
}

export async function writeAgentFinding(
  productId: string,
  agentName: string,
  finding: AgentFinding
): Promise<void> {
  const scratchpadDate = new Date().toISOString().slice(0, 10);

  // Get or create the scratchpad for today
  const scratchpad = await getOrCreateScratchpad(productId, scratchpadDate);

  // Upsert the finding for this agent
  const updatedFindings: Record<string, AgentFinding> = {
    ...scratchpad.findings,
    [agentName]: finding,
  };

  await query(
    `UPDATE agent_scratchpad
     SET findings_json = ?, updated_at = datetime('now')
     WHERE product_id = ? AND scratchpad_date = ?`,
    [JSON.stringify(updatedFindings), productId, scratchpadDate]
  );

  // If >= 3 agents have written findings today, detect consensus/conflicts asynchronously
  if (Object.keys(updatedFindings).length >= 3) {
    detectConsensusAndConflicts(productId).catch((err) => { logger.error(`detectConsensusAndConflicts failed for ${productId}: ${err}`); });
  }
}

export async function getAgentFindings(
  productId: string,
  date?: string
): Promise<Record<string, AgentFinding>> {
  const scratchpadDate = date ?? new Date().toISOString().slice(0, 10);

  const result = await query(
    'SELECT findings_json FROM agent_scratchpad WHERE product_id = ? AND scratchpad_date = ?',
    [productId, scratchpadDate]
  );

  if (result.rows.length === 0) return {};

  const row = result.rows[0] as Record<string, unknown>;
  return _parseJSON<Record<string, AgentFinding>>(row.findings_json as string | null, {});
}

export async function getScratchpadContext(productId: string): Promise<string> {
  const scratchpadDate = new Date().toISOString().slice(0, 10);

  const result = await query(
    'SELECT * FROM agent_scratchpad WHERE product_id = ? AND scratchpad_date = ?',
    [productId, scratchpadDate]
  );

  if (result.rows.length === 0) return '';

  const scratchpad = _rowToScratchpad(result.rows[0] as Record<string, unknown>);

  const agentEntries = Object.entries(scratchpad.findings);
  if (agentEntries.length === 0) return '';

  const lines: string[] = ['WHAT OTHER AGENTS HAVE FOUND TODAY:'];

  for (const [agentName, finding] of agentEntries) {
    const confidencePct = Math.round(finding.confidence * 100);
    let line = `- ${agentName.charAt(0).toUpperCase() + agentName.slice(1)}: [${finding.position} — ${confidencePct}% confidence]`;
    if (finding.action_recommended) {
      line += ` → Recommended: ${finding.action_recommended}`;
    }
    lines.push(line);
  }

  if (scratchpad.consensus_points.length > 0) {
    lines.push('');
    lines.push('CONSENSUS ACROSS AGENTS:');
    for (const point of scratchpad.consensus_points) {
      lines.push(`- ${point}`);
    }
  }

  if (scratchpad.conflict_points.length > 0) {
    lines.push('');
    lines.push('DISAGREEMENTS ACROSS AGENTS:');
    for (const point of scratchpad.conflict_points) {
      lines.push(`- ${point}`);
    }
  }

  return lines.join('\n');
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function detectConsensusAndConflicts(productId: string): Promise<void> {
  const scratchpadDate = new Date().toISOString().slice(0, 10);

  const result = await query(
    'SELECT * FROM agent_scratchpad WHERE product_id = ? AND scratchpad_date = ?',
    [productId, scratchpadDate]
  );

  if (result.rows.length === 0) return;

  const scratchpad = _rowToScratchpad(result.rows[0] as Record<string, unknown>);
  const agentEntries = Object.entries(scratchpad.findings);

  if (agentEntries.length < 2) return;

  // Classify genuine consensus/conflict with a cheap Haiku call rather than the
  // old bag-of-words heuristic (which flagged "consensus" on any shared 5-char
  // token — e.g. two agents both saying "customer" — and would eventually
  // surface an embarrassing note in a founder-visible briefing). On any failure
  // we drop the feature for the day rather than emit noise (Phase 2.5).
  const { consensus_points, conflict_points } = await classifyConsensusConflict(
    productId,
    agentEntries,
  );

  await query(
    `UPDATE agent_scratchpad
     SET consensus_points_json = ?, conflict_points_json = ?, updated_at = datetime('now')
     WHERE product_id = ? AND scratchpad_date = ?`,
    [
      JSON.stringify(consensus_points),
      JSON.stringify(conflict_points),
      productId,
      scratchpadDate,
    ]
  );
}

const ConsensusConflictSchema = z.object({
  consensus_points: z.array(z.string()).max(5),
  conflict_points: z.array(z.string()).max(5),
});

/**
 * Ask Haiku to identify genuine substantive consensus and conflict across the
 * agents' findings. Returns empty arrays on any failure — we would rather show
 * nothing than a nonsense "consensus" note in the founder's briefing.
 */
async function classifyConsensusConflict(
  productId: string,
  agentEntries: Array<[string, AgentFinding]>,
): Promise<{ consensus_points: string[]; conflict_points: string[] }> {
  const empty = { consensus_points: [], conflict_points: [] };

  const findingsBlock = agentEntries
    .map(([agentName, f]) => {
      const parts = [
        `Agent: ${sanitizeForPrompt(agentName)}`,
        `Position: ${sanitizeForPrompt(f.position)}`,
        f.action_recommended ? `Action: ${sanitizeForPrompt(f.action_recommended)}` : '',
        f.key_metric ? `Metric: ${sanitizeForPrompt(f.key_metric)}` : '',
        `Confidence: ${f.confidence}`,
      ].filter(Boolean);
      return parts.join('\n');
    })
    .join('\n\n');

  const systemPrompt = `You compare the day's findings from a company's AI agents and identify where they GENUINELY agree or disagree on substance — not merely share a word.

Rules:
- Consensus = two or more agents making the same substantive point (same risk, same opportunity, same recommended direction). Shared vocabulary is NOT consensus.
- Conflict = agents recommending opposing directions or contradicting each other on the same subject.
- If there is no real agreement or disagreement, return empty arrays. Empty is the correct, common answer.
- Each point is one short sentence naming the agents involved and the substance.
- At most 5 of each.

Return ONLY JSON: {"consensus_points": string[], "conflict_points": string[]}`;

  const userPrompt = `Agent findings for today:\n\n${findingsBlock}\n\nReturn the JSON now.`;

  try {
    const response = await callHaiku(systemPrompt, userPrompt, 600, productId);
    const parsed = parseJSONResponse(response.content, ConsensusConflictSchema);
    return {
      consensus_points: parsed.consensus_points.map((p) => p.trim()).filter(Boolean).slice(0, 5),
      conflict_points: parsed.conflict_points.map((p) => p.trim()).filter(Boolean).slice(0, 5),
    };
  } catch (err) {
    logger.warn('scratchpad consensus classification failed', {
      productId,
      error: (err as Error).message,
    });
    return empty;
  }
}

function _rowToScratchpad(row: Record<string, unknown>): {
  id: string;
  findings: Record<string, AgentFinding>;
  consensus_points: string[];
  conflict_points: string[];
} {
  return {
    id: row.id as string,
    findings: _parseJSON<Record<string, AgentFinding>>(row.findings_json as string | null, {}),
    consensus_points: _parseJSON<string[]>(row.consensus_points_json as string | null, []),
    conflict_points: _parseJSON<string[]>(row.conflict_points_json as string | null, []),
  };
}

function _parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// Re-export ScratchpadRow type for internal use (unused externally but keeps file complete)
export type { ScratchpadRow };
