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
import { assertSenderOfRecord, SenderOfRecordError } from '../outbound/sender-of-record.js';
import {
  fromLine, getSendingIdentity, recordSendingIdentityAccepted,
} from '../outbound/sending-identity.js';

/** The one Foundry From, named once so the guard and both providers agree. */
const DEFAULT_FOUNDRY_FROM = 'Foundry <noreply@foundry.app>';
import { log } from '../../lib/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Email Queuing — REMOVED ─────────────────────────────────────────────────
//
// `queueEmail` created an `outbound_actions` row from an authority level the
// CALLER supplied, and wrote `status='approved'` when that level was zero. It
// carried no responsibility, so `assisted_action_plan_guard` — which fires only
// when `responsibility_id` is present — never looked at it. A caller could
// therefore certify its own authority and mark the action approved, which is
// the one thing the outbound boundary exists to refuse.
//
// Nothing in `src/` or `tests/` called it. It was a door standing open in a
// wall nobody had walked through yet, and deleting it removes no capability:
// the governed path is `planAssistedSupportEmail` -> `executeAssistedSupportEmail`,
// which binds a responsibility, an exact live consent, and a scope.

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
  // A COERCION THAT MANUFACTURED A RECIPIENT.
  //
  // `[String(parameters.to)]` turned an ABSENT `to` into the one-element list
  // `["undefined"]`, and the gateway's `requireCustomerExternalId` is satisfied
  // by any non-empty string. So a row whose `parameters_json` parsed but
  // carried no recipient reached the provider as an attempted send to the
  // address "undefined" — burning the dedup key and marking the action executed
  // or failed, rather than refusing it as malformed.
  //
  // The parse-FAILURE path was already safe: it produces `to: []`, so
  // `primaryRecipient` is undefined and the gateway refuses. Valid JSON missing
  // a field was the gap, which is the more likely of the two.
  const toList = (Array.isArray(parameters.to) ? parameters.to : [parameters.to])
    .filter((addr): addr is string => typeof addr === 'string' && addr.trim().length > 0);
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
    // 'refused' IS NOT IN THE VOCABULARY. `outbound_actions.status` permits
    // pending_approval, approved, executing, executed, failed, rejected and
    // cancelled — so this UPDATE raised on any real database. The email was
    // correctly not sent and the row saying why was never written; the action
    // stayed at 'executing', set moments earlier, which reads as an effect in
    // flight rather than one that was stopped. Only a fabricated test schema
    // with no CHECK on it made this look like it worked.
    //
    // 'rejected' is the term the institution's other refusal path already uses
    // (responsibility-assisted-email, when authority is revoked mid-flight),
    // and `effect_certainty='not_attempted'` is what says nothing left the
    // building. WHO refused goes in result_json, because 'rejected' alone
    // cannot distinguish a founder saying no from a guard stopping it.
    await query(
      `UPDATE outbound_actions
          SET status = 'rejected', effect_certainty = 'not_attempted', result_json = ?
        WHERE id = ?`,
      [JSON.stringify({
        refused_by: 'outbound_gateway',
        phase: gatewayResult.phase,
        reason: gatewayResult.reason,
      }), actionId],
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


/**
 * Is this message going to the founder, or to one of their customers?
 *
 * Decided from the database rather than from the request: `dataClass` and
 * `surface` are what the CALLER says the message is, and the rule is about who
 * is actually receiving it.
 *
 * A message addressed to the founder AND a customer is a message to a
 * customer; the strictest recipient decides.
 */
async function recipientIsFounder(
  productId: string, recipients: string[],
): Promise<boolean> {
  if (recipients.length === 0) return true;      // nothing addressed to anyone
  const known = await query(
    `SELECT lower(f.email) AS email
       FROM products p JOIN founders f ON f.id = p.owner_id
      WHERE p.id = ?
      UNION
     SELECT lower(f.email) AS email
       FROM team_members t JOIN founders f ON f.id = t.founder_id
      WHERE t.product_id = ? AND t.status = 'active'`,
    [productId, productId]);
  const inbox = new Set(
    (known.rows as unknown as Array<Record<string, unknown>>).map((r) => String(r.email)));
  return recipients.every((r) => inbox.has(r));
}

/**
 * Decide who this message goes out as, and refuse if the answer is nobody.
 *
 * THE RULE EXISTED AND NOTHING CALLED IT. `services/outbound/sender-of-record.ts`
 * says Foundry must never be the From on a message to a THIRD PARTY — a
 * founder's customer. Those go out under the founder's own connected sender:
 * their domain, their opt-out footer, their CAN-SPAM responsibility. Its header
 * says "Department third-party paths must call it before dispatch" and adds
 * "this lights the rule up BEFORE the live path exists, so it can never regress
 * open". `assertSenderOfRecord` had ZERO callers anywhere in the system, and
 * the live path — this handler — defaulted `from` to a Foundry domain.
 *
 * It could not have been enforced until now, because the "founder's own
 * connected sender" it presupposes did not exist as a mechanism: every send
 * went through Foundry's platform key. Migration 150 and
 * `outbound/sending-identity.ts` are that mechanism, so the rule is now
 * enforceable and enforced.
 *
 * FOUNDER MAIL keeps Foundry's From and Foundry's key — welcome, digests,
 * alerts, account notices. That is Foundry writing to its own customer and is
 * exactly what the rule permits.
 *
 * THIRD-PARTY MAIL goes out under the company's own identity and through the
 * company's own provider account. With no identity connected there is nothing
 * to send as, and the send refuses with a reason a founder can act on rather
 * than borrowing Foundry's domain.
 */
async function resolveSender(
  req: GatewayRequest, params: SendEmailParams,
): Promise<{ from: string; credential: string | null; identityUsed: boolean }> {
  const recipients = (params.to ?? []).map((r) => r.toLowerCase().trim()).filter(Boolean);
  const toFounder = await recipientIsFounder(req.productId, recipients);

  if (toFounder) {
    // Foundry writing to its own customer. An explicit `from` still has to
    // pass the rule — a caller cannot opt into a worse position than the
    // default by supplying one.
    const from = params.from ?? DEFAULT_FOUNDRY_FROM;
    assertSenderOfRecord({ from, recipientIsFounder: true });
    return { from, credential: null, identityUsed: false };
  }

  const identity = await getSendingIdentity(req.productId);
  if (!identity) {
    throw new SenderOfRecordError(
      'This message is going to one of your customers, and your company has no '
      + 'sending address of its own yet. Connect one in Settings → Sending — '
      + 'mail to your customers goes out as you, on your domain, not as Foundry.');
  }

  const from = fromLine(identity);
  // Belt as well as braces: an identity is refused at setup if it names a
  // Foundry domain, and refused again here if one ever gets past that.
  assertSenderOfRecord({ from, recipientIsFounder: false });
  return { from, credential: identity.credential, identityUsed: true };
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
  const sendgridKey = process.env.SENDGRID_API_KEY;

  const sender = await resolveSender(req, params);
  // THE COMPANY'S OWN ACCOUNT SENDS THE COMPANY'S OWN MAIL. That is what makes
  // the domain verification real — the provider refuses a From the account has
  // not verified — and what puts the reputation and the bounce handling on the
  // party that owns the domain, which is the substance of the rule rather than
  // its cosmetics.
  const apiKey = sender.credential ?? process.env.RESEND_API_KEY;

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
  //
  // IT IS FOUNDRY'S ACCOUNT, so it is not available to a company's own mail.
  // Falling back would send the founder's From through Foundry's provider,
  // which is the exact substitution the sender-of-record rule exists to
  // prevent — the domain would be theirs and the reputation, bounce handling
  // and compliance obligation would be ours.
  //
  // `!sender.identityUsed` cannot currently be false here: a connected
  // identity always carries a credential, so `apiKey` is set whenever one is
  // in use and this branch is already unreachable for company mail. Mutation
  // testing says so — removing the condition changes no test. It stays as the
  // structural statement of the rule, so that if a credential ever becomes
  // optional the fallback does not quietly reopen. What actually protects the
  // rule today is the line above: `apiKey` is the COMPANY's key.
  if (!apiKey && sendgridKey && !sender.identityUsed) {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sendgridKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: params.to.map((email) => ({ email })) }],
        // The From the rule was applied to, never a second one the check
        // never saw. This used to hard-code 'briefings@foundry.app'.
        from: { email: sender.from.replace(/^.*<|>.*$/g, '').trim() },
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
            from: sender.from,
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
    // "Connected" and "working" are different facts, and a settings page that
    // cannot tell them apart tells a founder their sender is fine when it has
    // never once been used.
    if (sender.identityUsed) await recordSendingIdentityAccepted(req.productId);
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

// ─── Email Metrics — REMOVED ─────────────────────────────────────────────────
//
// `getEmailMetrics` counted `email.delivered` / `email.opened` events from
// `integration_events`. Nothing writes those: there is no Resend webhook intake,
// and the only writer of that table is the fabric's `storeEvent`, called by Slack
// and Sentry. So the function returned delivered=0 and open_rate=0 for every
// company, always — presenting UNKNOWN as a measured zero, which is the
// epistemic error the rest of this system is built to refuse. It had no caller
// anywhere, so it never told anybody that.
//
// DELIVERY EVIDENCE IS STILL WORTH HAVING, and this is not it. A provider
// delivery or bounce event is exactly the independently observed outcome the
// effect layer wants, and it needs a real webhook intake with signature
// verification — an external surface, not a counter over an empty table.

/** Exposed for tests. The determination is the load-bearing half of the
 * sender-of-record rule — the rule itself is four lines — and it reads the
 * database, so testing it through a mocked provider would prove less. */
export const __recipientIsFounderForTest = recipientIsFounder;
