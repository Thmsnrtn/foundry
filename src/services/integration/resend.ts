// =============================================================================
// FOUNDRY — Resend Email Integration
// Queues outbound email actions and executes them through the V3.1 tool
// gateway: kill-switch → classification → communication budget →
// idempotency → registered send_email handler → audit.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { getIntegration } from './fabric.js';
import { withRetry } from '../resilience.js';
import { invoke, registerToolHandler, type GatewayRequest } from '../outbound/gateway.js';
import { log } from '../../lib/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailMetrics {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  open_rate: number;
  click_rate: number;
}

interface SendEmailParams {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

interface ResendSuccess {
  message_id: string;
  raw: Record<string, unknown>;
}

const RESEND_TIMEOUT_MS = 10_000;

// ─── Connection Check ─────────────────────────────────────────────────────────

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

// ─── Email Execution (gateway-routed) ─────────────────────────────────────────

/**
 * Execute a pending email action through the tool gateway.
 *
 * Flow: load the outbound_actions row → build a GatewayRequest with the
 * action ID as dedup key (at-most-once per decision) and the first
 * recipient as customer_external_id (per-customer-week budget). The
 * gateway runs kill-switch / classification / budget / idempotency
 * pre-flights, then dispatches to the registered 'send_email' handler
 * which calls the Resend API with explicit timeout + retry.
 */
export async function executeEmailSend(
  actionId: string,
): Promise<{ success: boolean; message_id?: string }> {
  const result = await query(
    `SELECT oa.*, i.config_json
     FROM outbound_actions oa
     LEFT JOIN integrations i ON i.product_id = oa.product_id AND i.name = 'resend'
     WHERE oa.id = ?`,
    [actionId],
  );

  if (result.rows.length === 0) {
    throw new Error(`Action ${actionId} not found`);
  }

  const row = result.rows[0] as Record<string, unknown>;
  const productId = row.product_id as string;
  const agentName = (row.agent_name as string) ?? 'system';
  let parameters: SendEmailParams = { to: [], subject: '', html: '' };
  try {
    parameters = JSON.parse(row.parameters_json as string || '{}') as SendEmailParams;
  } catch {
    parameters = { to: [], subject: '', html: '' };
  }
  const toList = Array.isArray(parameters.to) ? parameters.to : [String(parameters.to)];
  const primaryRecipient = toList[0];

  const now = new Date().toISOString();
  await query(
    `UPDATE outbound_actions SET status = 'executing', approved_by = COALESCE(approved_by, 'auto'), approved_at = COALESCE(approved_at, ?), executed_at = ? WHERE id = ?`,
    [now, now, actionId],
  );

  const req: GatewayRequest = {
    productId,
    tool: 'send_email',
    action: `send "${parameters.subject ?? ''}" to ${primaryRecipient ?? 'unknown'}`,
    params: { ...parameters, to: toList },
    dedupKey: actionId,                      // at-most-once per outbound_actions row
    customerExternalId: primaryRecipient,    // per-customer-week budget
    surface: 'email_outbound',
    dataClass: 'customer',
  };

  const gatewayResult = await invoke(req);

  if (!gatewayResult.ok) {
    await query(
      `UPDATE outbound_actions SET status = 'refused', result_json = ? WHERE id = ?`,
      [JSON.stringify({ phase: gatewayResult.phase, reason: gatewayResult.reason }), actionId],
    );
    log.warn('resend.send_email.refused', {
      productId,
      actionId,
      phase: gatewayResult.phase,
      reason: gatewayResult.reason,
    });
    if (toList.length > 1) {
      log.warn('resend.send_email.bulk_partial_budget', {
        productId,
        actionId,
        recipientCount: toList.length,
        note: 'budget check applied to first recipient only',
      });
    }
    // Bubble up only as failed return — pre-flight refusal is not an
    // exception path.
    return { success: false };
  }

  const handlerResult = gatewayResult.result as ResendSuccess | { logged: true } | null;

  if (handlerResult && 'message_id' in handlerResult) {
    await query(
      `UPDATE outbound_actions SET status = 'executed', result_json = ? WHERE id = ?`,
      [
        JSON.stringify({
          message_id: handlerResult.message_id,
          resend_response: handlerResult.raw,
          gateway_invocation_id: gatewayResult.invocation_id,
          cached: gatewayResult.cached,
        }),
        actionId,
      ],
    );
    return { success: true, message_id: handlerResult.message_id };
  }

  // Logged-mode (no API key) or unrecognized result: still mark executed.
  await query(
    `UPDATE outbound_actions SET status = 'executed', result_json = ? WHERE id = ?`,
    [
      JSON.stringify({
        mode: 'logged',
        message: 'No RESEND_API_KEY set — email logged only',
        gateway_invocation_id: gatewayResult.invocation_id,
        cached: gatewayResult.cached,
      }),
      actionId,
    ],
  );
  return { success: true };
}

// ─── send_email Handler (registered with the gateway) ────────────────────────

/**
 * The actual Resend HTTP call. Registered as the gateway's 'send_email'
 * tool handler at module load. Explicit 10-second timeout per Collison's
 * recommendation; existing withRetry layered on top for transient failures.
 *
 * Returns either a ResendSuccess (real send) or { logged: true } in the
 * no-API-key dev path.
 *
 * Exported so tests that share a vitest worker with gateway.test.ts (which
 * calls clearToolHandlers in beforeEach) can re-register without a cold
 * module reload. Production callers should not invoke directly — use
 * gateway.invoke().
 */
export async function sendEmailHandler(req: GatewayRequest): Promise<ResendSuccess | { logged: true }> {
  const params = req.params as unknown as SendEmailParams;
  const apiKey = process.env.RESEND_API_KEY;
  const sendgridKey = process.env.SENDGRID_API_KEY;

  if (!apiKey && !sendgridKey) {
    log.info('resend.send_email.logged_only', {
      productId: req.productId,
      to: params.to,
      subject: params.subject,
      htmlLength: (params.html ?? '').length,
    });
    return { logged: true };
  }

  // SendGrid is the server-owned fallback mechanism for the same semantic
  // send_email capability. Callers do not select the provider.
  if (!apiKey && sendgridKey) {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sendgridKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: params.to.map((email) => ({ email })) }],
        from: { email: 'briefings@foundry.app', name: 'Foundry' },
        subject: params.subject,
        content: [
          ...(params.text ? [{ type: 'text/plain', value: params.text }] : []),
          { type: 'text/html', value: params.html },
        ],
      }),
    });
    if (!response.ok) throw new Error(`SendGrid API error ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return { message_id: response.headers.get('x-message-id') ?? req.dedupKey!, raw: { provider: 'sendgrid' } };
  }

  let lastError: unknown;
  try {
    const response = await withRetry(
      () =>
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': req.dedupKey!,
          },
          body: JSON.stringify({
            from: params.from ?? 'Foundry <noreply@foundry.app>',
            to: params.to,
            subject: params.subject,
            html: params.html,
            ...(params.text ? { text: params.text } : {}),
          }),
        }),
      { timeoutMs: RESEND_TIMEOUT_MS, maxRetries: 2 },
    );

    const responseData = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(`Resend API error ${response.status}: ${JSON.stringify(responseData)}`);
    }

    const messageId = responseData.id as string | undefined;
    if (!messageId) {
      throw new Error(`Resend response missing id: ${JSON.stringify(responseData)}`);
    }

    log.info('resend.send_email.success', {
      productId: req.productId,
      messageId,
      to: params.to,
    });
    return { message_id: messageId, raw: responseData };
  } catch (err) {
    lastError = err;
    // Update integration error tracking. The gateway audit row is already
    // written by gateway.invoke; this tracks per-integration error count.
    await query(
      `UPDATE integrations SET
        last_error = ?,
        error_count_trailing_7d = error_count_trailing_7d + 1,
        status = 'errored',
        updated_at = ?
       WHERE product_id = ? AND name = 'resend'`,
      [String(err), new Date().toISOString(), req.productId],
    );
    throw lastError;
  }
}

// Side-effect at module load: register the handler. The gateway's
// registry is process-global; importing this module wires the tool.
export const SEND_EMAIL_POLICY = {
  actor: 'email_delivery', surface: 'email_outbound', dataClass: 'customer',
  requireDedupKey: true, requireCustomerExternalId: true,
} as const;
registerToolHandler('send_email', sendEmailHandler, SEND_EMAIL_POLICY);

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
