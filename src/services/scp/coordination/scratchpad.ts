// =============================================================================
// FOUNDRY — Agent Shared Scratchpad
// A shared context space where agents read each other's in-progress outputs
// so they can build on (not duplicate) each other's work.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { logger } from '../../logger.js';

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

  const consensus_points: string[] = [];
  const conflict_points: string[] = [];

  // Build a keyword frequency map from positions and recommended actions
  const keywordAgents: Record<string, string[]> = {};

  for (const [agentName, finding] of agentEntries) {
    const text = [
      finding.position,
      finding.action_recommended ?? '',
      finding.key_metric ?? '',
    ].join(' ').toLowerCase();

    // Extract meaningful tokens (words 5+ chars, excluding common words)
    const stopwords = new Set(['should', 'could', 'would', 'their', 'there', 'where', 'which', 'about', 'after', 'before']);
    const tokens = text
      .split(/\W+/)
      .filter(w => w.length >= 5 && !stopwords.has(w));

    for (const token of new Set(tokens)) {
      if (!keywordAgents[token]) keywordAgents[token] = [];
      keywordAgents[token].push(agentName);
    }
  }

  // Consensus: same keyword appears in 2+ agents' findings
  const seenConsensusKeywords = new Set<string>();
  for (const [keyword, agents] of Object.entries(keywordAgents)) {
    if (agents.length >= 2 && !seenConsensusKeywords.has(keyword)) {
      seenConsensusKeywords.add(keyword);
      const agentList = agents.map(a => a.charAt(0).toUpperCase() + a.slice(1)).join(' and ');
      consensus_points.push(`${agentList} both flagged "${keyword}"`);
      // Limit to top 5 consensus points
      if (consensus_points.length >= 5) break;
    }
  }

  // Conflict: agents with opposing high-confidence positions
  // Heuristic: look for agents where one mentions "strong"/"increase"/"growing" and another
  // mentions "weak"/"decrease"/"declining" for the same keyword
  const positiveWords = new Set(['strong', 'increase', 'growing', 'improve', 'opportunity', 'upside', 'positive', 'growth']);
  const negativeWords = new Set(['weak', 'decrease', 'declining', 'worsen', 'risk', 'threat', 'negative', 'churn', 'losing']);

  const positiveAgents: string[] = [];
  const negativeAgents: string[] = [];

  for (const [agentName, finding] of agentEntries) {
    if (finding.confidence < 0.5) continue; // Only consider confident findings
    const text = finding.position.toLowerCase();
    const hasPositive = [...positiveWords].some(w => text.includes(w));
    const hasNegative = [...negativeWords].some(w => text.includes(w));
    if (hasPositive && !hasNegative) positiveAgents.push(agentName);
    if (hasNegative && !hasPositive) negativeAgents.push(agentName);
  }

  if (positiveAgents.length > 0 && negativeAgents.length > 0) {
    const posNames = positiveAgents.map(a => a.charAt(0).toUpperCase() + a.slice(1)).join(', ');
    const negNames = negativeAgents.map(a => a.charAt(0).toUpperCase() + a.slice(1)).join(', ');
    conflict_points.push(`${posNames} sees opportunity while ${negNames} flags risk — review both findings`);
  }

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
