// =============================================================================
// FOUNDRY — Action Execution Engine
// Takes agent-proposed outbound actions and executes them after founder approval.
// Supports: send_email, create_ticket (Linear), post_slack, schedule_call,
//           update_crm, custom_webhook.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { sendSlackNotification } from '../../integration/slack.js';
import { getIntegration } from '../../integration/fabric.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActionType =
  | 'send_email'
  | 'create_ticket'
  | 'post_slack'
  | 'schedule_call'
  | 'update_crm'
  | 'custom_webhook'
  | 'mcp_tool';

export interface ActionPayload {
  action_type: ActionType;
  integration: string;
  // For send_email:
  to_email?: string;
  subject?: string;
  body?: string;
  // For create_ticket (Linear):
  ticket_title?: string;
  ticket_description?: string;
  priority?: number; // 0-4 in Linear
  team_id?: string;
  // For post_slack:
  channel?: string;
  text?: string;
  blocks?: unknown[];
  // For custom_webhook:
  webhook_url?: string;
  webhook_payload?: Record<string, unknown>;
  // For mcp_tool (Hands Law): any founder-connected MCP server, grant-governed.
  server_name?: string;
  tool?: string;
  tool_args?: Record<string, unknown>;
  // Department provenance (which customer a department action concerns)
  cs_customer?: string;
  outreach_customer?: string;
}

export interface ExecutionResult {
  success: boolean;
  integration_response?: unknown;
  error?: string;
  effect_certainty?: 'provider_acknowledged' | 'provider_rejected' | 'ambiguous' | 'not_attempted';
  reconcile_after?: string | null;
}

// ─── Linear GraphQL response types ───────────────────────────────────────────

interface LinearCreateIssueResponse {
  data?: {
    issueCreate?: {
      success: boolean;
      issue?: {
        id: string;
        identifier: string;
        url: string;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Insert a new action_execution record with status='pending'. Returns the new ID.
 */
export async function createExecution(
  productId: string,
  outboundActionId: string | null,
  payload: ActionPayload
): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO action_executions
       (id, product_id, outbound_action_id, action_type, integration, payload_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
    [
      id,
      productId,
      outboundActionId,
      payload.action_type,
      payload.integration,
      JSON.stringify(payload),
    ]
  );
  return id;
}

/**
 * Approve an execution and immediately run it.
 * 1. Updates status to 'approved' with approver info.
 * 2. Calls executeAction to route to the correct integration handler.
 * 3. Updates status to 'completed' or 'failed' with result/error.
 */
export async function approveAndExecute(
  executionId: string,
  approverId: string,
  opts: { ownerId?: string } = {}
): Promise<ExecutionResult> {
  const now = new Date().toISOString();

  // Fetch the execution record. When an ownerId is supplied (any human-driven
  // path), the row must belong to a product that founder owns.
  const execResult = opts.ownerId
    ? await query(
        `SELECT * FROM action_executions
         WHERE id = ? AND product_id IN (SELECT id FROM products WHERE owner_id = ?)`,
        [executionId, opts.ownerId]
      )
    : await query(`SELECT * FROM action_executions WHERE id = ?`, [executionId]);
  if (execResult.rows.length === 0) {
    return { success: false, error: 'Execution not found' };
  }

  const row = execResult.rows[0] as Record<string, unknown>;
  let payload: ActionPayload;
  try {
    payload = JSON.parse(row.payload_json as string || '{}') as ActionPayload;
  } catch {
    return { success: false, error: 'Invalid payload JSON' };
  }

  // Atomically claim the row: only a 'pending' execution can be approved.
  // A double-click, a concurrent autopilot sweep, or a replay of a completed
  // execution loses this claim and does NOT execute a second time.
  const claim = await query(
    `UPDATE action_executions
     SET status='approved', approved_by=?, approved_at=?
     WHERE id=? AND status='pending'`,
    [approverId, now, executionId]
  );
  if ((claim.rowsAffected ?? 0) === 0) {
    return { success: false, error: `Execution is not pending (status=${row.status})` };
  }

  // Mark executing
  await query(
    `UPDATE action_executions SET status='executing' WHERE id=? AND status='approved'`,
    [executionId]
  );

  // Execute
  const result = await executeAction(executionId, payload);

  const executedAt = new Date().toISOString();

  if (result.success) {
    await query(
      `UPDATE action_executions
       SET status='completed', executed_at=?, result_json=?, effect_certainty=?, provider_acknowledged_at=?
       WHERE id=?`,
      [executedAt, JSON.stringify(result.integration_response ?? null), result.effect_certainty ?? null,
       result.effect_certainty === 'provider_acknowledged' ? executedAt : null, executionId]
    );
  } else {
    await query(
      `UPDATE action_executions
       SET status='failed', executed_at=?, error_message=?, effect_certainty=?, reconcile_after=?
       WHERE id=?`,
      [executedAt, result.error ?? 'Unknown error', result.effect_certainty ?? null,
       result.reconcile_after ?? null, executionId]
    );
  }

  return result;
}

/**
 * Cancel a pending execution.
 */
export async function cancelExecution(executionId: string, ownerId?: string): Promise<void> {
  // Only not-yet-run executions can be cancelled, and (when ownerId is given)
  // only by the founder who owns the product — a completed or foreign row is
  // left untouched.
  await query(
    `UPDATE action_executions SET status='cancelled'
     WHERE id=? AND status IN ('pending','approved')
       ${ownerId ? `AND product_id IN (SELECT id FROM products WHERE owner_id=?)` : ''}`,
    ownerId ? [executionId, ownerId] : [executionId]
  );
}

/**
 * Fetch a single execution record by ID.
 */
export async function getExecution(executionId: string): Promise<{
  id: string;
  product_id: string;
  outbound_action_id: string | null;
  action_type: string;
  integration: string;
  payload: ActionPayload;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  executed_at: string | null;
  result: unknown | null;
  error: string | null;
  created_at: string;
} | null> {
  const result = await query(
    `SELECT * FROM action_executions WHERE id=?`,
    [executionId]
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0] as Record<string, unknown>;
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    outbound_action_id: (row.outbound_action_id as string) ?? null,
    action_type: row.action_type as string,
    integration: row.integration as string,
    payload: (() => {
      try { return JSON.parse(row.payload_json as string || '{}') as ActionPayload; } catch { return {} as ActionPayload; }
    })(),
    status: row.status as string,
    approved_by: (row.approved_by as string) ?? null,
    approved_at: (row.approved_at as string) ?? null,
    executed_at: (row.executed_at as string) ?? null,
    result: (() => {
      try { return row.result_json ? JSON.parse(row.result_json as string) : null; } catch { return null; }
    })(),
    error: (row.error_message as string) ?? null,
    created_at: row.created_at as string,
  };
}

/**
 * List pending executions for a product, joined with outbound_actions to get
 * agent_name and rationale.
 */
export async function listPendingExecutions(productId: string): Promise<Array<{
  id: string;
  action_type: string;
  integration: string;
  payload: ActionPayload;
  outbound_action_id: string | null;
  created_at: string;
  agent_name: string | null;
  rationale: string | null;
}>> {
  const result = await query(
    `SELECT ae.id, ae.action_type, ae.integration, ae.payload_json,
            ae.outbound_action_id, ae.created_at,
            oa.agent_name, oa.rationale
     FROM action_executions ae
     LEFT JOIN outbound_actions oa ON oa.id = ae.outbound_action_id
     WHERE ae.product_id=? AND ae.status='pending'
     ORDER BY ae.created_at DESC
     LIMIT 50`,
    [productId]
  );

  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    action_type: row.action_type as string,
    integration: row.integration as string,
    payload: (() => {
      try { return JSON.parse(row.payload_json as string || '{}') as ActionPayload; } catch { return {} as ActionPayload; }
    })(),
    outbound_action_id: (row.outbound_action_id as string) ?? null,
    created_at: row.created_at as string,
    agent_name: (row.agent_name as string) ?? null,
    rationale: (row.rationale as string) ?? null,
  }));
}

// ─── Internal Execution Router ────────────────────────────────────────────────

async function executeAction(
  executionId: string,
  payload: ActionPayload
): Promise<ExecutionResult> {
  // We need product_id to look up integrations
  const execResult = await query(
    `SELECT product_id FROM action_executions WHERE id=?`,
    [executionId]
  );
  const productId = (execResult.rows[0] as Record<string, unknown>)?.product_id as string | undefined;
  if (!productId) {
    return { success: false, error: 'Could not resolve product_id for execution' };
  }

  switch (payload.action_type) {
    case 'post_slack':
      return executeSlack(productId, payload);

    case 'create_ticket':
      return executeLinearTicket(productId, payload);

    case 'custom_webhook':
      return executeWebhook(payload);

    case 'send_email':
      // Draft-only today (no live third-party send path exists). When live
      // sending is wired, the send boundary MUST call assertSenderOfRecord
      // (services/outbound/sender-of-record.ts): a third-party recipient
      // requires the founder's own connected sender, never a Foundry domain.
      return {
        success: true,
        integration_response: {
          note: 'Email draft stored. Email provider integration pending.',
          to: payload.to_email,
          subject: payload.subject,
          body_preview: (payload.body ?? '').slice(0, 200),
        },
      };

    case 'schedule_call':
      return {
        success: true,
        integration_response: {
          note: 'Calendly integration pending. Call scheduling request recorded.',
          details: payload,
        },
      };

    case 'update_crm':
      return {
        success: true,
        integration_response: {
          note: 'CRM update recorded. CRM integration pending.',
          details: payload,
        },
      };

    case 'mcp_tool': {
      // Hands Law: any connected MCP tool — the call is licensed by a live
      // founder-issued grant and routed through the gateway (idempotent,
      // audited, kill-switchable). No grant, no call.
      if (!payload.server_name || !payload.tool) {
        return { success: false, error: 'mcp_tool requires server_name and tool' };
      }
      const { callMcpTool } = await import('../../integration/mcp-client.js');
      const r = await callMcpTool({
        productId,
        agent: 'standing_order',
        serverName: payload.server_name,
        tool: payload.tool,
        args: payload.tool_args ?? {},
        dedupKey: `action:${executionId}`,
      });
      return r.ok
        ? { success: true, integration_response: r.result }
        : { success: false, error: r.reason };
    }

    default:
      return { success: false, error: `Unknown action_type: ${(payload as ActionPayload).action_type}` };
  }
}

// ─── Integration Handlers ─────────────────────────────────────────────────────

async function executeSlack(productId: string, payload: ActionPayload): Promise<ExecutionResult> {
  const text = payload.text ?? '';
  const receipt = await sendSlackNotification(productId, {
    channel: payload.channel,
    text,
    blocks: payload.blocks,
  });

  if (receipt.certainty === 'provider_acknowledged') {
    return {
      success: true,
      integration_response: {
        note: `Message sent to ${payload.channel ?? 'default channel'}`,
        text,
        provider_message_ts: receipt.providerMessageTs,
      },
      effect_certainty: receipt.certainty,
    };
  }
  return {
    success: false,
    error: 'reason' in receipt ? receipt.reason : 'Slack notification failed',
    effect_certainty: receipt.certainty,
    reconcile_after: receipt.certainty === 'ambiguous'
      ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
      : null,
  };
}

async function executeLinearTicket(productId: string, payload: ActionPayload): Promise<ExecutionResult> {
  const integration = await getIntegration(productId, 'linear');
  if (!integration || integration.status !== 'connected') {
    return { success: false, error: 'Linear integration not connected' };
  }

  const apiKey = integration.config_json.api_key as string | undefined;
  // Use team_id from payload first, then fall back to integration config
  const teamId = payload.team_id ?? (integration.config_json.team_id as string | undefined);

  if (!apiKey) {
    return { success: false, error: 'Linear api_key not configured' };
  }
  if (!teamId) {
    return { success: false, error: 'Linear team_id not configured' };
  }
  if (!payload.ticket_title) {
    return { success: false, error: 'ticket_title is required for create_ticket' };
  }

  const mutation = `
    mutation CreateIssue($title: String!, $description: String, $teamId: String!, $priority: Int) {
      issueCreate(input: { title: $title, description: $description, teamId: $teamId, priority: $priority }) {
        success
        issue { id identifier url }
      }
    }
  `;

  try {
    const resp = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          title: payload.ticket_title,
          description: payload.ticket_description ?? null,
          teamId,
          priority: payload.priority ?? null,
        },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      return { success: false, error: `Linear API returned HTTP ${resp.status}`, effect_certainty: 'provider_rejected' };
    }

    const json = await resp.json() as LinearCreateIssueResponse;

    if (json.errors && json.errors.length > 0) {
      return { success: false, error: json.errors.map((e) => e.message).join('; '), effect_certainty: 'provider_rejected' };
    }

    const issueCreate = json.data?.issueCreate;
    if (!issueCreate?.success) {
      return { success: false, error: 'Linear issueCreate returned success=false', effect_certainty: 'provider_rejected' };
    }

    return {
      success: true,
      integration_response: {
        note: `Ticket ${issueCreate.issue?.identifier ?? ''} created`,
        id: issueCreate.issue?.id,
        identifier: issueCreate.issue?.identifier,
        url: issueCreate.issue?.url,
      },
      effect_certainty: 'provider_acknowledged',
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      effect_certainty: 'ambiguous',
      reconcile_after: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }
}

async function executeWebhook(payload: ActionPayload): Promise<ExecutionResult> {
  if (!payload.webhook_url) {
    return { success: false, error: 'webhook_url is required for custom_webhook' };
  }

  // SSRF guard: a standing order must not be usable to reach cloud metadata
  // or internal services (adapted from AcreOS's validateUrl).
  try {
    const { assertUrlSafe } = await import('../../outbound/ssrf.js');
    await assertUrlSafe(payload.webhook_url);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'blocked URL',
      effect_certainty: 'not_attempted',
    };
  }

  try {
    const resp = await fetch(payload.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload.webhook_payload ?? {}),
      signal: AbortSignal.timeout(15000),
    });

    const responseText = await resp.text();
    let responseBody: unknown;
    try { responseBody = JSON.parse(responseText); } catch { responseBody = responseText; }

    if (!resp.ok) {
      return {
        success: false,
        error: `Webhook returned HTTP ${resp.status}`,
        integration_response: responseBody,
        effect_certainty: 'provider_rejected',
      };
    }

    return {
      success: true,
      integration_response: responseBody,
      effect_certainty: 'provider_acknowledged',
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      effect_certainty: 'ambiguous',
      reconcile_after: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }
}
