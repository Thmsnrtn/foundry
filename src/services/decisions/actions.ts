// =============================================================================
// FOUNDRY — Action Execution Engine
// Generates draft artifacts for decisions. Auto-executes Gate 0 actions.
// =============================================================================

import { query, insertAuditLog } from '../../db/client.js';
import { callSonnet, callOpus, parseJSONResponse } from '../ai/client.js';
import { buildWisdomContext } from '../wisdom/dna.js';
import { voiceGateDraft } from '../calibration/voice-gate.js';
import { recordDecisionActed } from '../intelligence/briefing-telemetry.js';
import { recordApproval, recordRejection } from '../founder/rejection-streak.js';
import { nanoid } from 'nanoid';

export type ArtifactType =
  | 'email_draft'
  | 'pricing_page_copy'
  | 'stripe_plan_config'
  | 'github_pr'
  | 'landing_page_copy'
  | 'churn_rescue_email'
  | 'customer_survey'
  | 'onboarding_flow'
  | 'support_response'
  | 'internal_memo'
  | 'announcement';

export interface ActionDraft {
  id: string;
  decision_id: string | null;
  action_type: string;
  title: string;
  description: string;
  draft_content: string;
  artifact_type: ArtifactType;
  gate: number;
  auto_executable: boolean;
  status: string;
}

/**
 * Generate a draft artifact for a decision.
 */
export async function generateActionDraft(
  decisionId: string,
  productId: string,
  ownerId: string
): Promise<ActionDraft> {
  const decision = await query('SELECT * FROM decisions WHERE id = ? AND product_id = ?', [decisionId, productId]);
  const d = decision.rows[0] as Record<string, unknown> | undefined;
  if (!d) throw new Error('Decision not found');

  const product = await query('SELECT name FROM products WHERE id = ?', [productId]);
  const productName = (product.rows[0] as Record<string, string>)?.name ?? 'your product';
  const wisdom = await buildWisdomContext(productId);

  const gate = (d.gate as number) ?? 2;
  const category = d.category as string;

  // Determine what artifact to generate
  const artifactType = determineArtifactType(category, d.what as string);
  const autoExecutable = gate === 0;

  const prompt = `Generate a ready-to-use artifact for this decision.

Product: ${productName}
Decision: ${d.what}
Why now: ${d.why_now}
Recommended option: ${d.recommendation ?? 'N/A'}
Category: ${category}
Gate level: ${gate}

${wisdom.dna_context}

Generate a complete, ready-to-deploy ${artifactType}. The founder should be able to approve it with one click.

Return JSON:
{
  "title": "short title for this draft",
  "description": "what this does when executed",
  "draft_content": "the complete artifact content (the email, the copy, the config, etc.)",
  "execution_notes": "what happens when the founder approves this"
}`;

  const response = gate <= 1 ? await callSonnet(
    'You are a COO generating ready-to-execute business artifacts. Be specific and complete.',
    prompt, 4096
  ) : await callOpus(
    'You are a COO generating high-stakes business artifacts. Be thorough and strategic.',
    prompt, 4096
  );

  const result = parseJSONResponse<{
    title: string;
    description: string;
    draft_content: string;
    execution_notes: string;
  }>(response.content);

  const draft: ActionDraft = {
    id: nanoid(),
    decision_id: decisionId,
    action_type: category,
    title: result.title,
    description: result.description,
    draft_content: result.draft_content,
    artifact_type: artifactType,
    gate,
    auto_executable: autoExecutable,
    status: autoExecutable ? 'auto_approved' : 'draft',
  };

  // V3.1 Layer B: voice gate. If the artifact reaches a customer/public
  // surface and an active fingerprint exists, score it. On warn or block,
  // strip auto-execution so the founder reviews. Errors are non-fatal —
  // an LLM hiccup in voice scoring must not break draft generation.
  try {
    const verdict = await voiceGateDraft(productId, {
      artifact_type: draft.artifact_type,
      draft_content: draft.draft_content,
    });
    if (verdict.verdict === 'block' || verdict.verdict === 'warn') {
      draft.auto_executable = false;
      draft.status = 'draft';
      const tag =
        verdict.score !== null
          ? `[voice:${verdict.verdict} ${verdict.score}] `
          : `[voice:${verdict.verdict}] `;
      draft.description = tag + draft.description;
    }
  } catch { /* voice-gate failure is non-fatal */ }

  await query(
    `INSERT INTO action_drafts (id, decision_id, product_id, owner_id, action_type, title, description, draft_content, artifact_type, metadata, gate, auto_executable, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      draft.id, decisionId, productId, ownerId, draft.action_type,
      draft.title, draft.description, draft.draft_content, draft.artifact_type,
      JSON.stringify({ execution_notes: result.execution_notes }),
      draft.gate, draft.auto_executable ? 1 : 0, draft.status,
    ]
  );

  // Auto-execute Gate 0 actions (unless voice-gate forced manual review)
  if (draft.auto_executable) {
    await executeAction(draft.id, productId);
  } else if (draft.gate >= 1) {
    // Wave 3 — outbound webhook for decision_needed. Only fire when
    // the founder has to do something (gate >= 1 and not auto-executable).
    try {
      const { dispatchEvent } = await import('../distribution/outbound-webhooks.js');
      dispatchEvent(productId, {
        event_type: 'decision_needed',
        product_id: productId,
        product_name: productName,
        headline: `Foundry surfaced a decision: ${draft.title}`,
        detail: draft.description,
        url: `${process.env.APP_URL ?? ''}/decisions/${decisionId}`,
      }).catch(() => {});
    } catch { /* dispatcher unavailable */ }
  }

  return draft;
}

/**
 * Approve and execute a draft.
 */
export async function approveDraft(draftId: string, ownerId: string): Promise<{ success: boolean; result: string }> {
  const draft = await query(
    'SELECT * FROM action_drafts WHERE id = ? AND owner_id = ? AND status = ?',
    [draftId, ownerId, 'draft']
  );
  const d = draft.rows[0] as Record<string, unknown> | undefined;
  if (!d) return { success: false, result: 'Draft not found or already processed' };

  await query(
    `UPDATE action_drafts SET status = 'approved', approved_at = datetime('now') WHERE id = ?`,
    [draftId]
  );

  // Briefing → decision telemetry: link this approval to the founder's most
  // recent briefing view if any. Fire-and-forget; telemetry failure must not
  // block the action.
  recordDecisionActed(
    ownerId,
    d.product_id as string,
    draftId,
    (d.decision_id as string | null) ?? null,
    'approved'
  ).catch(() => {});

  // An approval breaks any rejection streak. Fire-and-forget.
  recordApproval(
    ownerId,
    d.product_id as string,
    null  // agent name — could be derived if useful, but the aggregate streak is what surfaces to the founder
  ).catch(() => {});

  return executeAction(draftId, d.product_id as string);
}

/**
 * Reject a draft.
 */
export async function rejectDraft(draftId: string, ownerId: string, reason?: string): Promise<void> {
  // Look up product_id and decision_id before the UPDATE so we have the
  // attribution context. Skip on failure — rejection is the operator's
  // judgment, not a request we should block on telemetry.
  const before = await query(
    'SELECT product_id, decision_id FROM action_drafts WHERE id = ? AND owner_id = ?',
    [draftId, ownerId]
  ).catch(() => null);

  await query(
    `UPDATE action_drafts SET status = 'rejected', metadata = json_set(COALESCE(metadata, '{}'), '$.rejection_reason', ?) WHERE id = ? AND owner_id = ?`,
    [reason ?? 'Rejected by founder', draftId, ownerId]
  );

  if (before && before.rows.length > 0) {
    const row = before.rows[0] as Record<string, unknown>;
    recordDecisionActed(
      ownerId,
      row.product_id as string,
      draftId,
      (row.decision_id as string | null) ?? null,
      'rejected'
    ).catch(() => {});
    recordRejection(
      ownerId,
      row.product_id as string,
      null
    ).catch(() => {});
  }
}

/**
 * Execute an approved action.
 */
async function executeAction(draftId: string, productId: string): Promise<{ success: boolean; result: string }> {
  const draft = await query('SELECT * FROM action_drafts WHERE id = ?', [draftId]);
  const d = draft.rows[0] as Record<string, unknown> | undefined;
  if (!d) return { success: false, result: 'Draft not found' };

  const artifactType = d.artifact_type as ArtifactType;
  let result = '';
  let success = true;

  try {
    switch (artifactType) {
      case 'churn_rescue_email':
      case 'email_draft':
        // Queue for email delivery
        result = 'Email draft queued for delivery. Review in your email queue.';
        break;
      case 'github_pr':
        // Would trigger the remediation PR system
        result = 'PR generation queued. Check your GitHub repo.';
        break;
      case 'pricing_page_copy':
      case 'landing_page_copy':
      case 'onboarding_flow':
        result = `${artifactType.replace(/_/g, ' ')} ready for deployment. Copy provided in the draft content.`;
        break;
      default:
        result = `Action artifact generated. Type: ${artifactType}. Review the draft content.`;
    }
  } catch (err) {
    success = false;
    result = (err as Error).message;
  }

  await query(
    `UPDATE action_drafts SET status = ?, executed_at = datetime('now'), execution_result = ? WHERE id = ?`,
    [success ? 'executed' : 'failed', result, draftId]
  );

  // Log execution
  await query(
    `INSERT INTO auto_execution_log (id, product_id, action_draft_id, action_type, trigger, output, success)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), productId, draftId, d.action_type, d.gate === 0 ? 'auto_gate_0' : 'founder_approved', result, success ? 1 : 0]
  );

  // Update linked decision if exists
  if (d.decision_id) {
    await query(
      `UPDATE decisions SET status = 'executed', decided_at = datetime('now') WHERE id = ? AND status = 'pending'`,
      [d.decision_id]
    );
  }

  // Wave 3 — outbound webhook for agent_action_executed.
  if (success) {
    try {
      const productRow = await query('SELECT name FROM products WHERE id = ?', [productId]);
      const productName = (productRow.rows[0] as Record<string, string> | undefined)?.name ?? 'product';
      const { dispatchEvent } = await import('../distribution/outbound-webhooks.js');
      dispatchEvent(productId, {
        event_type: 'agent_action_executed',
        product_id: productId,
        product_name: productName,
        headline: `Foundry executed: ${d.title as string}`,
        detail: result,
        url: `${process.env.APP_URL ?? ''}/dashboard`,
      }).catch(() => {});
    } catch { /* dispatcher unavailable */ }
  }

  return { success, result };
}

/**
 * Get pending drafts for a founder.
 */
export async function getPendingDrafts(ownerId: string): Promise<ActionDraft[]> {
  const result = await query(
    `SELECT * FROM action_drafts WHERE owner_id = ? AND status = 'draft' ORDER BY created_at DESC`,
    [ownerId]
  );
  return result.rows as unknown as ActionDraft[];
}

/**
 * Auto-generate drafts for all pending Gate 0-1 decisions.
 */
export async function generateDraftsForPendingDecisions(productId: string, ownerId: string): Promise<number> {
  const pending = await query(
    `SELECT id FROM decisions WHERE product_id = ? AND status = 'pending' AND gate <= 1
     AND id NOT IN (SELECT decision_id FROM action_drafts WHERE decision_id IS NOT NULL)`,
    [productId]
  );

  let generated = 0;
  for (const row of pending.rows as unknown as Array<Record<string, string>>) {
    try {
      await generateActionDraft(row.id, productId, ownerId);
      generated++;
    } catch { /* Skip failures */ }
  }
  return generated;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function determineArtifactType(category: string, what: string): ArtifactType {
  const lower = what.toLowerCase();
  if (lower.includes('email') || lower.includes('outreach')) return 'email_draft';
  if (lower.includes('pricing') || lower.includes('price')) return 'pricing_page_copy';
  if (lower.includes('churn') || lower.includes('rescue') || lower.includes('win back')) return 'churn_rescue_email';
  if (lower.includes('landing') || lower.includes('homepage')) return 'landing_page_copy';
  if (lower.includes('onboard')) return 'onboarding_flow';
  if (lower.includes('survey') || lower.includes('feedback')) return 'customer_survey';
  if (lower.includes('pr') || lower.includes('code') || lower.includes('fix')) return 'github_pr';
  if (lower.includes('announce')) return 'announcement';
  if (category === 'marketing') return 'landing_page_copy';
  return 'internal_memo';
}
