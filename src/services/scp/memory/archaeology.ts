// =============================================================================
// FOUNDRY — Decision Archaeology Service
// "Institutional knowledge" interface: lets new hires and AI agents query
// the memory graph in natural language.  Uses Claude to synthesise answers
// from retrieved nodes.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { callClaude, MODELS, parseJSONResponse } from '../../ai/client.js';
import { searchMemory, getNode } from './graph.js';
import type { MemoryNode } from './graph.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ArchaeologyContext {
  question: string;
  relevantNodes: MemoryNode[];
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  suggestedFollowUps: string[];
}

interface ClaudeArchaeologyResponse {
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  suggested_follow_ups: string[];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Answer an institutional-knowledge question using the memory graph.
 * Retrieves up to 5 relevant nodes via keyword search, then calls Claude
 * to synthesise a structured answer.
 */
export async function askAboutDecision(
  productId: string,
  question: string
): Promise<ArchaeologyContext> {
  // 1. Retrieve top relevant nodes (keyword search)
  const nodes = await searchMemory(productId, question);
  const topNodes = nodes.slice(0, 5);

  if (topNodes.length === 0) {
    return {
      question,
      relevantNodes: [],
      answer:
        'No relevant decisions or context found in the memory graph yet. ' +
        'Add decisions via the Strategic Decisions log or sync existing ones.',
      confidence: 'low',
      suggestedFollowUps: [
        'What decisions have been recorded so far?',
        'How do I add a decision to the memory graph?',
      ],
    };
  }

  // 2. Build context for Claude
  const nodeContext = topNodes
    .map(
      (n, i) =>
        `[Node ${i + 1}] (${n.node_type} — ${n.occurred_at.slice(0, 10)})\n` +
        `Title: ${n.title}\n` +
        `Content: ${n.content.slice(0, 600)}${n.content.length > 600 ? '…' : ''}`
    )
    .join('\n\n---\n\n');

  const systemPrompt =
    'You are the institutional memory system for a startup. ' +
    'Answer the question using ONLY the provided memory nodes as context. ' +
    'Be concise and direct. Cite node titles when relevant. ' +
    'If the nodes do not contain sufficient information, say so honestly. ' +
    'Return valid JSON only — no markdown fences.';

  const userPrompt =
    `Question: ${question}\n\nMemory graph context:\n\n${nodeContext}\n\n` +
    `Return JSON:\n` +
    `{\n` +
    `  "answer": "string (2-4 paragraphs max)",\n` +
    `  "confidence": "high" | "medium" | "low",\n` +
    `  "suggested_follow_ups": ["string", "string", "string"]\n` +
    `}`;

  let answer = '';
  let confidence: ArchaeologyContext['confidence'] = 'medium';
  let suggestedFollowUps: string[] = [];

  try {
    const response = await callClaude({
      model: MODELS.SONNET,
      maxTokens: 1024,
      systemPrompt,
      userPrompt,
      // This call was invisible to the attribution gate, which only knew the
      // three helper functions — so it reached a model with no company to
      // charge and only the global ceiling applying.
      subject: productId,
    });

    const parsed = parseJSONResponse<ClaudeArchaeologyResponse>(response.content);
    answer = parsed.answer ?? '';
    confidence = parsed.confidence ?? 'medium';
    suggestedFollowUps = parsed.suggested_follow_ups ?? [];
  } catch {
    // Fallback: return raw content summary if parsing fails
    answer =
      `Based on ${topNodes.length} memory nodes, the most relevant context is: ` +
      topNodes.map(n => n.title).join('; ') + '.';
    confidence = 'low';
    suggestedFollowUps = [];
  }

  return {
    question,
    relevantNodes: topNodes,
    answer,
    confidence,
    suggestedFollowUps,
  };
}

/**
 * Record a counterfactual reflection for a memory node.
 */
export async function addCounterfactual(
  productId: string,
  nodeId: string,
  data: {
    what_we_decided: string;
    what_we_couldve_done: string;
    outcome_if_different?: string;
    regret_level?: number;
  }
): Promise<void> {
  const id = nanoid();
  await query(
    `INSERT INTO decision_counterfactuals
       (id, product_id, memory_node_id, what_we_decided, what_we_couldve_done,
        outcome_if_different, regret_level)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      productId,
      nodeId,
      data.what_we_decided,
      data.what_we_couldve_done,
      data.outcome_if_different ?? null,
      data.regret_level ?? null,
    ]
  );
}

/**
 * Fetch all counterfactuals for a product, each paired with its memory node.
 */
export async function getCounterfactuals(
  productId: string
): Promise<Array<{ node: MemoryNode; counterfactual: Record<string, unknown> }>> {
  const result = await query(
    `SELECT cf.*, mn.node_type, mn.title, mn.content, mn.metadata_json,
            mn.source_id, mn.source_type, mn.occurred_at
     FROM decision_counterfactuals cf
     JOIN memory_nodes mn ON cf.memory_node_id = mn.id
     WHERE cf.product_id = ?
     ORDER BY cf.noted_at DESC`,
    [productId]
  );

  return result.rows.map(row => {
    const r = row as Record<string, unknown>;
    let metadata: Record<string, unknown> = {};
    if (r.metadata_json && typeof r.metadata_json === 'string') {
      try { metadata = JSON.parse(r.metadata_json) as Record<string, unknown>; } catch { /* ignore */ }
    }
    const node: MemoryNode = {
      id: r.memory_node_id as string,
      node_type: r.node_type as MemoryNode['node_type'],
      title: r.title as string,
      content: r.content as string,
      metadata,
      source_id: (r.source_id as string | null) ?? null,
      source_type: (r.source_type as string | null) ?? null,
      occurred_at: r.occurred_at as string,
    };
    const counterfactual: Record<string, unknown> = {
      id: r.id,
      product_id: r.product_id,
      memory_node_id: r.memory_node_id,
      what_we_decided: r.what_we_decided,
      what_we_couldve_done: r.what_we_couldve_done,
      outcome_if_different: r.outcome_if_different,
      regret_level: r.regret_level,
      noted_at: r.noted_at,
    };
    return { node, counterfactual };
  });
}

/**
 * Look up a node by ID, verifying it belongs to the given product.
 */
export async function getNodeForProduct(
  productId: string,
  nodeId: string
): Promise<MemoryNode | null> {
  const result = await query(
    `SELECT * FROM memory_nodes WHERE id = ? AND product_id = ?`,
    [nodeId, productId]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0] as Record<string, unknown>;
  let metadata: Record<string, unknown> = {};
  if (r.metadata_json && typeof r.metadata_json === 'string') {
    try { metadata = JSON.parse(r.metadata_json) as Record<string, unknown>; } catch { /* ignore */ }
  }
  return {
    id: r.id as string,
    node_type: r.node_type as MemoryNode['node_type'],
    title: r.title as string,
    content: r.content as string,
    metadata,
    source_id: (r.source_id as string | null) ?? null,
    source_type: (r.source_type as string | null) ?? null,
    occurred_at: r.occurred_at as string,
  };
}
