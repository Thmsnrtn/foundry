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

export type NoticeKind = 'institution_stopped';

export interface AccountNotice {
  kind: NoticeKind;
  /** The company the notice concerns, for the greeting and the dedup key. */
  companyName: string;
  /** The date the notice turns on: when access ends, or when the trial does. */
  effectiveAt?: string | null;
  /**
   * The one sentence an `institution_stopped` notice carries, composed by the
   * reader on the server and never by a caller. It names a routine and a time
   * and nothing else: no error text, no message, nothing a failure was
   * carrying — the same rule `job_health` keeps.
   */
  detail?: string | null;
}

const APP_URL = (): string => process.env.APP_URL ?? 'https://foundry.so';

/** Subject and body per kind. Server-owned: the caller names a kind, and this
 * decides what Foundry says. */
function render(notice: AccountNotice): { subject: string; html: string } {
  const shell = (body: string): string =>
    `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;line-height:1.6;">${body}
     <p style="color:#6b7280;font-size:13px;margin-top:28px;">You are receiving this because it concerns your Foundry account.</p></div>`;

  switch (notice.kind) {
    case 'institution_stopped':
      // THE ONE THING THE OWNER SHOULD HEAR WITHOUT OPENING THE APP: that the
      // institution's scheduled work has stopped completing. One message per
      // stoppage — the dedup key is the last time the routine succeeded — and
      // nothing more until it stops again. Recovery is read on Home, not mailed.
      return {
        subject: 'Foundry hasn\'t completed its scheduled work',
        html: shell(`<p>${escapeHtml(notice.detail ?? 'Foundry hasn\'t completed its scheduled work.')}</p>
          <p>What it tells you may be out of date until it recovers. Nothing is lost, and nothing needs you unless Home says so.</p>
          <p>I will not write again about this stoppage. If it stops again after recovering, I will.</p>
          <p><a href="${APP_URL()}/foundry">See where it stands →</a></p>`),
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
 *
 * FIVE OF THE SIX ARE GONE (Private S7b1, 29 September 2026). Trial ending,
 * trial ended, subscription cancelled, payment failed and read-only started
 * were all about a customer's subscription to Foundry, and nobody has one: it
 * is the owner's alone. Their senders were deleted, so the kinds went too —
 * which narrows the one capability that survives a pause to the one message
 * the owner asked for.
 *
 * `institution_stopped` was added 20 September 2026 as the sixth, and it is
 * the same class as `read_only_started`: the state of the institution itself,
 * as it concerns the owner. It is sent by a routine that reads `job_health`,
 * carries a sentence the server composed, and is deduplicated on the last time
 * the stopped routine succeeded, so it is one message per stoppage and never a
 * feed. The owner asked for exactly this: to learn promptly that scheduled
 * work has stopped, without opening the application and without a
 * notification system.
 */
export const NOTICE_KINDS: readonly NoticeKind[] = ['institution_stopped'] as const;

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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
