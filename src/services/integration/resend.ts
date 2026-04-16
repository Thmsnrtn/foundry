// =============================================================================
// FOUNDRY — Resend Email Integration
// Queues and executes outbound email actions via Resend API.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { getIntegration } from './fabric.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailMetrics {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  open_rate: number;
  click_rate: number;
}

// ─── Connection Check ─────────────────────────────────────────────────────────

/**
 * Check if Resend is connected and active for a product.
 */
export async function isResendConnected(productId: string): Promise<boolean> {
  const integration = await getIntegration(productId, 'resend');
  return integration !== null && integration.status === 'active';
}

// ─── Email Queuing ────────────────────────────────────────────────────────────

/**
 * Queue an email to be sent by creating an outbound_action record.
 * Returns the outbound_action ID.
 */
export async function queueEmail(
  productId: string,
  params: {
    agent_name: string;
    to: string | string[];
    subject: string;
    html: string;
    rationale: string;
    confidence?: number;
    authority_level?: number;
  },
): Promise<string> {
  const id = nanoid();
  const authorityLevel = params.authority_level ?? 2;
  const confidence = params.confidence ?? 0.8;
  const toList = Array.isArray(params.to) ? params.to : [params.to];

  const parameters = {
    to: toList,
    subject: params.subject,
    html: params.html,
  };

  const previewText = `Send email to ${toList.join(', ')}: "${params.subject}"`;

  // Expires in 48 hours by default (emails become stale)
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const status = authorityLevel === 0 ? 'approved' : 'pending_approval';

  await query(
    `INSERT INTO outbound_actions (
      id, product_id, agent_name, integration_name, action_type,
      authority_level, status, parameters_json, preview_text, rationale,
      confidence, expires_at, created_at
    ) VALUES (?, ?, ?, 'resend', 'send_email', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      productId,
      params.agent_name,
      authorityLevel,
      status,
      JSON.stringify(parameters),
      previewText,
      params.rationale,
      confidence,
      expiresAt,
      now,
    ],
  );

  // Update outbound_actions count on integration
  await query(
    `UPDATE integrations SET total_outbound_actions = total_outbound_actions + 1, updated_at = ?
     WHERE product_id = ? AND name = 'resend'`,
    [now, productId],
  );

  return id;
}

// ─── Email Execution ──────────────────────────────────────────────────────────

/**
 * Execute a pending email action.
 * Uses Resend API if RESEND_API_KEY is set, otherwise logs to console.
 */
export async function executeEmailSend(
  actionId: string,
): Promise<{ success: boolean; message_id?: string }> {
  // Fetch the action
  const result = await query(
    `SELECT oa.*, i.config_json, i.credentials_json
     FROM outbound_actions oa
     LEFT JOIN integrations i ON i.product_id = oa.product_id AND i.name = 'resend'
     WHERE oa.id = ?`,
    [actionId],
  );

  if (result.rows.length === 0) {
    throw new Error(`Action ${actionId} not found`);
  }

  const row = result.rows[0] as Record<string, unknown>;
  let parameters: Record<string, unknown> = {};
  try {
    parameters = JSON.parse(row.parameters_json as string || '{}');
  } catch {
    parameters = {};
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const now = new Date().toISOString();

  await query(
    `UPDATE outbound_actions SET status = 'executing', approved_by = COALESCE(approved_by, 'auto'), approved_at = COALESCE(approved_at, ?), executed_at = ? WHERE id = ?`,
    [now, now, actionId],
  );

  if (!resendApiKey) {
    // Log mode — no actual send
    console.log(`[Resend] Would send email:`, {
      to: parameters.to,
      subject: parameters.subject,
      htmlLength: (parameters.html as string)?.length ?? 0,
    });

    await query(
      `UPDATE outbound_actions SET status = 'executed', result_json = ? WHERE id = ?`,
      [JSON.stringify({ mode: 'logged', message: 'No RESEND_API_KEY set — email logged only' }), actionId],
    );

    return { success: true };
  }

  // Actual Resend API call
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: (parameters.from as string) ?? 'Foundry <noreply@foundry.app>',
        to: parameters.to,
        subject: parameters.subject,
        html: parameters.html,
      }),
    });

    const responseData = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(`Resend API error: ${JSON.stringify(responseData)}`);
    }

    const messageId = responseData.id as string;

    await query(
      `UPDATE outbound_actions SET status = 'executed', result_json = ? WHERE id = ?`,
      [JSON.stringify({ message_id: messageId, resend_response: responseData }), actionId],
    );

    return { success: true, message_id: messageId };
  } catch (err) {
    const errorMsg = String(err);

    await query(
      `UPDATE outbound_actions SET status = 'failed', result_json = ? WHERE id = ?`,
      [JSON.stringify({ error: errorMsg }), actionId],
    );

    // Update error tracking on integration
    const actionRow = result.rows[0] as Record<string, unknown>;
    await query(
      `UPDATE integrations SET
        last_error = ?,
        error_count_trailing_7d = error_count_trailing_7d + 1,
        status = 'errored',
        updated_at = ?
       WHERE product_id = ? AND name = 'resend'`,
      [errorMsg, now, actionRow.product_id as string],
    );

    throw err;
  }
}

// ─── Email Metrics ────────────────────────────────────────────────────────────

/**
 * Get email performance metrics from stored events.
 */
export async function getEmailMetrics(
  productId: string,
  days: number = 30,
): Promise<EmailMetrics> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Count executed email actions
  const sentResult = await query(
    `SELECT COUNT(*) as count FROM outbound_actions
     WHERE product_id = ? AND integration_name = 'resend' AND action_type = 'send_email'
       AND status = 'executed' AND executed_at >= ?`,
    [productId, since],
  );
  const sent = ((sentResult.rows[0] as Record<string, unknown>)?.count as number) ?? 0;

  // Count delivery/open/click events from integration_events (Resend webhooks)
  const eventResult = await query(
    `SELECT event_type, COUNT(*) as count FROM integration_events
     WHERE product_id = ? AND integration_name = 'resend' AND created_at >= ?
     GROUP BY event_type`,
    [productId, since],
  );

  let delivered = 0;
  let opened = 0;
  let clicked = 0;

  for (const row of eventResult.rows) {
    const r = row as Record<string, unknown>;
    const eventType = r.event_type as string;
    const count = r.count as number;

    if (eventType === 'email.delivered') delivered += count;
    if (eventType === 'email.opened') opened += count;
    if (eventType === 'email.clicked') clicked += count;
  }

  // If no delivery events, assume delivered = sent (no webhook tracking)
  if (delivered === 0 && sent > 0) delivered = sent;

  const open_rate = delivered > 0 ? Math.round((opened / delivered) * 100) / 100 : 0;
  const click_rate = delivered > 0 ? Math.round((clicked / delivered) * 100) / 100 : 0;

  return { sent, delivered, opened, clicked, open_rate, click_rate };
}
