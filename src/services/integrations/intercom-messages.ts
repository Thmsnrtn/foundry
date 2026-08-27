// =============================================================================
// FOUNDRY — the first adapter: what a customer actually wrote
//
// `syncIntercomMetrics` has counted Intercom conversations since the adapter
// existed and thrown the content away. `support_volume_7d` is how many people
// wrote; this is WHAT THEY WROTE, which is the thing the support responsibility
// needs in order to leave Shadowing.
//
// The design record has always named the missing piece, and named it as this
// shape: "an adapter for a helpdesk, a mailbox, or a form is an ordinary
// caller." So this is an ordinary caller. It does not write
// `inbound_customer_messages`, does not mint evidence, does not decide a
// responsibility. It calls `ingestCustomerMessage` — the same door a founder's
// own pipeline posts to — and inherits every rule that door enforces: the
// channel binding, the tenant scope, the dedup, the bounded fields, the future-
// timestamp refusal, and the refusal record the founder reads when a message is
// turned away.
//
// WHAT THIS SENSE CAN OBSERVE, AND WHAT IT CANNOT — stated because a sense that
// overstates its coverage is worse than no sense:
//
//   • It sees the FIRST message of a conversation created inside the window,
//     from a contact with an email address. That is the customer's opening
//     question, which is what a support responsibility acts on.
//   • It does not see replies, notes, or anything a teammate wrote. A
//     conversation Foundry ingests is not a conversation Foundry is following.
//   • It sees at most `MAX_CONVERSATIONS`, newest first. Beyond that it says so
//     rather than reporting a smaller number as the whole.
//   • A contact with no email cannot be written to, so it is counted as skipped
//     and not stored — an anonymous visitor's words are not evidence Foundry
//     can act on, and keeping them would be keeping a message it can never
//     answer.
//   • ABSENCE IS NOT ZERO. `noChannel` and `providerUnavailable` are distinct
//     from `seen: 0`, because "nobody wrote" and "I could not look" are
//     different facts and the founder is told which one happened.
//
// The customer's words never reach a model on this path. The three files that
// read `inbound_customer_messages` make zero model calls between them, and this
// adapter does not change that: the founder writes the reply.
// =============================================================================

import { query } from '../../db/client.js';
import { ingestCustomerMessage, type IntakeRefusal } from '../institution/customer-message-intake.js';

/** Newest-first, and bounded. A cap that is hit is reported, never hidden. */
const MAX_CONVERSATIONS = 150;
const PER_PAGE = 50;
const WINDOW_DAYS = 7;

export interface IntercomMessageIngest {
  /** No channel is marked `fed_by = 'intercom'`. Not an error and not zero. */
  noChannel: boolean;
  /** Intercom could not be reached or refused. Distinct from "nobody wrote". */
  providerUnavailable: boolean;
  /** Conversations the window returned. */
  seen: number;
  accepted: number;
  duplicate: number;
  /** Contacts with no email — nothing Foundry could ever reply to. */
  skippedNoContact: number;
  refused: Partial<Record<IntakeRefusal, number>>;
  /** True when the cap was reached, so `seen` is a floor and not a total. */
  windowTruncated: boolean;
}

interface IntercomContact { id?: string; email?: string | null }
interface IntercomConversationDetail {
  id: string;
  created_at: number;
  title?: string | null;
  source?: { subject?: string | null; body?: string | null; author?: IntercomContact | null };
  contacts?: { contacts?: IntercomContact[] };
}
interface IntercomListResponse {
  data: IntercomConversationDetail[];
  pages?: { next?: unknown };
}

/** Intercom sends HTML. The intake stores what a person will read. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The one channel the founder said this provider feeds, if they said so. */
async function feedChannel(productId: string, provider: string): Promise<string | null> {
  const row = (await query(
    `SELECT intake_key FROM support_channels
      WHERE product_id = ? AND fed_by = ? AND revoked_at IS NULL`,
    [productId, provider],
  )).rows[0] as Record<string, unknown> | undefined;
  return row ? String(row.intake_key) : null;
}

export async function ingestIntercomMessages(
  productId: string,
  credentials: { access_token: string },
  now: Date = new Date(),
): Promise<IntercomMessageIngest> {
  const result: IntercomMessageIngest = {
    noChannel: false, providerUnavailable: false, seen: 0, accepted: 0,
    duplicate: 0, skippedNoContact: 0, refused: {}, windowTruncated: false,
  };

  const intakeKey = await feedChannel(productId, 'intercom');
  if (!intakeKey) {
    result.noChannel = true;
    return result;
  }

  const createdAfter = Math.floor((now.getTime() - WINDOW_DAYS * 86_400_000) / 1000);
  const headers = {
    Authorization: `Bearer ${credentials.access_token}`,
    Accept: 'application/json',
    'Intercom-Version': '2.11',
  };

  const conversations: IntercomConversationDetail[] = [];
  let page = 1;
  let reachedProvider = false;
  while (conversations.length < MAX_CONVERSATIONS) {
    const url = 'https://api.intercom.io/conversations?' + new URLSearchParams({
      per_page: String(PER_PAGE), page: String(page),
      created_at_after: String(createdAfter),
      sort_by: 'created_at', sort_order: 'desc',
      display_as: 'plaintext',
    });
    let body: IntercomListResponse;
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) break;
      body = await response.json() as IntercomListResponse;
    } catch {
      break;
    }
    reachedProvider = true;
    conversations.push(...(body.data ?? []));
    if (!body.pages?.next) break;
    page++;
  }

  // "I could not look" is not "nobody wrote". Only a page that came back makes
  // `seen: 0` mean the second thing.
  if (!reachedProvider) {
    result.providerUnavailable = true;
    return result;
  }

  if (conversations.length > MAX_CONVERSATIONS) {
    result.windowTruncated = true;
    conversations.length = MAX_CONVERSATIONS;
  }
  result.seen = conversations.length;

  for (const conversation of conversations) {
    const contact = conversation.source?.author?.email
      ? conversation.source.author
      : conversation.contacts?.contacts?.find((c) => c.email);
    const email = contact?.email?.trim();
    if (!email) { result.skippedNoContact++; continue; }

    const body = plainText(String(conversation.source?.body ?? '')).slice(0, 8192);
    if (!body) { result.skippedNoContact++; continue; }

    const outcome = await ingestCustomerMessage({
      intakeKey,
      // Intercom's conversation id, so the same conversation seen on the next
      // sync converges instead of arriving twice.
      externalMessageId: `intercom:${conversation.id}`,
      contactEmail: email,
      body,
      subject: (conversation.source?.subject ?? conversation.title ?? undefined) || undefined,
      conversationRef: `intercom:${conversation.id}`,
      sourceObservedAt: new Date(conversation.created_at * 1000).toISOString(),
    });

    if ('refused' in outcome) {
      result.refused[outcome.refused] = (result.refused[outcome.refused] ?? 0) + 1;
      continue;
    }
    if (outcome.duplicate) result.duplicate++;
    else result.accepted++;
  }

  return result;
}
