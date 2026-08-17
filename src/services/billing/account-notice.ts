// =============================================================================
// FOUNDRY — Account notices
//
// The one thing Foundry says to a customer whose company is paused.
//
// WHY IT EXISTS. Making the pause total closed every outbound path, including
// the one that would tell the founder what had happened. That is not the
// convention any subscription product follows: operational mail stops when an
// account lapses, and account mail — trial ending, cancellation confirmed, card
// declined, access now read-only — keeps arriving, because it is the mail about
// the lapse. An account that goes silent and read-only with no explanation is a
// support ticket at best.
//
// WHY IT IS A SEPARATE CAPABILITY. The exemption is a property of the
// registered tool, not of the request (§4). But a tool that survives the pause
// AND accepts arbitrary HTML would just be `send_email` with the pause removed:
// any caller could name it and send anything. So this handler takes a NOTICE
// KIND from a closed set and renders the body itself. The payload supplies
// facts — which company, which date — and the server supplies the meaning.
//
// WHAT IT IS NOT. Not a notification system. Five kinds, one template each, no
// scheduling, no preferences, no queue. The dedup key is the kind plus the date
// it concerns, so re-running the sweep that triggers it cannot re-send it.
// =============================================================================

import { query } from '../../db/client.js';
import { invoke, registerToolHandler, type GatewayRequest } from '../outbound/gateway.js';
import { sendEmailHandler } from '../integration/resend.js';
import { log } from '../../lib/logger.js';

export type NoticeKind =
  | 'read_only_started'
  | 'trial_ending'
  | 'trial_ended'
  | 'subscription_cancelled'
  | 'payment_failed';

export interface AccountNotice {
  kind: NoticeKind;
  /** The company the notice concerns, for the greeting and the dedup key. */
  companyName: string;
  /** The date the notice turns on: when access ends, or when the trial does. */
  effectiveAt?: string | null;
}

const APP_URL = (): string => process.env.APP_URL ?? 'https://foundry.so';

/** Subject and body per kind. Server-owned: the caller names a kind, and this
 * decides what Foundry says. */
function render(notice: AccountNotice): { subject: string; html: string } {
  const billing = `${APP_URL()}/settings/billing`;
  const when = formatDate(notice.effectiveAt);
  const shell = (body: string): string =>
    `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;line-height:1.6;">${body}
     <p style="color:#6b7280;font-size:13px;margin-top:28px;">You are receiving this because it concerns your Foundry account.</p></div>`;

  switch (notice.kind) {
    case 'trial_ending':
      return {
        subject: `Your Foundry trial ends ${when ?? 'soon'}`,
        html: shell(`<p>Your trial for <strong>${escapeHtml(notice.companyName)}</strong> ends ${when ?? 'shortly'}.</p>
          <p>Subscribe to keep Foundry operating your company. Your data and history stay yours either way.</p>
          <p><a href="${billing}">Choose a plan →</a></p>`),
      };
    case 'trial_ended':
      return {
        subject: 'Your Foundry trial has ended',
        html: shell(`<p>The trial for <strong>${escapeHtml(notice.companyName)}</strong> has ended, so Foundry has stopped acting on your behalf — no agent runs, no outbound email, no spend.</p>
          <p>Everything you have built is still here and still readable. Subscribing picks up exactly where you left off.</p>
          <p><a href="${billing}">Subscribe →</a></p>`),
      };
    case 'subscription_cancelled':
      return {
        subject: 'Your Foundry subscription is cancelled',
        html: shell(`<p>Your subscription is cancelled. <strong>${escapeHtml(notice.companyName)}</strong> keeps running until ${when ?? 'the end of the period you have paid for'} — you are not losing time you have already paid for.</p>
          <p>After that, the account becomes read-only: your data and history stay readable, and Foundry stops acting.</p>
          <p><a href="${billing}">Reactivate →</a></p>`),
      };
    case 'payment_failed':
      return {
        subject: 'Foundry could not take your payment',
        html: shell(`<p>The last payment for <strong>${escapeHtml(notice.companyName)}</strong> did not go through. We will retry it automatically.</p>
          <p>Nothing changes while we retry. Updating your card now avoids any interruption.</p>
          <p><a href="${billing}">Update payment method →</a></p>`),
      };
    case 'read_only_started':
      return {
        subject: `${escapeHtml(notice.companyName)} is now read-only`,
        html: shell(`<p><strong>${escapeHtml(notice.companyName)}</strong> is now read-only. Foundry has stopped running agents, sending email, and spending on your behalf.</p>
          <p>This happens when there is no active plan and no live trial. Nothing has been deleted and no permission you gave has been withdrawn — subscribing lifts it immediately.</p>
          <p><a href="${billing}">Subscribe →</a></p>`),
      };
  }
}

/**
 * The tool. Same transport as every other email; different authority.
 *
 * THE RECIPIENT IS RESOLVED HERE, not taken from the request. This capability
 * survives a company pause, so a caller-chosen address would make it a way to
 * mail anyone at all from an account that is supposed to be silent — five
 * templates' worth of content, but any recipient. The only person an account
 * notice is for is the account's owner, and the server knows who that is.
 */
async function accountNoticeHandler(req: GatewayRequest): Promise<unknown> {
  const params = req.params as unknown as { notice?: AccountNotice };
  const notice = params.notice;
  if (!notice || !KINDS.has(notice.kind)) {
    // A caller naming this tool cannot invent a notice: an unknown kind has no
    // body to render, and refusing is the only honest answer.
    throw new Error('unknown account notice kind');
  }
  const owner = await ownerEmail(req.productId);
  if (!owner) throw new Error('account notice has no owner to reach');

  const { subject, html } = render(notice);
  return sendEmailHandler({ ...req, params: { to: [owner], subject, html } });
}

/** The address on the account, from the database. */
async function ownerEmail(productId: string): Promise<string | null> {
  const res = await query(
    `SELECT f.email FROM products p JOIN founders f ON f.id = p.owner_id WHERE p.id = ?`,
    [productId]);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  const email = row?.email ? String(row.email) : '';
  return email || null;
}

/**
 * THE BOUNDARY OF THE EXEMPTION, written down.
 *
 * Every one of these is account administration: what the account costs, what
 * state it is in, and when that changes. None is marketing, support, growth, a
 * company's operations, or anything an agent decided to say. Adding a kind
 * widens the single capability that survives a pause, so it is a decision, not
 * a convenience — the test file states this set exactly, and an addition has to
 * change that line too.
 */
export const NOTICE_KINDS: readonly NoticeKind[] = [
  'read_only_started', 'trial_ending', 'trial_ended',
  'subscription_cancelled', 'payment_failed',
] as const;

const KINDS = new Set<NoticeKind>(NOTICE_KINDS);

export const ACCOUNT_NOTICE_POLICY = {
  actor: 'account_notice',
  surface: 'email_outbound',
  // 'general', not 'customer': the content is Foundry's own account state, not
  // anything belonging to the founder's customers. It is also the class the
  // classification layer allows by default, which matters — a notice that a
  // product-specific policy could switch off would be a pause nobody could
  // explain.
  dataClass: 'general',
  requireDedupKey: true,
  requireCustomerExternalId: true,
  // The whole point: this is the mail about the pause.
  deliverableWhilePaused: true,
} as const;

registerToolHandler('send_account_notice', accountNoticeHandler, ACCOUNT_NOTICE_POLICY);

/**
 * Send one account notice. Returns whether it was accepted — callers log, they
 * do not retry: the dedup key means a later sweep would be refused anyway, and
 * an account notice is not worth failing a billing job over.
 */
export async function sendAccountNotice(input: {
  productId: string;
  /** Kept for the communication budget and for logging. The address the mail
   * actually goes to is resolved server-side from the product's owner — a
   * capability that survives a pause must not let a caller choose who hears
   * from it. */
  to: string;
  notice: AccountNotice;
}): Promise<boolean> {
  const { productId, to, notice } = input;
  const result = await invoke({
    productId,
    tool: 'send_account_notice',
    action: `account notice: ${notice.kind}`,
    params: { notice },
    // Keyed on the date it concerns, so the hourly sweep that pauses a company
    // cannot send this every hour, and a genuinely new lapse still sends.
    dedupKey: `notice:${notice.kind}:${productId}:${notice.effectiveAt ?? 'none'}`,
    customerExternalId: to,
  });
  if (!result.ok) {
    log.warn('account_notice.refused', {
      productId, kind: notice.kind, phase: result.phase, reason: result.reason,
    });
  }
  return result.ok;
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
